import { useCallback, useEffect, useRef, useState } from "react";

import { loadPdfjs } from "@/lib/pdfjs-loader";
import { cn } from "@/lib/utils";

/**
 * Renders one page of a PDF with a real, selectable text layer on top of the
 * canvas — the browser-native `<iframe>` viewer this replaces gives React no
 * access to anything inside it, so neither of the features below was
 * possible before this component existed:
 *
 *  - `highlights`: draws a box over every given field's text that can be
 *    located on the current page — every already-extracted field gets a
 *    highlight, not just whichever one the reviewer currently has focused
 *    (that one is drawn with a stronger border so it still stands out).
 *  - `onSelectText`: fires when the reviewer selects text on the page, with
 *    the selected string and the screen position to anchor a popup at
 *    (Map Selection — assigning that text to a field).
 *
 * Deliberately renders only the current page (not the whole document at
 * once) to match how the rest of the annotate screen already paginates —
 * lighter weight than rendering every page up front.
 */

export type PdfTextSelection = {
  text: string;
  clientX: number;
  clientY: number;
};

type PageTextInfo = {
  textDivs: HTMLElement[];
  divOffsets: number[];
  pageText: string;
};

export type PdfHighlight = {
  /** Stable identity for the field this highlight belongs to — not
   *  currently used for anything but React-key-style bookkeeping by the
   *  caller; the viewer itself just uses the text. */
  id: string;
  /** Text to locate on the current page. Only ever a value already shown
   *  to this reviewer elsewhere on screen — never pass a masked/hidden
   *  sensitive value in here. */
  text: string;
  /** Draws this one with a stronger border so the reviewer can still tell
   *  which field is currently focused among all the highlighted ones. */
  active?: boolean;
};

interface PdfTextViewerProps {
  fileUrl: string;
  page: number;
  zoom: number;
  highlights?: PdfHighlight[];
  onSelectText?: (selection: PdfTextSelection) => void;
  onPageCount?: (count: number) => void;
  onError?: (message: string) => void;
  className?: string;
}

const TEXT_LAYER_STYLE = `
.pftv-textLayer {
  position: absolute;
  inset: 0;
  overflow: clip;
  opacity: 1;
  line-height: 1;
  text-align: initial;
  transform-origin: 0 0;
}
.pftv-textLayer span, .pftv-textLayer br {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}
.pftv-textLayer ::selection {
  background: rgba(37, 99, 235, 0.35);
}
`;

/** Collapses runs of whitespace to a single space, remembering for every
 *  character it kept which index in the ORIGINAL string it came from — so a
 *  match found in the collapsed text can still be translated back into raw
 *  offsets for highlighting. Handles the common case where a stored
 *  evidence/value string has different spacing than the PDF's own text
 *  layer (line wraps, extra spaces from column layouts, etc). */
function collapseWhitespace(input: string): { collapsed: string; map: number[] } {
  let collapsed = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      if (!lastWasSpace && collapsed.length > 0) {
        collapsed += " ";
        map.push(i);
      }
      lastWasSpace = true;
    } else {
      collapsed += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }
  return { collapsed, map };
}

/** Finds `needle` inside `haystack`, trying an exact case-insensitive match
 *  first and falling back to a whitespace-insensitive match. Returns raw
 *  character offsets into `haystack` either way, or null if not found. */
function findTextRange(haystack: string, needle: string): { start: number; end: number } | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;

  const directIdx = haystack.toLowerCase().indexOf(trimmed.toLowerCase());
  if (directIdx >= 0) return { start: directIdx, end: directIdx + trimmed.length };

  const { collapsed, map } = collapseWhitespace(haystack);
  const { collapsed: collapsedNeedle } = collapseWhitespace(trimmed);
  if (!collapsedNeedle || map.length === 0) return null;
  const idx = collapsed.toLowerCase().indexOf(collapsedNeedle.toLowerCase());
  if (idx < 0) return null;
  const endIdx = idx + collapsedNeedle.length - 1;
  if (endIdx >= map.length) return null;
  return { start: map[idx]!, end: map[endIdx]! + 1 };
}

/** Paints a highlight box over every text div that overlaps a located
 *  match, for every highlight in the list — simple and robust: each
 *  pdf.js text div is already correctly positioned for its own line, so we
 *  don't need to compute sub-div pixel ranges. Uses a solid yellow with a
 *  multiply blend so it reads as a real highlighter stripe (see below); the
 *  active field (if any) gets a slightly deeper shade and draws on top so
 *  it still stands out among every other already-extracted field's
 *  highlight. */
function paintHighlights(container: HTMLElement, overlay: HTMLElement, info: PageTextInfo, highlights: PdfHighlight[]) {
  overlay.innerHTML = "";
  const containerRect = container.getBoundingClientRect();
  const ordered = [...highlights].sort((a, b) => Number(!!a.active) - Number(!!b.active));
  for (const highlight of ordered) {
    if (!highlight.text || !highlight.text.trim()) continue;
    const range = findTextRange(info.pageText, highlight.text);
    if (!range) continue;
    for (let i = 0; i < info.textDivs.length; i++) {
      const div = info.textDivs[i]!;
      const divStart = info.divOffsets[i]!;
      const divEnd = divStart + (div.textContent ?? "").length;
      if (divEnd <= range.start || divStart >= range.end) continue;
      const rect = div.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.left = `${rect.left - containerRect.left}px`;
      box.style.top = `${rect.top - containerRect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      // Solid, opaque, PURE yellow (not a warmer gold/amber Tailwind
      // shade — that's what read as "amber" before) with a "multiply"
      // blend against whatever's underneath (the canvas) — the classic
      // text-highlighter look: black text stays black and fully legible
      // (black × any color = black), while the yellow reads as a flat
      // highlighter stripe rather than a translucent box with a border.
      // Same color for every field so the hue never drifts; the active
      // field is marked with a thin dark outline instead of a different
      // shade, so it stays distinguishable without warming the color.
      box.style.mixBlendMode = "multiply";
      box.style.background = "#ffff00";
      if (highlight.active) {
        box.style.outline = "1.5px solid rgba(0, 0, 0, 0.55)";
        box.style.outlineOffset = "-1px";
        box.style.zIndex = "1";
      }
      overlay.appendChild(box);
    }
  }
}

export function PdfTextViewer({
  fileUrl,
  page,
  zoom,
  highlights,
  onSelectText,
  onPageCount,
  onError,
  className,
}: PdfTextViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pageWrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<any>(null);
  const pageInfoRef = useRef<PageTextInfo | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the document once per fileUrl. Bytes are fetched directly (rather
  // than handing pdfjs the URL to fetch itself) so we don't depend on the
  // storage host supporting HTTP range requests.
  useEffect(() => {
    let cancelled = false;
    pdfDocRef.current = null;
    setLoading(true);

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`Could not download the document (${response.status}).`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        pdfDocRef.current = doc;
        onPageCount?.(doc.numPages);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          onError?.(e instanceof Error ? e.message : "Failed to load the document.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      const doc = pdfDocRef.current;
      pdfDocRef.current = null;
      void doc?.destroy?.().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // Render the current page whenever the document, page number, or zoom
  // changes.
  useEffect(() => {
    if (loading) return;
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    const textLayerEl = textLayerRef.current;
    const highlightLayerEl = highlightLayerRef.current;
    const pageWrap = pageWrapRef.current;
    if (!doc || !canvas || !textLayerEl || !highlightLayerEl || !pageWrap) return;

    let cancelled = false;

    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const boundedPage = Math.max(1, Math.min(page, doc.numPages));
        const pdfPage = await doc.getPage(boundedPage);
        if (cancelled) return;

        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const availableWidth = Math.max(320, (rootRef.current?.clientWidth ?? 800) - 24);
        const fitScale = availableWidth / baseViewport.width;
        const scale = Math.max(0.4, Math.min(3.5, fitScale)) * (zoom / 100);
        const viewport = pdfPage.getViewport({ scale });
        const outputScale = Math.max(1, window.devicePixelRatio || 1);

        // pdf.js's TextLayer positions and sizes every (invisible,
        // selectable) text span using `calc(var(--scale-factor) * ...)` —
        // it expects the page container to define this custom property
        // itself; it does NOT set it automatically. Without it, that calc()
        // is invalid, so spans fall back to default sizing and drift away
        // from the visible canvas text — which is what made highlighting
        // land inconsistently and made manual text selection grab the wrong
        // characters. Must be set before constructing TextLayer below, and
        // on an ancestor of the text layer so it inherits down to it.
        pageWrap.style.setProperty("--scale-factor", String(viewport.scale));

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textLayerEl.style.width = `${viewport.width}px`;
        textLayerEl.style.height = `${viewport.height}px`;
        highlightLayerEl.style.width = `${viewport.width}px`;
        highlightLayerEl.style.height = `${viewport.height}px`;
        textLayerEl.innerHTML = "";
        highlightLayerEl.innerHTML = "";

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not render this page.");
        await pdfPage.render({
          canvasContext: ctx,
          viewport,
          canvas,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        }).promise;
        if (cancelled) return;

        const textContent = await pdfPage.getTextContent();
        const textLayerBuilder = new (pdfjs as any).TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport,
        });
        await textLayerBuilder.render();
        if (cancelled) return;

        const textDivs = (textLayerBuilder.textDivs ?? []) as HTMLElement[];
        let cursor = 0;
        const divOffsets = textDivs.map((div) => {
          const start = cursor;
          cursor += (div.textContent ?? "").length;
          return start;
        });
        const pageText = textDivs.map((div) => div.textContent ?? "").join("");
        pageInfoRef.current = { textDivs, divOffsets, pageText };

        setDims({ width: viewport.width, height: viewport.height });

        if (highlights && highlights.length > 0 && pageWrapRef.current) {
          paintHighlights(pageWrapRef.current, highlightLayerEl, pageInfoRef.current, highlights);
        }
      } catch (e) {
        if (!cancelled) onError?.(e instanceof Error ? e.message : "Failed to render this page.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, page, zoom, fileUrl]);

  // Re-paint the highlights when the list changes but the page itself
  // doesn't need a re-render (e.g. switching which field is active, or a
  // value being edited/reviewed). Pass a referentially-stable array from
  // the caller (e.g. useMemo) so this doesn't fire on every render.
  useEffect(() => {
    const info = pageInfoRef.current;
    const overlay = highlightLayerRef.current;
    const container = pageWrapRef.current;
    if (!info || !overlay || !container) return;
    overlay.innerHTML = "";
    if (highlights && highlights.length > 0) paintHighlights(container, overlay, info, highlights);
  }, [highlights]);

  const handleMouseUp = useCallback(
    (event: React.MouseEvent) => {
      if (!onSelectText) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString().trim();
      if (!text) return;
      onSelectText({ text, clientX: event.clientX, clientY: event.clientY });
      sel.removeAllRanges();
    },
    [onSelectText],
  );

  return (
    <div ref={rootRef} className={cn("relative h-full w-full overflow-auto", className)}>
      <style>{TEXT_LAYER_STYLE}</style>
      {loading ? (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading document…
        </div>
      ) : (
        <div
          ref={pageWrapRef}
          className="relative mx-auto my-2 bg-white shadow-sm"
          style={dims ? { width: dims.width, height: dims.height } : undefined}
        >
          <canvas ref={canvasRef} />
          <div ref={textLayerRef} className="pftv-textLayer" onMouseUp={handleMouseUp} />
          <div ref={highlightLayerRef} className="pointer-events-none absolute inset-0" />
        </div>
      )}
    </div>
  );
}
