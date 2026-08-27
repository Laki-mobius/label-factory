import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { AppShell } from "./AppShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace";
import { Link } from "@tanstack/react-router";

/**
 * Explicit project picker. Rendered instead of a misleading "no data" empty
 * state whenever a project-scoped screen has no resolved project id.
 */
function ProjectPicker() {
  const { projects, setProjectId } = useWorkspace();

  return (
    <div className="panel mx-auto max-w-md p-6 text-center">
      <h2 className="text-base font-semibold tracking-tight">Select a project</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        This screen is scoped to a project. Pick one to continue.
      </p>
      {projects.length > 0 ? (
        <div className="mt-4">
          <Select onValueChange={(value) => setProjectId(value)}>
            <SelectTrigger className="h-8 w-full text-sm" aria-label="Choose a project">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id} className="text-sm">
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <Button asChild className="mt-4 h-8 text-sm">
          <Link to="/">Create your first project</Link>
        </Button>
      )}
    </div>
  );
}

type SectionPageProps = {
  title: string;
  description: string;
  projectScoped?: boolean;
  children?: ReactNode;
};

/**
 * Foundation placeholder for sections whose screens ship in later work.
 * Project-scoped sections never render an empty result without a project.
 */
export function SectionPage({
  title,
  description,
  projectScoped = true,
  children,
}: SectionPageProps) {
  const { projectId, ready, projectsLoading, activeProject } = useWorkspace();

  let body: ReactNode;
  if (!projectScoped) {
    body = children ?? <Placeholder title={title} description={description} />;
  } else if (!ready || projectsLoading) {
    body = (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  } else if (!projectId || !activeProject) {
    body = <ProjectPicker />;
  } else {
    body = children ?? <Placeholder title={title} description={description} />;
  }

  return (
    <AppShell title={title} showProjectSwitcher={projectScoped}>
      {body}
    </AppShell>
  );
}

function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="panel p-6">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
      <p className="mt-4 text-xs text-muted-foreground">This section is coming next.</p>
    </div>
  );
}
