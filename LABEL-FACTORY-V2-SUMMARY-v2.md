# Label Factory v2 — Project Summary

*Last updated: August 30, 2026*

A living reference for the LabelFactory v2 rebuild: what the app is, how it's put together, what's been built and decided, and what's still open. Everything under "Feature Work" and "Key Decisions" reflects work done directly in this collaboration; the architecture sections describe the app as a whole based on its current codebase.

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (React), file-based routing via TanStack Router |
| Data fetching / mutations | TanStack Query (`useQuery`, `useMutation`) |
| Server logic | TanStack Start server functions (`createServerFn`, `.middleware`, `.inputValidator`, `.handler`) |
| Database & Auth | Supabase (Postgres + Auth + Storage) — the user's own Supabase project |
| AI | Vercel AI SDK (`generateText`), two providers: **OpenAI** and **Gemini**, chosen per-profile or falling back to an active-provider default |
| UI components | shadcn/ui on Radix primitives (Switch, Badge, Select, Dialog, Table, Tabs, Textarea, ToggleGroup, Checkbox, Progress, Chart) |
| Styling | Tailwind CSS, with light/dark theme tokens (`primary-soft`, `primary-soft-foreground`, etc.) |
| Icons | lucide-react |
| Validation | Zod (on every server function input) |
| Charts | Recharts (Benchmarking dashboard) |
| PDF text extraction | unpdf |
| Toasts | sonner |
| Build tooling | Vite; both `bun.lock` and `package-lock.json` are present in the repo |
| Dev server | `localhost:8080` |
| Version control | Git, hosted at `github.com/Laki-mobius/label-factory` |

---

## 2. Folder Structure

```
label-factory-v2/
├── public/                        # logo.png, favicon.png, robots.txt, login-background.jpg (optional)
├── src/
│   ├── routes/                    # File-based pages (TanStack Router)
│   │   ├── __root.tsx
│   │   ├── auth.tsx                # Login / sign-up
│   │   ├── index.tsx / dashboard.tsx
│   │   ├── ingestion.tsx           # Document upload/ingestion
│   │   ├── label-profile.tsx       # Label Profile builder (fields, model, prompts)
│   │   ├── annotate.tsx            # Annotate & Label — human review screen
│   │   ├── synthetic-data.tsx      # Synthetic document generation
│   │   ├── benchmarking.tsx        # Benchmarking & Evals
│   │   ├── rlhf.tsx                # RLHF — SFT/DPO review + export
│   │   ├── export.tsx              # Export & Integrations
│   │   ├── finetuning.tsx
│   │   ├── settings.tsx
│   │   ├── admin.tsx               # Admin Console — Overview/Integrations/Projects/Uploads/Users tabs, admin-gated
│   │   ├── attention.tsx
│   │   └── api/
│   ├── lib/                        # Business logic & server functions
│   │   ├── ai-provider.server.ts / .functions.ts     # Model resolution (default vs. explicit choice)
│   │   ├── prelabel.server.ts / .run.server.ts / .functions.ts   # AI extraction
│   │   ├── field-suggest.server.ts / .functions.ts   # "Suggest fields with AI"
│   │   ├── field-describe.server.ts / .functions.ts  # "AI Describe" (per-field)
│   │   ├── field-match.ts                            # Match/near/wrong classification
│   │   ├── benchmark.ts / benchmark-compare.*/ benchmark-eval.*     # Benchmarking & Evals
│   │   ├── reward-ai.server.ts / .run.server.ts / .functions.ts    # Reward AI drafting
│   │   ├── rlhf.ts                                   # Training/preference pair fetchers, export builders
│   │   ├── synthetic.server.ts / .run.server.ts / .functions.ts
│   │   ├── redact.ts                                 # Masking utilities (see §5)
│   │   ├── admin-data.ts                             # Admin Console data (projects, users, uploads, integrations)
│   │   ├── dashboard-data.ts / export-data.ts
│   │   ├── connector.server.ts / .functions.ts / webhooks.*        # Integrations
│   │   ├── workspace.tsx / auth.tsx / theme.tsx / utils.ts
│   │   └── error-capture.ts / error-page.ts / lovable-error-reporting.ts
│   ├── components/
│   │   ├── ui/                     # shadcn primitives (switch, badge, table, dialog, …)
│   │   ├── app-shell/               # AppSidebar, SectionPage, nav-items (role-aware nav)
│   │   └── rlhf/                    # DocQueue, RewardAiPanel
│   └── integrations/
│       ├── supabase/                # client, auth-middleware (requireSupabaseAuth)
│       └── lovable/                 # OAuth helper
└── supabase/
    └── migrations/                  # SQL migrations (roles/RLS, field_library seed, benchmark comparisons, etc.)
```

---

## 3. Completed Features

### Label Profile builder
- **Per-profile AI model selection** — a real, catalog-backed dropdown (OpenAI/Gemini models) stored on the profile as `model_config: {provider, model}`. Resolution degrades gracefully server-side: if the stored provider's API key is missing or the config is malformed, it silently falls back to the active default provider rather than failing the request.
- **"Suggest fields with AI"** — renamed from "AI Generate" for clarity (button label + empty-state copy).
- **Universal Field Library** — a shared, curated catalog of common fields (40-row seed) grouped into six buckets: Document details, Parties & Entities, Financial Information, Dates & Timeline, Transaction Details, Miscellaneous. Each library field carries curated extraction guidance (label variants to look for, confusable fields to avoid, validation regex) that feeds straight into the real extraction prompt. Buckets are **collapsed by default**; click the arrow to expand one.
- **Selected Fields pane** — shows each selected field as a collapsed card (name + origin badge — Common/AI/Library/Custom/Sensitive). Clicking a card expands it in place to reveal:
  - editable key / display name / data type
  - a confidence indicator (High/Medium/Weak dot + label)
  - **Multi** toggle — marks a field as occurring more than once (advisory: still one value per field key, but the extraction prompt is told to summarize all occurrences)
  - **Sensitive** toggle — marks a field for redaction everywhere it's displayed or exported (see §5)
  - **Extraction Prompt** — a free-text box that, when filled in, replaces the field's plain description in the actual AI extraction prompt
  - **AI Describe** — regenerates just the field's description on demand
  - Remove button
  - The expanded card is highlighted in the app's theme accent color so it's clear which field is open.

### Annotate & Label (document review)
- Fields marked Sensitive show a "Sensitive" pill and render as masked text (partial mask, e.g. `••••1234`) with a per-viewer Eye/EyeOff reveal toggle. The reveal state is never persisted — it's purely local to that viewer's session.

### RLHF (SFT & DPO review + export)
- **Interactive review UI** — both the correction-review tab (SFT signal) and the Model A/B preference tab (DPO signal) now mask sensitive fields the same way as Annotate, including locking the editable "Model B" candidate box to masked read-only text until revealed.
- **Export path** (`fetchTrainingPairs`, `fetchPreferencePairs`) — sensitive fields are fully and irreversibly replaced with `[REDACTED]` before they can be downloaded as training data (JSONL/CSV/DPO records). There is no reveal option here by design.

### Benchmarking & Evals
- Model-vs-model and schema-version-vs-version comparison runs, with a mismatch drilldown per field.
- LLM-graded quality evaluation (faithfulness, completeness, consistency, hallucination risk, field attention, document risk) via a dedicated AI call.
- The mismatch drilldown dialog and the evaluation's field-attention examples table both mask sensitive fields on screen with a reveal toggle.
- **The actual third-party exposure point** — before any field value is sent to OpenAI/Gemini for eval commentary, sensitive fields are masked irreversibly. This was the one genuine data-exfiltration path found in the app (screens only ever showed data to the reviewer; this one sent it to a vendor).

### Redaction & Data Protection (new capability, beyond the original app)
A single utility module (`lib/redact.ts`) with two masking strengths for two different trust boundaries:
- `maskForDisplay` — partial, reversible-by-the-viewer (e.g. `••••1234`), paired with a non-persisted reveal toggle. Used anywhere a human reviewer needs to see the real value to do their job.
- `maskForExport` — full, irreversible (`[REDACTED]`). Used anywhere a value would leave the reviewer's own screen: training-data exports, or any value sent to a third-party LLM.
- `sensitiveKeySet` — reads a label profile's `fields` JSONB and returns the set of field keys marked `sensitive: true`, for cheap lookups against tables that only store a bare `field_key`.

No database migration was required for any of this — every new flag (`multi`, `sensitive`, `extraction_prompt`, plus earlier `label_hints`/`confusion_hints`/`validation_regex`) lives inside the existing `label_profiles.fields` JSONB column.

### Export & Integrations
- Fixed a layout bug where the "Sample record preview" JSON panel had no width limit, so long unwrapped lines forced the entire page to scroll horizontally instead of scrolling inside their own box. Both panels now correctly contain their own overflow.

### Login page
- The brand panel (left side) can show a custom photo instead of the default gradient: drop a file at `public/login-background.jpg` and it's used automatically, with a dark scrim gradient applied over it so the logo/heading/footer text stays legible in white. If the file is missing, it silently falls back to the original green gradient and dark text — no code change needed to switch between the two.

### Admin Console (confirmed already built, not missing)
Investigated a report that "Admin Console" was missing from the sidebar. It turned out the feature was already fully built — a complete `/admin` page with Overview, Integrations, Projects, Uploads, and Users tabs, gated both in the sidebar (`adminOnly` nav filtering) and at the route level (an "Administrator access required" screen for non-admins). It wasn't showing because the logged-in account had never been granted the `admin` role in the `user_roles` table — every new signup gets `member` by default, and the row-level security policy deliberately prevents granting admin through the app itself (it even blocks an admin from self-granting) to stop privilege escalation. Resolved by inserting the first admin role directly via the Supabase SQL Editor, which bypasses RLS as the database owner. No code changes were needed.

### Deployment & version control
- The `label-factory-v2` folder had never been initialized as a git repository. Set it up and connected it to the existing GitHub repo (`github.com/Laki-mobius/label-factory`), which already had prior history from the project's original scaffolding.
- Rather than overwrite that history, the local `main` branch was pointed at the existing `origin/main` commit first, and this session's work was committed as a new commit on top of it — preserving full history rather than force-pushing over it.
- Pushed successfully; `main` on GitHub now includes every feature listed above.

---

## 4. Key Decisions

- **Per-profile model choice was reinstated, not simplified away.** An earlier "just show the active provider" design was reversed because different models genuinely produce different extraction results — the picker had to be real, not cosmetic.
- **Two-tier masking, not one.** Reversible partial masking is used wherever the trust boundary is "this reviewer's own screen"; irreversible full masking is used wherever the trust boundary is "leaving the app" (an export file, a third-party API call). Conflating the two would either over-redact internal review screens or under-protect actual exports.
- **Multi is advisory-only.** Rather than restructure extraction storage to support genuinely repeated field values, a `multi` field just tells the AI to summarize all occurrences into one delimited value. Full one-to-many extraction storage was judged out of scope for the ask.
- **A hand-written Extraction Prompt always wins** over the field's plain description when building the real AI extraction instructions — the human's specific wording is treated as authoritative.
- **Graceful model-resolution fallback.** If a label profile's saved model choice becomes invalid (key removed, provider misconfigured), extraction and other AI calls fall back to the active default provider rather than throwing and blocking the workflow.
- **Reused the existing benchmark model catalog** for the Label Profile picker instead of building a second one, to keep the list of "known models" in one place.
- **No new database migrations for any of this feature arc** — every addition fits inside existing JSONB columns, keeping schema risk at zero for this round of work.
- **Admin role escalation is deliberately impossible from within the app** — even an existing admin cannot grant themselves the role again or bypass the SQL-level bootstrap step. This is correct, intentional security design, not a bug, even though it meant the very first admin had to be seeded by hand.
- **Git history was preserved, not overwritten**, when connecting the local folder to the existing GitHub repo — the new work was committed as a descendant of the existing history rather than force-pushed over it.
- **Delivery discipline** — every file was syntax-checked (esbuild, syntax-only — this environment can't run a full `tsc`/production build) before being sent, and files not already known-current were re-staged fresh from the device rather than trusting a local cache, to avoid ever shipping an edit on top of stale content.

---

## 5. What's Next / Pending

- **Rotate exposed credentials.** While setting up git, we discovered `.env` (with real Supabase/AI provider keys) has been committed in this repo's history since its original scaffolding on Aug 27 — in commits that predate this session's work and are already on GitHub. Going forward, `.env` is no longer tracked, but the historical commits still contain it. **The user has deferred this for now** — when ready, the fix is to rotate the Supabase keys (especially the service role key, if present) and any OpenAI/Gemini API keys, since that neutralizes the exposure regardless of what's sitting in git history. Optionally, `.env` can also be scrubbed from history with `git filter-repo` afterward, though that requires a force-push and isn't a substitute for rotation.
- **Manual verification.** Everything above has passed a syntax check only, not a full type-check or a running-app test. Restart the dev server and click through Label Profile, Annotate, RLHF, Benchmarking, Export, Login, and Admin Console to confirm behavior matches expectations.
- **Add the login background image.** The code is in place; `public/login-background.jpg` still needs to actually be added to the `public` folder for the custom photo to appear.
- **Historical export/eval data isn't retroactively scrubbed.** The redaction fixes protect every *new* export and every *new* evaluation run going forward. Any RLHF export file already downloaded, or any benchmark evaluation already run, **before** these fixes were made may still contain unmasked sensitive values wherever it was saved or already sent to a vendor. That can't be undone by this code change — only prevented going forward.
- **Unaudited areas.** Ingestion, Synthetic Data, Dashboard, Settings, and Finetuning were not reviewed as part of this round of work. If any of them display or export field values from a profile with sensitive fields, they'd need the same `maskForDisplay`/`maskForExport` treatment applied — worth a pass if that turns up.
- **Provider coverage.** Model selection currently supports OpenAI and Gemini only; adding another provider is future work if needed.

---

*Prepared from the working session covering the Label Profile model picker, field-detail controls (Multi/Sensitive/Extraction Prompt/AI Describe/confidence), the full redaction system, Universal Field Library UX, Export page layout fix, the login page background feature, the Admin Console access investigation, and pushing the codebase to GitHub.*
