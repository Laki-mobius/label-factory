import { createFileRoute } from "@tanstack/react-router";

import { SectionPage } from "@/components/app-shell/SectionPage";

export const Route = createFileRoute("/ingestion")({
  head: () => ({
    meta: [
      { title: "Ingestion — LabelFactory" },
      { name: "description", content: "Upload PDF and HTML documents into review batches." },
      { property: "og:title", content: "Ingestion — LabelFactory" },
      { property: "og:description", content: "Upload PDF and HTML documents into review batches." },
    ],
  }),
  component: () => (
    <SectionPage
      title="Ingestion"
      description="Upload PDF and HTML documents, group them into batches, and map a label profile before extraction runs."
    />
  ),
});
