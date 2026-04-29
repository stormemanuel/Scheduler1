create table if not exists crew_groups (
  id uuid primary key default gen_random_uuid(),
  city_pool_id uuid not null references city_pools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (city_pool_id, name)
);

alter table crew_groups enable row level security;

drop policy if exists "crew_groups_authenticated_all" on crew_groups;
create policy "crew_groups_authenticated_all"
  on crew_groups
  for all
  to authenticated
  using (true)
  with check (true);

insert into crew_groups (city_pool_id, name)
select distinct city_pool_id, coalesce(nullif(trim(group_name), ''), 'Ungrouped')
from crew
where city_pool_id is not null
on conflict (city_pool_id, name) do nothing;
