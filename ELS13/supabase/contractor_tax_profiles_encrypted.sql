-- Optional tax-season storage foundation for contractor 1099-NEC prep.
-- Run in Supabase SQL Editor if you want to store W-9/TIN/address data.
-- This creates a separate restricted table instead of adding sensitive fields to the visible crew table.

create extension if not exists pgcrypto;

create table if not exists contractor_tax_profiles (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references crew(id) on delete cascade unique,
  legal_name_encrypted text,
  tin_encrypted text,
  address_line1_encrypted text,
  address_line2_encrypted text,
  city_encrypted text,
  state_encrypted text,
  zip_encrypted text,
  tin_last4 text,
  w9_on_file boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table contractor_tax_profiles enable row level security;

-- Keep this table service-role only until the app has a dedicated tax admin screen.
-- Do not create broad anon/authenticated select policies for TIN data.

create index if not exists contractor_tax_profiles_crew_id_idx on contractor_tax_profiles(crew_id);
