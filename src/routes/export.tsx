import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/export")({
  head: () => ({
    meta: [
      { title: "Export — LabelFactory" },
      { name: "description", content: "Export clean structured data from reviewed documents." },
      { property: "og:title", content: "Export — LabelFactory" },
      {
        property: "og:description",
        content: "Export clean structured data from reviewed documents.",
      },
    ],
  }),
  component: () => (
    <SectionPage
      title="Export"
      description="Export approved extractions as structured JSON, CSV or training-ready datasets."
    />
  ),
});
