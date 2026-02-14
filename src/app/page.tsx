"use client";

import { useState, useCallback } from "react";
import { QaResponse } from "@/types";
import Header from "@/components/Header";
import PdfViewerPane from "@/components/PdfViewerPane";
import QaPane from "@/components/QaPane";

const MOCK_RESPONSE: QaResponse = {
  answer:
    "The document concludes that the proposed approach significantly improves performance over baseline methods.",
  reasoning:
    "Multiple sections reference comparative benchmarks and the conclusion explicitly states measurable gains.",
  confidence: "high",
  evidence_for: [
    {
      page: 3,
      quote:
        "Our method achieves a 15% improvement over the baseline across all evaluated metrics.",
      note: "Direct performance comparison in Results section",
    },
    {
      page: 5,
      quote:
        "The proposed framework consistently outperforms existing approaches in both accuracy and efficiency.",
      note: "Summary of findings in Discussion",
    },
  ],
  evidence_against: [],
  missing_info: [],
};

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QaResponse | null>(null);

  const handleAsk = useCallback(() => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setResponse(null);
    // Mock delay to simulate API call
    setTimeout(() => {
      setResponse(MOCK_RESPONSE);
      setLoading(false);
    }, 1000);
  }, [question, loading]);

  const handleSelectExample = useCallback(
    (q: string) => {
      setQuestion(q);
      setLoading(true);
      setResponse(null);
      setTimeout(() => {
        setResponse(MOCK_RESPONSE);
        setLoading(false);
      }, 1000);
    },
    [],
  );

  const handleClearHighlights = useCallback(() => {
    // No-op for now — will clear PDF highlights later
  }, []);

  const handleEvidenceClick = useCallback((page: number, _quote: string) => {
    // No-op for now — will navigate PDF to page and highlight quote
    console.log(`Navigate to page ${page}`);
  }, []);

  return (
    <div className="flex h-screen flex-col">
      <Header
        onSelectExample={handleSelectExample}
        onClearHighlights={handleClearHighlights}
      />

      <div className="flex flex-1 gap-4 overflow-hidden p-4">
        {/* Left: PDF Viewer (60%) */}
        <div className="w-3/5 min-w-0">
          <PdfViewerPane />
        </div>

        {/* Right: Q&A Panel (40%) */}
        <div className="w-2/5 min-w-0">
          <QaPane
            question={question}
            onQuestionChange={setQuestion}
            onAsk={handleAsk}
            loading={loading}
            response={response}
            onEvidenceClick={handleEvidenceClick}
          />
        </div>
      </div>
    </div>
  );
}
