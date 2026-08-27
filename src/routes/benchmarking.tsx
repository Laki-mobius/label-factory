import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, History, Loader2, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { computeBenchmark, percent, type FieldResult, type MismatchSample } from "@/lib/benchmark";
import { useProjectDashboard } from "@/lib/dashboard-data";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/benchmarking")({
  head: () => ({
    meta: [
      { title: "Benchmarking & Evals — LabelFactory" },
      {
        name: "description",
        content:
          "Measure field-level extraction accuracy by comparing AI prelabels against human-approved values, and track it over time.",
      },
      { property: "og:title", content: "Benchmarking & Evals — LabelFactory" },
      {
        property: "og:description",
        content:
          "Field-level accuracy, failure patterns and a history of benchmark runs for your labeling project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BenchmarkingRoute,
});

type RunRow = {
  id: string;
  name: string;
  created_at: string;
  overall_score: number;
  documents_evaluated: number;
  fields_evaluated: number;
  comparisons: number;
  profile_labels: string[];
  batch_labels: string[];
};

function BenchmarkingRoute() {
  return (
    <SectionPage
      title="Benchmarking & Evals"
      description="Compare AI-prelabeled values against human-approved values to see where extraction is accurate and where it fails."
    >
      <BenchmarkingBody />
    </SectionPage>
  );
}

function BenchmarkingBody() {
  const { projectId } = useWorkspace();
  const queryClient = useQueryClient();
  const dashboard = useProjectDashboard(projectId);

  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [results, setResults] = useState<FieldResult[] | null>(null);
  const [runMeta, setRunMeta] = useState<{ overall: number; documents: number } | null>(null);
  const [drilldown, setDrilldown] = useState<FieldResult | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["benchmark-profiles", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_profiles")
        .select("id, name, version")
        .eq("project_id", projectId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const runsQuery = useQuery({
    queryKey: ["benchmark-runs", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<RunRow[]> => {
      const { data, error } = await supabase
        .from("benchmark_runs")
        .select(
          "id, name, created_at, overall_score, documents_evaluated, fields_evaluated, comparisons, profile_labels, batch_labels",
        )
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
  });

  const batches = dashboard.data?.batches ?? [];
  const profiles = profilesQuery.data ?? [];

  const eligibleBatches = useMemo(() => {
    if (selectedProfiles.length === 0) return batches;
    return batches.filter((batch) => batch.profileId && selectedProfiles.includes(batch.profileId));
  }, [batches, selectedProfiles]);

  const activeBatchIds = useMemo(
    () => selectedBatches.filter((id) => eligibleBatches.some((batch) => batch.id === id)),
    [selectedBatches, eligibleBatches],
  );

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const runBenchmark = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      const batchIds = activeBatchIds.length > 0 ? activeBatchIds : eligibleBatches.map((b) => b.id);
      if (batchIds.length === 0) throw new Error("Select at least one batch to evaluate.");

      const computation = await computeBenchmark({ projectId, batchIds });
      if (computation.comparisons === 0) {
        throw new Error(
          "No approved documents with reviewed fields in that selection yet — approve some documents first.",
        );
      }

      const batchLabels = batches
        .filter((batch) => batchIds.includes(batch.id))
        .map((batch) => batch.name);
      const profileLabels = profiles
        .filter(
          (profile) =>
            selectedProfiles.includes(profile.id) ||
            (selectedProfiles.length === 0 &&
              batches.some((batch) => batchIds.includes(batch.id) && batch.profileId === profile.id)),
        )
        .map((profile) => `${profile.name} · v${profile.version}`);

      const { data: run, error: runError } = await supabase
        .from("benchmark_runs")
        .insert({
          project_id: projectId,
          name: `Run ${new Date().toLocaleString()}`,
          profile_ids: selectedProfiles,
          batch_ids: batchIds,
          profile_labels: profileLabels,
          batch_labels: batchLabels,
          overall_score: computation.overall,
          documents_evaluated: computation.documentsEvaluated,
          fields_evaluated: computation.fields.length,
          comparisons: computation.comparisons,
        })
        .select("id")
        .single();
      if (runError) throw runError;

      if (computation.fields.length > 0) {
        const { error: fieldError } = await supabase.from("benchmark_field_results").insert(
          computation.fields.map((field) => ({
            run_id: run.id,
            field_key: field.field_key,
            field_label: field.field_label,
            total: field.total,
            matched: field.matched,
            near_matched: field.near_matched,
            missed: field.missed,
            rejected: field.rejected,
            match_rate: field.match_rate,
            precision_score: field.precision_score,
            recall_score: field.recall_score,
            failure_pattern: field.failure_pattern,
            mismatches: field.mismatches as unknown as never,
          })),
        );
        if (fieldError) throw fieldError;
      }

      return computation;
    },
    onSuccess: async (computation) => {
      setResults(computation.fields);
      setRunMeta({ overall: computation.overall, documents: computation.documentsEvaluated });
      await queryClient.invalidateQueries({ queryKey: ["benchmark-runs", projectId] });
      toast.success(`Benchmark complete — ${percent(computation.overall)} overall match rate`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Benchmark failed"),
  });

  const loadRun = useMutation({
    mutationFn: async (run: RunRow) => {
      const { data, error } = await supabase
        .from("benchmark_field_results")
        .select("*")
        .eq("run_id", run.id);
      if (error) throw error;
      return { run, fields: (data ?? []) as unknown as FieldResult[] };
    },
    onSuccess: ({ run, fields }) => {
      setResults(
        [...fields].sort((a, b) => Number(a.match_rate) - Number(b.match_rate)),
      );
      setRunMeta({ overall: Number(run.overall_score), documents: run.documents_evaluated });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not load run"),
  });

  if (dashboard.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  const stats = dashboard.data?.stats;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Approved records" value={String(stats?.approvedRecords ?? 0)} />
        <Tile label="Profiles represented" value={String(stats?.profilesRepresented ?? 0)} />
        <Tile label="Batches represented" value={String(stats?.batchesRepresented ?? 0)} />
        <Tile label="Approval rate" value={`${stats?.approvalRate ?? 0}%`} bar={stats?.approvalRate ?? 0} />
        <Tile
          label="Prelabel completion"
          value={`${stats?.prelabelCompletion ?? 0}%`}
          bar={stats?.prelabelCompletion ?? 0}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="panel h-fit p-4">
          <h2 className="text-sm font-semibold tracking-tight">Run a benchmark</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Field accuracy is measured on approved documents by comparing AI prelabels with the
            human-approved final values.
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <p className="text-xs font-medium">Label profiles</p>
              <div className="mt-2 space-y-1.5">
                {profiles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No profiles in this project yet.</p>
                ) : (
                  profiles.map((profile) => (
                    <label
                      key={profile.id}
                      className="flex items-center gap-2 text-sm"
                      htmlFor={`profile-${profile.id}`}
                    >
                      <Checkbox
                        id={`profile-${profile.id}`}
                        checked={selectedProfiles.includes(profile.id)}
                        onCheckedChange={() =>
                          setSelectedProfiles((list) => toggle(list, profile.id))
                        }
                      />
                      <span className="truncate text-sm">
                        {profile.name} · v{profile.version}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Leave empty to include every profile.
              </p>
            </div>

            <div>
              <p className="text-xs font-medium">Batches</p>
              <div className="mt-2 space-y-1.5">
                {eligibleBatches.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No batches match the selected profiles.
                  </p>
                ) : (
                  eligibleBatches.map((batch) => (
                    <label
                      key={batch.id}
                      className="flex items-center gap-2 text-sm"
                      htmlFor={`batch-${batch.id}`}
                    >
                      <Checkbox
                        id={`batch-${batch.id}`}
                        checked={selectedBatches.includes(batch.id)}
                        onCheckedChange={() => setSelectedBatches((list) => toggle(list, batch.id))}
                      />
                      <span className="truncate text-sm">{batch.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {batch.approvedCount} approved
                      </span>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Leave empty to include every eligible batch.
              </p>
            </div>

            <Button
              size="sm"
              className="h-8 w-full text-sm"
              disabled={runBenchmark.isPending || eligibleBatches.length === 0}
              onClick={() => runBenchmark.mutate()}
            >
              {runBenchmark.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <PlayCircle className="size-3.5" aria-hidden="true" />
              )}
              Run benchmark
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Field-level results</h2>
                <p className="text-xs text-muted-foreground">
                  {runMeta
                    ? `${percent(runMeta.overall)} overall match rate across ${runMeta.documents} approved document(s).`
                    : "Run a benchmark to see per-field accuracy."}
                </p>
              </div>
              {runMeta ? (
                <Badge variant="outline" className="rounded-full px-2.5 py-0 text-[11px]">
                  Overall {percent(runMeta.overall)}
                </Badge>
              ) : null}
            </div>

            {!results ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No results loaded. Run a benchmark or open a past run below.
              </p>
            ) : results.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                This run has no comparable fields.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Field</TableHead>
                    <TableHead className="text-xs">Match rate</TableHead>
                    <TableHead className="text-xs">Precision</TableHead>
                    <TableHead className="text-xs">Recall</TableHead>
                    <TableHead className="text-xs">Failure pattern</TableHead>
                    <TableHead className="text-right text-xs">Mismatches</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((field) => (
                    <TableRow key={field.field_key}>
                      <TableCell className="text-sm font-medium">
                        {field.field_label}
                        <span className="block text-xs text-muted-foreground">
                          {field.total} compared
                        </span>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        <div className="flex items-center gap-2">
                          <Progress value={Number(field.match_rate) * 100} className="h-1.5 w-16" />
                          {percent(Number(field.match_rate))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {percent(Number(field.precision_score))}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {percent(Number(field.recall_score))}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {field.failure_pattern ?? "No systematic failures detected."}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={(field.mismatches ?? []).length === 0}
                          onClick={() => setDrilldown(field)}
                        >
                          {(field.mismatches ?? []).length}
                          <ChevronRight className="size-3.5" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="panel">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <History className="size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Run history</h2>
                <p className="text-xs text-muted-foreground">
                  Track whether accuracy improves after schema changes or finetuning.
                </p>
              </div>
            </div>
            {runsQuery.isPending ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading runs" />
              </div>
            ) : (runsQuery.data ?? []).length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No benchmark runs yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">When</TableHead>
                    <TableHead className="text-xs">Scope</TableHead>
                    <TableHead className="text-xs">Docs</TableHead>
                    <TableHead className="text-xs">Fields</TableHead>
                    <TableHead className="text-xs">Overall</TableHead>
                    <TableHead className="text-right text-xs">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runsQuery.data ?? []).map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="text-sm">
                        {new Date(run.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs text-muted-foreground">
                        {[...(run.profile_labels ?? []), ...(run.batch_labels ?? [])]
                          .slice(0, 3)
                          .join(", ") || "All batches"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {run.documents_evaluated}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{run.fields_evaluated}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {percent(Number(run.overall_score))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={loadRun.isPending}
                          onClick={() => loadRun.mutate(run)}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      <Dialog open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base">
              Mismatches — {drilldown?.field_label}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Approved documents where the AI-suggested value differed from the human-approved
              final value for this field.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Document</TableHead>
                  <TableHead className="text-xs">Issue</TableHead>
                  <TableHead className="text-xs">AI suggested</TableHead>
                  <TableHead className="text-xs">Approved value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((drilldown?.mismatches ?? []) as MismatchSample[]).map((sample, index) => (
                  <TableRow key={`${sample.document_id}-${index}`}>
                    <TableCell className="max-w-[14rem] truncate text-sm">
                      {sample.filename}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">
                        {sample.kind === "missed"
                          ? "Missed"
                          : sample.kind === "format"
                            ? "Format"
                            : sample.kind === "rejected"
                              ? "Rejected"
                              : "Wrong"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-sm text-muted-foreground">
                      {sample.suggested || "—"}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-sm">
                      {sample.final || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div className="panel p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {typeof bar === "number" ? <Progress value={bar} className="mt-2 h-1.5" /> : null}
    </div>
  );
}
