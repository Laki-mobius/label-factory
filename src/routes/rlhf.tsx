import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { DocQueue, type QueueDoc } from "@/components/rlhf/DocQueue";
import { RewardAiPanel, type RewardAiStatus } from "@/components/rlhf/RewardAiPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import { useProjectDashboard } from "@/lib/dashboard-data";
import { draftFeedbackReward, draftPreferenceReward } from "@/lib/reward-ai.functions";
import {
  buildDpoRecords,
  buildExportRecords,
  fetchFeedbackDocument,
  fetchFeedbackQueue,
  fetchPreferenceDocument,
  fetchPreferencePairs,
  fetchPreferenceQueue,
  fetchRlhfReadiness,
  fetchTrainingPairs,
  groupCount,
  PREFERENCE_DECISION_LABELS,
  REASON_CODE_LABELS,
  saveFeedbackDocument,
  savePreferenceDocument,
  serializeCsv,
  serializeExport,
  type ExportFormat,
  type FeedbackFieldRow,
  type PreferenceFieldRow,
} from "@/lib/rlhf";
import { maskForDisplay } from "@/lib/redact";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/rlhf")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Review correction reasons, build model preference comparisons, and export training data for fine-tuning.",
      },
      { property: "og:title", content: "RLHF Workbench — LabelFactory" },
      {
        property: "og:description",
        content:
          "Explain corrections for SFT, compare model outputs for DPO, and export both.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SectionPage
      title="RLHF Workbench"
      description="Explain corrections for supervised fine-tuning, compare model outputs for preference training, and export both."
    >
      <RlhfBody />
    </SectionPage>
  ),
});

const REASON_CODES = Object.keys(REASON_CODE_LABELS);
const PREFERENCE_DECISIONS = Object.keys(PREFERENCE_DECISION_LABELS) as Array<
  "prefer_a" | "prefer_b" | "both" | "neither"
>;

function RlhfBody() {
  const { projectId } = useWorkspace();
  const dashboard = useProjectDashboard(projectId);

  const [batchId, setBatchId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const batches = dashboard.data?.batches ?? [];
  const scopedBatchIds = batchId === "all" ? undefined : [batchId];

  return (
    <Tabs defaultValue="dashboard" className="space-y-4">
      <TabsList className="h-8">
        <TabsTrigger value="dashboard" className="h-6 px-3 text-xs">
          Dashboard
        </TabsTrigger>
        <TabsTrigger value="corrections" className="h-6 px-3 text-xs">
          Corrections
        </TabsTrigger>
        <TabsTrigger value="preference" className="h-6 px-3 text-xs">
          Preference
        </TabsTrigger>
        <TabsTrigger value="export" className="h-6 px-3 text-xs">
          Export
        </TabsTrigger>
      </TabsList>

      <div className="panel flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-[12rem]">
          <Label htmlFor="rlhf-batch" className="text-xs">
            Batch
          </Label>
          <Select value={batchId} onValueChange={setBatchId}>
            <SelectTrigger id="rlhf-batch" className="mt-1 h-8 w-56 text-sm">
              <SelectValue placeholder="All batches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-sm">
                All batches
              </SelectItem>
              {batches.map((batch) => (
                <SelectItem key={batch.id} value={batch.id} className="text-sm">
                  {batch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="rlhf-from" className="text-xs">
            From
          </Label>
          <Input
            id="rlhf-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="mt-1 h-8 w-40 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="rlhf-to" className="text-xs">
            To
          </Label>
          <Input
            id="rlhf-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="mt-1 h-8 w-40 text-sm"
          />
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          Date range applies to Dashboard and Export. Corrections and Preference always show
          current pending work.
        </p>
      </div>

      <TabsContent value="dashboard" className="space-y-4">
        <DashboardTab projectId={projectId} scopedBatchIds={scopedBatchIds} from={from} to={to} />
      </TabsContent>

      <TabsContent value="corrections" className="space-y-4">
        <CorrectionsTab projectId={projectId} scopedBatchIds={scopedBatchIds} />
      </TabsContent>

      <TabsContent value="preference" className="space-y-4">
        <PreferenceTab projectId={projectId} scopedBatchIds={scopedBatchIds} />
      </TabsContent>

      <TabsContent value="export" className="space-y-4">
        <ExportTab projectId={projectId} scopedBatchIds={scopedBatchIds} from={from} to={to} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function DashboardTab({
  projectId,
  scopedBatchIds,
  from,
  to,
}: {
  projectId: string | null;
  scopedBatchIds: string[] | undefined;
  from: string;
  to: string;
}) {
  const dateFilters = {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
  };

  const pairsQuery = useQuery({
    queryKey: ["rlhf-pairs", projectId, scopedBatchIds, from, to],
    enabled: Boolean(projectId),
    queryFn: () => fetchTrainingPairs(projectId!, { batchIds: scopedBatchIds, ...dateFilters }),
  });

  const readinessQuery = useQuery({
    queryKey: ["rlhf-readiness", projectId, scopedBatchIds],
    enabled: Boolean(projectId),
    queryFn: () => fetchRlhfReadiness(projectId!, scopedBatchIds),
  });

  const preferencePairsQuery = useQuery({
    queryKey: ["rlhf-preference-pairs", projectId, scopedBatchIds],
    enabled: Boolean(projectId),
    queryFn: () => fetchPreferencePairs(projectId!, { batchIds: scopedBatchIds }),
  });

  const pairs = useMemo(() => pairsQuery.data ?? [], [pairsQuery.data]);
  const byField = useMemo(() => groupCount(pairs, (pair) => pair.fieldLabel), [pairs]);
  const byProfile = useMemo(() => groupCount(pairs, (pair) => pair.profileLabel), [pairs]);
  const byDecision = useMemo(
    () =>
      groupCount(
        preferencePairsQuery.data ?? [],
        (pair) => PREFERENCE_DECISION_LABELS[pair.decision] ?? pair.decision,
      ),
    [preferencePairsQuery.data],
  );

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Training pairs" value={String(pairs.length)} />
        <Tile label="Fields with corrections" value={String(byField.length)} />
        <Tile label="Profiles represented" value={String(byProfile.length)} />
        <Tile
          label="Documents involved"
          value={String(new Set(pairs.map((pair) => pair.documentId)).size)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          label="SFT-ready documents"
          value={readinessQuery.data ? String(readinessQuery.data.sftReadyCount) : "—"}
        />
        <Tile
          label="DPO-ready documents"
          value={readinessQuery.data ? String(readinessQuery.data.dpoReadyCount) : "—"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountPanel title="Pairs by field" rows={byField} empty="No corrections recorded yet." />
        <CountPanel
          title="Pairs by profile"
          rows={byProfile}
          empty="No corrections recorded yet."
        />
      </div>

      <CountPanel
        title="Preference decisions"
        rows={byDecision}
        empty="No preference decisions recorded yet."
      />

      <div className="panel">
        <div className="border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Training pairs</h2>
          <p className="text-xs text-muted-foreground">
            AI suggestion versus the reviewer&apos;s corrected value, newest first.
          </p>
        </div>
        {pairsQuery.isPending ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : pairs.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No correction pairs in this scope yet. Correct some prelabeled fields in Annotate &
            Label first.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Field</TableHead>
                  <TableHead className="text-xs">Document</TableHead>
                  <TableHead className="text-xs">AI suggested</TableHead>
                  <TableHead className="text-xs">Human corrected</TableHead>
                  <TableHead className="text-xs">Confidence</TableHead>
                  <TableHead className="text-xs">Reviewed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairs.slice(0, 300).map((pair) => (
                  <TableRow key={pair.id}>
                    <TableCell className="py-2 text-xs font-medium">
                      {pair.fieldLabel}
                      <span className="block text-2xs text-muted-foreground">
                        {pair.profileLabel}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate py-2 text-xs">
                      {pair.filename}
                      <span className="block text-2xs text-muted-foreground">
                        {pair.batchName}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate py-2 text-xs text-muted-foreground">
                      {pair.suggested || "—"}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate py-2 text-xs">
                      {pair.corrected || "—"}
                    </TableCell>
                    <TableCell className="py-2 text-xs tabular-nums">
                      {pair.confidence === null ? "—" : `${Math.round(pair.confidence * 100)}%`}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {pair.reviewedAt ? new Date(pair.reviewedAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Corrections — explain why a corrected field was wrong (SFT signal)
// ---------------------------------------------------------------------------

function CorrectionsTab({
  projectId,
  scopedBatchIds,
}: {
  projectId: string | null;
  scopedBatchIds: string[] | undefined;
}) {
  const queryClient = useQueryClient();
  const runFeedbackReward = useServerFn(draftFeedbackReward);

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, { reasonCode: string; reasonNotes: string }>>(
    {},
  );
  const [aiStatus, setAiStatus] = useState<RewardAiStatus>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDraftedCount, setAiDraftedCount] = useState(0);

  const queueQuery = useQuery({
    queryKey: ["rlhf-feedback-queue", projectId, scopedBatchIds],
    enabled: Boolean(projectId),
    queryFn: () => fetchFeedbackQueue(projectId!, scopedBatchIds),
  });

  const docs: QueueDoc[] = (queueQuery.data ?? []).map((doc) => ({
    documentId: doc.documentId,
    filename: doc.filename,
    batchName: doc.batchName,
    done: doc.explainedCount,
    total: doc.correctedCount,
  }));

  useEffect(() => {
    if (!activeDocId && docs.length > 0) setActiveDocId(docs[0].documentId);
  }, [docs, activeDocId]);

  const docMetaQuery = useQuery({
    queryKey: ["rlhf-doc-meta", activeDocId],
    enabled: Boolean(activeDocId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, filename, file_type, storage_path")
        .eq("id", activeDocId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const fileUrlQuery = useQuery({
    queryKey: ["rlhf-file-url", docMetaQuery.data?.storage_path],
    enabled: Boolean(docMetaQuery.data?.storage_path),
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(docMetaQuery.data!.storage_path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const fieldsQuery = useQuery({
    queryKey: ["rlhf-feedback-doc", activeDocId],
    enabled: Boolean(activeDocId),
    queryFn: () => fetchFeedbackDocument(activeDocId!),
  });

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    setRevealedKeys(new Set());
  }, [activeDocId]);
  const toggleRevealed = (fieldKey: string) =>
    setRevealedKeys((current) => {
      const next = new Set(current);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });

  useEffect(() => {
    const next: Record<string, { reasonCode: string; reasonNotes: string }> = {};
    for (const field of fields) {
      next[field.id] = { reasonCode: field.reasonCode ?? "", reasonNotes: field.reasonNotes };
    }
    setEdits(next);
    setAiStatus("idle");
    setAiError(null);
  }, [fields]);

  const runReward = async () => {
    if (!activeDocId) return;
    setAiStatus("running");
    setAiError(null);
    try {
      const result = await runFeedbackReward({ data: { documentId: activeDocId } });
      const byKey = new Map(result.items.map((item) => [item.field_key, item]));
      setEdits((current) => {
        const next = { ...current };
        for (const field of fields) {
          const draft = byKey.get(field.fieldKey);
          if (draft) next[field.id] = { reasonCode: draft.reason_code, reasonNotes: draft.reason_notes };
        }
        return next;
      });
      setAiDraftedCount(result.items.length);
      setAiStatus(result.items.length > 0 ? "drafted" : "idle");
      if (result.items.length === 0) toast.info("Every corrected field here already has a reason.");
    } catch (error) {
      setAiStatus("failed");
      setAiError(error instanceof Error ? error.message : "Reward AI failed.");
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const rows = fields
        .filter((field) => edits[field.id]?.reasonCode)
        .map((field) => ({
          id: field.id,
          reasonCode: edits[field.id].reasonCode,
          reasonNotes: edits[field.id].reasonNotes,
        }));
      if (rows.length === 0) throw new Error("Pick a reason for at least one field first.");
      await saveFeedbackDocument(rows);
      return rows.length;
    },
    onSuccess: async (count) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rlhf-feedback-doc", activeDocId] }),
        queryClient.invalidateQueries({ queryKey: ["rlhf-feedback-queue", projectId] }),
      ]);
      setAiStatus("saved");
      toast.success(`Saved ${count} reason${count === 1 ? "" : "s"}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });

  const runBulkDraft = async () => {
    setBulkBusy(true);
    let saved = 0;
    for (const documentId of selectedIds) {
      try {
        const result = await runFeedbackReward({ data: { documentId } });
        if (result.items.length === 0) continue;
        const docFields = await fetchFeedbackDocument(documentId);
        const byKey = new Map(result.items.map((item) => [item.field_key, item]));
        const rows = docFields
          .map((field) => {
            const draft = byKey.get(field.fieldKey);
            return draft
              ? { id: field.id, reasonCode: draft.reason_code, reasonNotes: draft.reason_notes }
              : null;
          })
          .filter((row): row is { id: string; reasonCode: string; reasonNotes: string } =>
            Boolean(row),
          );
        if (rows.length > 0) {
          await saveFeedbackDocument(rows);
          saved += rows.length;
        }
      } catch (error) {
        toast.error(
          `${error instanceof Error ? error.message : "Reward AI failed"} (document ${documentId.slice(0, 8)})`,
        );
      }
    }
    const scopedCount = selectedIds.length;
    setSelectedIds([]);
    setBulkBusy(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rlhf-feedback-queue", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["rlhf-feedback-doc", activeDocId] }),
    ]);
    toast.success(
      `Drafted and saved ${saved} reason${saved === 1 ? "" : "s"} across ${scopedCount} document(s)`,
    );
  };

  const activeDoc = docMetaQuery.data;

  return (
    <div className="grid gap-4 xl:grid-cols-[240px_1fr_360px]">
      <DocQueue
        mode="feedback"
        docs={docs}
        isLoading={queueQuery.isPending}
        activeDocumentId={activeDocId}
        onSelectDocument={setActiveDocId}
        selectedIds={selectedIds}
        onToggleSelect={(id) =>
          setSelectedIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
        }
        onToggleSelectAll={() =>
          setSelectedIds((list) => (list.length === docs.length ? [] : docs.map((d) => d.documentId)))
        }
        onBulkDraft={runBulkDraft}
        bulkBusy={bulkBusy}
      />

      <div className="panel flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              {activeDoc?.filename ?? "Select a document"}
            </p>
            <p className="text-2xs text-muted-foreground">
              {fields.length} corrected field{fields.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            size="sm"
            className="h-7 shrink-0 text-xs"
            disabled={!activeDocId || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-3.5" aria-hidden="true" />
            )}
            Save corrections
          </Button>
        </div>
        <div className="min-h-[420px] flex-1 overflow-hidden bg-muted/30">
          {!activeDocId ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Select a document from the queue.
            </div>
          ) : fileUrlQuery.isPending ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : fileUrlQuery.data ? (
            <iframe
              key={fileUrlQuery.data}
              title={`Document preview: ${activeDoc?.filename}`}
              src={activeDoc?.file_type === "pdf" ? `${fileUrlQuery.data}#page=1` : fileUrlQuery.data}
              className="h-full min-h-[420px] w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              The source file could not be loaded.
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <RewardAiPanel
          mode="feedback"
          pendingCount={fields.filter((field) => !edits[field.id]?.reasonCode).length}
          status={aiStatus}
          draftedCount={aiDraftedCount}
          errorMessage={aiError}
          onRun={runReward}
          onClear={() => {
            setEdits((current) => {
              const next = { ...current };
              for (const field of fields) {
                next[field.id] = { reasonCode: field.reasonCode ?? "", reasonNotes: field.reasonNotes };
              }
              return next;
            });
            setAiStatus("idle");
          }}
        />

        <div className="max-h-[32rem] space-y-3 overflow-y-auto">
          {fields.length === 0 ? (
            <p className="panel px-3 py-8 text-center text-xs text-muted-foreground">
              {activeDocId
                ? "No corrected fields on this document."
                : "Select a document to review its corrections."}
            </p>
          ) : (
            fields.map((field) => (
              <FeedbackFieldCard
                key={field.id}
                field={field}
                reasonCode={edits[field.id]?.reasonCode ?? ""}
                reasonNotes={edits[field.id]?.reasonNotes ?? ""}
                revealed={revealedKeys.has(field.fieldKey)}
                onToggleReveal={() => toggleRevealed(field.fieldKey)}
                onChange={(patch) =>
                  setEdits((current) => ({ ...current, [field.id]: { ...current[field.id], ...patch } }))
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FeedbackFieldCard({
  field,
  reasonCode,
  reasonNotes,
  revealed,
  onToggleReveal,
  onChange,
}: {
  field: FeedbackFieldRow;
  reasonCode: string;
  reasonNotes: string;
  revealed: boolean;
  onToggleReveal: () => void;
  onChange: (patch: Partial<{ reasonCode: string; reasonNotes: string }>) => void;
}) {
  const hidden = field.sensitive && !revealed;
  return (
    <div className="panel space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold">{field.fieldLabel}</p>
          {field.sensitive ? <Badge variant="destructive">Sensitive</Badge> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {field.sensitive ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={onToggleReveal}
              aria-label={revealed ? "Hide value" : "Reveal value"}
            >
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          ) : null}
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-2xs font-medium",
              reasonCode
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {reasonCode ? "Explained" : "Needs review"}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-border bg-muted/40 p-2">
          <p className="text-2xs text-muted-foreground">AI suggested</p>
          <p className="mt-0.5 break-words">
            {hidden ? maskForDisplay(field.suggestedValue) || "—" : field.suggestedValue || "—"}
          </p>
        </div>
        <div className="rounded-md border border-primary/30 bg-primary-soft p-2">
          <p className="text-2xs text-primary-soft-foreground/70">Ground truth</p>
          <p className="mt-0.5 break-words text-primary-soft-foreground">
            {hidden ? maskForDisplay(field.correctedValue) || "—" : field.correctedValue || "—"}
          </p>
        </div>
      </div>
      {field.evidenceSnippet ? (
        <p className="rounded-md bg-muted/40 px-2 py-1.5 text-2xs text-muted-foreground">
          Evidence:{" "}
          <span className="italic">
            &quot;{hidden ? maskForDisplay(field.evidenceSnippet) : field.evidenceSnippet}&quot;
          </span>
        </p>
      ) : null}
      {field.confidence !== null ? (
        <p className="text-2xs text-muted-foreground">
          AI confidence: {Math.round(field.confidence * 100)}%
        </p>
      ) : null}
      <div>
        <Label className="text-2xs">Reason</Label>
        <Select value={reasonCode} onValueChange={(value) => onChange({ reasonCode: value })}>
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue placeholder="Choose a reason" />
          </SelectTrigger>
          <SelectContent>
            {REASON_CODES.map((code) => (
              <SelectItem key={code} value={code} className="text-xs">
                {REASON_CODE_LABELS[code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={reasonNotes}
        onChange={(event) => onChange({ reasonNotes: event.target.value })}
        placeholder="Short explanation (optional)"
        className="min-h-[50px] text-xs"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preference — Model A (current output) vs Model B (candidate), for DPO
// ---------------------------------------------------------------------------

function PreferenceTab({
  projectId,
  scopedBatchIds,
}: {
  projectId: string | null;
  scopedBatchIds: string[] | undefined;
}) {
  const queryClient = useQueryClient();
  const runPreferenceRewardFn = useServerFn(draftPreferenceReward);

  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, { modelBValue: string; decision: string }>>(
    {},
  );
  const [aiStatus, setAiStatus] = useState<RewardAiStatus>("idle");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiDraftedCount, setAiDraftedCount] = useState(0);

  const queueQuery = useQuery({
    queryKey: ["rlhf-preference-queue", projectId, scopedBatchIds],
    enabled: Boolean(projectId),
    queryFn: () => fetchPreferenceQueue(projectId!, scopedBatchIds),
  });

  const docs: QueueDoc[] = (queueQuery.data ?? []).map((doc) => ({
    documentId: doc.documentId,
    filename: doc.filename,
    batchName: doc.batchName,
    done: doc.decidedCount,
    total: doc.fieldCount,
  }));

  useEffect(() => {
    if (!activeDocId && docs.length > 0) setActiveDocId(docs[0].documentId);
  }, [docs, activeDocId]);

  const docMetaQuery = useQuery({
    queryKey: ["rlhf-doc-meta", activeDocId],
    enabled: Boolean(activeDocId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, filename, file_type, storage_path")
        .eq("id", activeDocId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const fileUrlQuery = useQuery({
    queryKey: ["rlhf-file-url", docMetaQuery.data?.storage_path],
    enabled: Boolean(docMetaQuery.data?.storage_path),
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("documents")
        .createSignedUrl(docMetaQuery.data!.storage_path!, 3600);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const fieldsQuery = useQuery({
    queryKey: ["rlhf-preference-doc", activeDocId],
    enabled: Boolean(activeDocId),
    queryFn: () => fetchPreferenceDocument(activeDocId!),
  });

  const fields = useMemo(() => fieldsQuery.data ?? [], [fieldsQuery.data]);

  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    setRevealedKeys(new Set());
  }, [activeDocId]);
  const toggleRevealed = (fieldKey: string) =>
    setRevealedKeys((current) => {
      const next = new Set(current);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });

  useEffect(() => {
    const next: Record<string, { modelBValue: string; decision: string }> = {};
    for (const field of fields) {
      next[field.fieldKey] = { modelBValue: field.modelBValue, decision: field.decision ?? "" };
    }
    setEdits(next);
    setAiStatus("idle");
    setAiError(null);
  }, [fields]);

  const winnerCounts = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const field of Object.values(edits)) {
      if (field.decision === "prefer_a") a += 1;
      if (field.decision === "prefer_b") b += 1;
    }
    return { a, b };
  }, [edits]);

  const runReward = async () => {
    if (!activeDocId) return;
    setAiStatus("running");
    setAiError(null);
    try {
      const result = await runPreferenceRewardFn({ data: { documentId: activeDocId } });
      const byKey = new Map(result.items.map((item) => [item.field_key, item]));
      setEdits((current) => {
        const next = { ...current };
        for (const field of fields) {
          const draft = byKey.get(field.fieldKey);
          if (draft) next[field.fieldKey] = { modelBValue: draft.model_b_value, decision: draft.decision };
        }
        return next;
      });
      setAiDraftedCount(result.items.length);
      setAiStatus(result.items.length > 0 ? "drafted" : "idle");
      if (result.items.length === 0) toast.info("No fields available to draft on this document.");
    } catch (error) {
      setAiStatus("failed");
      setAiError(error instanceof Error ? error.message : "Reward AI failed.");
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeDocId) throw new Error("No document selected.");
      const rows = fields
        .filter((field) => edits[field.fieldKey]?.decision)
        .map((field) => ({
          fieldKey: field.fieldKey,
          fieldLabel: field.fieldLabel,
          modelAValue: field.modelAValue,
          modelBValue: edits[field.fieldKey].modelBValue,
          decision: edits[field.fieldKey].decision as "prefer_a" | "prefer_b" | "both" | "neither",
        }));
      if (rows.length === 0) throw new Error("Pick a decision for at least one field first.");
      await savePreferenceDocument(activeDocId, rows);
      return rows.length;
    },
    onSuccess: async (count) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rlhf-preference-doc", activeDocId] }),
        queryClient.invalidateQueries({ queryKey: ["rlhf-preference-queue", projectId] }),
      ]);
      setAiStatus("saved");
      toast.success(`Saved ${count} decision${count === 1 ? "" : "s"}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Save failed"),
  });

  const runBulkDraft = async () => {
    setBulkBusy(true);
    let saved = 0;
    for (const documentId of selectedIds) {
      try {
        const result = await runPreferenceRewardFn({ data: { documentId } });
        if (result.items.length === 0) continue;
        const docFields = await fetchPreferenceDocument(documentId);
        const byKey = new Map(result.items.map((item) => [item.field_key, item]));
        const rows = docFields
          .map((field) => {
            const draft = byKey.get(field.fieldKey);
            return draft
              ? {
                  fieldKey: field.fieldKey,
                  fieldLabel: field.fieldLabel,
                  modelAValue: field.modelAValue,
                  modelBValue: draft.model_b_value,
                  decision: draft.decision,
                }
              : null;
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row));
        if (rows.length > 0) {
          await savePreferenceDocument(documentId, rows);
          saved += rows.length;
        }
      } catch (error) {
        toast.error(
          `${error instanceof Error ? error.message : "Reward AI failed"} (document ${documentId.slice(0, 8)})`,
        );
      }
    }
    const scopedCount = selectedIds.length;
    setSelectedIds([]);
    setBulkBusy(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["rlhf-preference-queue", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["rlhf-preference-doc", activeDocId] }),
    ]);
    toast.success(
      `Drafted and saved ${saved} decision${saved === 1 ? "" : "s"} across ${scopedCount} document(s)`,
    );
  };

  const activeDoc = docMetaQuery.data;

  return (
    <div className="grid gap-4 xl:grid-cols-[240px_1fr_400px]">
      <DocQueue
        mode="preference"
        docs={docs}
        isLoading={queueQuery.isPending}
        activeDocumentId={activeDocId}
        onSelectDocument={setActiveDocId}
        selectedIds={selectedIds}
        onToggleSelect={(id) =>
          setSelectedIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
        }
        onToggleSelectAll={() =>
          setSelectedIds((list) => (list.length === docs.length ? [] : docs.map((d) => d.documentId)))
        }
        onBulkDraft={runBulkDraft}
        bulkBusy={bulkBusy}
      />

      <div className="panel flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              {activeDoc?.filename ?? "Select a document"}
            </p>
            <p className="text-2xs text-muted-foreground">
              Model A vs Model B · A wins {winnerCounts.a} · B wins {winnerCounts.b}
            </p>
          </div>
          <Button
            size="sm"
            className="h-7 shrink-0 text-xs"
            disabled={!activeDocId || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-3.5" aria-hidden="true" />
            )}
            Save preferences
          </Button>
        </div>
        <div className="min-h-[420px] flex-1 overflow-hidden bg-muted/30">
          {!activeDocId ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              Select a document from the queue.
            </div>
          ) : fileUrlQuery.isPending ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : fileUrlQuery.data ? (
            <iframe
              key={fileUrlQuery.data}
              title={`Document preview: ${activeDoc?.filename}`}
              src={activeDoc?.file_type === "pdf" ? `${fileUrlQuery.data}#page=1` : fileUrlQuery.data}
              className="h-full min-h-[420px] w-full"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              The source file could not be loaded.
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <RewardAiPanel
          mode="preference"
          pendingCount={fields.filter((field) => !edits[field.fieldKey]?.decision).length}
          status={aiStatus}
          draftedCount={aiDraftedCount}
          errorMessage={aiError}
          onRun={runReward}
          onClear={() => {
            setEdits((current) => {
              const next = { ...current };
              for (const field of fields) {
                next[field.fieldKey] = { modelBValue: field.modelBValue, decision: field.decision ?? "" };
              }
              return next;
            });
            setAiStatus("idle");
          }}
        />

        <div className="max-h-[32rem] space-y-3 overflow-y-auto">
          {fields.length === 0 ? (
            <p className="panel px-3 py-8 text-center text-xs text-muted-foreground">
              {activeDocId
                ? "No extracted fields on this document."
                : "Select a document to compare its fields."}
            </p>
          ) : (
            fields.map((field) => (
              <PreferenceFieldCard
                key={field.fieldKey}
                field={field}
                modelBValue={edits[field.fieldKey]?.modelBValue ?? ""}
                decision={edits[field.fieldKey]?.decision ?? ""}
                revealed={revealedKeys.has(field.fieldKey)}
                onToggleReveal={() => toggleRevealed(field.fieldKey)}
                onChange={(patch) =>
                  setEdits((current) => ({
                    ...current,
                    [field.fieldKey]: { ...current[field.fieldKey], ...patch },
                  }))
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PreferenceFieldCard({
  field,
  modelBValue,
  decision,
  revealed,
  onToggleReveal,
  onChange,
}: {
  field: PreferenceFieldRow;
  modelBValue: string;
  decision: string;
  revealed: boolean;
  onToggleReveal: () => void;
  onChange: (patch: Partial<{ modelBValue: string; decision: string }>) => void;
}) {
  const hidden = field.sensitive && !revealed;
  return (
    <div className="panel space-y-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-semibold">{field.fieldLabel}</p>
          {field.sensitive ? <Badge variant="destructive">Sensitive</Badge> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {field.sensitive ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={onToggleReveal}
              aria-label={revealed ? "Hide value" : "Reveal value"}
            >
              {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </Button>
          ) : null}
          {decision ? (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-2xs font-medium text-emerald-600 dark:text-emerald-400">
              {PREFERENCE_DECISION_LABELS[decision]}
            </span>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div
          className={cn(
            "rounded-md border p-2",
            decision === "prefer_a"
              ? "border-emerald-500/40 bg-emerald-500/10"
              : decision === "neither"
                ? "border-destructive/30 bg-destructive/5"
                : "border-border bg-muted/40",
          )}
        >
          <p className="text-2xs text-muted-foreground">Model A</p>
          <p className="mt-0.5 break-words">
            {hidden ? maskForDisplay(field.modelAValue) || "—" : field.modelAValue || "—"}
          </p>
        </div>
        <div
          className={cn(
            "rounded-md border p-2",
            decision === "prefer_b"
              ? "border-violet-500/40 bg-violet-500/10"
              : decision === "neither"
                ? "border-destructive/30 bg-destructive/5"
                : "border-border bg-muted/40",
          )}
        >
          <p className="text-2xs text-muted-foreground">Model B</p>
          {hidden ? (
            <p className="mt-0.5 break-words text-xs">{maskForDisplay(modelBValue) || "—"}</p>
          ) : (
            <Textarea
              value={modelBValue}
              onChange={(event) => onChange({ modelBValue: event.target.value })}
              placeholder="Candidate value"
              className="mt-0.5 min-h-[40px] border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
            />
          )}
        </div>
      </div>
      {field.evidenceSnippet ? (
        <p className="rounded-md bg-muted/40 px-2 py-1.5 text-2xs text-muted-foreground">
          Evidence:{" "}
          <span className="italic">
            &quot;{hidden ? maskForDisplay(field.evidenceSnippet) : field.evidenceSnippet}&quot;
          </span>
        </p>
      ) : null}
      <ToggleGroup
        type="single"
        value={decision}
        onValueChange={(value) => value && onChange({ decision: value })}
        className="justify-start gap-1.5"
      >
        {PREFERENCE_DECISIONS.map((value) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="h-7 rounded-md border border-border px-2 text-2xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
          >
            {PREFERENCE_DECISION_LABELS[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportTab({
  projectId,
  scopedBatchIds,
  from,
  to,
}: {
  projectId: string | null;
  scopedBatchIds: string[] | undefined;
  from: string;
  to: string;
}) {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<ExportFormat>("jsonl");
  const [exportName, setExportName] = useState("");

  const dateFilters = {
    from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
  };

  const pairsQuery = useQuery({
    queryKey: ["rlhf-pairs", projectId, scopedBatchIds, from, to],
    enabled: Boolean(projectId),
    queryFn: () => fetchTrainingPairs(projectId!, { batchIds: scopedBatchIds, ...dateFilters }),
  });

  const preferencePairsQuery = useQuery({
    queryKey: ["rlhf-preference-pairs-export", projectId, scopedBatchIds, from, to],
    enabled: Boolean(projectId),
    queryFn: () => fetchPreferencePairs(projectId!, { batchIds: scopedBatchIds, ...dateFilters }),
  });

  const readinessQuery = useQuery({
    queryKey: ["rlhf-readiness", projectId, scopedBatchIds],
    enabled: Boolean(projectId),
    queryFn: () => fetchRlhfReadiness(projectId!, scopedBatchIds),
  });

  const feedbackQueueQuery = useQuery({
    queryKey: ["rlhf-feedback-queue", projectId, scopedBatchIds],
    enabled: Boolean(projectId),
    queryFn: () => fetchFeedbackQueue(projectId!, scopedBatchIds),
  });

  const preferenceQueueQuery = useQuery({
    queryKey: ["rlhf-preference-queue", projectId, scopedBatchIds],
    enabled: Boolean(projectId),
    queryFn: () => fetchPreferenceQueue(projectId!, scopedBatchIds),
  });

  const exportsQuery = useQuery({
    queryKey: ["rlhf-exports", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rlhf_exports")
        .select("id, name, format, pair_count, created_at, payload")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const pairs = pairsQuery.data ?? [];
  const dpoRecords = useMemo(
    () => buildDpoRecords(preferencePairsQuery.data ?? []),
    [preferencePairsQuery.data],
  );
  const sftRecords = useMemo(() => buildExportRecords(pairs), [pairs]);

  const { payload, count } = useMemo(() => {
    if (format === "dpo_jsonl") {
      return { payload: dpoRecords.map((record) => JSON.stringify(record)).join("\n"), count: dpoRecords.length };
    }
    if (format === "csv") {
      return { payload: serializeCsv(pairs), count: pairs.length };
    }
    return { payload: serializeExport(sftRecords, format), count: sftRecords.length };
  }, [format, dpoRecords, pairs, sftRecords]);

  const preview = useMemo(() => {
    if (format === "dpo_jsonl") {
      return dpoRecords.slice(0, 5).map((record) => JSON.stringify(record)).join("\n");
    }
    if (format === "csv") return serializeCsv(pairs.slice(0, 5));
    return serializeExport(sftRecords.slice(0, 5), format);
  }, [format, dpoRecords, pairs, sftRecords]);

  const saveExport = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      if (count === 0) throw new Error("There is nothing to export in this scope yet.");
      const name = exportName.trim() || `Export ${new Date().toLocaleString()}`;
      const { error } = await supabase.from("rlhf_exports").insert({
        project_id: projectId,
        name,
        format,
        pair_count: count,
        filters: {
          batch_ids: scopedBatchIds ?? null,
          from: from || null,
          to: to || null,
        } as unknown as never,
        payload: (format === "csv" ? pairs : format === "dpo_jsonl" ? dpoRecords : sftRecords) as unknown as never,
      });
      if (error) throw error;
      download(payload, name, format);
      return name;
    },
    onSuccess: async (name) => {
      setExportName("");
      await queryClient.invalidateQueries({ queryKey: ["rlhf-exports", projectId] });
      toast.success(`${name} downloaded and saved to export history`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Export failed"),
  });

  const backlog = useMemo(() => {
    const byDoc = new Map<
      string,
      { filename: string; batchName: string; sftDone: number; sftTotal: number; dpoDone: number; dpoTotal: number }
    >();
    for (const doc of feedbackQueueQuery.data ?? []) {
      byDoc.set(doc.documentId, {
        filename: doc.filename,
        batchName: doc.batchName,
        sftDone: doc.explainedCount,
        sftTotal: doc.correctedCount,
        dpoDone: 0,
        dpoTotal: 0,
      });
    }
    for (const doc of preferenceQueueQuery.data ?? []) {
      const existing = byDoc.get(doc.documentId);
      if (existing) {
        existing.dpoDone = doc.decidedCount;
        existing.dpoTotal = doc.fieldCount;
      } else {
        byDoc.set(doc.documentId, {
          filename: doc.filename,
          batchName: doc.batchName,
          sftDone: 0,
          sftTotal: 0,
          dpoDone: doc.decidedCount,
          dpoTotal: doc.fieldCount,
        });
      }
    }
    return [...byDoc.entries()]
      .map(([documentId, entry]) => ({ documentId, ...entry }))
      .filter((entry) => entry.sftDone < entry.sftTotal || entry.dpoDone < entry.dpoTotal)
      .sort((a, b) => a.filename.localeCompare(b.filename));
  }, [feedbackQueueQuery.data, preferenceQueueQuery.data]);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="SFT-ready documents"
          value={readinessQuery.data ? String(readinessQuery.data.sftReadyCount) : "—"}
        />
        <Tile
          label="DPO-ready documents"
          value={readinessQuery.data ? String(readinessQuery.data.dpoReadyCount) : "—"}
        />
        <Tile label="CSV rows available" value={String(pairs.length)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="panel h-fit space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Export</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {count} record(s) in the current filter scope.
            </p>
          </div>
          <div>
            <Label htmlFor="export-name" className="text-xs">
              Export name
            </Label>
            <Input
              id="export-name"
              value={exportName}
              onChange={(event) => setExportName(event.target.value)}
              placeholder="e.g. Invoices corrections — March"
              className="mt-1 h-8 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="export-format" className="text-xs">
              Format
            </Label>
            <Select value={format} onValueChange={(value) => setFormat(value as ExportFormat)}>
              <SelectTrigger id="export-format" className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jsonl" className="text-sm">
                  SFT JSONL (one record per line)
                </SelectItem>
                <SelectItem value="json" className="text-sm">
                  SFT JSON (array)
                </SelectItem>
                <SelectItem value="dpo_jsonl" className="text-sm">
                  DPO JSONL (chosen/rejected)
                </SelectItem>
                <SelectItem value="csv" className="text-sm">
                  CSV (training pairs)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            className="h-8 w-full text-sm"
            disabled={saveExport.isPending || count === 0}
            onClick={() => saveExport.mutate()}
          >
            {saveExport.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-3.5" aria-hidden="true" />
            )}
            Download &amp; save export
          </Button>
        </div>

        <div className="panel">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight">Payload preview</h2>
            <p className="text-xs text-muted-foreground">
              First 5 records of {count}, exactly as they will be written.
            </p>
          </div>
          <pre className="max-h-72 overflow-auto px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
            {preview || "Nothing to export yet."}
          </pre>
        </div>
      </div>

      <div className="panel">
        <div className="border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Export backlog</h2>
          <p className="text-xs text-muted-foreground">
            Documents still missing an SFT reason or a DPO decision.
          </p>
        </div>
        {backlog.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nothing pending — everything in scope is export-ready.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Document</TableHead>
                <TableHead className="text-xs">SFT</TableHead>
                <TableHead className="text-xs">DPO</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backlog.slice(0, 100).map((entry) => (
                <TableRow key={entry.documentId}>
                  <TableCell className="py-2 text-xs font-medium">
                    {entry.filename}
                    <span className="block text-2xs text-muted-foreground">{entry.batchName}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    <BacklogBadge done={entry.sftDone} total={entry.sftTotal} />
                  </TableCell>
                  <TableCell className="py-2">
                    <BacklogBadge done={entry.dpoDone} total={entry.dpoTotal} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="panel">
        <div className="border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Past exports</h2>
          <p className="text-xs text-muted-foreground">
            Re-download any previous export exactly as it was generated.
          </p>
        </div>
        {(exportsQuery.data ?? []).length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No exports yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Format</TableHead>
                <TableHead className="text-xs">Records</TableHead>
                <TableHead className="text-xs">Created</TableHead>
                <TableHead className="text-right text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(exportsQuery.data ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="py-2 text-xs font-medium">{row.name}</TableCell>
                  <TableCell className="py-2">
                    <Badge variant="outline" className="rounded-full px-2 py-0 text-2xs uppercase">
                      {row.format}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2 text-xs tabular-nums">{row.pair_count}</TableCell>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        const rowFormat = row.format as ExportFormat;
                        const rowPayload = (row.payload ?? []) as unknown[];
                        const content =
                          rowFormat === "csv"
                            ? serializeCsv(rowPayload as never)
                            : rowFormat === "dpo_jsonl"
                              ? rowPayload.map((record) => JSON.stringify(record)).join("\n")
                              : serializeExport(rowPayload as never, rowFormat);
                        download(content, row.name, rowFormat);
                      }}
                    >
                      Download
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}

function BacklogBadge({ done, total }: { done: number; total: number }) {
  if (total === 0) return <span className="text-2xs text-muted-foreground">No signal</span>;
  const ready = done === total;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-2xs font-medium",
        ready
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
          : "bg-muted text-muted-foreground",
      )}
    >
      {ready ? "Ready" : `${done}/${total} pending`}
    </span>
  );
}

function download(content: string, name: string, format: ExportFormat) {
  const mime =
    format === "csv" ? "text/csv" : format === "json" ? "application/json" : "application/x-ndjson";
  const ext = format === "dpo_jsonl" ? "jsonl" : format;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.${ext}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CountPanel({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; count: number }[];
  empty: string;
}) {
  const max = rows[0]?.count ?? 1;
  return (
    <div className="panel">
      <div className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto px-4 py-3">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-3 text-xs">
              <span className="w-40 truncate">{row.label}</span>
              <span className="h-1.5 flex-1 rounded-full bg-muted">
                <span
                  className="block h-1.5 rounded-full bg-primary"
                  style={{ width: `${Math.max(6, (row.count / max) * 100)}%` }}
                />
              </span>
              <span className="w-8 text-right tabular-nums">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
