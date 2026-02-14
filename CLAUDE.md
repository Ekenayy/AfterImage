# Project: Document Q&A with Evidence Highlighting

## Goal
Build a web app where a user asks a question about a single 7-page PDF and gets:
1) An answer + brief reasoning
2) Evidence quotes with page numbers (verbatim from the PDF text)
3) The PDF displayed with the evidence highlighted in red, auto-navigating to relevant pages

## Key requirement
The app must "reason over the document" and cite direct quotes (verbatim evidence) that support the answer. Quotes may not match the question wording; the model must map semantics -> quotes.

## Conditional counter-evidence
Only include "evidence_against" if the document contains conflicting/contradictory evidence relevant to the question. Otherwise omit it or return an empty array.

## Non-goals
- No RAG/vector DB/embeddings
- No scalability requirements
- No multi-document support
- No OCR (assume selectable text)
- No auth (optional)

## Architecture
Frontend:
- Next.js (App Router) + TypeScript
- PDF.js (`pdfjs-dist`) renders PDF with text layer
- Extract per-page text via PDF.js `getTextContent()`
- UI: split layout with PDF viewer (left) and Q&A panel (right)

Backend (minimal):
- Supabase Edge Function `ask-doc` calls Gemini and enforces:
  - strict JSON output
  - quote verification (quotes must exist in provided page text after normalization)
  - optional retry if quotes are not verifiable

Gemini API key is stored as Supabase secret.

## Request/Response contract
Client -> Edge:
{
  "question": "string",
  "pages": [{ "page": 1, "text": "..." }, ...],
  "maxEvidence": 3
}

Edge -> Client:
{
  "answer": "string",
  "reasoning": "string",
  "confidence": "low|medium|high",
  "evidence_for": [
    { "page": number, "quote": "string", "note": "string" }
  ],
  "evidence_against": [
    { "page": number, "quote": "string", "note": "string" }
  ],
  "missing_info": ["string"]
}

Rules:
- Quotes must be exact substrings of the provided page text AFTER whitespace normalization.
- If conflicting evidence exists, include evidence_against. If not, evidence_against should be [].
- Keep quotes short (<= 180 chars), and include the key terms.
- If no evidence exists, answer must say so and put details in missing_info.

## UX / User interactions
- User sees PDF on left and Q&A panel on right.
- User types a question and clicks "Ask".
- While loading: show spinner + disable button.
- On response:
  - Show answer + reasoning.
  - Show evidence cards.
  - Clicking an evidence card jumps to that page and highlights the quote in red.
- Provide a "Clear highlights" action.
- Provide a "Examples" dropdown with 3 canned questions.

## Highlighting strategy
Use PDF.js text layer (DOM spans). Highlight quotes by:
- Normalizing whitespace and doing best-effort token highlight in spans.
- If exact quote mapping is difficult due to span fragmentation, highlight significant tokens from the quote and show the exact quote in the side panel as authoritative evidence.

## Acceptance criteria
- PDF renders with correct pagination (7 pages).
- Ask a question; receive answer + reasoning.
- Evidence_for contains at least 1 verified quote + page number for supported answers.
- Clicking evidence navigates and highlights.
- Conflicting evidence triggers evidence_against; otherwise it’s empty.
- Deployed to Vercel; edge function deployed to Supabase.