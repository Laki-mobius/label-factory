import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type AdminProject = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  workspaceType: string;
  status: string;
  archived: boolean;
  createdAt: string;
  documentCount: number;
};

export type AdminUser = {
  id: string;
  fullName: string | null;
  email: string | null;
  role: "admin" | "member";
  active: boolean;
  createdAt: string;
  projects: { id: string; name: string; relation: "Owner" | "Member" }[];
};

export type AdminUpload = {
  name: string;
  filename: string;
  projectId: string | null;
  projectName: string;
  sizeBytes: number;
  createdAt: string;
};

export type AdminSnapshot = {
  projects: AdminProject[];
  users: AdminUser[];
  uploads: AdminUpload[];
  totals: {
    projects: number;
    activeProjects: number;
    users: number;
    documents: number;
    approvedDocuments: number;
    failedDocuments: number;
    storageBytes: number;
  };
  connectors: { id: string; name: string; provider: string; model: string; kind: string; projectId: string; hasKey: boolean }[];
  webhooks: { id: string; name: string; url: string; enabled: boolean; projectId: string; lastSuccess: boolean | null }[];
};

export function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** Platform-wide snapshot. Admin RLS policies scope every read; non-admins get nothing. */
export function useAdminSnapshot(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-snapshot"],
    enabled,
    queryFn: async (): Promise<AdminSnapshot> => {
      const [projectsRes, profilesRes, rolesRes, membersRes, batchesRes, connectorsRes, webhooksRes, deliveriesRes] =
        await Promise.all([
          supabase
            .from("projects")
            .select("id,name,description,owner_id,workspace_type,status,archived,created_at")
            .order("created_at", { ascending: false }),
          supabase.from("profiles").select("id,email,full_name,created_at,deactivated_at"),
          supabase.from("user_roles").select("user_id,role"),
          supabase.from("project_members").select("project_id,user_id"),
          supabase.from("batches").select("id,project_id"),
          supabase.from("model_connectors").select("id,name,provider,model_name,kind,project_id,api_key"),
          supabase.from("webhooks").select("id,name,url,enabled,project_id"),
          supabase
            .from("webhook_deliveries")
            .select("webhook_id,success,created_at")
            .order("created_at", { ascending: false })
            .limit(200),
        ]);

      const firstError =
        projectsRes.error ??
        profilesRes.error ??
        rolesRes.error ??
        membersRes.error ??
        batchesRes.error ??
        connectorsRes.error ??
        webhooksRes.error ??
        deliveriesRes.error;
      if (firstError) throw firstError;

      const batches = batchesRes.data ?? [];
      const batchProject = new Map(batches.map((batch) => [batch.id, batch.project_id]));

      const documentsRes = batches.length
        ? await supabase
            .from("documents")
            .select("id,batch_id,status")
            .in(
              "batch_id",
              batches.map((batch) => batch.id),
            )
        : { data: [], error: null };
      if (documentsRes.error) throw documentsRes.error;
      const documents = documentsRes.data ?? [];

      const storageRes = await supabase.rpc("admin_storage_objects", { _limit: 500 });
      if (storageRes.error) throw storageRes.error;
      const objects = storageRes.data ?? [];

      const projectRows = projectsRes.data ?? [];
      const projectName = new Map(projectRows.map((project) => [project.id, project.name]));
      const profileRows = profilesRes.data ?? [];
      const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
      const roleByUser = new Map((rolesRes.data ?? []).map((row) => [row.user_id, row.role]));

      const docsPerProject = new Map<string, number>();
      for (const doc of documents) {
        const pid = batchProject.get(doc.batch_id);
        if (pid) docsPerProject.set(pid, (docsPerProject.get(pid) ?? 0) + 1);
      }

      const projects: AdminProject[] = projectRows.map((project) => {
        const owner = profileById.get(project.owner_id);
        return {
          id: project.id,
          name: project.name,
          description: project.description,
          ownerId: project.owner_id,
          ownerName: owner?.full_name ?? owner?.email ?? "Unknown owner",
          ownerEmail: owner?.email ?? "—",
          workspaceType: project.workspace_type,
          status: project.status,
          archived: project.archived,
          createdAt: project.created_at,
          documentCount: docsPerProject.get(project.id) ?? 0,
        };
      });

      const memberships = membersRes.data ?? [];
      const users: AdminUser[] = profileRows.map((profile) => {
        const owned = projectRows
          .filter((project) => project.owner_id === profile.id)
          .map((project) => ({ id: project.id, name: project.name, relation: "Owner" as const }));
        const joined = memberships
          .filter((row) => row.user_id === profile.id && !owned.some((p) => p.id === row.project_id))
          .map((row) => ({
            id: row.project_id,
            name: projectName.get(row.project_id) ?? "Unknown project",
            relation: "Member" as const,
          }));
        return {
          id: profile.id,
          fullName: profile.full_name,
          email: profile.email,
          role: (roleByUser.get(profile.id) ?? "member") as "admin" | "member",
          active: !profile.deactivated_at,
          createdAt: profile.created_at,
          projects: [...owned, ...joined],
        };
      });

      const uploads: AdminUpload[] = objects.map((object) => ({
        name: object.object_name,
        filename: object.object_name.split("/").pop() ?? object.object_name,
        projectId: object.project_id,
        projectName: (object.project_id && projectName.get(object.project_id)) || "Unknown project",
        sizeBytes: Number(object.size_bytes ?? 0),
        createdAt: object.created_at,
      }));

      const deliveries = deliveriesRes.data ?? [];
      const lastDelivery = new Map<string, boolean>();
      for (const delivery of deliveries) {
        if (!lastDelivery.has(delivery.webhook_id)) lastDelivery.set(delivery.webhook_id, delivery.success);
      }

      return {
        projects,
        users,
        uploads,
        totals: {
          projects: projects.length,
          activeProjects: projects.filter((project) => !project.archived).length,
          users: users.length,
          documents: documents.length,
          approvedDocuments: documents.filter((doc) => doc.status === "approved").length,
          failedDocuments: documents.filter((doc) => doc.status === "rejected").length,
          storageBytes: uploads.reduce((sum, upload) => sum + upload.sizeBytes, 0),
        },
        connectors: (connectorsRes.data ?? []).map((connector) => ({
          id: connector.id,
          name: connector.name,
          provider: connector.provider,
          model: connector.model_name,
          kind: connector.kind,
          projectId: connector.project_id,
          hasKey: Boolean(connector.api_key),
        })),
        webhooks: (webhooksRes.data ?? []).map((webhook) => ({
          id: webhook.id,
          name: webhook.name,
          url: webhook.url,
          enabled: webhook.enabled,
          projectId: webhook.project_id,
          lastSuccess: lastDelivery.get(webhook.id) ?? null,
        })),
      };
    },
  });
}
