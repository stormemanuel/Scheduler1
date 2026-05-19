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

