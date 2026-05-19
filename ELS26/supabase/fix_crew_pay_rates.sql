-- Master rates safety setup. Run this in Supabase SQL Editor.
-- It lets Supabase create an id automatically when a new pay-rate row is inserted.

create extension if not exists pgcrypto;

alter table public.master_rates
alter column id set default gen_random_uuid();

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

-- Run this once in Supabase SQL Editor if the Crew page is showing client billing prices
-- as what you pay workers. This converts obvious ELS billing-rate rows into crew payout rates.
-- It only targets common imported billing values by role; manually customized rates outside
-- these patterns are left alone.

insert into public.master_rates (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'General AV', 350, 175, 1.5, 2.0),
  ('Default', 'AVT', 350, 175, 1.5, 2.0),
  ('Default', 'LED Stagehand', 350, 175, 1.5, 2.0),
  ('Default', 'LED Assist', 350, 175, 1.5, 2.0),
  ('Default', 'A2-Audio Assist', 350, 175, 1.5, 2.0),
  ('Default', 'V2-Video Assist', 350, 175, 1.5, 2.0),
  ('Default', 'L2-Lighting Assist', 350, 175, 1.5, 2.0),
  ('Default', 'Stagehand', 300, 150, 1.5, 2.0),
  ('Default', 'Client Facing Audio Visual Tech', 400, 200, 1.5, 2.0),
  ('Default', 'Breakout Operator', 400, 200, 1.5, 2.0),
  ('Default', 'Crew Lead', 500, null, 1.5, 2.0),
  ('Default', 'Breakout Lead', 500, null, 1.5, 2.0),
  ('Default', 'A1-Audio Engineer', 500, null, 1.5, 2.0),
  ('Default', 'V1-Lead Video Engineer', 500, null, 1.5, 2.0),
  ('Default', 'LD-Lighting Designer', 500, null, 1.5, 2.0),
  ('Default', 'Speaker Ready', 500, null, 1.5, 2.0),
  ('Default', 'Graphics Operator', 500, null, 1.5, 2.0),
  ('Default', 'Playback Operator', 500, null, 1.5, 2.0),
  ('Default', 'Zoom Operator', 500, null, 1.5, 2.0),
  ('Default', 'Record Operator', 500, null, 1.5, 2.0),
  ('Default', 'Camera Operator', 500, null, 1.5, 2.0),
  ('Default', 'Audio Show Support', 400, 200, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier;

update public.crew_positions
set rate = case
  when lower(role_name) similar to '%(general av|gav|avt|led stagehand|led assist|a2|audio assist|v2|video assist|l2|lighting assist|audio setup|video set|lighting setup)%' then 350
  when lower(role_name) similar to '%(stagehand|stage hand|decoration)%' then 300
  when lower(role_name) similar to '%(client facing|cf avt|breakout operator|bo tech|breakout tech|audio show support|down rigger)%' then 400
  when lower(role_name) similar to '%(crew lead|working crew lead|breakout lead|a1|audio engineer|v1|lead video|lighting designer|speaker ready|graphics operator|playback operator|zoom operator|record operator|camera operator)%' then 500
  else rate
end
where
  -- only replace rates that look like imported client billing/day-rate values
  rate in (450, 500, 550, 600, 650, 700, 750, 800)
  and (
    lower(role_name) similar to '%(general av|gav|avt|led stagehand|led assist|a2|audio assist|v2|video assist|l2|lighting assist|audio setup|video set|lighting setup|stagehand|stage hand|decoration|client facing|cf avt|breakout operator|bo tech|breakout tech|audio show support|down rigger|crew lead|working crew lead|breakout lead|a1|audio engineer|v1|lead video|lighting designer|speaker ready|graphics operator|playback operator|zoom operator|record operator|camera operator)%'
  );
