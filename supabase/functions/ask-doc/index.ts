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
import { GoogleGenAI } from "npm:@google/genai";

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
1. Provide a concise answer and brief reasoning.
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

function extractJson(raw: string): unknown {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  return JSON.parse(cleaned);
}

async function callGemini(
  client: GoogleGenAI,
  question: string,
  pages: PageInput[],
  maxEvidence: number,
  strict: boolean,
): Promise<GeminiResponse> {
  const prompt = buildPrompt(question, pages, maxEvidence, strict);

  const response = await client.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  });

  const rawText = response.text;
  if (!rawText) {
    throw new Error("No text in Gemini response");
  }

  const parsed = extractJson(rawText) as GeminiResponse;

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

    // Ensure evidence_against is always an array
    if (!Array.isArray(result.evidence_against)) {
      result.evidence_against = [];
    }
    if (!Array.isArray(result.missing_info)) {
      result.missing_info = [];
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: `Internal error: ${err}` }, 500);
  }
});
