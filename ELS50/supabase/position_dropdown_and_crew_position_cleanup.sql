-- ELS44 Position dropdown + crew-position cleanup
-- Safe to run more than once.
-- Adds a direct master-rate link to sub-calls and standardizes duplicate/old crew position names
-- to the remaining positions in Settings > Crew pay rates.

create extension if not exists pgcrypto;

-- Normalize common AV position names so old/duplicate names still point to the same remaining position.
create or replace function public.els_position_key(value text)
returns text
language sql
immutable
as $$
  select case
    when n in ('general av','gav','avt','av tech','av technician','general av tech','audio visual tech','audio visual technician') then 'general av'
    when n in ('led','led assist','led stagehand','led hand','led tech','led technician') then 'led stagehand'
    when n in ('breakout tech','breakout technician','breakout operator','breakout room operator','breakout room tech','breakouts','bo','bo tech','bo technician') then 'breakout tech'
    when n in ('breakout floater','floater','breakouts floater') then 'breakout floater'
    when n in ('a2','a2 audio assist','audio assist','audio tech','audio technician') then 'audio assist'
    when n in ('v2','v2 video assist','video assist','video tech','video technician') then 'video assist'
    when n in ('l2','l2 lighting assist','lighting assist','lighting tech','lighting technician') then 'lighting assist'
    when n in ('cf avt','client facing avt','client facing av tech','client facing audio visual tech','client facing audiovisual tech') then 'client facing audio visual tech'
    when n in ('crew lead','lead') then 'crew lead'
    when n in ('warehouse','warehouse worker','warehouse workers','warehouse prep','loader','unload') then 'warehouse worker'
    else n
  end
  from (
    select btrim(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g')) as n
  ) normalized;
$$;

-- Keep the master_rates unique pair enforced.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'master_rates_city_role_unique'
      and conrelid = 'public.master_rates'::regclass
  ) then
    alter table public.master_rates
    add constraint master_rates_city_role_unique unique (city_name, role_name);
  end if;
end $$;

-- Preferred display names for the main duplicate groups.
create temporary table if not exists els_position_canonical_names (
  position_key text primary key,
  canonical_name text not null
) on commit drop;

truncate table els_position_canonical_names;

insert into els_position_canonical_names (position_key, canonical_name)
values
  ('general av', 'General AV'),
  ('led stagehand', 'LED Stagehand'),
  ('breakout tech', 'Breakout Tech'),
  ('breakout floater', 'Breakout Floater'),
  ('audio assist', 'A2-Audio Assist'),
  ('video assist', 'V2-Video Assist'),
  ('lighting assist', 'L2-Lighting Assist'),
  ('client facing audio visual tech', 'Client Facing Audio Visual Tech'),
  ('crew lead', 'Crew Lead'),
  ('warehouse worker', 'Warehouse Worker')
on conflict (position_key) do update
set canonical_name = excluded.canonical_name;

-- If a city already has both the old and new display names, merge the old row into the canonical row.
with duplicate_pairs as (
  select
    source.id as source_id,
    target.id as target_id,
    source.full_day as source_full_day,
    source.half_day as source_half_day,
    source.overtime_multiplier as source_ot,
    source.doubletime_multiplier as source_dt
  from public.master_rates source
  join els_position_canonical_names canon
    on public.els_position_key(source.role_name) = canon.position_key
  join public.master_rates target
    on target.city_name = source.city_name
   and public.els_position_key(target.role_name) = canon.position_key
   and target.role_name = canon.canonical_name
  where source.role_name <> canon.canonical_name
)
update public.master_rates target
set
  full_day = case when coalesce(target.full_day, 0) > 0 then target.full_day else duplicate_pairs.source_full_day end,
  half_day = coalesce(target.half_day, duplicate_pairs.source_half_day),
  overtime_multiplier = coalesce(target.overtime_multiplier, duplicate_pairs.source_ot, 1.5),
  doubletime_multiplier = coalesce(target.doubletime_multiplier, duplicate_pairs.source_dt, 2.0)
from duplicate_pairs
where target.id = duplicate_pairs.target_id;

with duplicate_pairs as (
  select source.id as source_id
  from public.master_rates source
  join els_position_canonical_names canon
    on public.els_position_key(source.role_name) = canon.position_key
  join public.master_rates target
    on target.city_name = source.city_name
   and public.els_position_key(target.role_name) = canon.position_key
   and target.role_name = canon.canonical_name
  where source.role_name <> canon.canonical_name
)
delete from public.master_rates mr
using duplicate_pairs
where mr.id = duplicate_pairs.source_id;

-- Rename old master-rate display names when there is no conflict.
update public.master_rates mr
set role_name = canon.canonical_name
from els_position_canonical_names canon
where public.els_position_key(mr.role_name) = canon.position_key
  and mr.role_name <> canon.canonical_name
  and not exists (
    select 1
    from public.master_rates existing
    where existing.city_name = mr.city_name
      and existing.role_name = canon.canonical_name
      and existing.id <> mr.id
  );

-- Add the master-rate link to sub-calls. The app still keeps role_name for readable exports.
alter table public.sub_calls
  add column if not exists master_rate_id uuid references public.master_rates(id) on delete set null;

create index if not exists sub_calls_master_rate_id_idx
  on public.sub_calls(master_rate_id);

-- Backfill sub-calls to the best master rate for their event's rate city; fallback to Default.
with call_context as (
  select
    sc.id as sub_call_id,
    public.els_position_key(sc.role_name) as position_key,
    coalesce(nullif(s.rate_city, ''), 'Default') as rate_city
  from public.sub_calls sc
  join public.labor_days ld on ld.id = sc.labor_day_id
  join public.shows s on s.id = ld.show_id
), ranked_rates as (
  select
    cc.sub_call_id,
    mr.id as master_rate_id,
    row_number() over (
      partition by cc.sub_call_id
      order by
        case when lower(mr.city_name) = lower(cc.rate_city) then 0 when lower(mr.city_name) = 'default' then 1 else 2 end,
        mr.role_name
    ) as rn
  from call_context cc
  join public.master_rates mr
    on public.els_position_key(mr.role_name) = cc.position_key
   and (lower(mr.city_name) = lower(cc.rate_city) or lower(mr.city_name) = 'default')
)
update public.sub_calls sc
set master_rate_id = ranked_rates.master_rate_id
from ranked_rates
where sc.id = ranked_rates.sub_call_id
  and ranked_rates.rn = 1
  and sc.master_rate_id is distinct from ranked_rates.master_rate_id;

-- Switch crew position names to the remaining/canonical names while preserving each person's saved pay rate.
update public.crew_positions cp
set role_name = canon.canonical_name
from els_position_canonical_names canon
where public.els_position_key(cp.role_name) = canon.position_key
  and exists (
    select 1
    from public.master_rates mr
    where public.els_position_key(mr.role_name) = canon.position_key
  )
  and cp.role_name <> canon.canonical_name;

-- Remove duplicate positions left on the same crew member after the name cleanup.
-- Keeps the highest saved crew rate; if tied, keeps the oldest record.
with ranked as (
  select
    id,
    row_number() over (
      partition by crew_id, public.els_position_key(role_name)
      order by rate desc nulls last, created_at asc, id asc
    ) as rn
  from public.crew_positions
)
delete from public.crew_positions cp
using ranked
where cp.id = ranked.id
  and ranked.rn > 1;

-- Optional but helpful: make sure the most common defaults exist if they were fully missing.
insert into public.master_rates (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'General AV', 350, 175, 1.5, 2.0),
  ('Default', 'LED Stagehand', 350, 175, 1.5, 2.0),
  ('Default', 'Breakout Tech', 400, 200, 1.5, 2.0),
  ('Default', 'Breakout Floater', 400, 200, 1.5, 2.0),
  ('Default', 'Stagehand', 300, 150, 1.5, 2.0)
on conflict (city_name, role_name) do nothing;

notify pgrst, 'reload schema';

-- Check results.
select
  'sub_calls_linked_to_master_rate' as check_name,
  count(*) filter (where master_rate_id is not null) as linked_count,
  count(*) as total_sub_calls
from public.sub_calls;

select
  'crew_positions_after_cleanup' as check_name,
  role_name,
  count(*) as crew_position_count
from public.crew_positions
group by role_name
order by crew_position_count desc, role_name;
