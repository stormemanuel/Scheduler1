create extension if not exists pgcrypto;

insert into public.master_rates
  (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'Warehouse Worker', 300, 150, 1.5, 2.0),
  ('Default', 'Warehouse workers', 300, 150, 1.5, 2.0),
  ('Default', 'Warehouse', 300, 150, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier;

insert into public.client_rates
  (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'Warehouse Worker', 400, 200, 1.5, 2.0),
  ('Default', 'Warehouse workers', 400, 200, 1.5, 2.0),
  ('Default', 'Warehouse', 400, 200, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier;
