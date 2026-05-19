"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";
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
  initialCrew: CrewRecord[];
  masterRates: MasterRateRecord[];
};

type SaveState = { kind: "success" | "error"; text: string } | null;
type ImportMode = "create" | "merge" | "preview";
type ViewMode = "overview" | "edit";
type EventDisplayMode = "day" | "booth" | "messages" | "automation" | "checklist" | "notes";
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
  { value: "manual", label: "Manual Messages App", helper: "Copy/open each message yourself. No provider required." },
  { value: "shortcut", label: "Apple Shortcut Mode", helper: "Your iPhone Shortcut polls due texts and sends them from your phone." },
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
    enabled: false,
    sending_method: "manual",
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
  venue: "",
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
  role_name: "",
  start_time: "",
  end_time: "",
  crew_needed: "1",
  notes: "",
};

const emptyImport = {
  show_name: "",
  client: "",
  venue: "",
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
};

const fallbackRoleRates: Record<string, { full_day: number; half_day: number | null }> = {
  "client facing audio visual tech": { full_day: 400, half_day: 200 },
  "breakout operator": { full_day: 400, half_day: 200 },
};

const venueToPoolHints = [
  { pool: "New Orleans, LA", hints: ["mccno", "ernest morial", "new orleans"] },
  { pool: "Nashville, TN", hints: ["music city center", "nashville"] },
  { pool: "Atlanta, GA", hints: ["atlanta"] },
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(value: string | null | undefined) {
  return String(value || "").trim();
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

function formatTimeRange(call: SubCallRecord) {
  return `${call.start_time}${call.end_time ? `-${call.end_time}` : ""}`;
}

function smsHref(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return `sms:${digits.length === 10 ? `1${digits}` : digits}`;
}

function buildShortcutPollUrl(origin: string, showId: string, token: string) {
  if (!origin || !showId || !token) return "";
  return `${origin}/api/text-automation/shortcut?show_id=${encodeURIComponent(showId)}&token=${encodeURIComponent(token)}&limit=5`;
}

function buildShortcutRunUrl(pollUrl: string) {
  if (!pollUrl) return "";
  return `shortcuts://run-shortcut?name=${encodeURIComponent("ELS Send Due Texts")}&input=text&text=${encodeURIComponent(pollUrl)}`;
}

function formatMessageDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
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

function firstName(fullName: string) {
  return safeText(fullName).split(/\s+/)[0] || "there";
}

function splitVenueAndAddress(venue: string) {
  const parts = safeText(venue).split("•").map((part) => part.trim()).filter(Boolean);
  return { venueName: parts[0] || safeText(venue) || "the venue", address: parts.slice(1).join("\n") };
}

type EventMessageMeta = {
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
  return crew.positions.some((position) => {
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

function callDurationHours(call: SubCallRecord) {
  const start = minutesFromTime(call.start_time);
  const end = minutesFromTime(call.end_time);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

function rateForCall(call: SubCallRecord, rateCity: string, masterRates: MasterRateRecord[]) {
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

function resolveEventPool(show: ShowRecord | null, crewRecords: CrewRecord[]) {
  if (!show) return null;

  const cities = [...new Set(crewRecords.map((crew) => crew.city_name).filter(Boolean))];
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

export default function EventsClient({
  initialShows,
  initialLaborDays,
  initialSubCalls,
  initialAssignments,
  initialAssignmentNotes,
  initialAssignmentChecklists,
  initialTextAutomationSettings,
  initialTextMessageQueue,
  initialCrew,
  masterRates,
}: Props) {
  const [shows, setShows] = useState(initialShows);
  const [laborDays, setLaborDays] = useState(initialLaborDays);
  const [subCalls, setSubCalls] = useState(initialSubCalls);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [assignmentNotes, setAssignmentNotes] = useState(initialAssignmentNotes);
  const [assignmentChecklists, setAssignmentChecklists] = useState(initialAssignmentChecklists);
  const [textAutomationSettings, setTextAutomationSettings] = useState(initialTextAutomationSettings);
  const [textMessageQueue, setTextMessageQueue] = useState(initialTextMessageQueue);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft>(() => defaultAutomationDraft(initialShows[0]?.id || ""));
  const [crewRecords] = useState(initialCrew);

  const [search, setSearch] = useState("");
  const [selectedShowId, setSelectedShowId] = useState<string | null>(initialShows[0]?.id ?? null);
  const [expandedDayIds, setExpandedDayIds] = useState<string[]>(initialLaborDays[0]?.id ? [initialLaborDays[0].id] : []);
  const [crewPickerCallId, setCrewPickerCallId] = useState<string | null>(null);
  const [crewSearch, setCrewSearch] = useState("");
  const [crewGroupFilter, setCrewGroupFilter] = useState("All groups");
  const [crewAvailabilityScope, setCrewAvailabilityScope] = useState<CrewAvailabilityScope>("active_day");
  const [noteEditorAssignmentId, setNoteEditorAssignmentId] = useState<string | null>(null);
  const [noteSelections, setNoteSelections] = useState<string[]>([]);
  const [noteCustomText, setNoteCustomText] = useState("");
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>("admin_only");

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [eventDisplayMode, setEventDisplayMode] = useState<EventDisplayMode>("day");
  const [editorMode, setEditorMode] = useState<EditorMode>(null);

  const [showForm, setShowForm] = useState(emptyShow);
  const [dayForm, setDayForm] = useState(emptyDay);
  const [dayBulkDates, setDayBulkDates] = useState<string[]>([]);
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredShows = useMemo(() => {
    const token = normalize(search);
    const sorted = [...shows].sort((a, b) => a.show_start.localeCompare(b.show_start));
    if (!token) return sorted;
    return sorted.filter((show) =>
      normalize([
        show.name,
        show.client,
        show.venue,
        show.rate_city,
        showBucket(show),
      ].join(" ")).includes(token)
    );
  }, [shows, search]);

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
  const selectedShowMessageMeta = selectedShowNoteParts.meta;
  const selectedAutomation = useMemo(() => {
    if (!selectedShow) return null;
    return textAutomationSettings.find((row) => row.show_id === selectedShow.id) ?? null;
  }, [selectedShow, textAutomationSettings]);

  const selectedTextQueue = useMemo(() => {
    if (!selectedShow) return [] as TextMessageQueueRecord[];
    return textMessageQueue.filter((row) => row.show_id === selectedShow.id);
  }, [selectedShow, textMessageQueue]);

  useEffect(() => {
    setAutomationDraft(selectedShow ? automationDraftFromRecord(selectedShow.id, selectedAutomation) : defaultAutomationDraft(""));
  }, [selectedShow?.id, selectedAutomation]);

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

  const crewAvailabilityDates = useMemo(() => {
    if (!activeCrewDay) return [] as string[];
    if (crewAvailabilityScope === "off") return [] as string[];
    if (crewAvailabilityScope === "selected_show") {
      const dates = visibleLaborDays.map((day) => day.labor_date).filter(Boolean);
      return [...new Set(dates)].sort();
    }
    return [activeCrewDay.labor_date];
  }, [activeCrewDay, crewAvailabilityScope, visibleLaborDays]);

  function bookingConflictsForCrew(crewId: string, dates: string[], currentSubCallId?: string) {
    if (!dates.length) return [] as Array<{ date: string; showName: string; callLabel: string }>;
    const dateSet = new Set(dates);
    return assignments
      .filter((assignment) => assignment.crew_id === crewId && assignment.sub_call_id !== currentSubCallId)
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
    return assignments
      .filter((assignment) => assignment.sub_call_id === activeCrewCall.id)
      .map((assignment) => ({
        assignment,
        crew: crewRecords.find((crew) => crew.id === assignment.crew_id),
      }));
  }, [assignments, crewRecords, activeCrewCall]);

  const poolGroups = useMemo(() => {
    const poolCrew = crewRecords.filter((crew) => !eventPool || normalize(crew.city_name) === normalize(eventPool));
    const groups: string[] = [...new Set(poolCrew.map((crew) => crew.group_name || "Ungrouped"))].sort((a, b) => a.localeCompare(b));
    return ["All groups", ...groups];
  }, [crewRecords, eventPool]);

  const availableCrew = useMemo(() => {
    if (!activeCrewCall || !activeCrewDay) return [] as CrewRecord[];
    const token = normalize(crewSearch);
    const alreadyAssigned = new Set(assignedCrew.map((item) => item.assignment.crew_id));

    const poolCrew = crewRecords.filter((crew) => {
      if (alreadyAssigned.has(crew.id)) return false;
      if (crew.blacklisted) return false;
      if (eventPool && normalize(crew.city_name) !== normalize(eventPool)) return false;
      if (crewGroupFilter !== "All groups" && (crew.group_name || "Ungrouped") !== crewGroupFilter) return false;

      if (crewAvailabilityScope !== "off") {
        const unavailableOnDate = crewAvailabilityDates.some((date) => crew.unavailable_dates.includes(date));
        if (unavailableOnDate) return false;
        if (bookingConflictsForCrew(crew.id, crewAvailabilityDates, activeCrewCall.id).length) return false;
      }

      if (!token) return true;
      return normalize([
        crew.name,
        crew.city_name,
        crew.group_name,
        crew.tier,
        crew.email,
        crew.phone,
        crew.notes,
        crew.positions.map((position) => position.role_name).join(" "),
      ].join(" ")).includes(token);
    });

    return poolCrew.sort((a, b) => {
      const aMatch = matchesRole(a, activeCrewCall.role_name) ? 1 : 0;
      const bMatch = matchesRole(b, activeCrewCall.role_name) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return a.name.localeCompare(b.name);
    });
  }, [activeCrewCall, activeCrewDay, assignedCrew, crewGroupFilter, crewRecords, crewSearch, eventPool, crewAvailabilityScope, crewAvailabilityDates, assignments, subCallById, laborDayById, showById]);

  const displayCalls = useMemo(() => {
    return visibleLaborDays
      .flatMap((day) =>
        subCalls
          .filter((call) => call.labor_day_id === day.id)
          .map((call) => ({
            day,
            call,
            callAssignments: assignments
              .filter((assignment) => assignment.sub_call_id === call.id)
              .map((assignment) => ({
                assignment,
                crew: crewRecords.find((crew) => crew.id === assignment.crew_id),
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
  }, [visibleLaborDays, subCalls, assignments, crewRecords]);

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

  const crewScheduleMessages = useMemo(() => {
    if (!selectedShow) return [] as Array<{ crewId: string; crewName: string; phone: string; text: string }>;

    const byCrew = new Map<string, { crew: CrewRecord | undefined; calls: Array<{ day: LaborDayRecord; call: SubCallRecord }> }>();
    for (const item of displayCalls) {
      for (const assignment of item.callAssignments) {
        const existing = byCrew.get(assignment.assignment.crew_id) ?? { crew: assignment.crew, calls: [] };
        existing.calls.push({ day: item.day, call: item.call });
        byCrew.set(assignment.assignment.crew_id, existing);
      }
    }

    const { venueName, address } = splitVenueAndAddress(selectedShow.venue);
    const showName = selectedShow.name || "ELS Show";
    const rateCity = selectedShow.rate_city || "Default";
    const meta = eventMessageMeta(selectedShow);

    return [...byCrew.entries()]
      .map(([crewId, item]) => {
        const sortedCalls = item.calls.sort((a, b) => `${a.day.labor_date} ${a.call.start_time} ${a.call.area}`.localeCompare(`${b.day.labor_date} ${b.call.start_time} ${b.call.area}`));
        const crewName = item.crew?.name || crewId;
        const primaryArea = boothLabel(sortedCalls[0]?.call.area || "Schedule");
        const firstCall = sortedCalls[0]?.call;
        const savedHourlyRate = Number(meta.default_hourly_rate);
        const rateLine = Number.isFinite(savedHourlyRate) && savedHourlyRate > 0
          ? `Rate: $${savedHourlyRate % 1 === 0 ? savedHourlyRate.toFixed(0) : savedHourlyRate.toFixed(2)}/hr`
          : firstCall ? hourlyRateLabel(item.crew, firstCall, rateCity, masterRates) : "Rate: TBD";
        const scheduleLines = sortedCalls.map(({ day, call }) => `${formatMessageDate(day.labor_date)} – ${formatMessageTimeRange(call)} – ${call.role_name} – ${boothLabel(call.area)}`);
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

    const seen = new Map<string, { crew: CrewRecord | undefined; calls: Array<{ day: LaborDayRecord; call: SubCallRecord }> }>();
    for (const item of displayCalls) {
      for (const assignment of item.callAssignments) {
        const current = seen.get(assignment.assignment.crew_id) ?? { crew: assignment.crew, calls: [] };
        current.calls.push({ day: item.day, call: item.call });
        seen.set(assignment.assignment.crew_id, current);
      }
    }

    return [...seen.entries()].map(([crewId, item]) => {
      const sortedCalls = item.calls.sort((a, b) => `${a.day.labor_date} ${a.call.start_time} ${a.call.area}`.localeCompare(`${b.day.labor_date} ${b.call.start_time} ${b.call.area}`));
      const first = sortedCalls[0];
      const checklist = assignmentChecklists.find((row) => row.show_id === selectedShow.id && row.crew_id === crewId) ?? null;
      return {
        crewId,
        crewName: item.crew?.name || crewId,
        phone: item.crew?.phone || "",
        firstSchedule: first ? `${formatMessageDate(first.day.labor_date)} · ${formatMessageTimeRange(first.call)} · ${first.call.role_name} · ${boothLabel(first.call.area)}` : "No schedule",
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

  function getCallAssignments(callId: string) {
    return assignments
      .filter((assignment) => assignment.sub_call_id === callId)
      .map((assignment) => ({
        assignment,
        crew: crewRecords.find((crew) => crew.id === assignment.crew_id),
      }));
  }


  function notesForAssignment(assignmentId: string) {
    return assignmentNotes.filter((note) => note.assignment_id === assignmentId);
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
    setNoteEditorAssignmentId(noteEditorAssignmentId === assignment.id ? null : assignment.id);
    setNoteSelections([]);
    setNoteCustomText("");
    setNoteVisibility("admin_only");
  }

  function toggleNoteSelection(code: string) {
    setNoteSelections((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
    if (sensitiveNoteCodes.has(code)) setNoteVisibility("admin_only");
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
    const data = await request("/api/assignment-notes", "POST", {
      show_id: selectedShow.id,
      crew_member_id: assignment.crew_id,
      assignment_id: assignment.id,
      visibility: noteVisibility,
      notes,
    });
    if (data?.rows) {
      setAssignmentNotes((current) => [...current, ...(data.rows as AssignmentNoteRecord[])]);
      setNoteSelections([]);
      setNoteCustomText("");
      setNoteEditorAssignmentId(null);
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
    return (
      <div className="card compact" style={{ marginTop: 8, background: "#f9fafb" }}>
        <strong>Add worker notes</strong>
        <div className="small muted" style={{ marginTop: 4 }}>Select one or more professional notes. Sensitive notes default to admin-only.</div>
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
        <label className="field">
          <span>Visibility</span>
          <select value={noteVisibility} onChange={(e) => setNoteVisibility(e.target.value as NoteVisibility)}>
            {Object.entries(noteVisibilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="toolbar">
          <button type="button" className="primary" onClick={() => saveWorkerNotes(assignment)} disabled={saving}>Save Notes</button>
          <button type="button" className="ghost" onClick={() => setNoteEditorAssignmentId(null)}>Cancel</button>
        </div>
      </div>
    );
  }

  function openCrewPickerForCall(callId: string) {
    setCrewPickerCallId(crewPickerCallId === callId ? null : callId);
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
          <span className="small muted">Role matches are suggested first. Anyone in the pool can be assigned.</span>
        </div>
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
          {availableCrew.length ? availableCrew.map((crew) => (
            <div key={crew.id} className="row small">
              <div>
                <strong>{crew.name}</strong>
                <div className="muted">{crew.city_name} • {crew.group_name || "Ungrouped"} • {crew.positions.map((position) => position.role_name).join(", ") || "No saved positions"}</div>
                {matchesRole(crew, call.role_name) ? <div className="small">Suggested role match</div> : <div className="small muted">Available in this pool</div>}
              </div>
              <button type="button" className="ghost" onClick={() => addCrewToCall(crew.id)}>Add</button>
            </div>
          )) : <div className="small muted">No available crew in this pool for this search and date filter.</div>}
        </div>
      </div>
    );
  }

  function renderCallCard(day: LaborDayRecord, call: SubCallRecord, showDate = false) {
    const callAssignments = getCallAssignments(call.id);
    const isCrewOpen = crewPickerCallId === call.id;
    return (
      <div key={call.id} className="card compact sub-call-card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <strong>{showDate ? `${day.labor_date} • ` : ""}{formatTimeRange(call)}</strong>
            <div className="small muted">{call.area} • {call.role_name}</div>
            <div className="small muted">{callAssignments.length}/{call.crew_needed} assigned</div>
          </div>
          <div className="toolbar">
            <button type="button" className="ghost" onClick={() => startEditCall(day.id, call)}>Edit</button>
            <button type="button" className="ghost" onClick={() => openCrewPickerForCall(call.id)}>Add Crew</button>
            <button type="button" className="ghost danger" onClick={() => deleteCall(call.id)}>Delete</button>
          </div>
        </div>

        {editorMode === "call" && editingCallId === call.id ? renderEditorPanel() : null}

        {callAssignments.length ? (
          <div className="list" style={{ marginTop: 10 }}>
            {callAssignments.map(({ assignment, crew }) => {
              const workerNotes = notesForAssignment(assignment.id);
              return (
                <div key={assignment.id} className="card compact" style={{ padding: 10 }}>
                  <div className="row small" style={{ alignItems: "flex-start" }}>
                    <div>
                      <strong>{crew?.name || assignment.crew_id}</strong>
                      <span className="muted"> • {crew?.phone ? formatPhone(crew.phone) : "No phone"} • {assignment.status}</span>
                      {renderWorkerNotes(workerNotes)}
                    </div>
                    <div className="toolbar">
                      <button type="button" className="ghost" onClick={() => openNoteEditor(assignment)}>Add Note</button>
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
      role_name: call.role_name,
      start_time: call.start_time,
      end_time: call.end_time || "",
      crew_needed: String(call.crew_needed),
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
        start_time: safeText(row.start_time),
        end_time: safeText(row.end_time),
        crew_needed: Number(row.crew_needed || 1),
        notes: safeText(row.notes),
      }));
      const nextAssignments: AssignmentRecord[] = (data.assignments ?? []).map((row: AssignmentRecord) => ({
        id: String(row.id),
        sub_call_id: String(row.sub_call_id),
        crew_id: String(row.crew_id),
        status: safeText(row.status) || "confirmed",
      }));

      setShows((current) => mergeById(current, [nextShow]).sort((a, b) => a.show_start.localeCompare(b.show_start)));
      setLaborDays((current) => mergeById(current, nextDays).sort((a, b) => a.labor_date.localeCompare(b.labor_date)));
      setSubCalls((current) => mergeById(current, nextCalls).sort((a, b) => a.start_time.localeCompare(b.start_time)));
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
          formatTimeRange(call),
          call.role_name,
          crew ? formatPhone(crew.phone) : "",
          assignment.status,
          noteSummary(notes, true),
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
              paragraphs: ["No sub-calls for this day."],
            }];
          }
          return dayCalls.map(({ call }) => ({
            heading: `${day.labor_date}${day.label ? ` - ${day.label}` : ""}`,
            subheading: `${boothLabel(call.area)} • ${call.role_name} • ${formatTimeRange(call)} • ${call.crew_needed} needed`,
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
        ...worker.notes.map((note) => `- ${note.custom_note ? `${note.note_label}: ${note.custom_note}` : note.note_label} (${noteVisibilityLabels[(note.visibility as NoteVisibility) || "admin_only"] || note.visibility})`),
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
        paragraphs: worker.notes.map((note) => `${note.custom_note ? `${note.note_label}: ${note.custom_note}` : note.note_label} (${noteVisibilityLabels[(note.visibility as NoteVisibility) || "admin_only"] || note.visibility})`),
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

  async function addCrewToCall(crewId: string) {
    if (!activeCrewCall) return;
    if (crewAvailabilityScope !== "off") {
      const conflicts = bookingConflictsForCrew(crewId, crewAvailabilityDates, activeCrewCall.id);
      const crew = crewRecords.find((row) => row.id === crewId);
      const unavailableDates = crewAvailabilityDates.filter((date) => crew?.unavailable_dates.includes(date));
      if (conflicts.length || unavailableDates.length) {
        const conflictText = conflicts.slice(0, 2).map((item) => `${item.date} · ${item.showName}`).join("; ");
        const unavailableText = unavailableDates.length ? `Unavailable: ${unavailableDates.join(", ")}` : "";
        setMsg({ kind: "error", text: ["This crew member is not available for the selected date scope.", conflictText, unavailableText].filter(Boolean).join(" ") });
        return;
      }
    }
    const data = await request("/api/assignments", "POST", {
      sub_call_id: activeCrewCall.id,
      crew_id: crewId,
      status: "confirmed",
    });
    if (data?.row) {
      setAssignments((current) => {
        const next = current.filter(
          (assignment) => !(assignment.sub_call_id === data.row.sub_call_id && assignment.crew_id === data.row.crew_id)
        );
        return [...next, data.row];
      });
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
      venue: showForm.venue.trim(),
      rate_city: showForm.rate_city.trim() || "Default",
      show_start: showForm.show_start,
      show_end: showForm.show_end,
      notes: composeShowNotes(showForm.notes, {
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
    const targetDayIds = editingCallId
      ? [editingDayTargetId ?? visibleLaborDays[0]?.id ?? ""].filter(Boolean)
      : [...new Set((callTargetDayIds.length ? callTargetDayIds : [editingDayTargetId ?? visibleLaborDays[0]?.id ?? ""]).filter(Boolean))];
    if (!targetDayIds.length) {
      setMsg({ kind: "error", text: "Choose at least one labor day for this sub-call." });
      return;
    }
    const basePayload = {
      area: callForm.area.trim(),
      role_name: callForm.role_name.trim(),
      start_time: callForm.start_time,
      end_time: callForm.end_time,
      crew_needed: Number(callForm.crew_needed || 1),
      notes: callForm.notes.trim(),
    };
    if (!basePayload.area || !basePayload.role_name || !basePayload.start_time) {
      setMsg({ kind: "error", text: "Area, role, and start time are required." });
      return;
    }

    if (editingCallId) {
      const payload = { ...basePayload, labor_day_id: targetDayIds[0] };
      await request(`/api/sub-calls/${editingCallId}`, "PATCH", payload);
      const nextCall: SubCallRecord = { id: editingCallId, ...payload };
      setSubCalls((current) => current.map((call) => (call.id === editingCallId ? nextCall : call)));
      setCrewPickerCallId(nextCall.id);
    } else {
      const createdCalls: SubCallRecord[] = [];
      for (const dayId of targetDayIds) {
        const payload = { ...basePayload, labor_day_id: dayId };
        const data = await request("/api/sub-calls", "POST", payload);
        createdCalls.push({ id: data.id, ...payload });
      }
      setSubCalls((current) => [...current, ...createdCalls].sort((a, b) => `${a.labor_day_id} ${a.start_time}`.localeCompare(`${b.labor_day_id} ${b.start_time}`)));
      if (createdCalls[0]) setCrewPickerCallId(createdCalls[0].id);
      setMsg({ kind: "success", text: `${createdCalls.length} sub-call${createdCalls.length === 1 ? "" : "s"} saved.` });
    }

    setEditingCallId(null);
    setEditingDayTargetId(null);
    setCallTargetDayIds([]);
    setCallForm(emptyCall);
    setEditorMode(null);
    setViewMode("overview");
  }

  async function deleteCall(id: string) {
    if (!confirm("Delete this sub-call?")) return;
    await request(`/api/sub-calls/${id}`, "DELETE");
    setAssignments((current) => current.filter((assignment) => assignment.sub_call_id !== id));
    setSubCalls((current) => current.filter((call) => call.id !== id));
    if (crewPickerCallId === id) setCrewPickerCallId(null);
  }


  function renderAutomationPanel() {
    if (!selectedShow) return null;
    const scheduled = selectedTextQueue.filter((row) => row.status === "scheduled").length;
    const sent = selectedTextQueue.filter((row) => row.status === "sent").length;
    const failed = selectedTextQueue.filter((row) => row.status === "failed").length;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const shortcutPollUrl = buildShortcutPollUrl(origin, selectedShow.id, automationDraft.shortcut_token || "");
    const shortcutRunUrl = buildShortcutRunUrl(shortcutPollUrl);
    const methodInfo = textSendingMethodOptions.find((option) => option.value === automationDraft.sending_method) || textSendingMethodOptions[0];

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
                    Save settings first. Then create an iPhone Shortcut named <strong>ELS Send Due Texts</strong> that gets the URL below, repeats each message, sends it to the phone number, then opens the message&apos;s mark_sent_url.
                  </div>
                </div>
                <span className="badge">No Twilio needed</span>
              </div>
              <label className="field" style={{ marginTop: 12 }}>
                <span>Shortcut API URL</span>
                <input value={shortcutPollUrl || "Save settings to generate the Shortcut URL."} readOnly />
              </label>
              <div className="toolbar">
                <button type="button" className="ghost" onClick={() => shortcutPollUrl ? void copyText(shortcutPollUrl, "Shortcut API URL") : setMsg({ kind: "error", text: "Save settings in Apple Shortcut Mode first." })}>Copy Shortcut API URL</button>
                <button type="button" className="ghost" onClick={() => shortcutRunUrl ? window.location.href = shortcutRunUrl : setMsg({ kind: "error", text: "Save settings and install the ELS Send Due Texts Shortcut first." })}>Run Apple Shortcut now</button>
                <button type="button" className="ghost" onClick={() => void copyText(`ELS Shortcut setup:\n1. Create an iPhone Shortcut named ELS Send Due Texts.\n2. Add Get Contents of URL using this URL:\n${shortcutPollUrl || "SAVE SETTINGS FIRST"}\n3. Get Dictionary Value: messages.\n4. Repeat each message.\n5. Send Message: body to phone.\n6. Get Contents of URL: mark_sent_url after each successful send.\n7. Add Personal Automations at 9:00am, 5:00pm, and hourly on active show days to run this Shortcut.`, "Shortcut setup steps")}>Copy setup steps</button>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                Recommended iPhone personal automations: 9:00am daily, 5:00pm daily, and hourly during active show days. The Shortcut only sends messages that are due.
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
          <div className="row">
            <div>
              <h4 style={{ margin: 0 }}>Text queue status</h4>
              <div className="small muted">Scheduled: {scheduled} • Sent: {sent} • Failed: {failed}</div>
            </div>
          </div>
          {selectedTextQueue.length ? (
            <div className="list" style={{ marginTop: 12 }}>
              {selectedTextQueue.slice(0, 25).map((row) => (
                <div key={row.id} className="card compact" style={{ padding: 10 }}>
                  <div className="row small" style={{ alignItems: "flex-start" }}>
                    <div>
                      <strong>{row.crew_name || "Crew member"}</strong>
                      <div className="muted">{formatPhone(row.phone)} • {row.message_type} • {row.reminder_key}</div>
                      <div className="muted">Scheduled: {new Date(row.scheduled_for).toLocaleString()}</div>
                      {row.error ? <div className="error">{row.error}</div> : null}
                    </div>
                    <span className="badge">{row.status}</span>
                  </div>
                  <textarea readOnly rows={3} value={row.body} style={{ width: "100%", marginTop: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }} />
                  <div className="toolbar" style={{ marginTop: 8 }}>
                    <button type="button" className="ghost" onClick={() => void copyText(row.body, `${row.crew_name || "Crew"} text`)}>Copy body</button>
                    <button type="button" className="ghost" onClick={() => { const href = smsHref(row.phone); if (href) window.location.href = href; else setMsg({ kind: "error", text: "This crew member does not have a phone number." }); }}>Open Messages</button>
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
              <label className="field"><span>Client</span><input value={showForm.client} onChange={(e) => setShowForm((c) => ({ ...c, client: e.target.value }))} /></label>
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
                    <div className="small muted">Pick a date above, click Add selected date, then repeat for every labor day you want created at once.</div>
                  </div>
                  <button type="button" className="ghost" onClick={() => {
                    const value = dayForm.labor_date.trim();
                    if (!value) return;
                    setDayBulkDates((current) => [...new Set([...current, value])].sort());
                  }}>Add selected date</button>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  {[...new Set([dayForm.labor_date, ...dayBulkDates].filter(Boolean))].sort().map((date) => (
                    <span key={date} className="badge">{date} <button type="button" className="inline-icon" onClick={() => setDayBulkDates((current) => current.filter((item) => item !== date))}>×</button></span>
                  ))}
                </div>
              </div>
            ) : null}
            <label className="field"><span>Notes</span><textarea rows={3} value={dayForm.notes} onChange={(e) => setDayForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveDay}>{saving ? "Saving..." : editingDayId ? "Save Labor Day" : "Add Labor Day"}</button>
              <button type="button" className="ghost" onClick={() => { setEditingDayId(null); setDayBulkDates([]); setDayForm(emptyDay); setEditorMode(null); setViewMode("overview"); }}>Cancel</button>
            </div>
          </div>
        ) : null}

        {editorMode === "call" ? (
          <div className="grid" style={{ gap: 14, marginTop: 12 }}>
            <div className="small muted">Labor day: {visibleLaborDays.find((day) => day.id === editingDayTargetId)?.labor_date || "None selected"}</div>
            {!editingCallId ? (
              <div className="card compact sub-call-multi-day">
                <strong>Create this sub-call on multiple labor days</strong>
                <div className="small muted">Select every date this same area/role/time should be created on.</div>
                <div className="grid grid-3" style={{ marginTop: 10 }}>
                  {visibleLaborDays.map((day) => (
                    <label key={day.id} className="checkline">
                      <input
                        type="checkbox"
                        checked={callTargetDayIds.includes(day.id)}
                        onChange={(event) => setCallTargetDayIds((current) => event.currentTarget.checked ? [...new Set([...current, day.id])] : current.filter((id) => id !== day.id))}
                      />
                      <span>{day.labor_date}{day.label ? ` · ${day.label}` : ""}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid grid-2">
              <label className="field"><span>Area</span><input value={callForm.area} onChange={(e) => setCallForm((c) => ({ ...c, area: e.target.value }))} placeholder="Booth, GS, breakouts..." /></label>
              <label className="field"><span>Role</span><input value={callForm.role_name} onChange={(e) => setCallForm((c) => ({ ...c, role_name: e.target.value }))} placeholder="General AV, LED Assist..." /></label>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
              <label className="field"><span>Start</span><input type="time" value={callForm.start_time} onChange={(e) => setCallForm((c) => ({ ...c, start_time: e.target.value }))} /></label>
              <label className="field"><span>End</span><input type="time" value={callForm.end_time} onChange={(e) => setCallForm((c) => ({ ...c, end_time: e.target.value }))} /></label>
              <label className="field"><span>Crew needed</span><input type="number" min="1" value={callForm.crew_needed === "0" ? "" : callForm.crew_needed} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCallForm((c) => ({ ...c, crew_needed: e.target.value }))} placeholder="1" /></label>
            </div>
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

          <label className="field">
            <span>Main search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Show, client, venue, city..." />
          </label>

          <div className="list" style={{ marginTop: 16 }}>
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
          </div>

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
                    <div className="muted">{selectedShow.client || "No client"} • {selectedShow.venue || "No venue"}</div>
                    <div className="muted">{selectedShow.show_start} to {selectedShow.show_end} • <span className={`badge ${showBucketBadgeClass(showBucket(selectedShow))}`}>{showBucket(selectedShow)}</span> Rate city: {selectedShow.rate_city || "Default"}</div>
                    {eventPool ? <div className="small" style={{ marginTop: 8 }}><strong>Staffing pool:</strong> {eventPool}</div> : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>${estimate.toLocaleString()}</div>
                    <div className="muted">Estimated payout</div>
                  </div>
                </div>
                <div className="toolbar small" style={{ marginTop: 10 }}>
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
                      <option value="notes">Worker notes</option>
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
                  ) : eventDisplayMode === "notes" ? (
                    <>
                      <button type="button" className="ghost" onClick={exportWorkerNotesPdf}>PDF Worker Notes</button>
                      <button type="button" className="ghost" onClick={exportWorkerNotesDocx}>DOCX</button>
                      <button type="button" className="ghost" onClick={exportWorkerNotesText}>TXT</button>
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

              {(editorMode === "show" || (editorMode === "day" && !editingDayId)) ? renderEditorPanel() : null}

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
              ) : eventDisplayMode === "notes" ? (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>Worker notes</h4>
                      <div className="small muted">Professional show-specific notes collected under each person.</div>
                    </div>
                    <button type="button" className="ghost" onClick={exportWorkerNotesPdf}>PDF worker notes</button>
                    <button type="button" className="ghost" onClick={exportWorkerNotesDocx}>DOCX</button>
                    <button type="button" className="ghost" onClick={exportWorkerNotesText}>TXT</button>
                  </div>
                  {workerNoteSummaries.length ? workerNoteSummaries.map((worker) => (
                    <div key={worker.crewId} className="card compact">
                      <strong>{worker.crewName}</strong>
                      <div className="small muted">{worker.phone ? formatPhone(worker.phone) : "No phone"}</div>
                      <ul style={{ marginBottom: 0 }}>
                        {worker.notes.map((note) => (
                          <li key={note.id}>
                            {note.custom_note ? `${note.note_label}: ${note.custom_note}` : note.note_label}
                            <span className="muted"> · {noteVisibilityLabels[(note.visibility as NoteVisibility) || "admin_only"] || note.visibility}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )) : <p className="small muted">No worker notes have been added for this show yet.</p>}
                </div>
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
                    const dayCalls = subCalls.filter((call) => call.labor_day_id === day.id).sort((a, b) => a.start_time.localeCompare(b.start_time));
                    return (
                      <div key={day.id} className="card compact" style={{ borderTop: "3px solid #111827" }}>
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
                            {dayCalls.length ? dayCalls.map((call) => renderCallCard(day, call)) : <div className="small muted">No sub-calls yet for this labor day.</div>}
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
                      <div key={section.booth} className="card compact" style={{ borderTop: "3px solid #111827" }}>
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
                              <div key={`${section.booth}-${date}`} className="card compact" style={{ background: "#f9fafb" }}>
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
                                  {callsForDate.map(({ day: callDay, call }) => renderCallCard(callDay, call, true))}
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
