import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
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
import { supabase } from "@/integrations/supabase/client";
import { useProjectDashboard } from "@/lib/dashboard-data";
import {
  buildExportRecords,
  fetchTrainingPairs,
  groupCount,
  serializeExport,
  type ExportFormat,
} from "@/lib/rlhf";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/rlhf")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Review human-correction training pairs from document labeling and export them for fine-tuning.",
      },
      { property: "og:title", content: "RLHF Workbench — LabelFactory" },
      {
        property: "og:description",
        content:
          "Accumulated AI-vs-human correction pairs, counts by field and profile, and JSON/JSONL exports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SectionPage
      title="RLHF Workbench"
      description="Every correction a reviewer makes in Annotate & Label becomes a training pair: the AI's suggestion versus the human's final value."
    >
      <RlhfBody />
    </SectionPage>
  ),
});

function RlhfBody() {
  const { projectId } = useWorkspace();
  const queryClient = useQueryClient();
  const dashboard = useProjectDashboard(projectId);

  const [batchId, setBatchId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [format, setFormat] = useState<ExportFormat>("jsonl");
  const [exportName, setExportName] = useState("");

  const batches = dashboard.data?.batches ?? [];

  const pairsQuery = useQuery({
    queryKey: ["rlhf-pairs", projectId, batchId, from, to],
    enabled: Boolean(projectId),
    queryFn: () =>
      fetchTrainingPairs(projectId!, {
        batchIds: batchId === "all" ? undefined : [batchId],
        from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      }),
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

  const pairs = useMemo(() => pairsQuery.data ?? [], [pairsQuery.data]);
  const byField = useMemo(() => groupCount(pairs, (pair) => pair.fieldLabel), [pairs]);
  const byProfile = useMemo(() => groupCount(pairs, (pair) => pair.profileLabel), [pairs]);

  const records = useMemo(() => buildExportRecords(pairs), [pairs]);
  const preview = useMemo(
    () => serializeExport(records.slice(0, 5), format),
    [records, format],
  );

  const saveExport = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      if (records.length === 0) throw new Error("There are no training pairs to export yet.");
      const name = exportName.trim() || `Export ${new Date().toLocaleString()}`;
      const { error } = await supabase.from("rlhf_exports").insert({
        project_id: projectId,
        name,
        format,
        pair_count: records.length,
        filters: {
          batch_id: batchId === "all" ? null : batchId,
          from: from || null,
          to: to || null,
        } as unknown as never,
        payload: records as unknown as never,
      });
      if (error) throw error;
      download(serializeExport(records, format), name, format);
      return name;
    },
    onSuccess: async (name) => {
      setExportName("");
      await queryClient.invalidateQueries({ queryKey: ["rlhf-exports", projectId] });
      toast.success(`${name} downloaded and saved to export history`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Export failed"),
  });

  return (
    <Tabs defaultValue="dashboard" className="space-y-4">
      <TabsList className="h-8">
        <TabsTrigger value="dashboard" className="h-6 px-3 text-xs">
          Dashboard
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
          Project scope follows the project switcher above.
        </p>
      </div>

      <TabsContent value="dashboard" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Training pairs" value={String(pairs.length)} />
          <Tile label="Fields with corrections" value={String(byField.length)} />
          <Tile label="Profiles represented" value={String(byProfile.length)} />
          <Tile
            label="Documents involved"
            value={String(new Set(pairs.map((pair) => pair.documentId)).size)}
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
      </TabsContent>

      <TabsContent value="export" className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="panel h-fit space-y-3 p-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Export training pairs</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {records.length} pair(s) in the current filter scope.
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
                    JSONL (one record per line)
                  </SelectItem>
                  <SelectItem value="json" className="text-sm">
                    JSON (array)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              className="h-8 w-full text-sm"
              disabled={saveExport.isPending || records.length === 0}
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
                First 5 records of {records.length}, exactly as they will be written.
              </p>
            </div>
            <pre className="max-h-72 overflow-auto px-4 py-3 text-2xs leading-relaxed text-muted-foreground">
              {preview || "Nothing to export yet."}
            </pre>
          </div>
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
                  <TableHead className="text-xs">Pairs</TableHead>
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
                        onClick={() =>
                          download(
                            serializeExport(
                              (row.payload ?? []) as unknown as ReturnType<typeof buildExportRecords>,
                              row.format as ExportFormat,
                            ),
                            row.name,
                            row.format as ExportFormat,
                          )
                        }
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
      </TabsContent>
    </Tabs>
  );
}

function download(content: string, name: string, format: ExportFormat) {
  const blob = new Blob([content], {
    type: format === "jsonl" ? "application/x-ndjson" : "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.${format}`;
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
