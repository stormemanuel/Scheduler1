-- ELS clients, client contacts, and show tech ratings.
-- Run this once in Supabase SQL Editor before using the Clients page or Tech Ratings view.

create extension if not exists pgcrypto;

create table if not exists business_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  default_rate_city text not null default 'Default',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references business_clients(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  notes text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table shows add column if not exists business_client_id uuid references business_clients(id) on delete set null;
alter table shows add column if not exists client_contact_id uuid references client_contacts(id) on delete set null;

create table if not exists tech_ratings (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  client_id uuid references business_clients(id) on delete set null,
  crew_id uuid not null references crew(id) on delete cascade,
  assignment_id uuid references assignments(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (show_id, crew_id)
);

create index if not exists business_clients_name_idx on business_clients(name);
create index if not exists client_contacts_client_id_idx on client_contacts(client_id);
create index if not exists tech_ratings_client_id_idx on tech_ratings(client_id);
create index if not exists tech_ratings_show_id_idx on tech_ratings(show_id);
create index if not exists tech_ratings_crew_id_idx on tech_ratings(crew_id);

alter table business_clients enable row level security;
alter table client_contacts enable row level security;
alter table tech_ratings enable row level security;

drop policy if exists "business_clients_authenticated_all" on business_clients;
create policy "business_clients_authenticated_all"
  on business_clients
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "client_contacts_authenticated_all" on client_contacts;
create policy "client_contacts_authenticated_all"
  on client_contacts
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "tech_ratings_authenticated_all" on tech_ratings;
create policy "tech_ratings_authenticated_all"
  on tech_ratings
  for all
  to authenticated
  using (true)
  with check (true);

create or replace view client_top_techs as
select
  tr.client_id,
  tr.crew_id,
  c.name as crew_name,
  c.phone,
  c.email,
  round(avg(tr.rating)::numeric, 2) as average_rating,
  count(*)::integer as rating_count,
  max(coalesce(tr.updated_at, tr.created_at)) as last_rating_at
from tech_ratings tr
join crew c on c.id = tr.crew_id
where tr.client_id is not null
group by tr.client_id, tr.crew_id, c.name, c.phone, c.email;
