# ELS126 Patch Notes

## Fixed feedback survey link error

The app now handles this live Supabase error without crashing:

`new row for relation "feedback_survey_links" violates check constraint "feedback_survey_links_form_kind_check"`

Cause: the app added a newer `labor-coordinator` survey type, but the live Supabase table still had the older `form_kind` check constraint.

What changed:
- Feedback link creation no longer stops when the older constraint blocks only the Client Labor Coordinator survey.
- Project Manager, Area Manager, and Crew Lead survey links still create and display.
- A migration was added at `supabase/feedback_form_kind_labor_coordinator_fix.sql` to enable the Client Labor Coordinator survey type fully.

## Added city-pool multi-select crew messaging

On the Crew page:
- Select multiple crew in the visible city-pool/group crew list.
- Click `Message selected`.
- Enter one message for the selected crew.
- The message supports merge fields: `{first_name}`, `{name}`, `{pool}`, `{role}`.
- Click `Queue for Shortcut` to queue personalized texts into the same iPhone Shortcut pull used by intro texts.
- Contacts without valid phone numbers are skipped and reported.

## Validation

- `npx tsc --noEmit --pretty false` passed.
- `npm run build` was started locally but the sandbox timed out during the Next production build before producing a final result. No TypeScript errors were reported before packaging.
