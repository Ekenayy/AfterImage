// Supabase Edge Function: ask-doc
//
// Deployment:
//   1. Install Supabase CLI: npm i -g supabase
//   2. Link your project:   supabase link --project-ref <your-project-ref>
//   3. Set Gemini API key:  supabase secrets set GEMINI_API_KEY=<your-key>
//   4. Deploy:              supabase functions deploy ask-doc
//
// The function is then available at:
//   https://<your-project-ref>.supabase.co/functions/v1/ask-doc

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { GoogleGenAI, ThinkingLevel } from "npm:@google/genai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageInput {
  page: number;
  text: string;
}

interface EvidenceItem {
  page: number;
  quote: string;
  note: string;
}

interface GeminiResponse {
  answer: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  evidence_for: EvidenceItem[];
  evidence_against: EvidenceItem[];
  missing_info: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function verifyQuote(
  pages: PageInput[],
  page: number,
  quote: string,
): boolean {
  const pageData = pages.find((p) => p.page === page);
  if (!pageData) return false;
  const normalizedText = normalizeWhitespace(pageData.text);
  const normalizedQuote = normalizeWhitespace(quote);
  return normalizedText.includes(normalizedQuote);
}

function filterEvidence(
  items: EvidenceItem[],
  pages: PageInput[],
): EvidenceItem[] {
  return items.filter((item) => verifyQuote(pages, item.page, item.quote));
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

function buildPrompt(
  question: string,
  pages: PageInput[],
  maxEvidence: number,
  strict: boolean,
): string {
  const pageTexts = pages
    .map((p) => `--- PAGE ${p.page} ---\n${p.text}`)
    .join("\n\n");

  const strictBlock = strict
    ? `
CRITICAL RULES — you MUST follow these exactly:
- Return JSON only. No markdown fences, no commentary outside the JSON.
- Every "quote" value MUST be copied verbatim from the page text provided above.
  Do NOT paraphrase, reword, or summarise.
- If you cannot find a verbatim quote, reduce the number of evidence items and
  explain what is missing in the "missing_info" array.`
    : "";

  return `You are a document analyst. Answer the user's question based ONLY on the
document pages provided below.

DOCUMENT:
${pageTexts}

QUESTION: ${question}

INSTRUCTIONS:
1. Provide a concise answer and brief reasoning. Questions can have multiple answers. 
For example if the user asks: "Who signed the discharge for the patient from the post-anaesthesia care unit on April " and two people signed the document. Give evidence for the two doctors. 
2. Set confidence to "low", "medium", or "high".
3. Provide 1 to ${maxEvidence} evidence_for items. Each item must have:
   - "page": the page number the quote comes from
   - "quote": an EXACT substring (after collapsing whitespace) from that page's text. Max 180 characters.
   - "note": a short explanation of why this quote supports the answer.
4. Prefer evidence_for from the most direct section for the question
   (for example: problem list, medications, signatures, or dated audit trail),
   rather than less direct narrative text.
5. ONLY populate "evidence_against" if the document contains statements that
   directly contradict or materially weaken the conclusion.
   If there is no such conflict, "evidence_against" MUST be an empty array [].
6. If the question is unanswerable from the provided pages, explicitly say so in
   "answer", explain briefly in "reasoning", and add concrete gaps to "missing_info".
   If nothing is missing, set "missing_info" to [].
${strictBlock}

Respond with ONLY a valid JSON object in this exact schema (no markdown, no extra text):
{
  "answer": "string",
  "reasoning": "string",
  "confidence": "low|medium|high",
  "evidence_for": [{"page": number, "quote": "string", "note": "string"}],
  "evidence_against": [{"page": number, "quote": "string", "note": "string"}],
  "missing_info": ["string"]
}`;
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
}

function extractJsonObjectCandidate(text: string): string {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return text;
  }
  return text.slice(firstBrace, lastBrace + 1);
}

function repairSingleQuotedJsonSyntax(input: string): string {
  const normalizeSingleQuotedContent = (value: string): string =>
    value
      // In single-quoted strings, apostrophes are often escaped as \'
      .replace(/\\'/g, "'")
      // Convert embedded " so they remain valid after wrapping with "
      .replace(/"/g, "\\\"");

  return input
    // Keys: {'key': ...} or , 'key': ...
    .replace(
      /([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*:)/g,
      (_m, p1, p2, p3) => `${p1}"${normalizeSingleQuotedContent(p2)}"${p3}`,
    )
    // String values: :"value" equivalents using single quotes
    .replace(
      /(:\s*)'([^'\\]*(?:\\.[^'\\]*)*)'(\s*[,}\]])/g,
      (_m, p1, p2, p3) => `${p1}"${normalizeSingleQuotedContent(p2)}"${p3}`,
    );
}

function isLikelyStringTerminator(input: string, quoteIndex: number): boolean {
  let j = quoteIndex + 1;
  while (j < input.length && /\s/.test(input[j])) {
    j++;
  }

  if (j >= input.length) return true;

  const next = input[j];
  if (next === ":" || next === "}" || next === "]") {
    return true;
  }

  if (next === ",") {
    let k = j + 1;
    while (k < input.length && /\s/.test(input[k])) {
      k++;
    }
    if (k >= input.length) return true;
    const token = input[k];
    // Valid token starts after a value separator in JSON.
    return token === "\"" ||
      token === "{" ||
      token === "[" ||
      token === "}" ||
      token === "]" ||
      token === "-" ||
      /[0-9tfn]/.test(token);
  }

  return false;
}

function sanitizeJsonStrings(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (!inString) {
      if (ch === "\"") {
        inString = true;
      }
      out += ch;
      continue;
    }

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }

    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    if (ch === "\t") {
      out += "\\t";
      continue;
    }

    if (ch === "\"") {
      if (isLikelyStringTerminator(input, i)) {
        inString = false;
        out += ch;
      } else {
        // Preserve content quotes by escaping them inside string values.
        out += "\\\"";
      }
      continue;
    }

    out += ch;
  }

  if (inString) {
    // If we ended on a dangling backslash, it would escape the auto-appended
    // closing quote (`\"`) and keep the string unterminated. Drop it first.
    if (escaped && out.endsWith("\\")) {
      out = out.slice(0, -1);
    }
    out += "\"";
  }

  return out;
}

function previewPayload(label: string, text: string): void {
  const head = text.slice(0, 500);
  const tail = text.slice(-300);
  const endsWithBrace = text.trimEnd().endsWith("}");
  const openBraces = (text.match(/{/g) ?? []).length;
  const closeBraces = (text.match(/}/g) ?? []).length;

  console.log(
    `[ask-doc] ${label} summary:`,
    JSON.stringify({
      length: text.length,
      endsWithBrace,
      openBraces,
      closeBraces,
      head,
      tail,
    }),
  );
}

function looksLikeTruncatedJson(text: string): boolean {
  const candidate = extractJsonObjectCandidate(stripCodeFences(text)).trim();
  if (!candidate) return true;
  const openBraces = (candidate.match(/{/g) ?? []).length;
  const closeBraces = (candidate.match(/}/g) ?? []).length;
  return !candidate.endsWith("}") || closeBraces < openBraces;
}

function extractJson(raw: string): unknown {
  const withoutFences = stripCodeFences(raw);
  const cleaned = extractJsonObjectCandidate(withoutFences);

  // Try strict parse first
  try {
    return JSON.parse(cleaned);
  } catch (strictErr) {
    console.warn("[ask-doc] strict JSON.parse failed, attempting repair:", (strictErr as Error).message);
    previewPayload("cleaned JSON candidate", cleaned);
  }

  // Repair common Gemini JSON issues:
  // 1. Replace single-quoted keys/values in JSON syntax
  // 2. Escape likely unescaped quotes/newlines inside string literals
  // 3. Remove trailing commas before } or ]
  const repaired = sanitizeJsonStrings(
    repairSingleQuotedJsonSyntax(cleaned),
  )
    // Remove trailing commas before closing brackets
    .replace(/,\s*([}\]])/g, "$1");

  try {
    const result = JSON.parse(repaired);
    console.log("[ask-doc] JSON repair succeeded");
    return result;
  } catch (repairErr) {
    console.error("[ask-doc] JSON repair also failed:", (repairErr as Error).message);
    previewPayload("raw Gemini output", raw);
    previewPayload("cleaned JSON candidate", cleaned);
    previewPayload("repaired JSON candidate", repaired);
    throw repairErr;
  }
}

async function callGemini(
  client: GoogleGenAI,
  question: string,
  pages: PageInput[],
  maxEvidence: number,
  strict: boolean,
): Promise<GeminiResponse> {
  const prompt = buildPrompt(question, pages, maxEvidence, strict);

  const runAttempt = async (outputTokens: number, attempt: number) => {
    const response = await client.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        maxOutputTokens: outputTokens,
        responseMimeType: "application/json",
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        }
      },
    });

    const rawText = response.text;
    const responseMeta = response as unknown as {
      candidates?: Array<{ finishReason?: string }>;
      usageMetadata?: unknown;
    };
    const finishReason = responseMeta.candidates?.[0]?.finishReason ?? null;

    console.log(
      `[ask-doc] Gemini response metadata (attempt ${attempt}):`,
      JSON.stringify({
        finishReason,
        usageMetadata: responseMeta.usageMetadata ?? null,
        hasText: Boolean(rawText),
        textLength: rawText?.length ?? 0,
        maxOutputTokens: outputTokens,
      }),
    );
    if (rawText) {
      // previewPayload(`raw Gemini text (attempt ${attempt})`, rawText);
    }

    return { rawText, finishReason };
  };

  let { rawText, finishReason } = await runAttempt(4096, 1);

  if (rawText && finishReason === "MAX_TOKENS" && looksLikeTruncatedJson(rawText)) {
    console.warn("[ask-doc] detected truncated JSON at MAX_TOKENS; retrying with larger output budget");
    const retry = await runAttempt(8192, 2);
    rawText = retry.rawText;
    finishReason = retry.finishReason;
  }

  if (!rawText) {
    throw new Error("No text in Gemini response");
  }

  let parsed: GeminiResponse;
  try {
    parsed = extractJson(rawText) as GeminiResponse;
  } catch (parseErr) {
    if (finishReason === "MAX_TOKENS") {
      console.warn("[ask-doc] parse failed after MAX_TOKENS; final retry with 12288 output tokens");
      const retry = await runAttempt(12288, 3);
      if (!retry.rawText) {
        throw parseErr;
      }
      parsed = extractJson(retry.rawText) as GeminiResponse;
    } else {
      throw parseErr;
    }
  }

  // Basic shape validation
  if (
    typeof parsed.answer !== "string" ||
    typeof parsed.reasoning !== "string" ||
    !Array.isArray(parsed.evidence_for)
  ) {
    throw new Error("Gemini returned invalid response shape");
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const { question, pages, maxEvidence = 3 } = body;

    // Validate input
    if (!question || typeof question !== "string") {
      return jsonResponse({ error: "Missing or invalid 'question'" }, 400);
    }
    if (!Array.isArray(pages) || pages.length === 0) {
      return jsonResponse({ error: "Missing or invalid 'pages'" }, 400);
    }
    for (const p of pages) {
      if (typeof p.page !== "number" || typeof p.text !== "string") {
        return jsonResponse(
          { error: "Each page must have numeric 'page' and string 'text'" },
          400,
        );
      }
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return jsonResponse(
        { error: "GEMINI_API_KEY not configured" },
        500,
      );
    }

    const client = new GoogleGenAI({ apiKey });

    // First attempt (normal prompt)
    let result: GeminiResponse;
    let needsRetry = false;

    try {
      result = await callGemini(client, question, pages, maxEvidence, false);
    } catch {
      needsRetry = true;
      result = undefined!;
    }

    if (!needsRetry) {
      // Verify quotes — if any fail, mark for retry
      const verifiedFor = filterEvidence(result.evidence_for, pages);
      const verifiedAgainst = filterEvidence(
        result.evidence_against ?? [],
        pages,
      );

      if (verifiedFor.length < result.evidence_for.length) {
        needsRetry = true;
      } else {
        // All quotes verified on first pass
        result.evidence_for = verifiedFor;
        result.evidence_against = verifiedAgainst;
      }
    }

    // Retry with stricter prompt if needed
    if (needsRetry) {
      try {
        result = await callGemini(client, question, pages, maxEvidence, true);
      } catch (retryErr) {
        return jsonResponse(
          { error: `Gemini call failed after retry: ${retryErr}` },
          502,
        );
      }

      // Verify again — this time just drop unverified items
      result.evidence_for = filterEvidence(result.evidence_for, pages);
      result.evidence_against = filterEvidence(
        result.evidence_against ?? [],
        pages,
      );
    }

    // Normalize fields that Gemini may return in unexpected formats
    if (!Array.isArray(result.evidence_against)) {
      result.evidence_against = [];
    }
    if (!Array.isArray(result.missing_info)) {
      result.missing_info = [];
    }
    // Gemini sometimes returns "High" / "Medium" / "Low" — normalize to lowercase
    if (typeof result.confidence === "string") {
      const c = result.confidence.toLowerCase();
      if (c === "low" || c === "medium" || c === "high") {
        result.confidence = c;
      } else {
        console.warn(`[ask-doc] unexpected confidence value: "${result.confidence}", defaulting to "medium"`);
        result.confidence = "medium";
      }
    } else {
      console.warn(`[ask-doc] confidence missing or non-string, defaulting to "medium"`);
      result.confidence = "medium";
    }

    console.log("[ask-doc] returning response:", JSON.stringify({
      answer: result.answer?.slice(0, 80),
      confidence: result.confidence,
      evidence_for_count: result.evidence_for?.length,
      evidence_against_count: result.evidence_against?.length,
      missing_info_count: result.missing_info?.length,
    }));

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: `Internal error: ${err}` }, 500);
  }
});
