import type { SupabaseClient } from "@supabase/supabase-js";

import {
  generateSyntheticDrafts,
  resolveModel,
  type SyntheticField,
} from "./synthetic.server";

type GenerationInput = {
  projectId: string;
  profileId: string;
  batchId?: string | null | undefined;
  count: number;
  constraints: string;
  existingTitles: string[];
};

export type SyntheticRecordRow = {
  id: string;
  title: string;
  summary: string | null;
  fields: { field_key: string; field_label: string; data_type: string; value: string }[];
  status: string;
  created_at: string;
};

export async function runSyntheticGeneration(
  supabase: SupabaseClient,
  userId: string,
  input: GenerationInput,
): Promise<{ records: SyntheticRecordRow[] }> {
  const { data: profile, error: profileError } = await supabase
    .from("label_profiles")
    .select("id, name, document_type, fields, model_config, project_id")
    .eq("id", input.profileId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error("Label profile not found.");
  if (profile.project_id !== input.projectId) {
    throw new Error("That label profile belongs to a different project.");
  }

  const fields = (Array.isArray(profile.fields) ? profile.fields : []) as SyntheticField[];
  if (fields.length === 0) {
    throw new Error("This label profile has no fields yet. Add fields before generating.");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("workspace_type")
    .eq("id", input.projectId)
    .maybeSingle();

  const drafts = await generateSyntheticDrafts({
    model: resolveModel((profile.model_config as Record<string, unknown> | null)?.["model"]),
    documentType: profile.document_type ?? "",
    industry: String(project?.workspace_type ?? "general"),
    profileName: profile.name,
    fields,
    count: input.count,
    constraints: input.constraints ?? "",
    existingTitles: input.existingTitles ?? [],
  });

  if (drafts.length === 0) {
    throw new Error("The model returned no usable synthetic records. Try again.");
  }

  const labelByKey = new Map(fields.map((field) => [field.key, field]));
  const rows = drafts.map((draft) => ({
    project_id: input.projectId,
    batch_id: input.batchId ?? null,
    label_profile_id: input.profileId,
    title: draft.title,
    summary: draft.summary,
    constraints_note: input.constraints?.trim() || null,
    created_by: userId,
    fields: draft.values.map((value) => {
      const field = labelByKey.get(value.field_key);
      return {
        field_key: value.field_key,
        field_label: field?.display_name ?? value.field_key,
        data_type: field?.data_type ?? "text",
        value: value.value,
      };
    }),
  }));

  const { data: inserted, error: insertError } = await supabase
    .from("synthetic_records")
    .insert(rows)
    .select("id, title, summary, fields, status, created_at");
  if (insertError) throw insertError;

  return { records: (inserted ?? []) as unknown as SyntheticRecordRow[] };
}
