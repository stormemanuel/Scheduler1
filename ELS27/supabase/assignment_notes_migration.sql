create table if not exists assignment_notes (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  crew_member_id uuid not null references crew(id) on delete cascade,
  assignment_id uuid,
  note_code text not null,
  note_label text not null,
  custom_note text,
  visibility text not null default 'admin_only',
  created_at timestamptz not null default now()
);

alter table assignment_notes enable row level security;

drop policy if exists "assignment_notes_authenticated_all" on assignment_notes;
create policy "assignment_notes_authenticated_all"
  on assignment_notes
  for all
  to authenticated
  using (true)
  with check (true);

create index if not exists assignment_notes_show_id_idx on assignment_notes(show_id);
create index if not exists assignment_notes_crew_member_id_idx on assignment_notes(crew_member_id);
create index if not exists assignment_notes_assignment_id_idx on assignment_notes(assignment_id);
