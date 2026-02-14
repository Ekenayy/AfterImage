export interface PageText {
  page: number;
  text: string;
}

export interface EvidenceItem {
  page: number;
  quote: string;
  note: string;
}

export interface QaResponse {
  answer: string;
  reasoning: string;
  confidence: "low" | "medium" | "high";
  evidence_for: EvidenceItem[];
  evidence_against: EvidenceItem[];
  missing_info: string[];
}

/** Imperative handle exposed by PdfViewerPane via forwardRef */
export interface PdfViewerHandle {
  scrollToPage: (pageNumber: number) => void;
  highlightQuote: (pageNumber: number, quote: string) => void;
  clearHighlights: () => void;
}
