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
