import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  FlaskConical,
  Loader2,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { generateSyntheticRecords } from "@/lib/synthetic.functions";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/synthetic-data")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Generate clearly-labeled synthetic training records from a label profile to cover under-represented cases.",
      },
      { property: "og:title", content: "Synthetic Data — LabelFactory" },
      {
        property: "og:description",
        content:
          "Generate clearly-labeled synthetic training records from a label profile to cover under-represented cases.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SyntheticRoute,
});

type SyntheticFieldValue = {
  field_key: string;
  field_label: string;
  data_type: string;
  value: string;
};

type SyntheticRecord = {
  id: string;
  title: string;
  summary: string | null;
  fields: SyntheticFieldValue[];
  status: "pending" | "accepted" | "discarded";
  created_at: string;
  batch_id: string | null;
  label_profile_id: string;
  constraints_note: string | null;
};

const CHUNK = 2;

function SyntheticRoute() {
  return (
    <SectionPage
      title="Synthetic Data"
      description="Generate synthetic, AI-fabricated records from a label profile to expand coverage of rare cases. Nothing here is real source data."
    >
      <SyntheticBody />
    </SectionPage>
  );
}

function SyntheticBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 rounded-full border-amber-500/40 bg-amber-500/10 px-2 py-0 text-[11px] font-medium text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      <FlaskConical className="size-3" aria-hidden="true" />
      Synthetic
    </Badge>
  );
}

function SyntheticBody() {
  const { projectId, batchId, setBatchId } = useWorkspace();
  const queryClient = useQueryClient();
  const generate = useServerFn(generateSyntheticRecords);

  const [profileId, setProfileId] = useState<string>("");
  const [count, setCount] = useState("5");
  const [constraints, setConstraints] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [preview, setPreview] = useState<SyntheticRecord | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["synthetic-profiles", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_profiles")
        .select("id, name, version, status, fields, document_type")
        .eq("project_id", projectId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const batchesQuery = useQuery({
    queryKey: ["synthetic-batches", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, name")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const recordsQuery = useQuery({
    queryKey: ["synthetic-records", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<SyntheticRecord[]> => {
      const { data, error } = await supabase
        .from("synthetic_records")
        .select(
          "id, title, summary, fields, status, created_at, batch_id, label_profile_id, constraints_note",
        )
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SyntheticRecord[];
    },
  });

  const profiles = profilesQuery.data ?? [];
  const batches = batchesQuery.data ?? [];
  const records = recordsQuery.data ?? [];

  const activeBatchId = useMemo(() => {
    if (batchId && batches.some((batch) => batch.id === batchId)) return batchId;
    return batches[0]?.id ?? "";
  }, [batchId, batches]);

  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? null;
  const fieldCount = Array.isArray(selectedProfile?.fields)
    ? (selectedProfile.fields as unknown[]).length
    : 0;

  const pending = records.filter((record) => record.status === "pending");
  const accepted = records.filter((record) => record.status === "accepted");

  const runGeneration = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      if (!profileId) throw new Error("Pick a label profile first.");
      const total = Number(count);
      const titles = records.slice(0, 25).map((record) => record.title);
      setProgress({ done: 0, total });
      let done = 0;
      while (done < total) {
        const size = Math.min(CHUNK, total - done);
        const result = await generate({
          data: {
            projectId,
            profileId,
            batchId: activeBatchId || null,
            count: size,
            constraints,
            existingTitles: titles,
          },
        });
        for (const record of result.records) titles.unshift(record.title);
        done += size;
        setProgress({ done, total });
        await queryClient.invalidateQueries({ queryKey: ["synthetic-records", projectId] });
      }
      return total;
    },
    onSuccess: (total) => toast.success(`${total} synthetic records generated`),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Synthetic generation failed"),
    onSettled: () => setProgress(null),
  });

  const decide = useMutation({
    mutationFn: async ({
      record,
      action,
    }: {
      record: SyntheticRecord;
      action: "accept" | "discard";
    }) => {
      if (action === "discard") {
        const { error } = await supabase
          .from("synthetic_records")
          .update({ status: "discarded" })
          .eq("id", record.id);
        if (error) throw error;
        return action;
      }
      if (!activeBatchId) throw new Error("Create a batch before accepting synthetic records.");

      const { data: doc, error: docError } = await supabase
        .from("documents")
        .insert({
          batch_id: activeBatchId,
          filename: `[SYNTHETIC] ${record.title}`,
          file_type: "synthetic",
          is_synthetic: true,
          page_count: 1,
          status: "prelabeled",
        })
        .select("id")
        .single();
      if (docError) throw docError;

      if (record.fields.length > 0) {
        const { error: exError } = await supabase.from("extractions").insert(
          record.fields.map((field) => ({
            document_id: doc.id,
            field_key: field.field_key,
            field_label: field.field_label,
            data_type: (field.data_type || "text") as never,
            suggested_value: field.value,
            final_value: field.value,
            confidence: 1,
            evidence_snippet: "Synthetic (AI-generated) record — no source document.",
            evidence_page: 1,
          })),
        );
        if (exError) throw exError;
      }

      const { error: updateError } = await supabase
        .from("synthetic_records")
        .update({ status: "accepted", accepted_document_id: doc.id, batch_id: activeBatchId })
        .eq("id", record.id);
      if (updateError) throw updateError;
      return action;
    },
    onSuccess: async (action) => {
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["synthetic-records", projectId] });
      toast.success(
        action === "accept"
          ? "Accepted into the batch as a synthetic document"
          : "Synthetic record discarded",
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Action failed"),
  });

  if (recordsQuery.isPending || profilesQuery.isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="panel flex flex-wrap items-start gap-3 border-amber-500/30 bg-amber-500/5 p-4">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="text-sm font-medium text-foreground">
            Everything on this screen is synthetic, AI-generated data
          </p>
          <p className="mt-1 max-w-3xl">
            These records are fabricated from a label profile to augment under-represented cases.
            They are never sourced from your uploaded documents. Accepted records enter the batch
            flagged as synthetic so they stay distinguishable in review, export and finetuning.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="panel h-fit p-4">
          <h2 className="text-sm font-semibold tracking-tight">Generation setup</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose the schema the synthetic records should conform to.
          </p>

          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="synthetic-profile" className="text-xs">
                Label profile
              </Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger id="synthetic-profile" className="h-8 text-sm">
                  <SelectValue placeholder="Select a profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id} className="text-sm">
                      {profile.name} · v{profile.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {profiles.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No profiles yet.{" "}
                  <Link to="/label-profile" className="text-primary underline-offset-2 hover:underline">
                    Create one
                  </Link>
                  .
                </p>
              ) : selectedProfile ? (
                <p className="text-xs text-muted-foreground">
                  {fieldCount} field{fieldCount === 1 ? "" : "s"}
                  {selectedProfile.document_type ? ` · ${selectedProfile.document_type}` : ""}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="synthetic-batch" className="text-xs">
                Target batch
              </Label>
              <Select value={activeBatchId} onValueChange={(value) => setBatchId(value)}>
                <SelectTrigger id="synthetic-batch" className="h-8 text-sm">
                  <SelectValue placeholder="Select a batch" />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id} className="text-sm">
                      {batch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Accepted records land here as synthetic documents.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="synthetic-count" className="text-xs">
                How many to generate
              </Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger id="synthetic-count" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 3, 5, 10, 20].map((value) => (
                    <SelectItem key={value} value={String(value)} className="text-sm">
                      {value} record{value === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="synthetic-constraints" className="text-xs">
                Variation constraints <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="synthetic-constraints"
                value={constraints}
                onChange={(event) => setConstraints(event.target.value)}
                rows={4}
                maxLength={2000}
                className="text-sm"
                placeholder={'e.g. "include more claims with denied status" or "vary invoice amounts and currencies"'}
              />
            </div>

            <Button
              size="sm"
              className="h-8 w-full text-sm"
              disabled={!profileId || runGeneration.isPending}
              onClick={() => runGeneration.mutate()}
            >
              {runGeneration.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-3.5" aria-hidden="true" />
              )}
              Generate synthetic data
            </Button>

            {progress ? (
              <div className="space-y-1.5" aria-live="polite">
                <Progress value={(progress.done / progress.total) * 100} className="h-1.5" />
                <p className="text-xs text-muted-foreground">
                  Generated {progress.done} of {progress.total} synthetic records…
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Pending review" value={pending.length} />
            <StatTile label="Accepted into batches" value={accepted.length} />
            <StatTile
              label="Discarded"
              value={records.filter((record) => record.status === "discarded").length}
            />
          </div>

          <div className="panel">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Generated records</h2>
                <p className="text-xs text-muted-foreground">
                  AI-fabricated examples — preview, then accept or discard.
                </p>
              </div>
              <SyntheticBadge />
            </div>

            {records.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No synthetic records yet. Configure a profile on the left and generate a set.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {records.map((record) => (
                  <li key={record.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <SyntheticBadge />
                        <p className="truncate text-sm font-medium">{record.title}</p>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {record.summary || `${record.fields.length} generated field values`}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full px-2 py-0 text-[11px] capitalize"
                    >
                      {record.status}
                    </Badge>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setPreview(record)}
                      >
                        Preview
                      </Button>
                      {record.status === "pending" ? (
                        <>
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ record, action: "accept" })}
                          >
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ record, action: "discard" })}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            Discard
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <SyntheticBadge />
              {preview?.title}
            </DialogTitle>
            <DialogDescription className="text-sm">
              Synthetic, AI-generated field values for review. This record has no real source
              document and must not be treated as genuine data.
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3">
              {preview.summary ? (
                <p className="text-xs text-muted-foreground">{preview.summary}</p>
              ) : null}
              <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border/60">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border/60">
                    {preview.fields.map((field) => (
                      <tr key={field.field_key}>
                        <td className="w-1/3 px-3 py-2 align-top text-xs text-muted-foreground">
                          {field.field_label}
                        </td>
                        <td className="px-3 py-2 align-top text-sm">
                          {field.value || <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.status === "pending" ? (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ record: preview, action: "discard" })}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ record: preview, action: "accept" })}
                  >
                    Accept into batch
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
