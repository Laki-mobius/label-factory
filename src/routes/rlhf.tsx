import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/rlhf")({
  head: () => ({
    meta: [
      { title: "RLHF — LabelFactory" },
      { name: "description", content: "Collect human preference feedback on model extractions." },
      { property: "og:title", content: "RLHF — LabelFactory" },
      {
        property: "og:description",
        content: "Collect human preference feedback on model extractions.",
      },
    ],
  }),
  component: () => (
    <SectionPage
      title="RLHF"
      description="Capture reviewer preference signals on competing extractions and turn corrections into reward data."
    />
  ),
});
