create extension if not exists pgcrypto;

-- ELS70 Crew onboarding checklist + CSV import support
-- Safe to run more than once.

alter table public.crew
  add column if not exists onboarding_texted_called boolean not null default false;

alter table public.crew
  add column if not exists onboarding_response boolean not null default false;

alter table public.crew
  add column if not exists onboarding_paperwork_sent boolean not null default false;

alter table public.crew
  add column if not exists onboarding_successfully_onboarded boolean not null default false;

alter table public.crew
  add column if not exists onboarding_called_placed_tier boolean not null default false;

create index if not exists crew_onboarding_successfully_onboarded_idx
  on public.crew(onboarding_successfully_onboarded);

create index if not exists crew_onboarding_response_idx
  on public.crew(onboarding_response);

create table if not exists public.crew_groups (
  id uuid primary key default gen_random_uuid(),
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city_pool_id, name)
);

create index if not exists crew_groups_city_pool_id_idx
  on public.crew_groups(city_pool_id);

-- Add existing tier/group names to crew_groups so imports can land in Tier 1, Tier 2, etc.
insert into public.crew_groups (city_pool_id, name)
select distinct
  c.city_pool_id,
  coalesce(nullif(btrim(c.group_name), ''), 'Ungrouped') as name
from public.crew c
where c.city_pool_id is not null
on conflict (city_pool_id, name) do nothing;

notify pgrst, 'reload schema';

select
  'ELS70 crew onboarding + CSV import ready' as status,
  count(*) as total_crew,
  count(*) filter (where onboarding_successfully_onboarded = false) as not_yet_onboarded
from public.crew;
