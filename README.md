# ELS Cloud App – Auth + Users + Crew

This build keeps the hosted auth/users starter and makes **Crew** the first real Supabase-backed workspace.

## What is live in this version

- Supabase Auth login
- protected routes
- Users page with invite flow
- Crew page backed by Supabase tables
- add crew member
- edit crew member inline
- delete crew member
- search by name, position, email, phone, tier, notes, conflicts, city, group, OB
- city pool filter
- group filter
- bulk move selected crew to another city pool / group
- create city pool
- create subgroup name in the UI and assign crew into it
- multiple positions and rates per crew member
- unavailable dates per crew member

## Before you use Crew

Run these in Supabase:

1. `supabase/schema.sql`
2. `supabase/seed_contacts.sql` (optional but recommended)

`seed_contacts.sql` loads the cleaned first-pass contacts for New Orleans, Nashville, and Atlanta.

## Environment variables

Set these in Vercel:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Important note about groups

Groups/subgroups are stored as the `group_name` field on each crew member.
That means a new group becomes persistent as soon as at least one crew member is saved into it.

## What is still placeholder data

- Events
- Payroll

Those still use starter data until the next phase wires them to Supabase.

