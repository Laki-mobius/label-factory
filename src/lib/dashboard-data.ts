import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type BatchStatus =
  | "uploaded"
  | "processing"
  | "prelabeled"
  | "in_review"
  | "complete";

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  uploaded: "Uploaded",
  processing: "Processing",
  prelabeled: "Prelabeled",
  in_review: "In Review",
  complete: "Complete",
};

export type BatchRow = {
  id: string;
  name: string;
  status: BatchStatus;
  createdAt: string;
  profileId: string | null;
  profileLabel: string | null;
  documentCount: number;
  prelabeledCount: number;
  approvedCount: number;
  /** 0-100, share of documents that reached an approved state. */
  progress: number;
};

export type AttentionItem = {
  id: string;
  batchId: string;
  batchName: string;
  severity: "danger" | "info";
  title: string;
  detail: string;
  /** Where the fix happens. */
  target: "/label-profile" | "/ingestion" | "/annotate";
  targetLabel: string;
};

export type DashboardData = {
  batches: BatchRow[];
  attention: AttentionItem[];
  stats: {
    approvedRecords: number;
    profilesRepresented: number;
    batchesRepresented: number;
    approvalRate: number;
    prelabelCompletion: number;
    totalDocuments: number;
  };
};

const PRELABELED_STATES = new Set(["prelabeled", "in_review", "approved", "rejected"]);

export function projectDashboardKey(projectId: string | null) {
  return ["project-dashboard", projectId] as const;
}

export function useProjectDashboard(projectId: string | null) {
  return useQuery({
    queryKey: projectDashboardKey(projectId),
    // Never query with a null id — the caller renders a picker instead.
    enabled: Boolean(projectId),
    queryFn: async (): Promise<DashboardData> => {
      const { data: batches, error: batchError } = await supabase
        .from("batches")
        .select("id, name, status, created_at, label_profile_id")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (batchError) throw batchError;

      const { data: profiles, error: profileError } = await supabase
        .from("label_profiles")
        .select("id, name, version")
        .eq("project_id", projectId!);
      if (profileError) throw profileError;

      const batchIds = (batches ?? []).map((batch) => batch.id);
      let documents: { id: string; batch_id: string; status: string }[] = [];
      if (batchIds.length > 0) {
        const { data, error } = await supabase
          .from("documents")
          .select("id, batch_id, status")
          .in("batch_id", batchIds);
        if (error) throw error;
        documents = data ?? [];
      }

      const profileById = new Map(
        (profiles ?? []).map((profile) => [
          profile.id,
          `${profile.name} · v${profile.version}`,
        ]),
      );

      const rows: BatchRow[] = (batches ?? []).map((batch) => {
        const docs = documents.filter((doc) => doc.batch_id === batch.id);
        const approvedCount = docs.filter((doc) => doc.status === "approved").length;
        const prelabeledCount = docs.filter((doc) => PRELABELED_STATES.has(doc.status)).length;
        return {
          id: batch.id,
          name: batch.name,
          status: batch.status as BatchStatus,
          createdAt: batch.created_at,
          profileId: batch.label_profile_id,
          profileLabel: batch.label_profile_id
            ? (profileById.get(batch.label_profile_id) ?? "Unknown profile")
            : null,
          documentCount: docs.length,
          prelabeledCount,
          approvedCount,
          progress: docs.length === 0 ? 0 : Math.round((approvedCount / docs.length) * 100),
        };
      });

      const attention: AttentionItem[] = [];
      for (const row of rows) {
        if (!row.profileId) {
          attention.push({
            id: `${row.id}-no-profile`,
            batchId: row.id,
            batchName: row.name,
            severity: "danger",
            title: "No label profile mapped",
            detail: `"${row.name}" cannot be pre-labeled until a label profile is mapped to it.`,
            target: "/label-profile",
            targetLabel: "Map a profile",
          });
        }
        if (row.documentCount === 0) {
          attention.push({
            id: `${row.id}-no-documents`,
            batchId: row.id,
            batchName: row.name,
            severity: "info",
            title: "No documents uploaded",
            detail: `"${row.name}" is empty. Upload PDFs or HTML files to start extraction.`,
            target: "/ingestion",
            targetLabel: "Upload documents",
          });
        }
        if (
          row.documentCount > 0 &&
          row.prelabeledCount === row.documentCount &&
          row.approvedCount < row.documentCount
        ) {
          attention.push({
            id: `${row.id}-awaiting-review`,
            batchId: row.id,
            batchName: row.name,
            severity: "info",
            title: "Awaiting human review",
            detail: `${row.documentCount - row.approvedCount} of ${row.documentCount} documents in "${row.name}" still need review.`,
            target: "/annotate",
            targetLabel: "Review now",
          });
        }
      }

      const totalDocuments = documents.length;
      const approvedRecords = documents.filter((doc) => doc.status === "approved").length;
      const prelabeled = documents.filter((doc) => PRELABELED_STATES.has(doc.status)).length;
      const approvedBatches = rows.filter((row) => row.approvedCount > 0);
      const profilesRepresented = new Set(
        approvedBatches.map((row) => row.profileId).filter(Boolean) as string[],
      ).size;

      return {
        batches: rows,
        attention,
        stats: {
          approvedRecords,
          profilesRepresented,
          batchesRepresented: approvedBatches.length,
          approvalRate:
            totalDocuments === 0 ? 0 : Math.round((approvedRecords / totalDocuments) * 100),
          prelabelCompletion:
            totalDocuments === 0 ? 0 : Math.round((prelabeled / totalDocuments) * 100),
          totalDocuments,
        },
      };
    },
  });
}
