import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, History, Rocket, SlidersHorizontal, TrendingUp } from "lucide-react";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/finetuning")({
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
      {
        name: "description",
        content:
          "Launch the external finetuning dashboard to train, manage and monitor your custom models.",
      },
      { property: "og:title", content: "Finetuning — LabelFactory" },
      {
        property: "og:description",
        content:
          "Train, manage, and monitor your custom models in our specialized external environment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SectionPage
      title="Finetuning"
      description="Train, manage, and monitor your custom models in our specialized external environment."
      projectScoped={false}
    >
      <FinetuningRedirect />
    </SectionPage>
  ),
});

// External finetuning trainer/dashboard this screen hands off to.
const DASHBOARD_URL = "http://13.232.128.52:7777/";

const CAPABILITIES = [
  {
    icon: TrendingUp,
    title: "Performance",
    description: "Real-time model performance tracking and evaluation metrics.",
  },
  {
    icon: SlidersHorizontal,
    title: "Optimization",
    description: "Advanced hyperparameter optimization and tuning controls.",
  },
  {
    icon: History,
    title: "History",
    description: "Comprehensive training history, logs, and version control.",
  },
] as const;

function FinetuningRedirect() {
  return (
    <div className="mx-auto max-w-lg">
      <div className="panel p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-primary-soft">
          <Rocket className="size-6 text-primary-soft-foreground" aria-hidden="true" />
        </div>

        <h2 className="mt-4 text-lg font-semibold tracking-tight">Finetuning Dashboard</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Train, manage, and monitor your custom models in our specialized external environment.
        </p>

        <Button asChild className="mt-5 h-9 text-sm">
          <a href={DASHBOARD_URL} target="_blank" rel="noopener noreferrer">
            Launch External Dashboard
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">This will open in a new secure tab.</p>

        <div className="mt-6 border-t border-border pt-5">
          <p className="text-left text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Dashboard capabilities
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {CAPABILITIES.map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-md border border-border p-3 text-left">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {title}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
