import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Info, Loader2, Plus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import {
  BATCH_STATUS_LABELS,
  projectDashboardKey,
  useProjectDashboard,
  type BatchRow,
  type BatchStatus,
} from "@/lib/dashboard-data";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Live view of batch workflow status, items needing attention and benchmark readiness for a labeling project.",
      },
      { property: "og:title", content: "Project Dashboard — LabelFactory" },
      {
        property: "og:description",
        content: "Batch progress, attention queue and benchmark readiness for your project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <SectionPage
      title="Dashboard"
      description="Project overview with batch progress, profile mapping and review status."
    >
      <DashboardBody />
    </SectionPage>
  );
}

function DashboardBody() {
  const { projectId, setBatchId, activeProject } = useWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isPending, error } = useProjectDashboard(projectId);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [batchName, setBatchName] = useState("");

  const batches = useMemo(() => {
    const rows = data?.batches ?? [];
    return statusFilter === "all" ? rows : rows.filter((row) => row.status === statusFilter);
  }, [data?.batches, statusFilter]);

  const createBatch = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      const { error: insertError } = await supabase
        .from("batches")
        .insert({ project_id: projectId, name: batchName.trim() });
      if (insertError) throw insertError;
    },
    onSuccess: async () => {
      setOpen(false);
      setBatchName("");
      await queryClient.invalidateQueries({ queryKey: projectDashboardKey(projectId) });
      toast.success("Batch created");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not create batch"),
  });

  const openBatch = (row: BatchRow) => {
    setBatchId(row.id);
    const destination =
      row.documentCount === 0 || row.status === "uploaded" ? "/ingestion" : "/annotate";
    void navigate({ to: destination });
  };

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel p-6" role="alert">
        <h2 className="text-base font-semibold tracking-tight">Could not load the dashboard</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Unexpected error."}
        </p>
      </div>
    );
  }

  const stats = data!.stats;
  const attention = data!.attention;

  return (
    <div className="space-y-5">
      <section className="panel p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Workflow Status</h2>
            <p className="text-xs text-muted-foreground">
              Every batch in {activeProject?.name ?? "this project"} and how far it has moved
              through the pipeline.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-40 text-sm" aria-label="Filter batches by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-sm">
                  All statuses
                </SelectItem>
                {(Object.keys(BATCH_STATUS_LABELS) as BatchStatus[]).map((status) => (
                  <SelectItem key={status} value={status} className="text-sm">
                    {BATCH_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-sm" onClick={() => setOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Create batch
            </Button>
          </div>
        </header>

        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Batch</TableHead>
                <TableHead className="text-xs">Label profile</TableHead>
                <TableHead className="text-xs">Documents</TableHead>
                <TableHead className="w-40 text-xs">Progress</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-right text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    {(data!.batches.length ?? 0) === 0
                      ? "No batches yet. Create one to start ingesting documents."
                      : "No batches match this status filter."}
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-sm font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm">
                      {row.profileLabel ? (
                        <span className="text-muted-foreground">{row.profileLabel}</span>
                      ) : (
                        <span className="text-destructive">No profile mapped</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.documentCount}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={row.progress} className="h-1.5" />
                        <span className="w-9 text-right text-2xs text-muted-foreground">
                          {row.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="rounded-full text-2xs font-medium">
                        {BATCH_STATUS_LABELS[row.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => openBatch(row)}
                      >
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="panel p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Attention Queue</h2>
            <p className="text-xs text-muted-foreground">
              Conditions blocking or slowing this project&apos;s pipeline.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-8 text-sm">
            <Link to="/attention">
              Open queue
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </header>

        {attention.length === 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-accent/40 p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            Nothing needs your attention right now.
          </div>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {attention.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className={
                  item.severity === "danger"
                    ? "rounded-md border border-destructive/40 bg-destructive/5 p-3"
                    : "rounded-md border border-border bg-accent/40 p-3"
                }
              >
                <div className="flex items-center gap-1.5">
                  {item.severity === "danger" ? (
                    <AlertTriangle className="size-3.5 text-destructive" aria-hidden="true" />
                  ) : (
                    <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="text-xs font-semibold tracking-tight">{item.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                <Link
                  to="/attention"
                  className="mt-2 inline-flex text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {item.targetLabel}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">Benchmark Readiness</h2>
            <p className="text-xs text-muted-foreground">
              How much human-approved data this project has available for evals and finetuning.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="h-8 text-sm">
            <Link to="/benchmarking">
              Open benchmarking
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </header>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Approved records" value={stats.approvedRecords} />
          <StatTile label="Profiles represented" value={stats.profilesRepresented} />
          <StatTile label="Batches represented" value={stats.batchesRepresented} />
          <StatTile label="Approval rate" value={`${stats.approvalRate}%`} />
          <StatTile label="Prelabel completion" value={`${stats.prelabelCompletion}%`} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Based on {stats.totalDocuments} document{stats.totalDocuments === 1 ? "" : "s"} across{" "}
          {data!.batches.length} batch{data!.batches.length === 1 ? "" : "es"}. Approval rate is
          approved documents over all documents; prelabel completion counts documents the model has
          already processed.
        </p>
      </section>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setBatchName("");
        }}
      >
        <DialogContent className="sm:max-w-md" aria-describedby="new-batch-description">
          <DialogHeader>
            <DialogTitle className="text-base">Create batch</DialogTitle>
            <DialogDescription id="new-batch-description" className="text-sm">
              A batch groups documents that share a label profile. You can map a profile later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="batch-name" className="text-xs font-medium">
              Batch name
            </Label>
            <Input
              id="batch-name"
              value={batchName}
              onChange={(event) => setBatchName(event.target.value)}
              className="h-9 text-sm"
              placeholder="September intake"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-sm"
              disabled={!batchName.trim() || createBatch.isPending}
              onClick={() => createBatch.mutate()}
            >
              {createBatch.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Create batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-accent/30 p-3">
      <div className="text-lg font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
