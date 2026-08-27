import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Project Dashboard — LabelFactory" },
      {
        name: "description",
        content:
          "Overview of a labeling project: batches, label profile coverage and review progress.",
      },
      { property: "og:title", content: "Project Dashboard — LabelFactory" },
      {
        property: "og:description",
        content: "Overview of batches, label profiles and review progress for a project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <SectionPage
      title="Dashboard"
      description="Project overview with batch progress, profile mapping and review status."
    />
  );
}
