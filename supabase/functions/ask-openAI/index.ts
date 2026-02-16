// Supabase Edge Function: ask-openAI
//
// Deployment:
//   1. Install Supabase CLI: npm i -g supabase
//   2. Link your project:    supabase link --project-ref <your-project-ref>
//   3. Set OpenAI API key:   supabase secrets set OPENAI_API_KEY=<your-key>
//   4. Optional model:       supabase secrets set OPENAI_MODEL=gpt-5.2
//   5. Deploy:               supabase functions deploy ask-openAI
//
// The function is then available at:
//   https://<your-project-ref>.supabase.co/functions/v1/ask-openAI

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface PageInput {
  page: number;
  text: string;
}

interface EvidenceItem {
  page: number;
  quote: string;
  note: string;
}

interface QaResponse {
  answer: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  evidence_for: EvidenceItem[];
  evidence_against: EvidenceItem[];
  missing_info: string[];
}

type ReasoningLevel = "low" | "medium" | "high";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.2";

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

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isEvidenceItem(item: EvidenceItem): boolean {
  return Number.isInteger(item.page) &&
    item.page > 0 &&
    typeof item.quote === "string" &&
    item.quote.length > 0 &&
    item.quote.length <= 180 &&
    typeof item.note === "string";
}

function verifyQuote(pages: PageInput[], page: number, quote: string): boolean {
  const pageData = pages.find((p) => p.page === page);
  if (!pageData) {
    return false;
  }
  return normalizeWhitespace(pageData.text).includes(normalizeWhitespace(quote));
}

function filterEvidence(items: EvidenceItem[], pages: PageInput[], maxEvidence: number): EvidenceItem[] {
  return items
    .filter((item) => isEvidenceItem(item) && verifyQuote(pages, item.page, item.quote))
    .slice(0, maxEvidence);
}

function buildSchema(maxEvidence: number): Record<string, unknown> {
  const boundedEvidence = Math.max(1, Math.min(maxEvidence, 8));

  const evidenceItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      page: { type: "integer", minimum: 1 },
      quote: { type: "string", maxLength: 180 },
      note: { type: "string", maxLength: 240 },
    },
    required: ["page", "quote", "note"],
  };

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      reasoning: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      evidence_for: {
        type: "array",
        items: evidenceItem,
        maxItems: boundedEvidence,
      },
      evidence_against: {
        type: "array",
        items: evidenceItem,
        maxItems: boundedEvidence,
      },
      missing_info: {
        type: "array",
        items: { type: "string" },
        maxItems: 8,
      },
    },
    required: [
      "answer",
      "reasoning",
      "confidence",
      "evidence_for",
      "evidence_against",
      "missing_info",
    ],
  };
}

function buildPrompt(question: string, pages: PageInput[], maxEvidence: number, strictRetry: boolean): string {
  const pageTexts = pages
    .map((p) => `--- PAGE ${p.page} ---\n${p.text}`)
    .join("\n\n");

  const strictBlock = strictRetry
    ? `
CRITICAL RETRY RULES:
- Every quote MUST be a verbatim substring of the page text after whitespace normalization.
- If unsure, return fewer evidence items instead of inventing or editing quotes.
- Keep each quote at 180 characters or less.`
    : "";

  return `You answer questions using ONLY the provided document pages.

DOCUMENT:
${pageTexts}

QUESTION: ${question}

INSTRUCTIONS:
1. Provide a concise answer and brief reasoning.
2. Set confidence to one of: low, medium, high.
3. evidence_for must include the strongest supporting quotes (0 to ${Math.max(1, Math.min(maxEvidence, 8))} items).
4. Each evidence item must include:
   - page: numeric page number
   - quote: exact quote from that page (<=180 chars)
   - note: short explanation for relevance
5. evidence_against must only include contradictory or materially weakening evidence.
   If none exists, return [] exactly.
6. If the question is unanswerable from the document, say so in answer/reasoning and explain gaps in missing_info.
${strictBlock}`;
}

function extractOutputText(responsePayload: Record<string, unknown>): string {
  if (typeof responsePayload.output_text === "string" && responsePayload.output_text.trim()) {
    return responsePayload.output_text;
  }

  const output = responsePayload.output;
  if (!Array.isArray(output)) {
    return "";
  }

  const textParts: string[] = [];

  for (const outputItem of output) {
    if (!outputItem || typeof outputItem !== "object") {
      continue;
    }

    const content = (outputItem as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const typedPart = part as { type?: unknown; text?: unknown; refusal?: unknown };
      if (typedPart.type === "output_text" && typeof typedPart.text === "string") {
        textParts.push(typedPart.text);
      }
      if (typedPart.type === "refusal") {
        const refusal = typeof typedPart.refusal === "string" ? typedPart.refusal : "Model refused request";
        throw new Error(refusal);
      }
    }
  }

  return textParts.join("\n").trim();
}

function validateShape(value: unknown): QaResponse {
  if (!value || typeof value !== "object") {
    throw new Error("OpenAI returned non-object JSON");
  }

  const candidate = value as Partial<QaResponse>;

  if (typeof candidate.answer !== "string") {
    throw new Error("Missing answer");
  }
  if (typeof candidate.reasoning !== "string") {
    throw new Error("Missing reasoning");
  }
  if (candidate.confidence !== "low" && candidate.confidence !== "medium" && candidate.confidence !== "high") {
    throw new Error("Invalid confidence");
  }
  if (!Array.isArray(candidate.evidence_for)) {
    throw new Error("Missing evidence_for");
  }
  if (!Array.isArray(candidate.evidence_against)) {
    throw new Error("Missing evidence_against");
  }
  if (!Array.isArray(candidate.missing_info)) {
    throw new Error("Missing missing_info");
  }

  return {
    answer: candidate.answer,
    reasoning: candidate.reasoning,
    confidence: candidate.confidence,
    evidence_for: candidate.evidence_for as EvidenceItem[],
    evidence_against: candidate.evidence_against as EvidenceItem[],
    missing_info: candidate.missing_info.filter((i): i is string => typeof i === "string"),
  };
}

async function runOpenAIAttempt(
  apiKey: string,
  model: string,
  question: string,
  pages: PageInput[],
  maxEvidence: number,
  strictRetry: boolean,
  reasoningLevel: ReasoningLevel,
  outputTokens: number,
  attempt: number,
): Promise<{ parsed: QaResponse }> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: outputTokens,
      reasoning: {
        effort: reasoningLevel,
      },
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "You are a careful document analyst. Return only data grounded in provided text." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: buildPrompt(question, pages, maxEvidence, strictRetry) }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "document_qa_response",
          strict: true,
          schema: buildSchema(maxEvidence),
        },
      },
    }),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI API error (${response.status}): ${rawBody}`);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`OpenAI returned non-JSON response: ${err}`);
  }

  const status = typeof payload.status === "string" ? payload.status : null;
  const incompleteReason =
    payload.incomplete_details && typeof payload.incomplete_details === "object" &&
      typeof (payload.incomplete_details as { reason?: unknown }).reason === "string"
      ? (payload.incomplete_details as { reason: string }).reason
      : null;

  const outputText = extractOutputText(payload);

  console.log(
    `[ask-openAI] attempt ${attempt} metadata:`,
    JSON.stringify({
      status,
      incompleteReason,
      textLength: outputText.length,
      maxOutputTokens: outputTokens,
    }),
  );

  if (!outputText) {
    throw new Error(
      `OpenAI response did not contain output text (status=${status ?? "unknown"}, incompleteReason=${incompleteReason ?? "none"})`,
    );
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(outputText);
  } catch (err) {
    throw new Error(
      `Failed to parse structured JSON (status=${status ?? "unknown"}, incompleteReason=${incompleteReason ?? "none"}): ${err}`,
    );
  }

  return { parsed: validateShape(parsedUnknown) };
}

async function callOpenAI(
  apiKey: string,
  model: string,
  question: string,
  pages: PageInput[],
  maxEvidence: number,
  strictRetry: boolean,
  reasoningLevel: ReasoningLevel,
): Promise<QaResponse> {
  const budgets = [4096, 8192, 12288];
  let lastErr: unknown = null;

  for (let i = 0; i < budgets.length; i++) {
    try {
      const { parsed } = await runOpenAIAttempt(
        apiKey,
        model,
        question,
        pages,
        maxEvidence,
        strictRetry,
        reasoningLevel,
        budgets[i],
        i + 1,
      );
      return parsed;
    } catch (err) {
      lastErr = err;

      const message = err instanceof Error ? err.message : String(err);
      const likelyTokenCap = message.includes("max_output_tokens") || message.includes("incomplete");

      if (i < budgets.length - 1 && likelyTokenCap) {
        console.warn(`[ask-openAI] retrying due to likely token cap: ${message}`);
        continue;
      }

      if (i < budgets.length - 1 && message.includes("structured JSON")) {
        console.warn(`[ask-openAI] retrying after parse issue: ${message}`);
        continue;
      }

      throw err;
    }
  }

  throw new Error(`OpenAI call failed after retries: ${lastErr}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const { question, pages, maxEvidence = 3, reasoningLevel = "medium" } = body;
    const normalizedReasoningLevel: ReasoningLevel =
      reasoningLevel === "high" || reasoningLevel === "low" || reasoningLevel === "medium"
        ? reasoningLevel
        : "medium";

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

    const apiKey = Deno.env.get("OPENAI_API_KEY")?.trim();
    if (!apiKey) {
      return jsonResponse({ error: "OPENAI_API_KEY not configured" }, 500);
    }

    const model = Deno.env.get("OPENAI_MODEL")?.trim() || DEFAULT_OPENAI_MODEL;
    const boundedEvidence = Math.max(1, Math.min(Number(maxEvidence) || 3, 8));

    let result: QaResponse;
    let needsRetry = false;

    try {
      result = await callOpenAI(
        apiKey,
        model,
        question,
        pages,
        boundedEvidence,
        false,
        normalizedReasoningLevel,
      );
    } catch {
      needsRetry = true;
      result = undefined!;
    }

    if (!needsRetry) {
      const verifiedFor = filterEvidence(result.evidence_for, pages, boundedEvidence);
      const verifiedAgainst = filterEvidence(result.evidence_against ?? [], pages, boundedEvidence);

      if (verifiedFor.length < result.evidence_for.length) {
        needsRetry = true;
      } else {
        result.evidence_for = verifiedFor;
        result.evidence_against = verifiedAgainst;
      }
    }

    if (needsRetry) {
      try {
        result = await callOpenAI(
          apiKey,
          model,
          question,
          pages,
          boundedEvidence,
          true,
          normalizedReasoningLevel,
        );
      } catch (retryErr) {
        return jsonResponse({ error: `OpenAI call failed after retry: ${retryErr}` }, 502);
      }

      result.evidence_for = filterEvidence(result.evidence_for, pages, boundedEvidence);
      result.evidence_against = filterEvidence(result.evidence_against ?? [], pages, boundedEvidence);
    }

    if (!Array.isArray(result.evidence_against)) {
      result.evidence_against = [];
    }

    if (!Array.isArray(result.missing_info)) {
      result.missing_info = [];
    }

    if (typeof result.confidence !== "string") {
      result.confidence = "medium";
    }

    if (result.confidence !== "low" && result.confidence !== "medium" && result.confidence !== "high") {
      result.confidence = "medium";
    }

    console.log("[ask-openAI] returning response:", JSON.stringify({
      answer: result.answer?.slice(0, 80),
      model,
      reasoningLevel: normalizedReasoningLevel,
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
