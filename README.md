[README.md](https://github.com/user-attachments/files/27029025/README.md)
# ELS Cloud App Starter - Auth + Users Scaffold

This version adds:
- email/password sign-in
- protected routes with middleware
- profiles table + app roles
- Users page for admins
- invite-user form using Supabase admin API

## Required environment variables

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

## Supabase setup

1. Run `supabase/schema.sql` in Supabase SQL Editor.
2. In Auth URL configuration set:
   - Site URL: `https://app.emanuel-labor-services.com`
   - Redirect URLs: `https://app.emanuel-labor-services.com/**`
3. Create your first user in Supabase Auth, then insert/update a matching row in `profiles` with role `owner`.

## What still needs wiring after this scaffold
- replace mock crew/events/payroll reads with real Supabase queries
- load New Orleans / Nashville / Atlanta data into database tables
- add full row-level security policies for production
