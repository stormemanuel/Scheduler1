-- ELS51 connected client feedback surveys with submitted-response review and rating exclusion
-- Creates secure public survey links, records client ratings of ELS, records tech ratings from clients,
-- and exposes client-facing tech feedback for Top Techs/recommendations.
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.feedback_survey_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  show_id uuid not null references public.shows(id) on delete cascade,
  client_id uuid references public.business_clients(id) on delete set null,
  client_contact_id uuid references public.client_contacts(id) on delete set null,
  form_kind text not null check (form_kind in ('project-manager', 'area-manager')),
  area_name text,
  title text not null,
  target_label text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (show_id, form_kind, area_name)
);

create table if not exists public.client_feedback_responses (
  id uuid primary key default gen_random_uuid(),
  survey_link_id uuid not null references public.feedback_survey_links(id) on delete cascade,
  show_id uuid not null references public.shows(id) on delete cascade,
  client_id uuid references public.business_clients(id) on delete set null,
  client_contact_id uuid references public.client_contacts(id) on delete set null,
  form_kind text not null check (form_kind in ('project-manager', 'area-manager')),
  area_name text,
  respondent_name text,
  respondent_title text,
  respondent_email text,
  request_again text,
  testimonial_permission text,
  testimonial_text text,
  went_well text,
  follow_up text,
  additional_comments text,
  submitted_at timestamptz not null default now()
);

alter table public.client_feedback_responses
  add column if not exists excluded_from_ratings boolean not null default false;

alter table public.client_feedback_responses
  add column if not exists excluded_reason text;

alter table public.client_feedback_responses
  add column if not exists excluded_at timestamptz;

create table if not exists public.client_feedback_scores (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.client_feedback_responses(id) on delete cascade,
  question_key text not null,
  question_label text not null,
  rating integer check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique (response_id, question_key)
);

create table if not exists public.feedback_tech_ratings (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.client_feedback_responses(id) on delete cascade,
  survey_link_id uuid not null references public.feedback_survey_links(id) on delete cascade,
  show_id uuid not null references public.shows(id) on delete cascade,
  client_id uuid references public.business_clients(id) on delete set null,
  client_contact_id uuid references public.client_contacts(id) on delete set null,
  crew_id uuid not null references public.crew(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  area_name text,
  rating integer not null check (rating between 1 and 5),
  request_again text,
  notes text,
  submitted_at timestamptz not null default now()
);

alter table public.feedback_survey_links enable row level security;
alter table public.client_feedback_responses enable row level security;
alter table public.client_feedback_scores enable row level security;
alter table public.feedback_tech_ratings enable row level security;

drop policy if exists "feedback_survey_links_authenticated_all" on public.feedback_survey_links;
create policy "feedback_survey_links_authenticated_all"
  on public.feedback_survey_links
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "client_feedback_responses_authenticated_all" on public.client_feedback_responses;
create policy "client_feedback_responses_authenticated_all"
  on public.client_feedback_responses
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "client_feedback_scores_authenticated_all" on public.client_feedback_scores;
create policy "client_feedback_scores_authenticated_all"
  on public.client_feedback_scores
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "feedback_tech_ratings_authenticated_all" on public.feedback_tech_ratings;
create policy "feedback_tech_ratings_authenticated_all"
  on public.feedback_tech_ratings
  for all
  to authenticated
  using (true)
  with check (true);

create index if not exists feedback_survey_links_token_idx on public.feedback_survey_links(token);
create index if not exists feedback_survey_links_show_id_idx on public.feedback_survey_links(show_id);
create index if not exists client_feedback_responses_client_id_idx on public.client_feedback_responses(client_id);
create index if not exists client_feedback_responses_show_id_idx on public.client_feedback_responses(show_id);
create index if not exists client_feedback_responses_excluded_from_ratings_idx on public.client_feedback_responses(excluded_from_ratings);
create index if not exists client_feedback_scores_response_id_idx on public.client_feedback_scores(response_id);
create index if not exists feedback_tech_ratings_client_id_idx on public.feedback_tech_ratings(client_id);
create index if not exists feedback_tech_ratings_client_contact_id_idx on public.feedback_tech_ratings(client_contact_id);
create index if not exists feedback_tech_ratings_crew_id_idx on public.feedback_tech_ratings(crew_id);
create index if not exists feedback_tech_ratings_show_id_idx on public.feedback_tech_ratings(show_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_feedback_survey_links_updated_at on public.feedback_survey_links;
create trigger set_feedback_survey_links_updated_at
before update on public.feedback_survey_links
for each row
execute function public.set_updated_at();

-- Business/client rating summary of ELS service quality.
drop view if exists public.business_client_feedback_summary;
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
join public.client_feedback_scores s on s.response_id = r.id
left join public.business_clients bc on bc.id = r.client_id
where r.client_id is not null
  and s.rating is not null
  and coalesce(r.excluded_from_ratings, false) = false
group by r.client_id, bc.name, s.question_key, s.question_label;

-- Client-submitted tech feedback in the same shape used by Top Techs logic.
drop view if exists public.client_feedback_top_tech_ratings;
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
join public.client_feedback_responses r on r.id = ftr.response_id
where coalesce(r.excluded_from_ratings, false) = false;

-- Median Top Techs now includes both admin show ratings and non-excluded submitted client feedback ratings.
drop view if exists public.client_contact_top_techs;
drop view if exists public.client_top_techs;

create or replace view public.client_top_techs as
with all_ratings as (
  select client_id, client_contact_id, crew_id, rating, coalesce(updated_at, created_at) as rating_at
  from public.tech_ratings
  where client_id is not null and rating is not null
  union all
  select ftr.client_id, ftr.client_contact_id, ftr.crew_id, ftr.rating, ftr.submitted_at as rating_at
  from public.feedback_tech_ratings ftr
  join public.client_feedback_responses r on r.id = ftr.response_id
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
join public.crew c on c.id = ar.crew_id
group by ar.client_id, ar.crew_id, c.name, c.phone, c.email;

create or replace view public.client_contact_top_techs as
with all_ratings as (
  select client_id, client_contact_id, crew_id, rating, coalesce(updated_at, created_at) as rating_at
  from public.tech_ratings
  where client_contact_id is not null and rating is not null
  union all
  select ftr.client_id, ftr.client_contact_id, ftr.crew_id, ftr.rating, ftr.submitted_at as rating_at
  from public.feedback_tech_ratings ftr
  join public.client_feedback_responses r on r.id = ftr.response_id
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
join public.crew c on c.id = ar.crew_id
join public.client_contacts cc on cc.id = ar.client_contact_id
group by ar.client_id, ar.client_contact_id, cc.name, ar.crew_id, c.name, c.phone, c.email;

notify pgrst, 'reload schema';

select 'connected_feedback_review_and_rating_exclusion_ready' as status;
