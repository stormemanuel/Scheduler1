-- ELS sales / show pipeline storage.
-- Run in Supabase SQL Editor before using the Pipelines page.

create extension if not exists pgcrypto;

create table if not exists public.sales_pipeline (
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
  stage text not null default 'Inquiry',
  estimated_revenue numeric(12,2) not null default 0,
  probability numeric(5,2) not null default 0,
  next_follow_up date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_pipeline_stage_check check (stage in ('Inquiry', 'Estimating', 'Quote Sent', 'Verbal Yes', 'Confirmed', 'Lost', 'Archived')),
  constraint sales_pipeline_probability_check check (probability >= 0 and probability <= 100)
);

create index if not exists sales_pipeline_stage_idx on public.sales_pipeline(stage);
create index if not exists sales_pipeline_next_follow_up_idx on public.sales_pipeline(next_follow_up);
create index if not exists sales_pipeline_show_start_idx on public.sales_pipeline(show_start);

alter table public.sales_pipeline enable row level security;

drop policy if exists "sales_pipeline_authenticated_all" on public.sales_pipeline;
create policy "sales_pipeline_authenticated_all"
  on public.sales_pipeline
  for all
  to authenticated
  using (true)
  with check (true);
