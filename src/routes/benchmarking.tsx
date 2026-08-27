import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/benchmarking")({
  head: () => ({
    meta: [
      { title: "Benchmarking & Evals — LabelFactory" },
      { name: "description", content: "Measure extraction accuracy across models and profiles." },
      { property: "og:title", content: "Benchmarking & Evals — LabelFactory" },
      {
        property: "og:description",
        content: "Measure extraction accuracy across models and profiles.",
      },
    ],
  }),
  component: () => (
    <SectionPage
      title="Benchmarking & Evals"
      description="Compare model connectors and profile versions on field-level accuracy, confidence calibration and review effort."
    />
  ),
});
