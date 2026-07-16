export type ShowRecord = {
  id: string;
  name: string;
  client: string;
  business_client_id: string | null;
  client_contact_id: string | null;
  coordinator_contact_id?: string | null;
  assigned_coordinator_user_id?: string | null;
  venue: string;
  event_location: string;
  rate_city: string;
  show_start: string;
  show_end: string;
  notes: string;
  created_by?: string | null;
  access_scope?: "full" | "partial";
};

export type LaborDayRecord = {
  id: string;
  show_id: string;
  labor_date: string;
  label: string;
  notes: string;
};

export type SubCallRecord = {
  id: string;
  labor_day_id: string;
  area: string;
  location?: string;
  po_number?: string | null;
  area_lead_contact_id?: string | null;
  area_lead_name?: string | null;
  area_lead_phone?: string | null;
  assigned_coordinator_user_id?: string | null;
  role_name: string;
  master_rate_id?: string | null;
  message_rate?: string | null;
  start_time: string;
  end_time: string;
  crew_needed: number;
  notes: string;
  sort_order?: number;
  day_type?: string | null;
  one_hour_walkaway?: boolean;
};

export type AssignmentRecord = {
  id: string;
  sub_call_id: string;
  crew_id: string;
  status: string;
  sort_order: number;
  start_time?: string | null;
  end_time?: string | null;
  day_type?: string | null;
  coordination_owner_user_id?: string | null;
  coordination_owner_name?: string | null;
  coordination_fee_waived?: boolean;
};

export type AssignmentChecklistRecord = {
  id: string;
  show_id: string;
  crew_id: string;
  schedule_sent: boolean;
  confirmed: boolean;
  week_before_confirmed: boolean;
  day_before_confirmed: boolean;
  schedule_sent_at: string | null;
  confirmed_at: string | null;
  week_before_confirmed_at: string | null;
  day_before_confirmed_at: string | null;
  updated_at: string;
};

export type AssignmentNoteRecord = {
  id: string;
  show_id: string;
  crew_member_id: string;
  assignment_id: string | null;
  note_code: string;
  note_label: string;
  custom_note: string;
  visibility: string;
  created_at: string;
};

export type EventChangeRequestRecord = {
  id: string;
  show_id: string;
  requested_by: string | null;
  requester_name: string;
  requester_email: string;
  request_type: "time_change" | "add_day";
  status: "pending" | "approved" | "denied";
  target_labor_day_id: string | null;
  target_sub_call_id: string | null;
  current_start_time: string | null;
  current_end_time: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  requested_labor_date: string | null;
  requested_label: string | null;
  reason: string;
  admin_note: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_labor_day_id: string | null;
  applied_sub_call_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TextSendingMethod = "manual" | "shortcut" | "provider";

export type TextAutomationSettingsRecord = {
  show_id: string;
  enabled: boolean;
  sending_method: TextSendingMethod;
  shortcut_token: string;
  send_availability: boolean;
  send_schedule: boolean;
  reminder_7_day: boolean;
  reminder_3_day: boolean;
  reminder_day_before: boolean;
  reminder_day_of: boolean;
  reminder_daily_after_first_day?: boolean;
  timezone: string;
  availability_template: string;
  schedule_template: string;
  reminder_template: string;
  updated_at: string | null;
};

export type TextMessageQueueRecord = {
  id: string;
  show_id: string;
  crew_id: string | null;
  crew_name: string;
  phone: string;
  message_type: string;
  reminder_key: string;
  scheduled_for: string;
  status: string;
  body: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
  queued_by_user_id?: string | null;
  queued_by_email?: string | null;
  queued_by_name?: string | null;
};

export type CommunicationChecklistStage = "schedule" | "3_day" | "day_before" | "day_of";

export function communicationChecklistStage(row: Pick<TextMessageQueueRecord, "message_type" | "reminder_key">): CommunicationChecklistStage | null {
  const messageType = String(row.message_type || "").trim().toLowerCase();
  const reminderKey = String(row.reminder_key || "").trim().toLowerCase();

  if (messageType === "schedule" || reminderKey === "7_day" || reminderKey.startsWith("manual_7_day")) return "schedule";
  if (reminderKey === "3_day" || reminderKey.startsWith("manual_3_day")) return "3_day";
  if (reminderKey === "day_before" || reminderKey.startsWith("manual_day_before")) return "day_before";
  if (reminderKey === "day_of" || reminderKey.startsWith("manual_day_of") || reminderKey.startsWith("daily_after_first_day") || reminderKey.startsWith("manual_daily_after_first_day")) return "day_of";
  return null;
}

export type EventUserAccessRecord = {
  id: string;
  show_id: string;
  user_id: string;
  user_profile_id?: string | null;
  access_role: string;
  created_at: string;
};

export type ClientFeedbackResponseRecord = {
  id: string;
  survey_link_id: string;
  show_id: string;
  client_id: string | null;
  client_contact_id: string | null;
  form_kind: "project-manager" | "area-manager" | "crew-lead" | "labor-coordinator";
  area_name: string;
  respondent_name: string;
  respondent_title: string;
  respondent_email: string;
  request_again: string;
  testimonial_permission: string;
  testimonial_text: string;
  went_well: string;
  follow_up: string;
  additional_comments: string;
  submitted_at: string;
  rating_approved: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  excluded_from_ratings: boolean;
  excluded_reason: string;
  excluded_at: string | null;
};

export type ClientFeedbackScoreRecord = {
  id: string;
  response_id: string;
  question_key: string;
  question_label: string;
  rating: number | null;
  created_at: string;
};

export type FeedbackTechRatingRecord = {
  id: string;
  response_id: string;
  survey_link_id: string;
  show_id: string;
  client_id: string | null;
  client_contact_id: string | null;
  crew_id: string;
  assignment_id: string | null;
  area_name: string;
  rating: number;
  request_again: string;
  notes: string;
  submitted_at: string;
};
