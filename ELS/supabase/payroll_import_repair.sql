-- Payroll import repair / safety cleanup.
-- Run only if Payroll fails after imports. This removes orphaned rows and fills missing imported time fields.

create extension if not exists pgcrypto;

-- Remove assignments pointing to missing sub-calls or missing crew.
delete from public.assignments a
where not exists (select 1 from public.sub_calls sc where sc.id = a.sub_call_id)
   or not exists (select 1 from public.crew c where c.id = a.crew_id);

-- Remove sub-calls pointing to missing labor days.
delete from public.sub_calls sc
where not exists (select 1 from public.labor_days ld where ld.id = sc.labor_day_id);

-- Remove labor days pointing to missing shows.
delete from public.labor_days ld
where not exists (select 1 from public.shows s where s.id = ld.show_id);

-- Fill any blank imported display fields that can break reports.
update public.sub_calls
set area = coalesce(nullif(trim(area), ''), 'Imported Call')
where area is null or trim(area) = '';

update public.sub_calls
set role_name = coalesce(nullif(trim(role_name), ''), 'General AV')
where role_name is null or trim(role_name) = '';
