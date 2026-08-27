import { useCallback, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  RotateCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace";
import { prelabelDocument } from "@/lib/prelabel.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ingestion")({
  head: () => ({
    meta: [
      { title: "Ingestion — LabelFactory" },
      {
        name: "description",
        content:
          "Upload PDF and HTML documents into batches, map a label profile, and kick off AI prelabeling.",
      },
      { property: "og:title", content: "Ingestion — LabelFactory" },
      {
        property: "og:description",
        content:
          "Upload PDF and HTML documents into batches, map a label profile, and kick off AI prelabeling.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IngestionRoute,
});

const DOC_STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  prelabeled: "Prelabeled",
  in_review: "In Review",
  approved: "Approved",
  rejected: "Rejected",
};

const BATCH_STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  prelabeled: "Prelabeled",
  in_review: "In Review",
  complete: "Complete",
};

type StagedFile = {
  id: string;
  file: File;
  state: "pending" | "uploading" | "uploaded" | "failed";
  progress: number;
  reason?: string | undefined;
};

function StatusPill({ value, map }: { value: string; map: Record<string, string> }) {
  const tone =
    value === "approved" || value === "complete"
      ? "bg-primary/12 text-primary"
      : value === "rejected"
        ? "bg-destructive/12 text-destructive"
        : value === "processing"
          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {map[value] ?? value}
    </span>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function IngestionRoute() {
  return (
    <SectionPage
      title="Ingestion"
      description="Upload PDF and HTML documents, group them into batches, and map a label profile before extraction runs."
    >
      <IngestionBody />
    </SectionPage>
  );
}

function IngestionBody() {
  const { projectId, batchId, setBatchId } = useWorkspace();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [newBatchOpen, setNewBatchOpen] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileChoice, setProfileChoice] = useState<string>("");
  const [labelingIds, setLabelingIds] = useState<string[]>([]);
  const runPrelabel = useServerFn(prelabelDocument);

  const batchesQuery = useQuery({
    queryKey: ["ingestion-batches", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("batches")
        .select("id, name, status, created_at, label_profile_id")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const profilesQuery = useQuery({
    queryKey: ["ingestion-profiles", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_profiles")
        .select("id, name, version, status")
        .eq("project_id", projectId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const batches = batchesQuery.data ?? [];
  const activeBatch = batches.find((batch) => batch.id === batchId) ?? batches[0] ?? null;
  const activeBatchId = activeBatch?.id ?? null;

  const documentsQuery = useQuery({
    queryKey: ["ingestion-documents", activeBatchId],
    enabled: Boolean(activeBatchId),
    // Keeps status pills moving from uploaded → processing → prelabeled without a reload.
    refetchInterval: labelingIds.length > 0 ? 2500 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, filename, file_type, page_count, status, uploaded_at")
        .eq("batch_id", activeBatchId!)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const documentCountsQuery = useQuery({
    queryKey: ["ingestion-doc-counts", projectId, batches.map((b) => b.id).join(",")],
    enabled: batches.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, batch_id")
        .in("batch_id", batches.map((batch) => batch.id));
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.batch_id] = (counts[row.batch_id] ?? 0) + 1;
      return counts;
    },
  });

  const profileLabel = useMemo(() => {
    if (!activeBatch?.label_profile_id) return null;
    const profile = (profilesQuery.data ?? []).find(
      (item) => item.id === activeBatch.label_profile_id,
    );
    return profile ? `${profile.name} · v${profile.version}` : "Mapped profile";
  }, [activeBatch, profilesQuery.data]);

  const createBatch = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("batches")
        .insert({ project_id: projectId!, name })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      setNewBatchOpen(false);
      setNewBatchName("");
      setBatchId(id);
      void queryClient.invalidateQueries({ queryKey: ["ingestion-batches", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-dashboard", projectId] });
      toast.success("Batch created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const mapProfile = useMutation({
    mutationFn: async (labelProfileId: string) => {
      const { error } = await supabase
        .from("batches")
        .update({ label_profile_id: labelProfileId })
        .eq("id", activeBatchId!);
      if (error) throw error;
    },
    onSuccess: () => {
      setProfileDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["ingestion-batches", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-dashboard", projectId] });
      toast.success("Label profile mapped to this batch");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const acceptFiles = useCallback((files: FileList | File[]) => {
    const next: StagedFile[] = [];
    for (const file of Array.from(files)) {
      const name = file.name.toLowerCase();
      const ok =
        name.endsWith(".pdf") ||
        name.endsWith(".html") ||
        name.endsWith(".htm") ||
        file.type === "application/pdf" ||
        file.type === "text/html";
      next.push({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        state: ok ? "pending" : "failed",
        progress: 0,
        ...(ok ? {} : { reason: "Unsupported file type — only PDF and HTML are accepted." }),
      });
    }
    setStaged((current) => [...current, ...next]);
  }, []);

  const uploadOne = useCallback(
    async (item: StagedFile) => {
      setStaged((current) =>
        current.map((row) =>
          row.id === item.id ? { ...row, state: "uploading", progress: 20, reason: undefined } : row,
        ),
      );
      try {
        if (item.file.size > 25 * 1024 * 1024) {
          throw new Error("File is larger than the 25 MB per-file limit.");
        }
        const isPdf = item.file.name.toLowerCase().endsWith(".pdf");
        const path = `${projectId}/${activeBatchId}/${crypto.randomUUID()}-${item.file.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(path, item.file, {
            contentType: isPdf ? "application/pdf" : "text/html",
            upsert: false,
          });
        if (uploadError) throw new Error(uploadError.message);

        setStaged((current) =>
          current.map((row) => (row.id === item.id ? { ...row, progress: 70 } : row)),
        );

        const { error: insertError } = await supabase.from("documents").insert({
          batch_id: activeBatchId!,
          filename: item.file.name,
          file_type: isPdf ? "pdf" : "html",
          storage_path: path,
          status: "uploaded",
        });
        if (insertError) throw new Error(insertError.message);

        setStaged((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, state: "uploaded", progress: 100 } : row,
          ),
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Upload failed for an unknown reason.";
        setStaged((current) =>
          current.map((row) =>
            row.id === item.id ? { ...row, state: "failed", progress: 100, reason } : row,
          ),
        );
      }
    },
    [activeBatchId, projectId],
  );

  const [uploading, setUploading] = useState(false);
  const pendingCount = staged.filter((row) => row.state === "pending").length;
  const uploadedCount = staged.filter((row) => row.state === "uploaded").length;
  const failed = staged.filter((row) => row.state === "failed");

  const commitUpload = async () => {
    if (!activeBatchId) {
      toast.error("Create or select a batch before uploading.");
      return;
    }
    setUploading(true);
    for (const item of staged.filter((row) => row.state === "pending")) {
      await uploadOne(item);
    }
    setUploading(false);
    void queryClient.invalidateQueries({ queryKey: ["ingestion-documents", activeBatchId] });
    void queryClient.invalidateQueries({ queryKey: ["ingestion-doc-counts"] });
    void queryClient.invalidateQueries({ queryKey: ["project-dashboard", projectId] });
  };

  const label = async (ids: string[]) => {
    if (!activeBatch?.label_profile_id) {
      toast.error("No label profile is mapped to this batch.", {
        description: "Map a profile from the mapping card above, then run labeling again.",
        action: { label: "Map profile", onClick: () => setProfileDialogOpen(true) },
      });
      return;
    }
    setLabelingIds(ids);
    for (const id of ids) {
      try {
        await runPrelabel({ data: { documentId: id } });
        void queryClient.invalidateQueries({ queryKey: ["ingestion-documents", activeBatchId] });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Prelabeling failed.");
      }
    }
    setLabelingIds([]);
    void queryClient.invalidateQueries({ queryKey: ["ingestion-documents", activeBatchId] });
    void queryClient.invalidateQueries({ queryKey: ["project-dashboard", projectId] });
    toast.success(`Prelabeling finished for ${ids.length} document${ids.length === 1 ? "" : "s"}`);
  };

  const documents = documentsQuery.data ?? [];
  const filteredDocuments = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="space-y-5">
      {/* Batch controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs text-muted-foreground">Batch</Label>
        <Select
          value={activeBatchId ?? ""}
          onValueChange={(value) => setBatchId(value)}
          disabled={batches.length === 0}
        >
          <SelectTrigger className="h-8 w-64 text-sm" aria-label="Active batch">
            <SelectValue placeholder={batchesQuery.isPending ? "Loading…" : "No batches yet"} />
          </SelectTrigger>
          <SelectContent>
            {batches.map((batch) => (
              <SelectItem key={batch.id} value={batch.id} className="text-sm">
                {batch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8 text-sm" onClick={() => setNewBatchOpen(true)}>
          <Plus className="mr-1.5 size-3.5" /> New Batch
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground">Active batch</p>
          <p className="mt-1 truncate text-sm font-semibold">{activeBatch?.name ?? "—"}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            {activeBatch ? formatDate(activeBatch.created_at) : "No batch selected"}
            {activeBatch ? (
              <StatusPill value={activeBatch.status} map={BATCH_STATUS_LABELS} />
            ) : null}
          </div>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground">Documents</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{documents.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Files uploaded into this batch</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-muted-foreground">Label profile</p>
          {profileLabel ? (
            <>
              <p className="mt-1 truncate text-sm font-semibold">{profileLabel}</p>
              <button
                type="button"
                className="mt-2 text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => setProfileDialogOpen(true)}
                disabled={!activeBatchId}
              >
                Change profile
              </button>
            </>
          ) : (
            <>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="size-3.5" /> No profile mapped
              </p>
              <Button
                size="sm"
                className="mt-2 h-7 text-xs"
                onClick={() => setProfileDialogOpen(true)}
                disabled={!activeBatchId}
              >
                Map a profile
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Upload panel */}
        <div className="panel p-4">
          <h2 className="text-sm font-semibold tracking-tight">Upload Documents</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">PDF and HTML files, up to 25 MB each.</p>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              acceptFiles(event.dataTransfer.files);
            }}
            className={cn(
              "mt-3 flex flex-col items-center justify-center rounded-md border border-dashed p-8 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <Upload className="size-5 text-muted-foreground" />
            <p className="mt-2 text-sm">Drag and drop files here</p>
            <p className="text-xs text-muted-foreground">or</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-8 text-sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose files
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.html,.htm,application/pdf,text/html"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) acceptFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {staged.length > 0 ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{pendingCount} pending</span>
                <span>{staged.filter((row) => row.state === "uploading").length} uploading</span>
                <span>{uploadedCount} uploaded</span>
                <span className={failed.length ? "text-destructive" : undefined}>
                  {failed.length} failed
                </span>
              </div>
              <ul className="space-y-2">
                {staged.map((item) => (
                  <li key={item.id} className="rounded-md border border-border p-2">
                    <div className="flex items-center gap-2">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm">{item.file.name}</span>
                      {item.state === "uploaded" ? (
                        <CheckCircle2 className="size-3.5 text-primary" />
                      ) : null}
                      {item.state === "failed" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => void uploadOne({ ...item, state: "pending" })}
                        >
                          <RotateCw className="mr-1 size-3" /> Retry
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="size-6 p-0"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() =>
                          setStaged((current) => current.filter((row) => row.id !== item.id))
                        }
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                    <Progress value={item.progress} className="mt-2 h-1" />
                    {item.reason ? (
                      <p className="mt-1 text-xs text-destructive">{item.reason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                className="h-8 text-sm"
                disabled={pendingCount === 0 || uploading || !activeBatchId}
                onClick={() => void commitUpload()}
              >
                {uploading ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                Upload {pendingCount}
              </Button>
            </div>
          ) : null}
        </div>

        {/* Batch list */}
        <div className="panel p-4">
          <h2 className="text-sm font-semibold tracking-tight">Batch List</h2>
          {batchesQuery.isPending ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : batches.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No batches yet. Create one to start uploading.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {batches.map((batch) => (
                <li key={batch.id}>
                  <button
                    type="button"
                    onClick={() => setBatchId(batch.id)}
                    className={cn(
                      "w-full rounded-md border p-2.5 text-left transition-colors hover:bg-muted/60",
                      batch.id === activeBatchId ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{batch.name}</span>
                      <StatusPill value={batch.status} map={BATCH_STATUS_LABELS} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(batch.created_at)} ·{" "}
                      {documentCountsQuery.data?.[batch.id] ?? 0} documents
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Documents table */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Documents</h2>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search documents"
              className="h-8 w-56 text-sm"
              aria-label="Search documents"
            />
            <Button
              size="sm"
              className="h-8 text-sm"
              disabled={filteredDocuments.length === 0 || labelingIds.length > 0}
              onClick={() => void label(filteredDocuments.map((doc) => doc.id))}
            >
              {labelingIds.length > 0 ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 size-3.5" />
              )}
              Label all
            </Button>
          </div>
        </div>

        {documentsQuery.isPending && activeBatchId ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : filteredDocuments.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {documents.length === 0
              ? "No documents in this batch yet. Upload PDF or HTML files above."
              : "No documents match your search."}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">Name</th>
                  <th className="py-2 text-left font-medium">Type</th>
                  <th className="py-2 text-left font-medium">Pages</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Uploaded</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[280px] truncate py-2">{doc.filename}</td>
                    <td className="py-2 uppercase text-xs text-muted-foreground">{doc.file_type}</td>
                    <td className="py-2 tabular-nums">{doc.page_count || "—"}</td>
                    <td className="py-2">
                      <StatusPill
                        value={labelingIds.includes(doc.id) ? "processing" : doc.status}
                        map={DOC_STATUS_LABELS}
                      />
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {formatDate(doc.uploaded_at)}
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={labelingIds.length > 0}
                        onClick={() => void label([doc.id])}
                      >
                        Label
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              Prelabeled documents move on to{" "}
              <Link to="/annotate" className="text-primary underline-offset-2 hover:underline">
                Annotate &amp; Label
              </Link>
              .
            </p>
          </div>
        )}
      </div>

      {/* New batch dialog */}
      <Dialog open={newBatchOpen} onOpenChange={setNewBatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New batch</DialogTitle>
            <DialogDescription>
              Batches group documents that share one label profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="batch-name" className="text-xs">
              Batch name
            </Label>
            <Input
              id="batch-name"
              value={newBatchName}
              onChange={(event) => setNewBatchName(event.target.value)}
              placeholder="e.g. March invoices"
              className="h-8 text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-sm"
              onClick={() => setNewBatchOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-sm"
              disabled={!newBatchName.trim() || createBatch.isPending}
              onClick={() => createBatch.mutate(newBatchName.trim())}
            >
              Create batch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Profile picker dialog */}
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Map a label profile</DialogTitle>
            <DialogDescription>
              The mapped profile defines which fields AI extracts from every document in this batch.
            </DialogDescription>
          </DialogHeader>
          {(profilesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This project has no label profiles yet.{" "}
              <Link to="/label-profile" className="text-primary underline-offset-2 hover:underline">
                Create one first
              </Link>
              .
            </p>
          ) : (
            <Select value={profileChoice} onValueChange={setProfileChoice}>
              <SelectTrigger className="h-8 text-sm" aria-label="Label profile">
                <SelectValue placeholder="Choose a profile" />
              </SelectTrigger>
              <SelectContent>
                {(profilesQuery.data ?? []).map((profile) => (
                  <SelectItem key={profile.id} value={profile.id} className="text-sm">
                    {profile.name} · v{profile.version}{" "}
                    <Badge variant="secondary" className="ml-1 text-[10px]">
                      {profile.status}
                    </Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-sm"
              onClick={() => setProfileDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-sm"
              disabled={!profileChoice || mapProfile.isPending}
              onClick={() => mapProfile.mutate(profileChoice)}
            >
              Map profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
