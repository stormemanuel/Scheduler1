-- Optional helper for this build.
-- Adds the default payout rate for Client Facing Audio Visual Tech / CF AVT.
-- Existing rows are updated to the requested $400 full day / $200 half day.

insert into public.master_rates (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'Client Facing Audio Visual Tech', 400, 200, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier;
