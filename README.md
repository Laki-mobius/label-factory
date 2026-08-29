# Label Factory

Build the foundation for a multi-tenant AI-assisted document data-labeling platform (LabelFactory). This is a B2B SaaS tool where teams upload documents (PDFs and HTML), define what fields should be extracted from them, run AI extraction, and have humans review/correct the results before exporting clean structured data or using it to fine-tune models.

 

The platform must work across multiple industries (finance, healthcare, legal, manufacturing, insurance, logistics, etc.) — do not hardcode any single industry's terminology into the core product. Industry is a per-project attribute, not a product-wide theme.

 

Set up:

 

1. Authentication with roles: "admin" (full access across all projects/users) and a standard member role (scoped to projects they own or are added to).

 

2. Core data model:

   - Projects: id, name, description, owner, industry/workspace_type (finance, healthcare, legal, manufacturing, insurance, logistics, general/other), status, created_at, archived flag.

   - Label Profiles (schemas): id, project_id, name, document_type (free text), version, list of selected fields, model configuration, created/updated timestamps. A profile is versioned — saving changes to a published profile creates a new version rather than silently overwriting production data.

   - Field Library: a reusable, shared catalog of common extraction fields grouped into logical buckets (e.g. Document Details, Parties & Entities, Financial Information, Dates & Timeline, Transaction Details, Miscellaneous). Each field has a key, display name, data type (text, identifier, date, currency, number, boolean, multi-value), and a short description. This library is shared across all projects and industries — projects pick from it and can also add custom one-off fields via manual entry.

   - Batches: id, project_id, name, label_profile_id (nullable — a batch can exist before a profile is mapped), status (uploaded/processing/prelabeled/in_review/complete), created_at.

   - Documents: id, batch_id, filename, file_type, page_count, status (uploaded/processing/prelabeled/in_review/approved/rejected), uploaded_at.

   - Extractions: per document per field — the AI-suggested value, confidence score, source/evidence snippet, and the human-reviewed final value if different. Track whether a field was accepted as-is, manually corrected, rejected, or locked.

   - Model Connectors: per-project configuration for which AI model/provider to use (provider, model name, API key, base URL, auth type, custom headers), plus a record of self-hosted/local model options (e.g. a local Ollama-style model) as an alternative to hosted providers.

 

3. App shell: a persistent left sidebar with these sections — Projects, Label Profile, Ingestion, Annotate & Label, Synthetic Data, Benchmarking & Evals, RLHF, Finetuning, Export, Admin Console, and Settings pinned near the bottom. A top bar per page shows a project switcher (only relevant on project-scoped pages), search where applicable, a light/dark theme toggle, a notifications bell, and an account menu.

 

4. Design system: pick one clean, professional accent color and a neutral gray/white base (light and dark mode both fully supported) — this is a placeholder brand, easy to reskin later, so keep color usage systematic (a small set of reused tokens, not one-off hex values scattered through components). Use a consistent small corner radius across cards, buttons, inputs, and dialogs (not fully rounded/pill-shaped except for true pills like status badges). Keep supporting text (descriptions, table cells, helper text, labels) consistently small and legible — do not let default component sizes balloon inconsistently across screens; every button, input, select, and label should have deliberate, explicit sizing rather than relying on whatever a shared component's default happens to be.

 

5. Accessibility: every dialog/modal must have a proper accessible description (no console warnings about missing dialog descriptions). Every interactive element needs a visible focus state that matches the app's accent color, not a mismatched default blue.

 

6. Reliability requirement: when a user navigates between screens that depend on "which project" or "which batch" is currently active, that selection must be reliably available on the destination screen — do not let a screen silently query with an empty or null id and render an empty state when data actually exists. If no project/batch is selected, show an explicit picker rather than a misleading "empty" result.

 

Do not build any of the actual feature screens yet beyond a basic empty Projects list — those come in later prompts.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9f653990-9158-4842-9bd2-568012b58661).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
