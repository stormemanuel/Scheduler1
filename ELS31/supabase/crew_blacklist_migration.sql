-- Crew blacklist / do-not-assign flags.
-- Run once in Supabase SQL Editor before using the blacklist filter in Events.

alter table public.crew
  add column if not exists blacklisted boolean not null default false,
  add column if not exists blacklist_reason text;

create index if not exists crew_blacklisted_idx on public.crew(blacklisted);
