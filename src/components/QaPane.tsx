"use client";

import { useEffect, useRef, useState } from "react";
import { AnswerModel, PageText, QaResponse, ReasoningLevel } from "@/types";
import { LuBrain } from "react-icons/lu";
import EvidenceCard from "./EvidenceCard";

interface QaPaneProps {
  question: string;
  onQuestionChange: (q: string) => void;
  onAsk: () => void;
  loading: boolean;
  selectedModel: AnswerModel;
  onModelChange: (model: AnswerModel) => void;
  selectedReasoningLevel: ReasoningLevel;
  onReasoningLevelChange: (level: ReasoningLevel) => void;
  response: QaResponse | null;
  onEvidenceClick?: (page: number, quote: string) => void;
  pagesText: PageText[] | null;
  textExtractionError: boolean;
  errorMessage: string | null;
}

const MODEL_OPTIONS: Array<{ id: AnswerModel; label: string }> = [
  { id: "gemini-3.0-flash", label: "Gemini 3.0 Flash" },
  { id: "gpt-5.2", label: "GPT-5.2" },
];

const REASONING_OPTIONS: Array<{ id: ReasoningLevel; label: string }> = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export default function QaPane({
  question,
  onQuestionChange,
  onAsk,
  loading,
  selectedModel,
  onModelChange,
  selectedReasoningLevel,
  onReasoningLevelChange,
  response,
  onEvidenceClick,
  pagesText,
  textExtractionError,
  errorMessage,
}: QaPaneProps) {
  const [modelOpen, setModelOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const reasoningMenuRef = useRef<HTMLDivElement>(null);
  const pagesTextReady = pagesText !== null && pagesText.length > 0;
  const askDisabled = loading || !question.trim() || !pagesTextReady;
  const selectedModelOption = MODEL_OPTIONS.find((m) => m.id === selectedModel) ?? MODEL_OPTIONS[0];
  const selectedReasoningOption = REASONING_OPTIONS.find((r) => r.id === selectedReasoningLevel) ?? REASONING_OPTIONS[1];

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setModelOpen(false);
      }
      if (reasoningMenuRef.current && !reasoningMenuRef.current.contains(event.target as Node)) {
        setReasoningOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !askDisabled) {
      e.preventDefault();
      onAsk();
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 p-4">
        <div className="rounded-2xl border border-gray-300 bg-white p-3 shadow-sm">
          <textarea
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the document…"
            disabled={loading || !pagesTextReady}
            rows={4}
            className="h-28 w-full resize-none bg-transparent text-sm leading-relaxed text-gray-900 placeholder-gray-400 focus:outline-none disabled:text-gray-400"
          />

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative" ref={modelMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setModelOpen((prev) => !prev);
                    setReasoningOpen(false);
                  }}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{selectedModelOption.label}</span>
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {modelOpen && (
                  <div className="absolute bottom-11 left-0 z-20 min-w-60 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                    {MODEL_OPTIONS.map((model) => {
                      const active = model.id === selectedModel;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            onModelChange(model.id);
                            setModelOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                            active ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <span>{model.label}</span>
                          {active && <span className="text-xs text-gray-500">Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="relative" ref={reasoningMenuRef}>
                <button
                  type="button"
                  onClick={() => {
                    setReasoningOpen((prev) => !prev);
                    setModelOpen(false);
                  }}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <LuBrain className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{selectedReasoningOption.label}</span>
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {reasoningOpen && (
                  <div className="absolute bottom-11 left-0 z-20 min-w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                    {REASONING_OPTIONS.map((level) => {
                      const active = level.id === selectedReasoningLevel;
                      return (
                        <button
                          key={level.id}
                          type="button"
                          onClick={() => {
                            onReasoningLevelChange(level.id);
                            setReasoningOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                            active ? "bg-gray-100 text-gray-900" : "text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          <span>{level.label}</span>
                          {active && <span className="text-xs text-gray-500">Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onAsk()}
              disabled={askDisabled}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {loading ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 animate-spin rounded-full border border-white border-t-transparent" />
                  Asking
                </span>
              ) : (
                "Ask"
              )}
            </button>
          </div>
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

        {!loading && !response && textExtractionError && (
          <div className="flex items-center justify-center py-12 text-center text-sm text-red-500">
            Failed to extract text from document. Please try a different PDF.
          </div>
        )}

        {!loading && !response && !textExtractionError && errorMessage && (
          <div className="flex items-center justify-center py-12 text-center text-sm text-red-500">
            {errorMessage}
          </div>
        )}

        {!loading && !response && !textExtractionError && !errorMessage && pagesText === null && (
          <div className="flex items-center justify-center py-12 text-center text-sm text-gray-400">
            Upload a document to get started
          </div>
        )}

        {!loading && !response && !textExtractionError && !errorMessage && pagesText !== null && !pagesTextReady && (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <span className="ml-2 text-sm text-gray-500">Indexing document…</span>
          </div>
        )}

        {!loading && !response && !textExtractionError && !errorMessage && pagesTextReady && (
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

            {/* Verified highlights note */}
            {(response.evidence_for.length > 0 || response.evidence_against.length > 0) && (
              <p className="text-xs text-gray-400 italic">
                Verified highlights only — quotes are checked against the document text.
              </p>
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
