create table if not exists public.show_financials (
  show_id uuid primary key references public.shows(id) on delete cascade,
  estimated_revenue_override numeric,
  expenses numeric not null default 0,
  notes text,
  tax_reserve_done boolean not null default false,
  tax_reserve_done_at timestamptz,
  consecrated_hands_done boolean not null default false,
  consecrated_hands_done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.show_financials
  add column if not exists tax_reserve_done boolean not null default false,
  add column if not exists tax_reserve_done_at timestamptz,
  add column if not exists consecrated_hands_done boolean not null default false,
  add column if not exists consecrated_hands_done_at timestamptz;
