-- ELS148 required migrations
-- Coordinator pool views, city-pool access controls, and coordinator-safe crew retention.

-- Keep coordinator/admin assignment support on shows.
alter table if exists public.shows
  add column if not exists assigned_coordinator_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.shows
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists shows_assigned_coordinator_user_id_idx on public.shows(assigned_coordinator_user_id);
create index if not exists shows_created_by_idx on public.shows(created_by);

-- Crew ownership and coordinator soft-delete tracking.
alter table if exists public.crew
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table if exists public.crew
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.crew
  add column if not exists updated_at timestamptz;

alter table if exists public.crew
  add column if not exists coordinator_hidden_at timestamptz;

alter table if exists public.crew
  add column if not exists coordinator_hidden_by uuid references auth.users(id) on delete set null;

create index if not exists crew_created_by_idx on public.crew(created_by);
create index if not exists crew_coordinator_hidden_by_idx on public.crew(coordinator_hidden_by);


-- Crew groups for coordinator-safe organization.
create table if not exists public.crew_groups (
  id uuid primary key default gen_random_uuid(),
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique(city_pool_id, name)
);

create index if not exists crew_groups_city_pool_id_idx on public.crew_groups(city_pool_id);

-- Multiple city/pool membership for one crew record.
create table if not exists public.crew_city_pools (
  crew_id uuid not null references public.crew(id) on delete cascade,
  city_pool_id uuid not null references public.city_pools(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (crew_id, city_pool_id)
);

create index if not exists crew_city_pools_crew_id_idx on public.crew_city_pools(crew_id);
create index if not exists crew_city_pools_city_pool_id_idx on public.crew_city_pools(city_pool_id);

-- Coordinator account pool visibility.
create table if not exists public.user_access_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  allowed_pages text[],
  restrict_events_to_owner boolean not null default true,
  restrict_crew_to_owner boolean not null default true,
  allowed_city_pool_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.user_access_settings
  add column if not exists allowed_city_pool_ids text[] not null default '{}';

alter table if exists public.user_access_settings
  add column if not exists restrict_crew_to_owner boolean not null default true;

alter table if exists public.user_access_settings
  add column if not exists restrict_events_to_owner boolean not null default true;

alter table if exists public.user_access_settings
  add column if not exists updated_at timestamptz not null default now();

-- Sub-call purchase order support from ELS130.
alter table if exists public.sub_calls
  add column if not exists po_number text;

create index if not exists sub_calls_po_number_idx on public.sub_calls(po_number);

-- Event access compatibility from ELS133.
alter table if exists public.event_user_access
  drop constraint if exists event_user_access_user_profile_id_fkey;

alter table if exists public.event_user_access
  alter column user_profile_id drop not null;

alter table if exists public.event_user_access
  add column if not exists user_id uuid;

alter table if exists public.event_user_access
  add column if not exists user_profile_id uuid;

alter table if exists public.event_user_access
  add column if not exists access_role text not null default 'coordinator';

alter table if exists public.event_user_access
  add column if not exists granted_by uuid;

alter table if exists public.event_user_access
  add column if not exists created_at timestamptz not null default now();

update public.event_user_access
set user_id = user_profile_id
where user_id is null and user_profile_id is not null;

create index if not exists event_user_access_show_id_idx on public.event_user_access(show_id);
create index if not exists event_user_access_user_id_idx on public.event_user_access(user_id);
create index if not exists event_user_access_user_profile_id_idx on public.event_user_access(user_profile_id);

notify pgrst, 'reload schema';

-- Client directory/contact compatibility for adding contacts safely.
create table if not exists public.business_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_company_name text,
  billing_address text,
  billing_city text,
  billing_state text,
  billing_zip text,
  main_phone text,
  main_email text,
  website text,
  default_rate_city text not null default 'Default',
  default_market_notes text,
  notes text,
  ap_contact_name text,
  ap_email text,
  ap_phone text,
  payment_terms text,
  po_required boolean,
  w9_coi_notes text,
  default_invoice_email text,
  billing_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table if exists public.business_clients add column if not exists legal_company_name text;
alter table if exists public.business_clients add column if not exists billing_address text;
alter table if exists public.business_clients add column if not exists billing_city text;
alter table if exists public.business_clients add column if not exists billing_state text;
alter table if exists public.business_clients add column if not exists billing_zip text;
alter table if exists public.business_clients add column if not exists main_phone text;
alter table if exists public.business_clients add column if not exists main_email text;
alter table if exists public.business_clients add column if not exists website text;
alter table if exists public.business_clients add column if not exists default_rate_city text not null default 'Default';
alter table if exists public.business_clients add column if not exists default_market_notes text;
alter table if exists public.business_clients add column if not exists notes text;
alter table if exists public.business_clients add column if not exists ap_contact_name text;
alter table if exists public.business_clients add column if not exists ap_email text;
alter table if exists public.business_clients add column if not exists ap_phone text;
alter table if exists public.business_clients add column if not exists payment_terms text;
alter table if exists public.business_clients add column if not exists po_required boolean;
alter table if exists public.business_clients add column if not exists w9_coi_notes text;
alter table if exists public.business_clients add column if not exists default_invoice_email text;
alter table if exists public.business_clients add column if not exists billing_notes text;
alter table if exists public.business_clients add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table if exists public.business_clients add column if not exists created_at timestamptz not null default now();
alter table if exists public.business_clients add column if not exists updated_at timestamptz;
create unique index if not exists business_clients_name_key on public.business_clients(name);
create index if not exists business_clients_created_by_idx on public.business_clients(created_by);

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.business_clients(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  cell_phone text,
  notes text,
  contact_type text not null default 'labor-coordinator',
  created_by uuid references auth.users(id) on delete set null,
  is_primary boolean not null default false,
  is_onsite_contact boolean not null default false,
  is_billing_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table if exists public.client_contacts add column if not exists title text;
alter table if exists public.client_contacts add column if not exists email text;
alter table if exists public.client_contacts add column if not exists phone text;
alter table if exists public.client_contacts add column if not exists cell_phone text;
alter table if exists public.client_contacts add column if not exists notes text;
alter table if exists public.client_contacts add column if not exists contact_type text not null default 'labor-coordinator';
alter table if exists public.client_contacts add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table if exists public.client_contacts add column if not exists is_primary boolean not null default false;
alter table if exists public.client_contacts add column if not exists is_onsite_contact boolean not null default false;
alter table if exists public.client_contacts add column if not exists is_billing_contact boolean not null default false;
alter table if exists public.client_contacts add column if not exists created_at timestamptz not null default now();
alter table if exists public.client_contacts add column if not exists updated_at timestamptz;

alter table if exists public.client_contacts
  drop constraint if exists client_contacts_contact_type_check;

alter table if exists public.client_contacts
  add constraint client_contacts_contact_type_check
  check (contact_type in ('labor-coordinator', 'project-manager', 'booth-manager', 'client-tech'));

create index if not exists client_contacts_client_id_idx on public.client_contacts(client_id);
create index if not exists client_contacts_created_by_idx on public.client_contacts(created_by);

notify pgrst, 'reload schema';

-- ELS147 feedback survey roster overrides.
-- Lets admin/owner add a crew member who worked anywhere on a show to a specific booth/sub-call feedback survey roster
-- without duplicating the payroll/schedule assignment.
create table if not exists public.feedback_survey_roster_overrides (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  sub_call_id uuid references public.sub_calls(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

alter table if exists public.feedback_survey_roster_overrides
  add column if not exists show_id uuid references public.shows(id) on delete cascade;

alter table if exists public.feedback_survey_roster_overrides
  add column if not exists sub_call_id uuid references public.sub_calls(id) on delete cascade;

alter table if exists public.feedback_survey_roster_overrides
  add column if not exists crew_id uuid references public.crew(id) on delete cascade;

alter table if exists public.feedback_survey_roster_overrides
  add column if not exists added_by uuid references auth.users(id) on delete set null;

alter table if exists public.feedback_survey_roster_overrides
  add column if not exists reason text;

alter table if exists public.feedback_survey_roster_overrides
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'feedback_survey_roster_overrides_unique_roster_member'
      and conrelid = 'public.feedback_survey_roster_overrides'::regclass
  ) then
    alter table public.feedback_survey_roster_overrides
      add constraint feedback_survey_roster_overrides_unique_roster_member
      unique (show_id, sub_call_id, crew_id);
  end if;
end $$;

create index if not exists feedback_survey_roster_overrides_show_id_idx
  on public.feedback_survey_roster_overrides(show_id);

create index if not exists feedback_survey_roster_overrides_sub_call_id_idx
  on public.feedback_survey_roster_overrides(sub_call_id);

create index if not exists feedback_survey_roster_overrides_crew_id_idx
  on public.feedback_survey_roster_overrides(crew_id);

create index if not exists feedback_survey_roster_overrides_added_by_idx
  on public.feedback_survey_roster_overrides(added_by);

notify pgrst, 'reload schema';

-- ELS148 feedback survey roster exclusions.
-- Lets owner/admin remove a crew member from a specific Project Manager or Booth/Area Manager rating list
-- without changing payroll, schedule assignments, or Master Pool records.
create table if not exists public.feedback_survey_roster_exclusions (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  form_kind text not null,
  area_name text,
  crew_id uuid not null references public.crew(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

alter table if exists public.feedback_survey_roster_exclusions
  add column if not exists show_id uuid references public.shows(id) on delete cascade;

alter table if exists public.feedback_survey_roster_exclusions
  add column if not exists form_kind text not null default 'project-manager';

alter table if exists public.feedback_survey_roster_exclusions
  add column if not exists area_name text;

alter table if exists public.feedback_survey_roster_exclusions
  add column if not exists crew_id uuid references public.crew(id) on delete cascade;

alter table if exists public.feedback_survey_roster_exclusions
  add column if not exists added_by uuid references auth.users(id) on delete set null;

alter table if exists public.feedback_survey_roster_exclusions
  add column if not exists reason text;

alter table if exists public.feedback_survey_roster_exclusions
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.feedback_survey_roster_exclusions
  drop constraint if exists feedback_survey_roster_exclusions_form_kind_check;

alter table if exists public.feedback_survey_roster_exclusions
  add constraint feedback_survey_roster_exclusions_form_kind_check
  check (form_kind in ('project-manager', 'area-manager', 'crew-lead', 'labor-coordinator'));

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'feedback_survey_roster_exclusions_unique_roster_member_idx'
  ) then
    create unique index feedback_survey_roster_exclusions_unique_roster_member_idx
      on public.feedback_survey_roster_exclusions(show_id, form_kind, coalesce(area_name, ''), crew_id);
  end if;
end $$;

create index if not exists feedback_survey_roster_exclusions_show_id_idx
  on public.feedback_survey_roster_exclusions(show_id);

create index if not exists feedback_survey_roster_exclusions_crew_id_idx
  on public.feedback_survey_roster_exclusions(crew_id);

create index if not exists feedback_survey_roster_exclusions_form_kind_idx
  on public.feedback_survey_roster_exclusions(form_kind);

-- ELS148 client contact view fix.
-- If Booth Manager contacts save but do not appear under Booth Managers view, this makes sure
-- the contact_type column and check constraint support that view.
alter table if exists public.client_contacts
  add column if not exists contact_type text not null default 'labor-coordinator';

alter table if exists public.client_contacts
  drop constraint if exists client_contacts_contact_type_check;

alter table if exists public.client_contacts
  add constraint client_contacts_contact_type_check
  check (contact_type in ('labor-coordinator', 'project-manager', 'booth-manager', 'client-tech'));

update public.client_contacts
set contact_type = 'booth-manager'
where coalesce(contact_type, '') not in ('labor-coordinator', 'project-manager', 'booth-manager', 'client-tech')
  and lower(coalesce(title, '')) like '%booth%';

update public.client_contacts
set contact_type = 'project-manager'
where coalesce(contact_type, '') not in ('labor-coordinator', 'project-manager', 'booth-manager', 'client-tech')
  and (lower(coalesce(title, '')) like '%project manager%' or lower(coalesce(title, '')) in ('pm', 'producer'));

update public.client_contacts
set contact_type = 'client-tech'
where coalesce(contact_type, '') not in ('labor-coordinator', 'project-manager', 'booth-manager', 'client-tech')
  and (lower(coalesce(title, '')) like '%tech%' or lower(coalesce(title, '')) like '%technician%' or lower(coalesce(title, '')) like '%engineer%');

update public.client_contacts
set contact_type = 'labor-coordinator'
where coalesce(contact_type, '') not in ('labor-coordinator', 'project-manager', 'booth-manager', 'client-tech');

-- RLS-compatible read policies for client contacts when Supabase RLS is already enabled.
-- These do not enable RLS by themselves; they only prevent "saved but hidden" behavior on projects where RLS is active.
do $$
begin
  if to_regclass('public.business_clients') is not null and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_clients' and policyname = 'ELS authenticated users can read allowed business clients'
  ) then
    execute $policy$
      create policy "ELS authenticated users can read allowed business clients"
      on public.business_clients
      for select
      to authenticated
      using (
        created_by = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and lower(coalesce(p.role::text, '')) in ('owner', 'admin')
        )
      )
    $policy$;
  end if;

  if to_regclass('public.client_contacts') is not null and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_contacts' and policyname = 'ELS authenticated users can read allowed client contacts'
  ) then
    execute $policy$
      create policy "ELS authenticated users can read allowed client contacts"
      on public.client_contacts
      for select
      to authenticated
      using (
        created_by = auth.uid()
        or exists (
          select 1 from public.business_clients b
          where b.id = client_contacts.client_id
            and b.created_by = auth.uid()
        )
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and lower(coalesce(p.role::text, '')) in ('owner', 'admin')
        )
      )
    $policy$;
  end if;
end $$;

notify pgrst, 'reload schema';
