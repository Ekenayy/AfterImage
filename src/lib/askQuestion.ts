import { AnswerModel, PageText, QaResponse, ReasoningLevel } from "@/types";

const DEFAULT_ERROR_MESSAGE =
  "Unable to analyze this document right now. Please try again.";

function readPublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error(
      "App configuration is incomplete. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return { url: url.replace(/\/+$/, ""), anonKey };
}

function asFriendlyError(message: string): string {
  const trimmed = message.trim();
  return trimmed || DEFAULT_ERROR_MESSAGE;
}

function isQaResponse(value: unknown): value is QaResponse {
  if (!value || typeof value !== "object") {
    console.error("[askQuestion] response is not an object:", value);
    return false;
  }
  const candidate = value as Partial<QaResponse>;
  const checks = {
    answer: typeof candidate.answer === "string",
    reasoning: typeof candidate.reasoning === "string",
    confidence:
      candidate.confidence === "low" ||
      candidate.confidence === "medium" ||
      candidate.confidence === "high",
    evidence_for: Array.isArray(candidate.evidence_for),
    evidence_against: Array.isArray(candidate.evidence_against),
    missing_info: Array.isArray(candidate.missing_info),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error(
      "[askQuestion] response validation failed on:",
      failed.map(([k]) => k),
      "| raw values:",
      Object.fromEntries(
        failed.map(([k]) => [k, (candidate as Record<string, unknown>)[k]]),
      ),
    );
    return false;
  }
  return true;
}

export async function askQuestion(
  question: string,
  pagesText: PageText[],
  maxEvidence = 3,
  model: AnswerModel = "gemini-3.0-flash",
  reasoningLevel: ReasoningLevel = "medium",
): Promise<QaResponse> {
  const { url, anonKey } = readPublicConfig();
  const functionName = model === "gemini-3.0-flash" ? "ask-doc" : "ask-openAI";

  console.log("[askQuestion] sending request", {
    question,
    pageCount: pagesText.length,
    maxEvidence,
    model,
    reasoningLevel,
    functionName,
  });

  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        question,
        pages: pagesText,
        maxEvidence,
        reasoningLevel,
      }),
    });
  } catch (fetchErr) {
    console.error("[askQuestion] fetch failed:", fetchErr);
    throw new Error(DEFAULT_ERROR_MESSAGE);
  }

  console.log("[askQuestion] response status:", response.status);

  let data: unknown = null;
  try {
    data = await response.json();
  } catch (jsonErr) {
    console.error("[askQuestion] failed to parse response JSON:", jsonErr);
  }

  console.log("[askQuestion] parsed response data:", data);

  if (!response.ok) {
    if (data && typeof data === "object" && "error" in data) {
      const raw = (data as { error?: unknown }).error;
      console.error("[askQuestion] server error:", raw);
      if (typeof raw === "string") {
        throw new Error(asFriendlyError(raw));
      }
    }
    throw new Error(DEFAULT_ERROR_MESSAGE);
  }

  if (!isQaResponse(data)) {
    throw new Error(
      "The document service returned an unexpected response. Please try again.",
    );
  }

  return data;
}
