import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { getActiveAiProvider } from "@/lib/ai-provider.functions";
import { listAvailableBenchmarkModels } from "@/lib/benchmark-compare.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { describeFieldWithAi } from "@/lib/field-describe.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/label-profile")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Define versioned extraction schemas: generate fields with AI, read a real sample document, or add them manually.",
      },
      { property: "og:title", content: "Label Profile — LabelFactory" },
      {
        property: "og:description",
        content:
          "Define versioned extraction schemas: generate fields with AI, read a real sample document, or add them manually.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LabelProfileRoute,
});

/** Fallback bucket name used only when a field somehow arrives with none —
 *  buckets are otherwise dynamic, invented per document type (see
 *  field-suggest.server.ts) or typed freely in the Manual Add dialog. */
const FALLBACK_BUCKET = "Miscellaneous";

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

/** A real, catalog-validated model choice (see ai-provider.server.ts). Mirrors
 *  the shape returned by listAvailableBenchmarkModels — kept as a local type
 *  here rather than importing from the server-only ai-provider module. */
type ModelChoice = { provider: "openai" | "gemini"; modelId: string; label: string };

/** Sentinel Select value meaning "no override — use the active provider's
 *  default". Radix Select rejects an empty-string item value, so this stands
 *  in for null in the dropdown and is translated back to null everywhere else. */
const DEFAULT_MODEL_VALUE = "__default__";

function modelChoiceToValue(choice: { provider: string; modelId: string } | null): string {
  return choice ? `${choice.provider}:${choice.modelId}` : DEFAULT_MODEL_VALUE;
}

function valueToModelChoice(value: string): { provider: "openai" | "gemini"; modelId: string } | null {
  if (value === DEFAULT_MODEL_VALUE) return null;
  const sep = value.indexOf(":");
  if (sep === -1) return null;
  const provider = value.slice(0, sep);
  const modelId = value.slice(sep + 1);
  if ((provider === "openai" || provider === "gemini") && modelId) return { provider, modelId };
  return null;
}

type SelectedField = {
  key: string;
  display_name: string;
  data_type: DataType;
  bucket: string;
  description: string;
  /** "common" = independently confirmed by both the Library and AI (or a
   *  library pick that AI later re-proposed) — the strongest signal. */
  origin: "library" | "ai_type" | "ai_sample" | "manual" | "common";
  confidence?: number | undefined;
  /** Curated extraction guidance carried over from a matching Universal
   *  Field Library entry — fed into the extraction prompt server-side. */
  label_hints?: string[];
  confusion_hints?: string[];
  validation_regex?: string;
  /** This field can occur more than once on a document (e.g. line items) —
   *  independent of data_type. Fed into the extraction prompt. */
  multi?: boolean;
  /** Marked as containing personal/sensitive information. This is a
   *  human-set flag: it drives real masking downstream (the review screen
   *  and RLHF/export data), not just a label. */
  sensitive?: boolean;
  /** Free-text, per-field instruction sent to the extractor in place of the
   *  plain description when set — e.g. "Extract only the primary contract
   *  number, ignore any number printed in the header logo." */
  extraction_prompt?: string;
};

/** 0-1 confidence bucketed into a traffic-light label, matching the old
 *  app's thresholds. No confidence at all defaults to "Medium". */
function confidenceLevel(confidence: number | undefined): {
  label: "High" | "Medium" | "Weak";
  dotClass: string;
} {
  if (confidence == null) return { label: "Medium", dotClass: "bg-amber-500" };
  if (confidence >= 0.82) return { label: "High", dotClass: "bg-emerald-500" };
  if (confidence >= 0.58) return { label: "Medium", dotClass: "bg-amber-500" };
  return { label: "Weak", dotClass: "bg-red-500" };
}

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
  const [modelValue, setModelValue] = useState<string>(DEFAULT_MODEL_VALUE);
  const [selected, setSelected] = useState<SelectedField[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [expandedFieldKey, setExpandedFieldKey] = useState<string | null>(null);
  const [sampleStatus, setSampleStatus] = useState<{
    filename: string;
    pages: number;
    characters: number;
    fieldCount: number;
    at: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Read-only status of the active provider — used to describe what
  // "Default" resolves to in the model picker below.
  const getActiveProvider = useServerFn(getActiveAiProvider);
  const activeProviderQuery = useQuery({
    queryKey: ["active-ai-provider"],
    queryFn: () => getActiveProvider({ data: {} }),
    staleTime: 60_000,
  });

  // Real, concrete models available for explicit per-profile selection —
  // only entries whose provider has a configured API key. Different models
  // genuinely produce different field suggestions/extractions, so this is a
  // real choice, not just a display label.
  const listModels = useServerFn(listAvailableBenchmarkModels);
  const modelsQuery = useQuery({
    queryKey: ["available-ai-models"],
    staleTime: 60_000,
    queryFn: async () => (await listModels({ data: {} })).models as ModelChoice[],
  });
  const availableModels = modelsQuery.data ?? [];
  const selectedModel = valueToModelChoice(modelValue);
  const selectedModelLabel = selectedModel
    ? (availableModels.find(
        (m) => m.provider === selectedModel.provider && m.modelId === selectedModel.modelId,
      )?.label ?? selectedModel.modelId)
    : null;

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
        bucket: field.bucket || FALLBACK_BUCKET,
        description: field.description ?? "",
        origin: field.origin ?? "library",
        confidence: field.confidence,
        label_hints: field.label_hints,
        confusion_hints: field.confusion_hints,
        validation_regex: field.validation_regex,
        multi: field.multi,
        sensitive: field.sensitive,
        extraction_prompt: field.extraction_prompt,
      })),
    );
    const config = (profile.model_config ?? {}) as { provider?: unknown; model?: unknown };
    setModelValue(
      (config.provider === "openai" || config.provider === "gemini") &&
        typeof config.model === "string" &&
        config.model
        ? `${config.provider}:${config.model}`
        : DEFAULT_MODEL_VALUE,
    );
  }, [profileId, profiles]);

  const selectedKeys = useMemo(() => new Set(selected.map((f) => f.key)), [selected]);

  // Dynamic bucket names, in first-appearance order — the schema's grouping
  // is entirely driven by what AI proposed / what samples produced / what was
  // typed manually, not a fixed taxonomy.
  const bucketsInUse = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const field of selected) {
      const bucket = field.bucket || FALLBACK_BUCKET;
      if (!seen.has(bucket)) {
        seen.add(bucket);
        order.push(bucket);
      }
    }
    return order;
  }, [selected]);

  // Which group's table is showing. Kept in sync with bucketsInUse: falls
  // back to the first group whenever the current tab disappears (its last
  // field was removed/renamed) or nothing is selected yet.
  const [activeBucketTab, setActiveBucketTab] = useState<string | null>(null);
  useEffect(() => {
    if (bucketsInUse.length === 0) {
      setActiveBucketTab(null);
      return;
    }
    setActiveBucketTab((current) =>
      current && bucketsInUse.includes(current) ? current : bucketsInUse[0],
    );
  }, [bucketsInUse]);

  // AI-proposed fields (from a document type or a sample) land in `selected`,
  // keyed by field key. Fields already present (e.g. re-run "Suggest fields
  // with AI") are left untouched rather than duplicated.
  //
  // Bucket names are also canonicalized case-insensitively here: the AI is
  // told to reuse existing group names (see field-suggest.server.ts), but as
  // a belt-and-suspenders safety net — in case it returns "Financial
  // information" when the schema already has "Financial Information" — any
  // incoming bucket that matches an existing one except for case is folded
  // into the existing spelling, so it never becomes a second, near-duplicate
  // group. This also collapses case-only duplicates *within* one AI response.
  //
  // The added count is computed here, directly against the `selected` from
  // this render, rather than inside the setSelected updater callback — that
  // callback is not guaranteed to run synchronously, so reading the count
  // right after calling setSelected could read it before the updater ever
  // ran. That was the cause of the toast/status panel showing "0 fields
  // proposed" even though the fields were correctly added to the table.
  function mergeFields(incoming: SelectedField[]): { added: number } {
    const existingKeysNow = new Set(selected.map((f) => f.key));
    const bucketByLower = new Map<string, string>();
    for (const f of selected) bucketByLower.set(f.bucket.toLowerCase(), f.bucket);
    const toAdd: SelectedField[] = [];
    for (const field of incoming) {
      if (existingKeysNow.has(field.key)) continue;
      if (toAdd.some((f) => f.key === field.key)) continue;
      const canonical = bucketByLower.get(field.bucket.toLowerCase());
      if (canonical) {
        toAdd.push({ ...field, bucket: canonical });
      } else {
        bucketByLower.set(field.bucket.toLowerCase(), field.bucket);
        toAdd.push(field);
      }
    }
    if (toAdd.length > 0) {
      setSelected((current) => [...current, ...toAdd]);
    }
    return { added: toAdd.length };
  }

  function updateField(key: string, patch: Partial<SelectedField>) {
    setSelected((current) =>
      current.map((field) => (field.key === key ? { ...field, ...patch } : field)),
    );
  }

  const runFromType = useServerFn(generateFieldsFromType);
  const runFromSample = useServerFn(generateFieldsFromSample);

  const aiTypeMutation = useMutation({
    mutationFn: async () => {
      if (!documentType.trim()) throw new Error("Enter a document type first.");
      return runFromType({
        data: {
          model: selectedModel,
          documentType: documentType.trim(),
          industry: activeProject?.workspace_type ?? "general",
          existingBuckets: bucketsInUse,
        },
      });
    },
    onSuccess: (result) => {
      const { added } = mergeFields(
        result.fields.map((field) => ({ ...field, origin: "ai_type" as const })),
      );
      toast.success(
        `AI proposed ${added} new field${added === 1 ? "" : "s"} for "${documentType.trim()}".`,
      );
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
          model: selectedModel,
          documentType: documentType.trim(),
          industry: activeProject?.workspace_type ?? "general",
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          base64: btoa(binary),
          existingBuckets: bucketsInUse,
        },
      });
    },
    onSuccess: (result, file) => {
      const { added } = mergeFields(
        result.fields.map((field) => ({ ...field, origin: "ai_sample" as const })),
      );
      setSampleStatus({
        filename: file.name,
        pages: result.pages,
        characters: result.characters,
        fieldCount: added,
        at: result.generatedAt,
      });
      toast.success(
        `Analysed ${file.name} and proposed ${added} new field${added === 1 ? "" : "s"}.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // "AI Describe" — regenerates one field's description on demand. Tracked
  // by key so each card can show its own spinner independently.
  const runDescribeField = useServerFn(describeFieldWithAi);
  const describeMutation = useMutation({
    mutationFn: async (field: SelectedField) =>
      runDescribeField({
        data: {
          model: selectedModel,
          documentType: documentType.trim(),
          displayName: field.display_name,
          key: field.key,
          dataType: field.data_type,
          existingDescription: field.description || undefined,
        },
      }).then((result) => ({ key: field.key, description: result.description })),
    onSuccess: ({ key, description }) => {
      updateField(key, { description });
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
        // null/null means "use the active provider's default" — every AI
        // action for this profile (field suggestions, extraction, Reward AI,
        // synthetic data) resolves this via resolveModelConfig(), which
        // falls back gracefully if the chosen provider's key is ever removed.
        model_config: {
          provider: selectedModel?.provider ?? null,
          model: selectedModel?.modelId ?? null,
        } as unknown as never,
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
            setModelValue(DEFAULT_MODEL_VALUE);
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
            <Select value={modelValue} onValueChange={setModelValue}>
              <SelectTrigger className="h-8 w-72 text-sm" aria-label="Workflow model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL_VALUE} className="text-sm">
                  Default — active provider
                  {activeProviderQuery.data?.label ? ` (${activeProviderQuery.data.label})` : ""}
                </SelectItem>
                {availableModels.map((choice) => (
                  <SelectItem
                    key={`${choice.provider}:${choice.modelId}`}
                    value={modelChoiceToValue(choice)}
                    className="text-sm"
                  >
                    {choice.provider === "openai" ? "OpenAI" : "Gemini"} · {choice.label}
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
            Suggest fields with AI
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
          {selectedModel
            ? `Field generation, extraction, Reward AI, and synthetic data for this profile all use ${
                selectedModel.provider === "openai" ? "OpenAI" : "Gemini"
              } · ${selectedModelLabel}.`
            : `Default — uses whichever provider is currently active (${
                activeProviderQuery.data?.label ?? "checking…"
              }), with automatic fallback if that key is ever removed.`}
          {modelsQuery.isSuccess && availableModels.length === 0
            ? " Only one provider's key is configured, so no alternate models are available yet."
            : ""}
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

      {/* Two columns */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.55fr)]">
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
              No fields yet. Run Suggest fields with AI, analyse a sample, or add one manually.
            </p>
          ) : (
            <div className="mt-3">
              {/* Group tabs — one per dynamic bucket, active tab in the theme color */}
              <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
                {bucketsInUse.map((bucket) => {
                  const active = activeBucketTab === bucket;
                  const count = selected.filter((f) => f.bucket === bucket).length;
                  return (
                    <Button
                      key={bucket}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "outline"}
                      className="h-7 gap-1.5 px-2.5 text-xs"
                      aria-pressed={active}
                      onClick={() => setActiveBucketTab(bucket)}
                    >
                      {bucket}
                      <span className={cn("text-2xs", active ? "opacity-80" : "text-muted-foreground")}>
                        {count}
                      </span>
                    </Button>
                  );
                })}
              </div>

              {/* Active group's fields */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-muted-foreground">
                      <th className="w-56 pb-1.5 pr-2 font-semibold">Data Field</th>
                      <th className="w-36 pb-1.5 pr-2 font-semibold">Identifiers</th>
                      <th className="w-20 pb-1.5 pr-2 font-semibold">Source</th>
                      <th className="w-14 pb-1.5 pr-2 text-center font-semibold">Multi</th>
                      <th className="w-16 pb-1.5 pr-2 text-center font-semibold">Sensitive</th>
                      <th className="pb-1.5 pr-2 font-semibold">Extraction Prompt</th>
                      <th className="w-8 pb-1.5 font-semibold" aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {selected
                      .filter((field) => field.bucket === activeBucketTab)
                      .map((field) => {
                        const expanded = expandedFieldKey === field.key;
                        return (
                          <Fragment key={field.key}>
                            <tr className={cn("border-b border-border/60", expanded && "bg-primary-soft")}>
                              <td className="py-1.5 pr-2 align-top">
                                <div className="flex items-start gap-1">
                                  <button
                                    type="button"
                                    className="mt-1.5 shrink-0"
                                    aria-label={expanded ? "Collapse field details" : "Expand field details"}
                                    aria-expanded={expanded}
                                    onClick={() =>
                                      setExpandedFieldKey((current) =>
                                        current === field.key ? null : field.key,
                                      )
                                    }
                                  >
                                    <ChevronDown
                                      className={cn(
                                        "size-3.5 text-muted-foreground transition-transform",
                                        !expanded && "-rotate-90",
                                      )}
                                    />
                                  </button>
                                  <Input
                                    value={field.display_name}
                                    onChange={(event) =>
                                      updateField(field.key, { display_name: event.target.value })
                                    }
                                    aria-label={`Display label for ${field.display_name}`}
                                    className="h-7 text-xs"
                                  />
                                </div>
                              </td>
                              <td className="py-1.5 pr-2 align-top">
                                <Input
                                  value={field.key}
                                  onChange={(event) =>
                                    updateField(field.key, { key: event.target.value })
                                  }
                                  aria-label={`Field key for ${field.display_name}`}
                                  className="h-7 font-mono text-xs"
                                />
                              </td>
                              <td className="py-1.5 pr-2 align-top">
                                {field.origin === "ai_type" ? (
                                  <Badge className="text-2xs">AI</Badge>
                                ) : field.origin === "ai_sample" ? (
                                  <Badge className="text-2xs">Sample</Badge>
                                ) : field.origin === "manual" ? (
                                  <Badge variant="outline" className="text-2xs">
                                    Manual
                                  </Badge>
                                ) : field.origin === "common" ? (
                                  <Badge className="text-2xs">Common</Badge>
                                ) : field.origin === "library" ? (
                                  <Badge variant="outline" className="text-2xs">
                                    Library
                                  </Badge>
                                ) : null}
                              </td>
                              <td className="py-1.5 pr-2 text-center align-top">
                                <Switch
                                  checked={field.multi ?? false}
                                  onCheckedChange={(checked) =>
                                    updateField(field.key, { multi: checked })
                                  }
                                  aria-label={`Multi for ${field.display_name}`}
                                />
                              </td>
                              <td className="py-1.5 pr-2 text-center align-top">
                                <Switch
                                  checked={field.sensitive ?? false}
                                  onCheckedChange={(checked) =>
                                    updateField(field.key, { sensitive: checked })
                                  }
                                  aria-label={`Sensitive for ${field.display_name}`}
                                />
                              </td>
                              <td className="py-1.5 pr-2 align-top">
                                <Input
                                  value={field.extraction_prompt ?? ""}
                                  onChange={(event) =>
                                    updateField(field.key, { extraction_prompt: event.target.value })
                                  }
                                  placeholder={field.description || `Extract ${field.display_name}.`}
                                  aria-label={`Extraction prompt for ${field.display_name}`}
                                  className="h-7 min-w-[220px] text-xs"
                                />
                              </td>
                              <td className="py-1.5 align-top">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="size-7 p-0 text-destructive hover:text-destructive"
                                  aria-label={`Remove ${field.display_name}`}
                                  onClick={() =>
                                    setSelected((current) => current.filter((f) => f.key !== field.key))
                                  }
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </td>
                            </tr>
                            {expanded ? (
                              <tr className="border-b border-border/60 bg-primary-soft/60">
                                <td colSpan={7} className="px-2 pb-3 pt-1.5">
                                  <div className="grid gap-2 sm:grid-cols-[minmax(0,160px)_1fr]">
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
                                          <SelectItem key={type.value} value={type.value} className="text-xs">
                                            {type.label}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <div className="flex items-start gap-1.5 text-2xs text-muted-foreground">
                                      <span
                                        className={cn(
                                          "mt-1 size-1.5 shrink-0 rounded-full",
                                          confidenceLevel(field.confidence).dotClass,
                                        )}
                                        aria-hidden="true"
                                      />
                                      <span>
                                        <span className="font-medium">
                                          {confidenceLevel(field.confidence).label}
                                        </span>
                                        {field.description ? `  ${field.description}` : ""}
                                      </span>
                                    </div>
                                  </div>
                                  {(field.label_hints?.length ?? 0) > 0 ||
                                  (field.confusion_hints?.length ?? 0) > 0 ? (
                                    <p className="mt-1.5 text-2xs text-muted-foreground/80">
                                      {field.label_hints?.length
                                        ? `Looks for: ${field.label_hints.slice(0, 3).join(", ")}${
                                            field.label_hints.length > 3 ? "…" : ""
                                          }`
                                        : ""}
                                      {field.label_hints?.length && field.confusion_hints?.length
                                        ? " · "
                                        : ""}
                                      {field.confusion_hints?.length
                                        ? `Avoid confusing with: ${field.confusion_hints
                                            .slice(0, 2)
                                            .join(", ")}${field.confusion_hints.length > 2 ? "…" : ""}`
                                        : ""}
                                    </p>
                                  ) : null}
                                  <div className="mt-2">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 gap-1 px-2 text-2xs"
                                      onClick={() => describeMutation.mutate(field)}
                                      disabled={
                                        describeMutation.isPending &&
                                        describeMutation.variables?.key === field.key
                                      }
                                    >
                                      {describeMutation.isPending &&
                                      describeMutation.variables?.key === field.key ? (
                                        <Loader2 className="size-3 animate-spin" />
                                      ) : (
                                        <Sparkles className="size-3" />
                                      )}
                                      AI Describe
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </div>
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
              <div className="text-lg font-semibold">{bucketsInUse.length}</div>
              <div className="text-2xs text-muted-foreground">Field groups</div>
            </div>
          </div>

          <h3 className="mt-4 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fields by Group
          </h3>
          {bucketsInUse.length === 0 ? (
            <p className="mt-1.5 text-2xs text-muted-foreground">
              Groups appear automatically once fields are added.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {bucketsInUse.map((bucket) => (
                <li key={bucket} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{bucket}</span>
                  <span className="font-medium">
                    {selected.filter((f) => f.bucket === bucket).length}
                  </span>
                </li>
              ))}
            </ul>
          )}

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
                  model_config: {
                    provider: selectedModel?.provider ?? null,
                    model: selectedModel?.modelId ?? null,
                  },
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
        existingBuckets={bucketsInUse}
        onAdd={(field) => {
          // Same case-insensitive fold as mergeFields — typing "financial
          // information" when "Financial Information" already exists should
          // join that group, not start a near-duplicate one.
          const canonical = bucketsInUse.find(
            (b) => b.toLowerCase() === field.bucket.toLowerCase(),
          );
          setSelected((current) => [
            ...current,
            canonical ? { ...field, bucket: canonical } : field,
          ]);
        }}
      />
    </div>
  );
}

function ManualFieldDialog({
  open,
  onOpenChange,
  existingKeys,
  existingBuckets,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingKeys: Set<string>;
  existingBuckets: string[];
  onAdd: (field: SelectedField) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [dataType, setDataType] = useState<DataType>("text");
  const [bucket, setBucket] = useState<string>("");
  const [description, setDescription] = useState("");

  // Default the bucket field to the schema's first existing group whenever
  // the dialog (re)opens with nothing typed yet, so most manual adds land in
  // an existing group without the user having to retype its name.
  useEffect(() => {
    if (open) setBucket((current) => current || existingBuckets[0] || "");
  }, [open, existingBuckets]);

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
      bucket: bucket.trim() || FALLBACK_BUCKET,
      description: description.trim().slice(0, 200),
      origin: "manual",
    });
    setDisplayName("");
    setDescription("");
    setDataType("text");
    setBucket("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Add a custom field</DialogTitle>
          <DialogDescription className="text-sm">
            Define a one-off field by hand. It is saved with this profile only.
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
              <Label htmlFor="manual-bucket" className="text-xs">
                Group
              </Label>
              <Input
                id="manual-bucket"
                list="manual-bucket-options"
                value={bucket}
                onChange={(event) => setBucket(event.target.value)}
                placeholder="e.g. Shipment Details"
                className="h-8 text-sm"
              />
              <datalist id="manual-bucket-options">
                {existingBuckets.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
              <p className="text-2xs text-muted-foreground">
                Pick an existing group or type a new one.
              </p>
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
