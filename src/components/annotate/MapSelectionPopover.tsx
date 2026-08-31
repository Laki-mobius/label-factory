import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The popup that appears when a reviewer selects text on the rendered PDF
 * (see PdfTextViewer's onSelectText) — lets them assign that exact text to
 * one of the document's fields instead of retyping it. Positioned at the
 * click point rather than anchored to a trigger element, so it's a small
 * hand-built fixed-position panel rather than the shared Popover component.
 */

export type MapSelectionCandidate = {
  key: string;
  label: string;
  currentValue: string;
};

interface MapSelectionPopoverProps {
  text: string;
  x: number;
  y: number;
  candidates: MapSelectionCandidate[];
  onPick: (fieldKey: string) => void;
  onDismiss: () => void;
}

export function MapSelectionPopover({
  text,
  x,
  y,
  candidates,
  onPick,
  onDismiss,
}: MapSelectionPopoverProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onDismiss();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss]);

  // Clamp so the popup doesn't render off the right/bottom edge of the
  // viewport for a selection made near the edge of the document.
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y + 8, window.innerHeight - 320);

  return (
    <div
      ref={rootRef}
      className="fixed z-50 w-64 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg"
      style={{ left, top }}
    >
      <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Map selection to field
      </p>
      <p className="mb-2 truncate rounded bg-muted/60 px-1.5 py-1 text-xs" title={text}>
        “{text}”
      </p>
      {candidates.length === 0 ? (
        <p className="px-1 py-1 text-xs text-muted-foreground">No fields available to map to.</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {candidates.map((candidate) => (
            <li key={candidate.key}>
              <button
                type="button"
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded px-1.5 py-1 text-left text-xs hover:bg-muted",
                )}
                onClick={() => onPick(candidate.key)}
              >
                <span className="font-medium">{candidate.label}</span>
                {candidate.currentValue ? (
                  <span className="truncate text-[10px] text-muted-foreground">
                    Current: {candidate.currentValue}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Currently empty</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
