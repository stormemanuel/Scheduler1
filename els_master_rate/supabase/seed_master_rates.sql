-- Optional helper only.
-- Edit these values to match what you actually pay crew before you run this file.
-- The app's Settings page lets you edit everything in one place after deploy.

insert into public.master_rates (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'General AV', 0, 0, 1.5, 2.0),
  ('Default', 'Crew Lead', 0, null, 1.5, 2.0),
  ('Default', 'Breakout Operator', 0, null, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier;
