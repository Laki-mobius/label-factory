import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { useAuth } from "@/lib/auth";
import {
  generateFieldsFromSample,
  generateFieldsFromType,
} from "@/lib/field-suggest.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/label-profile")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Define versioned extraction schemas: pick library fields, generate them with AI, or read a real sample document.",
      },
      { property: "og:title", content: "Label Profile — LabelFactory" },
      {
        property: "og:description",
        content:
          "Define versioned extraction schemas: pick library fields, generate them with AI, or read a real sample document.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LabelProfileRoute,
});

const BUCKETS = [
  "Document Details",
  "Parties & Entities",
  "Financial Information",
  "Dates & Timeline",
  "Transaction Details",
  "Miscellaneous",
] as const;

const DATA_TYPES = [
  { value: "text", label: "Text" },
  { value: "identifier", label: "Identifier" },
  { value: "date", label: "Date" },
  { value: "currency", label: "Currency" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "multi_value", label: "Multi-value" },
] as const;

type DataType = (typeof DATA_TYPES)[number]["value"];

const MODELS = [
  {
    value: "local/ollama-llama3.1",
    label: "Local · Llama 3.1 (self-hosted)",
    hint: "Recommended — runs on your own hardware, no per-token cost, documents never leave your network.",
    selfHosted: true,
  },
  {
    value: "google/gemini-2.5-flash",
    label: "Hosted · Gemini 2.5 Flash",
    hint: "Fast and inexpensive hosted model. Good default for schema generation.",
    selfHosted: false,
  },
  {
    value: "google/gemini-2.5-pro",
    label: "Hosted · Gemini 2.5 Pro",
    hint: "Highest quality hosted reasoning for dense or unusual documents.",
    selfHosted: false,
  },
  {
    value: "openai/gpt-5-mini",
    label: "Hosted · GPT-5 Mini",
    hint: "Balanced hosted alternative from OpenAI.",
    selfHosted: false,
  },
] as const;

/** Self-hosted connectors are not wired to a runtime yet; AI calls fall back. */
const FALLBACK_MODEL = "google/gemini-2.5-flash";

type SelectedField = {
  key: string;
  display_name: string;
  data_type: DataType;
  bucket: string;
  description: string;
  origin: "library" | "ai_type" | "ai_sample" | "manual";
  confidence?: number | undefined;
};

type LibraryField = {
  id: string;
  bucket: string;
  key: string;
  display_name: string;
  data_type: DataType;
  description: string | null;
  sort_order: number;
};

type ProfileRow = {
  id: string;
  name: string;
  document_type: string | null;
  version: number;
  status: string;
  fields: unknown;
  model_config: unknown;
  updated_at: string;
};

function LabelProfileRoute() {
  return (
    <SectionPage
      title="Label Profile"
      description="Build versioned extraction schemas."
      actions={null}
    >
      <LabelProfileScreen />
    </SectionPage>
  );
}

function LabelProfileScreen() {
  const { projectId, activeProject } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [profileId, setProfileId] = useState<string>("new");
  const [name, setName] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [model, setModel] = useState<string>(MODELS[0].value);
  const [selected, setSelected] = useState<SelectedField[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [openBuckets, setOpenBuckets] = useState<string[]>([...BUCKETS]);
  const [sampleStatus, setSampleStatus] = useState<{
    filename: string;
    pages: number;
    characters: number;
    fieldCount: number;
    at: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const libraryQuery = useQuery({
    queryKey: ["field-library"],
    queryFn: async (): Promise<LibraryField[]> => {
      const { data, error } = await supabase
        .from("field_library")
        .select("id, bucket, key, display_name, data_type, description, sort_order")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LibraryField[];
    },
  });

  // Models produced by completed finetuning jobs become selectable here.
  const finetunedQuery = useQuery({
    queryKey: ["finetuned-models", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("finetune_jobs")
        .select("id, name, result_model")
        .eq("project_id", projectId!)
        .eq("status", "complete")
        .not("result_model", "is", null)
        .order("finished_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter((job) => Boolean(job.result_model));
    },
  });

  const profilesQuery = useQuery({
    queryKey: ["label-profiles", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProfileRow[]> => {
      const { data, error } = await supabase
        .from("label_profiles")
        .select("id, name, document_type, version, status, fields, model_config, updated_at")
        .eq("project_id", projectId!)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const activeProfile = profiles.find((profile) => profile.id === profileId) ?? null;

  // Load a saved version into the editor when the version dropdown changes.
  useEffect(() => {
    if (profileId === "new") return;
    const profile = profiles.find((row) => row.id === profileId);
    if (!profile) return;
    setName(profile.name);
    setDocumentType(profile.document_type ?? "");
    const rawFields = Array.isArray(profile.fields) ? (profile.fields as SelectedField[]) : [];
    setSelected(
      rawFields.map((field) => ({
        key: field.key,
        display_name: field.display_name,
        data_type: field.data_type,
        bucket: field.bucket ?? "Miscellaneous",
        description: field.description ?? "",
        origin: field.origin ?? "library",
        confidence: field.confidence,
      })),
    );
    const config = (profile.model_config ?? {}) as { model?: string };
    if (config.model) setModel(config.model);
  }, [profileId, profiles]);

  const selectedKeys = useMemo(() => new Set(selected.map((f) => f.key)), [selected]);

  function mergeFields(incoming: SelectedField[]) {
    setSelected((current) => {
      const existing = new Set(current.map((f) => f.key));
      const additions = incoming.filter((f) => !existing.has(f.key));
      return [...current, ...additions];
    });
    return incoming.length;
  }

  function toggleLibraryField(field: LibraryField, checked: boolean) {
    setSelected((current) => {
      if (!checked) return current.filter((f) => f.key !== field.key);
      if (current.some((f) => f.key === field.key)) return current;
      return [
        ...current,
        {
          key: field.key,
          display_name: field.display_name,
          data_type: field.data_type,
          bucket: field.bucket,
          description: field.description ?? "",
          origin: "library",
        },
      ];
    });
  }

  function updateField(key: string, patch: Partial<SelectedField>) {
    setSelected((current) =>
      current.map((field) => (field.key === key ? { ...field, ...patch } : field)),
    );
  }

  const finetunedModels = finetunedQuery.data ?? [];
  const isFinetuned = finetunedModels.some((job) => job.result_model === model);
  const resolvedModel =
    isFinetuned || MODELS.find((m) => m.value === model)?.selfHosted ? FALLBACK_MODEL : model;

  const runFromType = useServerFn(generateFieldsFromType);
  const runFromSample = useServerFn(generateFieldsFromSample);

  const aiTypeMutation = useMutation({
    mutationFn: async () => {
      if (!documentType.trim()) throw new Error("Enter a document type first.");
      return runFromType({
        data: {
          model: resolvedModel,
          documentType: documentType.trim(),
          industry: activeProject?.workspace_type ?? "general",
        },
      });
    },
    onSuccess: (result) => {
      const added = mergeFields(
        result.fields.map((field) => ({ ...field, origin: "ai_type" as const })),
      );
      toast.success(`AI proposed ${added} fields for "${documentType.trim()}".`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sampleMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      return runFromSample({
        data: {
          model: resolvedModel,
          documentType: documentType.trim(),
          industry: activeProject?.workspace_type ?? "general",
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          base64: btoa(binary),
        },
      });
    },
    onSuccess: (result, file) => {
      const added = mergeFields(
        result.fields.map((field) => ({ ...field, origin: "ai_sample" as const })),
      );
      setSampleStatus({
        filename: file.name,
        pages: result.pages,
        characters: result.characters,
        fieldCount: added,
        at: result.generatedAt,
      });
      toast.success(`Analysed ${file.name} and proposed ${added} fields.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No project selected.");
      if (!name.trim()) throw new Error("Profile name is required.");
      if (selected.length === 0) {
        throw new Error("Add at least one field before saving — empty profiles are not saved.");
      }
      const payload = {
        name: name.trim(),
        document_type: documentType.trim() || null,
        fields: selected as unknown as never,
        model_config: { model, resolved_model: resolvedModel } as unknown as never,
      };

      // Published versions are immutable: saving forks a new draft version.
      if (activeProfile && activeProfile.status === "published") {
        const nextVersion =
          Math.max(
            ...profiles.filter((p) => p.name === activeProfile.name).map((p) => p.version),
          ) + 1;
        const { data, error } = await supabase
          .from("label_profiles")
          .insert({
            project_id: projectId,
            created_by: user?.id ?? null,
            version: nextVersion,
            status: "draft",
            ...payload,
          })
          .select("id")
          .single();
        if (error) throw error;
        return { id: data.id, forked: true, version: nextVersion };
      }

      if (activeProfile) {
        const { error } = await supabase
          .from("label_profiles")
          .update(payload)
          .eq("id", activeProfile.id);
        if (error) throw error;
        return { id: activeProfile.id, forked: false, version: activeProfile.version };
      }

      const { data, error } = await supabase
        .from("label_profiles")
        .insert({
          project_id: projectId,
          created_by: user?.id ?? null,
          status: "draft",
          version: 1,
          ...payload,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: data.id, forked: false, version: 1 };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["label-profiles", projectId] });
      setProfileId(result.id);
      toast.success(
        result.forked
          ? `Published profile forked into v${result.version} (draft).`
          : "Profile saved.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const bucketsTouched = new Set(selected.map((f) => f.bucket));
  const busy = aiTypeMutation.isPending || sampleMutation.isPending;

  return (
    <div className="space-y-4">
      {/* Profile chooser + save row */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <Label className="text-xs text-muted-foreground">Profile version</Label>
        <Select value={profileId} onValueChange={setProfileId}>
          <SelectTrigger className="h-8 w-64 text-sm" aria-label="Profile version">
            <SelectValue placeholder="New draft" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new" className="text-sm">
              New draft
            </SelectItem>
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id} className="text-sm">
                {profile.name} · v{profile.version} · {profile.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-sm"
          onClick={() => {
            setProfileId("new");
            setName("");
            setDocumentType("");
            setSelected([]);
            setSampleStatus(null);
          }}
        >
          <Plus className="mr-1 size-3.5" /> New Profile
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-2xs text-muted-foreground sm:inline">
            Changes persist through the profile API.
          </span>
          <Button
            size="sm"
            className="h-8 text-sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : null}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Metadata */}
      <section className="panel p-4">
        <h2 className="text-sm font-semibold tracking-tight">Profile Metadata</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name" className="text-xs">
              Profile Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Supplier Invoice v1"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-type" className="text-xs">
              Document Type
            </Label>
            <Input
              id="doc-type"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
              placeholder="invoice, lease agreement, claim form…"
              className="h-8 text-sm"
            />
            <p className="text-2xs text-muted-foreground">
              Free text — document types vary by industry.
            </p>
          </div>
        </div>
      </section>

      {/* Model selection */}
      <section className="panel p-4">
        <h2 className="text-sm font-semibold tracking-tight">
          Model Selection for Entire Workflow
        </h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Model</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-8 w-80 text-sm" aria-label="Workflow model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-sm">
                    {option.label}
                    {option.selfHosted ? " · recommended" : ""}
                  </SelectItem>
                ))}
                {finetunedModels.map((job) => (
                  <SelectItem
                    key={job.id}
                    value={job.result_model as string}
                    className="text-sm"
                  >
                    Finetuned · {job.name} ({job.result_model})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-sm"
            onClick={() => aiTypeMutation.mutate()}
            disabled={busy}
          >
            {aiTypeMutation.isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1 size-3.5" />
            )}
            AI Generate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {sampleMutation.isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1 size-3.5" />
            )}
            Generate From Sample
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.html,.htm,application/pdf,text/html"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) sampleMutation.mutate(file);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-sm"
            onClick={() => setManualOpen(true)}
          >
            <Plus className="mr-1 size-3.5" /> Manual Add
          </Button>
        </div>
        <p className="mt-2 text-2xs text-muted-foreground">
          {isFinetuned
            ? "Finetuned model from this project. It is served by your external trainer; schema generation here falls back to a hosted model."
            : MODELS.find((m) => m.value === model)?.hint}
        </p>

        {sampleMutation.isPending ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            Reading the sample document and asking the model to propose fields…
          </div>
        ) : null}

        {sampleStatus && !sampleMutation.isPending ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/40 bg-primary-soft p-3 text-xs text-primary-soft-foreground">
            <CheckCircle2 className="mt-0.5 size-3.5" />
            <div>
              <div className="font-medium">
                Sample analysed — {sampleStatus.fieldCount} fields proposed
              </div>
              <div className="mt-0.5 opacity-80">
                {sampleStatus.filename} · {sampleStatus.pages} page
                {sampleStatus.pages === 1 ? "" : "s"} ·{" "}
                {sampleStatus.characters.toLocaleString()} characters read ·{" "}
                {new Date(sampleStatus.at).toLocaleString()}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Three columns */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)]">
        {/* Library */}
        <section className="panel p-4">
          <h2 className="text-sm font-semibold tracking-tight">Universal Field Library</h2>
          <p className="mt-1 text-2xs text-muted-foreground">
            Shared catalog available to every project and industry.
          </p>
          {libraryQuery.isPending ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {BUCKETS.map((bucket) => {
                const fields = (libraryQuery.data ?? []).filter((f) => f.bucket === bucket);
                const count = fields.filter((f) => selectedKeys.has(f.key)).length;
                const open = openBuckets.includes(bucket);
                return (
                  <div key={bucket} className="rounded-md border border-border">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium"
                      aria-expanded={open}
                      onClick={() =>
                        setOpenBuckets((current) =>
                          current.includes(bucket)
                            ? current.filter((b) => b !== bucket)
                            : [...current, bucket],
                        )
                      }
                    >
                      <ChevronDown
                        className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
                      />
                      <span className="flex-1">{bucket}</span>
                      <span className="text-2xs text-muted-foreground">
                        {count} selected / {fields.length}
                      </span>
                    </button>
                    {open ? (
                      <div className="space-y-1.5 border-t border-border px-3 py-2">
                        {fields.length === 0 ? (
                          <p className="text-2xs text-muted-foreground">No fields in bucket.</p>
                        ) : null}
                        {fields.map((field) => (
                          <label
                            key={field.id}
                            className="flex cursor-pointer items-start gap-2 text-xs"
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={selectedKeys.has(field.key)}
                              onCheckedChange={(value) =>
                                toggleLibraryField(field, value === true)
                              }
                              aria-label={field.display_name}
                            />
                            <span>
                              <span className="font-medium">{field.display_name}</span>
                              <span className="block text-2xs text-muted-foreground">
                                {field.key} · {field.data_type}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Selected */}
        <section className="panel p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Selected Fields</h2>
            <Badge variant="secondary" className="text-2xs">
              {selected.length}
            </Badge>
          </div>
          {selected.length === 0 ? (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              No fields yet. Check items from the library, run AI Generate, analyse a sample, or
              add one manually.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {BUCKETS.filter((bucket) => selected.some((f) => f.bucket === bucket)).map(
                (bucket) => (
                  <div key={bucket}>
                    <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {bucket}
                    </h3>
                    <div className="mt-1.5 space-y-2">
                      {selected
                        .filter((field) => field.bucket === bucket)
                        .map((field) => (
                          <div
                            key={field.key}
                            className="rounded-md border border-border p-2.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-medium">
                                {field.display_name}
                              </span>
                              {field.origin === "ai_type" || field.origin === "ai_sample" ? (
                                <Badge className="text-2xs">
                                  AI
                                  {typeof field.confidence === "number"
                                    ? ` · ${Math.round(field.confidence * 100)}%`
                                    : ""}
                                </Badge>
                              ) : null}
                              {field.origin === "manual" ? (
                                <Badge variant="outline" className="text-2xs">
                                  Custom
                                </Badge>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="ml-auto size-7"
                                aria-label={`Remove ${field.display_name}`}
                                onClick={() =>
                                  setSelected((current) =>
                                    current.filter((f) => f.key !== field.key),
                                  )
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                            <div className="mt-2 grid gap-2 sm:grid-cols-3">
                              <Input
                                value={field.key}
                                onChange={(event) =>
                                  updateField(field.key, { key: event.target.value })
                                }
                                aria-label={`Field key for ${field.display_name}`}
                                className="h-7 text-xs"
                              />
                              <Input
                                value={field.display_name}
                                onChange={(event) =>
                                  updateField(field.key, { display_name: event.target.value })
                                }
                                aria-label={`Display label for ${field.display_name}`}
                                className="h-7 text-xs"
                              />
                              <Select
                                value={field.data_type}
                                onValueChange={(value) =>
                                  updateField(field.key, { data_type: value as DataType })
                                }
                              >
                                <SelectTrigger
                                  className="h-7 text-xs"
                                  aria-label={`Data type for ${field.display_name}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DATA_TYPES.map((type) => (
                                    <SelectItem
                                      key={type.value}
                                      value={type.value}
                                      className="text-xs"
                                    >
                                      {type.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {field.description ? (
                              <p className="mt-1.5 text-2xs text-muted-foreground">
                                {field.description}
                              </p>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </section>

        {/* Summary */}
        <aside className="panel h-fit p-4">
          <h2 className="text-sm font-semibold tracking-tight">Schema Summary</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border p-2.5">
              <div className="text-lg font-semibold">{selected.length}</div>
              <div className="text-2xs text-muted-foreground">Selected fields</div>
            </div>
            <div className="rounded-md border border-border p-2.5">
              <div className="text-lg font-semibold">
                {bucketsTouched.size}/{BUCKETS.length}
              </div>
              <div className="text-2xs text-muted-foreground">Buckets touched</div>
            </div>
          </div>

          <h3 className="mt-4 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fields by Bucket
          </h3>
          <ul className="mt-1.5 space-y-1">
            {BUCKETS.map((bucket) => (
              <li key={bucket} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{bucket}</span>
                <span className="font-medium">
                  {selected.filter((f) => f.bucket === bucket).length}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="mt-4 flex w-full items-center gap-1.5 text-xs font-medium"
            aria-expanded={jsonOpen}
            onClick={() => setJsonOpen((open) => !open)}
          >
            <ChevronDown className={cn("size-3.5 transition-transform", !jsonOpen && "-rotate-90")} />
            Raw JSON preview
          </button>
          {jsonOpen ? (
            <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-2xs">
              {JSON.stringify(
                {
                  name: name || null,
                  document_type: documentType || null,
                  model_config: { model, resolved_model: resolvedModel },
                  fields: selected,
                },
                null,
                2,
              )}
            </pre>
          ) : null}
        </aside>
      </div>

      <ManualFieldDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        existingKeys={selectedKeys}
        onAdd={(field) => setSelected((current) => [...current, field])}
      />
    </div>
  );
}

function ManualFieldDialog({
  open,
  onOpenChange,
  existingKeys,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingKeys: Set<string>;
  onAdd: (field: SelectedField) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [dataType, setDataType] = useState<DataType>("text");
  const [bucket, setBucket] = useState<string>(BUCKETS[0]);
  const [description, setDescription] = useState("");

  function submit() {
    const trimmed = displayName.trim();
    if (!trimmed) {
      toast.error("Field name is required.");
      return;
    }
    const key = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (existingKeys.has(key)) {
      toast.error("A field with that key is already selected.");
      return;
    }
    onAdd({
      key,
      display_name: trimmed.slice(0, 80),
      data_type: dataType,
      bucket,
      description: description.trim().slice(0, 200),
      origin: "manual",
    });
    setDisplayName("");
    setDescription("");
    setDataType("text");
    setBucket(BUCKETS[0]);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Add a custom field</DialogTitle>
          <DialogDescription className="text-sm">
            Define a one-off field that is not in the shared library. It is saved with this
            profile only.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="manual-name" className="text-xs">
              Field name
            </Label>
            <Input
              id="manual-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Policy Excess Amount"
              className="h-8 text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Data type</Label>
              <Select value={dataType} onValueChange={(value) => setDataType(value as DataType)}>
                <SelectTrigger className="h-8 text-sm" aria-label="Data type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value} className="text-sm">
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bucket</Label>
              <Select value={bucket} onValueChange={setBucket}>
                <SelectTrigger className="h-8 text-sm" aria-label="Bucket">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUCKETS.map((item) => (
                    <SelectItem key={item} value={item} className="text-sm">
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-desc" className="text-xs">
              Description
            </Label>
            <Textarea
              id="manual-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What should a reviewer capture here?"
              className="min-h-16 text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" className="h-8 text-sm" onClick={submit}>
            Add field
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
