create extension if not exists pgcrypto;

create type if not exists app_role as enum ('owner', 'admin', 'coordinator', 'viewer');

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
  unique(city_name, role_name)
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
  notes text,
  sort_order int generated always as (extract(epoch from labor_date)) stored
);

create table if not exists sub_calls (
  id uuid primary key default gen_random_uuid(),
  labor_day_id uuid not null references labor_days(id) on delete cascade,
  area text not null,
  role_name text not null,
  start_time time not null,
  end_time time,
  crew_needed int not null default 1,
  notes text
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  sub_call_id uuid not null references sub_calls(id) on delete cascade,
  crew_id uuid not null references crew(id) on delete cascade,
  status text not null check (status in ('invited','confirmed','declined')),
  created_at timestamptz not null default now(),
  unique(sub_call_id, crew_id)
);

create table if not exists show_payroll (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  crew_id uuid not null references crew(id) on delete cascade,
  role_name text,
  pay_type text not null default 'Regular' check (pay_type in ('Regular','OT','DT')),
  paid boolean not null default false,
  payout_override numeric(10,2),
  notes text,
  unique(show_id, crew_id, role_name)
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

create policy if not exists "authenticated users can read profiles" on profiles for select to authenticated using (true);
create policy if not exists "authenticated users can read city pools" on city_pools for select to authenticated using (true);
create policy if not exists "authenticated users can read crew" on crew for select to authenticated using (true);
create policy if not exists "authenticated users can read crew positions" on crew_positions for select to authenticated using (true);
create policy if not exists "authenticated users can read unavailable dates" on crew_unavailable_dates for select to authenticated using (true);
create policy if not exists "authenticated users can read rates" on master_rates for select to authenticated using (true);
create policy if not exists "authenticated users can read shows" on shows for select to authenticated using (true);
create policy if not exists "authenticated users can read labor days" on labor_days for select to authenticated using (true);
create policy if not exists "authenticated users can read sub calls" on sub_calls for select to authenticated using (true);
create policy if not exists "authenticated users can read assignments" on assignments for select to authenticated using (true);
create policy if not exists "authenticated users can read payroll" on show_payroll for select to authenticated using (true);

create policy if not exists "owners and admins can manage profiles" on profiles
  for all to authenticated
  using ((select role from profiles where id = auth.uid()) in ('owner','admin'))
  with check ((select role from profiles where id = auth.uid()) in ('owner','admin'));

alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table crew;
alter publication supabase_realtime add table crew_positions;
alter publication supabase_realtime add table crew_unavailable_dates;
alter publication supabase_realtime add table shows;
alter publication supabase_realtime add table labor_days;
alter publication supabase_realtime add table sub_calls;
alter publication supabase_realtime add table assignments;
alter publication supabase_realtime add table show_payroll;
