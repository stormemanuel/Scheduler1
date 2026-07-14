import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
import { createSupabaseAdminClient, createSupabaseServerClient, syncAssignmentChecklistFromSentMessage } from "@/lib/supabase-server";

const META_START = "[[ELS_EVENT_MESSAGE_DETAILS]]";
const META_END = "[[/ELS_EVENT_MESSAGE_DETAILS]]";

const MEET_AT_BOOTH_MARKER = "[[ELS_MEET_AT_BOOTH]]";

function callMeetAtBooth(call: { notes?: string | null }) {
  return safeText(call.notes).includes(MEET_AT_BOOTH_MARKER);
}

function callBoothMeetupLocation(call: { area?: string | null; location?: string | null }) {
  return [safeText(call.area), safeText(call.location)].filter(Boolean).join(" ").trim();
}

type AutomationSettings = {
  show_id: string;
  enabled: boolean;
  sending_method: "manual" | "shortcut" | "provider";
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
};

type ShowRow = { id: string; name: string | null; client: string | null; venue: string | null; event_location?: string | null; rate_city: string | null; show_start: string; show_end: string; notes: string | null };
type LaborDayRow = { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null };
type SubCallRow = { id: string; labor_day_id: string; area: string | null; location?: string | null; role_name: string | null; master_rate_id?: string | null; message_rate?: string | number | null; start_time: string | null; end_time: string | null; crew_needed: number | null; notes: string | null; sort_order?: number | null; day_type?: string | null; one_hour_walkaway?: boolean | null };
type AssignmentRow = { id: string; sub_call_id: string; crew_id: string; status: string | null; sort_order?: number | null; start_time?: string | null; end_time?: string | null; day_type?: string | null };
type CrewPositionRow = { crew_id: string; role_name: string | null; rate: string | number | null };
type CrewRow = { id: string; name: string | null; phone: string | null; email: string | null; positions: CrewPositionRow[] };
type MasterRateRow = { id: string; city_name: string | null; role_name: string | null; full_day: string | number | null };

type QueueRow = {
  show_id: string;
  crew_id: string;
  crew_name: string;
  phone: string;
  message_type: string;
  reminder_key: string;
  scheduled_for: string;
  status: string;
  body: string;
  queued_by_user_id?: string | null;
  queued_by_email?: string | null;
  queued_by_name?: string | null;
};

type IntroQueueRow = {
  id: string;
  crew_id: string | null;
  crew_name: string | null;
  phone: string | null;
  body: string | null;
  status: string | null;
  scheduled_for: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
  queued_by_user_id?: string | null;
  queued_by_email?: string | null;
  queued_by_name?: string | null;
};

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  const displayName = safeText((profile as { full_name?: string | null } | null)?.full_name)
    || safeText((profile as { email?: string | null } | null)?.email)
    || safeText(user.email)
    || "ELS user";
  return { ok: true as const, user: { ...user, display_name: displayName } };
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeRole(value: unknown) {
  return safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedRateRole(value: unknown) {
  return normalizeRole(value).replace(/\s+(?:wl|working lead|waitlist)$/i, "").trim();
}

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

const fallbackFullDayRates: Record<string, number> = {
  "general av": 350,
  gav: 350,
  avt: 350,
  "led assist": 350,
  "led stagehand": 350,
  stagehand: 300,
  "stage hand": 300,
  "client facing audio visual tech": 400,
  "breakout operator": 400,
  "bo tech": 400,
  floater: 350,
  "crew lead": 500,
  "warehouse worker": 300,
  "warehouse workers": 300,
  warehouse: 300,
};

function roleKeys(roleName: unknown) {
  const target = normalizeRole(roleName);
  const baseTarget = normalizedRateRole(roleName) || target;
  const keys = new Set([
    target,
    baseTarget,
    ...(roleAliases[target] || []),
    ...(roleAliases[baseTarget] || []),
  ].filter(Boolean));
  for (const [canonical, aliases] of Object.entries(roleAliases)) {
    if (canonical === target || canonical === baseTarget || aliases.includes(target) || aliases.includes(baseTarget)) {
      keys.add(canonical);
      aliases.forEach((alias) => keys.add(alias));
    }
  }
  if (/\bled\b/.test(baseTarget) && /\bstagehand\b/.test(baseTarget)) {
    keys.add("led assist");
    keys.add("led stagehand");
  }
  return keys;
}

function roleMatchScore(rateRoleName: unknown, requestedRoleName: unknown) {
  const rateRole = normalizeRole(rateRoleName);
  const requestedRole = normalizeRole(requestedRoleName);
  const rateBase = normalizedRateRole(rateRoleName) || rateRole;
  const requestedBase = normalizedRateRole(requestedRoleName) || requestedRole;
  if (!rateRole || !requestedRole) return 0;
  if (rateRole === requestedRole) return 1200;
  if (rateBase === requestedBase) return 1100;

  const rateKeys = roleKeys(rateRoleName);
  const requestedKeys = roleKeys(requestedRoleName);
  if (requestedKeys.has(rateRole) || requestedKeys.has(rateBase)) return 900;
  if (rateKeys.has(requestedRole) || rateKeys.has(requestedBase)) return 850;
  for (const key of rateKeys) if (requestedKeys.has(key)) return 700;

  if (rateBase.length >= 8 && requestedBase.length >= 8 && (rateBase.includes(requestedBase) || requestedBase.includes(rateBase))) return 250;
  return 0;
}

function roleMatches(left: unknown, right: unknown) {
  return roleMatchScore(left, right) > 0;
}

function firstName(name: string) {
  return safeText(name).split(/\s+/)[0] || "there";
}

function cleanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.trim().startsWith("+")) return value.trim();
  return digits ? `+${digits}` : "";
}

function queueIdentity(user: { id: string; email?: string | null; display_name?: string | null }) {
  return {
    queued_by_user_id: user.id,
    queued_by_email: user.email || null,
    queued_by_name: user.display_name || user.email || null,
  };
}

function stampRows<T extends object>(rows: T[], user: { id: string; email?: string | null; display_name?: string | null }) {
  const identity = queueIdentity(user);
  return rows.map((row) => ({ ...row, ...identity }));
}

function senderNameForMessage(user: { email?: string | null; display_name?: string | null }) {
  return safeText(user.display_name) || safeText(user.email) || "ELS Coordinator";
}

function ensureSenderIdentity(message: unknown, senderName: unknown) {
  let body = safeText(message);
  const name = safeText(senderName);
  if (!body || !name) return body;

  if (/^Coordinator:\s*[^\r\n]+/im.test(body)) {
    body = body.replace(/^Coordinator:\s*[^\r\n]+/im, `Coordinator: ${name}`);
  }
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(escapedName, "i").test(body)) return body;
  return `${body}\n\nCoordinator: ${name}\nEmanuel Labor Services`;
}

function isMissingSenderColumns(message: string) {
  return message.includes("queued_by_user_id") || message.includes("queued_by_email") || message.includes("queued_by_name") || message.includes("schema cache");
}

async function insertIntroRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, rows: Record<string, unknown>[]) {
  const selectColumns = "id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name";
  const withSender = await admin.from("crew_intro_text_queue").insert(rows).select(selectColumns);
  if (!withSender.error) return withSender.data as IntroQueueRow[];
  if (!isMissingSenderColumns(withSender.error.message)) throw new Error(withSender.error.message);
  const legacyRows = rows.map(({ queued_by_user_id, queued_by_email, queued_by_name, ...row }) => row);
  const legacy = await admin.from("crew_intro_text_queue").insert(legacyRows).select(selectColumns);
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data as IntroQueueRow[];
}

async function upsertTextQueueRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, rows: QueueRow[]) {
  const selectColumns = "id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name";
  const withSender = await admin
    .from("text_message_queue")
    .upsert(rows, { onConflict: "show_id,crew_id,message_type,reminder_key" })
    .select(selectColumns);
  if (!withSender.error) return withSender.data || [];
  if (!isMissingSenderColumns(withSender.error.message)) throw new Error(withSender.error.message);
  const legacyRows = rows.map(({ queued_by_user_id, queued_by_email, queued_by_name, ...row }) => row);
  const legacy = await admin
    .from("text_message_queue")
    .upsert(legacyRows, { onConflict: "show_id,crew_id,message_type,reminder_key" })
    .select(selectColumns);
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data || [];
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${month}/${day}/${String(year).slice(2)}`;
}

function minutesFromTime(value: string | null | undefined) {
  const raw = safeText(value).toLowerCase();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = match[3];
  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function formatTime(value: string | null | undefined) {
  const minutes = minutesFromTime(value);
  if (minutes === null) return safeText(value);
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatTimeRange(call: SubCallRow) {
  return `${formatTime(call.start_time)}–${formatTime(call.end_time)}`;
}

function assignmentStartTime(assignment: AssignmentRow, call: SubCallRow) {
  return assignment.start_time || call.start_time;
}

function assignmentEndTime(assignment: AssignmentRow, call: SubCallRow) {
  return assignment.end_time || call.end_time;
}

function durationHoursBetween(startValue: string | null | undefined, endValue: string | null | undefined) {
  const start = minutesFromTime(startValue);
  const end = minutesFromTime(endValue);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

function assignmentTimeRange(assignment: AssignmentRow, call: SubCallRow) {
  const start = assignmentStartTime(assignment, call);
  const end = assignmentEndTime(assignment, call);
  return `${formatTime(start)}–${formatTime(end)}`;
}

function dayTypeLabel(value: string | null | undefined) {
  if (value === "full_day") return "Full day";
  if (value === "half_day") return "Half day";
  if (value === "custom") return "Custom time";
  return "";
}

function assignmentDayType(assignment: AssignmentRow, call: SubCallRow) {
  const elapsed = durationHoursBetween(assignmentStartTime(assignment, call), assignmentEndTime(assignment, call));
  const duration = elapsed === null ? null : Math.max(0, elapsed - (call.one_hour_walkaway ? 1 : 0));
  if (duration !== null && duration <= 5) return "half_day";
  return assignment.day_type || call.day_type || "";
}

function addDays(dateString: string, delta: number) {
  const [year, month, day] = dateString.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + delta, 0, 0, 0));
  return date.toISOString().slice(0, 10);
}

function zonedDateTimeToUtcIso(dateString: string, timeString: string, timeZone: string) {
  const [year, month, day] = dateString.slice(0, 10).split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  let utc = new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0));
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(utc);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
    const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const targetAsUtc = Date.UTC(year, month - 1, day, hour || 0, minute || 0, 0);
    utc = new Date(utc.getTime() + (targetAsUtc - localAsUtc));
  }
  return utc.toISOString();
}

function subtractMinutesFromZoned(dateString: string, timeString: string, minutes: number, timeZone: string) {
  const iso = zonedDateTimeToUtcIso(dateString, timeString || "09:00", timeZone);
  return new Date(new Date(iso).getTime() - minutes * 60000).toISOString();
}

function scheduledLocalToUtcIso(value: string, timeZone: string) {
  const clean = safeText(value);
  const match = clean.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) return new Date(Date.now() + 30_000).toISOString();
  return zonedDateTimeToUtcIso(match[1], match[2], timeZone);
}

function sameClockTime(left: string | null | undefined, right: string | null | undefined) {
  const leftMinutes = minutesFromTime(left);
  const rightMinutes = minutesFromTime(right);
  return leftMinutes !== null && rightMinutes !== null && leftMinutes === rightMinutes;
}


function todayInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function autoManualReminderDay(days: LaborDayRow[], reminderKey: string, timeZone: string) {
  const sorted = [...days].sort((a, b) => a.labor_date.localeCompare(b.labor_date));
  if (!sorted.length) return null;
  const today = todayInTimeZone(timeZone);
  const offset = reminderKey === "day_before" ? 1 : reminderKey === "day_of" ? 0 : reminderKey === "3_day" ? 3 : reminderKey === "7_day" ? 7 : 0;
  const targetDate = addDays(today, offset);
  return (
    sorted.find((day) => day.labor_date.slice(0, 10) === targetDate) ||
    sorted.find((day) => day.labor_date.slice(0, 10) >= targetDate) ||
    sorted.find((day) => day.labor_date.slice(0, 10) >= today) ||
    sorted[0]
  );
}

function parseEventMeta(notes: string | null | undefined) {
  const raw = safeText(notes);
  const start = raw.indexOf(META_START);
  const end = raw.indexOf(META_END);
  if (start >= 0 && end > start) {
    const encoded = raw.slice(start + META_START.length, end).trim();
    try {
      return JSON.parse(encoded) as Record<string, string>;
    } catch {
      return {} as Record<string, string>;
    }
  }
  return {} as Record<string, string>;
}

function applyTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key] ?? "");
}

function formatHourlyRate(value: unknown) {
  const amount = Number(safeText(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return "";
  const label = amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2);
  return `$${label}/hr`;
}

function messageRateForCall(call: SubCallRow, _crew: CrewRow, show: ShowRow, masterRates: MasterRateRow[], _meta: Record<string, string>) {
  // The outgoing schedule rate is determined only by the position selected on
  // the sub-call. Never use a crew contact rate, a manual message-rate value,
  // or the show's default hourly rate.
  const linkedMasterRate = call.master_rate_id ? masterRates.find((rate) => rate.id === call.master_rate_id) : null;
  const effectiveRoleName = call.role_name || linkedMasterRate?.role_name || "";
  const targetCity = normalizeRole(show.rate_city || "Default") || "default";
  const bestForCity = (city: string) => masterRates
    .filter((rate) => normalizeRole(rate.city_name || "Default") === city)
    .map((rate) => ({ rate, score: roleMatchScore(rate.role_name, effectiveRoleName) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.rate ?? null;
  const cityMasterRate = bestForCity(targetCity);
  const defaultMasterRate = bestForCity("default");
  const matchedFullDay = Number((cityMasterRate || defaultMasterRate || linkedMasterRate)?.full_day || 0);
  if (matchedFullDay > 0) return formatHourlyRate(matchedFullDay / 10);

  const fallbackKey = [...roleKeys(call.role_name)].find((key) => Number(fallbackFullDayRates[key]) > 0);
  if (fallbackKey) return formatHourlyRate(fallbackFullDayRates[fallbackKey] / 10);

  return "Rate TBD";
}

function normalizeAvailabilityTemplate(value: unknown) {
  const text = safeText(value);
  const oldDefault = "Hi {first_name}, this is {coordinator_name} with Emanuel Labor Services. Are you available for {show_name} at {venue} from {show_start} to {show_end}? Please reply with the dates/times you can work. Thank you.";
  if (!text || text === oldDefault) return defaultAvailabilityTemplate;
  return text;
}

function normalizeReminderTemplate(value: unknown) {
  const text = safeText(value);
  const oldDefault = "Hi {first_name}, quick confirmation for {show_name}. Your next call is {next_call}. Meet-up Location: {meet_up_location}. Please reply confirmed. - {coordinator_name}";
  if (!text || text === oldDefault) return defaultReminderTemplate;
  return text;
}

function normalizeScheduleTemplate(value: unknown) {
  const text = safeText(value);
  const cleaned = text.replace(/,\s*as requested by the client\./gi, ".");
  const oldDefault = "Hi {first_name}, this is {coordinator_name} with Emanuel Labor Services. Here is your schedule for {show_name}:\n\n{schedule}\n\nMeet-up Location: {meet_up_location}\nRate: {rate}\nAttire: black polo, black pants, black shoes. Please arrive clean, well-groomed, and professionally presented.\n\nPlease confirm.";
  const priorDefault = "Hi {first_name} – {show_name} @ {venue}\n\n{location}\n\nMeet-up Location: {meet_up_location}\n\nPosition: {position}\nRate: {rate}\n\nSchedule:\n{schedule}\n\nAttire: Black polo, black pants, and black shoes. Please arrive clean, well-groomed, and professionally presented.\n\nPlease confirm.";
  if (!cleaned || cleaned === oldDefault || cleaned === priorDefault) return defaultScheduleTemplate;
  return cleaned;
}

const defaultAvailabilityTemplate = "Hello {first_name}, are you available to work {show_start} through {show_end} for {show_name}? I have some days between those dates I’m looking to get filled. Please respond ASAP, as the positions are filled quickly.";
const defaultScheduleTemplate = "Hi {first_name} – {show_name} @ {venue}\n\n{location}\n\nMeet-up Location: {meet_up_location}\n\nPosition: {position}\nRate: {rate}\n\nSchedule:\n{schedule}\n\nDates and times are subject to change.\n\nAttire: Black polo, black pants, and black shoes. Please arrive clean, well-groomed, and professionally presented.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services\n\nPlease confirm.";
const defaultReminderTemplate = "Hi {first_name}, quick confirmation for {show_name} at {venue}. Your next call is {next_call}. Meet-up Location: {meet_up_location}. Please reply confirmed.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services";
const defaultDayOfReminderTemplate = "Good Morning, we are meeting at {meet_up_location} for {show_name} at {venue}. See you soon. Please confirm.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services";

function normalizeSettings(bodySettings: Partial<AutomationSettings>, showId: string): AutomationSettings {
  return {
    show_id: showId,
    enabled: Boolean(bodySettings.enabled),
    sending_method: bodySettings.sending_method === "provider" ? "provider" : "shortcut",
    shortcut_token: safeText(bodySettings.shortcut_token),
    send_availability: Boolean(bodySettings.send_availability),
    send_schedule: bodySettings.send_schedule !== false,
    reminder_7_day: bodySettings.reminder_7_day !== false,
    reminder_3_day: Boolean(bodySettings.reminder_3_day),
    reminder_day_before: bodySettings.reminder_day_before !== false,
    reminder_day_of: bodySettings.reminder_day_of !== false,
    timezone: safeText(bodySettings.timezone) || "America/Chicago",
    availability_template: normalizeAvailabilityTemplate(bodySettings.availability_template),
    schedule_template: normalizeScheduleTemplate(bodySettings.schedule_template),
    reminder_template: normalizeReminderTemplate(bodySettings.reminder_template),
  };
}

function nextScheduleByCrew(show: ShowRow, days: LaborDayRow[], calls: SubCallRow[], assignments: AssignmentRow[], crewRows: CrewRow[], masterRates: MasterRateRow[], settings: AutomationSettings, senderName = "") {
  const crewById = new Map(crewRows.map((crew) => [crew.id, crew]));
  const dayById = new Map(days.map((day) => [day.id, day]));
  const callById = new Map(calls.map((call) => [call.id, call]));
  const meta = parseEventMeta(show.notes);
  const result = new Map<string, { crew: CrewRow; lines: Array<{ sortKey: string; text: string }>; meetUps: string[]; rates: string[]; firstCall: { day: LaborDayRow; call: SubCallRow; assignment: AssignmentRow } | null; values: Record<string, string> }>();

  for (const assignment of [...assignments].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const crew = crewById.get(assignment.crew_id);
    const call = callById.get(assignment.sub_call_id);
    const day = call ? dayById.get(call.labor_day_id) : null;
    if (!crew || !call || !day) continue;
    const current = result.get(crew.id) || { crew, lines: [], meetUps: [], rates: [], firstCall: null, values: {} as Record<string, string> };
    const blockLabel = dayTypeLabel(assignmentDayType(assignment, call));
    const rateText = messageRateForCall(call, crew, show, masterRates, meta);
    current.lines.push({
      sortKey: `${day.labor_date.slice(0, 10)} ${assignment.start_time || call.start_time || ""} ${call.area || ""}`,
      text: `${formatDate(day.labor_date)} - ${assignmentTimeRange(assignment, call)} - ${blockLabel} - ${rateText}`,
    });
    if (rateText !== "Rate TBD") current.rates.push(rateText);
    if (callMeetAtBooth(call)) {
      const boothMeetup = callBoothMeetupLocation(call);
      if (boothMeetup) current.meetUps.push(boothMeetup);
    }
    const firstKey = current.firstCall ? `${current.firstCall.day.labor_date} ${current.firstCall.assignment.start_time || current.firstCall.call.start_time || ""}` : "";
    const thisKey = `${day.labor_date} ${assignment.start_time || call.start_time || ""}`;
    if (!current.firstCall || thisKey.localeCompare(firstKey) < 0) current.firstCall = { day, call, assignment };
    result.set(crew.id, current);
  }

  const coordinatorName = safeText(senderName) || meta.coordinator_name || "Storm Leigh";
  const coordinatorPhone = meta.coordinator_phone || "504-657-6618";
  const meetUp = meta.meet_up_location || "TBD onsite";

  for (const item of result.values()) {
    const schedule = item.lines
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((line) => line.text)
      .join("\n");
    const uniqueRates = [...new Set(item.rates)];
    const rate = uniqueRates.length === 1
      ? uniqueRates[0]
      : uniqueRates.length > 1
        ? "Varies by call (see schedule)"
        : "TBD";
    const positions = [...new Set(
      item.firstCall
        ? assignments
            .filter((assignment) => assignment.crew_id === item.crew.id)
            .map((assignment) => callById.get(assignment.sub_call_id)?.role_name || "Crew")
        : ["Crew"]
    )].join(" / ");
    const nextCall = item.firstCall ? `${formatDate(item.firstCall.day.labor_date)} ${assignmentTimeRange(item.firstCall.assignment, item.firstCall.call)} - ${dayTypeLabel(assignmentDayType(item.firstCall.assignment, item.firstCall.call))}` : "Schedule TBD";
    item.values = {
      first_name: firstName(item.crew.name || ""),
      crew_name: item.crew.name || "Crew member",
      show_name: show.name || "ELS Show",
      client: show.client || "",
      venue: show.venue || "",
      location: show.event_location || show.rate_city || show.venue || "",
      show_start: formatDate(show.show_start),
      show_end: formatDate(show.show_end),
      meet_up_location: [...new Set(item.meetUps)].length ? [...new Set(item.meetUps)].join(" / ") : meetUp,
      position: positions,
      schedule,
      next_call: nextCall,
      rate,
      coordinator_name: coordinatorName,
      coordinator_phone: coordinatorPhone,
    };
  }

  return result;
}

async function fetchShowBundle(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string) {
  const showRes = await admin.from("shows").select("id, name, client, venue, event_location, rate_city, show_start, show_end, notes").eq("id", showId).single();
  if (showRes.error || !showRes.data) throw new Error(showRes.error?.message || "Show not found.");
  const show = showRes.data as ShowRow;
  const daysRes = await admin.from("labor_days").select("id, show_id, labor_date, label, notes").eq("show_id", showId);
  if (daysRes.error) throw new Error(daysRes.error.message);
  const days = (daysRes.data || []) as LaborDayRow[];
  const dayIds = days.map((day) => day.id);
  const callsRes = dayIds.length ? await admin.from("sub_calls").select("id, labor_day_id, area, location, po_number, role_name, master_rate_id, message_rate, start_time, end_time, crew_needed, notes, sort_order, day_type, one_hour_walkaway").in("labor_day_id", dayIds) : { data: [], error: null };
  if (callsRes.error) throw new Error(callsRes.error.message);
  const calls = (callsRes.data || []) as SubCallRow[];
  const callIds = calls.map((call) => call.id);
  const assignmentsRes = callIds.length ? await admin.from("assignments").select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type").in("sub_call_id", callIds).order("sort_order", { ascending: true }) : { data: [], error: null };
  if (assignmentsRes.error) throw new Error(assignmentsRes.error.message);
  const assignments = (assignmentsRes.data || []) as AssignmentRow[];
  const crewIds = [...new Set(assignments.map((assignment) => assignment.crew_id))];
  const [crewRes, positionsRes, masterRatesRes] = await Promise.all([
    crewIds.length ? admin.from("crew").select("id, name, phone, email").in("id", crewIds) : Promise.resolve({ data: [], error: null }),
    crewIds.length ? admin.from("crew_positions").select("crew_id, role_name, rate").in("crew_id", crewIds) : Promise.resolve({ data: [], error: null }),
    admin.from("master_rates").select("id, city_name, role_name, full_day"),
  ]);
  if (crewRes.error) throw new Error(crewRes.error.message);
  if (positionsRes.error) throw new Error(positionsRes.error.message);
  if (masterRatesRes.error) throw new Error(masterRatesRes.error.message);
  const positionsByCrew = new Map<string, CrewPositionRow[]>();
  for (const position of (positionsRes.data || []) as CrewPositionRow[]) {
    positionsByCrew.set(position.crew_id, [...(positionsByCrew.get(position.crew_id) || []), position]);
  }
  const crewRows = ((crewRes.data || []) as Array<Omit<CrewRow, "positions">>).map((crew) => ({
    ...crew,
    positions: positionsByCrew.get(crew.id) || [],
  }));
  return { show, days, calls, assignments, crewRows, masterRates: (masterRatesRes.data || []) as MasterRateRow[] };
}

function buildQueueRows(
  mode: "availability" | "schedule_reminders",
  settings: AutomationSettings,
  bundle: Awaited<ReturnType<typeof fetchShowBundle>>,
  senderName: string,
  options: { forceNowReminderKey?: string; laborDayId?: string; forceNowLabel?: string; additionalNote?: string } = {}
) {
  const filteredDays = options.laborDayId ? bundle.days.filter((day) => day.id === options.laborDayId) : bundle.days;
  const filteredDayIds = new Set(filteredDays.map((day) => day.id));
  const filteredCalls = options.laborDayId ? bundle.calls.filter((call) => filteredDayIds.has(call.labor_day_id)) : bundle.calls;
  const filteredCallIds = new Set(filteredCalls.map((call) => call.id));
  const filteredAssignments = options.laborDayId ? bundle.assignments.filter((assignment) => filteredCallIds.has(assignment.sub_call_id)) : bundle.assignments;
  const byCrew = nextScheduleByCrew(bundle.show, filteredDays, filteredCalls, filteredAssignments, bundle.crewRows, bundle.masterRates, settings, senderName);
  const rows: QueueRow[] = [];
  const nowIso = new Date(Date.now() + 30_000).toISOString();
  const manualLabel = safeText(options.forceNowLabel).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
  const additionalNote = safeText(options.additionalNote);
  const manualBatchKey = `manual_${options.forceNowReminderKey || ""}${manualLabel ? `_${manualLabel}` : ""}_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  for (const [crewId, item] of byCrew.entries()) {
    const phone = cleanPhone(item.crew.phone || "");
    if (!phone) continue;
    if (mode === "availability" && settings.send_availability) {
      rows.push({
        show_id: settings.show_id,
        crew_id: crewId,
        crew_name: item.crew.name || "Crew member",
        phone,
        message_type: "availability",
        reminder_key: "availability_now",
        scheduled_for: nowIso,
        status: "scheduled",
        body: ensureSenderIdentity(applyTemplate(settings.availability_template || defaultAvailabilityTemplate, item.values), senderName),
      });
    }
    if (mode === "schedule_reminders" && settings.send_schedule) {
      const reminders: Array<{ enabled: boolean; key: string; scheduledFor: string; template: string; messageType: string }> = [
        { enabled: settings.reminder_7_day, key: "7_day", scheduledFor: zonedDateTimeToUtcIso(addDays(bundle.show.show_start, -7), "09:00", settings.timezone), template: settings.schedule_template || defaultScheduleTemplate, messageType: "schedule" },
        { enabled: settings.reminder_3_day, key: "3_day", scheduledFor: zonedDateTimeToUtcIso(addDays(bundle.show.show_start, -3), "09:00", settings.timezone), template: settings.reminder_template || defaultReminderTemplate, messageType: "reminder" },
        { enabled: settings.reminder_day_before, key: "day_before", scheduledFor: zonedDateTimeToUtcIso(addDays(bundle.show.show_start, -1), "17:00", settings.timezone), template: settings.reminder_template || defaultReminderTemplate, messageType: "reminder" },
        { enabled: settings.reminder_day_of, key: "day_of", scheduledFor: item.firstCall ? subtractMinutesFromZoned(item.firstCall.day.labor_date, item.firstCall.call.start_time || "09:00", 120, settings.timezone) : zonedDateTimeToUtcIso(bundle.show.show_start, "07:00", settings.timezone), template: defaultDayOfReminderTemplate, messageType: "reminder" },
      ];
      for (const reminder of reminders) {
        const forceNow = Boolean(options.forceNowReminderKey && reminder.key === options.forceNowReminderKey);
        if (options.forceNowReminderKey && !forceNow) continue;
        if (!forceNow && !reminder.enabled) continue;
        const messageBody = ensureSenderIdentity(applyTemplate(reminder.template, item.values), senderName);
        rows.push({
          show_id: settings.show_id,
          crew_id: crewId,
          crew_name: item.crew.name || "Crew member",
          phone,
          message_type: reminder.messageType,
          reminder_key: forceNow ? manualBatchKey : reminder.key,
          scheduled_for: forceNow ? nowIso : reminder.scheduledFor,
          status: "scheduled",
          body: reminder.messageType === "schedule" && additionalNote ? `${messageBody}\n\n${additionalNote}` : messageBody,
        });
      }
    }
  }
  return rows;
}

function buildCustomQueueRows(
  settings: AutomationSettings,
  bundle: Awaited<ReturnType<typeof fetchShowBundle>>,
  senderName: string,
  options: { laborDayId?: string; eventWide?: boolean; subCallId?: string; subCallIds?: string[]; startTime?: string; endTime?: string; scheduledLocal?: string; body: string }
) {
  const targetDayIds = options.eventWide
    ? new Set(bundle.days.map((day) => day.id))
    : new Set([options.laborDayId || ""].filter(Boolean));
  const selectedSubCallIds = new Set([...(options.subCallIds || []), options.subCallId || ""].map(safeText).filter(Boolean));
  const targetCalls = bundle.calls.filter((call) => targetDayIds.has(call.labor_day_id) && (!selectedSubCallIds.size || selectedSubCallIds.has(call.id)));
  const targetCallIds = new Set(targetCalls.map((call) => call.id));
  const targetDayIdSet = new Set(targetCalls.map((call) => call.labor_day_id));
  const targetDays = bundle.days.filter((day) => targetDayIdSet.has(day.id));
  const rows: QueueRow[] = [];
  const scheduledFor = scheduledLocalToUtcIso(options.scheduledLocal || "", settings.timezone);
  const batchScope = options.eventWide ? `event_${settings.show_id}` : safeText(options.laborDayId).slice(0, 8);
  const batchKey = `custom_${batchScope}_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const targetAssignments = bundle.assignments.filter((assignment) => {
    if (!targetCallIds.has(assignment.sub_call_id)) return false;
    const call = targetCalls.find((row) => row.id === assignment.sub_call_id);
    if (!call) return false;
    if (options.startTime && !sameClockTime(assignmentStartTime(assignment, call), options.startTime)) return false;
    if (options.endTime && !sameClockTime(assignmentEndTime(assignment, call), options.endTime)) return false;
    return true;
  });
  const byCrew = nextScheduleByCrew(bundle.show, targetDays, targetCalls, targetAssignments, bundle.crewRows, bundle.masterRates, settings, senderName);

  for (const [crewId, item] of byCrew.entries()) {
    const phone = cleanPhone(item.crew.phone || "");
    if (!phone) continue;
    rows.push({
      show_id: settings.show_id,
      crew_id: crewId,
      crew_name: item.crew.name || "Crew member",
      phone,
      message_type: "custom",
      reminder_key: batchKey,
      scheduled_for: scheduledFor,
      status: "scheduled",
      body: ensureSenderIdentity(applyTemplate(options.body, item.values), senderName),
    });
  }

  return rows;
}

async function existingShortcutToken(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>) {
  const { data } = await admin
    .from("show_text_automations")
    .select("shortcut_token")
    .eq("sending_method", "shortcut")
    .not("shortcut_token", "is", null)
    .limit(1);
  const token = safeText((data?.[0] as { shortcut_token?: string } | undefined)?.shortcut_token);
  return token;
}

async function saveSettings(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, settings: AutomationSettings) {
  const sharedShortcutToken = settings.sending_method === "shortcut"
    ? (settings.shortcut_token || await existingShortcutToken(admin) || randomUUID())
    : settings.shortcut_token;
  const payload = {
    ...settings,
    shortcut_token: sharedShortcutToken,
    updated_at: new Date().toISOString(),
  };
  const selectColumns = "show_id, enabled, sending_method, shortcut_token, send_availability, send_schedule, reminder_7_day, reminder_3_day, reminder_day_before, reminder_day_of, timezone, availability_template, schedule_template, reminder_template, updated_at";
  const result = await admin
    .from("show_text_automations")
    .upsert(payload, { onConflict: "show_id" })
    .select(selectColumns)
    .single();
  if (!result.error) return result.data;

  const uniqueShortcutTokenBlocked = settings.sending_method === "shortcut" && (
    result.error.message.includes("show_text_automations_shortcut_token_idx") ||
    result.error.message.includes("duplicate key value violates unique constraint")
  );
  if (!uniqueShortcutTokenBlocked) throw new Error(result.error.message);

  // Older ELS builds created a unique index on shortcut_token. Universal Shortcut Mode
  // needs the same token available across shows, so save the show as active Shortcut Mode
  // even if the old DB index is still present. The UI and universal endpoint will use the
  // existing shared token until the Supabase cleanup SQL is run.
  const fallbackPayload = {
    ...payload,
    shortcut_token: null,
  };
  const fallback = await admin
    .from("show_text_automations")
    .upsert(fallbackPayload, { onConflict: "show_id" })
    .select(selectColumns)
    .single();
  if (fallback.error) throw new Error(fallback.error.message);
  return { ...fallback.data, shortcut_token: sharedShortcutToken };
}

async function queueIntroText(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, body: Record<string, unknown>, user: { id: string; email?: string | null; display_name?: string | null }) {
  const phone = cleanPhone(safeText(body.phone));
  const messageBody = ensureSenderIdentity(body.body, senderNameForMessage(user));
  const crewName = safeText(body.crew_name) || "Crew contact";
  if (!phone) throw new Error("This contact needs a phone number before an intro text can be queued.");
  if (!messageBody) throw new Error("Intro text body is empty.");
  const payload = {
    ...queueIdentity(user),
    crew_id: safeText(body.crew_id) || null,
    crew_name: crewName,
    phone,
    body: messageBody,
    status: "scheduled",
    scheduled_for: new Date(Date.now() + 30_000).toISOString(),
    created_at: new Date().toISOString(),
    error: null,
  };
  const rows = await insertIntroRows(admin, [payload]);
  return rows[0] as IntroQueueRow;
}

async function queueCrewBulkMessage(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, body: Record<string, unknown>, user: { id: string; email?: string | null; display_name?: string | null }) {
  const template = safeText(body.body);
  const contacts = Array.isArray(body.contacts) ? body.contacts as Array<Record<string, unknown>> : [];
  if (!contacts.length) throw new Error("Select at least one crew contact first.");
  if (!template) throw new Error("Enter the message you want to send to the selected crew.");

  const nowIso = new Date().toISOString();
  const scheduledFor = new Date(Date.now() + 30_000).toISOString();
  const rows = contacts.flatMap((contact) => {
    const crewName = safeText(contact.crew_name || contact.name) || "Crew contact";
    const phone = cleanPhone(safeText(contact.phone));
    if (!phone) return [];
    const senderName = senderNameForMessage(user);
    const values = {
      first_name: firstName(crewName),
      name: crewName,
      crew_name: crewName,
      pool: safeText(contact.pool_name),
      role: safeText(contact.role_name),
      phone,
      coordinator_name: senderName,
      sender_name: senderName,
    };
    return [{
      ...queueIdentity(user),
      crew_id: safeText(contact.crew_id || contact.id) || null,
      crew_name: crewName,
      phone,
      body: ensureSenderIdentity(applyTemplate(template, values), senderName),
      status: "scheduled",
      scheduled_for: scheduledFor,
      created_at: nowIso,
      error: null,
    }];
  });

  if (!rows.length) throw new Error("None of the selected crew have a valid phone number.");
  const data = await insertIntroRows(admin, rows);
  return { queued: (data || []) as IntroQueueRow[], skipped: contacts.length - rows.length };
}

async function queueAvailabilityCandidates(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  body: Record<string, unknown>,
  user: { id: string; email?: string | null; display_name?: string | null },
) {
  const showId = safeText(body.show_id || (body.settings as Record<string, unknown> | undefined)?.show_id);
  const crewIds = [...new Set((Array.isArray(body.crew_ids) ? body.crew_ids : []).map(safeText).filter(Boolean))].slice(0, 250);
  const template = safeText(body.body);
  if (!showId) throw new Error("show_id is required.");
  if (!crewIds.length) throw new Error("Select at least one crew member first.");
  if (!template) throw new Error("Enter the availability message first.");

  const [showRes, crewRes] = await Promise.all([
    admin.from("shows").select("id, name, venue, event_location, rate_city, show_start, show_end").eq("id", showId).single(),
    admin.from("crew").select("id, name, phone").in("id", crewIds),
  ]);
  if (showRes.error || !showRes.data) throw new Error(showRes.error?.message || "Show not found.");
  if (crewRes.error) throw new Error(crewRes.error.message);

  const show = showRes.data as ShowRow;
  const crewById = new Map(((crewRes.data || []) as Array<{ id: string; name: string | null; phone: string | null }>).map((crew) => [crew.id, crew]));
  const senderName = senderNameForMessage(user);
  const selectedRole = safeText(body.role_name) || "Event crew";
  const selectedCity = safeText(body.city_name) || safeText(show.rate_city) || safeText(show.event_location);
  const scheduledFor = new Date(Date.now() + 30_000).toISOString();
  const batchKey = `availability_selected_${Date.now()}`;
  const rows: QueueRow[] = [];

  for (const crewId of crewIds) {
    const crew = crewById.get(crewId);
    if (!crew) continue;
    const phone = cleanPhone(safeText(crew.phone));
    if (!phone) continue;
    const crewName = safeText(crew.name) || "Crew member";
    const values = {
      first_name: firstName(crewName),
      crew_name: crewName,
      show_name: safeText(show.name) || "ELS event",
      venue: safeText(show.venue),
      location: safeText(show.event_location) || safeText(show.venue),
      city: selectedCity,
      show_start: formatDate(show.show_start),
      show_end: formatDate(show.show_end),
      position: selectedRole,
      coordinator_name: senderName,
      sender_name: senderName,
    };
    rows.push({
      ...queueIdentity(user),
      show_id: showId,
      crew_id: crewId,
      crew_name: crewName,
      phone,
      message_type: "availability",
      reminder_key: batchKey,
      scheduled_for: scheduledFor,
      status: "scheduled",
      body: ensureSenderIdentity(applyTemplate(template, values), senderName),
    });
  }

  if (!rows.length) throw new Error("None of the selected crew have a valid phone number.");
  const data = await upsertTextQueueRows(admin, rows);
  return { queued: data, skipped: crewIds.length - rows.length };
}

export async function PATCH(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  try {
    const body = await request.json();
    const showId = safeText(body.settings?.show_id);
    if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
    const settings = normalizeSettings(body.settings, showId);
    const saved = await saveSettings(admin, settings);
    return NextResponse.json({ ok: true, settings: saved, message: "Text automation settings saved." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to save text automation settings." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  try {
    const body = await request.json();
    const action = safeText(body.action);
    if (action === "queue_intro") {
      const intro = await queueIntroText(admin, body, auth.user);
      return NextResponse.json({ ok: true, intro, message: "Intro text queued for the iPhone Shortcut." });
    }
    if (action === "queue_crew_bulk_message") {
      const result = await queueCrewBulkMessage(admin, body, auth.user);
      const count = result.queued.length;
      const skippedText = result.skipped ? ` ${result.skipped} selected contact${result.skipped === 1 ? "" : "s"} skipped because no valid phone was saved.` : "";
      return NextResponse.json({ ok: true, queue: result.queued, skipped: result.skipped, message: `Queued ${count} crew message${count === 1 ? "" : "s"} for the iPhone Shortcut.${skippedText}` });
    }
    const showId = safeText(body.show_id || body.settings?.show_id);
    if (action === "queue_availability_candidates") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const settings = normalizeSettings(body.settings || {}, showId);
      const saved = await saveSettings(admin, { ...settings, enabled: true, send_availability: true });
      const result = await queueAvailabilityCandidates(admin, body, auth.user);
      const count = result.queued.length;
      const skippedText = result.skipped ? ` ${result.skipped} selected crew member${result.skipped === 1 ? "" : "s"} skipped because no valid phone was saved.` : "";
      return NextResponse.json({ ok: true, settings: saved, queue: result.queued, skipped: result.skipped, message: `Queued ${count} availability request${count === 1 ? "" : "s"}.${skippedText}` });
    }
    if (action === "refresh_queue") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const { data, error } = await admin
        .from("text_message_queue")
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
        .eq("show_id", showId)
        .order("scheduled_for", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, queue: data || [] });
    }
    if (action === "mark_sent") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      if (!queueId) return NextResponse.json({ message: "id is required." }, { status: 400 });
      const { data, error } = await admin
        .from("text_message_queue")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("show_id", showId)
        .eq("id", queueId)
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
        .single();
      if (error) throw new Error(error.message);
      await syncAssignmentChecklistFromSentMessage(admin, data).catch(() => null);
      return NextResponse.json({ ok: true, queue: [data], message: "Text marked sent manually and the communication checklist was updated." });
    }
    if (action === "cancel_queued") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      let query = admin
        .from("text_message_queue")
        .update({ status: "cancelled", error: "Cancelled before sending.", sent_at: null })
        .eq("show_id", showId)
        .eq("status", "scheduled");
      if (queueId) query = query.eq("id", queueId);
      const { data, error } = await query.select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
      if (error) throw new Error(error.message);
      const count = data?.length || 0;
      return NextResponse.json({ ok: true, queue: data || [], message: count ? `Cancelled ${count} queued text${count === 1 ? "" : "s"}.` : "No scheduled queued texts were available to cancel." });
    }
    const isManualReminderAction = action === "queue_manual_reminder" || action === "queue_manual_day_reminder";
    const isCustomMessageAction = action === "queue_custom_message";
    if (action !== "queue_messages" && !isManualReminderAction && !isCustomMessageAction) return NextResponse.json({ message: "Unsupported action." }, { status: 400 });
    if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
    const mode = isManualReminderAction || isCustomMessageAction ? "schedule_reminders" : body.mode === "availability" ? "availability" : "schedule_reminders";
    const manualReminderKey = safeText(body.reminder_key) || "day_of";
    const manualLaborDayId = safeText(body.labor_day_id);
    const additionalNote = safeText(body.additional_note);
    if (isManualReminderAction && !["7_day", "3_day", "day_before", "day_of"].includes(manualReminderKey)) {
      return NextResponse.json({ message: "Choose a valid reminder to queue now." }, { status: 400 });
    }
    if (action === "queue_manual_day_reminder" && !manualLaborDayId) {
      return NextResponse.json({ message: "Choose the labor day you want to queue now." }, { status: 400 });
    }
    const settings = normalizeSettings(body.settings || {}, showId);
    const effectiveSettings = (isManualReminderAction || isCustomMessageAction)
      ? { ...settings, enabled: true, send_schedule: true }
      : settings;
    if (!effectiveSettings.enabled) return NextResponse.json({ message: "Activate text automation for this show before queueing texts." }, { status: 400 });
    const saved = await saveSettings(admin, effectiveSettings);
    const bundle = await fetchShowBundle(admin, showId);
    if (isCustomMessageAction) {
      const laborDayId = safeText(body.labor_day_id);
      const eventWide = Boolean(body.event_wide);
      const customBody = safeText(body.body);
      if (!eventWide && !laborDayId) return NextResponse.json({ message: "Choose the labor day for the custom message." }, { status: 400 });
      if (!customBody) return NextResponse.json({ message: "Enter a custom message before queueing." }, { status: 400 });
      const senderName = senderNameForMessage(auth.user);
      const queueRows = stampRows(buildCustomQueueRows(effectiveSettings, bundle, senderName, {
        laborDayId,
        eventWide,
        subCallId: safeText(body.sub_call_id),
        subCallIds: Array.isArray(body.sub_call_ids) ? body.sub_call_ids.map(safeText).filter(Boolean) : [],
        startTime: safeText(body.start_time),
        endTime: safeText(body.end_time),
        scheduledLocal: safeText(body.scheduled_local),
        body: customBody,
      }), auth.user);
      if (!queueRows.length) return NextResponse.json({ ok: true, settings: saved, queue: [], message: eventWide ? "No event-wide texts were queued. Check that this event has assigned crew with phone numbers." : "No custom texts were queued. Check that the selected day/sub-call/time has assigned crew with phone numbers." });
      const data = await upsertTextQueueRows(admin, queueRows);
      return NextResponse.json({ ok: true, settings: saved, queue: data || [], message: `Queued ${queueRows.length} ${eventWide ? "event-wide " : ""}custom text${queueRows.length === 1 ? "" : "s"}.` });
    }
    const manualDay = manualLaborDayId
      ? bundle.days.find((day) => day.id === manualLaborDayId)
      : action === "queue_manual_reminder" && manualReminderKey !== "7_day"
        ? autoManualReminderDay(bundle.days, manualReminderKey, effectiveSettings.timezone)
        : null;
    if (action === "queue_manual_day_reminder" && !manualDay) {
      return NextResponse.json({ message: "That labor day was not found on this show." }, { status: 400 });
    }
    const queueOptions = isManualReminderAction
      ? {
          forceNowReminderKey: manualReminderKey,
          laborDayId: manualDay?.id,
          forceNowLabel: manualReminderKey === "7_day" ? "full_show" : manualDay?.labor_date,
          additionalNote: manualReminderKey === "7_day" ? additionalNote : "",
        }
      : {};
    const senderName = senderNameForMessage(auth.user);
    const queueRows = stampRows(buildQueueRows(mode, effectiveSettings, bundle, senderName, queueOptions), auth.user);
    if (!queueRows.length) return NextResponse.json({ ok: true, settings: saved, queue: [], message: "No texts were queued. Make sure assigned crew have phone numbers and assignments on the selected day." });
    const data = await upsertTextQueueRows(admin, queueRows);
    const manualDayLabel = manualDay
      ? ` for ${formatDate(manualDay.labor_date)}`
      : manualReminderKey === "7_day"
        ? " for the full show"
        : "";
    const manualMessage = `Queued ${queueRows.length} manual ${manualReminderKey === "7_day" ? "full-show schedule" : "reminder"} text${queueRows.length === 1 ? "" : "s"}${manualDayLabel}. They are due now and will send on the next iPhone Shortcut run.`;
    return NextResponse.json({ ok: true, settings: saved, queue: data || [], message: isManualReminderAction ? manualMessage : `Queued ${queueRows.length} text message${queueRows.length === 1 ? "" : "s"}.` });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to queue text messages." }, { status: 400 });
  }
}
