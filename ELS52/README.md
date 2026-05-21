# ELS50 Crew Order Inside Sub-Calls

This update adds saved manual ordering for crew assigned to the same sub-call. Use Move up / Move down in Events to set the order, and the exported crew list follows that order. Run `supabase/assignment_order_migration.sql` in Supabase SQL Editor after deploying.

---

# ELS46 Feedback Survey UI Update

Feedback forms are now client-friendly quick surveys with fillable HTML export, polished preview cards, and cleaner PDF/DOCX/TXT wording. No new Supabase SQL is required for this update.

---

# ELS40 Client Profile Update

This version includes the full optional Client company profile update. Only Client name is required; all address, billing, AP, PO, invoice, website, notes, and contact details are optional. Run `supabase/clients_tech_ratings_migration.sql` in Supabase SQL Editor after deploying.

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


ELS43 update: Client Top Techs now use median ratings, and ratings also attach to the selected Project Manager / Client Contact on each event. Run `supabase/clients_tech_ratings_migration.sql`, then `supabase/fix_existing_event_ratings_client_links.sql` if you already rated techs before this update.


## ELS52 update — public feedback links

Feedback survey links are now public-by-token. A client or booth manager can open `/feedback/[token]` without logging into the ELS app. The public route only shows the fillable survey and the submit endpoint. After submission, the page displays a thank-you confirmation and does not expose app navigation. Normal app pages still require login.
