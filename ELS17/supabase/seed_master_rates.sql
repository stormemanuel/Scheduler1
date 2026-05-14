-- Optional helper only.
-- These are ELS crew payout defaults, not client billing rates.
-- Edit these values in the app Settings page if you pay a specific market differently.

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
  ('Default', 'Camera Operator', 500, null, 1.5, 2.0)
on conflict (city_name, role_name)
do update set
  full_day = excluded.full_day,
  half_day = excluded.half_day,
  overtime_multiplier = excluded.overtime_multiplier,
  doubletime_multiplier = excluded.doubletime_multiplier;
