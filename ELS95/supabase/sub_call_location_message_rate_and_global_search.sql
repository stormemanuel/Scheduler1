-- ELS63 Sub-call location + per-sub-call message rate
-- Safe to run more than once.

alter table public.sub_calls
  add column if not exists location text;

alter table public.sub_calls
  add column if not exists message_rate numeric(10,2);

create index if not exists sub_calls_location_idx
  on public.sub_calls using gin (to_tsvector('simple', coalesce(location, '')));

create index if not exists sub_calls_message_rate_idx
  on public.sub_calls(message_rate);

notify pgrst, 'reload schema';

select
  'ELS63 sub-call location/message rate ready' as status,
  count(*) as total_sub_calls,
  count(*) filter (where location is not null and btrim(location) <> '') as calls_with_location,
  count(*) filter (where message_rate is not null) as calls_with_message_rate
from public.sub_calls;
