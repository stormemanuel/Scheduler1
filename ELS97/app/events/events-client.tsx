"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { CrewRecord } from "@/lib/crew-types";
import type {
  AssignmentRecord,
  AssignmentChecklistRecord,
  AssignmentNoteRecord,
  LaborDayRecord,
  ShowRecord,
  SubCallRecord,
  TextAutomationSettingsRecord,
  TextMessageQueueRecord,
  TextSendingMethod,
  ClientFeedbackResponseRecord,
  ClientFeedbackScoreRecord,
  FeedbackTechRatingRecord,
} from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { BusinessClientRecord, ClientContactRecord, TechRatingRecord } from "@/lib/client-types";
import { exportDocumentDocx, exportDocumentPdf, type ExportDocument } from "@/lib/export-documents";

type Props = {
  initialShows: ShowRecord[];
  initialLaborDays: LaborDayRecord[];
  initialSubCalls: SubCallRecord[];
  initialAssignments: AssignmentRecord[];
  initialAssignmentNotes: AssignmentNoteRecord[];
  initialAssignmentChecklists: AssignmentChecklistRecord[];
  initialTextAutomationSettings: TextAutomationSettingsRecord[];
  initialTextMessageQueue: TextMessageQueueRecord[];
  initialTechRatings: TechRatingRecord[];
  initialClientFeedbackResponses: ClientFeedbackResponseRecord[];
  initialClientFeedbackScores: ClientFeedbackScoreRecord[];
  initialFeedbackTechRatings: FeedbackTechRatingRecord[];
  initialBusinessClients: BusinessClientRecord[];
  initialClientContacts: ClientContactRecord[];
  initialCrew: CrewRecord[];
  masterRates: MasterRateRecord[];
  initialSearch?: string;
  initialOpenFeedback?: boolean;
};

type SaveState = { kind: "success" | "error"; text: string } | null;
type ImportMode = "create" | "merge" | "preview";
type DayType = "full_day" | "half_day" | "custom" | "";

type ViewMode = "overview" | "edit";
type EventDisplayMode = "day" | "booth" | "messages" | "automation" | "checklist" | "feedback" | "notes" | "ratings";
type EditorMode = "show" | "day" | "call" | null;
type NoteVisibility = "admin_only" | "internal_export" | "client_export" | "worker_export";
type CrewAvailabilityScope = "active_day" | "selected_show" | "off";

const crewAvailabilityScopeLabels: Record<CrewAvailabilityScope, string> = {
  active_day: "Hide crew booked on this date",
  selected_show: "Hide crew booked on any show date",
  off: "Show booked crew too",
};

type ChecklistField = "schedule_sent" | "confirmed" | "day_before_confirmed";

const checklistColumns: Array<{ field: ChecklistField; label: string; helper: string }> = [
  { field: "schedule_sent", label: "Sent schedule", helper: "Schedule/message has been sent" },
  { field: "confirmed", label: "Confirmed", helper: "Worker confirmed the shift" },
  { field: "day_before_confirmed", label: "Day-before confirmation", helper: "Confirmed again the day before" },
];

type AutomationDraft = Omit<TextAutomationSettingsRecord, "updated_at">;
type AutomationReminderKey = "reminder_7_day" | "reminder_3_day" | "reminder_day_before" | "reminder_day_of";


const textSendingMethodOptions: Array<{ value: TextSendingMethod; label: string; helper: string }> = [
  { value: "shortcut", label: "Apple Shortcut Mode", helper: "Default. Your iPhone Shortcut polls due texts and sends them from your phone." },
  { value: "manual", label: "Manual Messages App", helper: "Copy/open each message yourself. No provider required." },
  { value: "provider", label: "SMS Provider Mode", helper: "Use Twilio or another provider for true server-side sending." },
];

const automationReminderOptions: Array<{ key: AutomationReminderKey; label: string; helper: string }> = [
  { key: "reminder_7_day", label: "7 days out · 9:00am Central", helper: "First confirmation touchpoint." },
  { key: "reminder_3_day", label: "3 days out · 9:00am Central", helper: "Second confirmation touchpoint." },
  { key: "reminder_day_before", label: "Day before · 5:00pm Central", helper: "Final day-before confirmation." },
  { key: "reminder_day_of", label: "Day of · 2 hours before call", helper: "Same-day report reminder." },
];

const defaultAvailabilityTemplate = "Hi {first_name}, this is {coordinator_name} with Emanuel Labor Services. Are you available for {show_name} at {venue} from {show_start} to {show_end}? Please reply with the dates/times you can work. Thank you.";
const defaultScheduleTemplate = `Hi {first_name}, this is {coordinator_name} with Emanuel Labor Services. Here is your schedule for {show_name}:

{schedule}

Meet-up Location: {meet_up_location}
Rate: {rate}
Attire: black polo, black pants, black shoes. Please arrive clean, well-groomed, and professionally presented.

Please confirm.`;
const defaultReminderTemplate = "Hi {first_name}, quick confirmation for {show_name}. Your next call is {next_call}. Meet-up Location: {meet_up_location}. Please reply confirmed. - {coordinator_name}";

function defaultAutomationDraft(showId: string): AutomationDraft {
  return {
    show_id: showId,
    enabled: true,
    sending_method: "shortcut",
    shortcut_token: "",
    send_availability: false,
    send_schedule: true,
    reminder_7_day: true,
    reminder_3_day: true,
    reminder_day_before: true,
    reminder_day_of: true,
    timezone: "America/Chicago",
    availability_template: defaultAvailabilityTemplate,
    schedule_template: defaultScheduleTemplate,
    reminder_template: defaultReminderTemplate,
  };
}

function automationDraftFromRecord(showId: string, record: TextAutomationSettingsRecord | null | undefined): AutomationDraft {
  const base = defaultAutomationDraft(showId);
  if (!record) return base;
  return {
    show_id: showId,
    enabled: Boolean(record.enabled),
    sending_method: record.sending_method === "shortcut" || record.sending_method === "provider" ? record.sending_method : "manual",
    shortcut_token: record.shortcut_token || "",
    send_availability: Boolean(record.send_availability),
    send_schedule: record.send_schedule !== false,
    reminder_7_day: record.reminder_7_day !== false,
    reminder_3_day: record.reminder_3_day !== false,
    reminder_day_before: record.reminder_day_before !== false,
    reminder_day_of: record.reminder_day_of !== false,
    timezone: record.timezone || base.timezone,
    availability_template: record.availability_template || base.availability_template,
    schedule_template: record.schedule_template || base.schedule_template,
    reminder_template: record.reminder_template || base.reminder_template,
  };
}

type ImportPreviewState = {
  show: {
    name: string;
    client: string;
    venue: string;
    rate_city: string;
    show_start: string;
    show_end: string;
    notes: string;
  };
  laborDays: Array<{ labor_date: string; label: string; notes: string }>;
  subCallPreview: Array<{
    key: string;
    labor_date: string;
    area: string;
    role_name: string;
    start_time: string;
    end_time: string;
    crew_needed: number;
    matchedCrew: Array<{ name: string; crew_id: string }>;
    unmatchedCrew: string[];
  }>;
  matchedCrewCount: number;
  unmatchedCrewCount: number;
  sourceType: string;
};


const workerNoteOptions = [
  { code: "late_arrival", label: "Late arrival" },
  { code: "early_arrival", label: "Early arrival" },
  { code: "needs_improvement_pace", label: "Needs improvement in pace/productivity" },
  { code: "strong_work_performance", label: "Strong work performance" },
  { code: "exceptional_performance", label: "Exceptional performance" },
  { code: "recognized_by_client", label: "Recognized by client" },
  { code: "requested_future_work", label: "Requested for future work" },
  { code: "do_not_reassign_without_approval", label: "Do not reassign to this client/show type without approval" },
  { code: "no_show", label: "No-show" },
  { code: "called_out", label: "Called out" },
  { code: "positive_attitude", label: "Positive attitude" },
  { code: "requires_closer_supervision", label: "Requires closer supervision" },
  { code: "strong_teamwork", label: "Strong teamwork" },
  { code: "safety_follow_up", label: "Safety concern / requires follow-up" },
  { code: "appearance_attire_issue", label: "Appearance or attire issue" },
];

const sensitiveNoteCodes = new Set([
  "needs_improvement_pace",
  "do_not_reassign_without_approval",
  "no_show",
  "called_out",
  "requires_closer_supervision",
  "safety_follow_up",
  "appearance_attire_issue",
]);

const noteVisibilityLabels: Record<NoteVisibility, string> = {
  admin_only: "Admin only",
  internal_export: "Internal export",
  client_export: "Client export",
  worker_export: "Worker export",
};

const emptyShow = {
  name: "",
  client: "",
  business_client_id: "",
  client_contact_id: "",
  venue: "",
  city: "",
  state: "",
  rate_city: "Default",
  show_start: "",
  show_end: "",
  notes: "",
  meet_up_location: "",
  crew_lead_name: "",
  crew_lead_phone: "",
  default_hourly_rate: "",
  coordinator_name: "Storm Leigh",
  coordinator_phone: "504-657-6618",
};

const emptyDay = {
  labor_date: "",
  label: "",
  notes: "",
};

const emptyCall = {
  area: "",
  location: "",
  role_name: "",
  master_rate_id: "",
  message_rate: "",
  start_time: "",
  end_time: "",
  crew_needed: "1",
  day_type: "full_day" as DayType,
  notes: "",
};

const emptyImport = {
  show_name: "",
  client: "",
  business_client_id: "",
  client_contact_id: "",
  venue: "",
  city: "",
  state: "",
  rate_city: "Default",
  show_start: "",
  show_end: "",
  notes: "",
};

const roleAliases: Record<string, string[]> = {
  "general av": ["gav", "avt", "av tech", "audio visual tech", "audio visual technician", "general av tech"],
  gav: ["general av"],
  avt: ["general av"],
  "led assist": ["led", "led stagehand", "led tech", "led technician", "led hand"],
  "led stagehand": ["led assist"],
  led: ["led assist"],
  "client facing audio visual tech": ["cf avt", "client facing avt", "client facing av tech", "client facing audiovisual tech", "cf av tech"],
  "cf avt": ["client facing audio visual tech"],
  "client facing avt": ["client facing audio visual tech"],
  "client facing av tech": ["client facing audio visual tech"],
  "breakout operator": ["bo", "bo tech", "bo technician", "breakout tech", "breakout technician", "breakout", "breakouts", "breakout room operator", "breakout room tech"],
  bo: ["breakout operator", "bo tech", "breakout tech"],
  "bo tech": ["breakout operator", "bo"],
  "breakout tech": ["breakout operator", "bo"],
  "audio assist": ["a2", "audio tech", "audio technician"],
  a2: ["audio assist"],
  "video assist": ["v2", "video tech", "video technician"],
  v2: ["video assist"],
  "lighting assist": ["l2", "lighting tech", "lighting technician"],
  l2: ["lighting assist"],
  "crew lead": ["lead"],
  "warehouse worker": ["warehouse", "warehouse workers", "warehouse prep", "loader", "unload"],
  "warehouse workers": ["warehouse worker", "warehouse"],
  warehouse: ["warehouse worker", "warehouse workers"],
};

const fallbackRoleRates: Record<string, { full_day: number; half_day: number | null }> = {
  "general av": { full_day: 350, half_day: 175 },
  gav: { full_day: 350, half_day: 175 },
  avt: { full_day: 350, half_day: 175 },
  "led assist": { full_day: 350, half_day: 175 },
  "led stagehand": { full_day: 350, half_day: 175 },
  stagehand: { full_day: 300, half_day: 150 },
  "stage hand": { full_day: 300, half_day: 150 },
  "client facing audio visual tech": { full_day: 400, half_day: 200 },
  "breakout operator": { full_day: 400, half_day: 200 },
  "bo tech": { full_day: 400, half_day: 200 },
  floater: { full_day: 350, half_day: 175 },
  "crew lead": { full_day: 500, half_day: null },
  "warehouse worker": { full_day: 300, half_day: 150 },
  "warehouse workers": { full_day: 300, half_day: 150 },
  warehouse: { full_day: 300, half_day: 150 },
};

type PositionOption = {
  id: string;
  city_name: string;
  role_name: string;
  full_day: number;
  half_day: number | null;
  overtime_multiplier: number;
  doubletime_multiplier: number;
};

const commonPositionOrder = [
  "General AV",
  "LED Stagehand",
  "Breakout Tech",
  "Breakout Floater",
  "Breakout Operator",
  "Floater",
  "Stagehand",
  "Client Facing Audio Visual Tech",
  "Audio Assist",
  "Video Assist",
  "Lighting Assist",
  "Camera Operator",
  "Crew Lead",
  "Breakout Lead",
  "A1-Audio Engineer",
  "V1-Lead Video Engineer",
  "Lighting Engineer",
  "LD-Lighting Designer",
  "Playback Operator",
  "Graphics Operator",
  "Speaker Ready",
  "Warehouse Worker",
];

const commonPositionAliases: Record<string, string[]> = {
  "breakout tech": ["breakout operator", "bo tech", "breakout technician", "breakouts"],
  "breakout floater": ["floater", "breakout floater"],
  "audio assist": ["a2-audio assist", "a2", "audio tech"],
  "video assist": ["v2-video assist", "v2", "video tech"],
  "lighting assist": ["l2-lighting assist", "l2", "lighting tech"],
};

function positionPriority(roleName: string) {
  const role = normalize(roleName);
  const keys = roleKeys(roleName);
  for (let index = 0; index < commonPositionOrder.length; index += 1) {
    const wanted = normalize(commonPositionOrder[index]);
    const aliases = new Set([wanted, ...(commonPositionAliases[wanted] ?? []).map(normalize)]);
    if (aliases.has(role)) return index;
    for (const key of keys) if (aliases.has(key)) return index;
  }
  return commonPositionOrder.length + 1;
}

function moneyLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const amount = Number(value);
  return `$${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
}

function positionOptionsForRateCity(masterRates: MasterRateRecord[], rateCity: string): PositionOption[] {
  const selectedCity = normalize(rateCity || "Default") || "default";
  const defaultCity = "default";
  const byRole = new Map<string, PositionOption & { cityRank: number }>();

  for (const rate of masterRates) {
    const city = normalize(rate.city_name);
    if (city !== selectedCity && city !== defaultCity) continue;
    const roleKey = normalize(rate.role_name);
    if (!roleKey) continue;
    const cityRank = city === selectedCity ? 0 : 1;
    const option = {
      id: rate.id,
      city_name: rate.city_name,
      role_name: rate.role_name,
      full_day: Number(rate.full_day || 0),
      half_day: rate.half_day == null ? null : Number(rate.half_day),
      overtime_multiplier: Number(rate.overtime_multiplier || 1.5),
      doubletime_multiplier: Number(rate.doubletime_multiplier || 2),
      cityRank,
    };
    const existing = byRole.get(roleKey);
    if (!existing || cityRank < existing.cityRank) byRole.set(roleKey, option);
  }

  return [...byRole.values()]
    .sort((a, b) => {
      const priority = positionPriority(a.role_name) - positionPriority(b.role_name);
      if (priority !== 0) return priority;
      return a.role_name.localeCompare(b.role_name);
    })
    .map(({ cityRank: _cityRank, ...option }) => option);
}

function findPositionOption(options: PositionOption[], roleName: string, masterRateId?: string | null) {
  if (masterRateId) {
    const byId = options.find((option) => option.id === masterRateId);
    if (byId) return byId;
  }
  const role = normalize(roleName);
  if (!role) return null;
  const keys = roleKeys(roleName);
  return options.find((option) => {
    const optionRole = normalize(option.role_name);
    if (optionRole === role || keys.has(optionRole)) return true;
    const optionKeys = roleKeys(option.role_name);
    for (const key of keys) {
      if (optionKeys.has(key)) return true;
    }
    return false;
  }) ?? null;
}

const venueToPoolHints = [
  { pool: "New Orleans, LA", hints: ["mccno", "ernest morial", "new orleans"] },
  { pool: "Nashville, TN", hints: ["music city center", "nashville"] },
  { pool: "Atlanta, GA", hints: ["atlanta"] },
];

function normalize(value: string | number | boolean | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function sanitizeShow(row: ShowRecord): ShowRecord {
  return {
    id: safeText(row.id),
    name: safeText(row.name),
    client: safeText(row.client),
    business_client_id: row.business_client_id ? safeText(row.business_client_id) : null,
    client_contact_id: row.client_contact_id ? safeText(row.client_contact_id) : null,
    venue: safeText(row.venue),
    rate_city: safeText(row.rate_city) || "Default",
    show_start: safeText(row.show_start),
    show_end: safeText(row.show_end),
    notes: safeText(row.notes),
  };
}

function showStartValue(show: ShowRecord): string {
  return safeText(show.show_start);
}

function pickDefaultShowId(showList: ShowRecord[]): string | null {
  const validShows = showList.filter((show) => show.id);
  if (!validShows.length) return null;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const sorted = [...validShows].sort((a, b) => {
    const aStart = showStartValue(a);
    const bStart = showStartValue(b);
    const aUpcoming = aStart >= todayKey;
    const bUpcoming = bStart >= todayKey;

    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    if (aUpcoming && bUpcoming) return aStart.localeCompare(bStart);
    if (!aUpcoming && !bUpcoming) return bStart.localeCompare(aStart);
    return safeText(a.name).localeCompare(safeText(b.name));
  });

  return sorted[0]?.id || null;
}

function sanitizeLaborDay(row: LaborDayRecord): LaborDayRecord {
  return {
    id: safeText(row.id),
    show_id: safeText(row.show_id),
    labor_date: safeText(row.labor_date),
    label: safeText(row.label),
    notes: safeText(row.notes),
  };
}

function sanitizeSubCall(row: SubCallRecord): SubCallRecord {
  return {
    id: safeText(row.id),
    labor_day_id: safeText(row.labor_day_id),
    area: safeText(row.area) || "Imported Call",
    location: safeText(row.location),
    role_name: safeText(row.role_name) || "General AV",
    master_rate_id: row.master_rate_id ? safeText(row.master_rate_id) : null,
    message_rate: row.message_rate ? safeText(row.message_rate).replace(/[^0-9.]/g, "") : null,
    start_time: safeText(row.start_time),
    end_time: safeText(row.end_time),
    crew_needed: Math.max(1, Number(row.crew_needed || 1)),
    notes: safeText(row.notes),
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    day_type: safeDayType(row.day_type) || "full_day",
  };
}

function sanitizeAssignment(row: AssignmentRecord): AssignmentRecord {
  return {
    id: safeText(row.id),
    sub_call_id: safeText(row.sub_call_id),
    crew_id: safeText(row.crew_id),
    status: safeText(row.status) || "confirmed",
    sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : 0,
    start_time: safeText(row.start_time) || null,
    end_time: safeText(row.end_time) || null,
    day_type: safeDayType(row.day_type) || null,
  };
}

function sanitizeCrew(row: CrewRecord): CrewRecord {
  return {
    ...row,
    id: safeText(row.id),
    name: safeText(row.name),
    description: safeText(row.description),
    city_pool_id: row.city_pool_id ? safeText(row.city_pool_id) : null,
    city_name: safeText(row.city_name) || "Unassigned",
    additional_city_pool_ids: safeArray(row.additional_city_pool_ids).map((id) => safeText(id)).filter(Boolean),
    additional_city_pool_names: safeArray(row.additional_city_pool_names).map((name) => safeText(name)).filter(Boolean),
    group_name: safeText(row.group_name) || "Ungrouped",
    tier: safeText(row.tier),
    email: safeText(row.email),
    phone: safeText(row.phone),
    address: safeText(row.address),
    lead_from: safeText(row.lead_from),
    other_city: safeText(row.other_city),
    ob: Boolean(row.ob),
    blacklisted: Boolean(row.blacklisted),
    blacklist_reason: safeText(row.blacklist_reason),
    notes: safeText(row.notes),
    conflict_companies: safeArray(row.conflict_companies),
    positions: safeArray(row.positions).map((position) => ({
      id: position.id ? safeText(position.id) : undefined,
      role_name: safeText(position.role_name),
      rate: Number(position.rate || 0),
    })),
    unavailable_dates: safeArray(row.unavailable_dates).map((date) => safeText(date)).filter(Boolean),
  };
}

function showBucket(show: ShowRecord) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(`${show.show_start}T00:00:00`);
  const end = new Date(`${show.show_end}T00:00:00`);
  if (end < today) return "Past";
  if (start > today) return "Upcoming";
  return "Current";
}

function showBucketClass(bucket: string) {
  if (bucket === "Current") return "event-card-current";
  if (bucket === "Past") return "event-card-past";
  return "event-card-upcoming";
}

function showBucketBadgeClass(bucket: string) {
  if (bucket === "Current") return "event-badge-current";
  if (bucket === "Past") return "event-badge-past";
  return "event-badge-upcoming";
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value;
}

function starDisplay(value: number) {
  const rating = Math.max(0, Math.min(5, Math.round(Number(value || 0))));
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function formatSubmittedAt(value: string) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function averageFeedbackScore(scores: ClientFeedbackScoreRecord[]) {
  const values = scores.map((score) => Number(score.rating || 0)).filter((rating) => rating > 0);
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, rating) => sum + rating, 0) / values.length) * 10) / 10;
}

function medianFeedbackScore(scores: ClientFeedbackScoreRecord[]) {
  return medianRating(scores.map((score) => Number(score.rating || 0)));
}

function medianRating(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

type TopTechItem = { crew: CrewRecord | undefined; median: number; count: number; last: string };


type FeedbackCrewRow = {
  crewId: string;
  crewName: string;
  phone: string;
  email: string;
  firstSchedule: string;
  assignmentId: string | null;
  rating: TechRatingRecord | null;
  isCrewLeadAssignment: boolean;
};

type FeedbackFormKind = "project-manager" | "area-manager" | "crew-lead";

type FeedbackQuestion = {
  key: string;
  label: string;
  helper: string;
};

type FeedbackFormItem = {
  key: string;
  kind: FeedbackFormKind;
  title: string;
  subtitle: string;
  target: string;
  intro: string;
  managerLabel: string;
  areaName?: string;
  crewRows: FeedbackCrewRow[];
  text: string;
};

type ConnectedFeedbackLink = {
  id: string;
  token: string;
  form_kind: FeedbackFormKind;
  area_name: string | null;
  title: string;
  target_label: string | null;
  url_path: string;
};

const projectManagerFeedbackQuestions: FeedbackQuestion[] = [
  { key: "recommend", label: "Overall intent to recommend", helper: "How likely are you to recommend Emanuel Labor Services?" },
  { key: "planning", label: "Overall planning experience", helper: "Scheduling, preparation, clarity, and ease before show site." },
  { key: "response_time", label: "Response time", helper: "How quickly and clearly did we respond?" },
  { key: "offerings_match", label: "Did our offerings match your needs?", helper: "Were the labor roles, support level, and coverage a good fit?" },
  { key: "billing", label: "Billing experience", helper: "Clarity of rates, invoices, PO handling, and billing communication." },
  { key: "onsite", label: "Overall on-site experience", helper: "How did the ELS labor support feel on site?" },
  { key: "competence", label: "Staff competence and ability", helper: "Skill level, professionalism, and ability to execute the work." },
  { key: "timeliness", label: "Timeliness", helper: "Arrival, readiness, schedule coverage, and pace of work." },
  { key: "event_success", label: "Was your event successful?", helper: "How successful was the event from your perspective?" },
];

const areaManagerFeedbackQuestions: FeedbackQuestion[] = [
  { key: "onsite", label: "Overall on-site experience", helper: "How was your experience with ELS support in this booth or area?" },
  { key: "competence", label: "Staff competence", helper: "Did the assigned techs have the skill, attitude, and professionalism needed?" },
];

const crewLeadFeedbackQuestions: FeedbackQuestion[] = [
  { key: "show", label: "How was the show?", helper: "Overall, how did the show go from the crew lead perspective?" },
  { key: "improvements", label: "What can be improved?", helper: "Rate how much improvement is needed in planning, staffing, or execution." },
  { key: "client_satisfied", label: "Was the client satisfied?", helper: "How satisfied did the client seem with the labor support?" },
  { key: "workflow", label: "Overall work flow", helper: "How smooth was the workflow, communication, and crew coordination?" },
];

function feedbackQuestionsForForm(form: Pick<FeedbackFormItem, "kind">): FeedbackQuestion[] {
  if (form.kind === "area-manager") return areaManagerFeedbackQuestions;
  if (form.kind === "crew-lead") return crewLeadFeedbackQuestions;
  return projectManagerFeedbackQuestions;
}


function feedbackKindLabel(kind: FeedbackFormKind) {
  if (kind === "area-manager") return "Booth / Area Manager";
  if (kind === "crew-lead") return "Crew Lead";
  return "Project Manager / Overall Event";
}

function feedbackKindDescription(link: { form_kind: FeedbackFormKind; area_name?: string | null }) {
  if (link.form_kind === "area-manager") return `Area manager${link.area_name ? ` · ${link.area_name}` : ""}`;
  if (link.form_kind === "crew-lead") return "Crew lead / internal show feedback";
  return "Project manager / overall event";
}
function isCrewLeadFeedbackRole(roleName: string | null | undefined) {
  const role = normalize(roleName);
  return role === "crew lead" || role === "working crew lead" || role === "working lead" || role === "labor lead" || role === "lead labor" || role.includes("crew lead");
}

function feedbackSafeId(value: string) {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "feedback";
}

function feedbackChoiceLine(label: string) {
  return `${label}:  □ 5★ Excellent   □ 4★ Good   □ 3★ Okay   □ 2★ Needs work   □ 1★ Problem`;
}

function buildFriendlyFeedbackText(form: Omit<FeedbackFormItem, "text">, show: ShowRecord, clientName: string, venue: string) {
  const areaLine = form.areaName ? [`Area / booth: ${form.areaName}`] : [];
  const techLines = form.crewRows.length
    ? form.crewRows.flatMap((row, index) => [
        `${index + 1}. ${row.crewName}`,
        `   Schedule: ${row.firstSchedule}`,
        "   Tech rating: □ 5★ Excellent  □ 4★ Good  □ 3★ Okay  □ 2★ Needs work  □ 1★ Problem",
        "   Would you request this tech again? □ Yes  □ No  □ Not sure",
        "   Notes on this tech: ________________________________________________",
      ])
    : ["No assigned techs listed for this form yet."];

  return [
    "Emanuel Labor Services — Quick Feedback Survey",
    "Thank you for taking 2–3 minutes. This is a quick survey, not a test. Your feedback helps us recognize excellent techs, collect testimonials, and fix problems quickly.",
    "",
    `Show: ${show.name}`,
    `Client: ${clientName}`,
    `Venue: ${venue}`,
    `Dates: ${show.show_start} to ${show.show_end}`,
    `Feedback for: ${form.target}`,
    ...areaLine,
    "",
    `${form.managerLabel}: ________________________________________________`,
    "Date completed: ________________________________________________",
    "",
    "Quick 5-star ratings",
    "Scale: 5★ = excellent, 1★ = problem",
    ...feedbackQuestionsForForm(form).map((question) => feedbackChoiceLine(question.label)),
    "",
    "Quick questions",
    ...(form.kind === "crew-lead" ? [] : ["Would you request Emanuel Labor Services again? □ Yes  □ No  □ Not sure"]),
    "May we use your comments for a testimonial? □ Yes  □ No  □ Ask first",
    "",
    form.kind === "area-manager" ? "What was your overall experience with Emanuel Labor Services?" : form.kind === "crew-lead" ? "What should we recognize or improve from the crew lead perspective?" : "What went well?",
    "________________________________________________",
    "________________________________________________",
    "",
    "Anything we should fix or follow up on?",
    "________________________________________________",
    "________________________________________________",
    "",
    form.kind === "area-manager" ? "Tech ratings and notes for this booth / area" : form.kind === "crew-lead" ? "Crew lead tech ratings and notes" : "Tech feedback",
    ...techLines,
    "",
    "Additional comments",
    "________________________________________________",
    "________________________________________________",
  ].join("\n");
}

function buildFeedbackSurveyHtml(forms: FeedbackFormItem[], show: ShowRecord, clientName: string, venue: string) {
  const metaRows = [
    ["Show", show.name],
    ["Client", clientName],
    ["Venue", venue],
    ["Dates", `${show.show_start} to ${show.show_end}`],
  ];
  const formCards = forms.map((form, formIndex) => {
    const formId = feedbackSafeId(`${form.key}-${formIndex}`);
    const area = form.areaName ? `<div class="pill">Area / booth: ${escapeHtml(form.areaName)}</div>` : "";
    const ratingQuestions = feedbackQuestionsForForm(form).map((question) => `
      <fieldset class="question" data-question="${escapeHtml(question.label)}">
        <legend>${escapeHtml(question.label)}</legend>
        <p>${escapeHtml(question.helper)}</p>
        <div class="rating-row">
          ${[5,4,3,2,1].map((score) => `<label><input type="radio" name="${formId}-${question.key}" value="${score}" /> <span>${score}★</span></label>`).join("")}
        </div>
      </fieldset>`).join("");
    const techCards = form.crewRows.length ? form.crewRows.map((row, rowIndex) => {
      const techId = `${formId}-tech-${rowIndex}`;
      return `<div class="tech-card" data-tech="${escapeHtml(row.crewName)}">
        <div>
          <strong>${escapeHtml(row.crewName)}</strong>
          <p>${escapeHtml(row.firstSchedule)}</p>
        </div>
        <div class="rating-row compact-rating">
          ${[5,4,3,2,1].map((score) => `<label><input type="radio" name="${techId}-rating" value="${score}" /> <span>${score}★</span></label>`).join("")}
        </div>
        <label class="select-line">Would you request this tech again?
          <select name="${techId}-askback">
            <option value="">Choose one</option>
            <option>Yes</option>
            <option>No</option>
            <option>Not sure</option>
          </select>
        </label>
        <label>Notes on this tech
          <textarea name="${techId}-note" rows="2" placeholder="Optional notes about performance, attitude, readiness, or follow-up"></textarea>
        </label>
      </div>`;
    }).join("") : `<p class="muted">No assigned techs listed for this form yet.</p>`;
    return `<section class="survey-card" data-title="${escapeHtml(form.title)}">
      <div class="card-head">
        <div>
          <p class="eyebrow">${form.kind === "crew-lead" ? "Crew lead survey" : form.kind === "area-manager" ? "Area manager survey" : "Overall event survey"}</p>
          <h2>${escapeHtml(form.title)}</h2>
          <p>${escapeHtml(form.intro)}</p>
        </div>
        <span class="time-pill">2–3 min</span>
      </div>
      <div class="pills"><div class="pill">For: ${escapeHtml(form.target)}</div>${area}</div>
      <label>${escapeHtml(form.managerLabel)}
        <input name="${formId}-manager" placeholder="Your name" />
      </label>
      <label>Date completed
        <input name="${formId}-date" type="date" />
      </label>
      <h3>Quick 5-star ratings</h3>
      <p class="muted rating-help">5★ = excellent. 1★ = problem. Leave anything blank that does not apply.</p>
      <div class="question-grid">${ratingQuestions}</div>
      <h3>Quick questions</h3>
      <div class="question-grid two-col">
        ${form.kind === "crew-lead" ? "" : `<label>Would you request ELS again?
          <select name="${formId}-request-again"><option value="">Choose one</option><option>Yes</option><option>No</option><option>Not sure</option></select>
        </label>`}
        <label>May we use your comments for a testimonial?
          <select name="${formId}-testimonial-ok"><option value="">Choose one</option><option>Yes</option><option>No</option><option>Ask first</option></select>
        </label>
      </div>
      <label>${form.kind === "area-manager" ? "What was your overall experience with Emanuel Labor Services?" : form.kind === "crew-lead" ? "What should we recognize or improve from the crew lead perspective?" : "What went well?"}
        <textarea name="${formId}-went-well" rows="4" placeholder="Positive feedback, testimonial, or quick notes"></textarea>
      </label>
      <label>Anything we should fix or follow up on?
        <textarea name="${formId}-follow-up" rows="4" placeholder="Problems, concerns, or details we should correct"></textarea>
      </label>
      <h3>${form.kind === "area-manager" ? "Tech ratings and notes for this booth / area" : form.kind === "crew-lead" ? "Crew lead tech ratings and notes" : "Tech feedback"}</h3>
      <p class="muted">Rate only the techs you worked with. Notes are optional.</p>
      <div class="tech-list">${techCards}</div>
      <label>Additional comments
        <textarea name="${formId}-extra" rows="4" placeholder="Optional"></textarea>
      </label>
      <div class="actions"><button type="button" onclick="copySurveyResponse(this)">Copy completed response</button><button type="button" onclick="window.print()">Print / save PDF</button></div>
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(show.name)} Feedback Survey</title>
<style>
  :root { --brand:#062a31; --brand2:#0c3d45; --accent:#ffd21a; --bg:#f4f8f8; --line:#d7e2e2; --muted:#5d6b70; --panel:#ffffff; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: radial-gradient(circle at top left, rgba(255,210,26,.38), transparent 360px), var(--bg); color: var(--brand); }
  main { max-width: 920px; margin: 0 auto; padding: 28px 16px 54px; }
  .hero { background: linear-gradient(135deg, var(--brand), var(--brand2)); color: #fff; border-radius: 28px; padding: 28px; box-shadow: 0 18px 50px rgba(6,42,49,.22); }
  h1 { margin: 0 0 8px; font-size: clamp(28px, 5vw, 44px); letter-spacing: -.04em; }
  h2 { margin: 0 0 8px; font-size: 24px; }
  h3 { margin: 26px 0 10px; font-size: 18px; }
  p { line-height: 1.45; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 18px; }
  .meta div, .pill, .time-pill { background: rgba(255,255,255,.13); border: 1px solid rgba(255,255,255,.24); border-radius: 16px; padding: 10px 12px; }
  .meta small { display: block; color: rgba(255,255,255,.72); margin-bottom: 3px; }
  .survey-card { background: var(--panel); border: 1px solid var(--line); border-radius: 28px; padding: 24px; margin-top: 20px; box-shadow: 0 14px 40px rgba(6,42,49,.10); }
  .card-head { display:flex; justify-content:space-between; gap: 16px; align-items:flex-start; }
  .eyebrow { color: var(--muted); font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; margin: 0 0 6px; }
  .time-pill { background: #fff8cf; border-color: rgba(255,210,26,.75); color: var(--brand); white-space: nowrap; font-weight: 800; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  .pill { background: #f8fbfb; color: var(--brand); border-color: var(--line); }
  label, fieldset { display: grid; gap: 7px; margin: 12px 0; font-weight: 760; }
  input, select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 14px; padding: 12px 13px; font: inherit; background: #fff; color: var(--brand); }
  textarea { min-height: 92px; resize: vertical; }
  input:focus, select:focus, textarea:focus { outline: 3px solid rgba(255,210,26,.38); border-color: var(--brand2); }
  .question-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .two-col { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .question { border: 1px solid var(--line); border-radius: 18px; padding: 14px; background: #fbfdfd; }
  .question legend { font-weight: 900; padding: 0 4px; }
  .question p, .muted { color: var(--muted); font-weight: 500; margin: 0; }
  .rating-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .rating-row label { display: inline-flex; align-items: center; gap: 6px; margin: 0; border: 1px solid var(--line); border-radius: 999px; padding: 8px 10px; background: #fff; cursor: pointer; }
  .rating-row input { width: auto; accent-color: var(--brand); }
  .rating-row span { font-weight: 900; }
  .tech-list { display: grid; gap: 12px; }
  .tech-card { border: 1px solid var(--line); border-left: 5px solid var(--accent); border-radius: 18px; padding: 14px; background: #fffefa; display: grid; gap: 10px; }
  .tech-card strong { font-size: 17px; }
  .tech-card p { margin: 3px 0 0; color: var(--muted); }
  .compact-rating { margin-top: 0; }
  .select-line { max-width: 360px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
  button { border: 0; border-radius: 14px; background: var(--brand); color: #fff; padding: 12px 16px; font: inherit; font-weight: 800; cursor: pointer; }
  button + button { background: #fff; color: var(--brand); border: 1px solid var(--line); }
  .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: var(--brand); color: #fff; border-radius: 999px; padding: 10px 14px; box-shadow: 0 12px 30px rgba(6,42,49,.24); display: none; }
  @media (max-width: 680px) { .hero, .survey-card { border-radius: 20px; padding: 18px; } .card-head { display: grid; } }
  @media print { body { background: #fff; } main { max-width: none; padding: 0; } .hero, .survey-card { box-shadow: none; break-inside: avoid; } .actions, .toast { display:none !important; } }
</style>
</head>
<body>
<main>
  <section class="hero">
    <h1>Quick Feedback Survey</h1>
    <p>Thank you for working with Emanuel Labor Services. This is a quick survey, not a test. Most answers are simple 5-star ratings, and anything you do not know can be left blank.</p>
    <div class="meta">${metaRows.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
  </section>
  ${formCards}
</main>
<div id="toast" class="toast">Copied response</div>
<script>
function valueOf(element) {
  if (!element) return "";
  if (element.type === "radio") {
    const checked = element.closest("section").querySelector('input[name="' + CSS.escape(element.name) + '"]:checked');
    return checked ? checked.value : "";
  }
  return element.value || "";
}
function copySurveyResponse(button) {
  const card = button.closest("section");
  const lines = [];
  lines.push(card.getAttribute("data-title") || "Feedback Survey");
  lines.push("");
  card.querySelectorAll("label, fieldset.question").forEach(function(item) {
    var label = item.tagName.toLowerCase() === "fieldset" ? (item.querySelector("legend")?.innerText || "Rating") : (item.childNodes[0]?.textContent || "").trim();
    var input = item.querySelector("input[type=radio], input, select, textarea");
    if (!input) return;
    var value = valueOf(input).trim();
    if (value) lines.push(label + ": " + value);
  });
  card.querySelectorAll(".tech-card").forEach(function(tech) {
    lines.push("");
    lines.push("Tech: " + (tech.getAttribute("data-tech") || ""));
    tech.querySelectorAll("input[type=radio], select, textarea").forEach(function(input) {
      var value = valueOf(input).trim();
      if (value) lines.push("- " + value);
    });
  });
  navigator.clipboard.writeText(lines.join("\n")).then(function() {
    var toast = document.getElementById("toast");
    toast.style.display = "block";
    setTimeout(function() { toast.style.display = "none"; }, 1800);
  });
}
</script>
</body>
</html>`;
}

function buildMedianTopTechs(rows: TechRatingRecord[], crewRecords: CrewRecord[], limit = 10): TopTechItem[] {
  const byCrew = new Map<string, { values: number[]; last: string }>();
  for (const row of rows) {
    const value = Number(row.rating || 0);
    if (!row.crew_id || value <= 0) continue;
    const existing = byCrew.get(row.crew_id) ?? { values: [], last: "" };
    existing.values.push(value);
    const ratingDate = row.updated_at || row.created_at || "";
    if (ratingDate > existing.last) existing.last = ratingDate;
    byCrew.set(row.crew_id, existing);
  }
  return [...byCrew.entries()]
    .map(([crewId, row]) => ({ crew: crewRecords.find((crew) => crew.id === crewId), median: medianRating(row.values), count: row.values.length, last: row.last }))
    .sort((a, b) => b.median - a.median || b.count - a.count || (a.crew?.name || "").localeCompare(b.crew?.name || ""))
    .slice(0, limit);
}

function safeDayType(value: unknown): DayType {
  const text = safeText(value);
  return text === "full_day" || text === "half_day" || text === "custom" ? text : "";
}

function dayTypeLabel(value: unknown) {
  const type = safeDayType(value);
  if (type === "full_day") return "Full day";
  if (type === "half_day") return "Half day";
  if (type === "custom") return "Custom time";
  return "Use sub-call default";
}

function formatTimeRange(call: SubCallRecord) {
  return `${call.start_time}${call.end_time ? `-${call.end_time}` : ""}`;
}

function assignmentStart(assignment: AssignmentRecord, call: SubCallRecord) {
  return safeText(assignment.start_time) || call.start_time;
}

function assignmentEnd(assignment: AssignmentRecord, call: SubCallRecord) {
  return safeText(assignment.end_time) || call.end_time;
}

function assignmentDurationHours(assignment: AssignmentRecord, call: SubCallRecord) {
  return durationHoursBetween(assignmentStart(assignment, call), assignmentEnd(assignment, call));
}

function assignmentDayType(assignment: AssignmentRecord, call: SubCallRecord) {
  const duration = assignmentDurationHours(assignment, call);
  if (duration !== null && duration <= 5) return "half_day";
  return safeDayType(assignment.day_type) || safeDayType(call.day_type) || "full_day";
}

function formatAssignmentTimeRange(assignment: AssignmentRecord, call: SubCallRecord) {
  const start = assignmentStart(assignment, call);
  const end = assignmentEnd(assignment, call);
  return `${start}${end ? `-${end}` : ""}`;
}

function compareSubCalls(a: SubCallRecord, b: SubCallRecord) {
  const aOrder = Number(a.sort_order || 0);
  const bOrder = Number(b.sort_order || 0);
  if (aOrder || bOrder) return aOrder - bOrder || a.start_time.localeCompare(b.start_time) || a.area.localeCompare(b.area);
  return a.start_time.localeCompare(b.start_time) || a.area.localeCompare(b.area);
}

function smsHref(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return `sms:${digits.length === 10 ? `1${digits}` : digits}`;
}

function buildShortcutPollUrl(origin: string, showId: string, token: string) {
  if (!origin || !showId || !token) return "";
  return `${origin}/api/text-automation/shortcut?show_id=${encodeURIComponent(showId)}&token=${encodeURIComponent(token)}&limit=25`;
}

function buildUniversalShortcutPollUrl(origin: string, token: string) {
  if (!origin || !token) return "";
  return `${origin}/api/text-automation/shortcut?all=1&token=${encodeURIComponent(token)}&limit=25`;
}

function buildShortcutRunUrl(pollUrl: string) {
  if (!pollUrl) return "";
  return `shortcuts://run-shortcut?name=${encodeURIComponent("ELS Send Due Texts")}&input=text&text=${encodeURIComponent(pollUrl)}`;
}

function buildShortcutInstallUrl(pollUrl: string) {
  if (!pollUrl) return "";
  const shortcutName = encodeURIComponent("ELS Send Due Texts");
  const installNote = encodeURIComponent(`ELS Shortcut API URL:\n${pollUrl}\n\nShortcut name must be exactly: ELS Send Due Texts\n\nFail-safe build order:\n1. URL\n2. Get Contents of URL\n3. Get Dictionary from Contents of URL\n4. Get Dictionary Value messages\n5. Repeat with Each Item in messages\n6. Inside Repeat: get phone, body, and mark_sent_url from Repeat Item; Send body to phone; then Get Contents of mark_sent_url.`);
  return `shortcuts://create-shortcut?name=${shortcutName}&input=text&text=${installNote}`;
}

function appendShortcutTestParam(url: string) {
  if (!url) return "";
  return `${url}${url.includes("?") ? "&" : "?"}test=1`;
}

function formatMessageDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
}

function addDaysToDateString(value: string, delta: number) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(Date.UTC(year, month - 1, day + delta, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function formatClockLabel(value: string) {
  const [hourRaw, minuteRaw] = value.split(":").map(Number);
  const hour24 = Number.isFinite(hourRaw) ? hourRaw : 0;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function timezoneShortLabel(value: string) {
  if (value === "America/New_York") return "Eastern";
  if (value === "America/Denver") return "Mountain";
  if (value === "America/Los_Angeles") return "Pacific";
  return "Central";
}

function formatScheduledPlanLabel(dateString: string, timeString: string, timezone: string) {
  return `${formatMessageDate(dateString)} at ${formatClockLabel(timeString)} ${timezoneShortLabel(timezone)}`;
}

function queueDueLabel(row: TextMessageQueueRecord) {
  if (row.status === "sent" && row.sent_at) return `Sent ${new Date(row.sent_at).toLocaleString()}`;
  if (row.status !== "scheduled") return row.status;
  const scheduledFor = new Date(row.scheduled_for);
  if (scheduledFor.getTime() <= Date.now()) return "Due now · sends on next Shortcut run";
  return `Scheduled for ${scheduledFor.toLocaleString()}`;
}

function isoDateFromParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthLabel(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  if (!year || !month) return monthValue;
  return new Date(year, month - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function shiftMonth(monthValue: string, offset: number) {
  const [year, month] = monthValue.split("-").map(Number);
  const base = new Date(year || new Date().getFullYear(), (month || 1) - 1 + offset, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthCalendarDays(monthValue: string) {
  const [year, month] = monthValue.split("-").map(Number);
  const safeYear = year || new Date().getFullYear();
  const safeMonth = month || new Date().getMonth() + 1;
  const first = new Date(safeYear, safeMonth - 1, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      date: isoDateFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate()),
      day: date.getDate(),
      inMonth: date.getMonth() === safeMonth - 1,
    };
  });
}

function formatMessageTime(value: string | null | undefined) {
  const minutes = minutesFromTime(value);
  if (minutes === null) return safeText(value);
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

function formatMessageTimeRange(call: SubCallRecord) {
  return `${formatMessageTime(call.start_time)}–${formatMessageTime(call.end_time)}`;
}

function formatAssignmentMessageTimeRange(assignment: AssignmentRecord, call: SubCallRecord) {
  return `${formatMessageTime(assignmentStart(assignment, call))}–${formatMessageTime(assignmentEnd(assignment, call))}`;
}

function formatExportAssignmentTime(assignment: AssignmentRecord, call: SubCallRecord) {
  const blockLabel = dayTypeLabel(assignmentDayType(assignment, call));
  return `${formatAssignmentMessageTimeRange(assignment, call)}${blockLabel ? ` • ${blockLabel}` : ""}`;
}

function firstName(fullName: string) {
  return safeText(fullName).split(/\s+/)[0] || "there";
}

function splitVenueAndAddress(venue: string) {
  const parts = safeText(venue).split("•").map((part) => part.trim()).filter(Boolean);
  return { venueName: parts[0] || safeText(venue) || "the venue", address: parts.slice(1).join("\n") };
}

type EventMessageMeta = {
  city: string;
  state: string;
  meet_up_location: string;
  crew_lead_name: string;
  crew_lead_phone: string;
  default_hourly_rate: string;
  coordinator_name: string;
  coordinator_phone: string;
};

const EVENT_META_START = "[[ELS_EVENT_MESSAGE_DETAILS]]";
const EVENT_META_END = "[[/ELS_EVENT_MESSAGE_DETAILS]]";
const defaultEventMessageMeta: EventMessageMeta = {
  city: "",
  state: "",
  meet_up_location: "",
  crew_lead_name: "",
  crew_lead_phone: "",
  default_hourly_rate: "",
  coordinator_name: "Storm Leigh",
  coordinator_phone: "504-657-6618",
};

function parseLegacyEventMeta(notes: string) {
  const meta: Partial<EventMessageMeta> = {};
  for (const line of notes.split(/\r?\n/)) {
    const [label, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    const key = normalize(label || "");
    if (!value) continue;
    if (key === "city") meta.city = value;
    if (key === "state") meta.state = value;
    if (key === "meet up location" || key === "meetup location" || key === "report location") meta.meet_up_location = value;
    if (key === "crew lead" || key === "report to") meta.crew_lead_name = value.replace(/,?\s*crew lead$/i, "").trim();
    if (key === "crew lead phone" || key === "report to phone") meta.crew_lead_phone = value;
    if (key === "rate" || key === "hourly rate" || key === "message rate") meta.default_hourly_rate = value.replace(/[^0-9.]/g, "");
    if (key === "coordinator") meta.coordinator_name = value;
    if (key === "coordinator phone") meta.coordinator_phone = value;
  }
  return meta;
}

function splitShowNotes(rawNotes: string | null | undefined) {
  const raw = safeText(rawNotes);
  const result = { displayNotes: raw, meta: { ...defaultEventMessageMeta } };
  const start = raw.indexOf(EVENT_META_START);
  const end = raw.indexOf(EVENT_META_END);

  if (start >= 0 && end > start) {
    const before = raw.slice(0, start).trim();
    const after = raw.slice(end + EVENT_META_END.length).trim();
    result.displayNotes = [before, after].filter(Boolean).join("\n\n");
    const encoded = raw.slice(start + EVENT_META_START.length, end).trim();
    try {
      const parsed = JSON.parse(encoded) as Partial<EventMessageMeta>;
      result.meta = { ...result.meta, ...parsed };
    } catch {
      result.meta = { ...result.meta, ...parseLegacyEventMeta(encoded) };
    }
  } else {
    result.meta = { ...result.meta, ...parseLegacyEventMeta(raw) };
  }

  return result;
}

function composeShowNotes(displayNotes: string, meta: EventMessageMeta) {
  const cleanedNotes = safeText(displayNotes);
  const cleanedMeta: EventMessageMeta = {
    city: safeText(meta.city),
    state: safeText(meta.state),
    meet_up_location: safeText(meta.meet_up_location),
    crew_lead_name: safeText(meta.crew_lead_name),
    crew_lead_phone: safeText(meta.crew_lead_phone),
    default_hourly_rate: safeText(meta.default_hourly_rate).replace(/[^0-9.]/g, ""),
    coordinator_name: safeText(meta.coordinator_name) || "Storm Leigh",
    coordinator_phone: safeText(meta.coordinator_phone) || "504-657-6618",
  };
  const hasMeta = Object.entries(cleanedMeta).some(([key, value]) => {
    if (key === "coordinator_name") return value && value !== "Storm Leigh";
    if (key === "coordinator_phone") return value && value !== "504-657-6618";
    return Boolean(value);
  });
  if (!hasMeta) return cleanedNotes;
  return [cleanedNotes, `${EVENT_META_START}\n${JSON.stringify(cleanedMeta)}\n${EVENT_META_END}`].filter(Boolean).join("\n\n");
}

function eventMessageMeta(show: ShowRecord | null) {
  return splitShowNotes(show?.notes || "").meta;
}

function boothLabel(area: string) {
  return safeText(area) || "Unassigned booth / area";
}

const crewListAccentPalette = [
  // ELS61 booth/area palette: high contrast, not semantic, designed to avoid adjacent repeat colors.
  "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#4f46e5", "#0d9488",
  "#a16207", "#7c3aed", "#0284c7", "#65a30d", "#dc2626", "#0369a1", "#db2777", "#15803d",
  "#b45309", "#6d28d9", "#0f766e", "#c2410c", "#1d4ed8", "#c026d3", "#047857", "#9a3412",
  "#4338ca", "#ca8a04", "#0e7490", "#e11d48", "#6b21a8", "#b91c1c", "#059669", "#7e22ce",
  "#1e40af", "#166534", "#854d0e", "#86198f", "#155e75", "#991b1b", "#3730a3", "#166534",
];

function generatedAccentColor(index: number) {
  if (index < crewListAccentPalette.length) return crewListAccentPalette[index];
  const hue = (index * 137.508) % 360;
  return `hsl(${Math.round(hue)} 68% 32%)`;
}

function createAreaAccentMap(areas: string[]) {
  const labels = [...new Set(areas.map((area) => boothLabel(area)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  return new Map(labels.map((label, index) => [label, generatedAccentColor(index)]));
}

function accentColorForArea(area: string, areaAccentMap?: Map<string, string>) {
  const label = boothLabel(area);
  const mappedColor = areaAccentMap?.get(label);
  if (mappedColor) return mappedColor;

  const key = normalize(label);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return generatedAccentColor(hash % crewListAccentPalette.length);
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadHtmlFile(filename: string, html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function roleKeys(roleName: string) {
  const target = normalize(roleName);
  const keys = new Set([target, ...(roleAliases[target] ?? [])].filter(Boolean));

  for (const [canonical, aliases] of Object.entries(roleAliases)) {
    if (canonical === target || aliases.includes(target)) {
      keys.add(canonical);
      aliases.forEach((alias) => keys.add(alias));
    }
  }

  if (/\bled\b/.test(target) && /\bstagehand\b/.test(target)) {
    keys.add("led assist");
    keys.add("led stagehand");
  }

  if ((/\bbo\b/.test(target) || /\bbreakout\b/.test(target)) && (/\btech\b|\btechnician\b|\boperator\b|\broom\b|\bbreakouts\b/.test(target))) {
    ["breakout operator", "bo", "bo tech", "breakout tech"].forEach((item) => keys.add(item));
  }

  if (/\bcf\b/.test(target) && (/\bavt\b|\bav\b/.test(target))) {
    ["client facing audio visual tech", "cf avt", "client facing av tech"].forEach((item) => keys.add(item));
  }

  return keys;
}

function matchesRole(crew: CrewRecord, roleName: string) {
  const keys = roleKeys(roleName);
  const target = normalize(roleName);
  return (crew.positions ?? []).some((position) => {
    const role = normalize(position.role_name);
    return keys.has(role) || role.includes(target) || target.includes(role);
  });
}

function minutesFromTime(value: string | null | undefined) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function durationHoursBetween(startValue: string | null | undefined, endValue: string | null | undefined) {
  const start = minutesFromTime(startValue);
  const end = minutesFromTime(endValue);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

function callDurationHours(call: SubCallRecord) {
  return durationHoursBetween(call.start_time, call.end_time);
}

function rateForCall(call: SubCallRecord, rateCity: string, masterRates: MasterRateRecord[]) {
  if (call.master_rate_id) {
    const linkedRate = masterRates.find((rate) => rate.id === call.master_rate_id);
    if (linkedRate) {
      const fullDay = Number(linkedRate.full_day || 0);
      const halfDay = linkedRate.half_day == null ? null : Number(linkedRate.half_day);
      const duration = callDurationHours(call);
      const useHalfDay = duration !== null && duration <= 5 && halfDay !== null;
      return useHalfDay ? halfDay : fullDay;
    }
  }
  const keys = roleKeys(call.role_name);
  const isRateMatch = (rate: MasterRateRecord, city: string) => {
    const cityMatches = normalize(rate.city_name) === normalize(city);
    if (!cityMatches) return false;
    const rateRole = normalize(rate.role_name);
    if (keys.has(rateRole)) return true;
    const rateKeys = roleKeys(rate.role_name);
    for (const key of keys) {
      if (rateKeys.has(key)) return true;
    }
    return false;
  };

  const override = masterRates.find((rate) => isRateMatch(rate, rateCity));
  const fallback = masterRates.find((rate) => isRateMatch(rate, "Default"));
  const databaseRate = override ?? fallback;
  const builtInRate = fallbackRoleRates[[...keys].find((key) => fallbackRoleRates[key]) || ""];

  const fullDay = databaseRate?.full_day ?? builtInRate?.full_day ?? 0;
  const halfDay = databaseRate?.half_day ?? builtInRate?.half_day ?? null;
  const duration = callDurationHours(call);
  const useHalfDay = duration !== null && duration <= 5 && halfDay !== null;

  return useHalfDay ? halfDay : fullDay;
}

function crewFullDayRateForRole(crew: CrewRecord | undefined, roleName: string) {
  if (!crew) return null;
  const keys = roleKeys(roleName);
  const exact = crew.positions.find((position) => keys.has(normalize(position.role_name)) && Number(position.rate) > 0);
  if (exact) return Number(exact.rate);

  const fuzzy = crew.positions.find((position) => {
    const role = normalize(position.role_name);
    return Number(position.rate) > 0 && [...keys].some((key) => role.includes(key) || key.includes(role));
  });

  return fuzzy ? Number(fuzzy.rate) : null;
}

function hourlyRateLabel(crew: CrewRecord | undefined, call: SubCallRecord, rateCity: string, masterRates: MasterRateRecord[]) {
  const fullDay = crewFullDayRateForRole(crew, call.role_name) ?? rateForCall({ ...call, start_time: "08:00", end_time: "18:00" }, rateCity, masterRates);
  if (!fullDay) return "Rate: TBD";
  const hourly = Math.round((fullDay / 10) * 100) / 100;
  return `Rate: $${hourly % 1 === 0 ? hourly.toFixed(0) : hourly.toFixed(2)}/hr`;
}

function messageRateLabelForCall(crew: CrewRecord | undefined, call: SubCallRecord, rateCity: string, masterRates: MasterRateRecord[]) {
  const custom = Number(String(call.message_rate || "").replace(/[^0-9.]/g, ""));
  if (Number.isFinite(custom) && custom > 0) {
    return `Rate: $${custom % 1 === 0 ? custom.toFixed(0) : custom.toFixed(2)}/hr`;
  }
  return hourlyRateLabel(crew, call, rateCity, masterRates);
}


function crewMatchesEventPool(crew: CrewRecord, eventPool: string) {
  if (!eventPool) return true;
  const pools = [crew.city_name, ...(crew.additional_city_pool_names ?? [])];
  return pools.some((name) => normalize(name) === normalize(eventPool));
}

function resolveEventPool(show: ShowRecord | null, crewRecords: CrewRecord[]) {
  if (!show) return null;

  const cities = [...new Set(crewRecords.flatMap((crew) => [crew.city_name, ...(crew.additional_city_pool_names ?? [])]).filter(Boolean))];
  const haystack = normalize([show.rate_city, show.venue, show.notes, show.name].join(" "));

  if (show.rate_city && normalize(show.rate_city) !== "default") {
    const exact = cities.find((city) => normalize(city) === normalize(show.rate_city));
    if (exact) return exact;

    const fuzzy = cities.find(
      (city) =>
        normalize(city).includes(normalize(show.rate_city)) ||
        normalize(show.rate_city).includes(normalize(city))
    );
    if (fuzzy) return fuzzy;
  }

  for (const hint of venueToPoolHints) {
    if (hint.hints.some((item) => haystack.includes(normalize(item)))) {
      const city = cities.find((name) => normalize(name) === normalize(hint.pool));
      return city ?? hint.pool;
    }
  }

  const venueMatch = cities.find((city) => haystack.includes(normalize(city)));
  return venueMatch ?? null;
}

class EventsClientErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, message: error instanceof Error ? error.message : "The Events page hit a display error." };
  }

  componentDidCatch(error: unknown) {
    console.error("Events page display error", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card">
          <h2>Events display error</h2>
          <p className="error">{this.state.message}</p>
          <p className="muted">The page was protected from a full app crash. Refresh the page, then continue from the event list. If this repeats, check for a partial sub-call with missing area, position, start, or end time.</p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>Reload Events</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function EventsClient(props: Props) {
  return (
    <EventsClientErrorBoundary>
      <EventsClientInner {...props} />
    </EventsClientErrorBoundary>
  );
}

function EventsClientInner({
  initialShows,
  initialLaborDays,
  initialSubCalls,
  initialAssignments,
  initialAssignmentNotes,
  initialAssignmentChecklists,
  initialTextAutomationSettings,
  initialTextMessageQueue,
  initialTechRatings,
  initialClientFeedbackResponses,
  initialClientFeedbackScores,
  initialFeedbackTechRatings,
  initialBusinessClients,
  initialClientContacts,
  initialCrew,
  masterRates,
  initialSearch = "",
  initialOpenFeedback = false,
}: Props) {
  const router = useRouter();
  const initialShowRows = initialShows.map(sanitizeShow).filter((show) => show.id);
  const initialPendingFeedbackShowId = initialOpenFeedback
    ? [...initialClientFeedbackResponses]
        .filter((response) => !response.excluded_from_ratings && !response.rating_approved)
        .sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""))[0]?.show_id || null
    : null;
  const initialSelectedShowId = initialPendingFeedbackShowId || pickDefaultShowId(initialShowRows);

  const [shows, setShows] = useState(() => initialShowRows);
  const [laborDays, setLaborDays] = useState(() => initialLaborDays.map(sanitizeLaborDay).filter((day) => day.id && day.show_id));
  const [subCalls, setSubCalls] = useState(() => initialSubCalls.map(sanitizeSubCall).filter((call) => call.id && call.labor_day_id));
  const [assignments, setAssignments] = useState(() => initialAssignments.map(sanitizeAssignment).filter((assignment) => assignment.id && assignment.sub_call_id && assignment.crew_id));
  const [assignmentNotes, setAssignmentNotes] = useState(initialAssignmentNotes);
  const [assignmentChecklists, setAssignmentChecklists] = useState(initialAssignmentChecklists);
  const [textAutomationSettings, setTextAutomationSettings] = useState(initialTextAutomationSettings);
  const [textMessageQueue, setTextMessageQueue] = useState(initialTextMessageQueue);
  const [techRatings, setTechRatings] = useState(initialTechRatings);
  const [clientFeedbackResponses, setClientFeedbackResponses] = useState(initialClientFeedbackResponses);
  const [clientFeedbackScores] = useState(initialClientFeedbackScores);
  const [feedbackTechRatings] = useState(initialFeedbackTechRatings);
  const [connectedFeedbackLinks, setConnectedFeedbackLinks] = useState<ConnectedFeedbackLink[]>([]);
  const [businessClients] = useState(initialBusinessClients);
  const [clientContacts] = useState(initialClientContacts);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft>(() => defaultAutomationDraft(initialSelectedShowId || ""));
  const [manualReminderDayId, setManualReminderDayId] = useState("");
  const [crewRecords] = useState(() => initialCrew.map(sanitizeCrew).filter((crew) => crew.id));

  const [search, setSearch] = useState(initialSearch);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(() => initialSelectedShowId);
  const [expandedDayIds, setExpandedDayIds] = useState<string[]>(initialLaborDays[0]?.id ? [initialLaborDays[0].id] : []);
  const [crewPickerCallId, setCrewPickerCallId] = useState<string | null>(null);
  const [crewAssignmentCallIds, setCrewAssignmentCallIds] = useState<string[]>([]);
  const [crewSearch, setCrewSearch] = useState("");
  const [crewGroupFilter, setCrewGroupFilter] = useState("All groups");
  const [crewAvailabilityScope, setCrewAvailabilityScope] = useState<CrewAvailabilityScope>("active_day");
  const [noteEditorAssignmentId, setNoteEditorAssignmentId] = useState<string | null>(null);
  const [noteSelections, setNoteSelections] = useState<string[]>([]);
  const [noteCustomText, setNoteCustomText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>("admin_only");
  const [noteApplyAllLaborDays, setNoteApplyAllLaborDays] = useState(false);
  const [noteRatingValue, setNoteRatingValue] = useState(0);
  const [assignmentOverrideDrafts, setAssignmentOverrideDrafts] = useState<Record<string, { start_time: string; end_time: string; day_type: DayType }>>({});
  const [editingAssignmentTimeId, setEditingAssignmentTimeId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [eventDisplayMode, setEventDisplayMode] = useState<EventDisplayMode>(initialOpenFeedback ? "feedback" : "day");
  const [editorMode, setEditorMode] = useState<EditorMode>(null);

  const [showForm, setShowForm] = useState(emptyShow);
  const [dayForm, setDayForm] = useState(emptyDay);
  const [dayBulkDates, setDayBulkDates] = useState<string[]>([]);
  const [dayBulkCalendarMonth, setDayBulkCalendarMonth] = useState("");
  const [dayMultiSelectMode, setDayMultiSelectMode] = useState(false);
  const [callForm, setCallForm] = useState(emptyCall);
  const [callTargetDayIds, setCallTargetDayIds] = useState<string[]>([]);
  const [editingShowId, setEditingShowId] = useState<string | null>(null);
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [editingDayTargetId, setEditingDayTargetId] = useState<string | null>(null);

  const [msg, setMsg] = useState<SaveState>(null);
  const [saving, setSaving] = useState(false);

  const [importMode, setImportMode] = useState<ImportMode>("create");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importForm, setImportForm] = useState(emptyImport);
  const [importPreview, setImportPreview] = useState<ImportPreviewState | null>(null);
  const [importing, setImporting] = useState(false);
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredShows = useMemo(() => {
    const token = normalize(search);
    const sorted = [...shows].sort((a, b) => a.show_start.localeCompare(b.show_start));
    if (!token) return sorted;
    return sorted.filter((show) => {
      const dayIds = laborDays.filter((day) => day.show_id === show.id).map((day) => day.id);
      const showCalls = subCalls.filter((call) => dayIds.includes(call.labor_day_id));
      const showAssignmentCrewIds = assignments.filter((assignment) => showCalls.some((call) => call.id === assignment.sub_call_id)).map((assignment) => assignment.crew_id);
      const showCrew = crewRecords.filter((crew) => showAssignmentCrewIds.includes(crew.id));
      return normalize([
        show.name,
        show.client,
        show.venue,
        show.rate_city,
        showBucket(show),
        ...laborDays.filter((day) => day.show_id === show.id).map((day) => `${day.labor_date} ${day.label} ${day.notes}`),
        ...showCalls.map((call) => `${call.area} ${call.location || ""} ${call.role_name} ${call.notes}`),
        ...showCrew.map((crew) => `${crew.name} ${crew.phone} ${crew.email} ${crew.city_name}`),
      ].join(" ")).includes(token);
    });
  }, [shows, laborDays, subCalls, assignments, crewRecords, search]);

  const showsByBucket = useMemo(
    () => ({
      Upcoming: filteredShows.filter((show) => showBucket(show) === "Upcoming"),
      Current: filteredShows.filter((show) => showBucket(show) === "Current"),
      Past: filteredShows.filter((show) => showBucket(show) === "Past"),
    }),
    [filteredShows]
  );

  const selectedShow = shows.find((show) => show.id === selectedShowId) ?? filteredShows[0] ?? null;
  const selectedShowNoteParts = useMemo(() => splitShowNotes(selectedShow?.notes || ""), [selectedShow?.notes]);
  const dayCalendarMonth = useMemo(() => dayBulkCalendarMonth || dayForm.labor_date.slice(0, 7) || selectedShow?.show_start?.slice(0, 7) || new Date().toISOString().slice(0, 7), [dayBulkCalendarMonth, dayForm.labor_date, selectedShow?.show_start]);
  const dayCalendarDays = useMemo(() => buildMonthCalendarDays(dayCalendarMonth), [dayCalendarMonth]);
  const selectedLaborDateSet = useMemo(() => new Set([dayForm.labor_date, ...dayBulkDates].filter(Boolean)), [dayForm.labor_date, dayBulkDates]);

  const selectedShowMessageMeta = selectedShowNoteParts.meta;
  const selectedAutomation = useMemo(() => {
    if (!selectedShow) return null;
    return textAutomationSettings.find((row) => row.show_id === selectedShow.id) ?? null;
  }, [selectedShow, textAutomationSettings]);

  const crewById = useMemo(() => {
    return new Map(crewRecords.map((crew) => [crew.id, crew]));
  }, [crewRecords]);

  const assignmentsByCallId = useMemo(() => {
    const map = new Map<string, Array<{ assignment: AssignmentRecord; originalIndex: number }>>();
    assignments.forEach((assignment, originalIndex) => {
      const rows = map.get(assignment.sub_call_id) || [];
      rows.push({ assignment, originalIndex });
      map.set(assignment.sub_call_id, rows);
    });
    return map;
  }, [assignments]);

  const assignmentCrewCallKeys = useMemo(() => {
    return new Set(assignments.map((assignment) => `${assignment.sub_call_id}:${assignment.crew_id}`));
  }, [assignments]);

  const assignmentNotesById = useMemo(() => {
    const map = new Map<string, AssignmentNoteRecord[]>();
    assignmentNotes.forEach((note) => {
      if (!note.assignment_id) return;
      const rows = map.get(note.assignment_id) || [];
      rows.push(note);
      map.set(note.assignment_id, rows);
    });
    return map;
  }, [assignmentNotes]);

  const showTechRatingByCrewId = useMemo(() => {
    const map = new Map<string, TechRatingRecord>();
    if (!selectedShow?.id) return map;
    techRatings.forEach((row) => {
      if (row.show_id === selectedShow.id && row.rating_source !== "client_feedback" && !map.has(row.crew_id)) {
        map.set(row.crew_id, row);
      }
    });
    return map;
  }, [techRatings, selectedShow?.id]);

  const sharedShortcutToken = useMemo(() => {
    return textAutomationSettings.find((row) => row.sending_method === "shortcut" && row.shortcut_token)?.shortcut_token || "";
  }, [textAutomationSettings]);

  const selectedTextQueue = useMemo(() => {
    if (!selectedShow) return [] as TextMessageQueueRecord[];
    return textMessageQueue.filter((row) => row.show_id === selectedShow.id);
  }, [selectedShow, textMessageQueue]);

  const selectedShowLaborDays = useMemo(() => {
    if (!selectedShow) return [] as LaborDayRecord[];
    return laborDays
      .filter((day) => day.show_id === selectedShow.id)
      .sort((a, b) => a.labor_date.localeCompare(b.labor_date));
  }, [selectedShow, laborDays]);

  useEffect(() => {
    if (!selectedShowLaborDays.length) {
      setManualReminderDayId("");
      return;
    }
    setManualReminderDayId((current) => selectedShowLaborDays.some((day) => day.id === current) ? current : selectedShowLaborDays[0].id);
  }, [selectedShowLaborDays]);

  const selectedBusinessClient = useMemo(() => {
    if (!selectedShow?.business_client_id) return null;
    return businessClients.find((client) => client.id === selectedShow.business_client_id) ?? null;
  }, [selectedShow, businessClients]);

  const selectedClientContact = useMemo(() => {
    if (!selectedShow?.client_contact_id) return null;
    return clientContacts.find((contact) => contact.id === selectedShow.client_contact_id) ?? null;
  }, [selectedShow, clientContacts]);

  const activeShowClientContacts = useMemo(() => {
    const clientId = showForm.business_client_id || selectedShow?.business_client_id || "";
    return clientContacts.filter((contact) => contact.client_id === clientId);
  }, [clientContacts, showForm.business_client_id, selectedShow?.business_client_id]);

  const activeRateCity = selectedShow?.rate_city || showForm.rate_city || "Default";
  const subCallPositionOptions = useMemo(() => positionOptionsForRateCity(masterRates, activeRateCity), [masterRates, activeRateCity]);
  const selectedCallPosition = useMemo(() => findPositionOption(subCallPositionOptions, callForm.role_name, callForm.master_rate_id), [subCallPositionOptions, callForm.role_name, callForm.master_rate_id]);

  useEffect(() => {
    if (!callForm.master_rate_id && selectedCallPosition?.id) {
      setCallForm((current) => ({ ...current, master_rate_id: selectedCallPosition.id, role_name: selectedCallPosition.role_name }));
    }
  }, [callForm.master_rate_id, selectedCallPosition?.id, selectedCallPosition?.role_name]);

  useEffect(() => {
    const nextDraft = selectedShow ? automationDraftFromRecord(selectedShow.id, selectedAutomation) : defaultAutomationDraft("");
    if (nextDraft.sending_method === "shortcut" && !nextDraft.shortcut_token && sharedShortcutToken) {
      nextDraft.shortcut_token = sharedShortcutToken;
    }
    setAutomationDraft(nextDraft);
  }, [selectedShow?.id, selectedAutomation, sharedShortcutToken]);

  const visibleLaborDays = useMemo(() => {
    if (!selectedShow) return [] as LaborDayRecord[];
    return laborDays
      .filter((day) => day.show_id === selectedShow.id)
      .sort((a, b) => a.labor_date.localeCompare(b.labor_date));
  }, [laborDays, selectedShow]);

  const estimate = useMemo(() => {
    if (!selectedShow) return 0;
    const rateCity = selectedShow.rate_city || "Default";
    const allDayIds = laborDays.filter((day) => day.show_id === selectedShow.id).map((day) => day.id);
    const allCalls = subCalls.filter((call) => allDayIds.includes(call.labor_day_id));

    return Math.round(allCalls.reduce((sum, call) => {
      const rate = rateForCall(call, rateCity, masterRates);
      const assignedCount = assignments.filter((assignment) => assignment.sub_call_id === call.id).length;
      const count = assignedCount > 0 ? assignedCount : Math.max(1, Number(call.crew_needed || 0));
      return sum + rate * count;
    }, 0) * 100) / 100;
  }, [selectedShow, laborDays, subCalls, assignments, masterRates]);

  const activeCrewCall = subCalls.find((call) => call.id === crewPickerCallId) ?? null;
  const activeCrewDay = activeCrewCall
    ? laborDays.find((day) => day.id === activeCrewCall.labor_day_id) ?? null
    : null;
  const eventPool = resolveEventPool(selectedShow, crewRecords);

  const laborDayById = useMemo(() => new Map(laborDays.map((day) => [day.id, day])), [laborDays]);
  const subCallById = useMemo(() => new Map(subCalls.map((call) => [call.id, call])), [subCalls]);
  const showById = useMemo(() => new Map(shows.map((show) => [show.id, show])), [shows]);

  function sameAssignmentPattern(a: SubCallRecord, b: SubCallRecord) {
    const areaMatches = normalize(a.area) === normalize(b.area);
    const timeMatches = safeText(a.start_time) === safeText(b.start_time) && safeText(a.end_time) === safeText(b.end_time);
    const exactRateMatches = Boolean(a.master_rate_id && b.master_rate_id && a.master_rate_id === b.master_rate_id);
    const aKeys = roleKeys(a.role_name);
    const bKeys = roleKeys(b.role_name);
    const roleMatches = exactRateMatches || [...aKeys].some((key) => bKeys.has(key));
    return areaMatches && timeMatches && roleMatches;
  }

  const matchingCrewAssignmentCalls = useMemo(() => {
    if (!activeCrewCall) return [] as Array<{ day: LaborDayRecord; call: SubCallRecord }>;
    const dayIds = new Set(visibleLaborDays.map((day) => day.id));
    return subCalls
      .filter((call) => dayIds.has(call.labor_day_id) && sameAssignmentPattern(activeCrewCall, call))
      .map((call) => ({ day: laborDayById.get(call.labor_day_id)!, call }))
      .filter((item) => Boolean(item.day))
      .sort((a, b) => a.day.labor_date.localeCompare(b.day.labor_date));
  }, [activeCrewCall, visibleLaborDays, subCalls, laborDayById]);

  const crewAssignmentTargetCallIds = useMemo(() => {
    if (!activeCrewCall) return [] as string[];
    const valid = new Set(matchingCrewAssignmentCalls.map((item) => item.call.id));
    const selected = crewAssignmentCallIds.filter((id) => valid.has(id));
    return selected.length ? selected : [activeCrewCall.id];
  }, [activeCrewCall, matchingCrewAssignmentCalls, crewAssignmentCallIds]);

  const crewAssignmentTargetDates = useMemo(() => {
    return [...new Set(crewAssignmentTargetCallIds.map((id) => laborDayById.get(subCallById.get(id)?.labor_day_id || "")?.labor_date).filter(Boolean) as string[])].sort();
  }, [crewAssignmentTargetCallIds, laborDayById, subCallById]);

  const crewAvailabilityDates = useMemo(() => {
    if (!activeCrewDay) return [] as string[];
    if (crewAvailabilityScope === "off") return [] as string[];
    if (crewAvailabilityScope === "selected_show") {
      const dates = visibleLaborDays.map((day) => day.labor_date).filter(Boolean);
      return [...new Set(dates)].sort();
    }
    return crewAssignmentTargetDates.length ? crewAssignmentTargetDates : [activeCrewDay.labor_date];
  }, [activeCrewDay, crewAvailabilityScope, visibleLaborDays, crewAssignmentTargetDates]);

  function bookingConflictsForCrew(crewId: string, dates: string[], ignoreSubCallIds?: string | string[]) {
    if (!dates.length) return [] as Array<{ date: string; showName: string; callLabel: string }>;
    const dateSet = new Set(dates);
    const ignored = new Set(Array.isArray(ignoreSubCallIds) ? ignoreSubCallIds : ignoreSubCallIds ? [ignoreSubCallIds] : []);
    return assignments
      .filter((assignment) => assignment.crew_id === crewId && !ignored.has(assignment.sub_call_id))
      .map((assignment) => {
        const call = subCallById.get(assignment.sub_call_id);
        const day = call ? laborDayById.get(call.labor_day_id) : null;
        const show = day ? showById.get(day.show_id) : null;
        if (!call || !day || !dateSet.has(day.labor_date)) return null;
        return {
          date: day.labor_date,
          showName: show?.name || "Another show",
          callLabel: `${formatMessageTimeRange(call)} · ${call.role_name} · ${boothLabel(call.area)}`,
        };
      })
      .filter((item): item is { date: string; showName: string; callLabel: string } => Boolean(item));
  }

  const assignedCrew = useMemo(() => {
    if (!activeCrewCall) return [] as Array<{ assignment: AssignmentRecord; crew: CrewRecord | undefined }>;
    const targetIds = new Set(crewAssignmentTargetCallIds.length ? crewAssignmentTargetCallIds : [activeCrewCall.id]);
    return assignments
      .filter((assignment) => targetIds.has(assignment.sub_call_id))
      .map((assignment) => ({
        assignment,
        crew: crewById.get(assignment.crew_id),
      }));
  }, [assignments, crewById, activeCrewCall, crewAssignmentTargetCallIds]);

  const poolGroups = useMemo(() => {
    const poolCrew = crewRecords.filter((crew) => crewMatchesEventPool(crew, eventPool || ""));
    const groups: string[] = [...new Set(poolCrew.map((crew) => crew.group_name || "Ungrouped"))].sort((a, b) => a.localeCompare(b));
    return ["All groups", ...groups];
  }, [crewRecords, eventPool]);

  const availableCrew = useMemo(() => {
    if (!activeCrewCall || !activeCrewDay) return [] as CrewRecord[];
    const token = normalize(crewSearch);
    const targetIds = crewAssignmentTargetCallIds.length ? crewAssignmentTargetCallIds : [activeCrewCall.id];
    const alreadyAssignedToEveryTarget = new Set(
      crewRecords
        .filter((crew) => targetIds.every((callId) => assignmentCrewCallKeys.has(`${callId}:${crew.id}`)))
        .map((crew) => crew.id)
    );

    const poolCrew = crewRecords.filter((crew) => {
      if (alreadyAssignedToEveryTarget.has(crew.id)) return false;
      if (crew.blacklisted) return false;
      if (!crewMatchesEventPool(crew, eventPool || "")) return false;
      if (crewGroupFilter !== "All groups" && (crew.group_name || "Ungrouped") !== crewGroupFilter) return false;

      if (crewAvailabilityScope !== "off") {
        const unavailableOnDate = crewAvailabilityDates.some((date) => (crew.unavailable_dates ?? []).includes(date));
        if (unavailableOnDate) return false;
        if (bookingConflictsForCrew(crew.id, crewAvailabilityDates, activeCrewCall.id).length) return false;
      }

      if (!token) return true;
      return normalize([
        crew.name,
        crew.city_name,
        ...(crew.additional_city_pool_names ?? []),
        crew.group_name,
        crew.tier,
        crew.email,
        crew.phone,
        crew.notes,
        crew.positions.map((position) => position.role_name).join(" "),
      ].join(" ")).includes(token);
    });

    const ratingStatsForCrew = (crewId: string) => {
      const clientId = selectedShow?.business_client_id || "";
      const contactId = selectedShow?.client_contact_id || "";
      const contactRows = techRatings.filter(
        (row) => row.crew_id === crewId && Boolean(contactId && row.client_contact_id === contactId),
      );
      const clientRows = techRatings.filter(
        (row) => row.crew_id === crewId && Boolean(clientId && row.client_id === clientId),
      );
      const contactMedian = medianRating(contactRows.map((row) => row.rating));
      const clientMedian = medianRating(clientRows.map((row) => row.rating));
      const score = contactMedian || clientMedian || 0;
      const count = (contactMedian ? contactRows.length : 0) + clientRows.length;
      return { score, contactMedian, clientMedian, count };
    };

    return poolCrew.sort((a, b) => {
      const aRating = ratingStatsForCrew(a.id);
      const bRating = ratingStatsForCrew(b.id);
      if (aRating.score !== bRating.score) return bRating.score - aRating.score;
      if (aRating.count !== bRating.count) return bRating.count - aRating.count;
      const aMatch = matchesRole(a, activeCrewCall.role_name) ? 1 : 0;
      const bMatch = matchesRole(b, activeCrewCall.role_name) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return a.name.localeCompare(b.name);
    });
  }, [activeCrewCall, activeCrewDay, crewAssignmentTargetCallIds, crewGroupFilter, crewRecords, crewSearch, eventPool, crewAvailabilityScope, crewAvailabilityDates, assignmentCrewCallKeys, subCallById, laborDayById, showById, selectedShow?.business_client_id, selectedShow?.client_contact_id, techRatings]);

  const displayCalls = useMemo(() => {
    return visibleLaborDays
      .flatMap((day) =>
        subCalls
          .filter((call) => call.labor_day_id === day.id)
          .map((call) => ({
            day,
            call,
            callAssignments: (assignmentsByCallId.get(call.id) || []).map(({ assignment }) => ({
              assignment,
              crew: crewById.get(assignment.crew_id),
            })),
          }))
      )
      .sort((a, b) => {
        const dateCompare = a.day.labor_date.localeCompare(b.day.labor_date);
        if (dateCompare !== 0) return dateCompare;
        const areaCompare = boothLabel(a.call.area).localeCompare(boothLabel(b.call.area));
        if (areaCompare !== 0) return areaCompare;
        return a.call.start_time.localeCompare(b.call.start_time);
      });
  }, [visibleLaborDays, subCalls, assignmentsByCallId, crewById]);

  const boothSections = useMemo(() => {
    const map = new Map<string, typeof displayCalls>();
    for (const item of displayCalls) {
      const key = boothLabel(item.call.area);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()]
      .map(([booth, calls]) => ({
        booth,
        calls: calls.sort((a, b) => {
          const dateCompare = a.day.labor_date.localeCompare(b.day.labor_date);
          if (dateCompare !== 0) return dateCompare;
          return a.call.start_time.localeCompare(b.call.start_time);
        }),
      }))
      .sort((a, b) => a.booth.localeCompare(b.booth));
  }, [displayCalls]);

  const areaAccentMap = useMemo(() => {
    return createAreaAccentMap(boothSections.map((section) => section.booth));
  }, [boothSections]);

  const crewScheduleMessages = useMemo(() => {
    if (!selectedShow) return [] as Array<{ crewId: string; crewName: string; phone: string; text: string }>;

    const byCrew = new Map<string, { crew: CrewRecord | undefined; calls: Array<{ day: LaborDayRecord; call: SubCallRecord; assignment: AssignmentRecord }> }>();
    for (const item of displayCalls) {
      for (const assignment of item.callAssignments) {
        const existing = byCrew.get(assignment.assignment.crew_id) ?? { crew: assignment.crew, calls: [] };
        existing.calls.push({ day: item.day, call: item.call, assignment: assignment.assignment });
        byCrew.set(assignment.assignment.crew_id, existing);
      }
    }

    const { venueName, address } = splitVenueAndAddress(selectedShow.venue);
    const showName = selectedShow.name || "ELS Show";
    const rateCity = selectedShow.rate_city || "Default";
    const meta = eventMessageMeta(selectedShow);

    return [...byCrew.entries()]
      .map(([crewId, item]) => {
        const sortedCalls = item.calls.sort((a, b) => `${a.day.labor_date} ${assignmentStart(a.assignment, a.call)} ${a.call.area}`.localeCompare(`${b.day.labor_date} ${assignmentStart(b.assignment, b.call)} ${b.call.area}`));
        const crewName = item.crew?.name || crewId;
        const primaryArea = boothLabel(sortedCalls[0]?.call.area || "Schedule");
        const firstCall = sortedCalls[0]?.call;
        const callRates = sortedCalls.map(({ call }) => messageRateLabelForCall(item.crew, call, rateCity, masterRates));
        const uniqueRates = [...new Set(callRates)];
        const savedHourlyRate = Number(meta.default_hourly_rate);
        const rateLine = uniqueRates.length === 1
          ? uniqueRates[0]
          : Number.isFinite(savedHourlyRate) && savedHourlyRate > 0
            ? `Default rate: $${savedHourlyRate % 1 === 0 ? savedHourlyRate.toFixed(0) : savedHourlyRate.toFixed(2)}/hr`
            : "Rate: See schedule by day/area";
        const scheduleLines = sortedCalls.map(({ day, call, assignment }) => {
          const locationText = call.location ? ` – ${call.location}` : "";
          const blockText = dayTypeLabel(assignmentDayType(assignment, call));
          return `${formatMessageDate(day.labor_date)} – ${formatAssignmentMessageTimeRange(assignment, call)} – ${call.role_name} – ${boothLabel(call.area)}${locationText} – ${blockText} – ${messageRateLabelForCall(item.crew, call, rateCity, masterRates).replace(/^Rate:\s*/i, "")}`;
        });
        const coordinatorName = meta.coordinator_name || "Storm Leigh";
        const coordinatorPhone = meta.coordinator_phone || "504-657-6618";
        const coordinatorLine = `Coordinator: ${coordinatorName}\n${formatPhone(coordinatorPhone)}`;
        const leadCall = displayCalls.find(({ call }) => normalize(call.role_name).includes("crew lead") || normalize(call.role_name) === "lead");
        const leadAssignment = leadCall?.callAssignments[0];
        const reportTo = meta.crew_lead_name
          ? `Report To: ${meta.crew_lead_name}, Crew Lead${meta.crew_lead_phone ? `\n${formatPhone(meta.crew_lead_phone)}` : ""}`
          : leadAssignment?.crew
            ? `Report To: ${leadAssignment.crew.name}, Crew Lead\n${formatPhone(leadAssignment.crew.phone)}`
            : "Report To: Onsite lead / coordinator";

        const text = [
          `${showName} – ${primaryArea}`,
          "",
          `Hi ${firstName(crewName)} – ${showName} @ ${venueName}`,
          "",
          address || selectedShow.rate_city || "",
          "",
          `Meet-up Location: ${meta.meet_up_location || "____________________"}`,
          "",
          rateLine,
          "",
          "Schedule:",
          ...scheduleLines,
          "",
          "Attire: Black polo, black pants, and black shoes. Please arrive clean, well-groomed, and professionally presented, as requested by the client.",
          "",
          coordinatorLine,
          "",
          reportTo,
          "",
          "Please confirm.",
        ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");

        return { crewId, crewName, phone: item.crew?.phone || "", text };
      })
      .sort((a, b) => a.crewName.localeCompare(b.crewName));
  }, [selectedShow, displayCalls, masterRates]);

  const checklistRows = useMemo(() => {
    if (!selectedShow) return [] as Array<{
      crewId: string;
      crewName: string;
      phone: string;
      firstSchedule: string;
      checklist: AssignmentChecklistRecord | null;
    }>;

    const seen = new Map<string, { crew: CrewRecord | undefined; calls: Array<{ day: LaborDayRecord; call: SubCallRecord; assignment: AssignmentRecord }> }>();
    for (const item of displayCalls) {
      for (const assignment of item.callAssignments) {
        const current = seen.get(assignment.assignment.crew_id) ?? { crew: assignment.crew, calls: [] };
        current.calls.push({ day: item.day, call: item.call, assignment: assignment.assignment });
        seen.set(assignment.assignment.crew_id, current);
      }
    }

    return [...seen.entries()].map(([crewId, item]) => {
      const sortedCalls = item.calls.sort((a, b) => `${a.day.labor_date} ${assignmentStart(a.assignment, a.call)} ${a.call.area}`.localeCompare(`${b.day.labor_date} ${assignmentStart(b.assignment, b.call)} ${b.call.area}`));
      const first = sortedCalls[0];
      const checklist = assignmentChecklists.find((row) => row.show_id === selectedShow.id && row.crew_id === crewId) ?? null;
      return {
        crewId,
        crewName: item.crew?.name || crewId,
        phone: item.crew?.phone || "",
        firstSchedule: first ? `${formatMessageDate(first.day.labor_date)} · ${formatAssignmentMessageTimeRange(first.assignment, first.call)} · ${first.call.role_name} · ${boothLabel(first.call.area)}` : "No schedule",
        checklist,
      };
    });
  }, [selectedShow, displayCalls, assignmentChecklists]);

  const checklistText = useMemo(() => {
    return checklistRows.map((row) => {
      const sent = row.checklist?.schedule_sent ? "☑" : "☐";
      const confirmed = row.checklist?.confirmed ? "☑" : "☐";
      const dayBefore = row.checklist?.day_before_confirmed ? "☑" : "☐";
      return `${row.crewName}\n  ${sent} Sent schedule   ${confirmed} Confirmed   ${dayBefore} Day-before confirmation`;
    }).join("\n\n");
  }, [checklistRows]);


  const ratingRows = useMemo(() => {
    if (!selectedShow) return [] as FeedbackCrewRow[];
    const seen = new Map<string, { crew: CrewRecord | undefined; assignmentId: string | null; calls: Array<{ day: LaborDayRecord; call: SubCallRecord }> }>();
    for (const item of displayCalls) {
      for (const assignment of item.callAssignments) {
        const current = seen.get(assignment.assignment.crew_id) ?? { crew: assignment.crew, assignmentId: assignment.assignment.id, calls: [] };
        current.calls.push({ day: item.day, call: item.call });
        if (!current.assignmentId) current.assignmentId = assignment.assignment.id;
        seen.set(assignment.assignment.crew_id, current);
      }
    }
    return [...seen.entries()]
      .map(([crewId, item]) => {
        const sortedCalls = item.calls.sort((a, b) => `${a.day.labor_date} ${a.call.start_time} ${a.call.area}`.localeCompare(`${b.day.labor_date} ${b.call.start_time} ${b.call.area}`));
        const first = sortedCalls[0];
        return {
          crewId,
          crewName: item.crew?.name || crewId,
          phone: item.crew?.phone || "",
          email: item.crew?.email || "",
          firstSchedule: first ? `${formatMessageDate(first.day.labor_date)} · ${formatMessageTimeRange(first.call)} · ${first.call.role_name} · ${boothLabel(first.call.area)}` : "No schedule",
          assignmentId: item.assignmentId,
          rating: techRatings.find((row) => row.show_id === selectedShow.id && row.crew_id === crewId && row.rating_source !== "client_feedback") ?? null,
          isCrewLeadAssignment: item.calls.some(({ call }) => isCrewLeadFeedbackRole(call.role_name)),
        };
      })
      .sort((a, b) => a.crewName.localeCompare(b.crewName));
  }, [selectedShow, displayCalls, techRatings]);

  const clientTopTechs = useMemo(() => {
    const clientId = selectedShow?.business_client_id || "";
    if (!clientId) return [] as TopTechItem[];
    return buildMedianTopTechs(techRatings.filter((row) => row.client_id === clientId), crewRecords, 10);
  }, [selectedShow?.business_client_id, techRatings, crewRecords]);

  const projectManagerTopTechs = useMemo(() => {
    const contactId = selectedShow?.client_contact_id || "";
    if (!contactId) return [] as TopTechItem[];
    return buildMedianTopTechs(techRatings.filter((row) => row.client_contact_id === contactId), crewRecords, 10);
  }, [selectedShow?.client_contact_id, techRatings, crewRecords]);

  const feedbackForms = useMemo(() => {
    if (!selectedShow) return [] as FeedbackFormItem[];
    const showTitle = selectedShow.name || "ELS Show";
    const clientName = selectedBusinessClient?.name || selectedShow.client || "Client";
    const venue = selectedShow.venue || "Venue";
    const makeForm = (partial: Omit<FeedbackFormItem, "text">): FeedbackFormItem => ({
      ...partial,
      text: buildFriendlyFeedbackText(partial, selectedShow, clientName, venue),
    });

    const projectManagerTarget = selectedClientContact?.name ? `Project Manager / Overall Event Contact - ${selectedClientContact.name}` : "Project Manager / Overall Event Contact";
    const forms: FeedbackFormItem[] = [makeForm({
      key: "project-manager",
      kind: "project-manager",
      title: `${showTitle} Project Manager Quick Survey`,
      subtitle: "Overall event survey with planning, billing, on-site experience, testimonial, and tech feedback sections.",
      target: projectManagerTarget,
      intro: "A short overall-event survey for the project manager. Most answers are quick 5-star ratings with optional comments.",
      managerLabel: "Your name",
      crewRows: ratingRows,
    })];

    if (selectedShowMessageMeta.crew_lead_name || ratingRows.length) {
      const target = selectedShowMessageMeta.crew_lead_name
        ? `Crew Lead - ${selectedShowMessageMeta.crew_lead_name}`
        : "Crew Lead";
      forms.push(makeForm({
        key: "crew-lead",
        kind: "crew-lead",
        title: `${showTitle} Crew Lead Quick Survey`,
        subtitle: "Simple crew-lead survey covering show flow, client satisfaction, improvements, and tech ratings.",
        target,
        intro: "A short crew-lead survey for show feedback, improvements, client satisfaction, workflow, and tech ratings.",
        managerLabel: "Crew lead name",
        crewRows: ratingRows.filter((row) => !row.isCrewLeadAssignment),
      }));
    }

    for (const section of boothSections) {
      const crewMap = new Map<string, FeedbackCrewRow>();
      for (const item of section.calls) {
        for (const assignment of item.callAssignments) {
          const row = ratingRows.find((ratingRow) => ratingRow.crewId === assignment.assignment.crew_id);
          if (row) crewMap.set(row.crewId, row);
        }
      }
      const areaRows = [...crewMap.values()].sort((a, b) => a.crewName.localeCompare(b.crewName));
      const target = `Booth / Area Manager - ${section.booth}`;
      forms.push(makeForm({
        key: `area-${feedbackSafeId(section.booth)}`,
        kind: "area-manager",
        title: `${showTitle} ${section.booth} Booth / Area Manager Quick Survey`,
        subtitle: "Area-specific survey with on-site experience, staff competence, testimonial permission, and tech notes.",
        target,
        intro: "A short booth/area manager survey focused only on this area and the techs assigned there.",
        managerLabel: "Booth / area manager name",
        areaName: section.booth,
        crewRows: areaRows,
      }));
    }
    return forms;
  }, [selectedShow, selectedBusinessClient, selectedClientContact, selectedShowMessageMeta.crew_lead_name, boothSections, ratingRows]);

  const selectedFeedbackResponses = useMemo(() => {
    if (!selectedShow) return [] as ClientFeedbackResponseRecord[];
    return clientFeedbackResponses
      .filter((response) => response.show_id === selectedShow.id)
      .sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""));
  }, [selectedShow, clientFeedbackResponses]);

  const feedbackScoresByResponseId = useMemo(() => {
    const map = new Map<string, ClientFeedbackScoreRecord[]>();
    for (const score of clientFeedbackScores) {
      const current = map.get(score.response_id) ?? [];
      current.push(score);
      map.set(score.response_id, current);
    }
    return map;
  }, [clientFeedbackScores]);

  const feedbackTechRatingsByResponseId = useMemo(() => {
    const map = new Map<string, FeedbackTechRatingRecord[]>();
    for (const rating of feedbackTechRatings) {
      const current = map.get(rating.response_id) ?? [];
      current.push(rating);
      map.set(rating.response_id, current);
    }
    return map;
  }, [feedbackTechRatings]);

  const submittedFeedbackPendingCount = selectedFeedbackResponses.filter((response) => !response.excluded_from_ratings && !response.rating_approved).length;
  const submittedFeedbackApprovedCount = selectedFeedbackResponses.filter((response) => !response.excluded_from_ratings && response.rating_approved).length;
  const submittedFeedbackExcludedCount = selectedFeedbackResponses.filter((response) => response.excluded_from_ratings).length;

  const workerNoteSummaries = useMemo(() => {
    if (!selectedShow) return [] as Array<{ crewId: string; crewName: string; phone: string; notes: AssignmentNoteRecord[] }>;
    const seen = new Map<string, { crew: CrewRecord | undefined; notes: AssignmentNoteRecord[] }>();
    for (const item of displayCalls) {
      for (const assignment of item.callAssignments) {
        const current = seen.get(assignment.assignment.crew_id) ?? { crew: assignment.crew, notes: [] };
        current.notes = assignmentNotes.filter((note) => note.show_id === selectedShow.id && note.crew_member_id === assignment.assignment.crew_id);
        seen.set(assignment.assignment.crew_id, current);
      }
    }
    return [...seen.entries()]
      .map(([crewId, item]) => ({
        crewId,
        crewName: item.crew?.name || crewId,
        phone: item.crew?.phone || "",
        notes: item.notes,
      }))
      .filter((item) => item.notes.length > 0)
      .sort((a, b) => a.crewName.localeCompare(b.crewName));
  }, [selectedShow, displayCalls, assignmentNotes]);

  const workerNoteRatingSummaries = useMemo(() => {
    if (!selectedShow) return [] as Array<{ crewId: string; crewName: string; phone: string; notes: AssignmentNoteRecord[]; rating: TechRatingRecord | null }>;
    return ratingRows.map((row) => ({
      crewId: row.crewId,
      crewName: row.crewName,
      phone: row.phone,
      notes: assignmentNotes.filter((note) => note.show_id === selectedShow.id && note.crew_member_id === row.crewId),
      rating: row.rating,
    }));
  }, [selectedShow, ratingRows, assignmentNotes]);

  function getCallAssignments(callId: string) {
    return (assignmentsByCallId.get(callId) || [])
      .map(({ assignment, originalIndex }) => ({
        assignment,
        crew: crewById.get(assignment.crew_id),
        originalIndex,
      }))
      .sort((a, b) => {
        const orderA = Number(a.assignment.sort_order || 0);
        const orderB = Number(b.assignment.sort_order || 0);
        if (orderA !== orderB) return orderA - orderB;
        if (a.originalIndex !== b.originalIndex) return a.originalIndex - b.originalIndex;
        return (a.crew?.name || a.assignment.crew_id).localeCompare(b.crew?.name || b.assignment.crew_id);
      });
  }


  function notesForAssignment(assignmentId: string) {
    return assignmentNotesById.get(assignmentId) || [];
  }

  function notesForCrewOnShow(crewId: string) {
    if (!selectedShow) return [] as AssignmentNoteRecord[];
    return assignmentNotes.filter((note) => note.show_id === selectedShow.id && note.crew_member_id === crewId);
  }

  function noteSummary(notes: AssignmentNoteRecord[], includeVisibility = false) {
    return notes
      .map((note) => {
        const custom = safeText(note.custom_note);
        const base = custom ? `${note.note_label}: ${custom}` : note.note_label;
        return includeVisibility ? `${base} (${noteVisibilityLabels[(note.visibility as NoteVisibility) || "admin_only"] || note.visibility})` : base;
      })
      .join("; ");
  }

  function openNoteEditor(assignment: AssignmentRecord) {
    const nextOpen = noteEditorAssignmentId === assignment.id ? null : assignment.id;
    setNoteEditorAssignmentId(nextOpen);
    setNoteSelections([]);
    setNoteCustomText("");
    setNoteVisibility("admin_only");
    setNoteApplyAllLaborDays(false);
    const existingRating = techRatings.find((row) => row.show_id === selectedShow?.id && row.crew_id === assignment.crew_id);
    setNoteRatingValue(nextOpen ? Number(existingRating?.rating || 0) : 0);
  }

  function toggleNoteSelection(code: string) {
    setNoteSelections((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
    if (sensitiveNoteCodes.has(code)) setNoteVisibility("admin_only");
  }

  function showAssignmentIdsForCrew(crewId: string) {
    const ids = displayCalls.flatMap((item) => item.callAssignments
      .filter(({ assignment }) => assignment.crew_id === crewId)
      .map(({ assignment }) => assignment.id));
    return [...new Set(ids)];
  }

  async function saveWorkerNotes(assignment: AssignmentRecord) {
    if (!selectedShow) return;
    const selectedNotes = noteSelections.map((code) => {
      const option = workerNoteOptions.find((item) => item.code === code);
      return {
        note_code: option?.code || code,
        note_label: option?.label || code,
        custom_note: "",
      };
    });
    const custom = safeText(noteCustomText);
    const notes = custom ? [...selectedNotes, { note_code: "custom", note_label: "Custom note", custom_note: custom }] : selectedNotes;
    if (!notes.length) {
      setMsg({ kind: "error", text: "Choose at least one note or enter a custom note." });
      return;
    }
    const targetAssignmentIds = noteApplyAllLaborDays ? showAssignmentIdsForCrew(assignment.crew_id) : [assignment.id];
    const data = await request("/api/assignment-notes", "POST", {
      show_id: selectedShow.id,
      crew_member_id: assignment.crew_id,
      assignment_id: assignment.id,
      assignment_ids: targetAssignmentIds,
      visibility: noteVisibility,
      notes,
    });
    if (data?.rows) {
      setAssignmentNotes((current) => [...current, ...(data.rows as AssignmentNoteRecord[])]);
      setNoteSelections([]);
      setNoteCustomText("");
      setNoteApplyAllLaborDays(false);
      setNoteRatingValue(0);
      setNoteEditorAssignmentId(null);
      setMsg({ kind: "success", text: noteApplyAllLaborDays ? "Note applied to all labor days for this person." : "Worker note saved." });
    }
  }

  async function deleteWorkerNote(noteId: string) {
    await request(`/api/assignment-notes/${noteId}`, "DELETE");
    setAssignmentNotes((current) => current.filter((note) => note.id !== noteId));
  }

  function renderWorkerNotes(notes: AssignmentNoteRecord[]) {
    if (!notes.length) return null;
    return (
      <div className="small" style={{ marginTop: 6 }}>
        <strong>Notes:</strong> {notes.map((note) => (
          <span key={note.id} className="badge" style={{ marginLeft: 6 }}>
            {note.custom_note ? `${note.note_label}: ${note.custom_note}` : note.note_label}
            <span className="muted"> · {noteVisibilityLabels[(note.visibility as NoteVisibility) || "admin_only"] || note.visibility}</span>
            <button type="button" className="ghost danger" style={{ marginLeft: 6, padding: "2px 6px" }} onClick={() => deleteWorkerNote(note.id)}>Remove</button>
          </span>
        ))}
      </div>
    );
  }

  async function saveTechRating(row: { crewId: string; assignmentId: string | null }, rating: number, notes?: string) {
    if (!selectedShow) return;
    const data = await request("/api/tech-ratings", "POST", {
      show_id: selectedShow.id,
      client_id: selectedShow.business_client_id || null,
      client_contact_id: selectedShow.client_contact_id || null,
      crew_id: row.crewId,
      assignment_id: row.assignmentId,
      rating,
      notes: notes ?? rowRatingNotes(row.crewId),
    });
    if (data?.rating) {
      const nextRating = { ...(data.rating as TechRatingRecord), rating_source: "admin" };
      setTechRatings((current) => {
        const without = current.filter((item) => !(item.show_id === nextRating.show_id && item.crew_id === nextRating.crew_id && item.rating_source !== "client_feedback"));
        return [nextRating, ...without];
      });
    }
  }

  function rowRatingNotes(crewId: string) {
    return techRatings.find((row) => row.show_id === selectedShow?.id && row.crew_id === crewId && row.rating_source !== "client_feedback")?.notes || "";
  }

  function ratingForCrewOnShow(crewId: string) {
    return showTechRatingByCrewId.get(crewId) ?? null;
  }

  async function saveAssignmentTechRating(assignment: AssignmentRecord, rating: number) {
    setNoteRatingValue(rating);
    await saveTechRating({ crewId: assignment.crew_id, assignmentId: assignment.id }, rating);
  }

  async function clearAssignmentTechRating(ratingId: string) {
    setNoteRatingValue(0);
    await clearTechRating(ratingId);
  }

  async function clearTechRating(ratingId: string) {
    await request(`/api/tech-ratings/${ratingId}`, "DELETE");
    setTechRatings((current) => current.filter((row) => row.id !== ratingId));
  }

  async function updateCrewChecklist(crewId: string, field: ChecklistField, checked: boolean) {
    if (!selectedShow) return;
    const data = await request("/api/assignment-checklists", "POST", {
      show_id: selectedShow.id,
      crew_id: crewId,
      field,
      checked,
    });
    if (data?.row) {
      const nextRow = data.row as AssignmentChecklistRecord;
      setAssignmentChecklists((current) => {
        const without = current.filter((row) => !(row.show_id === nextRow.show_id && row.crew_id === nextRow.crew_id));
        return [...without, nextRow];
      });
    }
  }

  async function markAllChecklistField(field: ChecklistField, checked: boolean) {
    if (!selectedShow || !checklistRows.length) return;
    const data = await request("/api/assignment-checklists", "POST", {
      show_id: selectedShow.id,
      crew_ids: checklistRows.map((row) => row.crewId),
      field,
      checked,
    });
    if (data?.rows) {
      const rows = data.rows as AssignmentChecklistRecord[];
      setAssignmentChecklists((current) => {
        const incomingKeys = new Set(rows.map((row) => `${row.show_id}:${row.crew_id}`));
        return [...current.filter((row) => !incomingKeys.has(`${row.show_id}:${row.crew_id}`)), ...rows];
      });
    }
  }

  function renderNoteEditor(assignment: AssignmentRecord) {
    const allLaborDayAssignmentCount = showAssignmentIdsForCrew(assignment.crew_id).length;
    const existingRating = ratingForCrewOnShow(assignment.crew_id);
    const activeRating = noteRatingValue || Number(existingRating?.rating || 0);
    return (
      <div className="card compact" style={{ marginTop: 8, background: "#f9fafb" }}>
        <strong>Notes / show rating</strong>
        <div className="small muted" style={{ marginTop: 4 }}>Rate this tech 1–5 stars for this show and add professional notes when needed. Ratings save to the tech contact, the selected business client, and the selected project manager/contact.</div>
        <div className="card compact" style={{ marginTop: 10, background: "#fff" }}>
          <div className="row" style={{ alignItems: "center" }}>
            <div>
              <strong>Show rating</strong>
              <div className="small muted">{activeRating ? `${activeRating}/5 stars` : "Not rated yet"} {activeRating ? `· ${starDisplay(activeRating)}` : ""}</div>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={activeRating === value ? "primary" : "ghost"}
                  disabled={saving}
                  onClick={() => void saveAssignmentTechRating(assignment, value)}
                  title={`Rate ${value} star${value === 1 ? "" : "s"}`}
                >
                  {value} ★
                </button>
              ))}
              {existingRating ? <button type="button" className="ghost danger" disabled={saving} onClick={() => void clearAssignmentTechRating(existingRating.id)}>Clear rating</button> : null}
            </div>
          </div>
          {!selectedShow?.business_client_id ? (
            <div className="small muted" style={{ marginTop: 8 }}>Choose a saved business client on this event if this rating should count toward a client-specific Top Techs list.</div>
          ) : null}
        </div>
        <div style={{ marginTop: 12 }}>
          <strong>Worker notes</strong>
          <div className="small muted" style={{ marginTop: 4 }}>Select one or more professional notes. Sensitive notes default to admin-only.</div>
        </div>
        <div className="toolbar" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {workerNoteOptions.map((option) => (
            <button
              key={option.code}
              type="button"
              className={noteSelections.includes(option.code) ? "primary" : "ghost"}
              onClick={() => toggleNoteSelection(option.code)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span>Custom note</span>
          <textarea value={noteCustomText} onChange={(e) => setNoteCustomText(e.target.value)} rows={3} placeholder="Optional internal detail..." />
        </label>
        {allLaborDayAssignmentCount > 1 ? (
          <label className="checkbox-row" style={{ marginTop: 10 }}>
            <input type="checkbox" checked={noteApplyAllLaborDays} onChange={(e) => setNoteApplyAllLaborDays(e.target.checked)} />
            <span>Apply this same note to all labor days for this person on this show ({allLaborDayAssignmentCount} assignments)</span>
          </label>
        ) : null}
        <label className="field">
          <span>Visibility</span>
          <select value={noteVisibility} onChange={(e) => setNoteVisibility(e.target.value as NoteVisibility)}>
            {Object.entries(noteVisibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="toolbar">
          <button type="button" className="primary" onClick={() => saveWorkerNotes(assignment)} disabled={saving}>Save Notes</button>
          <button type="button" className="ghost" onClick={() => { setNoteEditorAssignmentId(null); setNoteRatingValue(0); }}>Cancel</button>
        </div>
      </div>
    );
  }

  function defaultCrewAssignmentCallIds(callId: string) {
    const call = subCalls.find((item) => item.id === callId);
    if (!call) return [callId];
    const dayIds = new Set(visibleLaborDays.map((day) => day.id));
    const matches = subCalls
      .filter((item) => dayIds.has(item.labor_day_id) && sameAssignmentPattern(call, item))
      .sort((a, b) => (laborDayById.get(a.labor_day_id)?.labor_date || "").localeCompare(laborDayById.get(b.labor_day_id)?.labor_date || ""))
      .map((item) => item.id);
    return matches.length ? [callId] : [callId];
  }

  function openCrewPickerForCall(callId: string) {
    const closing = crewPickerCallId === callId;
    setCrewPickerCallId(closing ? null : callId);
    setCrewAssignmentCallIds(closing ? [] : defaultCrewAssignmentCallIds(callId));
    setCrewSearch("");
    setCrewGroupFilter("All groups");
    setCrewAvailabilityScope("active_day");
  }

  function renderCrewPicker(call: SubCallRecord) {
    return (
      <div className="card compact" style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <strong>Add Crew</strong>
            <div className="small muted">{call.area} • {call.role_name}</div>
            <div className="small muted">Pool: {eventPool || "All crew"}</div>
          </div>
          <span className="small muted">Recommended order: project-manager rating first, then business-client rating, then unrated crew. Position matches are still marked.</span>
        </div>
        {matchingCrewAssignmentCalls.length > 1 ? (
          <div className="card compact sub-call-multi-day" style={{ marginTop: 10 }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div>
                <strong>Add this crew member to multiple matching days</strong>
                <div className="small muted">Select every matching date this same area/position/time should receive the crew member.</div>
              </div>
              <div className="toolbar">
                <button type="button" className="ghost" onClick={() => setCrewAssignmentCallIds(matchingCrewAssignmentCalls.map((item) => item.call.id))}>Select all</button>
                <button type="button" className="ghost" onClick={() => setCrewAssignmentCallIds([call.id])}>Current day only</button>
              </div>
            </div>
            <div className="grid grid-3" style={{ marginTop: 10 }}>
              {matchingCrewAssignmentCalls.map(({ day, call: matchingCall }) => (
                <label key={matchingCall.id} className="checkline">
                  <input
                    type="checkbox"
                    checked={crewAssignmentTargetCallIds.includes(matchingCall.id)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setCrewAssignmentCallIds((current) => {
                        const next = checked ? [...new Set([...current, matchingCall.id])] : current.filter((id) => id !== matchingCall.id);
                        return next.length ? next : [call.id];
                      });
                    }}
                  />
                  <span>{day.labor_date}{day.label ? ` · ${day.label}` : ""}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <label className="field"><span>Search this pool</span><input value={crewSearch} onChange={(e) => setCrewSearch(e.target.value)} placeholder="Name, group, role, phone..." /></label>
          <label className="field">
            <span>Availability check</span>
            <select value={crewAvailabilityScope} onChange={(e) => setCrewAvailabilityScope(e.target.value as CrewAvailabilityScope)}>
              {Object.entries(crewAvailabilityScopeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        {crewAvailabilityScope !== "off" ? (
          <div className="small muted" style={{ marginTop: 6 }}>
            Hiding crew already assigned, blacklisted, or marked unavailable for {crewAvailabilityDates.length ? crewAvailabilityDates.join(", ") : "this date"}.
          </div>
        ) : (
          <div className="small muted" style={{ marginTop: 6 }}>Booked crew are visible in this search. Use this only when you are intentionally overriding availability.</div>
        )}
        <div className="toolbar" style={{ flexWrap: "wrap", marginTop: 10 }}>
          {poolGroups.map((group) => (
            <button
              key={group}
              type="button"
              className={crewGroupFilter === group ? "primary" : "ghost"}
              onClick={() => setCrewGroupFilter(group)}
            >
              {group}
            </button>
          ))}
        </div>
        <div className="list" style={{ maxHeight: 260, overflowY: "auto", marginTop: 12 }}>
          {availableCrew.length ? availableCrew.map((crew) => {
            const pmMedian = selectedShow?.client_contact_id
              ? medianRating(techRatings.filter((row) => row.client_contact_id === selectedShow.client_contact_id && row.crew_id === crew.id).map((row) => row.rating))
              : 0;
            const clientMedian = selectedShow?.business_client_id
              ? medianRating(techRatings.filter((row) => row.client_id === selectedShow.business_client_id && row.crew_id === crew.id).map((row) => row.rating))
              : 0;
            const score = pmMedian || clientMedian;
            return (
            <div key={crew.id} className="row small">
              <div>
                <strong>{crew.name}</strong>
                <div className="muted">{[crew.city_name, ...(crew.additional_city_pool_names ?? [])].filter(Boolean).join(", ")} • {crew.group_name || "Ungrouped"} • {crew.positions.map((position) => position.role_name).join(", ") || "No saved positions"}</div>
                {score > 0 ? (
                  <div className="small"><strong>Recommended:</strong> {starDisplay(score)} {score.toFixed(1)} median {pmMedian ? "for this project manager" : "for this client"}</div>
                ) : (
                  <div className="small muted">No client rating yet</div>
                )}
                {matchesRole(crew, call.role_name) ? <div className="small">Suggested position match</div> : <div className="small muted">Available in this pool</div>}
              </div>
              <button type="button" className="ghost" disabled={!crewAssignmentTargetCallIds.length} onClick={() => addCrewToCall(crew.id)}>Add to {crewAssignmentTargetCallIds.length || 1} day{(crewAssignmentTargetCallIds.length || 1) === 1 ? "" : "s"}</button>
            </div>
          );}) : <div className="small muted">No available crew in this pool for this search and date filter.</div>}
        </div>
      </div>
    );
  }

  function renderCallCard(day: LaborDayRecord, call: SubCallRecord, showDate = false, callIndex = 0, callCount = 1) {
    const callAssignments = getCallAssignments(call.id);
    const isCrewOpen = crewPickerCallId === call.id;
    return (
      <div key={call.id} className="card compact sub-call-card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <strong>{showDate ? `${day.labor_date} • ` : ""}{formatTimeRange(call)}</strong>
            <div className="small muted">{call.area} • {call.role_name}</div>
            <div className="small muted">{[dayTypeLabel(call.day_type), call.location ? `Location: ${call.location}` : "", call.message_rate ? `Message rate: $${call.message_rate}/hr` : ""].filter(Boolean).join(" • ")}</div>
            <div className="small muted">{callAssignments.length}/{call.crew_needed} assigned</div>
          </div>
          <div className="toolbar">
            <button type="button" className="ghost" disabled={callIndex === 0 || saving} onClick={() => moveSubCallInDay(day.id, call.id, "up")}>Move up</button>
            <button type="button" className="ghost" disabled={callIndex === callCount - 1 || saving} onClick={() => moveSubCallInDay(day.id, call.id, "down")}>Move down</button>
            <button type="button" className="ghost" onClick={() => startEditCall(day.id, call)}>Edit</button>
            <button type="button" className="ghost" onClick={() => openCrewPickerForCall(call.id)}>Add Crew</button>
            <button type="button" className="ghost danger" onClick={() => deleteCall(call.id)}>Delete</button>
          </div>
        </div>

        {editorMode === "call" && editingCallId === call.id ? renderEditorPanel() : null}

        {callAssignments.length ? (
          <div className="list" style={{ marginTop: 10 }}>
            {callAssignments.map(({ assignment, crew }, assignmentIndex) => {
              const workerNotes = notesForAssignment(assignment.id);
              const workerRating = ratingForCrewOnShow(assignment.crew_id);
              const overrideDraft = assignmentOverrideDrafts[assignment.id] || {
                start_time: assignment.start_time || "",
                end_time: assignment.end_time || "",
                day_type: safeDayType(assignment.day_type) || "",
              };
              return (
                <div key={assignment.id} className="card compact" style={{ padding: 10 }}>
                  <div className="row small" style={{ alignItems: "flex-start" }}>
                    <div>
                      <strong>{crew?.name || assignment.crew_id}</strong>
                      <span className="muted"> • {crew?.phone ? formatPhone(crew.phone) : "No phone"} • {assignment.status}</span>
                      <div className={workerRating?.rating ? "small" : "small muted"} style={{ marginTop: 4 }}>
                        <strong>Show rating:</strong> {workerRating?.rating ? `${starDisplay(workerRating.rating)} ${workerRating.rating}/5` : "Not rated"}
                      </div>
                      <div className="small muted" style={{ marginTop: 6 }}>
                        <strong>Worker time:</strong> {formatAssignmentTimeRange(assignment, call)} • {dayTypeLabel(assignmentDayType(assignment, call))}
                      </div>
                      {editingAssignmentTimeId === assignment.id ? (
                        <div className="card compact" style={{ marginTop: 8, padding: 8 }}>
                          <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                            <label className="field"><span>Start</span><input type="time" value={overrideDraft.start_time} placeholder={call.start_time} onChange={(event) => updateAssignmentOverrideDraft(assignment, { start_time: event.target.value })} /></label>
                            <label className="field"><span>End</span><input type="time" value={overrideDraft.end_time} placeholder={call.end_time} onChange={(event) => updateAssignmentOverrideDraft(assignment, { end_time: event.target.value })} /></label>
                            <label className="field"><span>Block</span><select value={overrideDraft.day_type} onChange={(event) => updateAssignmentOverrideDraft(assignment, { day_type: safeDayType(event.target.value) })}><option value="">Use sub-call</option><option value="full_day">Full day</option><option value="half_day">Half day</option><option value="custom">Custom time</option></select></label>
                            <div className="toolbar" style={{ alignItems: "end" }}>
                              <button type="button" className="ghost" disabled={saving} onClick={() => saveAssignmentOverride(assignment)}>Save time</button>
                              <button type="button" className="ghost" disabled={saving} onClick={() => clearAssignmentOverride(assignment)}>Clear</button>
                              <button type="button" className="ghost" disabled={saving} onClick={() => setEditingAssignmentTimeId(null)}>Close</button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      {renderWorkerNotes(workerNotes)}
                    </div>
                    <div className="toolbar">
                      <button type="button" className="ghost" disabled={assignmentIndex === 0 || saving} onClick={() => moveAssignmentInCall(call.id, assignment.id, "up")}>Move up</button>
                      <button type="button" className="ghost" disabled={assignmentIndex === callAssignments.length - 1 || saving} onClick={() => moveAssignmentInCall(call.id, assignment.id, "down")}>Move down</button>
                      <button type="button" className="ghost" onClick={() => setEditingAssignmentTimeId((current) => current === assignment.id ? null : assignment.id)}>{editingAssignmentTimeId === assignment.id ? "Close time" : "Edit time"}</button>
                      <button type="button" className="ghost" onClick={() => openNoteEditor(assignment)}>Notes / Rating</button>
                      <button type="button" className="ghost danger" onClick={() => removeCrewFromCall(assignment.id)}>Remove</button>
                    </div>
                  </div>
                  {noteEditorAssignmentId === assignment.id ? renderNoteEditor(assignment) : null}
                </div>
              );
            })}
          </div>
        ) : <div className="small muted" style={{ marginTop: 10 }}>No crew assigned yet.</div>}

        {isCrewOpen ? renderCrewPicker(call) : null}
      </div>
    );
  }

  function toggleDay(dayId: string) {

    setExpandedDayIds((current) =>
      current.includes(dayId) ? current.filter((id) => id !== dayId) : [...current, dayId]
    );
  }

  function startAddEvent() {
    setViewMode("edit");
    setEditorMode("show");
    setEditingShowId(null);
    setShowForm(emptyShow);
  }

  function startEditEvent(show: ShowRecord) {
    setViewMode("edit");
    setEditorMode("show");
    setEditingShowId(show.id);
    const { displayNotes, meta } = splitShowNotes(show.notes);
    setShowForm({
      name: show.name,
      client: show.client,
      business_client_id: show.business_client_id || "",
      client_contact_id: show.client_contact_id || "",
      venue: show.venue,
      rate_city: show.rate_city,
      show_start: show.show_start,
      show_end: show.show_end,
      notes: displayNotes,
      ...meta,
    });
  }

  function startAddDay() {
    setViewMode("edit");
    setEditorMode("day");
    setEditingDayId(null);
    setDayForm(emptyDay);
    setDayBulkDates([]);
  }

  function startEditDay(day: LaborDayRecord) {
    setViewMode("edit");
    setEditorMode("day");
    setEditingDayId(day.id);
    setDayForm({ labor_date: day.labor_date, label: day.label, notes: day.notes });
    setDayBulkDates([]);
  }

  function startAddCall(dayId: string) {
    setViewMode("edit");
    setEditorMode("call");
    setEditingCallId(null);
    setEditingDayTargetId(dayId);
    setCallTargetDayIds(dayId ? [dayId] : []);
    setCallForm(emptyCall);
  }

  function startEditCall(dayId: string, call: SubCallRecord) {
    setViewMode("edit");
    setEditorMode("call");
    setEditingCallId(call.id);
    setEditingDayTargetId(dayId);
    setCallTargetDayIds([dayId]);
    setCallForm({
      area: call.area,
      location: call.location || "",
      role_name: call.role_name,
      master_rate_id: call.master_rate_id || "",
      message_rate: call.message_rate || "",
      start_time: call.start_time,
      end_time: call.end_time || "",
      crew_needed: String(call.crew_needed),
      day_type: safeDayType(call.day_type) || "full_day",
      notes: call.notes,
    });
  }

  async function request(url: string, method: string, body?: unknown) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Request failed.");
      if (data.message) setMsg({ kind: "success", text: data.message });
      return data;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Request failed.";
      setMsg({ kind: "error", text });
      throw error;
    } finally {
      setSaving(false);
    }
  }

  function setAutomationField<K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]) {
    setAutomationDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveAutomationSettings() {
    if (!selectedShow) return;
    const data = await request("/api/text-automation", "PATCH", { settings: { ...automationDraft, show_id: selectedShow.id } });
    const saved = data.settings as TextAutomationSettingsRecord;
    if (saved) {
      setTextAutomationSettings((current) => [...current.filter((row) => row.show_id !== selectedShow.id), saved]);
    }
  }

  async function queueTextMessages(mode: "availability" | "schedule_reminders") {
    if (!selectedShow) return;
    const data = await request("/api/text-automation", "POST", { action: "queue_messages", show_id: selectedShow.id, mode, settings: automationDraft });
    const queued = (data.queue || []) as TextMessageQueueRecord[];
    if (queued.length) {
      setTextMessageQueue((current) => [...queued, ...current.filter((row) => !(row.show_id === selectedShow.id && queued.some((next) => next.id === row.id)))]);
    }
  }

  async function queueManualReminderNow(reminderKey: "7_day" | "3_day" | "day_before" | "day_of") {
    if (!selectedShow) return;
    const data = await request("/api/text-automation", "POST", { action: "queue_manual_reminder", show_id: selectedShow.id, reminder_key: reminderKey, settings: automationDraft });
    const queued = (data.queue || []) as TextMessageQueueRecord[];
    if (queued.length) {
      setTextMessageQueue((current) => [...queued, ...current.filter((row) => !(row.show_id === selectedShow.id && queued.some((next) => next.id === row.id)))]);
    }
  }

  async function queueManualDayReminderNow() {
    if (!selectedShow) return;
    const laborDayId = manualReminderDayId || selectedShowLaborDays[0]?.id || "";
    if (!laborDayId) {
      setMsg({ kind: "error", text: "Add a labor day before queueing a specific day reminder." });
      return;
    }
    const data = await request("/api/text-automation", "POST", { action: "queue_manual_day_reminder", show_id: selectedShow.id, labor_day_id: laborDayId, settings: automationDraft });
    const queued = (data.queue || []) as TextMessageQueueRecord[];
    if (queued.length) {
      setTextMessageQueue((current) => [...queued, ...current.filter((row) => !(row.show_id === selectedShow.id && queued.some((next) => next.id === row.id)))]);
    }
  }

  async function cancelQueuedTexts(queueId?: string) {
    if (!selectedShow) return;
    const message = queueId
      ? "Cancel this queued text? It will not send from the iPhone Shortcut."
      : "Cancel all scheduled queued texts for this show? Sent and failed texts will stay in the history.";
    if (!window.confirm(message)) return;
    const data = await request("/api/text-automation", "POST", { action: "cancel_queued", show_id: selectedShow.id, id: queueId || null });
    const updated = (data.queue || []) as TextMessageQueueRecord[];
    if (updated.length) {
      setTextMessageQueue((current) => current.map((row) => updated.find((next) => next.id === row.id) || row));
    }
  }

  async function sendDueTextsNow() {
    const data = await request("/api/text-automation/send-due", "POST", { show_id: selectedShow?.id || null });
    const updated = (data.updated || []) as TextMessageQueueRecord[];
    if (updated.length) {
      setTextMessageQueue((current) => current.map((row) => updated.find((next) => next.id === row.id) || row));
    }
  }

  async function previewImportFile() {
    if (!importFile) {
      setMsg({ kind: "error", text: "Choose a CSV or PDF file to import." });
      return;
    }
    setImporting(true);
    setMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      Object.entries(importForm).forEach(([key, value]) => formData.append(key, String(value)));
      const res = await fetch("/api/events/import-preview", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Preview failed.");
      setImportPreview(data as ImportPreviewState);
      setMsg({ kind: "success", text: data.message || "Preview ready." });
    } catch (error) {
      setImportPreview(null);
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Preview failed." });
    } finally {
      setImporting(false);
    }
  }

  async function runImport() {
    if (!importFile) {
      setMsg({ kind: "error", text: "Choose a CSV or PDF file to import." });
      return;
    }
    if (importMode === "preview") {
      await previewImportFile();
      return;
    }
    setImporting(true);
    setMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("mode", importMode);
      if (importMode === "merge" && selectedShowId) formData.append("target_show_id", selectedShowId);
      Object.entries(importForm).forEach(([key, value]) => formData.append(key, String(value)));
      const res = await fetch("/api/events/import", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Import failed.");

      const nextShow: ShowRecord = {
        id: String(data.show.id),
        name: safeText(data.show.name),
        client: safeText(data.show.client),
        business_client_id: data.show.business_client_id ? safeText(data.show.business_client_id) : null,
        client_contact_id: data.show.client_contact_id ? safeText(data.show.client_contact_id) : null,
        venue: safeText(data.show.venue),
        rate_city: safeText(data.show.rate_city) || "Default",
        show_start: safeText(data.show.show_start),
        show_end: safeText(data.show.show_end),
        notes: safeText(data.show.notes),
      };
      const nextDays: LaborDayRecord[] = (data.laborDays ?? []).map((row: LaborDayRecord) => ({
        id: String(row.id),
        show_id: String(row.show_id),
        labor_date: safeText(row.labor_date),
        label: safeText(row.label),
        notes: safeText(row.notes),
      }));
      const nextCalls: SubCallRecord[] = (data.subCalls ?? []).map((row: SubCallRecord) => ({
        id: String(row.id),
        labor_day_id: String(row.labor_day_id),
        area: safeText(row.area),
        role_name: safeText(row.role_name),
        master_rate_id: row.master_rate_id ? safeText(row.master_rate_id) : null,
        start_time: safeText(row.start_time),
        end_time: safeText(row.end_time),
        crew_needed: Number(row.crew_needed || 1),
        notes: safeText(row.notes),
      }));
      const nextAssignments: AssignmentRecord[] = (data.assignments ?? []).map((row: AssignmentRecord, index: number) => ({
        id: String(row.id),
        sub_call_id: String(row.sub_call_id),
        crew_id: String(row.crew_id),
        status: safeText(row.status) || "confirmed",
        sort_order: Number(row.sort_order || index + 1),
      }));

      setShows((current) => mergeById(current, [nextShow]).sort((a, b) => a.show_start.localeCompare(b.show_start)));
      setLaborDays((current) => mergeById(current, nextDays).sort((a, b) => a.labor_date.localeCompare(b.labor_date)));
      setSubCalls((current) => mergeById(current, nextCalls).sort(compareSubCalls));
      setAssignments((current) => mergeById(current, nextAssignments));
      setSelectedShowId(nextShow.id);
      setExpandedDayIds(nextDays.slice(0, 1).map((day) => day.id));
      setImportPreview(null);
      setImportFile(null);
      setImportForm(emptyImport);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMsg({ kind: "success", text: data.message || "Import complete." });
    } catch (error) {
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Import failed." });
    } finally {
      setImporting(false);
    }
  }

  function buildCrewListDocument(): ExportDocument | null {
    if (!selectedShow) return null;

    const buildRows = (call: SubCallRecord) => {
      const callAssignments = getCallAssignments(call.id);
      if (!callAssignments.length) return [["No crew assigned yet.", "", "", "", "", ""]];
      return callAssignments.map(({ assignment, crew }) => {
        const notes = notesForAssignment(assignment.id);
        return [
          crew?.name || assignment.crew_id,
          formatExportAssignmentTime(assignment, call),
          call.role_name,
          crew ? formatPhone(crew.phone) : "",
          assignment.status,
          noteSummary(notes),
        ];
      });
    };

    const sections: ExportDocument["sections"] = eventDisplayMode === "booth"
      ? boothSections.flatMap((section): ExportDocument["sections"] => {
          const dates = [...new Set(section.calls.map((item) => item.day.labor_date))];
          return dates.flatMap((date) => {
            const callsForDate = section.calls.filter((item) => item.day.labor_date === date);
            return callsForDate.map(({ call }) => ({
              heading: `${section.booth} - ${date}`,
              subheading: `${call.role_name} • ${formatTimeRange(call)} • ${call.crew_needed} needed`,
              accentColor: accentColorForArea(section.booth, areaAccentMap),
              columns: ["Name", "Times", "Position", "Contact Number", "Status", "Notes"],
              rows: buildRows(call),
            }));
          });
        })
      : visibleLaborDays.flatMap((day): ExportDocument["sections"] => {
          const dayCalls = displayCalls.filter((item) => item.day.id === day.id);
          if (!dayCalls.length) {
            return [{
              heading: `${day.labor_date}${day.label ? ` - ${day.label}` : ""}`,
              accentColor: "#6b7280",
              paragraphs: ["No sub-calls for this day."],
            }];
          }
          return dayCalls.map(({ call }) => ({
            heading: `${day.labor_date}${day.label ? ` - ${day.label}` : ""}`,
            subheading: `${boothLabel(call.area)} • ${call.role_name} • ${formatTimeRange(call)} • ${call.crew_needed} needed`,
            accentColor: accentColorForArea(call.area, areaAccentMap),
            columns: ["Name", "Times", "Position", "Contact Number", "Status", "Notes"],
            rows: buildRows(call),
          }));
        });

    return {
      title: "Emanuel Labor Services Labor Call List",
      subtitle: selectedShow.name,
      meta: [
        ["Client", selectedShow.client || ""],
        ["Venue", selectedShow.venue || ""],
        ["Dates", `${selectedShow.show_start} - ${selectedShow.show_end}`],
        ["View", eventDisplayMode === "booth" ? "Booth-separated" : "Day-separated"],
      ],
      sections,
    };
  }

  function exportCrewListPdf() {
    const document = buildCrewListDocument();
    if (!document || !selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    exportDocumentPdf(document, `${selectedShow.name}_${eventDisplayMode}_crew_list`);
    setMsg({ kind: "success", text: "PDF export opened. Choose Save as PDF in the print window." });
  }

  function exportCrewListDocx() {
    const document = buildCrewListDocument();
    if (!document || !selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    exportDocumentDocx(document, `${selectedShow.name}_${eventDisplayMode}_crew_list`);
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ kind: "success", text: `${label} copied.` });
    } catch {
      setMsg({ kind: "error", text: "Copy failed. Use export instead." });
    }
  }

  async function testShortcutJson(url: string, label = "Shortcut URL") {
    if (!url) {
      setMsg({ kind: "error", text: "Save settings in Apple Shortcut Mode first." });
      return;
    }
    try {
      const response = await fetch(appendShortcutTestParam(url), { cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      const raw = await response.text();
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error("This URL is still returning HTML/text instead of JSON. Deploy ELS88, then test again.");
      }
      const data = JSON.parse(raw) as { ok?: boolean; message?: string; active_show_count?: number; mode?: string; count?: number };
      if (!response.ok || data.ok === false) {
        throw new Error(data.message || "Shortcut JSON test failed.");
      }
      const activeCount = typeof data.active_show_count === "number" ? ` Active Shortcut events: ${data.active_show_count}.` : "";
      const dueCount = typeof data.count === "number" ? ` Due now: ${data.count}.` : "";
      setMsg({ kind: "success", text: `${label} is public and returning valid JSON.${activeCount}${dueCount}` });
    } catch (error) {
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Shortcut JSON test failed." });
    }
  }

  function exportScheduleMessagesText() {
    if (!selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    const text = crewScheduleMessages.map((message) => message.text).join("\n\n------------------------------\n\n");
    if (!text) {
      setMsg({ kind: "error", text: "No assigned crew schedules to export." });
      return;
    }
    downloadTextFile(`${selectedShow.name.replace(/[^a-z0-9]+/gi, "_")}_imessage_schedules.txt`, text);
  }

  function exportChecklistText() {
    if (!selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    if (!checklistText) {
      setMsg({ kind: "error", text: "No assigned crew checklist to export." });
      return;
    }
    downloadTextFile(`${selectedShow.name.replace(/[^a-z0-9]+/gi, "_")}_crew_checklist.txt`, `Here’s the checklist in the same order:\n\n${checklistText}`);
  }


  function exportWorkerNotesText() {
    if (!selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    if (!workerNoteSummaries.length) {
      setMsg({ kind: "error", text: "No worker notes to export for this show." });
      return;
    }
    const text = [
      `${selectedShow.name} - Worker Notes`,
      `${selectedShow.show_start} to ${selectedShow.show_end}`,
      "",
      ...workerNoteSummaries.flatMap((worker) => [
        worker.crewName,
        worker.phone ? `Phone: ${formatPhone(worker.phone)}` : "Phone: ",
        "Notes:",
        ...worker.notes.map((note) => `- ${note.custom_note ? `${note.note_label}: ${note.custom_note}` : note.note_label}`),
        "",
      ]),
    ].join("\n");
    downloadTextFile(`${selectedShow.name.replace(/[^a-z0-9]+/gi, "_")}_worker_notes.txt`, text);
  }

  function buildScheduleMessagesDocument(): ExportDocument | null {
    if (!selectedShow) return null;
    return {
      title: `${selectedShow.name} iMessage Schedules`,
      subtitle: `${selectedShow.show_start} - ${selectedShow.show_end}`,
      meta: [["Client", selectedShow.client], ["Venue", selectedShow.venue]],
      sections: crewScheduleMessages.map((message) => ({
        heading: message.crewName,
        subheading: message.phone ? formatPhone(message.phone) : "No phone",
        paragraphs: message.text.split("\n"),
      })),
    };
  }

  function exportScheduleMessagesPdf() {
    const document = buildScheduleMessagesDocument();
    if (!document || !selectedShow || !crewScheduleMessages.length) { setMsg({ kind: "error", text: "No assigned crew schedules to export." }); return; }
    exportDocumentPdf(document, `${selectedShow.name}_imessage_schedules`);
    setMsg({ kind: "success", text: "PDF export opened. Choose Save as PDF in the print window." });
  }

  function exportScheduleMessagesDocx() {
    const document = buildScheduleMessagesDocument();
    if (!document || !selectedShow || !crewScheduleMessages.length) { setMsg({ kind: "error", text: "No assigned crew schedules to export." }); return; }
    exportDocumentDocx(document, `${selectedShow.name}_imessage_schedules`);
  }

  function buildChecklistDocument(): ExportDocument | null {
    if (!selectedShow) return null;
    return {
      title: `${selectedShow.name} Crew Confirmation Checklist`,
      subtitle: `${selectedShow.show_start} - ${selectedShow.show_end}`,
      meta: [["Client", selectedShow.client], ["Venue", selectedShow.venue]],
      sections: [{
        heading: "Checklist",
        columns: ["Worker", "Phone", "First schedule", "Sent schedule", "Confirmed", "Day-before confirmation"],
        rows: checklistRows.map((row) => [row.crewName, row.phone ? formatPhone(row.phone) : "", row.firstSchedule, row.checklist?.schedule_sent ? "YES" : "NO", row.checklist?.confirmed ? "YES" : "NO", row.checklist?.day_before_confirmed ? "YES" : "NO"]),
      }],
    };
  }

  function exportChecklistPdf() {
    const document = buildChecklistDocument();
    if (!document || !selectedShow || !checklistRows.length) { setMsg({ kind: "error", text: "No assigned crew checklist to export." }); return; }
    exportDocumentPdf(document, `${selectedShow.name}_crew_checklist`);
    setMsg({ kind: "success", text: "PDF export opened. Choose Save as PDF in the print window." });
  }

  function exportChecklistDocx() {
    const document = buildChecklistDocument();
    if (!document || !selectedShow || !checklistRows.length) { setMsg({ kind: "error", text: "No assigned crew checklist to export." }); return; }
    exportDocumentDocx(document, `${selectedShow.name}_crew_checklist`);
  }

  function buildWorkerNotesDocument(): ExportDocument | null {
    if (!selectedShow) return null;
    return {
      title: `${selectedShow.name} Worker Notes`,
      subtitle: `${selectedShow.show_start} - ${selectedShow.show_end}`,
      meta: [["Client", selectedShow.client], ["Venue", selectedShow.venue]],
      sections: workerNoteSummaries.map((worker) => ({
        heading: worker.crewName,
        subheading: worker.phone ? formatPhone(worker.phone) : "No phone",
        paragraphs: worker.notes.map((note) => `${note.custom_note ? `${note.note_label}: ${note.custom_note}` : note.note_label}`),
      })),
    };
  }

  function exportWorkerNotesPdf() {
    const document = buildWorkerNotesDocument();
    if (!document || !selectedShow || !workerNoteSummaries.length) { setMsg({ kind: "error", text: "No worker notes to export for this show." }); return; }
    exportDocumentPdf(document, `${selectedShow.name}_worker_notes`);
    setMsg({ kind: "success", text: "PDF export opened. Choose Save as PDF in the print window." });
  }

  function exportWorkerNotesDocx() {
    const document = buildWorkerNotesDocument();
    if (!document || !selectedShow || !workerNoteSummaries.length) { setMsg({ kind: "error", text: "No worker notes to export for this show." }); return; }
    exportDocumentDocx(document, `${selectedShow.name}_worker_notes`);
  }

  function connectedFeedbackUrl(link: ConnectedFeedbackLink) {
    if (typeof window === "undefined") return link.url_path;
    return `${window.location.origin}${link.url_path}`;
  }

  async function generateConnectedFeedbackLinks() {
    if (!selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    const data = await request("/api/feedback-links", "POST", { show_id: selectedShow.id });
    const links = (data?.links || []) as ConnectedFeedbackLink[];
    setConnectedFeedbackLinks(links);
  }

  async function copyConnectedFeedbackLink(link: ConnectedFeedbackLink) {
    await copyText(connectedFeedbackUrl(link), link.title);
  }

  useEffect(() => {
    if (eventDisplayMode !== "feedback" || !selectedShow || connectedFeedbackLinks.length) return;
    void generateConnectedFeedbackLinks();
  }, [eventDisplayMode, selectedShow?.id]);

  async function setFeedbackResponseRatingStatus(responseId: string, excluded: boolean, approve = false) {
    const data = await request(`/api/feedback-responses/${responseId}`, "PATCH", {
      rating_approved: approve && !excluded,
      excluded_from_ratings: excluded,
      excluded_reason: excluded ? "Removed from rating database from the event feedback panel." : "",
    });
    const updated = data?.response as ClientFeedbackResponseRecord | undefined;
    setClientFeedbackResponses((current) => current.map((response) => {
      if (response.id !== responseId) return response;
      return {
        ...response,
        rating_approved: Boolean(updated?.rating_approved ?? (approve && !excluded)),
        reviewed_at: updated?.reviewed_at ?? (approve || excluded ? new Date().toISOString() : null),
        reviewed_by: updated?.reviewed_by ?? response.reviewed_by ?? null,
        excluded_from_ratings: Boolean(updated?.excluded_from_ratings ?? excluded),
        excluded_reason: updated?.excluded_reason ?? (excluded ? "Removed from rating database from the event feedback panel." : ""),
        excluded_at: updated?.excluded_at ?? (excluded ? new Date().toISOString() : null),
      };
    }));
    setMsg({ kind: "success", text: data?.message || (excluded ? "Feedback removed from ratings." : "Feedback approved and added to ratings.") });
    router.refresh();
  }

  async function deleteFeedbackResponse(responseId: string) {
    if (!confirm("Delete this submitted feedback response permanently? This also removes its submitted tech ratings.")) return;
    await request(`/api/feedback-responses/${responseId}`, "DELETE");
    setClientFeedbackResponses((current) => current.filter((response) => response.id !== responseId));
  }

  async function addCrewToCall(crewId: string) {
    if (!activeCrewCall) return;
    const targetCallIds = crewAssignmentTargetCallIds.length ? crewAssignmentTargetCallIds : [activeCrewCall.id];
    if (!targetCallIds.length) {
      setMsg({ kind: "error", text: "Choose at least one date/sub-call to assign this crew member." });
      return;
    }
    if (crewAvailabilityScope !== "off") {
      const conflicts = bookingConflictsForCrew(crewId, crewAvailabilityDates, targetCallIds);
      const crew = crewRecords.find((row) => row.id === crewId);
      const unavailableDates = crewAvailabilityDates.filter((date) => (crew?.unavailable_dates ?? []).includes(date));
      if (conflicts.length || unavailableDates.length) {
        const conflictText = conflicts.slice(0, 2).map((item) => `${item.date} · ${item.showName}`).join("; ");
        const unavailableText = unavailableDates.length ? `Unavailable: ${unavailableDates.join(", ")}` : "";
        setMsg({ kind: "error", text: ["This crew member is not available for the selected date scope.", conflictText, unavailableText].filter(Boolean).join(" ") });
        return;
      }
    }
    const savedRows: AssignmentRecord[] = [];
    for (const subCallId of targetCallIds) {
      const nextSortOrder = Math.max(0, ...assignments.filter((assignment) => assignment.sub_call_id === subCallId).map((assignment) => Number(assignment.sort_order || 0))) + 1;
      const data = await request("/api/assignments", "POST", {
        sub_call_id: subCallId,
        crew_id: crewId,
        status: "confirmed",
        sort_order: nextSortOrder,
      });
      if (data?.row) savedRows.push(data.row as AssignmentRecord);
    }
    if (savedRows.length) {
      setAssignments((current) => {
        const incomingKeys = new Set(savedRows.map((row) => `${row.sub_call_id}:${row.crew_id}`));
        return [...current.filter((assignment) => !incomingKeys.has(`${assignment.sub_call_id}:${assignment.crew_id}`)), ...savedRows];
      });
      const crew = crewRecords.find((row) => row.id === crewId);
      setMsg({ kind: "success", text: `${crew?.name || "Crew member"} added to ${savedRows.length} sub-call${savedRows.length === 1 ? "" : "s"}.` });
    }
  }


  function updateAssignmentOverrideDraft(assignment: AssignmentRecord, patch: Partial<{ start_time: string; end_time: string; day_type: DayType }>) {
    setAssignmentOverrideDrafts((current) => {
      const existing = current[assignment.id] || {};
      const merged = { ...existing, ...patch };
      return {
        ...current,
        [assignment.id]: {
          start_time: merged.start_time ?? assignment.start_time ?? "",
          end_time: merged.end_time ?? assignment.end_time ?? "",
          day_type: merged.day_type ?? safeDayType(assignment.day_type) ?? "",
        },
      };
    });
  }

  async function saveAssignmentOverride(assignment: AssignmentRecord) {
    const draft = assignmentOverrideDrafts[assignment.id] || {
      start_time: assignment.start_time || "",
      end_time: assignment.end_time || "",
      day_type: safeDayType(assignment.day_type) || "",
    };
    const payload = {
      start_time: safeText(draft.start_time) || null,
      end_time: safeText(draft.end_time) || null,
      day_type: safeDayType(draft.day_type) || null,
    };
    try {
      const data = await request(`/api/assignments/${assignment.id}`, "PATCH", payload);
      const row = sanitizeAssignment((data?.row || { ...assignment, ...payload }) as AssignmentRecord);
      setAssignments((current) => current.map((item) => item.id === assignment.id ? row : item));
      setAssignmentOverrideDrafts((current) => {
        const next = { ...current };
        delete next[assignment.id];
        return next;
      });
      setEditingAssignmentTimeId(null);
      setMsg({ kind: "success", text: "Worker time saved." });
    } catch (error) {
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Worker time could not be saved. Run the assignment time SQL first." });
    }
  }

  async function clearAssignmentOverride(assignment: AssignmentRecord) {
    try {
      const data = await request(`/api/assignments/${assignment.id}`, "PATCH", { start_time: null, end_time: null, day_type: null });
      const row = sanitizeAssignment((data?.row || { ...assignment, start_time: null, end_time: null, day_type: null }) as AssignmentRecord);
      setAssignments((current) => current.map((item) => item.id === assignment.id ? row : item));
      setAssignmentOverrideDrafts((current) => {
        const next = { ...current };
        delete next[assignment.id];
        return next;
      });
      setEditingAssignmentTimeId(null);
      setMsg({ kind: "success", text: "Worker time override cleared." });
    } catch (error) {
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Worker time could not be cleared." });
    }
  }

  async function moveSubCallInDay(dayId: string, callId: string, direction: "up" | "down") {
    const ordered = subCalls.filter((call) => call.labor_day_id === dayId).sort(compareSubCalls);
    const currentIndex = ordered.findIndex((call) => call.id === callId);
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;

    const reordered = [...ordered];
    const moving = reordered[currentIndex];
    reordered[currentIndex] = reordered[nextIndex];
    reordered[nextIndex] = moving;

    const updates = reordered.map((call, index) => ({ ...call, sort_order: index + 1 }));
    setSubCalls((current) => current.map((call) => {
      const updated = updates.find((item) => item.id === call.id);
      return updated ? { ...call, sort_order: updated.sort_order } : call;
    }));

    try {
      await Promise.all(updates.map((call) => request(`/api/sub-calls/${call.id}`, "PATCH", { ...call, sort_order: call.sort_order })));
      setMsg({ kind: "success", text: "Sub-call order updated for this labor day." });
    } catch (error) {
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Sub-call order could not be saved. Run the sub-call order SQL first." });
    }
  }

  async function moveAssignmentInCall(callId: string, assignmentId: string, direction: "up" | "down") {
    const ordered = getCallAssignments(callId).map((item) => item.assignment);
    const currentIndex = ordered.findIndex((assignment) => assignment.id === assignmentId);
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;

    const reordered = [...ordered];
    const moving = reordered[currentIndex];
    reordered[currentIndex] = reordered[nextIndex];
    reordered[nextIndex] = moving;

    const updates = reordered.map((assignment, index) => ({ ...assignment, sort_order: index + 1 }));
    setAssignments((current) => current.map((assignment) => {
      const updated = updates.find((item) => item.id === assignment.id);
      return updated ? { ...assignment, sort_order: updated.sort_order } : assignment;
    }));

    try {
      await Promise.all(updates.map((assignment) =>
        request(`/api/assignments/${assignment.id}`, "PATCH", { sort_order: assignment.sort_order })
      ));
      setMsg({ kind: "success", text: "Crew order updated for this sub-call." });
    } catch {
      setMsg({ kind: "error", text: "Crew order could not be saved. Make sure the assignment sort order SQL has been run." });
    }
  }

  async function removeCrewFromCall(assignmentId: string) {
    await request(`/api/assignments/${assignmentId}`, "DELETE");
    setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId));
  }

  async function saveShow() {
    const payload = {
      name: showForm.name.trim(),
      client: showForm.client.trim(),
      business_client_id: showForm.business_client_id || null,
      client_contact_id: showForm.client_contact_id || null,
      venue: showForm.venue.trim(),
      rate_city: showForm.rate_city.trim() || "Default",
      show_start: showForm.show_start,
      show_end: showForm.show_end,
      notes: composeShowNotes(showForm.notes, {
        city: showForm.city,
        state: showForm.state,
        meet_up_location: showForm.meet_up_location,
        crew_lead_name: showForm.crew_lead_name,
        crew_lead_phone: showForm.crew_lead_phone,
        default_hourly_rate: showForm.default_hourly_rate,
        coordinator_name: showForm.coordinator_name,
        coordinator_phone: showForm.coordinator_phone,
      }),
    };
    if (!payload.name || !payload.show_start || !payload.show_end) {
      setMsg({ kind: "error", text: "Show name, start, and end are required." });
      return;
    }
    const data = editingShowId
      ? await request(`/api/shows/${editingShowId}`, "PATCH", payload)
      : await request("/api/shows", "POST", payload);
    const nextShow: ShowRecord = editingShowId ? { id: editingShowId, ...payload } : { id: data.id, ...payload };
    setShows((current) =>
      editingShowId
        ? current.map((show) => (show.id === editingShowId ? nextShow : show))
        : [...current, nextShow].sort((a, b) => a.show_start.localeCompare(b.show_start))
    );
    if (editingShowId) {
      setTechRatings((current) =>
        current.map((row) =>
          row.show_id === editingShowId ? { ...row, client_id: payload.business_client_id, client_contact_id: payload.client_contact_id } : row
        )
      );
    }
    setSelectedShowId(nextShow.id);
    setEditingShowId(null);
    setShowForm(emptyShow);
    setEditorMode(null);
    setViewMode("overview");
  }

  async function deleteShow(id: string) {
    if (!confirm("Delete this show, its labor days, and its sub-calls?")) return;
    await request(`/api/shows/${id}`, "DELETE");
    const nextDayIds = laborDays.filter((day) => day.show_id === id).map((day) => day.id);
    const nextCallIds = subCalls.filter((call) => nextDayIds.includes(call.labor_day_id)).map((call) => call.id);
    setAssignments((current) => current.filter((assignment) => !nextCallIds.includes(assignment.sub_call_id)));
    setSubCalls((current) => current.filter((call) => !nextDayIds.includes(call.labor_day_id)));
    setLaborDays((current) => current.filter((day) => day.show_id !== id));
    setShows((current) => current.filter((show) => show.id !== id));
    if (selectedShowId === id) {
      setSelectedShowId(null);
      setExpandedDayIds([]);
      setCrewPickerCallId(null);
    }
  }

  async function saveDay() {
    if (!selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    const selectedDates = [...new Set([dayForm.labor_date, ...dayBulkDates].map((date) => date.trim()).filter(Boolean))].sort();
    if (!editingDayId && selectedDates.length === 0) {
      setMsg({ kind: "error", text: "Choose at least one labor day date." });
      return;
    }
    const basePayload = {
      show_id: selectedShow.id,
      label: dayForm.label.trim(),
      notes: dayForm.notes.trim(),
    };

    if (editingDayId) {
      const payload = { ...basePayload, labor_date: dayForm.labor_date };
      if (!payload.labor_date) {
        setMsg({ kind: "error", text: "Labor day date is required." });
        return;
      }
      await request(`/api/labor-days/${editingDayId}`, "PATCH", payload);
      const nextDay: LaborDayRecord = { id: editingDayId, ...payload };
      setLaborDays((current) => current.map((day) => (day.id === editingDayId ? nextDay : day)));
      setExpandedDayIds((current) => (current.includes(nextDay.id) ? current : [...current, nextDay.id]));
    } else {
      const createdDays: LaborDayRecord[] = [];
      for (const laborDate of selectedDates) {
        const payload = { ...basePayload, labor_date: laborDate };
        const data = await request("/api/labor-days", "POST", payload);
        createdDays.push({ id: data.id, ...payload });
      }
      setLaborDays((current) => [...current, ...createdDays].sort((a, b) => a.labor_date.localeCompare(b.labor_date)));
      setExpandedDayIds((current) => [...new Set([...current, ...createdDays.map((day) => day.id)])]);
      setMsg({ kind: "success", text: `${createdDays.length} labor day${createdDays.length === 1 ? "" : "s"} saved.` });
    }

    setEditingDayId(null);
    setDayBulkDates([]);
    setDayForm(emptyDay);
    setEditorMode(null);
    setViewMode("overview");
  }

  async function deleteDay(id: string) {
    if (!confirm("Delete this labor day and its sub-calls?")) return;
    await request(`/api/labor-days/${id}`, "DELETE");
    const callIds = subCalls.filter((call) => call.labor_day_id === id).map((call) => call.id);
    setAssignments((current) => current.filter((assignment) => !callIds.includes(assignment.sub_call_id)));
    setSubCalls((current) => current.filter((call) => call.labor_day_id !== id));
    setLaborDays((current) => current.filter((day) => day.id !== id));
    setExpandedDayIds((current) => current.filter((dayId) => dayId !== id));
  }

  async function saveCall() {
    try {
    const targetDayIds = editingCallId
      ? [editingDayTargetId ?? visibleLaborDays[0]?.id ?? ""].filter(Boolean)
      : [...new Set((callTargetDayIds.length ? callTargetDayIds : [editingDayTargetId ?? visibleLaborDays[0]?.id ?? ""]).filter(Boolean))];
    if (!targetDayIds.length) {
      setMsg({ kind: "error", text: "Choose at least one labor day for this sub-call." });
      return;
    }
    const basePayload = {
      area: callForm.area.trim(),
      location: callForm.location.trim(),
      role_name: callForm.role_name.trim(),
      master_rate_id: callForm.master_rate_id || null,
      message_rate: callForm.message_rate.replace(/[^0-9.]/g, "") || null,
      start_time: callForm.start_time,
      end_time: callForm.end_time,
      crew_needed: Number(callForm.crew_needed || 1),
      day_type: safeDayType(callForm.day_type) || "full_day",
      notes: callForm.notes.trim(),
    };
    if (!basePayload.area || !basePayload.role_name || !basePayload.start_time || !basePayload.end_time) {
      setMsg({ kind: "error", text: "Area, position, start time, and end time are required." });
      return;
    }

    if (editingCallId) {
      const payload = { ...basePayload, labor_day_id: targetDayIds[0] };
      await request(`/api/sub-calls/${editingCallId}`, "PATCH", payload);
      const nextCall: SubCallRecord = sanitizeSubCall({ id: editingCallId, ...payload });
      setSubCalls((current) => current.map((call) => (call.id === editingCallId ? nextCall : call)));
      setCrewPickerCallId(nextCall.id);
    } else {
      const items = targetDayIds.map((dayId) => ({ ...basePayload, labor_day_id: dayId }));
      const data = await request("/api/sub-calls", "POST", { items });
      const createdCalls = ((data?.rows ?? []) as SubCallRecord[]).map(sanitizeSubCall).filter((call) => call.id && call.labor_day_id);
      if (!createdCalls.length) {
        throw new Error("No sub-calls were returned after saving. Please try again before adding crew.");
      }
      setSubCalls((current) => [...current, ...createdCalls].sort((a, b) => a.labor_day_id.localeCompare(b.labor_day_id) || compareSubCalls(a, b)));
      setCrewPickerCallId(null);
      setExpandedDayIds((current) => [...new Set([...current, ...targetDayIds])]);
      setMsg({ kind: "success", text: `${createdCalls.length} sub-call${createdCalls.length === 1 ? "" : "s"} saved. Use Add Crew when you are ready to assign people.` });
    }

    setEditingCallId(null);
    setEditingDayTargetId(null);
    setCallTargetDayIds([]);
    setCallForm(emptyCall);
    setEditorMode(null);
    setViewMode("overview");
    } catch (error) {
      setCrewPickerCallId(null);
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Sub-call save failed. No crew picker was opened." });
    }
  }

  async function deleteCall(id: string) {
    if (!confirm("Delete this sub-call?")) return;
    await request(`/api/sub-calls/${id}`, "DELETE");
    setAssignments((current) => current.filter((assignment) => assignment.sub_call_id !== id));
    setSubCalls((current) => current.filter((call) => call.id !== id));
    if (crewPickerCallId === id) setCrewPickerCallId(null);
  }


  function renderRatingsPanel() {
    if (!selectedShow) return null;
    const clientName = selectedBusinessClient?.name || selectedShow.client || "No saved client selected";
    return (
      <div className="list">
        <div className="card compact accent-card">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <h4 style={{ margin: 0 }}>Tech ratings</h4>
                <div className="small muted">
                Rate each assigned tech 1–5 stars for this show. Ratings build a median Top Techs list for the saved business client and a separate median Top Techs list for the selected project manager/contact.
              </div>
              <div className="small" style={{ marginTop: 8 }}><strong>Client:</strong> {clientName}</div>
              <div className="small"><strong>Project manager/contact:</strong> {selectedClientContact?.name || "No specific contact selected"}</div>
            </div>
            <span className="badge">{ratingRows.filter((row) => row.rating).length}/{ratingRows.length} rated</span>
          </div>
          {!selectedShow.business_client_id ? (
            <p className="error" style={{ marginBottom: 0 }}>This show is not connected to a saved business client yet. Edit Event and choose one so ratings count toward the business-client Top Techs list. Choose a project manager/contact too if this rating should count toward that contact&apos;s Top Techs list.</p>
          ) : null}
        </div>

        {ratingRows.length ? ratingRows.map((row) => (
          <div key={row.crewId} className="card compact">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div>
                <strong>{row.crewName}</strong>
                <div className="small muted">{[row.phone ? formatPhone(row.phone) : "", row.email].filter(Boolean).join(" • ") || "No contact details"}</div>
                <div className="small muted">{row.firstSchedule}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{starDisplay(row.rating?.rating || 0)}</div>
                <div className="small muted">{row.rating?.rating ? `${row.rating.rating}/5 stars` : "Not rated"}</div>
              </div>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={row.rating?.rating === value ? "primary" : "ghost"}
                  disabled={saving}
                  onClick={() => void saveTechRating(row, value)}
                  title={`Rate ${value} star${value === 1 ? "" : "s"}`}
                >
                  {value} ★
                </button>
              ))}
              {row.rating ? <button type="button" className="ghost danger" disabled={saving} onClick={() => void clearTechRating(row.rating!.id)}>Clear</button> : null}
            </div>
            <label className="field" style={{ marginTop: 10 }}>
              <span>Rating note</span>
              <textarea
                rows={2}
                defaultValue={row.rating?.notes || ""}
                onBlur={(event) => {
                  const text = event.currentTarget.value.trim();
                  const currentRating = row.rating?.rating || 0;
                  if (currentRating > 0 && text !== (row.rating?.notes || "")) void saveTechRating(row, currentRating, text);
                }}
                placeholder="Optional internal note for this show rating."
              />
            </label>
          </div>
        )) : <p className="small muted">Assign crew to this show before rating techs.</p>}

        <div className="card compact">
          <h4 style={{ marginTop: 0 }}>Business Client Top Techs · Median</h4>
          {selectedShow.business_client_id ? (
            clientTopTechs.length ? (
              <div className="list">
                {clientTopTechs.map((item, index) => (
                  <div key={item.crew?.id || index} className="row" style={{ alignItems: "center" }}>
                    <div>
                      <strong>#{index + 1} {item.crew?.name || "Unknown tech"}</strong>
                      <div className="small muted">{item.crew?.phone ? formatPhone(item.crew.phone) : "No phone"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong>{starDisplay(item.median)} {item.median.toFixed(1)} median</strong>
                      <div className="small muted">{item.count} event rating{item.count === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="small muted">No saved ratings for this client yet.</p>
          ) : <p className="small muted">Choose a saved business client on this event to activate the business-client Top Techs list.</p>}
        </div>

        <div className="card compact">
          <h4 style={{ marginTop: 0 }}>Project Manager / Contact Top Techs · Median</h4>
          {selectedShow.client_contact_id ? (
            projectManagerTopTechs.length ? (
              <div className="list">
                {projectManagerTopTechs.map((item, index) => (
                  <div key={item.crew?.id || index} className="row" style={{ alignItems: "center" }}>
                    <div>
                      <strong>#{index + 1} {item.crew?.name || "Unknown tech"}</strong>
                      <div className="small muted">{item.crew?.phone ? formatPhone(item.crew.phone) : "No phone"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong>{starDisplay(item.median)} {item.median.toFixed(1)} median</strong>
                      <div className="small muted">{item.count} event rating{item.count === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="small muted">No saved ratings for this project manager/contact yet.</p>
          ) : <p className="small muted">Choose a project manager/client contact on this event to activate that contact-specific Top Techs list.</p>}
        </div>
      </div>
    );
  }

  function renderAutomationPanel() {
    if (!selectedShow) return null;
    const scheduled = selectedTextQueue.filter((row) => row.status === "scheduled").length;
    const sent = selectedTextQueue.filter((row) => row.status === "sent").length;
    const failed = selectedTextQueue.filter((row) => row.status === "failed").length;
    const cancelled = selectedTextQueue.filter((row) => row.status === "cancelled").length;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const shortcutPollUrl = buildShortcutPollUrl(origin, selectedShow.id, automationDraft.shortcut_token || "");
    const universalShortcutPollUrl = buildUniversalShortcutPollUrl(origin, automationDraft.shortcut_token || "");
    const shortcutRunUrl = buildShortcutRunUrl(universalShortcutPollUrl || shortcutPollUrl);
    const shortcutInstallUrl = buildShortcutInstallUrl(universalShortcutPollUrl || shortcutPollUrl);
    const methodInfo = textSendingMethodOptions.find((option) => option.value === automationDraft.sending_method) || textSendingMethodOptions[0];
    const selectedManualReminderDay = selectedShowLaborDays.find((day) => day.id === manualReminderDayId) || selectedShowLaborDays[0] || null;
    const reminderPlanRows = [
      { label: "7-day schedule text", enabled: automationDraft.reminder_7_day, when: formatScheduledPlanLabel(addDaysToDateString(selectedShow.show_start, -7), "09:00", automationDraft.timezone) },
      { label: "3-day schedule text", enabled: automationDraft.reminder_3_day, when: formatScheduledPlanLabel(addDaysToDateString(selectedShow.show_start, -3), "09:00", automationDraft.timezone) },
      { label: "Day-before reminder", enabled: automationDraft.reminder_day_before, when: formatScheduledPlanLabel(addDaysToDateString(selectedShow.show_start, -1), "17:00", automationDraft.timezone) },
      { label: "Day-of reminder", enabled: automationDraft.reminder_day_of, when: "2 hours before each crew member's first call" },
    ];
    const nextScheduledText = selectedTextQueue
      .filter((row) => row.status === "scheduled")
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))[0] || null;

    return (
      <div className="list">
        <div className="card compact">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <h4 style={{ margin: 0 }}>Confirmation Text Center</h4>
              <div className="small muted">
                Queue availability, schedule, and reminder texts from the show data. Use Manual mode now, Apple Shortcut Mode from your iPhone, or SMS Provider Mode later.
              </div>
            </div>
            <label className="row small" style={{ alignItems: "center", justifyContent: "flex-end" }}>
              <input type="checkbox" checked={automationDraft.enabled} onChange={(event) => setAutomationField("enabled", event.target.checked)} />
              <strong>Activate for this show</strong>
            </label>
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <label className="field">
              <span>Text sending method</span>
              <select value={automationDraft.sending_method} onChange={(event) => setAutomationField("sending_method", event.target.value as TextSendingMethod)}>
                {textSendingMethodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <span className="small muted">{methodInfo.helper}</span>
            </label>
            <label className="field">
              <span>Automation timezone</span>
              <select value={automationDraft.timezone} onChange={(event) => setAutomationField("timezone", event.target.value)}>
                <option value="America/Chicago">Central Time</option>
                <option value="America/New_York">Eastern Time</option>
                <option value="America/Denver">Mountain Time</option>
                <option value="America/Los_Angeles">Pacific Time</option>
              </select>
            </label>
          </div>

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <label className="field">
              <span>Onsite meet-up location</span>
              <input value={selectedShowMessageMeta.meet_up_location || ""} readOnly placeholder="Add this under Edit Event → Crew schedule message details" />
            </label>
            <label className="field">
              <span>Shortcut token</span>
              <input value={automationDraft.shortcut_token || ""} readOnly placeholder="Save in Apple Shortcut Mode to generate" />
            </label>
          </div>

          {automationDraft.sending_method === "shortcut" ? (
            <div className="card compact accent-card" style={{ marginTop: 14 }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div>
                  <strong>Apple Shortcut Mode</strong>
                  <div className="small muted">
                    Save settings first. The universal URL is public through the token, returns clean JSON, and lets one iPhone Shortcut check all active events using this same Shortcut token.
                  </div>
                </div>
                <span className="badge">No Twilio needed</span>
              </div>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Universal Shortcut URL</span>
                <input value={universalShortcutPollUrl || "Save settings to generate the universal Shortcut URL."} readOnly />
              </label>
              <label className="field" style={{ marginTop: 8 }}>
                <span>This event only URL</span>
                <input value={shortcutPollUrl || "Save settings to generate this event URL."} readOnly />
              </label>
              <div className="toolbar">
                <button type="button" className="primary" onClick={() => shortcutInstallUrl ? window.location.href = shortcutInstallUrl : setMsg({ kind: "error", text: "Save settings in Apple Shortcut Mode first." })}>Open Shortcut Builder</button>
                <button type="button" className="ghost" onClick={() => void testShortcutJson(universalShortcutPollUrl || shortcutPollUrl, "Shortcut test")}>Test Shortcut JSON</button>
                <button type="button" className="ghost" onClick={() => universalShortcutPollUrl ? void copyText(universalShortcutPollUrl, "Universal Shortcut URL") : setMsg({ kind: "error", text: "Save settings in Apple Shortcut Mode first." })}>Copy Universal URL</button>
                <button type="button" className="ghost" onClick={() => shortcutPollUrl ? void copyText(shortcutPollUrl, "This Event Shortcut URL") : setMsg({ kind: "error", text: "Save settings in Apple Shortcut Mode first." })}>Copy This Event URL</button>
                <button type="button" className="ghost" onClick={() => shortcutRunUrl ? window.location.href = shortcutRunUrl : setMsg({ kind: "error", text: "Save settings and install the ELS Send Due Texts Shortcut first." })}>Run Apple Shortcut now</button>
                <button type="button" className="ghost" onClick={() => void copyText(`ELS Shortcut setup:\n1. Tap Test Shortcut JSON first. It must say valid JSON.\n2. Tap Open Shortcut Builder from your iPhone.\n3. The universal URL is:\n${universalShortcutPollUrl || "SAVE SETTINGS FIRST"}\n4. Name the shortcut exactly ELS Send Due Texts. The Run Apple Shortcut now button uses that exact name.\n5. In Shortcuts, use URL → Get Contents of URL → Get Dictionary from Contents of URL → Get Dictionary Value messages → Repeat with Each Item in messages. Do not repeat Phone.\n6. Inside Repeat, create unique variables: body → TextMessage, phone → TextRecipient, mark_sent_url → SentCallbackURL. Send TextMessage to TextRecipient. Then add URL with SentCallbackURL inside it, followed by Get Contents of URL.\n7. Add Personal Automations at 9:00am, 5:00pm, and hourly on active show days.`, "Shortcut setup steps")}>Copy setup steps</button>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                Universal mode sends due scheduled texts for all active Apple Shortcut Mode shows using the same universal token. The Run Apple Shortcut now button runs a shortcut named exactly ELS Send Due Texts. Test Shortcut JSON shows how many texts are due before the phone sends them.
              </div>
            </div>
          ) : null}

          {automationDraft.sending_method === "provider" ? (
            <div className="card compact" style={{ marginTop: 14, background: "#fbfcfd" }}>
              <strong>SMS Provider Mode</strong>
              <div className="small muted">Use this only after provider credentials are set in Vercel. Current provider support is Twilio environment variables.</div>
            </div>
          ) : null}

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <label className="row small" style={{ alignItems: "center", justifyContent: "flex-start" }}>
              <input type="checkbox" checked={automationDraft.send_availability} onChange={(event) => setAutomationField("send_availability", event.target.checked)} />
              Send availability request messages
            </label>
            <label className="row small" style={{ alignItems: "center", justifyContent: "flex-start" }}>
              <input type="checkbox" checked={automationDraft.send_schedule} onChange={(event) => setAutomationField("send_schedule", event.target.checked)} />
              Send schedule / confirmation messages
            </label>
          </div>

          <div className="card compact" style={{ marginTop: 14, background: "#fbfcfd" }}>
            <strong>Reminder timing</strong>
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              {automationReminderOptions.map((option) => (
                <label key={option.key} className="row small" style={{ alignItems: "flex-start", justifyContent: "flex-start" }}>
                  <input type="checkbox" checked={Boolean(automationDraft[option.key])} onChange={(event) => setAutomationField(option.key, event.target.checked)} />
                  <span>
                    <strong>{option.label}</strong>
                    <span className="muted" style={{ display: "block" }}>{option.helper}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="card compact" style={{ boxShadow: "none", marginTop: 12 }}>
              <strong>Scheduled reminder plan</strong>
              <div className="small muted">These are the normal send windows. Apple Shortcut Mode sends them the next time the iPhone Shortcut runs after the scheduled time.</div>
              <div className="list" style={{ marginTop: 10 }}>
                {reminderPlanRows.map((row) => (
                  <div key={row.label} className="row small" style={{ alignItems: "center" }}>
                    <span><strong>{row.label}</strong><span className="muted" style={{ display: "block" }}>{row.when}</span></span>
                    <span className="badge">{row.enabled ? "On" : "Off"}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card compact" style={{ boxShadow: "none", marginTop: 12 }}>
              <strong>Manual reminder queue</strong>
              <div className="small muted">Use these when the reminder window has already passed, or when you want to send a reminder yourself. These texts are queued due now and will send on the next iPhone Shortcut run. Each Shortcut run can pull up to 25 due texts.</div>
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button type="button" className="ghost" onClick={() => queueManualReminderNow("7_day")} disabled={saving || !selectedShow || !automationDraft.send_schedule}>Queue 7-day now</button>
                <button type="button" className="ghost" onClick={() => queueManualReminderNow("3_day")} disabled={saving || !selectedShow || !automationDraft.send_schedule}>Queue 3-day now</button>
                <button type="button" className="ghost" onClick={() => queueManualReminderNow("day_before")} disabled={saving || !selectedShow || !automationDraft.send_schedule}>Queue day-before now</button>
                <button type="button" className="ghost" onClick={() => queueManualReminderNow("day_of")} disabled={saving || !selectedShow || !automationDraft.send_schedule}>Queue all day-of now</button>
              </div>
              <div className="grid grid-2" style={{ marginTop: 12 }}>
                <label className="field">
                  <span>Send a specific labor day now</span>
                  <select value={manualReminderDayId || selectedManualReminderDay?.id || ""} onChange={(event) => setManualReminderDayId(event.target.value)}>
                    {selectedShowLaborDays.map((day) => (
                      <option key={day.id} value={day.id}>{formatMessageDate(day.labor_date)}{day.label ? ` · ${day.label}` : ""}</option>
                    ))}
                  </select>
                </label>
                <div className="field">
                  <span>Selected day action</span>
                  <button type="button" className="primary" onClick={queueManualDayReminderNow} disabled={saving || !selectedShow || !automationDraft.send_schedule || !selectedShowLaborDays.length}>Queue selected day now</button>
                </div>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                Specific-day reminders only queue crew assigned on that labor day. Use Test Shortcut JSON to confirm the due count, then use Run Apple Shortcut now if you want the phone to send the due texts immediately.
              </div>
            </div>
          </div>

          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            <label className="field">
              <span>Availability request template</span>
              <textarea rows={4} value={automationDraft.availability_template} onChange={(event) => setAutomationField("availability_template", event.target.value)} />
            </label>
            <label className="field">
              <span>Schedule / confirmation template</span>
              <textarea rows={6} value={automationDraft.schedule_template} onChange={(event) => setAutomationField("schedule_template", event.target.value)} />
            </label>
            <label className="field">
              <span>Reminder template</span>
              <textarea rows={4} value={automationDraft.reminder_template} onChange={(event) => setAutomationField("reminder_template", event.target.value)} />
            </label>
            <div className="small muted">
              Placeholders: {"{first_name}"}, {"{crew_name}"}, {"{show_name}"}, {"{venue}"}, {"{show_start}"}, {"{show_end}"}, {"{meet_up_location}"}, {"{schedule}"}, {"{next_call}"}, {"{rate}"}, {"{coordinator_name}"}, {"{coordinator_phone}"}.
            </div>
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <button type="button" className="primary" onClick={saveAutomationSettings} disabled={saving || !selectedShow}>Save text settings</button>
            <button type="button" className="ghost" onClick={() => queueTextMessages("availability")} disabled={saving || !selectedShow || !automationDraft.send_availability}>Queue availability texts</button>
            <button type="button" className="ghost" onClick={() => queueTextMessages("schedule_reminders")} disabled={saving || !selectedShow || !automationDraft.send_schedule}>Queue schedule/reminders</button>
            {automationDraft.sending_method === "provider" ? <button type="button" className="ghost" onClick={sendDueTextsNow} disabled={saving}>Send due with provider</button> : null}
          </div>
        </div>

        <div className="card compact">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <h4 style={{ margin: 0 }}>Text queue status</h4>
              <div className="small muted">Scheduled: {scheduled} • Sent: {sent} • Failed: {failed}{cancelled ? ` • Cancelled: ${cancelled}` : ""}</div>
              <div className="small muted">If Scheduled stays the same after running the iPhone Shortcut, the phone did not send/mark the messages. Confirm the shortcut name and Repeat-with-messages setup.</div>
              {nextScheduledText ? <div className="small muted">Next queued text: {queueDueLabel(nextScheduledText)}</div> : null}
            </div>
            {scheduled ? <button type="button" className="ghost danger" onClick={() => void cancelQueuedTexts()} disabled={saving}>Cancel all queued</button> : null}
          </div>
          {selectedTextQueue.length ? (
            <div className="list" style={{ marginTop: 12 }}>
              {selectedTextQueue.slice(0, 25).map((row) => (
                <div key={row.id} className="card compact" style={{ padding: 10 }}>
                  <div className="row small" style={{ alignItems: "flex-start" }}>
                    <div>
                      <strong>{row.crew_name || "Crew member"}</strong>
                      <div className="muted">{formatPhone(row.phone)} • {row.message_type} • {row.reminder_key}</div>
                      <div className="muted">{queueDueLabel(row)}</div>
                      <div className="muted">Scheduled time: {new Date(row.scheduled_for).toLocaleString()}</div>
                      {row.error ? <div className="error">{row.error}</div> : null}
                    </div>
                    <span className="badge">{row.status}</span>
                  </div>
                  <textarea readOnly rows={3} value={row.body} style={{ width: "100%", marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} />
                  <div className="toolbar" style={{ marginTop: 8 }}>
                    <button type="button" className="ghost" onClick={() => void copyText(row.body, `${row.crew_name || "Crew"} text`)}>Copy body</button>
                    <button type="button" className="ghost" onClick={() => { const href = smsHref(row.phone); if (href) window.location.href = href; else setMsg({ kind: "error", text: "This crew member does not have a phone number." }); }}>Open Messages</button>
                    {row.status === "scheduled" ? <button type="button" className="ghost danger" onClick={() => void cancelQueuedTexts(row.id)} disabled={saving}>Cancel queued</button> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ marginBottom: 0 }}>No texts are queued yet for this show.</p>
          )}
        </div>
      </div>
    );
  }

  function buildFeedbackDocument(): ExportDocument | null {
    if (!selectedShow || !feedbackForms.length) return null;
    return {
      title: `${selectedShow.name} Quick Feedback Surveys`,
      subtitle: "Client-friendly feedback forms for testimonials, issue follow-up, and tech ratings.",
      meta: [["Client", selectedBusinessClient?.name || selectedShow.client || ""], ["Venue", selectedShow.venue || ""], ["Dates", `${selectedShow.show_start} - ${selectedShow.show_end}`]],
      sections: feedbackForms.flatMap((form): ExportDocument["sections"] => {
        const techRows = form.crewRows.map((row) => [row.crewName, row.firstSchedule, "1  2  3  4  5", "Yes / No / Not sure", ""]);
        return [
          {
            heading: form.title,
            subheading: form.target,
            accentColor: form.areaName ? accentColorForArea(form.areaName, areaAccentMap) : "#0f766e",
            paragraphs: [
              "Thank you for taking 2–3 minutes. This is a quick survey, not a test. Leave anything blank that does not apply.",
              form.areaName ? `Area / booth: ${form.areaName}` : "Overall event feedback",
              `${form.managerLabel}: ________________________________    Date: ____________________`,
              "Quick 5-star ratings: 5★ = Excellent, 4★ = Good, 3★ = Okay, 2★ = Needs work, 1★ = Problem",
              ...feedbackQuestionsForForm(form).map((question) => `${question.label}:  1★   2★   3★   4★   5★`),
              ...(form.kind === "crew-lead" ? [] : ["Would you request ELS again?  Yes / No / Not sure"]),
              "May we use your comments for a testimonial?  Yes / No / Ask first",
              form.kind === "area-manager" ? "What was your overall experience with Emanuel Labor Services?" : form.kind === "crew-lead" ? "What should we recognize or improve from the crew lead perspective?" : "What went well?",
              "",
              "Anything we should fix or follow up on?",
              "",
            ],
          },
          {
            heading: form.kind === "area-manager" ? "Tech ratings and notes for this booth / area" : form.kind === "crew-lead" ? "Crew lead tech ratings and notes" : "Tech feedback",
            subheading: "Rate only the techs this manager worked with. Notes are optional.",
            accentColor: form.areaName ? accentColorForArea(form.areaName, areaAccentMap) : "#0f766e",
            columns: ["Tech", "Schedule / position", "Rating", "Request again", "Quick note"],
            rows: techRows.length ? techRows : [["No assigned techs listed", "", "", "", ""]],
          },
        ];
      }),
    };
  }

  function exportFeedbackFormsText() {
    if (!selectedShow || !feedbackForms.length) {
      setMsg({ kind: "error", text: "No feedback forms are available for this show yet." });
      return;
    }
    downloadTextFile(`${selectedShow.name.replace(/[^a-z0-9]+/gi, "_")}_feedback_forms.txt`, feedbackForms.map((form) => form.text).join("\n\n------------------------------\n\n"));
  }

  function feedbackSurveyHtml() {
    if (!selectedShow || !feedbackForms.length) return "";
    return buildFeedbackSurveyHtml(
      feedbackForms,
      selectedShow,
      selectedBusinessClient?.name || selectedShow.client || "Client",
      selectedShow.venue || "Venue"
    );
  }

  function openFeedbackSurvey() {
    const html = feedbackSurveyHtml();
    if (!selectedShow || !html) {
      setMsg({ kind: "error", text: "No feedback forms are available for this show yet." });
      return;
    }
    const win = window.open("", "_blank");
    if (!win) {
      downloadHtmlFile(`${selectedShow.name.replace(/[^a-z0-9]+/gi, "_")}_fillable_feedback_survey.html`, html);
      setMsg({ kind: "success", text: "Popup was blocked, so the fillable HTML survey downloaded instead." });
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.document.title = `${selectedShow.name} Feedback Survey`;
  }

  function exportFeedbackFormsHtml() {
    const html = feedbackSurveyHtml();
    if (!selectedShow || !html) {
      setMsg({ kind: "error", text: "No feedback forms are available for this show yet." });
      return;
    }
    downloadHtmlFile(`${selectedShow.name.replace(/[^a-z0-9]+/gi, "_")}_fillable_feedback_survey.html`, html);
  }

  function exportFeedbackFormsPdf() {
    const document = buildFeedbackDocument();
    if (!document || !selectedShow) {
      setMsg({ kind: "error", text: "No feedback forms are available for this show yet." });
      return;
    }
    exportDocumentPdf(document, `${selectedShow.name}_feedback_forms`);
    setMsg({ kind: "success", text: "PDF export opened. Choose Save as PDF in the print window." });
  }

  function exportFeedbackFormsDocx() {
    const document = buildFeedbackDocument();
    if (!document || !selectedShow) {
      setMsg({ kind: "error", text: "No feedback forms are available for this show yet." });
      return;
    }
    exportDocumentDocx(document, `${selectedShow.name}_feedback_forms`);
  }

  function selectedShareableFeedbackResponses() {
    const approved = selectedFeedbackResponses.filter((response) => !response.excluded_from_ratings && response.rating_approved);
    if (approved.length) return approved;
    return selectedFeedbackResponses.filter((response) => !response.excluded_from_ratings);
  }

  function buildSubmittedFeedbackDocument(): ExportDocument | null {
    if (!selectedShow || !selectedFeedbackResponses.length) return null;
    return {
      title: `${selectedShow.name} Submitted Feedback`,
      subtitle: "Internal review copy of submitted feedback forms, client answers, and submitted tech ratings.",
      meta: [
        ["Client", selectedBusinessClient?.name || selectedShow.client || ""],
        ["Venue", selectedShow.venue || ""],
        ["Dates", `${selectedShow.show_start} - ${selectedShow.show_end}`],
        ["Submitted forms", selectedFeedbackResponses.length],
        ["Approved in ratings", submittedFeedbackApprovedCount],
        ["Pending approval", submittedFeedbackPendingCount],
      ],
      sections: selectedFeedbackResponses.flatMap((response): ExportDocument["sections"] => {
        const scores = feedbackScoresByResponseId.get(response.id) ?? [];
        const techRows = feedbackTechRatingsByResponseId.get(response.id) ?? [];
        const respondent = [response.respondent_name, response.respondent_title].filter(Boolean).join(" · ") || "Unnamed respondent";
        return [
          {
            heading: `${feedbackKindLabel(response.form_kind)} · ${respondent}`,
            subheading: `${formatSubmittedAt(response.submitted_at)}${response.area_name ? ` · ${response.area_name}` : ""}`,
            accentColor: response.excluded_from_ratings ? "#b91c1c" : response.rating_approved ? "#047857" : "#d97706",
            paragraphs: [
              `Status: ${response.excluded_from_ratings ? "Removed from rating database" : response.rating_approved ? "Approved in ratings" : "Pending approval"}`,
              response.respondent_email ? `Email: ${response.respondent_email}` : "",
              response.request_again && response.form_kind !== "crew-lead" ? `Request ELS again: ${response.request_again}` : "",
              response.testimonial_permission ? `Testimonial permission: ${response.testimonial_permission}` : "",
              response.went_well ? `Positive feedback / experience: ${response.went_well}` : "",
              response.follow_up ? `Problems / follow-up: ${response.follow_up}` : "",
              response.testimonial_text ? `Testimonial wording: ${response.testimonial_text}` : "",
              response.additional_comments ? `Additional comments: ${response.additional_comments}` : "",
            ],
          },
          {
            heading: "Rating answers",
            accentColor: "#062a31",
            columns: ["Question", "Rating"],
            rows: scores.length ? scores.map((score) => [score.question_label, score.rating ? `${score.rating}/5` : "Not rated"]) : [["No rating answers submitted", ""]],
          },
          {
            heading: "Submitted tech ratings",
            accentColor: "#0f766e",
            columns: ["Tech", "Area", "Rating", "Request again", "Notes"],
            rows: techRows.length ? techRows.map((row) => {
              const crew = crewRecords.find((item) => item.id === row.crew_id);
              return [crew?.name || row.crew_id, row.area_name || response.area_name || "Full event", `${row.rating}/5`, row.request_again || "", row.notes || ""];
            }) : [["No tech ratings submitted", "", "", "", ""]],
          },
        ];
      }),
    };
  }

  function buildClientEventSummaryDocument(): ExportDocument | null {
    if (!selectedShow) return null;
    const responses = selectedShareableFeedbackResponses();
    const responseIds = new Set(responses.map((response) => response.id));
    const scores = clientFeedbackScores.filter((score) => responseIds.has(score.response_id) && Number(score.rating || 0) > 0);
    const techRows = feedbackTechRatings.filter((rating) => responseIds.has(rating.response_id) && Number(rating.rating || 0) > 0);

    const scoreGroups = new Map<string, { label: string; values: number[] }>();
    for (const score of scores) {
      const key = score.question_key || score.question_label;
      const current = scoreGroups.get(key) ?? { label: score.question_label, values: [] };
      current.values.push(Number(score.rating || 0));
      scoreGroups.set(key, current);
    }

    const techGroups = new Map<string, { name: string; values: number[]; notes: string[] }>();
    for (const row of techRows) {
      const crew = crewRecords.find((item) => item.id === row.crew_id);
      const current = techGroups.get(row.crew_id) ?? { name: crew?.name || row.crew_id, values: [], notes: [] };
      current.values.push(Number(row.rating || 0));
      if (row.notes) current.notes.push(row.notes);
      techGroups.set(row.crew_id, current);
    }

    const clientAverage = scores.length ? Math.round((scores.reduce((sum, score) => sum + Number(score.rating || 0), 0) / scores.length) * 10) / 10 : 0;
    const techAverage = techRows.length ? Math.round((techRows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / techRows.length) * 10) / 10 : 0;
    const followUps = responses.flatMap((response) => [response.follow_up, response.additional_comments].filter(Boolean).map((item) => `${feedbackKindLabel(response.form_kind)}${response.area_name ? ` · ${response.area_name}` : ""}: ${item}`)).slice(0, 8);
    const positives = responses.flatMap((response) => [response.went_well, response.testimonial_text].filter(Boolean).map((item) => `${feedbackKindLabel(response.form_kind)}${response.area_name ? ` · ${response.area_name}` : ""}: ${item}`)).slice(0, 8);

    return {
      title: `${selectedShow.name} Event Feedback Summary`,
      subtitle: "Client-shareable summary of submitted feedback and tech performance.",
      meta: [
        ["Client", selectedBusinessClient?.name || selectedShow.client || ""],
        ["Venue", selectedShow.venue || ""],
        ["Dates", `${selectedShow.show_start} - ${selectedShow.show_end}`],
        ["Feedback included", responses.length ? `${responses.length} approved/reviewed response${responses.length === 1 ? "" : "s"}` : "No approved feedback yet"],
        ["Prepared by", "Emanuel Labor Services"],
      ],
      sections: [
        {
          heading: "Event at a glance",
          accentColor: "#062a31",
          columns: ["Metric", "Result"],
          rows: [
            ["Overall client feedback average", clientAverage ? `${starDisplay(clientAverage)} ${clientAverage}/5` : "No client ratings submitted"],
            ["Overall submitted tech average", techAverage ? `${starDisplay(techAverage)} ${techAverage}/5` : "No tech ratings submitted"],
            ["Submitted forms reviewed", responses.length],
            ["Submitted tech ratings", techRows.length],
          ],
          paragraphs: [
            "This is a concise review copy. It summarizes the feedback forms and tech ratings that have been approved or kept active for this event.",
          ],
        },
        {
          heading: "Feedback answer averages",
          accentColor: "#0f766e",
          columns: ["Question", "Average", "Responses"],
          rows: scoreGroups.size ? [...scoreGroups.values()].map((group) => {
            const average = Math.round((group.values.reduce((sum, value) => sum + value, 0) / group.values.length) * 10) / 10;
            return [group.label, `${average}/5`, group.values.length];
          }) : [["No rating answers approved yet", "", ""]],
        },
        {
          heading: "Tech rating overview",
          accentColor: "#f4c542",
          columns: ["Tech", "Average", "Ratings", "Notes"],
          rows: techGroups.size ? [...techGroups.values()]
            .map((group) => {
              const average = Math.round((group.values.reduce((sum, value) => sum + value, 0) / group.values.length) * 10) / 10;
              return [group.name, `${average}/5`, group.values.length, group.notes.slice(0, 2).join(" | ")];
            })
            .sort((a, b) => Number(String(b[1]).replace("/5", "")) - Number(String(a[1]).replace("/5", ""))) : [["No tech ratings approved yet", "", "", ""]],
        },
        {
          heading: "Positive feedback and testimonial comments",
          accentColor: "#047857",
          paragraphs: positives.length ? positives : ["No positive comments or testimonial wording submitted yet."],
        },
        {
          heading: "Follow-up / improvement notes",
          accentColor: "#b91c1c",
          paragraphs: followUps.length ? followUps : ["No follow-up issues submitted."],
        },
      ],
    };
  }

  function exportSubmittedFeedbackPdf() {
    const document = buildSubmittedFeedbackDocument();
    if (!document || !selectedShow) {
      setMsg({ kind: "error", text: "No submitted feedback is available for this event yet." });
      return;
    }
    exportDocumentPdf(document, `${selectedShow.name}_submitted_feedback`);
    setMsg({ kind: "success", text: "Submitted feedback PDF opened. Choose Save as PDF in the print window." });
  }

  function exportClientEventSummaryPdf() {
    const document = buildClientEventSummaryDocument();
    if (!document || !selectedShow) {
      setMsg({ kind: "error", text: "Choose an event first." });
      return;
    }
    exportDocumentPdf(document, `${selectedShow.name}_client_event_summary`);
    setMsg({ kind: "success", text: "Client event summary PDF opened. Choose Save as PDF in the print window." });
  }

  function renderSubmittedFeedbackResponses() {
    if (!selectedShow) return null;
    const responses = selectedFeedbackResponses;
    return (
      <div className="card compact feedback-intro-card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <h4 style={{ margin: 0 }}>Submitted feedback</h4>
            <div className="small muted">View submitted survey answers, client ratings, testimonial notes, and submitted tech ratings for this event.</div>
          </div>
          <div className="toolbar">
            <span className="badge">{responses.length} submitted</span>
            {submittedFeedbackPendingCount ? <span className="badge danger">{submittedFeedbackPendingCount} needs approval</span> : null}
            {submittedFeedbackApprovedCount ? <span className="badge">{submittedFeedbackApprovedCount} approved in ratings</span> : null}
            {submittedFeedbackExcludedCount ? <span className="badge danger">{submittedFeedbackExcludedCount} removed from ratings</span> : null}
          </div>
        </div>
        {responses.length ? (
          <div className="list" style={{ marginTop: 12 }}>
            {responses.map((response) => {
              const scores = feedbackScoresByResponseId.get(response.id) ?? [];
              const techRows = feedbackTechRatingsByResponseId.get(response.id) ?? [];
              const average = averageFeedbackScore(scores);
              const median = medianFeedbackScore(scores);
              const respondent = [response.respondent_name, response.respondent_title].filter(Boolean).join(" · ") || "Unnamed respondent";
              return (
                <details key={response.id} className="card compact" style={{ boxShadow: "none" }}>
                  <summary style={{ cursor: "pointer" }}>
                    <div className="row" style={{ alignItems: "center" }}>
                      <div>
                        <strong>{feedbackKindLabel(response.form_kind)}</strong>
                        <div className="small muted">
                          {respondent} · {formatSubmittedAt(response.submitted_at)}{response.area_name ? ` · ${response.area_name}` : ""}
                        </div>
                      </div>
                      <div className="toolbar">
                        {average ? <span className="badge">Avg {average}/5</span> : null}
                        {median ? <span className="badge">Median {median}/5</span> : null}
                        {techRows.length ? <span className="badge">{techRows.length} tech rating{techRows.length === 1 ? "" : "s"}</span> : null}
                        {response.excluded_from_ratings ? (
                          <span className="badge danger">Removed from rating database</span>
                        ) : response.rating_approved ? (
                          <span className="badge">Approved in ratings</span>
                        ) : (
                          <span className="badge danger">Needs approval</span>
                        )}
                      </div>
                    </div>
                  </summary>
                  <div className="grid" style={{ gap: 12, marginTop: 12 }}>
                    <div className="grid grid-2">
                      <div className="small"><strong>Respondent:</strong> {respondent}</div>
                      <div className="small"><strong>Email:</strong> {response.respondent_email || "Not provided"}</div>
                      <div className="small"><strong>Request ELS again:</strong> {response.request_again || "Not answered"}</div>
                      <div className="small"><strong>Testimonial permission:</strong> {response.testimonial_permission || "Not answered"}</div>
                    </div>
                    {response.excluded_from_ratings ? <p className="small muted" style={{ margin: 0 }}>This response is still saved for viewing, but it is excluded from client score summaries, top tech lists, and crew recommendations.{response.excluded_reason ? ` Reason: ${response.excluded_reason}` : ""}</p> : null}
                    {!response.excluded_from_ratings && !response.rating_approved ? <p className="small muted" style={{ margin: 0 }}>This newly submitted form is pending review. Approve it to add its client scores and tech ratings to the rating system.</p> : null}
                    {!response.excluded_from_ratings && response.rating_approved ? <p className="small muted" style={{ margin: 0 }}>Approved for the rating system{response.reviewed_at ? ` on ${formatSubmittedAt(response.reviewed_at)}` : ""}.</p> : null}
                    <div>
                      <strong>Client rating answers</strong>
                      {scores.length ? (
                        <div className="grid grid-2" style={{ marginTop: 8 }}>
                          {scores.map((score) => (
                            <div key={score.id} className="card compact" style={{ boxShadow: "none" }}>
                              <div className="small muted">{score.question_label}</div>
                              <strong>{score.rating ? `${starDisplay(score.rating)} ${score.rating}/5` : "Not rated"}</strong>
                            </div>
                          ))}
                        </div>
                      ) : <p className="small muted">No client rating answers were submitted.</p>}
                    </div>
                    <div className="grid grid-2">
                      <div>
                        <strong>Positive feedback / experience</strong>
                        <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{response.went_well || "No comment."}</p>
                      </div>
                      <div>
                        <strong>Problems / follow-up</strong>
                        <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{response.follow_up || "No follow-up listed."}</p>
                      </div>
                    </div>
                    {response.testimonial_text ? (
                      <div>
                        <strong>Testimonial wording</strong>
                        <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{response.testimonial_text}</p>
                      </div>
                    ) : null}
                    {response.additional_comments ? (
                      <div>
                        <strong>Additional comments</strong>
                        <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{response.additional_comments}</p>
                      </div>
                    ) : null}
                    <div>
                      <strong>Submitted tech ratings</strong>
                      {techRows.length ? (
                        <div className="list" style={{ marginTop: 8 }}>
                          {techRows.map((row) => {
                            const crew = crewRecords.find((item) => item.id === row.crew_id);
                            return (
                              <div key={row.id} className="card compact" style={{ boxShadow: "none" }}>
                                <div className="row" style={{ alignItems: "flex-start" }}>
                                  <div>
                                    <strong>{crew?.name || row.crew_id}</strong>
                                    <div className="small muted">{row.area_name || response.area_name || "Full event"}</div>
                                    {row.notes ? <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{row.notes}</div> : null}
                                  </div>
                                  <div className="toolbar">
                                    <span className="badge">{starDisplay(row.rating)} {row.rating}/5</span>
                                    {row.request_again ? <span className="badge">Request again: {row.request_again}</span> : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : <p className="small muted">No tech ratings were submitted on this form.</p>}
                    </div>
                    <div className="toolbar">
                      {!response.excluded_from_ratings && !response.rating_approved ? (
                        <button type="button" className="primary" onClick={() => void setFeedbackResponseRatingStatus(response.id, false, true)}>Approve / add to rating system</button>
                      ) : null}
                      {response.excluded_from_ratings ? (
                        <button type="button" className="primary" onClick={() => void setFeedbackResponseRatingStatus(response.id, false, true)}>Restore and approve ratings</button>
                      ) : (
                        <button type="button" className="ghost danger" onClick={() => void setFeedbackResponseRatingStatus(response.id, true, false)}>Remove from rating database</button>
                      )}
                      <button type="button" className="ghost danger" onClick={() => void deleteFeedbackResponse(response.id)}>Delete submitted form</button>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <p className="small muted" style={{ marginBottom: 0, marginTop: 12 }}>No connected feedback forms have been submitted for this event yet.</p>
        )}
      </div>
    );
  }

  function renderFeedbackPanel() {
    if (!selectedShow) return null;
    const ratingScores = [5, 4, 3, 2, 1];
    return (
      <div className="list">
        <div className="card compact feedback-intro-card">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <h4 style={{ margin: 0 }}>Client feedback surveys</h4>
              <div className="small muted">Google-Forms-style quick surveys: one detailed project manager survey, plus simple booth/area manager surveys for tech ratings and notes.</div>
            </div>
            <span className="badge">{feedbackForms.length} survey{feedbackForms.length === 1 ? "" : "s"}</span>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="primary" onClick={() => void generateConnectedFeedbackLinks()}>Refresh Connected Survey Links</button>
            <button type="button" className="ghost" onClick={exportClientEventSummaryPdf}>Client Summary PDF</button>
            <button type="button" className="ghost" onClick={exportSubmittedFeedbackPdf}>Submitted Feedback PDF</button>
            <button type="button" className="ghost" onClick={exportFeedbackFormsHtml}>Download Offline HTML Backup</button>
            <button type="button" className="ghost" onClick={exportFeedbackFormsPdf}>Blank Form PDF</button>
            <button type="button" className="ghost" onClick={exportFeedbackFormsDocx}>DOCX</button>
            <button type="button" className="ghost" onClick={exportFeedbackFormsText}>Clean TXT</button>
          </div>
          {connectedFeedbackLinks.length ? (
            <div className="list" style={{ marginTop: 12 }}>
              {connectedFeedbackLinks.map((link) => (
                <div key={link.id} className="card compact" style={{ boxShadow: "none" }}>
                  <div className="row" style={{ alignItems: "center" }}>
                    <div>
                      <strong>{link.title}</strong>
                      <div className="small muted">{feedbackKindDescription(link)}</div>
                      <div className="small muted" style={{ wordBreak: "break-all" }}>{connectedFeedbackUrl(link)}</div>
                    </div>
                    <div className="toolbar">
                      <button type="button" className="ghost" onClick={() => window.open(connectedFeedbackUrl(link), "_blank", "noopener,noreferrer")}>Open</button>
                      <button type="button" className="ghost" onClick={() => void copyConnectedFeedbackLink(link)}>Copy link</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted" style={{ marginBottom: 0 }}>Connected links open a client-only survey page. Submitted responses save back to the app, update client feedback, update tech ratings, and feed Top Tech recommendations.</p>
          )}
        </div>
        {renderSubmittedFeedbackResponses()}
        {feedbackForms.length ? feedbackForms.map((form) => (
          <form key={form.key} className="card feedback-survey-card" onSubmit={(event) => event.preventDefault()}>
            <div className="feedback-survey-header">
              <div>
                <div className="feedback-eyebrow">{form.areaName ? "Area manager survey" : "Overall event survey"}</div>
                <h3>{form.title}</h3>
                <p>{form.intro}</p>
              </div>
              <span className="feedback-time-pill">2–3 min</span>
            </div>
            <div className="feedback-chip-row">
              <span className="badge"><strong>For:</strong> {form.target}</span>
              {form.areaName ? <span className="badge"><strong>Area:</strong> {form.areaName}</span> : null}
              <span className="badge"><strong>Client:</strong> {selectedBusinessClient?.name || selectedShow.client || "Client"}</span>
            </div>
            <div className="grid grid-2">
              <label className="field"><span>{form.managerLabel}</span><input placeholder="Name" /></label>
              <label className="field"><span>Date completed</span><input type="date" /></label>
            </div>
            <div className="feedback-section-title">Quick 5-star ratings</div>
            <p className="small muted" style={{ marginTop: -4 }}>5★ = excellent. 1★ = problem. Leave anything blank that does not apply.</p>
            <div className="feedback-question-grid">
              {feedbackQuestionsForForm(form).map((question) => (
                <fieldset key={question.key} className="feedback-question-card">
                  <legend>{question.label}</legend>
                  <div className="small muted">{question.helper}</div>
                  <div className="feedback-rating-row">
                    {ratingScores.map((score) => (
                      <label key={score}>
                        <input type="radio" name={`${form.key}-${question.key}`} value={score} />
                        <span>{score}★</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="feedback-section-title">Quick questions</div>
            <div className="grid grid-2">
              {form.kind === "crew-lead" ? null : <label className="field"><span>Would you request ELS again?</span><select defaultValue=""><option value="">Choose one</option><option>Yes</option><option>No</option><option>Not sure</option></select></label>}
              <label className="field"><span>May we use your comments for a testimonial?</span><select defaultValue=""><option value="">Choose one</option><option>Yes</option><option>No</option><option>Ask first</option></select></label>
            </div>
            <div className="grid grid-2">
              <label className="field"><span>{form.kind === "area-manager" ? "What was your overall experience with Emanuel Labor Services?" : form.kind === "crew-lead" ? "What should we recognize or improve from the crew lead perspective?" : "What went well?"}</span><textarea rows={4} placeholder="Positive feedback, testimonial, or quick notes" /></label>
              <label className="field"><span>Anything we should fix or follow up on?</span><textarea rows={4} placeholder="Problems, concerns, or details we should correct" /></label>
            </div>
            <div className="feedback-section-title">{form.kind === "area-manager" ? "Tech ratings and notes for this booth / area" : form.kind === "crew-lead" ? "Crew lead tech ratings and notes" : "Tech feedback"}</div>
            <p className="small muted" style={{ marginTop: -4 }}>{form.kind === "crew-lead" ? "Crew Lead and Working Crew Lead assignments are intentionally hidden from this rating list. Rate the crew members the lead supervised." : "Rate only the techs this manager worked with. Notes are optional."}</p>
            <div className="list">
              {form.crewRows.length ? form.crewRows.map((row) => (
                <div key={row.crewId} className="feedback-tech-card">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div>
                      <strong>{row.crewName}</strong>
                      <div className="small muted">{row.firstSchedule}</div>
                    </div>
                    {row.rating ? <span className="badge">Internal: {starDisplay(row.rating.rating)} {row.rating.rating}/5</span> : null}
                  </div>
                  <div className="feedback-rating-row" aria-label={`Rating for ${row.crewName}`}>
                    {ratingScores.map((score) => (
                      <label key={score}>
                        <input type="radio" name={`${form.key}-${row.crewId}-tech-rating`} value={score} />
                        <span>{score}★</span>
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-2">
                    <label className="field"><span>Request this tech again?</span><select defaultValue=""><option value="">Choose one</option><option>Yes</option><option>No</option><option>Not sure</option></select></label>
                    <label className="field"><span>Notes on this tech</span><input placeholder="Optional notes about performance, attitude, readiness, or follow-up" /></label>
                  </div>
                </div>
              )) : <p className="small muted">No assigned techs listed for this form yet.</p>}
            </div>
            <label className="field" style={{ marginTop: 12 }}><span>Additional comments</span><textarea rows={4} placeholder="Optional" /></label>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button type="button" className="primary" onClick={() => void generateConnectedFeedbackLinks()}>Refresh connected link</button>
              <button type="button" className="ghost" onClick={() => void copyText(form.text, form.title)}>Copy clean text</button>
            </div>
          </form>
        )) : <p className="small muted">Add labor days/sub-calls first to generate area-specific feedback surveys.</p>}
      </div>
    );
  }

  function renderEditorPanel() {
    if (!editorMode) return null;

    return (
      <div className="card compact" style={{ borderColor: "#111827", marginTop: 12 }}>
        <div className="row">
          <div style={{ fontWeight: 800 }}>
            {editorMode === "show" ? (editingShowId ? "Edit event" : "Add event") : null}
            {editorMode === "day" ? (editingDayId ? "Edit labor day" : "Add labor day") : null}
            {editorMode === "call" ? (editingCallId ? "Edit sub-call" : "Add sub-call") : null}
          </div>
          <button type="button" className="ghost" onClick={() => { setEditorMode(null); setViewMode("overview"); }}>
            Done editing
          </button>
        </div>

        {editorMode === "show" ? (
          <div className="grid" style={{ gap: 14, marginTop: 12 }}>
            <div className="grid grid-2">
              <label className="field"><span>Show name</span><input value={showForm.name} onChange={(e) => setShowForm((c) => ({ ...c, name: e.target.value }))} /></label>
              <label className="field">
                <span>Saved business client</span>
                <select value={showForm.business_client_id} onChange={(e) => {
                  const clientId = e.target.value;
                  const client = businessClients.find((item) => item.id === clientId);
                  const primaryContact = clientContacts.find((contact) => contact.client_id === clientId && contact.is_primary) || clientContacts.find((contact) => contact.client_id === clientId);
                  setShowForm((c) => ({
                    ...c,
                    business_client_id: clientId,
                    client_contact_id: primaryContact?.id || "",
                    client: client?.name || c.client,
                    rate_city: client?.default_rate_city || c.rate_city || "Default",
                  }));
                }}>
                  <option value="">No saved client / manual client text</option>
                  {businessClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-2">
              <label className="field"><span>Client name shown on event</span><input value={showForm.client} onChange={(e) => setShowForm((c) => ({ ...c, client: e.target.value }))} placeholder="Manual client text or saved client name" /></label>
              <label className="field">
                <span>Project manager / client contact for this event</span>
                <select value={showForm.client_contact_id} onChange={(e) => setShowForm((c) => ({ ...c, client_contact_id: e.target.value }))} disabled={!showForm.business_client_id}>
                  <option value="">No specific client contact</option>
                  {activeShowClientContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.title ? ` — ${contact.title}` : ""}</option>)}
                </select>
              </label>
            </div>
            <label className="field"><span>Venue</span><input value={showForm.venue} onChange={(e) => setShowForm((c) => ({ ...c, venue: e.target.value }))} /></label>
            <div className="grid grid-2">
              <label className="field"><span>Rate city</span><input value={showForm.rate_city} onChange={(e) => setShowForm((c) => ({ ...c, rate_city: e.target.value }))} /></label>
              <div className="grid grid-2">
                <label className="field"><span>Show start</span><input type="date" value={showForm.show_start} onChange={(e) => setShowForm((c) => ({ ...c, show_start: e.target.value }))} /></label>
                <label className="field"><span>Show end</span><input type="date" value={showForm.show_end} onChange={(e) => setShowForm((c) => ({ ...c, show_end: e.target.value }))} /></label>
              </div>
            </div>
            <div className="card compact accent-card">
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Crew schedule message details</div>
              <div className="grid grid-2">
                <label className="field"><span>Onsite meet-up location</span><input value={showForm.meet_up_location} onChange={(e) => setShowForm((c) => ({ ...c, meet_up_location: e.target.value }))} placeholder="3rd Floor Bissonet Ballroom" /></label>
                <label className="field"><span>Default message rate / hr</span><input value={showForm.default_hourly_rate} onChange={(e) => setShowForm((c) => ({ ...c, default_hourly_rate: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="35" /></label>
              </div>
              <div className="grid grid-2" style={{ marginTop: 10 }}>
                <label className="field"><span>Crew lead name</span><input value={showForm.crew_lead_name} onChange={(e) => setShowForm((c) => ({ ...c, crew_lead_name: e.target.value }))} placeholder="Kevin Murphy" /></label>
                <label className="field"><span>Crew lead phone</span><input value={showForm.crew_lead_phone} onChange={(e) => setShowForm((c) => ({ ...c, crew_lead_phone: e.target.value }))} placeholder="310-698-9092" /></label>
              </div>
              <div className="grid grid-2" style={{ marginTop: 10 }}>
                <label className="field"><span>Coordinator name</span><input value={showForm.coordinator_name} onChange={(e) => setShowForm((c) => ({ ...c, coordinator_name: e.target.value }))} /></label>
                <label className="field"><span>Coordinator phone</span><input value={showForm.coordinator_phone} onChange={(e) => setShowForm((c) => ({ ...c, coordinator_phone: e.target.value }))} /></label>
              </div>
            </div>
            <label className="field"><span>Notes</span><textarea rows={3} value={showForm.notes} onChange={(e) => setShowForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveShow}>{saving ? "Saving..." : editingShowId ? "Save Event" : "Add Event"}</button>
              <button type="button" className="ghost" onClick={() => { setEditingShowId(null); setShowForm(emptyShow); setEditorMode(null); setViewMode("overview"); }}>Cancel</button>
            </div>
          </div>
        ) : null}

        {editorMode === "day" ? (
          <div className="grid" style={{ gap: 14, marginTop: 12 }}>
            <div className="grid grid-2">
              <label className="field"><span>Date</span><input type="date" value={dayForm.labor_date} onChange={(e) => setDayForm((c) => ({ ...c, labor_date: e.target.value }))} /></label>
              <label className="field"><span>Label</span><input value={dayForm.label} onChange={(e) => setDayForm((c) => ({ ...c, label: e.target.value }))} placeholder="Load in, show day, strike..." /></label>
            </div>
            {!editingDayId ? (
              <div className="card compact" style={{ background: "#fbfcfd" }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div>
                    <strong>Multi-day calendar add</strong>
                    <div className="small muted">Click Select multiple, choose every date on the calendar, then press Add selected days.</div>
                  </div>
                  <div className="toolbar">
                    <button type="button" className={dayMultiSelectMode ? "primary" : "ghost"} onClick={() => setDayMultiSelectMode((current) => !current)}>
                      {dayMultiSelectMode ? "Selecting multiple" : "Select multiple days"}
                    </button>
                    <button type="button" className="ghost" onClick={() => {
                      const value = dayForm.labor_date.trim();
                      if (!value) return;
                      setDayBulkDates((current) => [...new Set([...current, value])].sort());
                      setDayBulkCalendarMonth(value.slice(0, 7));
                    }}>Add selected date</button>
                  </div>
                </div>
                <div className="card compact" style={{ boxShadow: "none", marginTop: 12 }}>
                  <div className="row" style={{ alignItems: "center", marginBottom: 10 }}>
                    <button type="button" className="ghost" onClick={() => setDayBulkCalendarMonth(shiftMonth(dayCalendarMonth, -1))}>‹</button>
                    <strong>{monthLabel(dayCalendarMonth)}</strong>
                    <button type="button" className="ghost" onClick={() => setDayBulkCalendarMonth(shiftMonth(dayCalendarMonth, 1))}>›</button>
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                      <div key={day} className="small muted" style={{ textAlign: "center", fontWeight: 800 }}>{day}</div>
                    ))}
                    {dayCalendarDays.map((item) => {
                      const selected = selectedLaborDateSet.has(item.date);
                      return (
                        <button
                          key={item.date}
                          type="button"
                          className={selected ? "primary" : "ghost"}
                          style={{
                            minHeight: 42,
                            opacity: item.inMonth ? 1 : 0.38,
                            padding: "6px 4px",
                            borderRadius: 12,
                          }}
                          onClick={() => {
                            if (dayMultiSelectMode) {
                              setDayBulkDates((current) => {
                                const next = new Set([dayForm.labor_date, ...current].filter(Boolean));
                                if (next.has(item.date)) next.delete(item.date);
                                else next.add(item.date);
                                return [...next].sort();
                              });
                              setDayForm((current) => current.labor_date ? current : { ...current, labor_date: item.date });
                            } else {
                              setDayForm((current) => ({ ...current, labor_date: item.date }));
                              setDayBulkCalendarMonth(item.date.slice(0, 7));
                            }
                          }}
                        >
                          {item.day}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  {[...selectedLaborDateSet].sort().map((date) => (
                    <span key={date} className="badge">{date} <button type="button" className="inline-icon" onClick={() => {
                      setDayBulkDates((current) => current.filter((item) => item !== date));
                      if (dayForm.labor_date === date) setDayForm((current) => ({ ...current, labor_date: "" }));
                    }}>×</button></span>
                  ))}
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button type="button" className="primary" disabled={saving || selectedLaborDateSet.size === 0} onClick={saveDay}>
                    {saving ? "Saving..." : `Add selected day${selectedLaborDateSet.size === 1 ? "" : "s"}`}
                  </button>
                  <button type="button" className="ghost" onClick={() => { setDayBulkDates([]); setDayForm((current) => ({ ...current, labor_date: "" })); }}>Clear selected days</button>
                </div>
              </div>
            ) : null}
            <label className="field"><span>Notes</span><textarea rows={3} value={dayForm.notes} onChange={(e) => setDayForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveDay}>{saving ? "Saving..." : editingDayId ? "Save Labor Day" : "Add Labor Day"}</button>
              <button type="button" className="ghost" onClick={() => { setEditingDayId(null); setDayBulkDates([]); setDayMultiSelectMode(false); setDayForm(emptyDay); setEditorMode(null); setViewMode("overview"); }}>Cancel</button>
            </div>
          </div>
        ) : null}

        {editorMode === "call" ? (
          <div className="grid" style={{ gap: 14, marginTop: 12 }}>
            <div className="small muted">Labor day: {visibleLaborDays.find((day) => day.id === editingDayTargetId)?.labor_date || "None selected"}</div>
            {!editingCallId ? (
              <div className="card compact sub-call-multi-day">
                <strong>Create this sub-call on multiple labor days</strong>
                <div className="small muted">Select every date this same area/position/time should be created on.</div>
                <div className="grid grid-3" style={{ marginTop: 10 }}>
                  {visibleLaborDays.map((day) => (
                    <label key={day.id} className="checkline">
                      <input
                        type="checkbox"
                        checked={callTargetDayIds.includes(day.id)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          const dayId = day.id;
                          setCallTargetDayIds((current) => checked ? [...new Set([...current, dayId])] : current.filter((id) => id !== dayId));
                        }}
                      />
                      <span>{day.labor_date}{day.label ? ` · ${day.label}` : ""}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid grid-2">
              <label className="field"><span>Area / Booth</span><input value={callForm.area} onChange={(e) => setCallForm((c) => ({ ...c, area: e.target.value }))} placeholder="Booth, GS, breakouts..." /></label>
              <label className="field"><span>Sub-call location</span><input value={callForm.location} onChange={(e) => setCallForm((c) => ({ ...c, location: e.target.value }))} placeholder="Warehouse, hotel, booth hall, room, address..." /></label>
              <label className="field">
                <span>Position</span>
                <select
                  value={selectedCallPosition?.id || callForm.master_rate_id || ""}
                  onChange={(e) => {
                    const option = subCallPositionOptions.find((item) => item.id === e.target.value);
                    setCallForm((current) => ({
                      ...current,
                      master_rate_id: option?.id || "",
                      role_name: option?.role_name || "",
                    }));
                  }}
                >
                  <option value="">Choose position from crew pay rates</option>
                  {subCallPositionOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.role_name} — Full {moneyLabel(option.full_day)}{option.half_day != null ? ` / Half ${moneyLabel(option.half_day)}` : " / Full day only"}
                    </option>
                  ))}
                </select>
                <span className="small muted">Options come from Settings → Crew pay rates. The selected position controls rate lookup for this sub-call.</span>
              </label>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 16 }}>
              <label className="field"><span>Start</span><input type="time" value={callForm.start_time} onChange={(e) => setCallForm((c) => ({ ...c, start_time: e.target.value }))} /></label>
              <label className="field"><span>End</span><input type="time" value={callForm.end_time} onChange={(e) => setCallForm((c) => ({ ...c, end_time: e.target.value }))} /></label>
              <label className="field"><span>Default block</span><select value={callForm.day_type} onChange={(e) => setCallForm((c) => ({ ...c, day_type: safeDayType(e.target.value) || "full_day" }))}><option value="full_day">Full day</option><option value="half_day">Half day</option><option value="custom">Custom time</option></select></label>
              <label className="field"><span>Crew needed</span><input type="number" min="1" value={callForm.crew_needed === "0" ? "" : callForm.crew_needed} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCallForm((c) => ({ ...c, crew_needed: e.target.value }))} placeholder="1" /></label>
              <label className="field"><span>Message rate / hr</span><input inputMode="decimal" value={callForm.message_rate} onChange={(e) => setCallForm((c) => ({ ...c, message_rate: e.target.value.replace(/[^0-9.]/g, "") }))} placeholder="Optional, ex. 35" /></label>
            </div>
            <div className="small muted">Default block prints on the sub-call and schedule. Individual workers can still be adjusted after they are assigned.</div>
            <label className="field"><span>Notes</span><textarea rows={3} value={callForm.notes} onChange={(e) => setCallForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveCall}>{saving ? "Saving..." : editingCallId ? "Save Sub-Call" : "Add Sub-Call"}</button>
              <button type="button" className="ghost" onClick={() => { setEditingCallId(null); setEditingDayTargetId(null); setCallTargetDayIds([]); setCallForm(emptyCall); setEditorMode(null); setViewMode("overview"); }}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {msg ? <p className={msg.kind === "error" ? "error" : "success"}>{msg.text}</p> : null}

      <div className="grid events-shell">
        <section className="card">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>Events</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Clean overview first, edit tools second. Import and preview from the event list.
              </p>
            </div>
            <button type="button" className="primary" onClick={startAddEvent}>
              Add Event
            </button>
          </div>

          {editorMode === "show" && !editingShowId ? (
            <div className="inline-edit-panel">
              {renderEditorPanel()}
            </div>
          ) : null}

          <label className="field">
            <span>Main search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Show, client, venue, city, area, location, tech..." />
          </label>

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="ghost" onClick={() => setImportPanelOpen((open) => !open)}>
              {importPanelOpen ? "Hide Import Event" : "Import Event"}
            </button>
            {importFile ? <span className="small muted">Selected: {importFile.name}</span> : <span className="small muted">Import stays closed until needed.</span>}
          </div>

          {importPanelOpen ? (
          <div className="list" style={{ marginTop: 12 }}>
            <h4 style={{ margin: 0 }}>Import Event</h4>
            <div
              className="card compact"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped = event.dataTransfer.files?.[0] || null;
                if (dropped) setImportFile(dropped);
              }}
              style={{ borderStyle: "dashed" }}
            >
              <div className="small muted">
                Drag a CSV or PDF here, preview first, then create new or merge into the selected event.
              </div>
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()}>
                  Choose file
                </button>
                {importFile ? <span className="small">{importFile.name}</span> : <span className="small muted">No file selected</span>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.pdf"
                style={{ display: "none" }}
                onChange={(event) => setImportFile(event.target.files?.[0] || null)}
              />
            </div>

            <label className="field">
              <span>Import mode</span>
              <select value={importMode} onChange={(e) => setImportMode(e.target.value as ImportMode)}>
                <option value="create">Create new event</option>
                <option value="merge">Merge into selected event</option>
                <option value="preview">Preview only</option>
              </select>
            </label>

            {importMode === "merge" ? (
              <p className="small muted">
                Selected event for merge: <strong>{selectedShow?.name || "Choose an event first"}</strong>
              </p>
            ) : null}

            <label className="field"><span>Show name override</span><input value={importForm.show_name} onChange={(e) => setImportForm((c) => ({ ...c, show_name: e.target.value }))} placeholder="Optional override" /></label>
            <label className="field"><span>Client override</span><input value={importForm.client} onChange={(e) => setImportForm((c) => ({ ...c, client: e.target.value }))} placeholder="Optional override" /></label>
            <label className="field"><span>Venue override</span><input value={importForm.venue} onChange={(e) => setImportForm((c) => ({ ...c, venue: e.target.value }))} placeholder="Optional override" /></label>
            <label className="field"><span>Rate city</span><input value={importForm.rate_city} onChange={(e) => setImportForm((c) => ({ ...c, rate_city: e.target.value }))} placeholder="Default or city name" /></label>

            <div className="toolbar">
              <button type="button" className="ghost" disabled={importing} onClick={previewImportFile}>
                {importing ? "Working..." : "Preview"}
              </button>
              <button type="button" className="primary" disabled={importing || importMode === "preview"} onClick={runImport}>
                {importing ? "Working..." : importMode === "merge" ? "Merge Import" : "Create Event"}
              </button>
            </div>

            {importPreview ? (
              <div className="card compact" style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700 }}>{importPreview.show.name}</div>
                <div className="small muted">{importPreview.show.client || "No client"} • {importPreview.show.venue || "No venue"}</div>
                <div className="small muted">{importPreview.show.show_start} to {importPreview.show.show_end} • {importPreview.sourceType.toUpperCase()}</div>
                <div className="small" style={{ marginTop: 8 }}>
                  {importPreview.laborDays.length} labor days • {importPreview.subCallPreview.length} sub-calls • {importPreview.matchedCrewCount} matched • {importPreview.unmatchedCrewCount} unmatched
                </div>
                <div className="list" style={{ marginTop: 10, maxHeight: 180, overflowY: "auto" }}>
                  {importPreview.subCallPreview.map((call) => (
                    <div key={call.key} className="card compact">
                      <div style={{ fontWeight: 700 }}>{call.labor_date} • {call.start_time}{call.end_time ? `-${call.end_time}` : ""}</div>
                      <div className="small muted">{call.area} • {call.role_name} • {call.crew_needed} needed</div>
                      {call.matchedCrew.length ? <div className="small">Matched: {call.matchedCrew.map((row) => row.name).join(", ")}</div> : null}
                      {call.unmatchedCrew.length ? <div className="small muted">Unmatched: {call.unmatchedCrew.join(", ")}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>          ) : null}

          {(["Upcoming", "Current", "Past"] as const).map((bucket) => (
            <div key={bucket} className="list" style={{ marginTop: 14 }}>
              <h4 className={`event-bucket-heading ${showBucketBadgeClass(bucket)}`} style={{ margin: 0 }}>{bucket}</h4>
              {(showsByBucket[bucket] ?? []).map((show) => (
                <button
                  key={show.id}
                  type="button"
                  className={`ghost event-show-button ${showBucketClass(bucket)}`}
                  onClick={() => setSelectedShowId(show.id)}
                  style={{ textAlign: "left", borderColor: selectedShow?.id === show.id ? "#111827" : undefined }}
                >
                  <div style={{ fontWeight: 700 }}>{show.name}</div>
                  <div className="small muted">{show.client || "No client"} • {show.show_start} to {show.show_end}</div>
                  <div className="small muted">{show.venue || "No venue"}</div>
                </button>
              ))}
              {!showsByBucket[bucket].length ? <p className="small muted">No {bucket.toLowerCase()} shows.</p> : null}
            </div>
          ))}
        </section>

        <section className="card">
          <div className="row">
            <div>
              <h3 style={{ marginBottom: 6 }}>Event overview</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Review the show first. Open edit mode only when you need to change details.
              </p>
            </div>
            <div className="toolbar event-header-actions">
              <button type="button" className={viewMode === "overview" ? "primary" : "ghost"} onClick={() => { setViewMode("overview"); setEditorMode(null); }}>
                Overview
              </button>
              <button type="button" className={viewMode === "edit" ? "primary" : "ghost"} onClick={() => selectedShow && startEditEvent(selectedShow)} disabled={!selectedShow}>
                Edit mode
              </button>
            </div>
          </div>

          {selectedShow ? (
            <div className="grid" style={{ gap: 16 }}>
              <div className="card compact">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 30, fontWeight: 800 }}>{selectedShow.name}</div>
                    <div className="muted">{selectedBusinessClient?.name || selectedShow.client || "No client"} • {selectedShow.venue || "No venue"}</div>
                    <div className="muted">{selectedShow.show_start} to {selectedShow.show_end} • <span className={`badge ${showBucketBadgeClass(showBucket(selectedShow))}`}>{showBucket(selectedShow)}</span> Rate city: {selectedShow.rate_city || "Default"}</div>
                    {eventPool ? <div className="small" style={{ marginTop: 8 }}><strong>Staffing pool:</strong> {eventPool}</div> : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>${estimate.toLocaleString()}</div>
                    <div className="muted">Estimated payout</div>
                  </div>
                </div>
                <div className="toolbar small" style={{ marginTop: 10 }}>
                  {selectedBusinessClient ? <span className="badge"><strong>Saved client:</strong> {selectedBusinessClient.name}</span> : null}
                  {selectedClientContact ? <span className="badge"><strong>Project manager/contact:</strong> {selectedClientContact.name}{selectedClientContact.phone ? ` · ${formatPhone(selectedClientContact.phone)}` : ""}</span> : null}
                  {selectedShowMessageMeta.city || selectedShowMessageMeta.state ? <span className="badge"><strong>Location:</strong> {[selectedShowMessageMeta.city, selectedShowMessageMeta.state].filter(Boolean).join(", ")}</span> : null}
                  {selectedShowMessageMeta.meet_up_location ? <span className="badge"><strong>Meet-up:</strong> {selectedShowMessageMeta.meet_up_location}</span> : null}
                  {selectedShowMessageMeta.default_hourly_rate ? <span className="badge"><strong>Message rate:</strong> ${selectedShowMessageMeta.default_hourly_rate}/hr</span> : null}
                  {selectedShowMessageMeta.crew_lead_name ? <span className="badge"><strong>Crew lead:</strong> {selectedShowMessageMeta.crew_lead_name}{selectedShowMessageMeta.crew_lead_phone ? ` · ${formatPhone(selectedShowMessageMeta.crew_lead_phone)}` : ""}</span> : null}
                </div>
                {selectedShowNoteParts.displayNotes ? <div className="small muted" style={{ marginTop: 10 }}>{selectedShowNoteParts.displayNotes}</div> : null}
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <label className="field" style={{ minWidth: 230 }}>
                    <span>Change view</span>
                    <select value={eventDisplayMode} onChange={(e) => setEventDisplayMode(e.target.value as EventDisplayMode)}>
                      <option value="day">Day / sub-call view</option>
                      <option value="booth">Booth / area view</option>
                      <option value="messages">iMessage schedules</option>
                      <option value="automation">Confirmation Text Center</option>
                      <option value="checklist">Checklist</option>
                      <option value="feedback">Feedback forms{submittedFeedbackPendingCount ? ` (${submittedFeedbackPendingCount} new)` : ""}</option>
                      <option value="notes">Worker notes / ratings</option>
                      <option value="ratings">Tech ratings</option>
                    </select>
                  </label>
                  {eventDisplayMode === "messages" ? (
                    <>
                      <button type="button" className="ghost" onClick={exportScheduleMessagesPdf}>PDF iMessage Schedules</button>
                      <button type="button" className="ghost" onClick={exportScheduleMessagesDocx}>DOCX</button>
                      <button type="button" className="ghost" onClick={exportScheduleMessagesText}>TXT</button>
                    </>
                  ) : eventDisplayMode === "automation" ? (
                    <>
                      <button type="button" className="ghost" onClick={saveAutomationSettings}>Save Text Settings</button>
                      <button type="button" className="ghost" onClick={() => queueTextMessages("schedule_reminders")}>Queue Texts</button>
                    </>
                  ) : eventDisplayMode === "checklist" ? (
                    <>
                      <button type="button" className="ghost" onClick={exportChecklistPdf}>PDF Checklist</button>
                      <button type="button" className="ghost" onClick={exportChecklistDocx}>DOCX</button>
                      <button type="button" className="ghost" onClick={exportChecklistText}>TXT</button>
                    </>
                  ) : eventDisplayMode === "feedback" ? (
                    <>
                      {submittedFeedbackPendingCount ? <span className="badge danger">{submittedFeedbackPendingCount} needs approval</span> : null}
                      <button type="button" className="primary" onClick={() => void generateConnectedFeedbackLinks()}>Refresh Connected Links</button>
                      <button type="button" className="ghost" onClick={exportFeedbackFormsHtml}>Offline HTML</button>
                      <button type="button" className="ghost" onClick={exportFeedbackFormsPdf}>PDF</button>
                      <button type="button" className="ghost" onClick={exportFeedbackFormsDocx}>DOCX</button>
                      <button type="button" className="ghost" onClick={exportFeedbackFormsText}>TXT</button>
                    </>
                  ) : eventDisplayMode === "notes" ? (
                    <>
                      <button type="button" className="ghost" onClick={exportWorkerNotesPdf}>PDF Worker Notes</button>
                      <button type="button" className="ghost" onClick={exportWorkerNotesDocx}>DOCX</button>
                      <button type="button" className="ghost" onClick={exportWorkerNotesText}>TXT</button>
                    </>
                  ) : eventDisplayMode === "ratings" ? (
                    <>
                      <span className="badge">{ratingRows.filter((row) => row.rating).length}/{ratingRows.length} rated</span>
                    </>
                  ) : (
                    <>
                      <button type="button" className="ghost" onClick={exportCrewListPdf}>PDF {eventDisplayMode === "booth" ? "Booth" : "Day"} Crew List</button>
                      <button type="button" className="ghost" onClick={exportCrewListDocx}>DOCX</button>
                    </>
                  )}
                  <button type="button" className="ghost" onClick={() => startEditEvent(selectedShow)}>Edit Event</button>
                  <button type="button" className="ghost" onClick={startAddDay}>Add Labor Day</button>
                  <button type="button" className="ghost danger" onClick={() => deleteShow(selectedShow.id)}>Delete Event</button>
                </div>
              </div>

              {((editorMode === "show" && Boolean(editingShowId)) || (editorMode === "day" && !editingDayId)) ? renderEditorPanel() : null}

              {eventDisplayMode === "messages" ? (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>iMessage-ready schedules</h4>
                      <div className="small muted">One copy-ready schedule per assigned crew member for this event.</div>
                    </div>
                    <button type="button" className="ghost" onClick={exportScheduleMessagesPdf}>PDF all schedules</button>
                    <button type="button" className="ghost" onClick={exportScheduleMessagesDocx}>DOCX</button>
                    <button type="button" className="ghost" onClick={exportScheduleMessagesText}>TXT</button>
                  </div>
                  {crewScheduleMessages.length ? crewScheduleMessages.map((message) => (
                    <div key={message.crewId} className="card compact">
                      <div className="row" style={{ alignItems: "flex-start" }}>
                        <div>
                          <strong>{message.crewName}</strong>
                          <div className="small muted">{message.phone ? formatPhone(message.phone) : "No phone"}</div>
                        </div>
                        <button type="button" className="ghost" onClick={() => void copyText(message.text, `${message.crewName} schedule`)}>Copy</button>
                      </div>
                      <textarea readOnly value={message.text} rows={14} style={{ width: "100%", marginTop: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} />
                    </div>
                  )) : <p className="small muted">No assigned crew schedules yet.</p>}
                </div>
              ) : eventDisplayMode === "automation" ? (
                renderAutomationPanel()
              ) : eventDisplayMode === "checklist" ? (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>Crew confirmation checklist</h4>
                      <div className="small muted">Track all confirmation steps in one place: sent schedule, confirmed, and day-before confirmation.</div>
                    </div>
                    <div className="toolbar">
                      <button type="button" className="ghost" onClick={() => void copyText(`Here’s the checklist in the same order:\n\n${checklistText}`, "Checklist")}>Copy checklist</button>
                      <button type="button" className="ghost" onClick={exportChecklistPdf}>PDF checklist</button>
                      <button type="button" className="ghost" onClick={exportChecklistDocx}>DOCX</button>
                      <button type="button" className="ghost" onClick={exportChecklistText}>TXT</button>
                    </div>
                  </div>
                  <div className="card compact checklist-panel">
                    <div className="toolbar" style={{ marginBottom: 12 }}>
                      {checklistColumns.map((column) => (
                        <button
                          key={column.field}
                          type="button"
                          className="ghost"
                          disabled={saving || !checklistRows.length}
                          onClick={() => void markAllChecklistField(column.field, true)}
                        >
                          Mark all {column.label}
                        </button>
                      ))}
                    </div>
                    {checklistRows.length ? (
                      <div className="checklist-grid">
                        <div className="checklist-head">Worker</div>
                        {checklistColumns.map((column) => <div key={column.field} className="checklist-head">{column.label}</div>)}
                        {checklistRows.map((row) => (
                          <div key={row.crewId} className="checklist-row">
                            <div className="checklist-worker">
                              <strong>{row.crewName}</strong>
                              <div className="small muted">{row.phone ? formatPhone(row.phone) : "No phone"}</div>
                              <div className="small muted">{row.firstSchedule}</div>
                            </div>
                            {checklistColumns.map((column) => (
                              <label key={column.field} className="checklist-check">
                                <input
                                  type="checkbox"
                                  checked={Boolean(row.checklist?.[column.field])}
                                  disabled={saving}
                                  onChange={(event) => void updateCrewChecklist(row.crewId, column.field, event.currentTarget.checked)}
                                />
                                <span>
                                  <strong>{column.label}</strong>
                                  <small>{column.helper}</small>
                                </span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="small muted" style={{ margin: 0 }}>No assigned crew checklist yet.</p>
                    )}
                  </div>
                </div>
              ) : eventDisplayMode === "feedback" ? (
                renderFeedbackPanel()
              ) : eventDisplayMode === "notes" ? (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>Worker notes / ratings</h4>
                      <div className="small muted">Show-specific notes and 1–5 star tech ratings collected under each assigned person.</div>
                    </div>
                    <button type="button" className="ghost" onClick={exportWorkerNotesPdf}>PDF worker notes</button>
                    <button type="button" className="ghost" onClick={exportWorkerNotesDocx}>DOCX</button>
                    <button type="button" className="ghost" onClick={exportWorkerNotesText}>TXT</button>
                  </div>
                  {workerNoteRatingSummaries.length ? workerNoteRatingSummaries.map((worker) => (
                    <div key={worker.crewId} className="card compact">
                      <div className="row" style={{ alignItems: "flex-start" }}>
                        <div>
                          <strong>{worker.crewName}</strong>
                          <div className="small muted">{worker.phone ? formatPhone(worker.phone) : "No phone"}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <strong>{worker.rating?.rating ? `${starDisplay(worker.rating.rating)} ${worker.rating.rating}/5` : "Not rated"}</strong>
                          <div className="small muted">Show rating</div>
                        </div>
                      </div>
                      {worker.notes.length ? (
                        <ul style={{ marginBottom: 0 }}>
                          {worker.notes.map((note) => (
                            <li key={note.id}>
                              {note.custom_note ? `${note.note_label}: ${note.custom_note}` : note.note_label}
                              <span className="muted"> · {noteVisibilityLabels[(note.visibility as NoteVisibility) || "admin_only"] || note.visibility}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="small muted" style={{ marginBottom: 0 }}>No notes saved for this person yet.</p>}
                    </div>
                  )) : <p className="small muted">Assign crew to this show before adding notes or ratings.</p>}
                </div>
              ) : eventDisplayMode === "ratings" ? (
                renderRatingsPanel()
              ) : eventDisplayMode === "day" ? (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>Labor days</h4>
                      <div className="small muted">Separated by date with clear day breaks.</div>
                    </div>
                  </div>
                  {visibleLaborDays.length ? visibleLaborDays.map((day) => {
                    const isOpen = expandedDayIds.includes(day.id);
                    const dayCalls = subCalls.filter((call) => call.labor_day_id === day.id).sort(compareSubCalls);
                    const dayAccentArea = dayCalls[0]?.area || day.label || day.labor_date;
                    return (
                      <div key={day.id} className="card compact" style={{ borderTop: `4px solid ${accentColorForArea(dayAccentArea, areaAccentMap)}` }}>
                        <div className="row">
                          <button type="button" className="ghost" style={{ flex: 1, textAlign: "left" }} onClick={() => toggleDay(day.id)}>
                            <strong>{day.labor_date}</strong>
                            <span className="small muted"> • {day.label || "No label"}</span>
                          </button>
                          <div className="toolbar">
                            <button type="button" className="ghost" onClick={() => startEditDay(day)}>Edit Day</button>
                            <button type="button" className="ghost" onClick={() => startAddCall(day.id)}>Add Sub-Call</button>
                            <button type="button" className="ghost danger" onClick={() => deleteDay(day.id)}>Delete Day</button>
                          </div>
                        </div>

                        {editorMode === "day" && editingDayId === day.id ? renderEditorPanel() : null}
                        {editorMode === "call" && !editingCallId && editingDayTargetId === day.id ? renderEditorPanel() : null}

                        {isOpen ? (
                          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
                            {day.notes ? <div className="small muted">{day.notes}</div> : null}
                            {dayCalls.length ? dayCalls.map((call, callIndex) => renderCallCard(day, call, false, callIndex, dayCalls.length)) : <div className="small muted">No sub-calls yet for this labor day.</div>}
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : <p className="small muted">No labor days yet for this event.</p>}
                </div>
              ) : (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>Booth / area view</h4>
                      <div className="small muted">Same event data grouped like the imported crew lists: booth first, then dates and calls.</div>
                    </div>
                    <button type="button" className="ghost" onClick={startAddDay}>Add Labor Day</button>
                  </div>
                  {boothSections.length ? boothSections.map((section) => {
                    const dates = [...new Set(section.calls.map((item) => item.day.labor_date))];
                    return (
                      <div key={section.booth} className="card compact" style={{ borderTop: `4px solid ${accentColorForArea(section.booth, areaAccentMap)}` }}>
                        <div className="row" style={{ alignItems: "flex-start" }}>
                          <div>
                            <h3 style={{ margin: 0 }}>{section.booth}</h3>
                            <div className="small muted">{section.calls.length} sub-call{section.calls.length === 1 ? "" : "s"}</div>
                          </div>
                        </div>
                        <div className="grid" style={{ gap: 12, marginTop: 12 }}>
                          {dates.map((date) => {
                            const callsForDate = section.calls.filter((item) => item.day.labor_date === date);
                            const day = callsForDate[0]?.day;
                            return (
                              <div key={`${section.booth}-${date}`} className="card compact" style={{ background: "#f9fafb", borderLeft: `4px solid ${accentColorForArea(section.booth, areaAccentMap)}` }}>
                                <div className="row">
                                  <div>
                                    <strong>{date}</strong>
                                    <span className="small muted"> • {day?.label || "No label"}</span>
                                  </div>
                                  {day ? (
                                    <div className="toolbar">
                                      <button type="button" className="ghost" onClick={() => startEditDay(day)}>Edit Day</button>
                                      <button type="button" className="ghost" onClick={() => startAddCall(day.id)}>Add Sub-Call</button>
                                    </div>
                                  ) : null}
                                </div>
                                {day && editorMode === "day" && editingDayId === day.id ? renderEditorPanel() : null}
                                {day && editorMode === "call" && !editingCallId && editingDayTargetId === day.id ? renderEditorPanel() : null}
                                <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                                  {callsForDate.map(({ day: callDay, call }, callIndex) => renderCallCard(callDay, call, true, callIndex, callsForDate.length))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }) : <p className="small muted">No booth or sub-call information yet for this event.</p>}
                </div>
              )}
            </div>
          ) : (
            <div className="card compact">
              <strong>No event selected</strong>
              <div className="small muted" style={{ marginTop: 8 }}>Choose an event from the list on the left or add a new one.</div>
              {editorMode === "show" ? renderEditorPanel() : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
