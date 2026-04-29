[README.md](https://github.com/user-attachments/files/27217467/README.md)
# ELS Cloud App – Crew + Rates Workspace

This build keeps the existing Supabase contacts and adds a cleaner Master Rates workspace focused on what you pay crew.

## What changed in this build

- Settings now uses a full editable grid for **Default** crew pay rates.
- City-specific override groups use the **same grid logic** in one place.
- Default rates and city overrides are separated.
- Blank city override fields fall back to the Default rate card.
- Existing contacts and crew data in Supabase are preserved.

## Deploy

1. Replace the repo contents with this bundle.
2. Commit to GitHub.
3. Let Vercel redeploy.

## Supabase notes

- Existing `master_rates` rows are reused.
- `seed_master_rates.sql` is optional and should be edited if you want to preload crew pay values.
- This build does not delete or reseed your crew contacts.

## Next step after this build

- Make Events pull crew pay estimates from the selected rate city so each show shows total estimated payout.


Updated build: blank-instead-of-zero rate inputs and a Supabase-backed Events workspace with shows, labor days, sub-calls, and estimated payout by rate city.
