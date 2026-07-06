export type PipelineStage =
  | "Inquiry"
  | "Estimating"
  | "Quote Sent"
  | "Verbal Yes"
  | "Confirmed"
  | "Lost"
  | "Archived";

export type PipelineRecord = {
  id: string;
  event_name: string;
  client_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  venue: string;
  city: string;
  show_start: string | null;
  show_end: string | null;
  stage: PipelineStage;
  estimated_revenue: number;
  probability: number;
  next_follow_up: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};
