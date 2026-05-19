-- Crew confirmation checklist storage
-- Tracks show-level confirmation status per crew member.

create table if not exists public.assignment_checklists (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,

  schedule_sent boolean not null default false,
  confirmed boolean not null default false,
  day_before_confirmed boolean not null default false,

  schedule_sent_at timestamptz,
  confirmed_at timestamptz,
  day_before_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint assignment_checklists_show_crew_unique unique (show_id, crew_id)
);

create index if not exists assignment_checklists_show_id_idx on public.assignment_checklists(show_id);
create index if not exists assignment_checklists_crew_id_idx on public.assignment_checklists(crew_id);
