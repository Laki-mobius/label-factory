import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type QueueDoc = {
  documentId: string;
  filename: string;
  batchName: string;
  done: number;
  total: number;
};

type DocQueueProps = {
  mode: "feedback" | "preference";
  docs: QueueDoc[];
  isLoading: boolean;
  activeDocumentId: string | null;
  onSelectDocument: (documentId: string) => void;
  selectedIds: string[];
  onToggleSelect: (documentId: string) => void;
  onToggleSelectAll: () => void;
  onBulkDraft: () => void;
  bulkBusy: boolean;
};

/**
 * Shared document queue for the Corrections and Preference tabs: a scoped
 * list of documents with a completion badge, multi-select, and a bulk
 * "Reward AI" action across the current selection.
 */
export function DocQueue({
  mode,
  docs,
  isLoading,
  activeDocumentId,
  onSelectDocument,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onBulkDraft,
  bulkBusy,
}: DocQueueProps) {
  const allSelected = docs.length > 0 && selectedIds.length === docs.length;

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <Checkbox
          checked={allSelected}
          onCheckedChange={onToggleSelectAll}
          disabled={docs.length === 0}
          aria-label="Select all documents"
        />
        <p className="text-xs font-medium">
          {mode === "feedback" ? "Corrections queue" : "Preference queue"}
        </p>
        <span className="ml-auto text-2xs text-muted-foreground">{docs.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : docs.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            {mode === "feedback"
              ? "No corrected fields waiting on a reason yet."
              : "No extracted fields available for comparison yet."}
          </p>
        ) : (
          <ul>
            {docs.map((doc) => {
              const ready = doc.total > 0 && doc.done === doc.total;
              return (
                <li key={doc.documentId}>
                  <div
                    className={cn(
                      "flex w-full items-start gap-2 border-b border-border/40 px-3 py-2 text-left transition-colors hover:bg-accent",
                      activeDocumentId === doc.documentId && "bg-accent",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedIds.includes(doc.documentId)}
                      onCheckedChange={() => onToggleSelect(doc.documentId)}
                      aria-label={`Select ${doc.filename}`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onSelectDocument(doc.documentId)}
                    >
                      <p className="truncate text-xs font-medium">{doc.filename}</p>
                      <p className="truncate text-2xs text-muted-foreground">{doc.batchName}</p>
                    </button>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium",
                        ready
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : doc.done > 0
                            ? "bg-primary-soft text-primary-soft-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {ready ? "Ready" : `${doc.done}/${doc.total}`}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border/60 p-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-full text-xs"
          disabled={selectedIds.length === 0 || bulkBusy}
          onClick={onBulkDraft}
        >
          {bulkBusy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          Draft &amp; save {selectedIds.length || ""} selected
        </Button>
      </div>
    </div>
  );
}
