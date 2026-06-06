-- ELS126/ELS127 feedback survey form-kind compatibility fix
-- Run this once in Supabase SQL Editor if the app shows:
-- new row for relation "feedback_survey_links" violates check constraint "feedback_survey_links_form_kind_check"

alter table if exists public.feedback_survey_links
  drop constraint if exists feedback_survey_links_form_kind_check;

alter table if exists public.feedback_survey_links
  add constraint feedback_survey_links_form_kind_check
  check (form_kind in ('project-manager', 'area-manager', 'crew-lead', 'labor-coordinator'));

-- Submitted responses use the same form_kind values. Older databases may also have
-- a check constraint here; these drops are safe even when the constraint names differ.
alter table if exists public.client_feedback_responses
  drop constraint if exists client_feedback_responses_form_kind_check;

alter table if exists public.client_feedback_responses
  drop constraint if exists feedback_responses_form_kind_check;

alter table if exists public.client_feedback_responses
  add constraint client_feedback_responses_form_kind_check
  check (form_kind in ('project-manager', 'area-manager', 'crew-lead', 'labor-coordinator'));
