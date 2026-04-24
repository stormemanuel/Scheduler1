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

alter table profiles enable row level security;
alter table city_pools enable row level security;
alter table crew enable row level security;
alter table crew_positions enable row level security;
alter table crew_unavailable_dates enable row level security;
alter table master_rates enable row level security;
alter table shows enable row level security;
alter table labor_days enable row level security;
alter table sub_calls enable row level security;
alter table assignments enable row level security;
alter table show_payroll enable row level security;

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
