export type ShowRecord = {
  id: string;
  name: string;
  client: string;
  business_client_id: string | null;
  client_contact_id: string | null;
  venue: string;
  rate_city: string;
  show_start: string;
  show_end: string;
  notes: string;
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
  role_name: string;
  master_rate_id?: string | null;
  start_time: string;
  end_time: string;
  crew_needed: number;
  notes: string;
};

export type AssignmentRecord = {
  id: string;
  sub_call_id: string;
  crew_id: string;
  status: string;
};

export type AssignmentChecklistRecord = {
  id: string;
  show_id: string;
  crew_id: string;
  schedule_sent: boolean;
  confirmed: boolean;
  day_before_confirmed: boolean;
  schedule_sent_at: string | null;
  confirmed_at: string | null;
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
};
