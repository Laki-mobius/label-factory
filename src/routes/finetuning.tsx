import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PlayCircle, ScrollText } from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useProjectDashboard } from "@/lib/dashboard-data";
import { fetchTrainingPairs } from "@/lib/rlhf";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/finetuning")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Configure, launch and monitor fine-tuning jobs built from human-corrected labels and approved documents.",
      },
      { property: "og:title", content: "Finetuning — LabelFactory" },
      {
        property: "og:description",
        content:
          "Job configuration, status transitions, logs and resulting model identifiers for your labeling project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SectionPage
      title="Finetuning"
      description="Launch training runs against your external or self-hosted trainer and monitor their state here."
    >
      <FinetuningBody />
    </SectionPage>
  ),
});

const BASE_MODELS = [
  { value: "local/llama-3.1-8b", label: "Local · Llama 3.1 8B (self-hosted)" },
  { value: "local/mistral-7b", label: "Local · Mistral 7B (self-hosted)" },
  { value: "openai/gpt-4.1-mini", label: "Hosted · GPT-4.1 Mini" },
  { value: "google/gemma-2-9b", label: "Hosted · Gemma 2 9B" },
] as const;

type JobRow = {
  id: string;
  name: string;
  base_model: string;
  status: "queued" | "running" | "complete" | "failed";
  pair_count: number;
  document_count: number;
  result_model: string | null;
  error_message: string | null;
  logs: unknown;
  callback_token: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

const STATUS_STYLE: Record<JobRow["status"], string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary-soft text-primary-soft-foreground",
  complete: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

function FinetuningBody() {
  const { projectId } = useWorkspace();
  const queryClient = useQueryClient();
  const dashboard = useProjectDashboard(projectId);

  const [name, setName] = useState("");
  const [baseModel, setBaseModel] = useState<string>(BASE_MODELS[0].value);
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [logJob, setLogJob] = useState<JobRow | null>(null);
  const [statusJob, setStatusJob] = useState<JobRow | null>(null);

  const batches = dashboard.data?.batches ?? [];

  const jobsQuery = useQuery({
    queryKey: ["finetune-jobs", projectId],
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job) => job.status === "queued" || job.status === "running")
        ? 10000
        : false,
    queryFn: async (): Promise<JobRow[]> => {
      const { data, error } = await supabase
        .from("finetune_jobs")
        .select(
          "id, name, base_model, status, pair_count, document_count, result_model, error_message, logs, callback_token, started_at, finished_at, created_at",
        )
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as JobRow[];
    },
  });

  const scopedBatchIds = useMemo(
    () => (selectedBatches.length > 0 ? selectedBatches : batches.map((batch) => batch.id)),
    [selectedBatches, batches],
  );

  const approvedInScope = useMemo(
    () =>
      batches
        .filter((batch) => scopedBatchIds.includes(batch.id))
        .reduce((sum, batch) => sum + batch.approvedCount, 0),
    [batches, scopedBatchIds],
  );

  const startJob = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      if (scopedBatchIds.length === 0) throw new Error("This project has no batches to train on.");

      const pairs = await fetchTrainingPairs(projectId, {
        batchIds: scopedBatchIds,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      });
      if (pairs.length === 0 && approvedInScope === 0) {
        throw new Error("No training pairs or approved documents in that scope yet.");
      }

      const profileIds = [
        ...new Set(
          batches
            .filter((batch) => scopedBatchIds.includes(batch.id) && batch.profileId)
            .map((batch) => batch.profileId as string),
        ),
      ];

      const { error } = await supabase.from("finetune_jobs").insert({
        project_id: projectId,
        name: name.trim() || `Finetune ${new Date().toLocaleString()}`,
        base_model: baseModel,
        status: "queued",
        profile_ids: profileIds,
        batch_ids: scopedBatchIds,
        date_from: from ? new Date(`${from}T00:00:00`).toISOString() : null,
        date_to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
        pair_count: pairs.length,
        document_count: approvedInScope,
        logs: [
          {
            at: new Date().toISOString(),
            status: "queued",
            message: `Job queued with ${pairs.length} correction pair(s) and ${approvedInScope} approved document(s).`,
          },
        ] as unknown as never,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["finetune-jobs", projectId] });
      toast.success("Job queued — the trainer will report progress here.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not queue job"),
  });

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="panel h-fit space-y-3 p-4">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">New finetuning job</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Training itself runs in your external or self-hosted trainer. This screen queues the
              job and tracks its reported state.
            </p>
          </div>

          <div>
            <Label htmlFor="job-name" className="text-xs">
              Job name
            </Label>
            <Input
              id="job-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Invoice extractor v3"
              className="mt-1 h-8 text-sm"
            />
          </div>

          <div>
            <Label htmlFor="job-model" className="text-xs">
              Base model
            </Label>
            <Select value={baseModel} onValueChange={setBaseModel}>
              <SelectTrigger id="job-model" className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BASE_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value} className="text-sm">
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-xs font-medium">Batches</p>
            <div className="mt-2 space-y-1.5">
              {batches.length === 0 ? (
                <p className="text-xs text-muted-foreground">No batches in this project yet.</p>
              ) : (
                batches.map((batch) => (
                  <label
                    key={batch.id}
                    htmlFor={`ft-batch-${batch.id}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Checkbox
                      id={`ft-batch-${batch.id}`}
                      checked={selectedBatches.includes(batch.id)}
                      onCheckedChange={() =>
                        setSelectedBatches((list) =>
                          list.includes(batch.id)
                            ? list.filter((id) => id !== batch.id)
                            : [...list, batch.id],
                        )
                      }
                    />
                    <span className="truncate">{batch.name}</span>
                    <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
                      {batch.approvedCount} approved
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Leave empty to train on every batch. Profiles are derived from the selected batches.
            </p>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="ft-from" className="text-xs">
                From
              </Label>
              <Input
                id="ft-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="ft-to" className="text-xs">
                To
              </Label>
              <Input
                id="ft-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="mt-1 h-8 text-sm"
              />
            </div>
          </div>

          <Button
            size="sm"
            className="h-8 w-full text-sm"
            disabled={startJob.isPending || batches.length === 0}
            onClick={() => startJob.mutate()}
          >
            {startJob.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <PlayCircle className="size-3.5" aria-hidden="true" />
            )}
            Start finetuning job
          </Button>
        </div>

        <div className="panel">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight">Jobs</h2>
            <p className="text-xs text-muted-foreground">
              Completed jobs expose a model identifier you can select in the Label Profile model
              dropdown.
            </p>
          </div>
          {jobsQuery.isPending ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : (jobsQuery.data ?? []).length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No finetuning jobs yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Job</TableHead>
                  <TableHead className="text-xs">Base model</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Started</TableHead>
                  <TableHead className="text-xs">Finished</TableHead>
                  <TableHead className="text-xs">Result model</TableHead>
                  <TableHead className="text-right text-xs">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jobsQuery.data ?? []).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="py-2 text-xs font-medium">
                      {job.name}
                      <span className="block text-2xs text-muted-foreground">
                        {job.pair_count} pairs · {job.document_count} approved docs
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-xs">{job.base_model}</TableCell>
                    <TableCell className="py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-2xs font-medium capitalize ${STATUS_STYLE[job.status]}`}
                      >
                        {job.status}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {job.started_at ? new Date(job.started_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {job.finished_at ? new Date(job.finished_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate py-2 text-xs">
                      {job.result_model ?? "—"}
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => setLogJob(job)}
                        >
                          <ScrollText className="size-3.5" aria-hidden="true" />
                          Logs
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setStatusJob(job)}
                        >
                          Update
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <LogsDialog job={logJob} onClose={() => setLogJob(null)} />
      <StatusDialog
        job={statusJob}
        onClose={() => setStatusJob(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["finetune-jobs", projectId] })}
      />
    </div>
  );
}

type LogEntry = { at: string; status: string; message: string };

function LogsDialog({ job, onClose }: { job: JobRow | null; onClose: () => void }) {
  const entries = (Array.isArray(job?.logs) ? job?.logs : []) as LogEntry[];
  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Logs — {job?.name}</DialogTitle>
          <DialogDescription className="text-sm">
            Status transitions and messages reported by the training process for this job.
          </DialogDescription>
        </DialogHeader>
        {job?.error_message ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {job.error_message}
          </p>
        ) : null}
        <div className="max-h-[45vh] space-y-2 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No log entries yet.</p>
          ) : (
            entries
              .slice()
              .reverse()
              .map((entry, index) => (
                <div key={`${entry.at}-${index}`} className="flex gap-3 text-xs">
                  <span className="w-40 shrink-0 text-muted-foreground">
                    {new Date(entry.at).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="h-5 shrink-0 rounded-full px-2 text-2xs">
                    {entry.status}
                  </Badge>
                  <span className="min-w-0">{entry.message}</span>
                </div>
              ))
          )}
        </div>
        <p className="text-2xs text-muted-foreground">
          Trainer callback: POST /api/public/finetune-callback with{" "}
          {"{ job_id, token, status, result_model?, error_message?, log? }"}. Job token:{" "}
          <code>{job?.callback_token}</code>
        </p>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  job,
  onClose,
  onSaved,
}: {
  job: JobRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<JobRow["status"]>("running");
  const [resultModel, setResultModel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      if (!job) return;
      const now = new Date().toISOString();
      const logs = (Array.isArray(job.logs) ? job.logs : []) as LogEntry[];
      const { error } = await supabase
        .from("finetune_jobs")
        .update({
          status,
          result_model: status === "complete" ? resultModel.trim() || `ft:${job.base_model}:${job.id.slice(0, 8)}` : null,
          error_message: status === "failed" ? errorMessage.trim() || "Training failed." : null,
          started_at: status === "running" ? now : job.started_at,
          finished_at: status === "complete" || status === "failed" ? now : null,
          logs: [
            ...logs,
            { at: now, status, message: `Status set to ${status} from the workbench.` },
          ] as unknown as never,
        })
        .eq("id", job.id);
      if (error) throw error;
    },
    onSuccess: () => {
      onSaved();
      onClose();
      toast.success("Job updated");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Update job state</DialogTitle>
          <DialogDescription className="text-sm">
            Record a state reported out-of-band by the trainer for {job?.name}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="job-status" className="text-xs">
              Status
            </Label>
            <Select value={status} onValueChange={(value) => setStatus(value as JobRow["status"])}>
              <SelectTrigger id="job-status" className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["queued", "running", "complete", "failed"] as const).map((value) => (
                  <SelectItem key={value} value={value} className="text-sm capitalize">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {status === "complete" ? (
            <div>
              <Label htmlFor="job-result" className="text-xs">
                Resulting model identifier
              </Label>
              <Input
                id="job-result"
                value={resultModel}
                onChange={(event) => setResultModel(event.target.value)}
                placeholder={`ft:${job?.base_model ?? "model"}:0001`}
                className="mt-1 h-8 text-sm"
              />
            </div>
          ) : null}
          {status === "failed" ? (
            <div>
              <Label htmlFor="job-error" className="text-xs">
                Error message
              </Label>
              <Input
                id="job-error"
                value={errorMessage}
                onChange={(event) => setErrorMessage(event.target.value)}
                placeholder="CUDA out of memory at step 240"
                className="mt-1 h-8 text-sm"
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" className="h-8 text-sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 text-sm"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
