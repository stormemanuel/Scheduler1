-- ELS60 User Roles + Access Editing Migration
-- Safe to run more than once.
-- Adds Salesman role and the user access settings table that the Users page edits.

create extension if not exists pgcrypto;

-- Make sure the role enum supports the Salesman role used by the app.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('owner', 'admin', 'coordinator', 'salesman', 'viewer');
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_type where typname = 'app_role') then
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'app_role'
        and e.enumlabel = 'salesman'
    ) then
      alter type app_role add value 'salesman';
    end if;
  end if;
end $$;

-- Existing production schemas usually already have profiles.
-- This keeps the app's existing profiles table as the source of truth.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Page and restriction settings edited from the Users page.
create table if not exists public.user_access_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  allowed_pages text[] not null default '{}',
  restrict_events_to_owner boolean not null default true,
  restrict_crew_to_owner boolean not null default true,
  allowed_city_pool_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ownership fields used to keep coordinators inside their own work unless granted access.
alter table public.shows
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.labor_days
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.sub_calls
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.crew
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists user_access_settings_allowed_pages_idx
  on public.user_access_settings using gin (allowed_pages);

create index if not exists user_access_settings_allowed_city_pool_ids_idx
  on public.user_access_settings using gin (allowed_city_pool_ids);

create index if not exists shows_created_by_idx
  on public.shows(created_by);

create index if not exists crew_created_by_idx
  on public.crew(created_by);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_user_access_settings_updated_at on public.user_access_settings;
create trigger set_user_access_settings_updated_at
before update on public.user_access_settings
for each row
execute function public.set_updated_at();

-- Seed access settings for any existing users.
insert into public.user_access_settings (
  user_id,
  allowed_pages,
  restrict_events_to_owner,
  restrict_crew_to_owner,
  allowed_city_pool_ids
)
select
  p.id,
  case
    when p.role::text in ('owner', 'admin') then array['overview','crew','events','clients','pipelines','payroll','users','settings']::text[]
    when p.role::text in ('salesman', 'sales') then array['pipelines']::text[]
    when p.role::text = 'coordinator' then array['overview','events','crew']::text[]
    else array['overview']::text[]
  end as allowed_pages,
  case when p.role::text in ('owner', 'admin') then false else true end as restrict_events_to_owner,
  case when p.role::text in ('owner', 'admin') then false else true end as restrict_crew_to_owner,
  '{}'::uuid[] as allowed_city_pool_ids
from public.profiles p
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
alter table public.user_access_settings enable row level security;

drop policy if exists "profiles_authenticated_all" on public.profiles;
create policy "profiles_authenticated_all"
  on public.profiles
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "user_access_settings_authenticated_all" on public.user_access_settings;
create policy "user_access_settings_authenticated_all"
  on public.user_access_settings
  for all
  to authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';

select
  'ELS60 user access ready' as status,
  count(*) as profiles_count
from public.profiles;
