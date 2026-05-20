-- ELS43 quick fix: link existing show ratings to the saved business client
-- and selected project manager/client contact on each event.
-- Run after clients_tech_ratings_migration.sql if you already rated techs before this update.

alter table tech_ratings add column if not exists client_contact_id uuid references client_contacts(id) on delete set null;

update tech_ratings tr
set client_id = s.business_client_id,
    client_contact_id = s.client_contact_id,
    updated_at = now()
from shows s
where tr.show_id = s.id
  and (
    (s.business_client_id is not null and (tr.client_id is null or tr.client_id <> s.business_client_id))
    or
    (s.client_contact_id is not null and (tr.client_contact_id is null or tr.client_contact_id <> s.client_contact_id))
  );

-- Optional check: ratings that still cannot count toward a business client's Top Techs list.
select
  tr.id as rating_id,
  tr.show_id,
  s.name as show_name,
  s.client as event_client_text,
  tr.rating,
  tr.client_id,
  tr.client_contact_id,
  s.business_client_id as show_business_client_id,
  s.client_contact_id as show_client_contact_id
from tech_ratings tr
join shows s on s.id = tr.show_id
where tr.client_id is null
order by s.show_start desc;
