import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/annotate")({
  head: () => ({
    meta: [
      { title: "Annotate & Label — LabelFactory" },
      { name: "description", content: "Review AI pre-labels and correct extracted field values." },
      { property: "og:title", content: "Annotate & Label — LabelFactory" },
      {
        property: "og:description",
        content: "Review AI pre-labels and correct extracted field values.",
      },
    ],
  }),
  component: () => (
    <SectionPage
      title="Annotate & Label"
      description="Review AI-suggested values side by side with source evidence, then accept, correct, reject or lock each field."
    />
  ),
});
