[README.md](https://github.com/user-attachments/files/27220042/README.md)
# ELS Cloud App – Events Crew Import Fix

This is a root-ready Next.js + Supabase build for the ELS operations app. Upload the contents of this folder to the top level of the GitHub repo so `package.json` stays at the repo root.

## What changed in this build

- Fixed event import crew assignment matching.
- The import preview now resolves imported crew rows against existing `crew` records using:
  - phone match first
  - exact normalized name match
  - first/last match when middle names differ
  - reversed/comma name variants
  - initial-compatible matches when the match is not ambiguous
  - fuzzy fallback with candidate names shown in preview
- Confirmed matched crew are inserted into `assignments` with real `crew_id` values.
- Duplicate assignment rows in the same sub-call are deduped before insert/upsert.
- Existing Supabase crew contacts, city pools, master rates, and show data are preserved.

## Deploy

1. Replace the repo contents with this bundle.
2. Commit to GitHub.
3. In Vercel, keep Root Directory blank because `package.json` is at the repo root.
4. Let Vercel redeploy.

## Supabase notes

- No destructive schema changes are included in this fix.
- Do not rerun seed files unless you intentionally want to reseed data.
- The importer expects the existing `crew`, `shows`, `labor_days`, `sub_calls`, and `assignments` tables.

## After deploy

Test with the same crew-list import that previously created the event/sub-calls but did not assign crew. The preview should show a non-zero matched crew count when imported names or phones correspond to existing crew records.
