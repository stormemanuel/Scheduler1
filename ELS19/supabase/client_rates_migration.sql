-- Client billing rates storage
-- Separate from master_rates, which is crew pay.
-- Run this in Supabase SQL Editor before editing Client Billing Rates in Settings.

create extension if not exists pgcrypto;

create table if not exists public.client_rates (
  id uuid primary key default gen_random_uuid(),
  city_name text not null default 'Default',
  role_name text not null,
  full_day numeric(10,2) not null,
  half_day numeric(10,2),
  overtime_multiplier numeric(6,3) not null default 1.5,
  doubletime_multiplier numeric(6,3) not null default 2.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_rates_city_role_unique unique (city_name, role_name)
);

create index if not exists client_rates_city_name_idx on public.client_rates(city_name);
create index if not exists client_rates_role_name_idx on public.client_rates(role_name);

alter table public.client_rates enable row level security;

drop policy if exists "client_rates_authenticated_read" on public.client_rates;
create policy "client_rates_authenticated_read"
  on public.client_rates
  for select
  to authenticated
  using (true);

drop policy if exists "client_rates_authenticated_write" on public.client_rates;
create policy "client_rates_authenticated_write"
  on public.client_rates
  for all
  to authenticated
  using (true)
  with check (true);

insert into public.client_rates
  (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'A1-Specialty', 750, null, 1.5, 2.0),
  ('Default', 'A1-Audio Engineer', 700, null, 1.5, 2.0),
  ('Default', 'LED Engineer', 800, null, 1.5, 2.0),
  ('Default', 'V1-Lead Video Engineer', 700, null, 1.5, 2.0),
  ('Default', 'LD-Lighting Designer', 700, null, 1.5, 2.0),
  ('Default', 'Crew Lead', 650, null, 1.5, 2.0),
  ('Default', 'Breakout Lead', 650, null, 1.5, 2.0),
  ('Default', 'Networking Engineer', 650, null, 1.5, 2.0),
  ('Default', 'Speaker Ready', 650, null, 1.5, 2.0),
  ('Default', 'Graphics Operator', 650, null, 1.5, 2.0),
  ('Default', 'Playback Operator', 650, null, 1.5, 2.0),
  ('Default', 'Zoom Operator', 650, null, 1.5, 2.0),
  ('Default', 'Record Operator', 650, null, 1.5, 2.0),
  ('Default', 'Camera Operator', 700, null, 1.5, 2.0),
  ('Default', 'Camera Operator (PTZ)', 700, null, 1.5, 2.0),
  ('Default', 'Breakout Operator', 600, null, 1.5, 2.0),
  ('Default', 'Audio Show Support', 550, null, 1.5, 2.0),
  ('Default', 'A2-Audio Assist', 500, 250, 1.5, 2.0),
  ('Default', 'A3-Audio Setup and Strike', 450, 225, 1.5, 2.0),
  ('Default', 'V2-Video Assist', 550, 250, 1.5, 2.0),
  ('Default', 'V3-Video Set/Strike', 450, 225, 1.5, 2.0),
  ('Default', 'L2-Lighting Assist', 500, 250, 1.5, 2.0),
  ('Default', 'L3-Lighting Setup/Strike', 450, 225, 1.5, 2.0),
  ('Default', 'LED Assist', 500, 250, 1.5, 2.0),
  ('Default', 'Down Rigger', 550, 275, 1.5, 2.0),
  ('Default', 'Decoration', 450, 225, 1.5, 2.0),
  ('Default', 'General AV', 450, 225, 1.5, 2.0),
  ('Default', 'AVT', 450, 225, 1.5, 2.0),
  ('Default', 'Stagehand', 400, 200, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier,
  updated_at = now();
