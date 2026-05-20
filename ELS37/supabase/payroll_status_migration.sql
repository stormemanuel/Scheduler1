-- Optional safety migration for Payroll paid/unpaid tracking.
-- Run this once in Supabase SQL Editor if the Payroll page says show_payroll is missing.

create table if not exists public.show_payroll (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  role_name text,
  pay_type text not null default 'Regular' check (pay_type in ('Regular', 'OT', 'DT')),
  paid boolean not null default false,
  payout_override numeric(10,2),
  notes text,
  unique (show_id, crew_id, role_name)
);

alter table public.show_payroll enable row level security;

drop policy if exists "show_payroll_authenticated_all" on public.show_payroll;
create policy "show_payroll_authenticated_all"
  on public.show_payroll
  for all
  to authenticated
  using (true)
  with check (true);
