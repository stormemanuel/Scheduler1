-- ELS127 required migrations
-- Run this whole file once in Supabase SQL Editor after deploying ELS127.


-- 0) Event client/coordinator columns required by the Events page
-- These keep event creation from failing when newer event fields are present in the app.
alter table if exists public.shows
  add column if not exists business_client_id uuid;

alter table if exists public.shows
  add column if not exists client_contact_id uuid;

alter table if exists public.shows
  add column if not exists coordinator_contact_id uuid;

alter table if exists public.shows
  add column if not exists assigned_coordinator_user_id uuid;

alter table if exists public.shows
  add column if not exists created_by uuid;

create index if not exists shows_business_client_id_idx on public.shows(business_client_id);
create index if not exists shows_client_contact_id_idx on public.shows(client_contact_id);
create index if not exists shows_coordinator_contact_id_idx on public.shows(coordinator_contact_id);
create index if not exists shows_assigned_coordinator_user_id_idx on public.shows(assigned_coordinator_user_id);
create index if not exists shows_created_by_idx on public.shows(created_by);

-- Ask Supabase/PostgREST to refresh the schema cache after adding columns.
notify pgrst, 'reload schema';

-- 1) Feedback survey form-kind compatibility fix
alter table if exists public.feedback_survey_links
  drop constraint if exists feedback_survey_links_form_kind_check;

alter table if exists public.feedback_survey_links
  add constraint feedback_survey_links_form_kind_check
  check (form_kind in ('project-manager', 'area-manager', 'crew-lead', 'labor-coordinator'));

alter table if exists public.client_feedback_responses
  drop constraint if exists client_feedback_responses_form_kind_check;

alter table if exists public.client_feedback_responses
  drop constraint if exists feedback_responses_form_kind_check;

alter table if exists public.client_feedback_responses
  add constraint client_feedback_responses_form_kind_check
  check (form_kind in ('project-manager', 'area-manager', 'crew-lead', 'labor-coordinator'));

-- 2) Itemized event expenses for Payroll P&L
create table if not exists public.show_expense_items (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  category text not null,
  description text,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  tax_treatment text not null default 'Likely deductible if ordinary and necessary',
  receipt_status text not null default 'Receipt needed',
  expense_date date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists show_expense_items_show_id_idx on public.show_expense_items(show_id);
create index if not exists show_expense_items_category_idx on public.show_expense_items(category);

alter table if exists public.show_expense_items enable row level security;

drop policy if exists "show_expense_items_select_authenticated" on public.show_expense_items;
create policy "show_expense_items_select_authenticated" on public.show_expense_items
  for select to authenticated using (true);

drop policy if exists "show_expense_items_insert_authenticated" on public.show_expense_items;
create policy "show_expense_items_insert_authenticated" on public.show_expense_items
  for insert to authenticated with check (true);

drop policy if exists "show_expense_items_update_authenticated" on public.show_expense_items;
create policy "show_expense_items_update_authenticated" on public.show_expense_items
  for update to authenticated using (true) with check (true);

drop policy if exists "show_expense_items_delete_authenticated" on public.show_expense_items;
create policy "show_expense_items_delete_authenticated" on public.show_expense_items
  for delete to authenticated using (true);

create table if not exists public.show_financials (
  show_id uuid primary key references public.shows(id) on delete cascade,
  estimated_revenue_override numeric(12,2),
  expenses numeric(12,2) not null default 0,
  notes text,
  tax_reserve_done boolean not null default false,
  tax_reserve_done_at timestamptz,
  consecrated_hands_done boolean not null default false,
  consecrated_hands_done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.show_financials add column if not exists tax_reserve_done boolean not null default false;
alter table if exists public.show_financials add column if not exists tax_reserve_done_at timestamptz;
alter table if exists public.show_financials add column if not exists consecrated_hands_done boolean not null default false;
alter table if exists public.show_financials add column if not exists consecrated_hands_done_at timestamptz;

-- 3) Coordinator crew safeguards and soft-delete from coordinator view
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

-- 4) Sender-bound text queues.
-- This lets each logged-in user queue messages that only their own iPhone Shortcut URL pulls.
alter table if exists public.text_message_queue
  add column if not exists queued_by_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.text_message_queue
  add column if not exists queued_by_email text;

alter table if exists public.text_message_queue
  add column if not exists queued_by_name text;

create index if not exists text_message_queue_queued_by_user_id_idx on public.text_message_queue(queued_by_user_id);
create index if not exists text_message_queue_status_sender_idx on public.text_message_queue(status, queued_by_user_id, scheduled_for);

create table if not exists public.crew_intro_text_queue (
  id uuid primary key default gen_random_uuid(),
  crew_id uuid,
  crew_name text,
  phone text,
  body text,
  status text not null default 'scheduled',
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  queued_by_user_id uuid references auth.users(id) on delete set null,
  queued_by_email text,
  queued_by_name text,
  created_at timestamptz not null default now()
);

alter table if exists public.crew_intro_text_queue
  add column if not exists queued_by_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.crew_intro_text_queue
  add column if not exists queued_by_email text;

alter table if exists public.crew_intro_text_queue
  add column if not exists queued_by_name text;

create index if not exists crew_intro_text_queue_queued_by_user_id_idx on public.crew_intro_text_queue(queued_by_user_id);
create index if not exists crew_intro_text_queue_status_sender_idx on public.crew_intro_text_queue(status, queued_by_user_id, scheduled_for);

-- 5) Payroll paid/unpaid tracking + scheduled-for date
-- Creates the table if older deployments do not already have it, then adds the scheduled_for column.
create table if not exists public.show_payroll (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  role_name text not null default 'Payroll Status',
  pay_type text not null default 'Regular',
  paid boolean not null default false,
  payout_override numeric(12,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(show_id, crew_id, role_name)
);

create index if not exists show_payroll_show_id_idx on public.show_payroll(show_id);
create index if not exists show_payroll_crew_id_idx on public.show_payroll(crew_id);

-- Lets Payroll track a scheduled payment date per tech/show, with event-wide apply in the app.
alter table if exists public.show_payroll
  add column if not exists scheduled_for date;

create index if not exists show_payroll_scheduled_for_idx on public.show_payroll(scheduled_for);

-- 6) Payroll payment status dropdown: Unpaid (default), Scheduled, Paid
alter table if exists public.show_payroll
  add column if not exists payment_status text not null default 'unpaid';

update public.show_payroll
set payment_status = case
  when paid = true then 'paid'
  when scheduled_for is not null then 'scheduled'
  else 'unpaid'
end
where payment_status is null or payment_status not in ('unpaid', 'scheduled', 'paid');

alter table if exists public.show_payroll
  drop constraint if exists show_payroll_payment_status_check;

alter table if exists public.show_payroll
  add constraint show_payroll_payment_status_check
  check (payment_status in ('unpaid', 'scheduled', 'paid'));

create index if not exists show_payroll_payment_status_idx on public.show_payroll(payment_status);

-- 7) ELS128/129 event coordinator assignment columns
alter table if exists public.shows
  add column if not exists business_client_id uuid;

alter table if exists public.shows
  add column if not exists client_contact_id uuid;

alter table if exists public.shows
  add column if not exists coordinator_contact_id uuid;

alter table if exists public.shows
  add column if not exists assigned_coordinator_user_id uuid references auth.users(id) on delete set null;

alter table if exists public.shows
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists shows_business_client_id_idx on public.shows(business_client_id);
create index if not exists shows_client_contact_id_idx on public.shows(client_contact_id);
create index if not exists shows_coordinator_contact_id_idx on public.shows(coordinator_contact_id);
create index if not exists shows_assigned_coordinator_user_id_idx on public.shows(assigned_coordinator_user_id);
create index if not exists shows_created_by_idx on public.shows(created_by);

-- 8) Coordinator payroll tracking using the 1-20 full-day fee schedule and half-day fee schedule in the coordinator agreement.
create table if not exists public.coordinator_payroll (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  coordinator_user_id uuid not null references auth.users(id) on delete cascade,
  paid boolean not null default false,
  payment_status text not null default 'unpaid',
  payout_override numeric(12,2),
  scheduled_for date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(show_id, coordinator_user_id)
);

alter table if exists public.coordinator_payroll
  add column if not exists payment_status text not null default 'unpaid';

alter table if exists public.coordinator_payroll
  add column if not exists scheduled_for date;

alter table if exists public.coordinator_payroll
  add column if not exists payout_override numeric(12,2);

alter table if exists public.coordinator_payroll
  add column if not exists notes text;

update public.coordinator_payroll
set payment_status = case
  when paid = true then 'paid'
  when scheduled_for is not null then 'scheduled'
  else 'unpaid'
end
where payment_status is null or payment_status not in ('unpaid', 'scheduled', 'paid');

alter table if exists public.coordinator_payroll
  drop constraint if exists coordinator_payroll_payment_status_check;

alter table if exists public.coordinator_payroll
  add constraint coordinator_payroll_payment_status_check
  check (payment_status in ('unpaid', 'scheduled', 'paid'));

create index if not exists coordinator_payroll_show_id_idx on public.coordinator_payroll(show_id);
create index if not exists coordinator_payroll_user_id_idx on public.coordinator_payroll(coordinator_user_id);
create index if not exists coordinator_payroll_status_idx on public.coordinator_payroll(payment_status);
create index if not exists coordinator_payroll_scheduled_for_idx on public.coordinator_payroll(scheduled_for);

-- 9) Add the Coordinator page to common access defaults where allowed_pages is already being used.
do $$
begin
  if to_regclass('public.user_access_settings') is not null and to_regclass('public.profiles') is not null then
    update public.user_access_settings
    set allowed_pages = case
      when allowed_pages is null then allowed_pages
      when 'coordinator' = any(allowed_pages) then allowed_pages
      else array_append(allowed_pages, 'coordinator')
    end
    where allowed_pages is not null
      and exists (
        select 1 from public.profiles p
        where p.id = user_access_settings.user_id
          and lower(coalesce(p.role, '')) in ('owner', 'admin', 'coordinator')
      );
  end if;
end $$;

notify pgrst, 'reload schema';

-- 10) ELS130 sub-call purchase order tracking
alter table if exists public.sub_calls
  add column if not exists po_number text;

create index if not exists sub_calls_po_number_idx on public.sub_calls(po_number);

notify pgrst, 'reload schema';

-- ELS131 event coordinator assignment compatibility
-- Some deployments have event_user_access.user_profile_id as NOT NULL.
-- Keep user_id and user_profile_id aligned so assigned coordinator access saves cleanly.
create table if not exists public.event_user_access (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows(id) on delete cascade,
  user_id uuid,
  user_profile_id uuid,
  access_role text not null default 'coordinator',
  granted_by uuid,
  created_at timestamptz not null default now()
);

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
set user_profile_id = user_id
where user_profile_id is null and user_id is not null;

update public.event_user_access
set user_id = user_profile_id
where user_id is null and user_profile_id is not null;

create index if not exists event_user_access_show_id_idx on public.event_user_access(show_id);
create index if not exists event_user_access_user_id_idx on public.event_user_access(user_id);
create index if not exists event_user_access_user_profile_id_idx on public.event_user_access(user_profile_id);

notify pgrst, 'reload schema';
