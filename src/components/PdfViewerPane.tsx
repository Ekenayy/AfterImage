"use client";

import {
  ChangeEvent,
  DragEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist/types/src/display/api";
import { PageText, PdfViewerHandle } from "@/types";

const SCALE = 1.5;
const PDF_WORKER_SRC = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** Normalize whitespace so we can fuzzy-match quotes against text layer spans. */
function normalizeWS(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

interface PdfViewerPaneProps {
  onPagesTextExtracted?: (pages: PageText[]) => void;
  onPagesTextError?: () => void;
  onFileChange?: () => void;
}

const PdfViewerPane = forwardRef<PdfViewerHandle, PdfViewerPaneProps>(
  function PdfViewerPane({ onPagesTextExtracted, onPagesTextError, onFileChange }, ref) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const objectUrlRef = useRef<string | null>(null);
  const onPagesTextExtractedRef = useRef(onPagesTextExtracted);
  onPagesTextExtractedRef.current = onPagesTextExtracted;
  const onPagesTextErrorRef = useRef(onPagesTextError);
  onPagesTextErrorRef.current = onPagesTextError;
  const onFileChangeRef = useRef(onFileChange);
  onFileChangeRef.current = onFileChange;
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [dragActive, setDragActive] = useState(false);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback((file: File) => {
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setError("Please upload a PDF file.");
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(file);
    objectUrlRef.current = objectUrl;

    setFileUrl(objectUrl);
    setFileName(file.name);
    setNumPages(0);
    setError(null);
    textLayerRefs.current.clear();
    onFileChangeRef.current?.();
  }, []);

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        handleFile(file);
      }
      event.target.value = "";
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const file = event.dataTransfer.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  // Render all pages for the selected PDF file
  useEffect(() => {
    if (!fileUrl) return;
    const selectedUrl = fileUrl;

    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let pdfDoc: PDFDocumentProxy | null = null;

    async function renderPdf() {
      setLoading(true);
      setError(null);
      try {
        // Dynamic import to avoid SSR issues — pdfjs-dist uses DOM globals
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

        loadingTask = pdfjsLib.getDocument(selectedUrl);
        const loadedPdfDoc = await loadingTask.promise;
        if (cancelled) {
          void loadedPdfDoc.destroy();
          return;
        }
        pdfDoc = loadedPdfDoc;

        setNumPages(pdfDoc.numPages);
        textLayerRefs.current.clear();

        // Wait one tick so React renders page wrappers for the selected file
        await new Promise((r) => setTimeout(r, 0));

        const extractedPages: PageText[] = [];

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale: SCALE });

          const pageDiv = pageRefs.current.get(i);
          if (!pageDiv) continue;
          pageDiv.innerHTML = "";

          // Canvas
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = "block";
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          pageDiv.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;

          // Text layer
          const textContent = await page.getTextContent();
          const textLayerDiv = document.createElement("div");
          textLayerDiv.className = "textLayer";
          textLayerDiv.style.width = `${viewport.width}px`;
          textLayerDiv.style.height = `${viewport.height}px`;
          pageDiv.appendChild(textLayerDiv);
          textLayerRefs.current.set(i, textLayerDiv);

          // Collect plain text for this page
          const pageTextParts: string[] = [];

          // Render each text item as a positioned span
          for (const item of textContent.items) {
            if (!("str" in item)) continue;
            pageTextParts.push(item.str);

            const span = document.createElement("span");
            span.textContent = item.str;

            const tx = pdfjsLib.Util.transform(
              viewport.transform,
              item.transform,
            );
            const fontHeight = Math.hypot(tx[2], tx[3]);
            const left = tx[4];
            const top = tx[5] - fontHeight;

            span.style.left = `${left}px`;
            span.style.top = `${top}px`;
            span.style.fontSize = `${fontHeight}px`;
            span.style.fontFamily = item.fontName || "sans-serif";

            if (item.width) {
              const scaledWidth = item.width * viewport.scale;
              span.style.width = `${scaledWidth}px`;
            }

            textLayerDiv.appendChild(span);
          }

          extractedPages.push({
            page: i,
            text: pageTextParts.join(" "),
          });
        }

        if (!cancelled) {
          onPagesTextExtractedRef.current?.(extractedPages);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("PDF load error:", err);
          setError(err instanceof Error ? err.message : "Failed to load PDF");
          setNumPages(0);
          onPagesTextErrorRef.current?.();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    renderPdf();
    return () => {
      cancelled = true;
      if (loadingTask) {
        Promise.resolve(loadingTask.destroy()).catch(() => {
          // Ignore cancellation race errors during effect cleanup.
        });
      }
      if (pdfDoc) {
        void pdfDoc.destroy();
      }
    };
  }, [fileUrl]);

  // Imperative API
  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(pageNumber: number) {
        const pageDiv = pageRefs.current.get(pageNumber);
        if (pageDiv) {
          pageDiv.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      },

      highlightQuote(pageNumber: number, quote: string) {
        const textLayerDiv = textLayerRefs.current.get(pageNumber);
        if (!textLayerDiv) return;

        const normalizedQuote = normalizeWS(quote).toLowerCase();
        const spans = textLayerDiv.querySelectorAll("span");

        // Strategy 1: Try to find a single span that contains the quote
        for (const span of spans) {
          const spanText = normalizeWS(span.textContent || "").toLowerCase();
          if (spanText.includes(normalizedQuote)) {
            span.classList.add("pdf-highlight");
            return;
          }
        }

        // Strategy 2: Multi-span matching — concatenate consecutive spans
        // and highlight the range that covers the quote
        const spanArray = Array.from(spans);
        for (let start = 0; start < spanArray.length; start++) {
          let combined = "";
          for (let end = start; end < spanArray.length; end++) {
            const t = normalizeWS(spanArray[end].textContent || "");
            combined = combined ? combined + " " + t : t;

            if (combined.toLowerCase().includes(normalizedQuote)) {
              for (let k = start; k <= end; k++) {
                spanArray[k].classList.add("pdf-highlight");
              }
              return;
            }

            // Stop if combined text is already much longer than the quote
            if (combined.length > normalizedQuote.length * 3) break;
          }
        }

        // Strategy 3: Token-based fallback — highlight spans that share
        // significant tokens with the quote
        const quoteTokens = normalizedQuote
          .split(/\s+/)
          .filter((t) => t.length > 3);
        if (quoteTokens.length === 0) return;

        for (const span of spans) {
          const spanText = normalizeWS(span.textContent || "").toLowerCase();
          const matchCount = quoteTokens.filter((token) =>
            spanText.includes(token),
          ).length;
          if (matchCount >= Math.min(2, quoteTokens.length)) {
            span.classList.add("pdf-highlight");
          }
        }
      },

      clearHighlights() {
        for (const textLayerDiv of textLayerRefs.current.values()) {
          const highlighted = textLayerDiv.querySelectorAll(".pdf-highlight");
          for (const el of highlighted) {
            el.classList.remove("pdf-highlight");
          }
        }
      },
    }),
    [],
  );

  if (error) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 text-center"
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <div className="text-red-600">
          <p className="text-sm font-medium">Unable to load PDF</p>
          <p className="mt-1 text-xs">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Choose PDF
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  if (!fileUrl) {
    return (
      <div
        className={`flex h-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragActive
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400"
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        <p className="text-sm font-medium text-gray-700">
          Drag and drop a PDF here
        </p>
        <p className="mt-1 text-xs text-gray-500">or click to browse files</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative h-full overflow-y-auto rounded-lg border bg-gray-100 ${
        dragActive ? "border-blue-500" : "border-gray-200"
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-blue-50/70">
          <p className="rounded-md border border-blue-400 bg-white px-3 py-1.5 text-xs font-medium text-blue-700">
            Drop PDF to replace current file
          </p>
        </div>
      )}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/90 px-3 py-2 backdrop-blur">
        <p className="truncate pr-3 text-xs font-medium text-gray-700">
          {fileName}
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          Replace PDF
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
      {loading && numPages === 0 && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center text-gray-400">
            <svg
              className="mx-auto mb-3 h-8 w-8 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <p className="text-sm font-medium">Loading PDF…</p>
          </div>
        </div>
      )}

      {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
        <div key={pageNum} className="mb-4 last:mb-0">
          <div className="mx-auto mb-1 w-fit text-xs font-medium text-gray-500">
            Page {pageNum} of {numPages}
          </div>
          <div
            ref={(el) => {
              if (el) {
                pageRefs.current.set(pageNum, el);
              } else {
                pageRefs.current.delete(pageNum);
                textLayerRefs.current.delete(pageNum);
              }
            }}
            className="relative mx-auto bg-white shadow-md"
            style={{ width: "fit-content" }}
          />
        </div>
      ))}
    </div>
  );
});

export default PdfViewerPane;
