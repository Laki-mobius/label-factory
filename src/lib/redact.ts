/**
 * Masking for sensitive field values. A value can be sensitive for either of
 * two independent reasons — combine both wherever a masking decision is made
 * (see isSensitiveValue below):
 *
 *  - A human marked the field key `sensitive: true` on the label profile
 *    ahead of time (label-profile.tsx's Sensitive toggle) — every document
 *    using that profile treats that field as sensitive, always.
 *  - The automatic PII scan (src/lib/pii-scan.server.ts, run during
 *    prelabeling) found likely personal data in THIS document's actual
 *    value for that field (extractions.pii_detected) — catches the case
 *    where an otherwise-ordinary field (e.g. free-text "Notes") happens to
 *    contain someone's name or phone number on one document but not
 *    another, which a static per-profile flag can never catch.
 *
 * There are also two distinct masking STRENGTHS for two distinct trust
 * boundaries — never use one where the other belongs:
 *
 *  - `maskForDisplay` — partial, REVERSIBLE-BY-THE-VIEWER masking for a
 *    human reviewer who legitimately needs to see the real value to do
 *    their job (the annotate/review screen). Pair it with a per-viewer
 *    "reveal" toggle that is never persisted or sent anywhere.
 *  - `maskForExport` — full, IRREVERSIBLE redaction for anything that
 *    leaves the reviewer's own screen: training-data exports (RLHF
 *    fine-tuning/DPO data) and any value sent to a third-party LLM (Reward
 *    AI drafts, benchmark evaluation commentary). There is no "reveal" for
 *    this one — the real value is simply never included.
 */

export function maskForDisplay(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return "•".repeat(trimmed.length - 4) + trimmed.slice(-4);
}

export function maskForExport(value: string | null | undefined): string {
  return value ? "[REDACTED]" : (value ?? "");
}

/** Builds the set of field_key values marked `sensitive: true` on a label
 *  profile's stored `fields` JSONB, for O(1) lookups when masking rows from
 *  the `extractions` table (which only carries a field_key, not the flag). */
export function sensitiveKeySet(fields: unknown): Set<string> {
  const list = Array.isArray(fields) ? fields : [];
  const keys = new Set<string>();
  for (const item of list) {
    const row = item as { key?: unknown; sensitive?: unknown } | null;
    if (row && typeof row.key === "string" && row.sensitive === true) keys.add(row.key);
  }
  return keys;
}

/** Combines the profile-level "always sensitive" flag with the per-document
 *  automatic PII-scan result for one field — true if either says sensitive.
 *  Use this everywhere a masking decision is made instead of checking
 *  sensitiveKeySet alone, so a field the profile didn't pre-flag still gets
 *  masked when this document's actual value turned out to contain PII. */
export function isSensitiveValue(profileFlagged: boolean, piiDetected: boolean | null | undefined): boolean {
  return profileFlagged || Boolean(piiDetected);
}
