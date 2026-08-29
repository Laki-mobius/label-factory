import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  History,
  Loader2,
  PlayCircle,
  Sparkles,
  Trash2,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { percent, type FieldResult, type MismatchSample } from "@/lib/benchmark";
import {
  runModelBenchmark,
  runSchemaBenchmark,
  listAvailableBenchmarkModels,
} from "@/lib/benchmark-compare.functions";
import { evaluateBenchmarkRun } from "@/lib/benchmark-eval.functions";
import { useProjectDashboard } from "@/lib/dashboard-data";
import { maskForDisplay, sensitiveKeySet } from "@/lib/redact";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/benchmarking")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Compare AI models and label-profile versions against human-approved values, then audit extraction quality with AI-graded evaluations.",
      },
      { property: "og:title", content: "Benchmarking & Evals — LabelFactory" },
      {
        property: "og:description",
        content:
          "Model and schema comparison leaderboards, LLM-graded quality evaluations, and exportable reports for your labeling project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BenchmarkingRoute,
});

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type RunRow = {
  id: string;
  name: string;
  model_key: string | null;
  model_label: string | null;
  comparison_group_id: string | null;
  benchmark_mode: string;
  overall_score: number;
  documents_evaluated: number;
  fields_evaluated: number;
  comparisons: number;
  batch_labels: string[];
  profile_labels: string[];
  profile_ids: string[];
  created_at: string;
};

type FieldResultRow = FieldResult & { id: string; run_id: string };

type ComparisonGroup = {
  groupId: string;
  mode: string;
  createdAt: string;
  batchLabel: string;
  profileLabels: string[];
  runs: RunRow[];
};

type RunAggregate = {
  runId: string;
  label: string;
  overall: number;
  precision: number;
  recall: number;
  f1: number;
  missedRate: number;
  documentsEvaluated: number;
};

type FieldAttentionEntry = {
  field_key: string;
  field_label: string;
  issue_count: number;
  total: number;
  issue_rate: number;
  main_category: string | null;
  attention_level: "high" | "medium" | "low";
  suggested_action: string | null;
  examples: Array<{ document_name: string; category: string; suggested: string; final: string }>;
};

type DocumentRiskDoc = {
  document_id: string;
  document_name: string;
  issues: number;
  risk_level: "high" | "medium" | "low";
};

type DocumentRisk = {
  buckets: { high: number; medium: number; low: number; clear: number };
  documents: DocumentRiskDoc[];
};

type EvaluationRow = {
  id: string;
  run_id: string;
  faithfulness: number | null;
  completeness: number | null;
  consistency: number | null;
  hallucination_risk: number | null;
  field_attention: FieldAttentionEntry[];
  document_risk: DocumentRisk;
  recommendations: string[];
  ai_summary: string | null;
  created_at: string;
};

type ModelChoice = { provider: "openai" | "gemini"; modelId: string; label: string };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function groupRuns(rows: RunRow[]): ComparisonGroup[] {
  const map = new Map<string, ComparisonGroup>();
  for (const row of rows) {
    const groupId = row.comparison_group_id ?? row.id;
    let group = map.get(groupId);
    if (!group) {
      group = {
        groupId,
        mode: row.benchmark_mode,
        createdAt: row.created_at,
        batchLabel: row.batch_labels[0] ?? "—",
        profileLabels: row.profile_labels ?? [],
        runs: [],
      };
      map.set(groupId, group);
    }
    group.runs.push(row);
  }
  return [...map.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function aggregateRun(run: RunRow, fields: FieldResultRow[]): RunAggregate {
  const runFields = fields.filter((field) => field.run_id === run.id);
  const totalCompared = runFields.reduce((sum, field) => sum + field.total, 0);
  const totalMissed = runFields.reduce((sum, field) => sum + field.missed, 0);
  const avgPrecision = runFields.length
    ? runFields.reduce((sum, field) => sum + field.precision_score, 0) / runFields.length
    : 0;
  const avgRecall = runFields.length
    ? runFields.reduce((sum, field) => sum + field.recall_score, 0) / runFields.length
    : 0;
  const f1 = avgPrecision + avgRecall > 0 ? (2 * avgPrecision * avgRecall) / (avgPrecision + avgRecall) : 0;
  return {
    runId: run.id,
    label: run.model_label ?? run.name,
    overall: run.overall_score,
    precision: avgPrecision,
    recall: avgRecall,
    f1,
    missedRate: totalCompared === 0 ? 0 : totalMissed / totalCompared,
    documentsEvaluated: run.documents_evaluated,
  };
}

function buildBenchmarkSummary(winner: RunAggregate, runnerUp: RunAggregate | null): string {
  const parts: string[] = [
    `${winner.label} leads with ${percent(winner.f1)} F1 (${percent(winner.overall)} match rate across ${winner.documentsEvaluated} document(s)).`,
  ];
  if (runnerUp) {
    const gap = winner.f1 - runnerUp.f1;
    const gapDesc = gap >= 0.05 ? "a comfortable margin" : "only a narrow margin";
    parts.push(`It beats ${runnerUp.label} by ${gapDesc} — ${percent(Math.abs(gap))} F1.`);
  }
  if (winner.missedRate > 0.1) {
    parts.push(`Its main weakness is coverage: ${percent(winner.missedRate)} of fields come back empty.`);
  } else if (winner.precision < 0.85) {
    parts.push("Its main weakness is precision — some suggested values don't match the approved value.");
  } else {
    parts.push("Both accuracy and coverage look solid here.");
  }
  return parts.join(" ");
}

function modeLabel(mode: string) {
  return mode === "schema" ? "Schema versions" : "Models";
}

const CHART_CONFIG: ChartConfig = {
  overall: { label: "Match rate", color: "var(--chart-1)" },
  precision: { label: "Precision", color: "var(--chart-2)" },
  recall: { label: "Recall", color: "var(--chart-3)" },
  f1: { label: "F1", color: "var(--chart-4)" },
  coverage: { label: "Coverage", color: "var(--chart-1)" },
  missing: { label: "Missing", color: "var(--chart-5)" },
};

// ---------------------------------------------------------------------------
// Route shell
// ---------------------------------------------------------------------------

function BenchmarkingRoute() {
  return (
    <SectionPage
      title="Benchmarking & Evals"
      description="Compare AI models or label-profile versions against human-approved values, then audit extraction quality with AI-graded evaluations."
    >
      <BenchmarkingBody />
    </SectionPage>
  );
}

function BenchmarkingBody() {
  const { projectId } = useWorkspace();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["benchmark-groups", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<RunRow[]> => {
      const { data, error } = await supabase
        .from("benchmark_runs")
        .select(
          "id, name, model_key, model_label, comparison_group_id, benchmark_mode, overall_score, documents_evaluated, fields_evaluated, comparisons, batch_labels, profile_labels, profile_ids, created_at",
        )
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as unknown as RunRow[];
    },
  });

  const groups = useMemo(() => groupRuns(groupsQuery.data ?? []), [groupsQuery.data]);
  const activeGroup = groups.find((group) => group.groupId === activeGroupId) ?? null;

  const activeRunIds = activeGroup?.runs.map((run) => run.id) ?? [];
  const fieldsQuery = useQuery({
    queryKey: ["benchmark-group-fields", activeRunIds.join(",")],
    enabled: activeRunIds.length > 0,
    queryFn: async (): Promise<FieldResultRow[]> => {
      const { data, error } = await supabase
        .from("benchmark_field_results")
        .select(
          "id, run_id, field_key, field_label, total, matched, near_matched, missed, rejected, match_rate, precision_score, recall_score, failure_pattern, mismatches",
        )
        .in("run_id", activeRunIds);
      if (error) throw error;
      return (data ?? []) as unknown as FieldResultRow[];
    },
  });

  // Field-level values in this group's runs came from re-extraction against
  // one or more label profiles — mask any field those profiles marked
  // Sensitive when the drilldown/eval views show it on screen (reversible,
  // same trust boundary as the Annotate & Label screen; see @/lib/redact).
  const activeProfileIds = useMemo(
    () => [...new Set(activeGroup?.runs.flatMap((run) => run.profile_ids ?? []) ?? [])],
    [activeGroup],
  );
  const sensitiveKeysQuery = useQuery({
    queryKey: ["benchmark-sensitive-keys", activeProfileIds.join(",")],
    enabled: activeProfileIds.length > 0,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("label_profiles")
        .select("fields")
        .in("id", activeProfileIds);
      if (error) throw error;
      const keys = new Set<string>();
      for (const row of data ?? []) for (const key of sensitiveKeySet(row.fields)) keys.add(key);
      return keys;
    },
  });
  const sensitiveKeys = sensitiveKeysQuery.data ?? new Set<string>();

  return (
    <Tabs defaultValue="dashboard" className="space-y-4">
      <TabsList className="h-8 rounded-lg bg-muted/60 p-0.5">
        <TabsTrigger value="dashboard" className="h-6 px-3 text-xs">
          Dashboard
        </TabsTrigger>
        <TabsTrigger value="benchmarking" className="h-6 px-3 text-xs">
          Benchmarking
        </TabsTrigger>
        <TabsTrigger value="evaluations" className="h-6 px-3 text-xs">
          Evaluations
        </TabsTrigger>
        <TabsTrigger value="export" className="h-6 px-3 text-xs">
          Export
        </TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="space-y-4">
        <DashboardTab
          groups={groups}
          groupsLoading={groupsQuery.isPending}
          activeGroup={activeGroup}
          onSelectGroup={setActiveGroupId}
          onGroupsChanged={() => groupsQuery.refetch()}
        />
      </TabsContent>

      <TabsContent value="benchmarking" className="space-y-4">
        <BenchmarkingTab
          projectId={projectId}
          groups={groups}
          activeGroup={activeGroup}
          fields={fieldsQuery.data ?? []}
          fieldsLoading={fieldsQuery.isPending && activeRunIds.length > 0}
          sensitiveKeys={sensitiveKeys}
          onGroupCreated={setActiveGroupId}
        />
      </TabsContent>

      <TabsContent value="evaluations" className="space-y-4">
        <EvaluationsTab
          groups={groups}
          activeGroup={activeGroup}
          fields={fieldsQuery.data ?? []}
          sensitiveKeys={sensitiveKeys}
        />
      </TabsContent>

      <TabsContent value="export" className="space-y-4">
        <ExportTab groups={groups} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Dashboard tab
// ---------------------------------------------------------------------------

function DashboardTab({
  groups,
  groupsLoading,
  activeGroup,
  onSelectGroup,
  onGroupsChanged,
}: {
  groups: ComparisonGroup[];
  groupsLoading: boolean;
  activeGroup: ComparisonGroup | null;
  onSelectGroup: (groupId: string | null) => void;
  onGroupsChanged: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = groups.filter((group) =>
    `${group.batchLabel} ${group.profileLabels.join(" ")} ${modeLabel(group.mode)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const totalRuns = groups.reduce((sum, group) => sum + group.runs.length, 0);
  const bestOverall = activeGroup
    ? Math.max(...activeGroup.runs.map((run) => run.overall_score))
    : 0;

  const deleteGroup = useMutation({
    mutationFn: async (group: ComparisonGroup) => {
      const { error } = await supabase
        .from("benchmark_runs")
        .delete()
        .in(
          "id",
          group.runs.map((run) => run.id),
        );
      if (error) throw error;
    },
    onSuccess: (_data, group) => {
      toast.success("Comparison deleted");
      if (activeGroup?.groupId === group.groupId) onSelectGroup(null);
      onGroupsChanged();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not delete"),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Comparisons run" value={String(groups.length)} />
        <Tile label="Total runs" value={String(totalRuns)} />
        <Tile
          label="Active comparison — best match rate"
          value={activeGroup ? percent(bestOverall) : "—"}
        />
        <Tile
          label="Documents in active comparison"
          value={activeGroup ? String(activeGroup.runs[0]?.documents_evaluated ?? 0) : "—"}
        />
      </div>

      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Past comparisons</h2>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by batch or profile…"
            className="h-8 w-56 rounded-md border border-input bg-transparent px-2.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {groupsLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No benchmark comparisons yet — run one from the Benchmarking tab.
          </p>
        ) : (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {filtered.map((group) => (
              <button
                key={group.groupId}
                onClick={() => onSelectGroup(group.groupId)}
                className={cn(
                  "flex w-56 shrink-0 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  activeGroup?.groupId === group.groupId
                    ? "border-primary/60 bg-primary/5"
                    : "border-border/60 hover:bg-muted/40",
                )}
              >
                <span className="text-xs font-medium">{group.batchLabel}</span>
                <span className="text-[11px] text-muted-foreground">
                  {modeLabel(group.mode)} · {group.runs.length} configs
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(group.createdAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {activeGroup ? (
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Selected comparison</h2>
              <p className="text-xs text-muted-foreground">
                {activeGroup.batchLabel} · {modeLabel(activeGroup.mode)}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive hover:text-destructive"
              disabled={deleteGroup.isPending}
              onClick={() => {
                if (window.confirm("Delete this comparison and all its runs?")) {
                  deleteGroup.mutate(activeGroup);
                }
              }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
              Delete
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Config</TableHead>
                <TableHead className="text-xs">Match rate</TableHead>
                <TableHead className="text-xs">Documents</TableHead>
                <TableHead className="text-xs">Fields</TableHead>
                <TableHead className="text-right text-xs">Rank</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...activeGroup.runs]
                .sort((a, b) => b.overall_score - a.overall_score)
                .map((run, index) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-sm font-medium">
                      {run.model_label ?? run.name}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">{percent(run.overall_score)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{run.documents_evaluated}</TableCell>
                    <TableCell className="text-sm tabular-nums">{run.fields_evaluated}</TableCell>
                    <TableCell className="text-right">
                      {index === 0 ? (
                        <Badge className="rounded-full px-2 py-0 text-[11px]">
                          <Trophy className="mr-1 size-3" aria-hidden="true" />
                          Winner
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">#{index + 1}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Benchmarking tab
// ---------------------------------------------------------------------------

function BenchmarkingTab({
  projectId,
  groups,
  activeGroup,
  fields,
  fieldsLoading,
  sensitiveKeys,
  onGroupCreated,
}: {
  projectId: string | null;
  groups: ComparisonGroup[];
  activeGroup: ComparisonGroup | null;
  fields: FieldResultRow[];
  fieldsLoading: boolean;
  sensitiveKeys: Set<string>;
  onGroupCreated: (groupId: string) => void;
}) {
  const queryClient = useQueryClient();
  const dashboard = useProjectDashboard(projectId);
  const batches = dashboard.data?.batches ?? [];

  const [mode, setMode] = useState<"model" | "schema">("model");
  const [batchId, setBatchId] = useState<string>("");
  const [profileId, setProfileId] = useState<string>("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [profileFamily, setProfileFamily] = useState<string>("");
  const [selectedVersionIds, setSelectedVersionIds] = useState<string[]>([]);
  const [drilldown, setDrilldown] = useState<FieldResultRow | null>(null);
  const [drilldownRevealed, setDrilldownRevealed] = useState(false);
  const drilldownSensitive = Boolean(drilldown && sensitiveKeys.has(drilldown.field_key));

  const profilesQuery = useQuery({
    queryKey: ["benchmark-profiles", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_profiles")
        .select("id, name, version, status")
        .eq("project_id", projectId!)
        .order("name")
        .order("version");
      if (error) throw error;
      return data ?? [];
    },
  });
  const profiles = profilesQuery.data ?? [];

  const modelsQueryFn = useServerFn(listAvailableBenchmarkModels);
  const modelsQuery = useQuery({
    queryKey: ["benchmark-available-models"],
    staleTime: Infinity,
    queryFn: async () => (await modelsQueryFn({ data: {} })).models as ModelChoice[],
  });
  const availableModels = modelsQuery.data ?? [];

  const profileFamilies = useMemo(() => {
    const byName = new Map<string, typeof profiles>();
    for (const profile of profiles) {
      const list = byName.get(profile.name) ?? [];
      list.push(profile);
      byName.set(profile.name, list);
    }
    return [...byName.entries()]
      .map(([name, versions]) => ({ name, versions }))
      .filter((family) => family.versions.length >= 2);
  }, [profiles]);

  const eligibleBatches =
    mode === "model" && profileId
      ? batches.filter((batch) => batch.profileId === profileId)
      : batches;

  const runModelFn = useServerFn(runModelBenchmark);
  const runSchemaFn = useServerFn(runSchemaBenchmark);

  const runComparison = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      if (!batchId) throw new Error("Select a batch to evaluate.");

      if (mode === "model") {
        if (!profileId) throw new Error("Select a label profile.");
        if (selectedModelIds.length < 2) throw new Error("Pick at least 2 models to compare.");
        const models = selectedModelIds
          .map((id) => availableModels.find((m) => `${m.provider}:${m.modelId}` === id))
          .filter(Boolean) as ModelChoice[];
        return runModelFn({ data: { projectId, batchId, profileId, models } });
      }

      if (selectedVersionIds.length < 2) throw new Error("Pick at least 2 profile versions to compare.");
      return runSchemaFn({
        data: { projectId, batchId, profileVersionIds: selectedVersionIds },
      });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["benchmark-groups", projectId] });
      onGroupCreated(result.comparisonGroupId);
      toast.success(`Comparison complete — ${result.runs.length} configuration(s) evaluated`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Benchmark failed"),
  });

  const aggregates = activeGroup
    ? activeGroup.runs.map((run) => aggregateRun(run, fields)).sort((a, b) => b.f1 - a.f1)
    : [];
  const winner = aggregates[0] ?? null;
  const runnerUp = aggregates[1] ?? null;

  const chartData = aggregates.map((agg) => ({
    name: agg.label.length > 18 ? `${agg.label.slice(0, 16)}…` : agg.label,
    overall: Number((agg.overall * 100).toFixed(1)),
    precision: Number((agg.precision * 100).toFixed(1)),
    recall: Number((agg.recall * 100).toFixed(1)),
    f1: Number((agg.f1 * 100).toFixed(1)),
    coverage: Number(((1 - agg.missedRate) * 100).toFixed(1)),
    missing: Number((agg.missedRate * 100).toFixed(1)),
  }));

  const activeFields = winner
    ? [...fields.filter((field) => field.run_id === winner.runId)].sort(
        (a, b) => a.match_rate - b.match_rate,
      )
    : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="panel h-fit space-y-4 p-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Run a comparison</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Re-runs extraction on approved documents so candidates are measured against the
              same human-approved values.
            </p>
          </div>

          <div className="flex rounded-md bg-muted/60 p-0.5 text-xs">
            <button
              onClick={() => setMode("model")}
              className={cn(
                "flex-1 rounded px-2 py-1 font-medium transition-colors",
                mode === "model" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              Compare models
            </button>
            <button
              onClick={() => setMode("schema")}
              className={cn(
                "flex-1 rounded px-2 py-1 font-medium transition-colors",
                mode === "schema" ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              Compare schema versions
            </button>
          </div>

          {mode === "model" ? (
            <div>
              <p className="text-xs font-medium">Label profile</p>
              <Select value={profileId} onValueChange={(value) => { setProfileId(value); setBatchId(""); }}>
                <SelectTrigger className="mt-1.5 h-8 text-xs">
                  <SelectValue placeholder="Choose a profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id} className="text-xs">
                      {profile.name} · v{profile.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium">Profile to compare versions of</p>
              {profileFamilies.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No profile has 2+ versions yet — publish a new version of an existing profile
                  first.
                </p>
              ) : (
                <Select
                  value={profileFamily}
                  onValueChange={(value) => {
                    setProfileFamily(value);
                    setSelectedVersionIds([]);
                  }}
                >
                  <SelectTrigger className="mt-1.5 h-8 text-xs">
                    <SelectValue placeholder="Choose a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profileFamilies.map((family) => (
                      <SelectItem key={family.name} value={family.name} className="text-xs">
                        {family.name} ({family.versions.length} versions)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {profileFamily ? (
                <div className="mt-2 space-y-1.5">
                  {profileFamilies
                    .find((family) => family.name === profileFamily)
                    ?.versions.map((version) => (
                      <label key={version.id} className="flex items-center gap-2 text-sm" htmlFor={`ver-${version.id}`}>
                        <Checkbox
                          id={`ver-${version.id}`}
                          checked={selectedVersionIds.includes(version.id)}
                          disabled={
                            !selectedVersionIds.includes(version.id) && selectedVersionIds.length >= 3
                          }
                          onCheckedChange={() =>
                            setSelectedVersionIds((list) =>
                              list.includes(version.id)
                                ? list.filter((id) => id !== version.id)
                                : [...list, version.id],
                            )
                          }
                        />
                        <span className="text-sm">
                          v{version.version} · {version.status}
                        </span>
                      </label>
                    ))}
                  <p className="text-xs text-muted-foreground">Pick 2-3 versions.</p>
                </div>
              ) : null}
            </div>
          )}

          <div>
            <p className="text-xs font-medium">Batch</p>
            <Select value={batchId} onValueChange={setBatchId}>
              <SelectTrigger className="mt-1.5 h-8 text-xs">
                <SelectValue placeholder="Choose a batch" />
              </SelectTrigger>
              <SelectContent>
                {eligibleBatches.map((batch) => (
                  <SelectItem key={batch.id} value={batch.id} className="text-xs">
                    {batch.name} · {batch.approvedCount} approved
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "model" ? (
            <div>
              <p className="text-xs font-medium">Models (pick 2-3)</p>
              {availableModels.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No AI provider is configured — set OPENAI_API_KEY or GEMINI_API_KEY.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {availableModels.map((choice) => {
                    const id = `${choice.provider}:${choice.modelId}`;
                    return (
                      <label key={id} className="flex items-center gap-2 text-sm" htmlFor={`model-${id}`}>
                        <Checkbox
                          id={`model-${id}`}
                          checked={selectedModelIds.includes(id)}
                          disabled={!selectedModelIds.includes(id) && selectedModelIds.length >= 3}
                          onCheckedChange={() =>
                            setSelectedModelIds((list) =>
                              list.includes(id) ? list.filter((item) => item !== id) : [...list, id],
                            )
                          }
                        />
                        <span className="text-sm">{choice.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          <Button
            size="sm"
            className="h-8 w-full text-sm"
            disabled={runComparison.isPending}
            onClick={() => runComparison.mutate()}
          >
            {runComparison.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="size-3.5" aria-hidden="true" />
            )}
            Run benchmark
          </Button>
          {runComparison.isPending ? (
            <p className="text-center text-xs text-muted-foreground">
              Re-running extraction per configuration — this can take a minute depending on how
              many documents are approved.
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {!activeGroup ? (
            <div className="panel px-4 py-10 text-center text-sm text-muted-foreground">
              Run a comparison, or pick one from the Dashboard tab, to see the leaderboard here.
            </div>
          ) : fieldsLoading ? (
            <div className="panel flex justify-center py-10">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : (
            <>
              {winner ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <MetricCard title="Winner" value={winner.label} icon={<Trophy className="size-4" />} />
                  <MetricCard title="Match rate" value={percent(winner.overall)} />
                  <MetricCard title="Precision" value={percent(winner.precision)} />
                  <MetricCard title="Recall" value={percent(winner.recall)} />
                  <MetricCard title="F1" value={percent(winner.f1)} />
                </div>
              ) : null}

              {winner ? (
                <div className="panel p-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
                    <h3 className="text-sm font-semibold tracking-tight">Benchmark insight</h3>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {buildBenchmarkSummary(winner, runnerUp)}
                  </p>
                </div>
              ) : null}

              {aggregates.length > 1 ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <ChartCard title="Accuracy by configuration">
                    <ChartContainer config={CHART_CONFIG} className="h-64 w-full">
                      <BarChart data={chartData}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                        <YAxis tickLine={false} axisLine={false} fontSize={11} unit="%" />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="overall" fill="var(--color-overall)" radius={4} />
                        <Bar dataKey="precision" fill="var(--color-precision)" radius={4} />
                        <Bar dataKey="recall" fill="var(--color-recall)" radius={4} />
                      </BarChart>
                    </ChartContainer>
                  </ChartCard>
                  <ChartCard title="Quality profile">
                    <ChartContainer config={CHART_CONFIG} className="h-64 w-full">
                      <RadarChart data={chartData} outerRadius="75%">
                        <PolarGrid />
                        <PolarAngleAxis dataKey="name" fontSize={11} />
                        <Radar
                          dataKey="overall"
                          stroke="var(--color-overall)"
                          fill="var(--color-overall)"
                          fillOpacity={0.25}
                        />
                        <Radar
                          dataKey="f1"
                          stroke="var(--color-f1)"
                          fill="var(--color-f1)"
                          fillOpacity={0.15}
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                      </RadarChart>
                    </ChartContainer>
                  </ChartCard>
                </div>
              ) : null}

              {aggregates.length > 1 ? (
                <ChartCard title="Coverage vs. missing by configuration">
                  <ChartContainer config={CHART_CONFIG} className="h-56 w-full">
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                      <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} unit="%" />
                      <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} fontSize={11} width={110} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="coverage" stackId="coverage" fill="var(--color-coverage)" radius={[4, 0, 0, 4]} />
                      <Bar dataKey="missing" stackId="coverage" fill="var(--color-missing)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ChartContainer>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Coverage is the share of fields where the model returned a value at all;
                    missing is the rest — an empty suggestion the reviewer had to fill in by hand.
                  </p>
                </ChartCard>
              ) : null}

              <div className="panel">
                <div className="border-b border-border/60 px-4 py-3">
                  <h2 className="text-sm font-semibold tracking-tight">
                    Field-level results — {winner?.label}
                  </h2>
                  <p className="text-xs text-muted-foreground">Leading configuration, worst fields first.</p>
                </div>
                {activeFields.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No comparable fields in this run.
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
                      {activeFields.map((field) => (
                        <TableRow key={field.field_key}>
                          <TableCell className="text-sm font-medium">
                            {field.field_label}
                            <span className="block text-xs text-muted-foreground">
                              {field.total} compared
                            </span>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            <div className="flex items-center gap-2">
                              <Progress value={field.match_rate * 100} className="h-1.5 w-16" />
                              {percent(field.match_rate)}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{percent(field.precision_score)}</TableCell>
                          <TableCell className="text-sm tabular-nums">{percent(field.recall_score)}</TableCell>
                          <TableCell className="max-w-xs text-xs text-muted-foreground">
                            {field.failure_pattern ?? "No systematic failures detected."}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={(field.mismatches ?? []).length === 0}
                              onClick={() => {
                                setDrilldownRevealed(false);
                                setDrilldown(field);
                              }}
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
            </>
          )}

          <div className="panel">
            <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
              <History className="size-4 text-muted-foreground" aria-hidden="true" />
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Comparison history</h2>
                <p className="text-xs text-muted-foreground">All comparisons run in this project.</p>
              </div>
            </div>
            {groups.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No comparisons yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">When</TableHead>
                    <TableHead className="text-xs">Batch</TableHead>
                    <TableHead className="text-xs">Mode</TableHead>
                    <TableHead className="text-xs">Configs</TableHead>
                    <TableHead className="text-right text-xs">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => (
                    <TableRow key={group.groupId}>
                      <TableCell className="text-sm">{new Date(group.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">{group.batchLabel}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{modeLabel(group.mode)}</TableCell>
                      <TableCell className="text-sm tabular-nums">{group.runs.length}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => onGroupCreated(group.groupId)}
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

      <Dialog
        open={Boolean(drilldown)}
        onOpenChange={(open) => {
          if (!open) setDrilldown(null);
          setDrilldownRevealed(false);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle className="text-base">Mismatches — {drilldown?.field_label}</DialogTitle>
              {drilldownSensitive ? <Badge variant="destructive">Sensitive</Badge> : null}
              {drilldownSensitive ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => setDrilldownRevealed((current) => !current)}
                  aria-label={drilldownRevealed ? "Hide values" : "Reveal values"}
                >
                  {drilldownRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </Button>
              ) : null}
            </div>
            <DialogDescription className="text-sm">
              Documents where this configuration's value differed from the human-approved value.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Document</TableHead>
                  <TableHead className="text-xs">Issue</TableHead>
                  <TableHead className="text-xs">Suggested</TableHead>
                  <TableHead className="text-xs">Approved value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {((drilldown?.mismatches ?? []) as MismatchSample[]).map((sample, index) => {
                  const hidden = drilldownSensitive && !drilldownRevealed;
                  return (
                    <TableRow key={`${sample.document_id}-${index}`}>
                      <TableCell className="max-w-[14rem] truncate text-sm">{sample.filename}</TableCell>
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
                        {hidden ? maskForDisplay(sample.suggested) || "—" : sample.suggested || "—"}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-sm">
                        {hidden ? maskForDisplay(sample.final) || "—" : sample.final || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evaluations tab
// ---------------------------------------------------------------------------

function EvaluationsTab({
  groups,
  activeGroup,
  fields,
  sensitiveKeys,
}: {
  groups: ComparisonGroup[];
  activeGroup: ComparisonGroup | null;
  fields: FieldResultRow[];
  sensitiveKeys: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string>("");
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [exampleRevealed, setExampleRevealed] = useState(false);

  const allRuns = groups.flatMap((group) => group.runs);
  const effectiveRunId = runId || activeGroup?.runs[0]?.id || allRuns[0]?.id || "";
  const selectedRun = allRuns.find((run) => run.id === effectiveRunId) ?? null;

  const evalQuery = useQuery({
    queryKey: ["benchmark-eval", effectiveRunId],
    enabled: Boolean(effectiveRunId),
    queryFn: async (): Promise<EvaluationRow | null> => {
      const { data, error } = await supabase
        .from("benchmark_evaluations")
        .select("*")
        .eq("run_id", effectiveRunId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as EvaluationRow) ?? null;
    },
  });

  const runFieldsQuery = useQuery({
    queryKey: ["benchmark-eval-run-fields", effectiveRunId],
    enabled: Boolean(effectiveRunId) && !fields.some((field) => field.run_id === effectiveRunId),
    queryFn: async (): Promise<FieldResultRow[]> => {
      const { data, error } = await supabase
        .from("benchmark_field_results")
        .select(
          "id, run_id, field_key, field_label, total, matched, near_matched, missed, rejected, match_rate, precision_score, recall_score, failure_pattern, mismatches",
        )
        .eq("run_id", effectiveRunId);
      if (error) throw error;
      return (data ?? []) as unknown as FieldResultRow[];
    },
  });

  const runFields = fields.some((field) => field.run_id === effectiveRunId)
    ? fields.filter((field) => field.run_id === effectiveRunId)
    : runFieldsQuery.data ?? [];

  const runEvalFn = useServerFn(evaluateBenchmarkRun);
  const evaluate = useMutation({
    mutationFn: async () => {
      if (!effectiveRunId) throw new Error("Pick a run to evaluate.");
      return runEvalFn({ data: { runId: effectiveRunId } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["benchmark-eval", effectiveRunId] });
      toast.success("Evaluation complete");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Evaluation failed"),
  });

  const totalCompared = runFields.reduce((sum, field) => sum + field.total, 0);
  const totalMissed = runFields.reduce((sum, field) => sum + field.missed, 0);
  const totalRejected = runFields.reduce((sum, field) => sum + field.rejected, 0);
  const totalNear = runFields.reduce((sum, field) => sum + field.near_matched, 0);
  const totalMatched = runFields.reduce((sum, field) => sum + field.matched, 0);
  const totalWrong = Math.max(0, totalCompared - totalMatched - totalNear - totalMissed - totalRejected);

  const evaluation = evalQuery.data ?? null;
  const faithfulness = evaluation?.faithfulness ?? 0;
  const completeness = evaluation?.completeness ?? 0;
  const consistency = evaluation?.consistency ?? 0;
  const hallucinationRisk = evaluation?.hallucination_risk ?? 0;

  const groundingScore = faithfulness * (1 - hallucinationRisk);
  const formatCompliance = totalCompared === 0 ? 1 : 1 - totalNear / totalCompared;
  const fieldStability =
    runFields.length === 0
      ? 1
      : 1 - runFields.reduce((sum, f) => sum + (f.total === 0 ? 0 : (f.total - f.matched) / f.total), 0) / runFields.length;
  const highAttentionRatio = evaluation
    ? evaluation.field_attention.filter((f) => f.attention_level === "high").length /
      Math.max(1, evaluation.field_attention.length)
    : 0;
  const reviewPriority =
    0.35 * (1 - groundingScore) +
    0.2 * (1 - completeness) +
    0.2 * (totalCompared === 0 ? 0 : totalNear / totalCompared) +
    0.15 * hallucinationRisk +
    0.1 * highAttentionRatio;

  const selectedField = evaluation?.field_attention.find((f) => f.field_key === selectedFieldKey) ?? null;

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[16rem] flex-1">
          <p className="text-xs font-medium">Benchmark run to evaluate</p>
          <Select value={effectiveRunId} onValueChange={setRunId}>
            <SelectTrigger className="mt-1.5 h-8 text-xs">
              <SelectValue placeholder="Choose a run" />
            </SelectTrigger>
            <SelectContent>
              {allRuns.map((run) => (
                <SelectItem key={run.id} value={run.id} className="text-xs">
                  {run.model_label ?? run.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          className="h-8 text-sm"
          disabled={!effectiveRunId || evaluate.isPending}
          onClick={() => evaluate.mutate()}
        >
          {evaluate.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3.5" aria-hidden="true" />
          )}
          {evaluation ? "Re-run evaluation" : "Run evaluation"}
        </Button>
      </div>

      {!selectedRun ? (
        <div className="panel px-4 py-10 text-center text-sm text-muted-foreground">
          Run a benchmark comparison first, then evaluate one of its configurations here.
        </div>
      ) : !evaluation ? (
        <div className="panel px-4 py-10 text-center text-sm text-muted-foreground">
          {evaluate.isPending ? "Running the AI-graded evaluation…" : "No evaluation yet for this run — click Run evaluation."}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <MiniMetric title="Error rate" value={percent(totalCompared === 0 ? 0 : 1 - totalMatched / totalCompared)} />
            <MiniMetric title="Missing" value={percent(totalCompared === 0 ? 0 : totalMissed / totalCompared)} />
            <MiniMetric title="Wrong value" value={percent(totalCompared === 0 ? 0 : totalWrong / totalCompared)} />
            <MiniMetric title="Format issue" value={percent(totalCompared === 0 ? 0 : totalNear / totalCompared)} />
            <MiniMetric title="Hallucination risk" value={percent(hallucinationRisk)} />
          </div>

          <div className="panel p-4">
            <h3 className="text-sm font-semibold tracking-tight">Quality signals</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <MiniMetric title="Faithfulness" value={percent(faithfulness)} />
              <MiniMetric title="Completeness" value={percent(completeness)} />
              <MiniMetric title="Consistency" value={percent(consistency)} />
              <MiniMetric title="Hallucination risk" value={percent(hallucinationRisk)} />
              <MiniMetric title="Grounding score" value={percent(groundingScore)} />
              <MiniMetric title="Format compliance" value={percent(formatCompliance)} />
              <MiniMetric title="Field stability" value={percent(fieldStability)} />
              <MiniMetric title="Review priority" value={percent(reviewPriority)} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="panel p-3">
              <h3 className="px-1 text-sm font-semibold tracking-tight">Field attention</h3>
              {evaluation.field_attention.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  No fields need attention — every field matched cleanly.
                </p>
              ) : (
                <div className="mt-2 space-y-1">
                  {evaluation.field_attention.map((field) => (
                    <button
                      key={field.field_key}
                      onClick={() => {
                        setExampleRevealed(false);
                        setSelectedFieldKey(field.field_key);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        selectedFieldKey === field.field_key ? "bg-primary/10" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="truncate">{field.field_label}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {field.issue_count}/{field.total}
                        </span>
                        <AttentionBadge level={field.attention_level} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="panel p-4">
              {!selectedField ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Select a field on the left to see its detail.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold tracking-tight">{selectedField.field_label}</h3>
                      {sensitiveKeys.has(selectedField.field_key) ? (
                        <Badge variant="destructive">Sensitive</Badge>
                      ) : null}
                      {sensitiveKeys.has(selectedField.field_key) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => setExampleRevealed((current) => !current)}
                          aria-label={exampleRevealed ? "Hide values" : "Reveal values"}
                        >
                          {exampleRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                        </Button>
                      ) : null}
                    </div>
                    <AttentionBadge level={selectedField.attention_level} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MiniMetric title="Issues" value={String(selectedField.issue_count)} />
                    <MiniMetric title="Issue rate" value={percent(selectedField.issue_rate)} />
                    <MiniMetric title="Main type" value={selectedField.main_category ?? "mixed"} />
                  </div>
                  {selectedField.suggested_action ? (
                    <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                      {selectedField.suggested_action}
                    </p>
                  ) : null}
                  {selectedField.examples.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Document</TableHead>
                          <TableHead className="text-xs">Category</TableHead>
                          <TableHead className="text-xs">Suggested</TableHead>
                          <TableHead className="text-xs">Approved</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedField.examples.map((example, index) => {
                          const hidden = sensitiveKeys.has(selectedField.field_key) && !exampleRevealed;
                          return (
                            <TableRow key={index}>
                              <TableCell className="max-w-[10rem] truncate text-xs">{example.document_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{example.category}</TableCell>
                              <TableCell className="max-w-[8rem] truncate text-xs">
                                {hidden ? maskForDisplay(example.suggested) || "—" : example.suggested || "—"}
                              </TableCell>
                              <TableCell className="max-w-[8rem] truncate text-xs">
                                {hidden ? maskForDisplay(example.final) || "—" : example.final || "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          <div className="panel p-4">
            <h3 className="text-sm font-semibold tracking-tight">Document risk</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <RiskTile label="High risk" value={evaluation.document_risk.buckets.high} tone="high" />
              <RiskTile label="Medium risk" value={evaluation.document_risk.buckets.medium} tone="medium" />
              <RiskTile label="Low risk" value={evaluation.document_risk.buckets.low} tone="low" />
              <RiskTile label="Clear" value={evaluation.document_risk.buckets.clear} tone="clear" />
            </div>
            {evaluation.document_risk.documents.length > 0 ? (
              <div className="mt-3 space-y-1">
                {evaluation.document_risk.documents.slice(0, 5).map((doc) => (
                  <div
                    key={doc.document_id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                  >
                    <span className="truncate">{doc.document_name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {doc.issues} issue(s)
                      <RiskBadge level={doc.risk_level} />
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="panel p-4">
            <h3 className="text-sm font-semibold tracking-tight">Remediation plan</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <RiskTile
                label="Fix now"
                value={evaluation.field_attention.filter((f) => f.attention_level === "high").length}
                tone="high"
              />
              <RiskTile
                label="Review next"
                value={evaluation.field_attention.filter((f) => f.attention_level === "medium").length}
                tone="medium"
              />
              <RiskTile
                label="Monitor"
                value={evaluation.field_attention.filter((f) => f.attention_level === "low").length}
                tone="low"
              />
            </div>
            {evaluation.field_attention[0] ? (
              <p className="mt-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                Top fix: <span className="font-medium text-foreground">{evaluation.field_attention[0].field_label}</span> —{" "}
                {evaluation.field_attention[0].suggested_action}
              </p>
            ) : null}
            <div className="mt-3 space-y-2">
              <ProgressMeter
                label="Open error load"
                value={totalCompared === 0 ? 0 : Math.round(((totalCompared - totalMatched) / totalCompared) * 100)}
              />
              <ProgressMeter
                label="Fields under control"
                value={
                  runFields.length === 0
                    ? 100
                    : Math.round(
                        (runFields.filter((f) => f.total === 0 || f.matched / f.total >= 0.85).length /
                          runFields.length) *
                          100,
                      )
                }
              />
            </div>
          </div>

          <div className="panel p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-semibold tracking-tight">Recommendations</h3>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{evaluation.ai_summary}</p>
            {evaluation.recommendations.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {evaluation.recommendations.map((rec, index) => (
                  <li key={index} className="text-sm text-muted-foreground">
                    · {rec}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export tab
// ---------------------------------------------------------------------------

function ExportTab({ groups }: { groups: ComparisonGroup[] }) {
  const [groupId, setGroupId] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

  const group = groups.find((g) => g.groupId === groupId) ?? null;

  const exportGroup = async () => {
    if (!group) {
      toast.error("Pick a comparison to export.");
      return;
    }
    setDownloading(true);
    try {
      const { data, error } = await supabase
        .from("benchmark_field_results")
        .select(
          "run_id, field_key, field_label, total, matched, near_matched, missed, rejected, match_rate, precision_score, recall_score, failure_pattern",
        )
        .in(
          "run_id",
          group.runs.map((run) => run.id),
        );
      if (error) throw error;

      const runLabelById = new Map(group.runs.map((run) => [run.id, run.model_label ?? run.name]));
      const header = [
        "configuration",
        "field_key",
        "field_label",
        "total",
        "matched",
        "near_matched",
        "missed",
        "rejected",
        "match_rate",
        "precision_score",
        "recall_score",
        "failure_pattern",
      ];
      const rows = (data ?? []).map((row) =>
        [
          runLabelById.get(row.run_id) ?? row.run_id,
          row.field_key,
          row.field_label ?? "",
          row.total,
          row.matched,
          row.near_matched,
          row.missed,
          row.rejected,
          row.match_rate,
          row.precision_score,
          row.recall_score,
          row.failure_pattern ?? "",
        ]
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      );
      const csv = [header.join(","), ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `benchmark-${group.batchLabel.replace(/\W+/g, "-").toLowerCase()}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="panel max-w-xl space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Export a benchmark report</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Downloads per-field results for every configuration in the comparison as CSV.
        </p>
      </div>
      <div>
        <p className="text-xs font-medium">Comparison</p>
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="mt-1.5 h-8 text-xs">
            <SelectValue placeholder="Choose a comparison" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.groupId} value={g.groupId} className="text-xs">
                {g.batchLabel} · {new Date(g.createdAt).toLocaleDateString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" className="h-8 text-sm" disabled={!groupId || downloading} onClick={exportGroup}>
        {downloading ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-3.5" aria-hidden="true" />
        )}
        Download report (CSV)
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function MetricCard({ title, value, icon }: { title: string; value: string; icon?: ReactNode }) {
  return (
    <div className="panel p-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {title}
      </p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function MiniMetric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2.5">
      <p className="text-[11px] text-muted-foreground">{title}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel p-4">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function AttentionBadge({ level }: { level: "high" | "medium" | "low" }) {
  const tone =
    level === "high"
      ? "bg-destructive/10 text-destructive"
      : level === "medium"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", tone)}>{level}</span>
  );
}

function RiskBadge({ level }: { level: "high" | "medium" | "low" | "clear" }) {
  const tone =
    level === "high"
      ? "bg-destructive/10 text-destructive"
      : level === "medium"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : level === "low"
          ? "bg-muted text-muted-foreground"
          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", tone)}>{level}</span>
  );
}

function RiskTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "high" | "medium" | "low" | "clear";
}) {
  const toneClass =
    tone === "high"
      ? "text-destructive"
      : tone === "medium"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "clear"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border/60 p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

function ProgressMeter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <Progress value={value} className="mt-1 h-1.5" />
    </div>
  );
}
