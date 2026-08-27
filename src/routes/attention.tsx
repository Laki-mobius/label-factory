import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace";
import { useProjectDashboard } from "@/lib/dashboard-data";

export const Route = createFileRoute("/attention")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Every flagged batch in this project: missing label profiles, empty batches and documents awaiting review.",
      },
      { property: "og:title", content: "Attention Queue — LabelFactory" },
      {
        property: "og:description",
        content: "All items across the project that need your attention, in one list.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AttentionPage,
});

function AttentionPage() {
  return (
    <SectionPage
      title="Attention Queue"
      description="All flagged items across this project's batches."
    >
      <AttentionBody />
    </SectionPage>
  );
}

function AttentionBody() {
  const { projectId, setBatchId } = useWorkspace();
  const navigate = useNavigate();
  const { data, isPending, error } = useProjectDashboard(projectId);

  if (isPending) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel p-6" role="alert">
        <h2 className="text-base font-semibold tracking-tight">Could not load the queue</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Unexpected error."}
        </p>
      </div>
    );
  }

  const items = data!.attention;

  if (items.length === 0) {
    return (
      <div className="panel p-10 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-primary-soft text-primary-soft-foreground">
          <CheckCircle2 className="size-5" aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-base font-semibold tracking-tight">Queue is clear</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          No batch in this project is missing a profile, empty, or waiting on review.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={
            item.severity === "danger"
              ? "panel flex flex-wrap items-center gap-3 border-destructive/40 p-3"
              : "panel flex flex-wrap items-center gap-3 p-3"
          }
        >
          {item.severity === "danger" ? (
            <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
          ) : (
            <Info className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight">{item.title}</span>
              <Badge variant="secondary" className="rounded-full text-2xs font-medium">
                {item.batchName}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setBatchId(item.batchId);
              void navigate({ to: item.target });
            }}
          >
            {item.targetLabel}
          </Button>
        </div>
      ))}
    </div>
  );
}
