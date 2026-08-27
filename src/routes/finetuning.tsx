import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/finetuning")({
  head: () => ({
    meta: [
      { title: "Finetuning — LabelFactory" },
      { name: "description", content: "Turn approved labels into model fine-tuning datasets." },
      { property: "og:title", content: "Finetuning — LabelFactory" },
      {
        property: "og:description",
        content: "Turn approved labels into model fine-tuning datasets.",
      },
    ],
  }),
  component: () => (
    <SectionPage
      title="Finetuning"
      description="Assemble approved, human-verified extractions into training runs and track fine-tuned model versions."
    />
  ),
});
