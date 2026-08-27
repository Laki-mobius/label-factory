import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell/AppShell";
import { WORKSPACE_TYPES, workspaceTypeLabel } from "@/components/app-shell/nav-items";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Projects — LabelFactory" },
      {
        name: "description",
        content:
          "Create and manage document labeling projects across finance, healthcare, legal, insurance and more.",
      },
      { property: "og:title", content: "Projects — LabelFactory" },
      {
        property: "og:description",
        content: "Create and manage document labeling projects for any industry.",
      },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { user } = useAuth();
  const { projects, projectsLoading, setProjectId } = useWorkspace();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [workspaceType, setWorkspaceType] = useState<string>("general");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter(
      (project) =>
        !project.archived &&
        (!term ||
          project.name.toLowerCase().includes(term) ||
          (project.description ?? "").toLowerCase().includes(term)),
    );
  }, [projects, search]);

  const createProject = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("You must be signed in.");
      const { data, error } = await supabase
        .from("projects")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          owner_id: user.id,
          workspace_type: workspaceType as "general",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      toast.success("Project created");
      setOpen(false);
      setName("");
      setDescription("");
      setWorkspaceType("general");
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setProjectId(data.id);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create project"),
  });

  return (
    <AppShell
      title="Projects"
      searchPlaceholder="Search projects"
      searchValue={search}
      onSearchChange={setSearch}
      actions={
        <Button className="h-8 text-sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" aria-hidden="true" />
          New project
        </Button>
      }
    >
      {projectsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
        </div>
      ) : visible.length === 0 ? (
        <div className="panel p-10 text-center">
          <h2 className="text-base font-semibold tracking-tight">
            {projects.length === 0 ? "No projects yet" : "No matching projects"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {projects.length === 0
              ? "A project groups your label profiles, document batches and model connectors for one industry workflow."
              : "Try a different search term."}
          </p>
          {projects.length === 0 ? (
            <Button className="mt-4 h-8 text-sm" onClick={() => setOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Create project
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => {
                setProjectId(project.id);
                void navigate({ to: "/label-profile" });
              }}
              className="panel p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="truncate text-sm font-semibold tracking-tight">
                  {project.name}
                </span>
                <Badge variant="secondary" className="rounded-full text-2xs font-medium">
                  {project.status}
                </Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {project.description || "No description"}
              </p>
              <div className="mt-3 text-2xs uppercase tracking-wide text-muted-foreground">
                {workspaceTypeLabel(project.workspace_type)}
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md" aria-describedby="new-project-description">
          <DialogHeader>
            <DialogTitle className="text-base">New project</DialogTitle>
            <DialogDescription id="new-project-description" className="text-sm">
              Projects scope label profiles, batches and model connectors. Industry is set per
              project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-name" className="text-xs font-medium">
                Name
              </Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-9 text-sm"
                placeholder="Vendor invoices Q3"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-industry" className="text-xs font-medium">
                Industry / workspace type
              </Label>
              <Select value={workspaceType} onValueChange={setWorkspaceType}>
                <SelectTrigger id="project-industry" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKSPACE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value} className="text-sm">
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="project-description" className="text-xs font-medium">
                Description
              </Label>
              <Textarea
                id="project-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-20 text-sm"
                placeholder="What documents will this project handle?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
             
              className="h-8 text-sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
             
              className="h-8 text-sm"
              disabled={!name.trim() || createProject.isPending}
              onClick={() => createProject.mutate()}
            >
              {createProject.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
