-- ELS55 feedback ratings apply to crew contacts + top tech lists
-- Safe to run more than once.
-- Fixes feedback forms that submitted successfully but did not show on the crew contact rating,
-- Business Client Top Techs, Project Manager Top Techs, or add-crew recommendations.

create extension if not exists pgcrypto;

-- Keep the exclusion columns available so submitted feedback can be viewed,
-- removed from ratings, and restored without deleting the form.
alter table public.client_feedback_responses
  add column if not exists excluded_from_ratings boolean not null default false;

alter table public.client_feedback_responses
  add column if not exists excluded_reason text;

alter table public.client_feedback_responses
  add column if not exists excluded_at timestamptz;

-- Backfill survey links created before the event was tied to a saved business client/contact.
update public.feedback_survey_links fsl
set
  client_id = coalesce(fsl.client_id, s.business_client_id),
  client_contact_id = coalesce(fsl.client_contact_id, s.client_contact_id),
  updated_at = now()
from public.shows s
where s.id = fsl.show_id
  and (
    (fsl.client_id is null and s.business_client_id is not null)
    or (fsl.client_contact_id is null and s.client_contact_id is not null)
  );

-- Backfill already-submitted feedback response headers.
update public.client_feedback_responses r
set
  client_id = coalesce(r.client_id, fsl.client_id, s.business_client_id),
  client_contact_id = coalesce(r.client_contact_id, fsl.client_contact_id, s.client_contact_id)
from public.feedback_survey_links fsl
join public.shows s on s.id = fsl.show_id
where r.survey_link_id = fsl.id
  and (
    (r.client_id is null and coalesce(fsl.client_id, s.business_client_id) is not null)
    or (r.client_contact_id is null and coalesce(fsl.client_contact_id, s.client_contact_id) is not null)
  );

-- Backfill already-submitted per-tech ratings.
update public.feedback_tech_ratings ftr
set
  client_id = coalesce(ftr.client_id, r.client_id, fsl.client_id, s.business_client_id),
  client_contact_id = coalesce(ftr.client_contact_id, r.client_contact_id, fsl.client_contact_id, s.client_contact_id)
from public.client_feedback_responses r
join public.feedback_survey_links fsl on fsl.id = r.survey_link_id
join public.shows s on s.id = r.show_id
where ftr.response_id = r.id
  and (
    (ftr.client_id is null and coalesce(r.client_id, fsl.client_id, s.business_client_id) is not null)
    or (ftr.client_contact_id is null and coalesce(r.client_contact_id, fsl.client_contact_id, s.client_contact_id) is not null)
  );

create index if not exists client_feedback_responses_excluded_from_ratings_idx
  on public.client_feedback_responses(excluded_from_ratings);

create index if not exists feedback_tech_ratings_response_id_idx
  on public.feedback_tech_ratings(response_id);

create index if not exists feedback_tech_ratings_crew_id_idx
  on public.feedback_tech_ratings(crew_id);

create index if not exists feedback_tech_ratings_client_id_idx
  on public.feedback_tech_ratings(client_id);

create index if not exists feedback_tech_ratings_client_contact_id_idx
  on public.feedback_tech_ratings(client_contact_id);

-- Clean client feedback tech rating rows used by app pages.
drop view if exists public.client_contact_top_techs;
drop view if exists public.client_top_techs;
drop view if exists public.crew_rating_summary;
drop view if exists public.client_feedback_top_tech_ratings;
drop view if exists public.business_client_feedback_summary;

create or replace view public.client_feedback_top_tech_ratings as
select
  ftr.id,
  ftr.show_id,
  ftr.client_id,
  ftr.client_contact_id,
  ftr.crew_id,
  ftr.assignment_id,
  ftr.rating,
  ftr.notes,
  ftr.submitted_at as created_at,
  ftr.submitted_at as updated_at,
  'client_feedback'::text as rating_source
from public.feedback_tech_ratings ftr
join public.client_feedback_responses r
  on r.id = ftr.response_id
where coalesce(r.excluded_from_ratings, false) = false;

create or replace view public.business_client_feedback_summary as
select
  r.client_id,
  bc.name as business_client_name,
  s.question_key,
  s.question_label,
  round(avg(s.rating)::numeric, 2) as average_rating,
  round((percentile_cont(0.5) within group (order by s.rating))::numeric, 2) as median_rating,
  count(*)::integer as response_count,
  max(r.submitted_at) as last_submitted_at
from public.client_feedback_responses r
join public.client_feedback_scores s
  on s.response_id = r.id
left join public.business_clients bc
  on bc.id = r.client_id
where r.client_id is not null
  and s.rating is not null
  and coalesce(r.excluded_from_ratings, false) = false
group by
  r.client_id,
  bc.name,
  s.question_key,
  s.question_label;

create or replace view public.client_top_techs as
with all_ratings as (
  select
    client_id,
    client_contact_id,
    crew_id,
    rating,
    coalesce(updated_at, created_at) as rating_at
  from public.tech_ratings
  where client_id is not null
    and rating is not null

  union all

  select
    ftr.client_id,
    ftr.client_contact_id,
    ftr.crew_id,
    ftr.rating,
    ftr.submitted_at as rating_at
  from public.feedback_tech_ratings ftr
  join public.client_feedback_responses r
    on r.id = ftr.response_id
  where ftr.client_id is not null
    and ftr.rating is not null
    and coalesce(r.excluded_from_ratings, false) = false
)
select
  ar.client_id,
  ar.crew_id,
  c.name as crew_name,
  c.phone,
  c.email,
  round((percentile_cont(0.5) within group (order by ar.rating))::numeric, 2) as median_rating,
  round(avg(ar.rating)::numeric, 2) as average_rating,
  count(*)::integer as rating_count,
  max(ar.rating_at) as last_rating_at
from all_ratings ar
join public.crew c
  on c.id = ar.crew_id
group by
  ar.client_id,
  ar.crew_id,
  c.name,
  c.phone,
  c.email;

create or replace view public.client_contact_top_techs as
with all_ratings as (
  select
    client_id,
    client_contact_id,
    crew_id,
    rating,
    coalesce(updated_at, created_at) as rating_at
  from public.tech_ratings
  where client_contact_id is not null
    and rating is not null

  union all

  select
    ftr.client_id,
    ftr.client_contact_id,
    ftr.crew_id,
    ftr.rating,
    ftr.submitted_at as rating_at
  from public.feedback_tech_ratings ftr
  join public.client_feedback_responses r
    on r.id = ftr.response_id
  where ftr.client_contact_id is not null
    and ftr.rating is not null
    and coalesce(r.excluded_from_ratings, false) = false
)
select
  ar.client_id,
  ar.client_contact_id,
  cc.name as client_contact_name,
  ar.crew_id,
  c.name as crew_name,
  c.phone,
  c.email,
  round((percentile_cont(0.5) within group (order by ar.rating))::numeric, 2) as median_rating,
  round(avg(ar.rating)::numeric, 2) as average_rating,
  count(*)::integer as rating_count,
  max(ar.rating_at) as last_rating_at
from all_ratings ar
join public.crew c
  on c.id = ar.crew_id
join public.client_contacts cc
  on cc.id = ar.client_contact_id
group by
  ar.client_id,
  ar.client_contact_id,
  cc.name,
  ar.crew_id,
  c.name,
  c.phone,
  c.email;

-- This is the crew/contact-level rating summary.
-- It now includes accepted client feedback ratings, not only internal/admin ratings.
create or replace view public.crew_rating_summary as
with all_ratings as (
  select
    crew_id,
    rating,
    coalesce(updated_at, created_at) as rating_at
  from public.tech_ratings
  where rating is not null

  union all

  select
    ftr.crew_id,
    ftr.rating,
    ftr.submitted_at as rating_at
  from public.feedback_tech_ratings ftr
  join public.client_feedback_responses r
    on r.id = ftr.response_id
  where ftr.rating is not null
    and coalesce(r.excluded_from_ratings, false) = false
)
select
  ar.crew_id,
  c.name as crew_name,
  c.phone,
  c.email,
  round(avg(ar.rating)::numeric, 2) as average_rating,
  round((percentile_cont(0.5) within group (order by ar.rating))::numeric, 2) as median_rating,
  count(*)::integer as rating_count,
  max(ar.rating_at) as last_rating_at
from all_ratings ar
join public.crew c
  on c.id = ar.crew_id
group by
  ar.crew_id,
  c.name,
  c.phone,
  c.email;

notify pgrst, 'reload schema';

select
  'feedback_ratings_apply_to_crew_contacts_ready' as status,
  count(*) as submitted_tech_ratings,
  count(*) filter (where client_id is not null) as linked_to_business_client,
  count(*) filter (where client_contact_id is not null) as linked_to_project_manager_contact
from public.feedback_tech_ratings;
