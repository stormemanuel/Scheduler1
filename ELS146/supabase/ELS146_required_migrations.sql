-- ELS146 required migrations
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


-- Crew groups for coordinator-safe organization.
create table if not exists public.crew_groups (
  id uuid primary key default gen_random_uuid(),
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(city_pool_id, name)
);

create index if not exists crew_groups_city_pool_id_idx on public.crew_groups(city_pool_id);

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

-- Client directory/contact compatibility for adding contacts safely.
create table if not exists public.business_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_company_name text,
  billing_address text,
  billing_city text,
  billing_state text,
  billing_zip text,
  main_phone text,
  main_email text,
  website text,
  default_rate_city text not null default 'Default',
  default_market_notes text,
  notes text,
  ap_contact_name text,
  ap_email text,
  ap_phone text,
  payment_terms text,
  po_required boolean,
  w9_coi_notes text,
  default_invoice_email text,
  billing_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table if exists public.business_clients add column if not exists legal_company_name text;
alter table if exists public.business_clients add column if not exists billing_address text;
alter table if exists public.business_clients add column if not exists billing_city text;
alter table if exists public.business_clients add column if not exists billing_state text;
alter table if exists public.business_clients add column if not exists billing_zip text;
alter table if exists public.business_clients add column if not exists main_phone text;
alter table if exists public.business_clients add column if not exists main_email text;
alter table if exists public.business_clients add column if not exists website text;
alter table if exists public.business_clients add column if not exists default_rate_city text not null default 'Default';
alter table if exists public.business_clients add column if not exists default_market_notes text;
alter table if exists public.business_clients add column if not exists notes text;
alter table if exists public.business_clients add column if not exists ap_contact_name text;
alter table if exists public.business_clients add column if not exists ap_email text;
alter table if exists public.business_clients add column if not exists ap_phone text;
alter table if exists public.business_clients add column if not exists payment_terms text;
alter table if exists public.business_clients add column if not exists po_required boolean;
alter table if exists public.business_clients add column if not exists w9_coi_notes text;
alter table if exists public.business_clients add column if not exists default_invoice_email text;
alter table if exists public.business_clients add column if not exists billing_notes text;
alter table if exists public.business_clients add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table if exists public.business_clients add column if not exists created_at timestamptz not null default now();
alter table if exists public.business_clients add column if not exists updated_at timestamptz;
create unique index if not exists business_clients_name_key on public.business_clients(name);
create index if not exists business_clients_created_by_idx on public.business_clients(created_by);

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.business_clients(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  cell_phone text,
  notes text,
  contact_type text not null default 'labor-coordinator',
  created_by uuid references auth.users(id) on delete set null,
  is_primary boolean not null default false,
  is_onsite_contact boolean not null default false,
  is_billing_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table if exists public.client_contacts add column if not exists title text;
alter table if exists public.client_contacts add column if not exists email text;
alter table if exists public.client_contacts add column if not exists phone text;
alter table if exists public.client_contacts add column if not exists cell_phone text;
alter table if exists public.client_contacts add column if not exists notes text;
alter table if exists public.client_contacts add column if not exists contact_type text not null default 'labor-coordinator';
alter table if exists public.client_contacts add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table if exists public.client_contacts add column if not exists is_primary boolean not null default false;
alter table if exists public.client_contacts add column if not exists is_onsite_contact boolean not null default false;
alter table if exists public.client_contacts add column if not exists is_billing_contact boolean not null default false;
alter table if exists public.client_contacts add column if not exists created_at timestamptz not null default now();
alter table if exists public.client_contacts add column if not exists updated_at timestamptz;

alter table if exists public.client_contacts
  drop constraint if exists client_contacts_contact_type_check;

alter table if exists public.client_contacts
  add constraint client_contacts_contact_type_check
  check (contact_type in ('labor-coordinator', 'project-manager', 'booth-manager', 'client-tech'));

create index if not exists client_contacts_client_id_idx on public.client_contacts(client_id);
create index if not exists client_contacts_created_by_idx on public.client_contacts(created_by);

notify pgrst, 'reload schema';
