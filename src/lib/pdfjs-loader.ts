/**
 * Lazy, browser-only loader for pdfjs-dist. Import this only from inside a
 * useEffect (never at module top-level of a route) — pdfjs touches `window`/
 * `Worker` and this app is server-rendered, so importing it eagerly would
 * break SSR. Also configures the worker script exactly once per session.
 *
 * This is the foundation the on-document PDF viewer (PdfTextViewer) is built
 * on: pdfjs gives us a real text layer (not just pixels), which is what
 * makes locating a field's evidence on the page — and letting a reviewer
 * select text on the page to map it to a field — possible at all. The
 * previous viewer was a plain `<iframe>` pointed at the browser's built-in
 * PDF renderer, which has none of that: React can't see anything inside it.
 */

let modulePromise: Promise<typeof import("pdfjs-dist")> | null = null;

export async function loadPdfjs() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return modulePromise;
}
