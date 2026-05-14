-- Optional payroll performance indexes.
-- Run once in Supabase SQL Editor if Payroll is slow after large CSV imports.

create index if not exists labor_days_show_id_labor_date_idx
on public.labor_days(show_id, labor_date);

create index if not exists sub_calls_labor_day_id_idx
on public.sub_calls(labor_day_id);

create index if not exists assignments_sub_call_id_idx
on public.assignments(sub_call_id);

create index if not exists assignments_crew_id_idx
on public.assignments(crew_id);

create index if not exists crew_positions_crew_id_idx
on public.crew_positions(crew_id);

create index if not exists show_payroll_show_id_crew_id_idx
on public.show_payroll(show_id, crew_id);

create index if not exists show_financials_show_id_idx
on public.show_financials(show_id);
