import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, EyeOff, FolderPlus, Loader2, Plus, SearchX } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell/AppShell";
import { WORKSPACE_TYPES, workspaceTypeLabel } from "@/components/app-shell/nav-items";
import { IndustryCover } from "@/components/projects/industry-cover";
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
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
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
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

  const resetForm = () => {
    setName("");
    setDescription("");
    setWorkspaceType("general");
  };

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter(
      (project) => !project.archived && (!term || project.name.toLowerCase().includes(term)),
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

      // Starter batch: no profile mapped, no documents — the Dashboard flags both.
      const { error: batchError } = await supabase
        .from("batches")
        .insert({ project_id: data.id, name: "Initial Batch" });
      if (batchError) throw batchError;

      return data;
    },
    onSuccess: async () => {
      // Intentional: stay on Projects, no auto-navigation into the new project.
      setOpen(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created", {
        description: "Open its card when you're ready to start.",
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create project"),
  });

  const setArchived = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase.from("projects").update({ archived }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update project"),
  });

  const archiveProject = (id: string, projectName: string) => {
    setArchived.mutate(
      { id, archived: true },
      {
        onSuccess: () => {
          toast.success(`"${projectName}" archived`, {
            description: "It is hidden from this list but not deleted.",
            action: {
              label: "Undo",
              onClick: () => setArchived.mutate({ id, archived: false }),
            },
          });
        },
      },
    );
  };

  const openProject = (id: string) => {
    setProjectId(id);
    void navigate({ to: "/dashboard" });
  };

  return (
    <AppShell
      title="Projects"
      searchPlaceholder="Search projects"
      searchValue={search}
      onSearchChange={setSearch}
      actions={
        <Button size="sm" className="h-8 text-sm" onClick={() => setOpen(true)}>
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
          <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
            {projects.length === 0 ? (
              <FolderPlus className="size-5" aria-hidden="true" />
            ) : (
              <SearchX className="size-5" aria-hidden="true" />
            )}
          </div>
          <h2 className="mt-3 text-base font-semibold tracking-tight">
            {projects.length === 0 ? "No projects yet" : "No matching projects"}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {projects.length === 0
              ? "A project groups your label profiles, document batches and model connectors for one industry workflow."
              : "No project name matches that search. Try a different term."}
          </p>
          {projects.length === 0 ? (
            <Button size="sm" className="mt-4 h-8 text-sm" onClick={() => setOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Create project
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid auto-rows-fr items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => openProject(project.id)}
              onArchive={() => archiveProject(project.id, project.name)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md" aria-describedby="new-project-description">
          <DialogHeader>
            <DialogTitle className="text-base">New project</DialogTitle>
            <DialogDescription id="new-project-description" className="text-sm">
              Projects scope label profiles, batches and model connectors. The industry you pick
              sets the project's cover art.
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
                Description <span className="text-muted-foreground">(optional)</span>
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
              size="sm"
              className="h-8 text-sm"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-sm"
              disabled={!name.trim() || createProject.isPending}
              onClick={() => createProject.mutate()}
            >
              {createProject.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
