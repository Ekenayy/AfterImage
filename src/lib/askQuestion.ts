import { PageText, QaResponse } from "@/types";

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
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<QaResponse>;
  return (
    typeof candidate.answer === "string" &&
    typeof candidate.reasoning === "string" &&
    (candidate.confidence === "low" ||
      candidate.confidence === "medium" ||
      candidate.confidence === "high") &&
    Array.isArray(candidate.evidence_for) &&
    Array.isArray(candidate.evidence_against) &&
    Array.isArray(candidate.missing_info)
  );
}

export async function askQuestion(
  question: string,
  pagesText: PageText[],
  maxEvidence = 3,
): Promise<QaResponse> {
  const { url, anonKey } = readPublicConfig();

  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/ask-doc`, {
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
      }),
    });
  } catch {
    throw new Error(DEFAULT_ERROR_MESSAGE);
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // Ignore parse failures and fall through to a generic error below.
  }

  if (!response.ok) {
    if (data && typeof data === "object" && "error" in data) {
      const raw = (data as { error?: unknown }).error;
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
