-- Fix LED Assist / LED Stagehand client billing rates.
-- This prevents assist roles from being charged as LED Engineer ($800).

create extension if not exists pgcrypto;

insert into public.client_rates
  (city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier)
values
  ('Default', 'LED Assist', 500, 250, 1.5, 2.0),
  ('Default', 'LED Stagehand', 500, 250, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier,
  updated_at = now();

-- If a broad "LED" row exists and was being used for assist labor, make it an
-- assist billing rate. Keep "LED Engineer" at $800.
update public.client_rates
set full_day = 500,
    half_day = 250,
    updated_at = now()
where lower(trim(role_name)) in ('led', 'led tech', 'led technician', 'led stagehand');
