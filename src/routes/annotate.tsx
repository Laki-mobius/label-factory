import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Minus,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { PdfTextViewer, type PdfTextSelection } from "@/components/annotate/PdfTextViewer";
import { MapSelectionPopover } from "@/components/annotate/MapSelectionPopover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { isSensitiveValue, maskForDisplay, sensitiveKeySet } from "@/lib/redact";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/annotate")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Review AI pre-labels against the source document and correct extracted field values.",
      },
      { property: "og:title", content: "Annotate & Label — LabelFactory" },
      {
        property: "og:description",
        content:
          "Review AI pre-labels against the source document and correct extracted field values.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AnnotateRoute,
});

const READY_STATES = ["prelabeled", "in_review"];

type ExtractionRow = {
  id: string;
  field_key: string;
  field_label: string | null;
  data_type: string;
  suggested_value: string | null;
  final_value: string | null;
  confidence: number | null;
  evidence_snippet: string | null;
  evidence_page: number | null;
  review_state: string;
  /** Automatic PII-scan result for THIS document's value (see
   *  src/lib/pii-scan.server.ts) — independent of, and combined with, the
   *  label profile's manual per-field Sensitive flag via isSensitiveValue. */
  pii_detected: boolean;
  pii_types: string[];
};

type LineItem = { description: string; quantity: string; price: string; amount: string };

function confidenceTone(confidence: number) {
  if (confidence >= 0.8) return "bg-primary/12 text-primary";
  if (confidence >= 0.5) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-destructive/12 text-destructive";
}

function parseLineItems(raw: string | null): LineItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((row) => ({
        description: String((row as LineItem)?.description ?? ""),
        quantity: String((row as LineItem)?.quantity ?? ""),
        price: String((row as LineItem)?.price ?? ""),
        amount: String((row as LineItem)?.amount ?? ""),
      }));
    }
  } catch {
    /* value was plain text */
  }
  return raw
    .split(/\n|;/)
    .filter((line) => line.trim())
    .map((line) => ({ description: line.trim(), quantity: "", price: "", amount: "" }));
}

function AnnotateRoute() {
  return (
    <SectionPage
      title="Annotate & Label"
      description="Review AI-suggested values side by side with source evidence, then approve, correct, or reject each field."
    >
      <AnnotateBody />
    </SectionPage>
  );
}

function AnnotateBody() {
  const { projectId, batchId, setBatchId } = useWorkspace();
  const queryClient = useQueryClient();
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [queueOpen, setQueueOpen] = useState(true);
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  // Map Selection: the reviewer selected text on the rendered PDF and this
  // popup is asking which field to assign it to. Null when no selection is
  // pending. See PdfTextViewer's onSelectText / MapSelectionPopover.
  const [selectionPopup, setSelectionPopup] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  // If the PDF.js-based viewer can't load this particular file (CORS,
  // corrupt/unusual PDF, etc.) fall back to the plain browser-native
  // iframe viewer rather than showing the reviewer a dead panel — they lose
  // on-document highlighting and Map Selection for that one document, but
  // can still see and review it.
  const [pdfViewerFailed, setPdfViewerFailed] = useState(false);
  useEffect(() => {
    setPdfViewerFailed(false);
  }, [documentId]);

  const batchesQuery = useQuery({
    queryKey: ["annotate-batches", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, name, label_profile_id")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const batches = batchesQuery.data ?? [];
  const activeBatch = batches.find((batch) => batch.id === batchId) ?? batches[0] ?? null;
  const activeBatchId = activeBatch?.id ?? null;

  const profileQuery = useQuery({
    queryKey: ["annotate-profile", activeBatch?.label_profile_id],
    enabled: Boolean(activeBatch?.label_profile_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_profiles")
        .select("id, name, version, status, fields")
        .eq("id", activeBatch!.label_profile_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const documentsQuery = useQuery({
    queryKey: ["annotate-documents", activeBatchId],
    enabled: Boolean(activeBatchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, filename, file_type, page_count, status, storage_path")
        .eq("batch_id", activeBatchId!)
        .order("uploaded_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const allDocuments = documentsQuery.data ?? [];
  const queue = allDocuments.filter((doc) => READY_STATES.includes(doc.status));
  const reviewedCount = allDocuments.filter((doc) =>
    ["approved", "rejected"].includes(doc.status),
  ).length;

  // Keep a valid selection whenever the queue changes.
  useEffect(() => {
    if (queue.length === 0) {
      setDocumentId(null);
      return;
    }
    if (!documentId || !queue.some((doc) => doc.id === documentId)) {
      setDocumentId(queue[0]!.id);
    }
  }, [queue, documentId]);

  const activeDocument = allDocuments.find((doc) => doc.id === documentId) ?? null;

  const extractionsQuery = useQuery({
    queryKey: ["annotate-extractions", documentId],
    enabled: Boolean(documentId),
    queryFn: async (): Promise<ExtractionRow[]> => {
      const { data, error } = await supabase
        .from("extractions")
        .select(
          "id, field_key, field_label, data_type, suggested_value, final_value, confidence, evidence_snippet, evidence_page, review_state, pii_detected, pii_types",
        )
        .eq("document_id", documentId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ExtractionRow[];
    },
  });

  const fileUrlQuery = useQuery({
    queryKey: ["annotate-file", activeDocument?.storage_path],
    enabled: Boolean(activeDocument?.storage_path),
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(activeDocument!.storage_path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const extractions = useMemo(() => extractionsQuery.data ?? [], [extractionsQuery.data]);

  const bucketByKey = useMemo(() => {
    const map = new Map<string, string>();
    const fields = (profileQuery.data?.fields ?? []) as { key: string; bucket?: string }[];
    if (Array.isArray(fields)) {
      for (const field of fields) map.set(field.key, field.bucket ?? "Miscellaneous");
    }
    return map;
  }, [profileQuery.data]);

  // Fields the label profile marks Sensitive get their value and evidence
  // masked by default — a reviewer can still reveal one to do their job, but
  // the reveal never persists or leaves this screen (see src/lib/redact.ts).
  // This is the static, profile-level signal; combined per-row below with
  // each extraction's own automatic pii_detected flag via isSensitiveValue,
  // so a field the profile didn't pre-flag still gets masked when this
  // document's actual value turned out to contain PII.
  const sensitiveKeys = useMemo(
    () => sensitiveKeySet(profileQuery.data?.fields),
    [profileQuery.data],
  );
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    setRevealedKeys(new Set());
  }, [documentId]);
  function toggleRevealed(fieldKey: string) {
    setRevealedKeys((current) => {
      const next = new Set(current);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  }

  // Bucket names are dynamic (AI-invented per document type — see
  // field-suggest.server.ts), so there is no fixed order to sort by. `groups`
  // is a Map, which preserves insertion order, and `extractions` is already
  // queried ordered by created_at ascending, so buckets naturally come out in
  // the same order fields were added to the schema.
  const grouped = useMemo(() => {
    const groups = new Map<string, ExtractionRow[]>();
    for (const row of extractions) {
      const bucket = bucketByKey.get(row.field_key) ?? "Miscellaneous";
      groups.set(bucket, [...(groups.get(bucket) ?? []), row]);
    }
    return [...groups.entries()];
  }, [extractions, bucketByKey]);

  const valueOf = (row: ExtractionRow) =>
    drafts[row.id] ?? row.final_value ?? row.suggested_value ?? "";

  const duplicateValues = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of extractions) {
      const value = valueOf(row).trim().toLowerCase();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractions, drafts]);

  const reviewedFields = extractions.filter((row) => row.review_state !== "pending").length;

  const saveField = useMutation({
    mutationFn: async (input: { id: string; patch: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("extractions")
        .update({ ...input.patch, reviewed_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["annotate-extractions", documentId] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const removeFromSchema = useMutation({
    mutationFn: async (fieldKey: string) => {
      const profile = profileQuery.data;
      if (!profile) throw new Error("No label profile is mapped to this batch.");
      if (profile.status === "published") {
        throw new Error(
          "This profile version is published and immutable. Fork a draft in Label Profile to change its schema.",
        );
      }
      const fields = ((profile.fields ?? []) as { key: string }[]).filter(
        (field) => field.key !== fieldKey,
      );
      const { error } = await supabase
        .from("label_profiles")
        .update({ fields: fields as never })
        .eq("id", profile.id);
      if (error) throw error;
      await supabase.from("extractions").delete().eq("document_id", documentId!).eq("field_key", fieldKey);
    },
    onSuccess: () => {
      toast.success("Field removed from the schema");
      void queryClient.invalidateQueries({ queryKey: ["annotate-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["annotate-extractions", documentId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      const { error } = await supabase
        .from("documents")
        .update({ status: decision })
        .eq("id", documentId!);
      if (error) throw error;
      return decision;
    },
    onSuccess: (decision) => {
      const remaining = queue.filter((doc) => doc.id !== documentId);
      toast.success(
        decision === "approved" ? "Document approved" : "Document rejected",
        { description: "Corrected fields were saved as training pairs." },
      );
      setDocumentId(remaining[0]?.id ?? null);
      setDrafts({});
      void queryClient.invalidateQueries({ queryKey: ["annotate-documents", activeBatchId] });
      void queryClient.invalidateQueries({ queryKey: ["project-dashboard", projectId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // "Approved" replaces the old separate Reviewed + Lock buttons: it both
  // confirms the field's value (accepted/corrected, same as before) AND
  // freezes its input (see the `disabled` checks below), so a field can't
  // be accidentally edited again after it's been approved — the one thing
  // Lock used to do on its own. Nothing downstream (RLHF, Reward AI,
  // Benchmarking) ever branched on the old "locked" state, so folding it
  // into this single action changes nothing for them except making sure a
  // corrected-then-approved field always lands as "corrected" (previously,
  // clicking Lock instead of Reviewed after an edit silently kept it out
  // of Reward AI's correction-reason drafting and RLHF exports).
  const markApprovedAndAdvance = (row: ExtractionRow) => {
    saveField.mutate({
      id: row.id,
      patch: {
        final_value: valueOf(row),
        review_state: valueOf(row) === (row.suggested_value ?? "") ? "accepted" : "corrected",
      },
    });
    toast.success(`${row.field_label ?? row.field_key} approved`);
    const pending = extractions.filter(
      (item) => item.review_state === "pending" && item.id !== row.id,
    );
    const next = pending[0];
    if (next) {
      setActiveField(next.field_key);
      setPage(next.evidence_page ?? 1);
      window.setTimeout(() => fieldRefs.current[next.id]?.focus(), 30);
    }
  };

  const pageCount = Math.max(activeDocument?.page_count ?? 1, 1);
  const activeRow = extractions.find((row) => row.field_key === activeField) ?? null;
  const rawActiveEvidence = activeRow?.evidence_snippet ?? null;
  const activeEvidenceHidden =
    Boolean(activeField) &&
    isSensitiveValue(sensitiveKeys.has(activeField!), activeRow?.pii_detected) &&
    !revealedKeys.has(activeField!);
  const activeEvidence = activeEvidenceHidden
    ? maskForDisplay(rawActiveEvidence)
    : rawActiveEvidence;

  // Every already-extracted field's evidence gets a highlight box on the
  // rendered PDF — not just whichever one is currently focused (that one
  // gets a stronger border so it still stands out). Table/line-item fields
  // are skipped (no single span to box), as are fields whose evidence is
  // recorded for a different page. Same reveal-gating as the evidence
  // banner/masked input above — never hand a hidden sensitive field's real
  // text to the viewer to search for and box on screen.
  const pageHighlights = useMemo(() => {
    const items: { id: string; text: string; active: boolean }[] = [];
    for (const row of extractions) {
      if (row.data_type === "multi_value") continue;
      if (row.evidence_page != null && row.evidence_page !== page) continue;
      const hidden =
        isSensitiveValue(sensitiveKeys.has(row.field_key), row.pii_detected) &&
        !revealedKeys.has(row.field_key);
      if (hidden) continue;
      const text = (row.evidence_snippet ?? valueOf(row)).trim();
      if (!text) continue;
      items.push({ id: row.field_key, text, active: row.field_key === activeField });
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractions, page, sensitiveKeys, revealedKeys, activeField, drafts]);

  // Fields a Map Selection can be assigned to — line-item/table fields are
  // excluded since a single selected string can't populate a whole table.
  const mappableFields = extractions.filter((row) => row.data_type !== "multi_value");

  function handleMapSelection(fieldKey: string) {
    const row = extractions.find((item) => item.field_key === fieldKey);
    const text = selectionPopup?.text ?? "";
    if (!row || !text) return;
    saveField.mutate({
      id: row.id,
      patch: {
        final_value: text,
        review_state: text === (row.suggested_value ?? "") ? "accepted" : "corrected",
      },
    });
    setDrafts((current) => ({ ...current, [row.id]: text }));
    setActiveField(row.field_key);
    setSelectionPopup(null);
    toast.success(`Mapped selection to ${row.field_label ?? row.field_key}`);
  }

  function handleSelectText(selection: PdfTextSelection) {
    if (mappableFields.length === 0) return;
    setSelectionPopup({ text: selection.text, x: selection.clientX, y: selection.clientY });
  }

  if (batchesQuery.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3 text-sm">
          <Button
            size="sm"
            variant="ghost"
            className="size-7 bg-primary/10 p-0 text-primary hover:bg-primary/20"
            aria-label={queueOpen ? "Collapse queue panel" : "Expand queue panel"}
            onClick={() => setQueueOpen((value) => !value)}
          >
            {queueOpen ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </Button>
          <span className="font-semibold tabular-nums">
            {reviewedCount} / {allDocuments.length} reviewed
          </span>
          <span className="text-muted-foreground">{queue.length} left</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {profileQuery.data
            ? `Profile: ${profileQuery.data.name} · v${profileQuery.data.version}`
            : "No label profile mapped"}
        </span>
      </div>

      <div
        className={cn(
          "grid gap-4 transition-all",
          queueOpen ? "xl:grid-cols-[240px_1fr_420px]" : "xl:grid-cols-[1fr_420px]",
        )}
      >
        {/* Queue */}
        {queueOpen && (
          <div className="panel flex flex-col overflow-hidden p-3">
            <Label className="text-xs text-muted-foreground">Batch</Label>
            <Select
              value={activeBatchId ?? ""}
              onValueChange={(value) => {
                setBatchId(value);
                setDocumentId(null);
              }}
              disabled={batches.length === 0}
            >
              <SelectTrigger className="mt-1 h-8 text-sm" aria-label="Batch">
                <SelectValue placeholder="No batches yet" />
              </SelectTrigger>
              <SelectContent>
                {batches.map((batch) => (
                  <SelectItem key={batch.id} value={batch.id} className="text-sm">
                    {batch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Queue
            </h2>
            {documentsQuery.isPending ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : documentsQuery.isError ? (
              <p className="mt-2 text-xs text-destructive">
                The queue could not be loaded. Try again in a moment.
              </p>
            ) : queue.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {allDocuments.length === 0
                  ? "This batch has no documents yet."
                  : "No documents are ready for review — run prelabeling in Ingestion first."}{" "}
                <Link to="/ingestion" className="text-primary underline-offset-2 hover:underline">
                  Open Ingestion
                </Link>
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {queue.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDocumentId(doc.id);
                        setDrafts({});
                        setPage(1);
                      }}
                      className={cn(
                        "w-full truncate rounded-md border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                        doc.id === documentId ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      {doc.filename}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Viewer */}
        <div className="panel flex min-h-[520px] flex-col p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {activeDocument?.filename ?? "No document selected"}
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                Page {page} of {pageCount}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label="Next page"
                disabled={page >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                <ChevronRight className="size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label="Zoom out"
                onClick={() => setZoom((value) => Math.max(50, value - 10))}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">{zoom}%</span>
              <Button
                size="sm"
                variant="ghost"
                className="size-7 p-0"
                aria-label="Zoom in"
                onClick={() => setZoom((value) => Math.min(200, value + 10))}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          </div>

          {activeEvidence ? (
            <p className="mt-2 rounded-md bg-primary/10 px-2 py-1.5 text-xs">
              <span className="font-medium">Evidence for {activeField}:</span>{" "}
              <mark className="bg-primary/25 text-foreground">{activeEvidence}</mark>
            </p>
          ) : null}

          <div className="relative mt-2 flex-1 overflow-hidden rounded-md border border-border bg-muted/30">
            {!activeDocument ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                Select a document from the queue to start reviewing.
              </div>
            ) : fileUrlQuery.isPending ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : fileUrlQuery.data ? (
              activeDocument.file_type === "pdf" && !pdfViewerFailed ? (
                <PdfTextViewer
                  key={fileUrlQuery.data}
                  fileUrl={fileUrlQuery.data}
                  page={page}
                  zoom={zoom}
                  highlights={pageHighlights}
                  onSelectText={handleSelectText}
                  onError={() => setPdfViewerFailed(true)}
                  className="h-full min-h-[460px]"
                />
              ) : (
                <iframe
                  key={`${fileUrlQuery.data}-${page}-${zoom}`}
                  title={`Document preview: ${activeDocument.filename}`}
                  src={
                    activeDocument.file_type === "pdf"
                      ? `${fileUrlQuery.data}#page=${page}&zoom=${zoom}`
                      : fileUrlQuery.data
                  }
                  className="h-full min-h-[460px] w-full"
                />
              )
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                The source file could not be loaded.
              </div>
            )}
          </div>
          {selectionPopup ? (
            <MapSelectionPopover
              text={selectionPopup.text}
              x={selectionPopup.x}
              y={selectionPopup.y}
              candidates={mappableFields.map((row) => ({
                key: row.field_key,
                label: row.field_label ?? row.field_key,
                currentValue: valueOf(row),
              }))}
              onPick={handleMapSelection}
              onDismiss={() => setSelectionPopup(null)}
            />
          ) : null}
        </div>

        {/* Review panel */}
        <div className="space-y-3">
          <div className="panel max-h-[620px] space-y-4 overflow-y-auto p-3">
            {extractionsQuery.isPending && documentId ? (
              <div className="flex justify-center py-10">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : extractions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No extracted fields for this document yet.
              </p>
            ) : (
              grouped.map(([bucket, rows]) => {
                const done = rows.filter((row) => row.review_state !== "pending").length;
                const pct = Math.round((done / rows.length) * 100);
                return (
                  <section key={bucket}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold tracking-tight">{bucket}</h3>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {done}/{rows.length} reviewed
                      </span>
                    </div>
                    <Progress value={pct} className="mt-1 h-1" />
                    {done < rows.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {rows.length - done} field{rows.length - done === 1 ? "" : "s"} still need
                        attention
                      </p>
                    ) : null}

                    <ul className="mt-2 space-y-2">
                      {rows.map((row) => {
                        const value = valueOf(row);
                        const confidence = row.confidence ?? 0;
                        const duplicate =
                          value.trim() && (duplicateValues.get(value.trim().toLowerCase()) ?? 0) > 1;
                        const isTable = row.data_type === "multi_value";
                        const profileFlagged = sensitiveKeys.has(row.field_key);
                        const isSensitive = isSensitiveValue(profileFlagged, row.pii_detected);
                        // Distinguish "a human pre-flagged this field" from
                        // "the automatic scan found PII in THIS document's
                        // value" — same masking behavior either way, but the
                        // label tells a reviewer why it's hidden.
                        const sensitiveLabel = profileFlagged
                          ? "Sensitive"
                          : row.pii_types.length > 0
                            ? `PII detected: ${row.pii_types.join(", ").replace(/_/g, " ")}`
                            : "PII detected";
                        const revealed = revealedKeys.has(row.field_key);
                        return (
                          <li
                            key={row.id}
                            className={cn(
                              "rounded-md border p-2",
                              activeField === row.field_key
                                ? "border-primary bg-primary/5"
                                : "border-border",
                              row.review_state === "rejected" && "opacity-60",
                            )}
                            onFocus={() => {
                              setActiveField(row.field_key);
                              setPage(row.evidence_page ?? 1);
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-xs font-medium">
                                  {row.field_label ?? row.field_key}
                                </span>
                                {isSensitive ? (
                                  <span
                                    className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                                    title={sensitiveLabel}
                                  >
                                    {profileFlagged ? "Sensitive" : "PII detected"}
                                  </span>
                                ) : null}
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                {isSensitive ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="size-6 p-0"
                                    aria-label={revealed ? "Hide value" : "Reveal value"}
                                    onClick={() => toggleRevealed(row.field_key)}
                                  >
                                    {revealed ? (
                                      <EyeOff className="size-3.5" />
                                    ) : (
                                      <Eye className="size-3.5" />
                                    )}
                                  </Button>
                                ) : null}
                                <span
                                  className={cn(
                                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                                    confidenceTone(confidence),
                                  )}
                                >
                                  {Math.round(confidence * 100)}%
                                </span>
                              </span>
                            </div>

                            {isTable ? (
                              <LineItemEditor
                                value={value}
                                disabled={row.review_state === "accepted" || row.review_state === "corrected"}
                                onChange={(next) =>
                                  setDrafts((current) => ({ ...current, [row.id]: next }))
                                }
                                onLocate={(index) => {
                                  setActiveField(row.field_key);
                                  setPage(row.evidence_page ?? 1);
                                  toast.info(`Row ${index + 1} located on page ${row.evidence_page ?? 1}`);
                                }}
                              />
                            ) : (
                              <Input
                                ref={(element) => {
                                  fieldRefs.current[row.id] = element;
                                }}
                                type={isSensitive && !revealed ? "password" : "text"}
                                value={value}
                                disabled={row.review_state === "accepted" || row.review_state === "corrected"}
                                className="mt-1.5 h-8 text-sm"
                                aria-label={row.field_label ?? row.field_key}
                                onChange={(event) =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [row.id]: event.target.value,
                                  }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    markApprovedAndAdvance(row);
                                  }
                                }}
                              />
                            )}

                            {duplicate ? (
                              <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                                <Copy className="size-3" /> Duplicate value on this document
                              </p>
                            ) : null}

                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs"
                                onClick={() => markApprovedAndAdvance(row)}
                              >
                                <Check className="mr-1 size-3" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs"
                                onClick={() =>
                                  saveField.mutate({
                                    id: row.id,
                                    patch: { review_state: "rejected" },
                                  })
                                }
                              >
                                <X className="mr-1 size-3" /> Reject
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs text-destructive hover:text-destructive"
                                onClick={() => removeFromSchema.mutate(row.field_key)}
                              >
                                <Trash2 className="mr-1 size-3" /> Remove field
                              </Button>
                            </div>
                            {row.evidence_snippet ? (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {isSensitive && !revealed
                                  ? maskForDisplay(row.evidence_snippet)
                                  : row.evidence_snippet}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            )}
          </div>

          {/* Decision */}
          <div className="panel p-3">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {reviewedFields}/{extractions.length} fields reviewed
              </span>
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                className="h-8 flex-1 text-sm"
                disabled={!documentId || decide.isPending}
                onClick={() => decide.mutate("approved")}
              >
                Approve document
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 flex-1 text-sm"
                disabled={!documentId || decide.isPending}
                onClick={() => decide.mutate("rejected")}
              >
                Reject
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Changed fields are stored as training pairs for fine-tuning and RLHF.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LineItemEditor({
  value,
  disabled,
  onChange,
  onLocate,
}: {
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
  onLocate: (index: number) => void;
}) {
  const rows = parseLineItems(value);
  const update = (next: LineItem[]) => onChange(JSON.stringify(next));

  return (
    <div className="mt-1.5 space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="rounded-md border border-border p-1.5">
          <div className="grid grid-cols-4 gap-1">
            {(["description", "quantity", "price", "amount"] as const).map((key) => (
              <Input
                key={key}
                value={row[key]}
                disabled={disabled}
                placeholder={key}
                aria-label={`Row ${index + 1} ${key}`}
                className="h-7 text-xs"
                onChange={(event) => {
                  const next = rows.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, [key]: event.target.value } : item,
                  );
                  update(next);
                }}
              />
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs"
              onClick={() => onLocate(index)}
            >
              Locate row
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-xs"
              disabled={disabled}
              onClick={() => update(rows.filter((_, itemIndex) => itemIndex !== index))}
            >
              Remove row
            </Button>
          </div>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        disabled={disabled}
        onClick={() => update([...rows, { description: "", quantity: "", price: "", amount: "" }])}
      >
        <Plus className="mr-1 size-3" /> Add row
      </Button>
    </div>
  );
}
