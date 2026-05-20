create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'app_role'
  ) then
    create type app_role as enum ('owner', 'admin', 'coordinator', 'viewer');
  end if;
end $$;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  role app_role not null default 'viewer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists city_pools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);


create table if not exists crew_groups (
  id uuid primary key default gen_random_uuid(),
  city_pool_id uuid not null references city_pools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (city_pool_id, name)
);

create table if not exists crew (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city_pool_id uuid references city_pools(id) on delete set null,
  group_name text not null default 'Ungrouped',
  tier text,
  phone text,
  email text,
  other_city text,
  ob boolean not null default false,
  notes text,
  description text,
  conflict_companies text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table if not exists crew_city_pools (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crew(id) on delete cascade,
  city_pool_id uuid not null references city_pools(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (crew_id, city_pool_id)
);

create table if not exists crew_positions (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crew(id) on delete cascade,
  role_name text not null,
  rate numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists crew_unavailable_dates (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crew(id) on delete cascade,
  unavailable_date date not null,
  unique (crew_id, unavailable_date)
);

create table if not exists master_rates (
  id uuid primary key default gen_random_uuid(),
  city_name text not null,
  role_name text not null,
  full_day numeric(10,2) not null,
  half_day numeric(10,2),
  overtime_multiplier numeric(5,2) not null default 1.5,
  doubletime_multiplier numeric(5,2) not null default 2.0,
  unique (city_name, role_name)
);

create table if not exists shows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text,
  venue text,
  rate_city text,
  show_start date not null,
  show_end date not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists labor_days (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  labor_date date not null,
  label text,
  notes text
);

create table if not exists sub_calls (
  id uuid primary key default gen_random_uuid(),
  labor_day_id uuid not null references labor_days(id) on delete cascade,
  area text not null,
  role_name text not null,
  start_time time not null,
  end_time time,
  crew_needed integer not null default 1,
  notes text
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  sub_call_id uuid not null references sub_calls(id) on delete cascade,
  crew_id uuid not null references crew(id) on delete cascade,
  status text not null check (status in ('invited', 'confirmed', 'declined')),
  created_at timestamptz not null default now(),
  unique (sub_call_id, crew_id)
);

create table if not exists show_payroll (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  crew_id uuid not null references crew(id) on delete cascade,
  role_name text,
  pay_type text not null default 'Regular' check (pay_type in ('Regular', 'OT', 'DT')),
  paid boolean not null default false,
  payout_override numeric(10,2),
  notes text,
  unique (show_id, crew_id, role_name)
);

create table if not exists assignment_notes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  crew_member_id uuid not null references crew(id) on delete cascade,
  assignment_id uuid,
  note_code text not null,
  note_label text not null,
  custom_note text,
  visibility text not null default 'admin_only',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table city_pools enable row level security;
alter table crew_city_pools enable row level security;
alter table crew_groups enable row level security;
alter table crew enable row level security;
alter table crew_positions enable row level security;
alter table crew_unavailable_dates enable row level security;
alter table master_rates enable row level security;
alter table shows enable row level security;
alter table labor_days enable row level security;
alter table sub_calls enable row level security;
alter table assignments enable row level security;
alter table show_payroll enable row level security;
alter table assignment_notes enable row level security;

drop policy if exists "profiles_authenticated_all" on profiles;
create policy "profiles_authenticated_all"
  on profiles
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "city_pools_authenticated_all" on city_pools;
create policy "city_pools_authenticated_all"
  on city_pools
  for all
  to authenticated
  using (true)
  with check (true);


drop policy if exists "crew_city_pools_authenticated_all" on crew_city_pools;
create policy "crew_city_pools_authenticated_all"
  on crew_city_pools
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "crew_groups_authenticated_all" on crew_groups;
create policy "crew_groups_authenticated_all"
  on crew_groups
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "crew_authenticated_all" on crew;
create policy "crew_authenticated_all"
  on crew
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "crew_positions_authenticated_all" on crew_positions;
create policy "crew_positions_authenticated_all"
  on crew_positions
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "crew_unavailable_dates_authenticated_all" on crew_unavailable_dates;
create policy "crew_unavailable_dates_authenticated_all"
  on crew_unavailable_dates
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "master_rates_authenticated_all" on master_rates;
create policy "master_rates_authenticated_all"
  on master_rates
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "shows_authenticated_all" on shows;
create policy "shows_authenticated_all"
  on shows
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "labor_days_authenticated_all" on labor_days;
create policy "labor_days_authenticated_all"
  on labor_days
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "sub_calls_authenticated_all" on sub_calls;
create policy "sub_calls_authenticated_all"
  on sub_calls
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "assignments_authenticated_all" on assignments;
create policy "assignments_authenticated_all"
  on assignments
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "show_payroll_authenticated_all" on show_payroll;
create policy "show_payroll_authenticated_all"
  on show_payroll
  for all
  to authenticated
  using (true)
  with check (true);


drop policy if exists "assignment_notes_authenticated_all" on assignment_notes;
create policy "assignment_notes_authenticated_all"
  on assignment_notes
  for all
  to authenticated
  using (true)
  with check (true);

-- Optional sales/show pipeline table.
create table if not exists sales_pipeline (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  client_name text not null,
  contact_name text,
  contact_phone text,
  contact_email text,
  venue text,
  city text,
  show_start date,
  show_end date,
  stage text not null default 'Inquiry' check (stage in ('Inquiry', 'Estimating', 'Quote Sent', 'Verbal Yes', 'Confirmed', 'Lost', 'Archived')),
  estimated_revenue numeric(12,2) not null default 0,
  probability numeric(5,2) not null default 0 check (probability >= 0 and probability <= 100),
  next_follow_up date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table sales_pipeline enable row level security;
drop policy if exists "sales_pipeline_authenticated_all" on sales_pipeline;
create policy "sales_pipeline_authenticated_all"
  on sales_pipeline
  for all
  to authenticated
  using (true)
  with check (true);
-- ELS clients, client contacts, and show tech ratings.
-- Run this once in Supabase SQL Editor after deploying.
-- Only client name and contact name are required; all other company/contact details are optional.
-- Ratings now build two separate rankings:
--   1) Business Client Top Techs = median rating across all linked events for that client.
--   2) Project Manager / Client Contact Top Techs = median rating across events where that contact was selected.

create extension if not exists pgcrypto;

create table if not exists business_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_rate_city text not null default 'Default',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table business_clients add column if not exists legal_company_name text;
alter table business_clients add column if not exists billing_address text;
alter table business_clients add column if not exists billing_city text;
alter table business_clients add column if not exists billing_state text;
alter table business_clients add column if not exists billing_zip text;
alter table business_clients add column if not exists main_phone text;
alter table business_clients add column if not exists main_email text;
alter table business_clients add column if not exists website text;
alter table business_clients add column if not exists default_market_notes text;
alter table business_clients add column if not exists ap_contact_name text;
alter table business_clients add column if not exists ap_email text;
alter table business_clients add column if not exists ap_phone text;
alter table business_clients add column if not exists payment_terms text;
alter table business_clients add column if not exists po_required boolean;
alter table business_clients add column if not exists w9_coi_notes text;
alter table business_clients add column if not exists default_invoice_email text;
alter table business_clients add column if not exists billing_notes text;

create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references business_clients(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  notes text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table client_contacts add column if not exists cell_phone text;
alter table client_contacts add column if not exists is_onsite_contact boolean not null default false;
alter table client_contacts add column if not exists is_billing_contact boolean not null default false;

alter table shows add column if not exists business_client_id uuid references business_clients(id) on delete set null;
alter table shows add column if not exists client_contact_id uuid references client_contacts(id) on delete set null;

create table if not exists tech_ratings (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  client_id uuid references business_clients(id) on delete set null,
  client_contact_id uuid references client_contacts(id) on delete set null,
  crew_id uuid not null references crew(id) on delete cascade,
  assignment_id uuid references assignments(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (show_id, crew_id)
);

alter table tech_ratings add column if not exists client_contact_id uuid references client_contacts(id) on delete set null;

create index if not exists business_clients_name_idx on business_clients(name);
create index if not exists business_clients_main_email_idx on business_clients(main_email);
create index if not exists business_clients_default_rate_city_idx on business_clients(default_rate_city);
create index if not exists client_contacts_client_id_idx on client_contacts(client_id);
create index if not exists client_contacts_email_idx on client_contacts(email);
create index if not exists tech_ratings_client_id_idx on tech_ratings(client_id);
create index if not exists tech_ratings_client_contact_id_idx on tech_ratings(client_contact_id);
create index if not exists tech_ratings_show_id_idx on tech_ratings(show_id);
create index if not exists tech_ratings_crew_id_idx on tech_ratings(crew_id);

alter table business_clients enable row level security;
alter table client_contacts enable row level security;
alter table tech_ratings enable row level security;

drop policy if exists "business_clients_authenticated_all" on business_clients;
create policy "business_clients_authenticated_all"
  on business_clients
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "client_contacts_authenticated_all" on client_contacts;
create policy "client_contacts_authenticated_all"
  on client_contacts
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "tech_ratings_authenticated_all" on tech_ratings;
create policy "tech_ratings_authenticated_all"
  on tech_ratings
  for all
  to authenticated
  using (true)
  with check (true);

-- Backfill old ratings from the current show link.
update tech_ratings tr
set client_id = s.business_client_id,
    client_contact_id = s.client_contact_id,
    updated_at = now()
from shows s
where tr.show_id = s.id
  and (
    (s.business_client_id is not null and (tr.client_id is null or tr.client_id <> s.business_client_id))
    or
    (s.client_contact_id is not null and (tr.client_contact_id is null or tr.client_contact_id <> s.client_contact_id))
  );

drop view if exists client_contact_top_techs;
drop view if exists client_top_techs;
drop view if exists crew_rating_summary;

create or replace view client_top_techs as
select
  tr.client_id,
  tr.crew_id,
  c.name as crew_name,
  c.phone,
  c.email,
  round((percentile_cont(0.5) within group (order by tr.rating))::numeric, 2) as median_rating,
  round(avg(tr.rating)::numeric, 2) as average_rating,
  count(*)::integer as rating_count,
  max(coalesce(tr.updated_at, tr.created_at)) as last_rating_at
from tech_ratings tr
join crew c on c.id = tr.crew_id
where tr.client_id is not null
group by tr.client_id, tr.crew_id, c.name, c.phone, c.email;

create or replace view client_contact_top_techs as
select
  tr.client_id,
  tr.client_contact_id,
  cc.name as client_contact_name,
  tr.crew_id,
  c.name as crew_name,
  c.phone,
  c.email,
  round((percentile_cont(0.5) within group (order by tr.rating))::numeric, 2) as median_rating,
  round(avg(tr.rating)::numeric, 2) as average_rating,
  count(*)::integer as rating_count,
  max(coalesce(tr.updated_at, tr.created_at)) as last_rating_at
from tech_ratings tr
join crew c on c.id = tr.crew_id
join client_contacts cc on cc.id = tr.client_contact_id
where tr.client_contact_id is not null
group by tr.client_id, tr.client_contact_id, cc.name, tr.crew_id, c.name, c.phone, c.email;

create or replace view crew_rating_summary as
select
  tr.crew_id,
  c.name as crew_name,
  c.phone,
  c.email,
  round(avg(tr.rating)::numeric, 2) as average_rating,
  round((percentile_cont(0.5) within group (order by tr.rating))::numeric, 2) as median_rating,
  count(*)::integer as rating_count,
  max(coalesce(tr.updated_at, tr.created_at)) as last_rating_at
from tech_ratings tr
join crew c on c.id = tr.crew_id
group by tr.crew_id, c.name, c.phone, c.email;
