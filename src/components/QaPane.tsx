"use client";

import { QaResponse } from "@/types";
import EvidenceCard from "./EvidenceCard";

interface QaPaneProps {
  question: string;
  onQuestionChange: (q: string) => void;
  onAsk: () => void;
  loading: boolean;
  response: QaResponse | null;
  onEvidenceClick?: (page: number, quote: string) => void;
}

export default function QaPane({
  question,
  onQuestionChange,
  onAsk,
  loading,
  response,
  onEvidenceClick,
}: QaPaneProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading && question.trim()) {
      onAsk();
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white">
      {/* Input area */}
      <div className="border-b border-gray-200 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the document…"
            disabled={loading}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="button"
            onClick={onAsk}
            disabled={loading || !question.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {loading ? "…" : "Ask"}
          </button>
        </div>
      </div>

      {/* Response area */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <span className="ml-2 text-sm text-gray-500">Analyzing document…</span>
          </div>
        )}

        {!loading && !response && (
          <div className="flex items-center justify-center py-12 text-center text-sm text-gray-400">
            Ask a question to get started
          </div>
        )}

        {!loading && response && (
          <div className="space-y-5">
            {/* Answer */}
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Answer
              </h3>
              <p className="text-sm leading-relaxed text-gray-800">
                {response.answer}
              </p>
              <span
                className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                  response.confidence === "high"
                    ? "bg-emerald-100 text-emerald-700"
                    : response.confidence === "medium"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {response.confidence} confidence
              </span>
            </section>

            {/* Reasoning */}
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Reasoning
              </h3>
              <p className="text-sm leading-relaxed text-gray-600">
                {response.reasoning}
              </p>
            </section>

            {/* Evidence For */}
            {response.evidence_for.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Evidence For
                </h3>
                <div className="space-y-2">
                  {response.evidence_for.map((item, i) => (
                    <EvidenceCard
                      key={i}
                      item={item}
                      variant="for"
                      onClick={() => onEvidenceClick?.(item.page, item.quote)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Evidence Against — only if non-empty */}
            {response.evidence_against.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Evidence Against
                </h3>
                <div className="space-y-2">
                  {response.evidence_against.map((item, i) => (
                    <EvidenceCard
                      key={i}
                      item={item}
                      variant="against"
                      onClick={() => onEvidenceClick?.(item.page, item.quote)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Missing Info — only if non-empty */}
            {response.missing_info.length > 0 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Missing Information
                </h3>
                <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
                  {response.missing_info.map((info, i) => (
                    <li key={i}>{info}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
