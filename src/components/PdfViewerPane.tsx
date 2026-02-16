"use client";

import {
  ChangeEvent,
  ComponentProps,
  DragEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { PdfHighlighter, PdfLoader } from "react-pdf-highlighter";
import type { IHighlight, Scaled, ScaledPosition } from "react-pdf-highlighter/dist/types";
import { PageText, PdfViewerHandle } from "@/types";

const HIGHLIGHT_MAX_ATTEMPTS = 20;
const HIGHLIGHT_RETRY_MS = 80;

function normalizeWS(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function removeWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

function extractSignificantTokens(quote: string): string[] {
  const words = quote.match(/[a-z0-9]+/gi) ?? [];
  const deduped = Array.from(
    new Set(words.map((word) => word.toLowerCase()).filter((word) => word.length >= 4)),
  );
  return deduped.sort((a, b) => b.length - a.length).slice(0, 6);
}

interface SpanEntry {
  node: HTMLSpanElement;
  text: string;
  compactText: string;
  start: number;
  end: number;
  compactStart: number;
  compactEnd: number;
}

type ViewerHighlight = IHighlight;
type LoadedPdfDocumentProxy = Parameters<
  NonNullable<ComponentProps<typeof PdfLoader>["children"]>
>[0];

interface LoadedPdfDocumentProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  highlights: ViewerHighlight[];
  onNumPages: (count: number) => void;
  onPagesTextError?: () => void;
  onPagesTextExtracted?: (pages: PageText[]) => void;
  onScrollRefReady: (scrollTo: (highlight: ViewerHighlight) => void) => void;
  pdfDocument: LoadedPdfDocumentProxy;
}

function LoadedPdfDocument({
  containerRef,
  highlights,
  onNumPages,
  onPagesTextError,
  onPagesTextExtracted,
  onScrollRefReady,
  pdfDocument,
}: LoadedPdfDocumentProps) {
  useEffect(() => {
    onNumPages(pdfDocument.numPages);
  }, [onNumPages, pdfDocument]);

  useEffect(() => {
    let cancelled = false;

    async function extractPagesText() {
      try {
        const extractedPages: PageText[] = [];
        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
          if (cancelled) return;

          const page = await pdfDocument.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const parts: string[] = [];

          for (const item of textContent.items) {
            if ("str" in item) {
              parts.push(item.str);
            }
          }

          extractedPages.push({
            page: pageNumber,
            text: parts.join(" "),
          });
        }

        if (!cancelled) {
          onPagesTextExtracted?.(extractedPages);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("[PdfViewerPane] failed to extract page text", error);
          onPagesTextError?.();
        }
      }
    }

    extractPagesText();

    return () => {
      cancelled = true;
    };
  }, [onPagesTextError, onPagesTextExtracted, pdfDocument]);

  return (
    <div ref={containerRef} className="h-full">
      <PdfHighlighter<ViewerHighlight>
        pdfDocument={pdfDocument}
        pdfScaleValue="page-width"
        highlights={highlights}
        onScrollChange={() => {}}
        scrollRef={onScrollRefReady}
        enableAreaSelection={() => false}
        onSelectionFinished={() => null}
        highlightTransform={(highlight, index, _setTip, _hideTip, _viewportToScaled, _screenshot, isScrolledTo) => (
          <div key={`${highlight.id}-${index}`}>
            {highlight.position.rects.map((rect, rectIndex) => {
              const left = rect.left;
              const top = rect.top;
              const width = rect.width;
              const height = rect.height;

              return (
                <div
                  key={`${highlight.id}-rect-${rectIndex}`}
                  className={`evidence-highlight-part ${isScrolledTo ? "evidence-highlight-scrolled" : ""}`}
                  style={{ left, top, width, height }}
                />
              );
            })}
          </div>
        )}
      />
    </div>
  );
}

function collectSpanEntries(textLayerDiv: HTMLElement): SpanEntry[] {
  const spans = Array.from(textLayerDiv.querySelectorAll("span"));
  const entries: SpanEntry[] = [];

  let combinedLength = 0;
  let compactLength = 0;

  for (const rawSpan of spans) {
    if (!(rawSpan instanceof HTMLSpanElement)) continue;

    const text = normalizeWS(rawSpan.textContent || "").toLowerCase();
    if (!text) continue;

    const compactText = removeWhitespace(text);
    if (!compactText) continue;

    const start = combinedLength;
    const end = start + text.length;
    const compactStart = compactLength;
    const compactEnd = compactStart + compactText.length;

    entries.push({
      node: rawSpan,
      text,
      compactText,
      start,
      end,
      compactStart,
      compactEnd,
    });

    combinedLength = end + 1;
    compactLength = compactEnd;
  }

  return entries;
}

function findMatchingEntries(entries: SpanEntry[], normalizedQuote: string): SpanEntry[] {
  if (!normalizedQuote) return [];

  const combinedText = entries.map((entry) => entry.text).join(" ");
  const compactText = entries.map((entry) => entry.compactText).join("");

  const exactMatchStart = combinedText.indexOf(normalizedQuote);
  if (exactMatchStart >= 0) {
    const exactMatchEnd = exactMatchStart + normalizedQuote.length;
    return entries.filter((entry) => entry.end > exactMatchStart && entry.start < exactMatchEnd);
  }

  const compactQuote = removeWhitespace(normalizedQuote);
  const compactMatchStart = compactText.indexOf(compactQuote);
  if (compactMatchStart >= 0) {
    const compactMatchEnd = compactMatchStart + compactQuote.length;
    return entries.filter(
      (entry) => entry.compactEnd > compactMatchStart && entry.compactStart < compactMatchEnd,
    );
  }

  const tokens = extractSignificantTokens(normalizedQuote);
  if (tokens.length === 0) return [];

  const matching = new Set<SpanEntry>();
  for (const entry of entries) {
    const hasToken = tokens.some((token) => entry.text.includes(token));
    if (hasToken) {
      matching.add(entry);
    }
  }

  for (const token of tokens.map((token) => removeWhitespace(token)).filter(Boolean)) {
    let startAt = 0;
    while (startAt < compactText.length) {
      const tokenStart = compactText.indexOf(token, startAt);
      if (tokenStart < 0) break;

      const tokenEnd = tokenStart + token.length;
      for (const entry of entries) {
        if (entry.compactEnd > tokenStart && entry.compactStart < tokenEnd) {
          matching.add(entry);
        }
      }

      startAt = tokenStart + token.length;
    }
  }

  return Array.from(matching);
}

function toScaledRect(
  rect: { left: number; top: number; width: number; height: number; pageNumber: number },
  pageWidth: number,
  pageHeight: number,
): Scaled {
  return {
    x1: rect.left,
    y1: rect.top,
    x2: rect.left + rect.width,
    y2: rect.top + rect.height,
    width: pageWidth,
    height: pageHeight,
    pageNumber: rect.pageNumber,
  };
}

function buildScaledPositionFromEntries(
  entries: SpanEntry[],
  pageElement: HTMLElement,
  pageNumber: number,
): ScaledPosition | null {
  if (entries.length === 0) return null;

  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) return null;

  const rects = entries
    .map((entry) => entry.node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      left: rect.left - pageRect.left,
      top: rect.top - pageRect.top,
      width: rect.width,
      height: rect.height,
      pageNumber,
    }));

  if (rects.length === 0) return null;

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));

  const scaledRects = rects.map((rect) => toScaledRect(rect, pageRect.width, pageRect.height));
  const boundingRect = toScaledRect(
    {
      left,
      top,
      width: right - left,
      height: bottom - top,
      pageNumber,
    },
    pageRect.width,
    pageRect.height,
  );

  return {
    pageNumber,
    boundingRect,
    rects: scaledRects,
  };
}

interface PdfViewerPaneProps {
  onPagesTextExtracted?: (pages: PageText[]) => void;
  onPagesTextError?: () => void;
  onFileChange?: () => void;
}

type BuildHighlightResult =
  | { status: "ready"; highlight: ViewerHighlight }
  | { status: "retry" }
  | { status: "not_found" };

const PdfViewerPane = forwardRef<PdfViewerHandle, PdfViewerPaneProps>(
  function PdfViewerPane({ onPagesTextExtracted, onPagesTextError, onFileChange }, ref) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const viewerContainerRef = useRef<HTMLDivElement>(null);
    const objectUrlRef = useRef<string | null>(null);
    const pendingHighlightTimersRef = useRef<Map<number, number>>(new Map());
    const scrollToHighlightRef = useRef<((highlight: ViewerHighlight) => void) | null>(null);

    const onPagesTextExtractedRef = useRef(onPagesTextExtracted);
    const onPagesTextErrorRef = useRef(onPagesTextError);
    const onFileChangeRef = useRef(onFileChange);

    const [activeHighlights, setActiveHighlights] = useState<ViewerHighlight[]>([]);
    const [dragActive, setDragActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fileName, setFileName] = useState<string>("");
    const [fileUrl, setFileUrl] = useState<string | null>(null);
    const [numPages, setNumPages] = useState(0);

    useEffect(() => {
      onPagesTextExtractedRef.current = onPagesTextExtracted;
    }, [onPagesTextExtracted]);

    useEffect(() => {
      onPagesTextErrorRef.current = onPagesTextError;
    }, [onPagesTextError]);

    useEffect(() => {
      onFileChangeRef.current = onFileChange;
    }, [onFileChange]);

    const clearPendingHighlightTimers = useCallback(() => {
      for (const timerId of pendingHighlightTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      pendingHighlightTimersRef.current.clear();
    }, []);

    const clearAllHighlights = useCallback(() => {
      clearPendingHighlightTimers();
      setActiveHighlights([]);
    }, [clearPendingHighlightTimers]);

    const scrollToPageDom = useCallback((pageNumber: number) => {
      const root = viewerContainerRef.current;
      if (!root) return;

      const pageElement = root.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
      pageElement?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, []);

    const buildHighlightForQuote = useCallback((pageNumber: number, quote: string): BuildHighlightResult => {
      const root = viewerContainerRef.current;
      if (!root) return { status: "retry" };

      const pageElement = root.querySelector<HTMLElement>(`.page[data-page-number="${pageNumber}"]`);
      const textLayerDiv = pageElement?.querySelector<HTMLElement>(".textLayer");
      if (!pageElement || !textLayerDiv) {
        return { status: "retry" };
      }

      const entries = collectSpanEntries(textLayerDiv);
      if (entries.length === 0) {
        return { status: "retry" };
      }

      const normalizedQuote = normalizeWS(quote).toLowerCase();
      const matchingEntries = findMatchingEntries(entries, normalizedQuote);
      if (matchingEntries.length === 0) {
        return { status: "not_found" };
      }

      const position = buildScaledPositionFromEntries(matchingEntries, pageElement, pageNumber);
      if (!position) {
        return { status: "not_found" };
      }

      return {
        status: "ready",
        highlight: {
          id: `evidence-${pageNumber}-${Date.now()}`,
          content: {
            text: quote,
          },
          comment: {
            text: "Evidence",
            emoji: "",
          },
          position,
        },
      };
    }, []);

    const tryApplyHighlight = useCallback(
      (pageNumber: number, quote: string) => {
        const runAttempt = (attempt: number) => {
          const result = buildHighlightForQuote(pageNumber, quote);

          if (result.status === "ready") {
            setActiveHighlights([result.highlight]);
            requestAnimationFrame(() => {
              if (scrollToHighlightRef.current) {
                scrollToHighlightRef.current(result.highlight);
              } else {
                scrollToPageDom(pageNumber);
              }
            });
            return;
          }

          if (result.status === "retry" && attempt < HIGHLIGHT_MAX_ATTEMPTS) {
            const existing = pendingHighlightTimersRef.current.get(pageNumber);
            if (existing) {
              window.clearTimeout(existing);
            }

            const timerId = window.setTimeout(() => {
              pendingHighlightTimersRef.current.delete(pageNumber);
              runAttempt(attempt + 1);
            }, HIGHLIGHT_RETRY_MS);

            pendingHighlightTimersRef.current.set(pageNumber, timerId);
            return;
          }

          if (result.status === "retry") {
            console.warn("[PdfViewerPane] unable to highlight quote, page text layer not ready", {
              pageNumber,
              attempts: attempt,
            });
            return;
          }

          console.warn("[PdfViewerPane] unable to map quote to visible text", {
            pageNumber,
            quotePreview: quote.slice(0, 160),
          });
        };

        runAttempt(0);
      },
      [buildHighlightForQuote, scrollToPageDom],
    );

    const handlePagesTextError = useCallback(() => {
      onPagesTextErrorRef.current?.();
    }, []);

    const handlePagesTextExtracted = useCallback((pages: PageText[]) => {
      onPagesTextExtractedRef.current?.(pages);
    }, []);

    const handleScrollRefReady = useCallback(
      (scrollTo: (highlight: ViewerHighlight) => void) => {
        scrollToHighlightRef.current = scrollTo;
      },
      [],
    );

    const handleFile = useCallback(
      (file: File) => {
        const isPdf =
          file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

        if (!isPdf) {
          onFileChangeRef.current?.();
          onPagesTextErrorRef.current?.();
          setError("Please upload a PDF file.");
          return;
        }

        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }

        clearAllHighlights();
        setNumPages(0);

        const objectUrl = URL.createObjectURL(file);
        objectUrlRef.current = objectUrl;

        setError(null);
        setFileName(file.name);
        setFileUrl(objectUrl);
        onFileChangeRef.current?.();
      },
      [clearAllHighlights],
    );

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
        clearPendingHighlightTimers();

        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
        }
      };
    }, [clearPendingHighlightTimers]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToPage(pageNumber: number) {
          scrollToPageDom(pageNumber);
        },

        highlightQuote(pageNumber: number, quote: string) {
          const normalizedQuote = normalizeWS(quote);
          if (!normalizedQuote) return;

          clearAllHighlights();
          tryApplyHighlight(pageNumber, quote);
        },

        clearHighlights() {
          clearAllHighlights();
        },
      }),
      [clearAllHighlights, scrollToPageDom, tryApplyHighlight],
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
          <p className="text-sm font-medium text-gray-700">Drag and drop a PDF here</p>
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
        className={`relative flex h-full flex-col overflow-hidden rounded-lg border bg-gray-100 ${
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

        <div className="flex items-center justify-between border-b border-gray-200 bg-white/90 px-3 py-2 backdrop-blur">
          <div className="min-w-0 pr-3">
            <p className="truncate text-xs font-medium text-gray-700">{fileName}</p>
            {numPages > 0 && (
              <p className="text-[11px] text-gray-500">
                {numPages} page{numPages === 1 ? "" : "s"}
              </p>
            )}
          </div>
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

        <div className="relative flex-1">
          <PdfLoader
            url={fileUrl}
            beforeLoad={
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
            }
            onError={(loadError) => {
              console.error("[PdfViewerPane] PDF load error", loadError);
              setError(loadError.message || "Failed to load PDF");
              setNumPages(0);
              handlePagesTextError();
            }}
          >
            {(pdfDocument) => (
              <LoadedPdfDocument
                containerRef={viewerContainerRef}
                highlights={activeHighlights}
                onNumPages={setNumPages}
                onPagesTextError={handlePagesTextError}
                onPagesTextExtracted={handlePagesTextExtracted}
                onScrollRefReady={handleScrollRefReady}
                pdfDocument={pdfDocument}
              />
            )}
          </PdfLoader>
        </div>
      </div>
    );
  },
);

export default PdfViewerPane;
