import type { SupabaseClient } from "@supabase/supabase-js";

import { extractDocumentText, extractValues, type ProfileField } from "./prelabel.server";

const FALLBACK_MODEL = "google/gemini-2.5-flash";

/** Hosted gateway ids only; self-hosted connectors fall back until a runtime exists. */
function resolveModel(raw: unknown): string {
  const model = typeof raw === "string" ? raw : "";
  return model && !model.startsWith("local/") ? model : FALLBACK_MODEL;
}

export async function runPrelabel(supabase: SupabaseClient<any>, documentId: string) {
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, filename, file_type, storage_path, batch_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docError) throw new Error(docError.message);
  if (!doc) throw new Error("Document not found or you do not have access to it.");
  if (!doc.storage_path) throw new Error("This document has no stored file to read.");

  const { data: batch, error: batchError } = await supabase
    .from("batches")
    .select("id, label_profile_id")
    .eq("id", doc.batch_id)
    .maybeSingle();
  if (batchError) throw new Error(batchError.message);
  if (!batch?.label_profile_id) {
    throw new Error("No label profile is mapped to this batch. Map a profile before labeling.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("label_profiles")
    .select("id, name, document_type, fields, model_config")
    .eq("id", batch.label_profile_id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  const fields = (profile?.fields ?? []) as ProfileField[];
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("The mapped label profile has no fields yet.");
  }

  await supabase.from("documents").update({ status: "processing", error_message: null }).eq("id", documentId);

  try {
    const { data: file, error: fileError } = await supabase.storage
      .from("documents")
      .download(doc.storage_path);
    if (fileError || !file) throw new Error(fileError?.message ?? "Stored file could not be read.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, pages } = await extractDocumentText({
      filename: doc.filename,
      mimeType: doc.file_type === "pdf" ? "application/pdf" : "text/html",
      bytes,
    });
    if (text.replace(/\s/g, "").length < 30) {
      throw new Error(
        "No readable text found. Scanned or image-only documents are not supported yet.",
      );
    }

    const values = await extractValues({
      model: resolveModel((profile?.model_config as Record<string, unknown> | null)?.["model"]),
      documentType: profile?.document_type ?? "",
      filename: doc.filename,
      text,
      fields,
    });

    await supabase.from("extractions").delete().eq("document_id", documentId);
    const rows = values.map((value) => {
      const field = fields.find((item) => item.key === value.field_key);
      return {
        document_id: documentId,
        field_key: value.field_key,
        field_label: field?.display_name ?? value.field_key,
        data_type: (field?.data_type ?? "text") as never,
        suggested_value: value.value,
        confidence: value.confidence,
        evidence_snippet: value.evidence,
        evidence_page: Math.min(value.page, Math.max(pages, 1)),
        review_state: "pending" as never,
      };
    });
    const { error: insertError } = await supabase.from("extractions").insert(rows);
    if (insertError) throw new Error(insertError.message);

    await supabase
      .from("documents")
      .update({ status: "prelabeled", page_count: pages, extracted_text: text.slice(0, 200000) })
      .eq("id", documentId);
    await supabase.from("batches").update({ status: "prelabeled" }).eq("id", doc.batch_id);

    return { fields: rows.length, pages };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prelabeling failed.";
    await supabase
      .from("documents")
      .update({ status: "uploaded", error_message: message })
      .eq("id", documentId);
    throw new Error(message);
  }
}
