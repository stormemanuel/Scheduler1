-- ELS50 assignment crew order migration
-- Adds saved manual order for crew inside each sub-call.
-- Safe to run more than once.

create extension if not exists pgcrypto;

alter table public.assignments
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select
    id,
    row_number() over (
      partition by sub_call_id
      order by
        case when coalesce(sort_order, 0) > 0 then sort_order else 999999 end,
        created_at asc nulls last,
        id asc
    ) as rn
  from public.assignments
)
update public.assignments a
set sort_order = ranked.rn
from ranked
where a.id = ranked.id
  and a.sort_order is distinct from ranked.rn;

create index if not exists assignments_sub_call_sort_order_idx
  on public.assignments(sub_call_id, sort_order);

notify pgrst, 'reload schema';

select
  'assignment_order_ready' as status,
  count(*) as total_assignments,
  count(*) filter (where sort_order > 0) as ordered_assignments
from public.assignments;
