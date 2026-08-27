import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type ExportFormatId = "json" | "csv" | "coco" | "schema";

export const EXPORT_FORMATS: { id: ExportFormatId; label: string; hint: string; ext: string; mime: string }[] = [
  { id: "json", label: "JSON", hint: "Nested records with field metadata", ext: "json", mime: "application/json" },
  { id: "csv", label: "CSV", hint: "One row per document, one column per field", ext: "csv", mime: "text/csv" },
  {
    id: "coco",
    label: "COCO-style",
    hint: "Images/annotations/categories layout for vision pipelines",
    ext: "json",
    mime: "application/json",
  },
  {
    id: "schema",
    label: "Schema-matched",
    hint: "Flat object keyed exactly by the label profile field keys",
    ext: "json",
    mime: "application/json",
  },
];

export type ExportField = {
  key: string;
  label: string;
  dataType: string;
  value: string;
  confidence: number | null;
  reviewState: string;
  page: number | null;
  evidence: string | null;
};

export type ExportDocument = {
  id: string;
  filename: string;
  fileType: string;
  pageCount: number;
  batchId: string;
  batchName: string;
  profileLabel: string | null;
  isSynthetic: boolean;
  approvedAt: string;
  fields: ExportField[];
};

export function exportDataKey(projectId: string | null, batchId: string) {
  return ["export-documents", projectId, batchId] as const;
}

/** Approved documents in a project (optionally one batch) with their final field values. */
export function useApprovedDocuments(projectId: string | null, batchId: string) {
  return useQuery({
    queryKey: exportDataKey(projectId, batchId),
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ExportDocument[]> => {
      const { data: batches, error: batchError } = await supabase
        .from("batches")
        .select("id, name, label_profile_id")
        .eq("project_id", projectId!);
      if (batchError) throw batchError;

      const scoped = (batches ?? []).filter((batch) => batchId === "all" || batch.id === batchId);
      if (scoped.length === 0) return [];

      const { data: profiles, error: profileError } = await supabase
        .from("label_profiles")
        .select("id, name, version")
        .eq("project_id", projectId!);
      if (profileError) throw profileError;
      const profileMap = new Map(
        (profiles ?? []).map((profile) => [profile.id, `${profile.name} · v${profile.version}`]),
      );

      const { data: documents, error: documentError } = await supabase
        .from("documents")
        .select("id, filename, file_type, page_count, batch_id, is_synthetic, updated_at")
        .in(
          "batch_id",
          scoped.map((batch) => batch.id),
        )
        .eq("status", "approved")
        .order("updated_at", { ascending: false })
        .limit(2000);
      if (documentError) throw documentError;
      if ((documents ?? []).length === 0) return [];

      const { data: extractions, error: extractionError } = await supabase
        .from("extractions")
        .select(
          "document_id, field_key, field_label, data_type, final_value, suggested_value, confidence, review_state, evidence_page, evidence_snippet",
        )
        .in(
          "document_id",
          (documents ?? []).map((doc) => doc.id),
        )
        .neq("review_state", "rejected")
        .limit(20000);
      if (extractionError) throw extractionError;

      const byDocument = new Map<string, ExportField[]>();
      for (const row of extractions ?? []) {
        const list = byDocument.get(row.document_id) ?? [];
        list.push({
          key: row.field_key,
          label: row.field_label ?? row.field_key,
          dataType: row.data_type,
          value: row.final_value ?? row.suggested_value ?? "",
          confidence: row.confidence === null ? null : Number(row.confidence),
          reviewState: row.review_state,
          page: row.evidence_page,
          evidence: row.evidence_snippet,
        });
        byDocument.set(row.document_id, list);
      }

      const batchMap = new Map(scoped.map((batch) => [batch.id, batch]));

      return (documents ?? []).map((doc) => {
        const batch = batchMap.get(doc.batch_id);
        return {
          id: doc.id,
          filename: doc.filename,
          fileType: doc.file_type,
          pageCount: doc.page_count,
          batchId: doc.batch_id,
          batchName: batch?.name ?? "Unknown batch",
          profileLabel: batch?.label_profile_id
            ? (profileMap.get(batch.label_profile_id) ?? null)
            : null,
          isSynthetic: doc.is_synthetic,
          approvedAt: doc.updated_at,
          fields: byDocument.get(doc.id) ?? [],
        };
      });
    },
  });
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes approved documents into the chosen interchange format. */
export function serializeDocuments(documents: ExportDocument[], format: ExportFormatId): string {
  if (format === "csv") {
    const keys = [...new Set(documents.flatMap((doc) => doc.fields.map((field) => field.key)))];
    const header = ["document_id", "filename", "batch", "profile", "synthetic", ...keys];
    const rows = documents.map((doc) => {
      const lookup = new Map(doc.fields.map((field) => [field.key, field.value]));
      return [
        doc.id,
        doc.filename,
        doc.batchName,
        doc.profileLabel ?? "",
        String(doc.isSynthetic),
        ...keys.map((key) => lookup.get(key) ?? ""),
      ]
        .map((cell) => csvCell(String(cell)))
        .join(",");
    });
    return [header.join(","), ...rows].join("\n");
  }

  if (format === "coco") {
    const categories = [...new Set(documents.flatMap((doc) => doc.fields.map((field) => field.key)))].map(
      (key, index) => ({ id: index + 1, name: key, supercategory: "field" }),
    );
    const categoryIds = new Map(categories.map((category) => [category.name, category.id]));
    let annotationId = 0;
    return JSON.stringify(
      {
        info: { description: "LabelFactory approved extractions", version: "1.0" },
        images: documents.map((doc, index) => ({
          id: index + 1,
          file_name: doc.filename,
          page_count: doc.pageCount,
          synthetic: doc.isSynthetic,
        })),
        annotations: documents.flatMap((doc, index) =>
          doc.fields.map((field) => ({
            id: ++annotationId,
            image_id: index + 1,
            category_id: categoryIds.get(field.key) ?? 0,
            page: field.page,
            value: field.value,
            score: field.confidence,
            review_state: field.reviewState,
          })),
        ),
        categories,
      },
      null,
      2,
    );
  }

  if (format === "schema") {
    return JSON.stringify(
      documents.map((doc) =>
        Object.fromEntries(doc.fields.map((field) => [field.key, field.value])),
      ),
      null,
      2,
    );
  }

  return JSON.stringify(
    documents.map((doc) => ({
      document_id: doc.id,
      filename: doc.filename,
      file_type: doc.fileType,
      page_count: doc.pageCount,
      batch: doc.batchName,
      profile: doc.profileLabel,
      synthetic: doc.isSynthetic,
      approved_at: doc.approvedAt,
      fields: doc.fields.map((field) => ({
        key: field.key,
        label: field.label,
        data_type: field.dataType,
        value: field.value,
        confidence: field.confidence,
        review_state: field.reviewState,
        evidence_page: field.page,
      })),
    })),
    null,
    2,
  );
}

export function downloadText(content: string, name: string, format: ExportFormatId) {
  const meta = EXPORT_FORMATS.find((entry) => entry.id === format)!;
  const blob = new Blob([content], { type: meta.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "export"}.${meta.ext}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
