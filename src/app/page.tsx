"use client";

import { useState, useCallback, useRef } from "react";
import { askQuestion } from "@/lib/askQuestion";
import { PageText, QaResponse, PdfViewerHandle } from "@/types";
import Header from "@/components/Header";
import PdfViewerPane from "@/components/PdfViewerPane";
import QaPane from "@/components/QaPane";

export default function Home() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QaResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [pagesText, setPagesText] = useState<PageText[] | null>(null);
  const [textExtractionError, setTextExtractionError] = useState(false);
  const pdfRef = useRef<PdfViewerHandle>(null);
  const documentVersionRef = useRef(0);

  const handleAsk = useCallback(async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || loading || !pagesText || pagesText.length === 0) {
      return;
    }
    const versionAtAskStart = documentVersionRef.current;

    setLoading(true);
    setResponse(null);
    setAskError(null);
    pdfRef.current?.clearHighlights();

    try {
      const nextResponse = await askQuestion(trimmedQuestion, pagesText);
      if (versionAtAskStart !== documentVersionRef.current) {
        console.debug("[Home] ignoring stale ask response after document change", {
          versionAtAskStart,
          currentVersion: documentVersionRef.current,
        });
        return;
      }
      setResponse(nextResponse);

      const firstEvidence = nextResponse.evidence_for[0];
      if (firstEvidence) {
        console.debug("[Home] auto-highlight first evidence", {
          page: firstEvidence.page,
          quotePreview: firstEvidence.quote.slice(0, 120),
          quoteLength: firstEvidence.quote.length,
        });
        requestAnimationFrame(() => {
          pdfRef.current?.scrollToPage(firstEvidence.page);
          pdfRef.current?.highlightQuote(firstEvidence.page, firstEvidence.quote);
        });
      }
    } catch (err) {
      setAskError(
        err instanceof Error
          ? err.message
          : "Unable to analyze this document right now. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [question, loading, pagesText]);

  const handleSelectExample = useCallback((q: string) => {
    setQuestion(q);
    setResponse(null);
    setAskError(null);
    pdfRef.current?.clearHighlights();
  }, []);

  const handleClearHighlights = useCallback(() => {
    pdfRef.current?.clearHighlights();
  }, []);

  const handleEvidenceClick = useCallback((page: number, quote: string) => {
    console.debug("[Home] evidence clicked", {
      page,
      quotePreview: quote.slice(0, 120),
      quoteLength: quote.length,
      hasPdfRef: Boolean(pdfRef.current),
    });
    pdfRef.current?.scrollToPage(page);
    pdfRef.current?.highlightQuote(page, quote);
  }, []);

  const handlePagesTextExtracted = useCallback((pages: PageText[]) => {
    setPagesText(pages);
    setTextExtractionError(false);
    setAskError(null);
  }, []);

  const handlePagesTextError = useCallback(() => {
    setPagesText(null);
    setTextExtractionError(true);
    setAskError(null);
  }, []);

  const handleFileChange = useCallback(() => {
    documentVersionRef.current += 1;
    console.debug("[Home] file changed", {
      documentVersion: documentVersionRef.current,
    });
    setPagesText([]);
    setTextExtractionError(false);
    setResponse(null);
    setAskError(null);
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
            errorMessage={askError}
          />
        </div>
      </div>
    </div>
  );
}
