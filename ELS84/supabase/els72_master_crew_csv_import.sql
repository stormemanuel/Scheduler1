-- ELS72 Master Crew CSV Import Support
-- Safe to run more than once.
-- Ensures multi-pool crew imports can create/use city pools, groups, and crew-pool memberships.

create extension if not exists pgcrypto;

alter table public.crew
  add column if not exists lead_from text;

alter table public.crew
  add column if not exists address text;

create index if not exists crew_lead_from_idx
  on public.crew using gin (to_tsvector('simple', coalesce(lead_from, '')));

create table if not exists public.crew_city_pools (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew(id) on delete cascade,
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (crew_id, city_pool_id)
);

create table if not exists public.crew_groups (
  id uuid primary key default gen_random_uuid(),
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city_pool_id, name)
);

create unique index if not exists city_pools_name_unique_idx
  on public.city_pools (lower(name));

create index if not exists crew_city_pools_crew_id_idx
  on public.crew_city_pools(crew_id);

create index if not exists crew_city_pools_city_pool_id_idx
  on public.crew_city_pools(city_pool_id);

create index if not exists crew_email_lower_idx
  on public.crew(lower(email));

create index if not exists crew_name_lower_idx
  on public.crew(lower(name));

create index if not exists crew_groups_city_pool_id_idx
  on public.crew_groups(city_pool_id);

notify pgrst, 'reload schema';

select 'ELS72 master crew CSV import support ready' as status;
