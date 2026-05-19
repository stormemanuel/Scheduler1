-- Text message automation settings and send queue for show confirmations.
-- Run in Supabase SQL Editor before using the automation page.

create extension if not exists pgcrypto;

create table if not exists public.show_text_automations (
  show_id uuid primary key references public.shows(id) on delete cascade,
  enabled boolean not null default false,
  sending_method text not null default 'manual',
  shortcut_token text,
  send_availability boolean not null default false,
  send_schedule boolean not null default true,
  reminder_7_day boolean not null default true,
  reminder_3_day boolean not null default true,
  reminder_day_before boolean not null default true,
  reminder_day_of boolean not null default true,
  timezone text not null default 'America/Chicago',
  availability_template text,
  schedule_template text,
  reminder_template text,
  updated_at timestamptz not null default now()
);

create table if not exists public.text_message_queue (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  crew_id uuid references public.crew(id) on delete set null,
  crew_name text not null default '',
  phone text not null default '',
  message_type text not null default 'schedule',
  reminder_key text not null default 'manual',
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  body text not null,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  constraint text_message_queue_status_check check (status in ('scheduled', 'sent', 'failed', 'cancelled')),
  constraint text_message_queue_show_crew_type_key_unique unique (show_id, crew_id, message_type, reminder_key)
);



alter table public.show_text_automations
  add column if not exists sending_method text not null default 'manual',
  add column if not exists shortcut_token text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'show_text_automations_sending_method_check'
      and conrelid = 'public.show_text_automations'::regclass
  ) then
    alter table public.show_text_automations
    add constraint show_text_automations_sending_method_check
    check (sending_method in ('manual', 'shortcut', 'provider'));
  end if;
end $$;

create unique index if not exists show_text_automations_shortcut_token_idx
on public.show_text_automations(shortcut_token)
where shortcut_token is not null;

create index if not exists show_text_automations_show_id_idx on public.show_text_automations(show_id);
create index if not exists text_message_queue_show_id_idx on public.text_message_queue(show_id);
create index if not exists text_message_queue_status_scheduled_for_idx on public.text_message_queue(status, scheduled_for);
create index if not exists text_message_queue_crew_id_idx on public.text_message_queue(crew_id);

alter table public.show_text_automations enable row level security;
alter table public.text_message_queue enable row level security;

drop policy if exists "show_text_automations_authenticated_all" on public.show_text_automations;
create policy "show_text_automations_authenticated_all"
  on public.show_text_automations
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "text_message_queue_authenticated_all" on public.text_message_queue;
create policy "text_message_queue_authenticated_all"
  on public.text_message_queue
  for all
  to authenticated
  using (true)
  with check (true);
