"use client";

import { useState, useCallback, useRef } from "react";
import { PageText, QaResponse, PdfViewerHandle } from "@/types";
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
  const [pagesText, setPagesText] = useState<PageText[] | null>(null);
  const [textExtractionError, setTextExtractionError] = useState(false);
  const pdfRef = useRef<PdfViewerHandle>(null);

  const handleAsk = useCallback(() => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setResponse(null);
    pdfRef.current?.clearHighlights();
    // Mock delay to simulate API call
    setTimeout(() => {
      setResponse(MOCK_RESPONSE);
      setLoading(false);
    }, 1000);
  }, [question, loading]);

  const handleSelectExample = useCallback((q: string) => {
    setQuestion(q);
    setLoading(true);
    setResponse(null);
    pdfRef.current?.clearHighlights();
    setTimeout(() => {
      setResponse(MOCK_RESPONSE);
      setLoading(false);
    }, 1000);
  }, []);

  const handleClearHighlights = useCallback(() => {
    pdfRef.current?.clearHighlights();
  }, []);

  const handleEvidenceClick = useCallback((page: number, quote: string) => {
    pdfRef.current?.scrollToPage(page);
    pdfRef.current?.highlightQuote(page, quote);
  }, []);

  const handlePagesTextExtracted = useCallback((pages: PageText[]) => {
    setPagesText(pages);
    setTextExtractionError(false);
  }, []);

  const handlePagesTextError = useCallback(() => {
    setPagesText(null);
    setTextExtractionError(true);
  }, []);

  const handleFileChange = useCallback(() => {
    setPagesText([]);
    setTextExtractionError(false);
    setResponse(null);
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
          <PdfViewerPane
            ref={pdfRef}
            onPagesTextExtracted={handlePagesTextExtracted}
            onPagesTextError={handlePagesTextError}
            onFileChange={handleFileChange}
          />
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
            pagesText={pagesText}
            textExtractionError={textExtractionError}
          />
        </div>
      </div>
    </div>
  );
}
