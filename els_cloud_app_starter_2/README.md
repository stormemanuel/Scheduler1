# ELS Cloud App Starter

This is a hosted starter for the synced version of your scheduler.

## What it is
- Next.js frontend
- Supabase-ready data model
- Responsive Mac/iPhone friendly layout
- Seed pages for Crew, Events, Payroll, and Settings

## Quick start
1. Install Node.js LTS.
2. In this folder, run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Add your Supabase URL and anon key.
5. Run the SQL in `supabase/schema.sql` inside the Supabase SQL editor.
6. Run `npm run dev`.

## Deploy
- Push this project to GitHub.
- Import the repo into Vercel.
- Add the same environment variables in Vercel.
- Deploy.
- Attach `app.emanuel-labor-services.com` to the Vercel project.
- Add the DNS records Vercel tells you to add.
- In Supabase Auth settings, set:
  - Site URL = `https://app.emanuel-labor-services.com`
  - Redirect URLs = local + production URLs you actually use.

## Next build steps
- Replace mock data with Supabase queries.
- Add auth and route protection.
- Add realtime subscriptions for crew, shows, labor days, sub-calls, and payroll.
- Seed New Orleans, Nashville, and Atlanta crew into the cloud tables.
