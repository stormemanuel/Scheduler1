create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  sub_call_id uuid not null references public.sub_calls(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  status text not null default 'confirmed',
  created_at timestamptz not null default now(),
  unique (sub_call_id, crew_id)
);

alter table public.assignments enable row level security;

drop policy if exists "assignments_authenticated_all" on public.assignments;
create policy "assignments_authenticated_all"
  on public.assignments
  for all
  to authenticated
  using (true)
  with check (true);
