import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/synthetic-data")({
  head: () => ({
    meta: [
      { title: "Synthetic Data — LabelFactory" },
      { name: "description", content: "Generate synthetic labeled documents to expand coverage." },
      { property: "og:title", content: "Synthetic Data — LabelFactory" },
      {
        property: "og:description",
        content: "Generate synthetic labeled documents to expand coverage.",
      },
    ],
  }),
  component: () => (
    <SectionPage
      title="Synthetic Data"
      description="Generate synthetic document variants from a label profile to expand training coverage for rare field patterns."
    />
  ),
});
