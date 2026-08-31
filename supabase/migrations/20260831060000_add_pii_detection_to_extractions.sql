-- Automatic PII detection support.
--
-- Until now, a field was only ever masked/redacted when a human manually
-- ticked "Sensitive" on that field in the Label Profile builder (see
-- label_profiles.fields JSONB, src/lib/redact.ts's sensitiveKeySet). That's
-- a per-profile, per-field-key decision — it can't catch a field that
-- happens to contain personal data on THIS document even though the field
-- itself isn't inherently sensitive (e.g. a free-text "Notes" field that
-- sometimes has a person's name or phone number in it).
--
-- This adds an automatic, per-document, per-value signal computed by an AI
-- scan during prelabeling (see src/lib/pii-scan.server.ts, wired into
-- src/lib/prelabel.run.server.ts). It lives on the extractions row — not
-- the profile — because the same field key can be clean on one document and
-- contain PII on another.
alter table public.extractions
  add column if not exists pii_detected boolean not null default false,
  add column if not exists pii_types text[] not null default '{}';

comment on column public.extractions.pii_detected is
  'True when the automatic PII scan (run during prelabeling) found likely personal data in suggested_value, independent of whether the label profile marks this field key "sensitive". Combined with the profile-level flag wherever masking decisions are made.';
comment on column public.extractions.pii_types is
  'Entity types the PII scan detected for this value, e.g. person_name, email, phone, national_id, address, financial_account, date_of_birth, health_info, other_sensitive. Empty when pii_detected is false.';
