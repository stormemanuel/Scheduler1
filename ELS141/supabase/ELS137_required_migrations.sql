-- ELS137 required migrations
-- Coordinator pool views, city-pool access controls, and coordinator-safe crew retention.

-- Keep coordinator/admin assignment support on shows.
alter table if exists public.shows
  add column if not exists assigned_coordinator_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.shows
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists shows_assigned_coordinator_user_id_idx on public.shows(assigned_coordinator_user_id);
create index if not exists shows_created_by_idx on public.shows(created_by);

-- Crew ownership and coordinator soft-delete tracking.
alter table if exists public.crew
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table if exists public.crew
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.crew
  add column if not exists updated_at timestamptz;

alter table if exists public.crew
  add column if not exists coordinator_hidden_at timestamptz;

alter table if exists public.crew
  add column if not exists coordinator_hidden_by uuid references auth.users(id) on delete set null;

create index if not exists crew_created_by_idx on public.crew(created_by);
create index if not exists crew_coordinator_hidden_by_idx on public.crew(coordinator_hidden_by);

-- Multiple city/pool membership for one crew record.
create table if not exists public.crew_city_pools (
  crew_id uuid not null references public.crew(id) on delete cascade,
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (crew_id, city_pool_id)
);

create index if not exists crew_city_pools_crew_id_idx on public.crew_city_pools(crew_id);
create index if not exists crew_city_pools_city_pool_id_idx on public.crew_city_pools(city_pool_id);

-- Coordinator account pool visibility.
create table if not exists public.user_access_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  allowed_pages text[],
  restrict_events_to_owner boolean not null default true,
  restrict_crew_to_owner boolean not null default true,
  allowed_city_pool_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.user_access_settings
  add column if not exists allowed_city_pool_ids text[] not null default '{}';

alter table if exists public.user_access_settings
  add column if not exists restrict_crew_to_owner boolean not null default true;

alter table if exists public.user_access_settings
  add column if not exists restrict_events_to_owner boolean not null default true;

alter table if exists public.user_access_settings
  add column if not exists updated_at timestamptz not null default now();

-- Sub-call purchase order support from ELS130.
alter table if exists public.sub_calls
  add column if not exists po_number text;

create index if not exists sub_calls_po_number_idx on public.sub_calls(po_number);

-- Event access compatibility from ELS133.
alter table if exists public.event_user_access
  drop constraint if exists event_user_access_user_profile_id_fkey;

alter table if exists public.event_user_access
  alter column user_profile_id drop not null;

alter table if exists public.event_user_access
  add column if not exists user_id uuid;

alter table if exists public.event_user_access
  add column if not exists user_profile_id uuid;

alter table if exists public.event_user_access
  add column if not exists access_role text not null default 'coordinator';

alter table if exists public.event_user_access
  add column if not exists granted_by uuid;

alter table if exists public.event_user_access
  add column if not exists created_at timestamptz not null default now();

update public.event_user_access
set user_id = user_profile_id
where user_id is null and user_profile_id is not null;

create index if not exists event_user_access_show_id_idx on public.event_user_access(show_id);
create index if not exists event_user_access_user_id_idx on public.event_user_access(user_id);
create index if not exists event_user_access_user_profile_id_idx on public.event_user_access(user_profile_id);

notify pgrst, 'reload schema';
