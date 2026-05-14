create table if not exists public.show_financials (
  show_id uuid primary key references public.shows(id) on delete cascade,
  estimated_revenue_override numeric,
  expenses numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
