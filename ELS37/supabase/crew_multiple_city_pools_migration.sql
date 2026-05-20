-- Optional multi-pool crew assignment support.
-- Keeps one crew contact, while allowing that same person to appear in multiple city/travel pools.

create extension if not exists pgcrypto;

create table if not exists public.crew_city_pools (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid not null references public.crew(id) on delete cascade,
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint crew_city_pools_unique unique (crew_id, city_pool_id)
);

create index if not exists crew_city_pools_crew_id_idx on public.crew_city_pools(crew_id);
create index if not exists crew_city_pools_city_pool_id_idx on public.crew_city_pools(city_pool_id);

alter table public.crew_city_pools enable row level security;

drop policy if exists "crew_city_pools_authenticated_all" on public.crew_city_pools;
create policy "crew_city_pools_authenticated_all"
  on public.crew_city_pools
  for all
  to authenticated
  using (true)
  with check (true);

insert into public.city_pools (name)
values ('Travel Techs')
on conflict (name) do nothing;
