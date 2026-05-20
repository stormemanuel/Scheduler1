ELS41 MINIMAL FULL PROJECT - Under 100 Files

Use this if you need a clean deployable ELS41 project but want to keep the upload below 100 total files.

What is included:
- Full app source needed for the current ELS41 app.
- Config files needed for Next/Vercel.
- Logo/public asset.
- Current SQL schema and current clients/tech-ratings migration.
- Seed files for master rates and contacts.

What was removed:
- Old one-off migration files from prior updates.
- Old implementation notes.
- TypeScript build cache file.

Supabase:
For an existing database, run:
ELS41/supabase/clients_tech_ratings_migration.sql

For a fresh database, use:
ELS41/supabase/schema.sql
then the seed files if needed.

Client/company profile fields are optional. Only client name is required.
Tech ratings are saved per show, per tech/contact, and per selected client.
