import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  ArchiveRestore,
  Database,
  FolderKanban,
  HardDrive,
  Loader2,
  Plug,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell/AppShell";
import { workspaceTypeLabel } from "@/components/app-shell/nav-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatBytes, useAdminSnapshot, type AdminProject, type AdminUser } from "@/lib/admin-data";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Console — LabelFactory" },
      {
        name: "description",
        content:
          "Platform-wide administration: projects, users, integrations, uploads and system health.",
      },
      { property: "og:title", content: "Admin Console — LabelFactory" },
      {
        property: "og:description",
        content: "Manage every project, user, integration and upload across the platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

const TABS = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "uploads", label: "Uploads", icon: HardDrive },
  { id: "users", label: "Users", icon: Users },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TH = "h-8 px-3 text-2xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2 text-xs";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ tone, children }: { tone: "ok" | "warn" | "bad" | "muted"; children: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2 py-0 text-2xs font-medium",
        tone === "ok" && "border-primary/40 bg-primary/10 text-primary",
        tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "bad" && "border-destructive/40 bg-destructive/10 text-destructive",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      {children}
    </Badge>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-0.5 text-2xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function AdminPage() {
  const { isAdmin, user } = useAuth();
  const [tab, setTab] = useState<TabId>("overview");
  const snapshot = useAdminSnapshot(isAdmin);
  const queryClient = useQueryClient();

  const [projectSearch, setProjectSearch] = useState("");
  const [uploadProject, setUploadProject] = useState("all");
  const [uploadSearch, setUploadSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminProject | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [memberTarget, setMemberTarget] = useState<AdminUser | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-snapshot"] });

  const setArchived = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.from("projects").update({ archived }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: ["projects"] })]);
      toast.success(variables.archived ? "Project archived" : "Project restored");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
  });

  const deleteProject = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      setDeleteTarget(null);
      setDeleteConfirm("");
      await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: ["projects"] })]);
      toast.success("Project permanently deleted");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed"),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "admin" | "member" }) => {
      const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", userId);
      if (deleteError) throw deleteError;
      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      toast.success("Role updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Role change failed"),
  });

  const setActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ deactivated_at: active ? null : new Date().toISOString() })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      await invalidate();
      toast.success(variables.active ? "Account reactivated" : "Account deactivated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
  });

  const data = snapshot.data;

  const filteredProjects = useMemo(() => {
    const term = projectSearch.trim().toLowerCase();
    if (!data) return [];
    return data.projects.filter(
      (project) =>
        !term ||
        project.name.toLowerCase().includes(term) ||
        project.ownerEmail.toLowerCase().includes(term),
    );
  }, [data, projectSearch]);

  const filteredUploads = useMemo(() => {
    const term = uploadSearch.trim().toLowerCase();
    if (!data) return [];
    return data.uploads.filter(
      (upload) =>
        (uploadProject === "all" || upload.projectId === uploadProject) &&
        (!term || upload.filename.toLowerCase().includes(term)),
    );
  }, [data, uploadProject, uploadSearch]);

  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!data) return [];
    return data.users.filter(
      (row) =>
        !term ||
        (row.email ?? "").toLowerCase().includes(term) ||
        (row.fullName ?? "").toLowerCase().includes(term),
    );
  }, [data, userSearch]);

  if (!isAdmin) {
    return (
      <AppShell title="Admin Console">
        <div className="panel p-6">
          <h2 className="text-base font-semibold tracking-tight">Administrator access required</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Your account does not have the admin role. Ask an administrator for access.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Admin Console">
      <div className="flex flex-col gap-4 lg:flex-row">
        <nav aria-label="Admin sections" className="panel h-fit shrink-0 p-2 lg:w-52">
          <div className="flex gap-1 overflow-x-auto lg:flex-col">
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {snapshot.isLoading || !data ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : snapshot.isError ? (
            <div className="panel p-6 text-sm text-destructive">
              Could not load platform data. {String((snapshot.error as Error)?.message ?? "")}
            </div>
          ) : tab === "overview" ? (
            <section className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Tile
                  label="Total projects"
                  value={String(data.totals.projects)}
                  hint={`${data.totals.activeProjects} active`}
                />
                <Tile label="Total users" value={String(data.totals.users)} />
                <Tile
                  label="Documents processed"
                  value={String(data.totals.documents)}
                  hint={`${data.totals.approvedDocuments} approved`}
                />
                <Tile
                  label="Storage used"
                  value={formatBytes(data.totals.storageBytes)}
                  hint={`${data.uploads.length} stored files`}
                />
              </div>

              <div className="panel p-4">
                <h2 className="text-sm font-semibold tracking-tight">System health</h2>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  <HealthRow
                    label="Database & API"
                    ok
                    detail="All platform queries responded"
                  />
                  <HealthRow
                    label="Document storage"
                    ok
                    detail={`${formatBytes(data.totals.storageBytes)} across ${data.uploads.length} objects`}
                  />
                  <HealthRow
                    label="Rejected documents"
                    ok={data.totals.failedDocuments === 0}
                    detail={`${data.totals.failedDocuments} rejected in review`}
                  />
                  <HealthRow
                    label="Webhook deliveries"
                    ok={data.webhooks.every((hook) => hook.lastSuccess !== false)}
                    detail={`${data.webhooks.filter((hook) => hook.lastSuccess === false).length} endpoint(s) failing`}
                  />
                </ul>
              </div>
            </section>
          ) : tab === "integrations" ? (
            <section className="panel overflow-hidden">
              <header className="border-b border-border p-4">
                <h2 className="text-sm font-semibold tracking-tight">External connectors</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Model providers, storage backends and outbound webhooks configured across the platform.
                </p>
              </header>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TH}>Integration</TableHead>
                    <TableHead className={TH}>Type</TableHead>
                    <TableHead className={TH}>Detail</TableHead>
                    <TableHead className={TH}>Status</TableHead>
                    <TableHead className={cn(TH, "text-right")}>Configured in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className={cn(TD, "font-medium")}>Lovable AI Gateway</TableCell>
                    <TableCell className={TD}>Model provider</TableCell>
                    <TableCell className={TD}>Default hosted models for prelabel and generation</TableCell>
                    <TableCell className={TD}>
                      <StatusBadge tone="ok">Connected</StatusBadge>
                    </TableCell>
                    <TableCell className={cn(TD, "text-right text-muted-foreground")}>Built-in</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className={cn(TD, "font-medium")}>Document storage</TableCell>
                    <TableCell className={TD}>Storage backend</TableCell>
                    <TableCell className={TD}>
                      Private bucket · {formatBytes(data.totals.storageBytes)} used
                    </TableCell>
                    <TableCell className={TD}>
                      <StatusBadge tone="ok">Connected</StatusBadge>
                    </TableCell>
                    <TableCell className={cn(TD, "text-right")}>
                      <Link to="/ingestion" className="text-xs text-primary hover:underline">
                        Ingestion
                      </Link>
                    </TableCell>
                  </TableRow>
                  {data.connectors.map((connector) => (
                    <TableRow key={connector.id}>
                      <TableCell className={cn(TD, "font-medium")}>{connector.name}</TableCell>
                      <TableCell className={TD}>
                        {connector.kind === "self_hosted" ? "Self-hosted model" : "Model provider"}
                      </TableCell>
                      <TableCell className={TD}>
                        {connector.provider} · {connector.model}
                      </TableCell>
                      <TableCell className={TD}>
                        {connector.hasKey ? (
                          <StatusBadge tone="ok">Connected</StatusBadge>
                        ) : (
                          <StatusBadge tone="warn">Not configured</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className={cn(TD, "text-right")}>
                        <Link to="/settings" className="text-xs text-primary hover:underline">
                          Settings
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.webhooks.map((hook) => (
                    <TableRow key={hook.id}>
                      <TableCell className={cn(TD, "font-medium")}>{hook.name}</TableCell>
                      <TableCell className={TD}>Webhook endpoint</TableCell>
                      <TableCell className={cn(TD, "max-w-[22rem] truncate text-muted-foreground")}>
                        {hook.url}
                      </TableCell>
                      <TableCell className={TD}>
                        {!hook.enabled ? (
                          <StatusBadge tone="muted">Disabled</StatusBadge>
                        ) : hook.lastSuccess === false ? (
                          <StatusBadge tone="bad">Error</StatusBadge>
                        ) : hook.lastSuccess === null ? (
                          <StatusBadge tone="warn">Not verified</StatusBadge>
                        ) : (
                          <StatusBadge tone="ok">Connected</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className={cn(TD, "text-right")}>
                        <Link to="/export" className="text-xs text-primary hover:underline">
                          Export &amp; Integrations
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ) : tab === "projects" ? (
            <section className="panel overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">All projects</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {filteredProjects.length} of {data.projects.length} projects
                  </p>
                </div>
                <Input
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="Search name or owner"
                  aria-label="Search projects"
                  className="h-8 w-56 text-xs"
                />
              </header>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TH}>Project</TableHead>
                    <TableHead className={TH}>Owner</TableHead>
                    <TableHead className={TH}>Industry</TableHead>
                    <TableHead className={TH}>Status</TableHead>
                    <TableHead className={TH}>Docs</TableHead>
                    <TableHead className={TH}>Created</TableHead>
                    <TableHead className={cn(TH, "text-right")}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className={cn(TD, "font-medium")}>{project.name}</TableCell>
                      <TableCell className={TD}>
                        <div>{project.ownerName}</div>
                        <div className="text-2xs text-muted-foreground">{project.ownerEmail}</div>
                      </TableCell>
                      <TableCell className={TD}>{workspaceTypeLabel(project.workspaceType)}</TableCell>
                      <TableCell className={TD}>
                        {project.archived ? (
                          <StatusBadge tone="muted">Archived</StatusBadge>
                        ) : (
                          <StatusBadge tone="ok">{project.status}</StatusBadge>
                        )}
                      </TableCell>
                      <TableCell className={TD}>{project.documentCount}</TableCell>
                      <TableCell className={cn(TD, "text-muted-foreground")}>
                        {formatDate(project.createdAt)}
                      </TableCell>
                      <TableCell className={cn(TD, "text-right")}>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-2xs"
                            onClick={() =>
                              setArchived.mutate({ id: project.id, archived: !project.archived })
                            }
                          >
                            {project.archived ? (
                              <ArchiveRestore className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Archive className="size-3.5" aria-hidden="true" />
                            )}
                            {project.archived ? "Restore" : "Archive"}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-2xs"
                            onClick={() => {
                              setDeleteTarget(project);
                              setDeleteConfirm("");
                            }}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredProjects.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className={cn(TD, "text-center text-muted-foreground")}>
                        No projects match this filter.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </section>
          ) : tab === "uploads" ? (
            <section className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Tile label="Storage used" value={formatBytes(data.totals.storageBytes)} />
                <Tile label="Stored files" value={String(data.uploads.length)} />
                <Tile
                  label="Average file size"
                  value={formatBytes(
                    data.uploads.length ? Math.round(data.totals.storageBytes / data.uploads.length) : 0,
                  )}
                />
              </div>

              <div className="panel overflow-hidden">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
                  <div>
                    <h2 className="text-sm font-semibold tracking-tight">Recent uploads</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Newest stored objects across every project.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={uploadProject} onValueChange={setUploadProject}>
                      <SelectTrigger className="h-8 w-52 text-xs" aria-label="Filter by project">
                        <SelectValue placeholder="All projects" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all" className="text-xs">
                          All projects
                        </SelectItem>
                        {data.projects.map((project) => (
                          <SelectItem key={project.id} value={project.id} className="text-xs">
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={uploadSearch}
                      onChange={(event) => setUploadSearch(event.target.value)}
                      placeholder="Search filename"
                      aria-label="Search uploads"
                      className="h-8 w-48 text-xs"
                    />
                  </div>
                </header>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={TH}>File</TableHead>
                      <TableHead className={TH}>Project</TableHead>
                      <TableHead className={TH}>Size</TableHead>
                      <TableHead className={cn(TH, "text-right")}>Uploaded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUploads.map((upload) => (
                      <TableRow key={upload.name}>
                        <TableCell className={cn(TD, "max-w-[24rem] truncate font-medium")}>
                          {upload.filename}
                        </TableCell>
                        <TableCell className={TD}>{upload.projectName}</TableCell>
                        <TableCell className={TD}>{formatBytes(upload.sizeBytes)}</TableCell>
                        <TableCell className={cn(TD, "text-right text-muted-foreground")}>
                          {formatDateTime(upload.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredUploads.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className={cn(TD, "text-center text-muted-foreground")}>
                          No uploads match this filter.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : (
            <section className="panel overflow-hidden">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">All users</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {filteredUsers.length} of {data.users.length} accounts
                  </p>
                </div>
                <Input
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder="Search name or email"
                  aria-label="Search users"
                  className="h-8 w-56 text-xs"
                />
              </header>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={TH}>Name</TableHead>
                    <TableHead className={TH}>Email</TableHead>
                    <TableHead className={TH}>Role</TableHead>
                    <TableHead className={TH}>Status</TableHead>
                    <TableHead className={TH}>Projects</TableHead>
                    <TableHead className={cn(TH, "text-right")}>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((row) => {
                    const isSelf = row.id === user?.id;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className={cn(TD, "font-medium")}>
                          {row.fullName ?? "—"}
                          {isSelf ? (
                            <span className="ml-1 text-2xs text-muted-foreground">(you)</span>
                          ) : null}
                        </TableCell>
                        <TableCell className={cn(TD, "text-muted-foreground")}>{row.email ?? "—"}</TableCell>
                        <TableCell className={TD}>
                          <Select
                            value={row.role}
                            disabled={isSelf || setRole.isPending}
                            onValueChange={(value) =>
                              setRole.mutate({ userId: row.id, role: value as "admin" | "member" })
                            }
                          >
                            <SelectTrigger
                              className="h-7 w-28 text-xs"
                              aria-label={`Role for ${row.email ?? row.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin" className="text-xs">
                                Admin
                              </SelectItem>
                              <SelectItem value="member" className="text-xs">
                                Member
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className={TD}>
                          {row.active ? (
                            <StatusBadge tone="ok">Active</StatusBadge>
                          ) : (
                            <StatusBadge tone="bad">Deactivated</StatusBadge>
                          )}
                        </TableCell>
                        <TableCell className={TD}>
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() => setMemberTarget(row)}
                          >
                            {row.projects.length} project{row.projects.length === 1 ? "" : "s"}
                          </button>
                        </TableCell>
                        <TableCell className={cn(TD, "text-right")}>
                          <Button
                            variant={row.active ? "outline" : "default"}
                            size="sm"
                            className="h-7 px-2 text-2xs"
                            disabled={isSelf || setActive.isPending}
                            onClick={() => setActive.mutate({ userId: row.id, active: !row.active })}
                          >
                            {row.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </section>
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirm("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Permanently delete project</DialogTitle>
            <DialogDescription className="text-xs">
              This removes “{deleteTarget?.name}” and every batch, document, extraction, profile and
              export it contains. This cannot be undone — archive it instead if you only want it
              hidden.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="delete-confirm" className="text-xs">
              Type <span className="font-mono">DELETE</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              className="h-8 text-xs"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              disabled={deleteConfirm !== "DELETE" || deleteProject.isPending}
              onClick={() => deleteTarget && deleteProject.mutate(deleteTarget.id)}
            >
              {deleteProject.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-3.5" aria-hidden="true" />
              )}
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(memberTarget)} onOpenChange={(open) => !open && setMemberTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Project membership</DialogTitle>
            <DialogDescription className="text-xs">
              Projects {memberTarget?.email ?? "this user"} owns or has been added to.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5">
            {memberTarget?.projects.length ? (
              memberTarget.projects.map((project) => (
                <li
                  key={`${project.id}-${project.relation}`}
                  className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate">{project.name}</span>
                  <StatusBadge tone={project.relation === "Owner" ? "ok" : "muted"}>
                    {project.relation}
                  </StatusBadge>
                </li>
              ))
            ) : (
              <li className="text-xs text-muted-foreground">Not a member of any project yet.</li>
            )}
          </ul>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="text-2xs text-muted-foreground">{detail}</div>
      </div>
      <StatusBadge tone={ok ? "ok" : "warn"}>{ok ? "Healthy" : "Attention"}</StatusBadge>
    </li>
  );
}
