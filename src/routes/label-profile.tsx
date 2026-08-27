import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/label-profile")({
  head: () => ({
    meta: [
      { title: "Label Profile — LabelFactory" },
      {
        name: "description",
        content: "Define versioned extraction schemas from the shared field library.",
      },
      { property: "og:title", content: "Label Profile — LabelFactory" },
      {
        property: "og:description",
        content: "Define versioned extraction schemas from the shared field library.",
      },
    ],
  }),
  component: () => (
    <SectionPage
      title="Label Profile"
      description="Build versioned extraction schemas: pick fields from the shared library, add custom fields, and attach a model configuration."
    />
  ),
});
