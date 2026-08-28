import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
import { createPersonalShortcutToken, resolvePersonalShortcutToken } from "@/lib/auth";
import { createSupabaseAdminClient, createSupabaseServerClient, syncAssignmentChecklistFromSentMessage } from "@/lib/supabase-server";

const META_START = "[[ELS_EVENT_MESSAGE_DETAILS]]";
const META_END = "[[/ELS_EVENT_MESSAGE_DETAILS]]";
const ACTIVE_QUEUE_STATUSES = ["scheduled", "waiting", "queued", "due_now", "pending"];
const REPAIR_QUEUE_STATUSES = [...ACTIVE_QUEUE_STATUSES, "sending", "needs_sender_review"];

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
  sending_method: "manual" | "shortcut" | "android_messages" | "provider";
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
};

type ShowRow = { id: string; name: string | null; show_reference_number?: string | null; client: string | null; client_contact_id?: string | null; venue: string | null; event_location?: string | null; rate_city: string | null; show_start: string; show_end: string; notes: string | null };
type LaborDayRow = { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null };
type SubCallRow = { id: string; labor_day_id: string; area: string | null; location?: string | null; po_number?: string | null; role_name: string | null; master_rate_id?: string | null; message_rate?: string | number | null; start_time: string | null; end_time: string | null; crew_needed: number | null; notes: string | null; sort_order?: number | null; day_type?: string | null; one_hour_walkaway?: boolean | null };
type AssignmentRow = { id: string; sub_call_id: string; crew_id: string; status: string | null; sort_order?: number | null; start_time?: string | null; end_time?: string | null; day_type?: string | null };
type CrewPositionRow = { crew_id: string; role_name: string | null; rate: string | number | null };
type CrewRow = { id: string; name: string | null; phone: string | null; email: string | null; positions: CrewPositionRow[] };
type MasterRateRow = { id: string; city_name: string | null; role_name: string | null; full_day: string | number | null };
type ClientContactRow = { id: string; name: string | null; phone?: string | null; cell_phone?: string | null };
type AvailabilityCallRequest = {
  labor_date: string;
  start_time: string;
  end_time: string;
  role_name: string;
  area: string;
  location: string;
  rate: string;
};

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
  delivery_mode?: "apple_shortcut" | "android_messages" | null;
  opened_in_messages_at?: string | null;
  requeued_from_id?: string | null;
  attempt_number?: number | null;
};

type RemovedCrewAssignmentRow = {
  id: string;
  event_id: string;
  crew_contact_id: string | null;
  crew_name: string | null;
  phone: string | null;
  labor_date: string | null;
  role: string | null;
  area: string | null;
  start_time: string | null;
  end_time: string | null;
  removed_at: string | null;
  removed_by_name: string | null;
  cancellation_notice_status: string | null;
  cancellation_notice_message?: string | null;
  cancellation_notice_queue_id?: string | null;
};

type ReminderPlanRow = {
  crew_id: string;
  crew_name: string;
  phone: string;
  reminder_type: string;
  reminder_label: string;
  labor_date: string;
  assignment_label: string;
  scheduled_for: string;
  scheduled_local: string;
  timezone: string;
  result: "will_schedule" | "overdue" | "already_scheduled" | "already_sent" | "previously_cancelled" | "skipped" | "no_phone";
  result_label: string;
  message_type: string;
  reminder_key: string;
  requeued_from_id?: string | null;
  body: string;
};

type ImmediateSchedulePlanRow = {
  crew_id: string;
  crew_name: string;
  phone: string;
  scheduled_for: string;
  scheduled_local: string;
  result: "will_queue" | "already_scheduled" | "already_sent" | "previously_cancelled" | "no_phone";
  result_label: string;
  message_type: "schedule";
  reminder_key: string;
  requeued_from_id?: string | null;
  body: string;
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

type RepairableQueueRow = {
  id: string;
  show_id: string | null;
  crew_id: string | null;
  crew_name: string | null;
  phone: string | null;
  message_type: string | null;
  reminder_key: string | null;
  scheduled_for: string | null;
  status: string | null;
  body: string | null;
  error: string | null;
  queued_by_user_id?: string | null;
  queued_by_email?: string | null;
  queued_by_name?: string | null;
};

type SenderProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role?: string | null;
  messaging_mode?: string | null;
  device_type?: string | null;
};

const TEXT_QUEUE_SELECT = "id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name, delivery_mode, opened_in_messages_at";

function cleanQueueIds(value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  return [...new Set(raw.map((item) => safeText(item)).filter(Boolean))].slice(0, 250);
}

function cleanQueueStatus(value: unknown) {
  const status = normalizeRole(value);
  if (["scheduled", "queued", "waiting", "due now", "due_now", "pending", "sending", "failed", "cancelled", "needs sender review", "needs_sender_review"].includes(status)) {
    return status.replace(/\s+/g, "_");
  }
  return "";
}

async function queueRowsForShow(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string, ids?: string[]) {
  let query = admin
    .from("text_message_queue")
    .select(TEXT_QUEUE_SELECT)
    .eq("show_id", showId)
    .order("scheduled_for", { ascending: false })
    .limit(500);
  if (ids?.length) query = query.in("id", ids);
  const { data, error } = await query;
  if (error && isMissingDeliveryModeColumns(error.message)) {
    let fallback = admin
      .from("text_message_queue")
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
      .eq("show_id", showId)
      .order("scheduled_for", { ascending: false })
      .limit(500);
    if (ids?.length) fallback = fallback.in("id", ids);
    const fallbackRes = await fallback;
    if (fallbackRes.error) throw new Error(fallbackRes.error.message);
    return fallbackRes.data || [];
  }
  if (error) throw new Error(error.message);
  return data || [];
}

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  let profileRes = await supabase.from("profiles").select("full_name, email, messaging_mode, device_type").eq("id", user.id).maybeSingle();
  if (profileRes.error && /messaging_mode|device_type|schema cache/i.test(profileRes.error.message)) {
    profileRes = await supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();
  }
  const profile = profileRes.data;
  const displayName = safeText((profile as { full_name?: string | null } | null)?.full_name)
    || safeText((profile as { email?: string | null } | null)?.email)
    || safeText(user.email)
    || "ELS user";
  const messagingMode = normalizeMessagingMode((profile as SenderProfileRow | null)?.messaging_mode);
  return { ok: true as const, user: { ...user, display_name: displayName, messaging_mode: messagingMode } };
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

function hasWorkingLeadMarker(roleName: unknown) {
  return /\b(?:wl|working\s+lead|working\s+crew\s+lead)\b/i.test(String(roleName || ""));
}

function roleMatchScore(rateRoleName: unknown, requestedRoleName: unknown) {
  const rateRole = normalizeRole(rateRoleName);
  const requestedRole = normalizeRole(requestedRoleName);
  const rateBase = normalizedRateRole(rateRoleName) || rateRole;
  const requestedBase = normalizedRateRole(requestedRoleName) || requestedRole;
  if (!rateRole || !requestedRole) return 0;
  if (rateRole === requestedRole) return 1200;

  const rateIsWorkingLead = hasWorkingLeadMarker(rateRoleName);
  const requestedIsWorkingLead = hasWorkingLeadMarker(requestedRoleName);
  if (rateIsWorkingLead !== requestedIsWorkingLead) {
    return 0;
  }

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

function normalizeMessagingMode(value: unknown): "apple_shortcut" | "android_messages" {
  return safeText(value) === "android_messages" ? "android_messages" : "apple_shortcut";
}

function deliveryModeForUser(user: { messaging_mode?: string | null }) {
  return normalizeMessagingMode(user.messaging_mode);
}

function queueIdentity(user: { id: string; email?: string | null; display_name?: string | null; messaging_mode?: string | null }) {
  return {
    queued_by_user_id: user.id,
    queued_by_email: user.email || null,
    queued_by_name: user.display_name || user.email || null,
    delivery_mode: deliveryModeForUser(user),
  };
}

function stampRows<T extends object>(rows: T[], user: { id: string; email?: string | null; display_name?: string | null; messaging_mode?: string | null }) {
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

function isMissingQueueAuditColumns(message: string) {
  return message.includes("requeued_from_id") || message.includes("attempt_number") || message.includes("cancelled_at") || message.includes("cancelled_by");
}

function isMissingDeliveryModeColumns(message: string) {
  return message.includes("delivery_mode") || message.includes("opened_in_messages_at");
}

function isMissingClaimColumns(message: string) {
  return message.includes("claimed_at") || message.includes("claim_token") || message.includes("schema cache");
}

function stripQueueAuditColumns(rows: QueueRow[]) {
  return rows.map(({ requeued_from_id, attempt_number, ...row }) => row);
}

function stripQueueDeliveryColumns<T extends object>(rows: T[]) {
  return rows.map((entry) => {
    const { delivery_mode: _deliveryMode, opened_in_messages_at: _openedInMessagesAt, ...row } = entry as T & {
      delivery_mode?: unknown;
      opened_in_messages_at?: unknown;
    };
    return row;
  });
}

async function insertIntroRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, rows: Record<string, unknown>[]) {
  const selectColumns = "id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name, delivery_mode, opened_in_messages_at";
  const fallbackSelectColumns = "id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name";
  let withSender = await admin.from("crew_intro_text_queue").insert(rows).select(selectColumns);
  if (withSender.error && isMissingDeliveryModeColumns(withSender.error.message)) {
    withSender = await admin.from("crew_intro_text_queue").insert(stripQueueDeliveryColumns(rows)).select(fallbackSelectColumns);
  }
  if (!withSender.error) return withSender.data as IntroQueueRow[];
  if (!isMissingSenderColumns(withSender.error.message)) throw new Error(withSender.error.message);
  const legacyRows = rows.map(({ queued_by_user_id, queued_by_email, queued_by_name, ...row }) => row);
  const legacy = await admin.from("crew_intro_text_queue").insert(stripQueueDeliveryColumns(legacyRows)).select(fallbackSelectColumns);
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data as IntroQueueRow[];
}

async function upsertTextQueueRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, rows: QueueRow[], includeDeliveryColumns = true) {
  const baseSelectColumns = "id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name";
  const selectColumns = includeDeliveryColumns ? `${baseSelectColumns}, delivery_mode, opened_in_messages_at` : baseSelectColumns;
  const payloadRows = includeDeliveryColumns ? rows : stripQueueDeliveryColumns(rows) as QueueRow[];
  const withSender = await admin
    .from("text_message_queue")
    .upsert(payloadRows, { onConflict: "show_id,crew_id,message_type,reminder_key" })
    .select(selectColumns);
  if (!withSender.error) return withSender.data || [];
  if (includeDeliveryColumns && isMissingDeliveryModeColumns(withSender.error.message)) return upsertTextQueueRows(admin, rows, false);
  if (isMissingQueueAuditColumns(withSender.error.message)) return upsertTextQueueRows(admin, stripQueueAuditColumns(rows) as QueueRow[], includeDeliveryColumns);
  if (!isMissingSenderColumns(withSender.error.message)) throw new Error(withSender.error.message);
  const legacyRows = payloadRows.map(({ queued_by_user_id, queued_by_email, queued_by_name, ...row }) => row);
  const legacy = await admin
    .from("text_message_queue")
    .upsert(legacyRows, { onConflict: "show_id,crew_id,message_type,reminder_key" })
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at");
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data || [];
}

function missingRemovedCrewAssignments(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("event_removed_crew_assignments") && (text.includes("does not exist") || text.includes("schema cache"));
}

function firstNameFrom(value: string | null | undefined) {
  return safeText(value).split(/\s+/)[0] || "there";
}

function cancellationDateTimeLabel(row: RemovedCrewAssignmentRow) {
  const date = row.labor_date ? formatDate(row.labor_date) : "Removed call";
  const time = [formatTime(row.start_time || ""), formatTime(row.end_time || "")].filter(Boolean).join("–");
  const primary = [date, time, safeText(row.role) || "Crew"].filter(Boolean).join(" · ");
  const area = safeText(row.area);
  return area ? `• ${primary}\n  Area: ${area}` : `• ${primary}`;
}

function buildCancellationNoticeBody(showName: string, rows: RemovedCrewAssignmentRow[]) {
  const first = firstNameFrom(rows[0]?.crew_name);
  const sortedRows = [...rows].sort((a, b) => safeText(a.labor_date).localeCompare(safeText(b.labor_date)) || safeText(a.start_time).localeCompare(safeText(b.start_time)));
  const cancelled = sortedRows.map(cancellationDateTimeLabel);
  return [
    `Hi ${first},`,
    "",
    `Your schedule for ${showName || "this event"} has been canceled:`,
    "",
    ...(cancelled.length ? cancelled : ["• The removed call"]),
    "",
    "We will be in touch if we get more additions to this call.",
    "Please confirm this cancellation.",
  ].join("\n");
}

async function insertCancellationQueueRow(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  row: QueueRow,
) {
  const selectColumns = "id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name, delivery_mode, opened_in_messages_at";
  const withSender = await admin.from("text_message_queue").insert(row).select(selectColumns).single();
  if (!withSender.error) return withSender.data;
  if (isMissingDeliveryModeColumns(withSender.error.message)) {
    const clean = stripQueueDeliveryColumns([{ ...row }])[0];
    const legacy = await admin
      .from("text_message_queue")
      .insert(clean)
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
      .single();
    if (legacy.error) throw new Error(legacy.error.message);
    return legacy.data;
  }
  if (isMissingQueueAuditColumns(withSender.error.message) || isMissingSenderColumns(withSender.error.message)) {
    const legacy = await admin
      .from("text_message_queue")
      .insert(stripQueueAuditColumns([{ ...row }]).map(({ queued_by_user_id, queued_by_email, queued_by_name, ...clean }) => clean)[0])
      .select(selectColumns)
      .single();
    if (legacy.error) throw new Error(legacy.error.message);
    return legacy.data;
  }
  throw new Error(withSender.error.message);
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

function formatAvailabilityScheduleLines(calls: Array<{ labor_date: string; start_time?: string | null; end_time?: string | null }>) {
  return [...calls]
    .filter((call) => safeText(call.labor_date) || safeText(call.start_time) || safeText(call.end_time))
    .sort((a, b) => safeText(a.labor_date).localeCompare(safeText(b.labor_date)) || safeText(a.start_time).localeCompare(safeText(b.start_time)) || safeText(a.end_time).localeCompare(safeText(b.end_time)))
    .map((call) => {
      const timeRange = safeText(call.start_time) || safeText(call.end_time) ? `${formatTime(call.start_time)}–${formatTime(call.end_time)}` : "";
      return [call.labor_date ? formatDate(call.labor_date) : "", timeRange].filter(Boolean).join(" · ");
    })
    .join("\n");
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
  const explicitType = assignment.day_type || call.day_type || "";
  if (explicitType === "hourly" || explicitType === "custom") return explicitType;
  if (duration !== null) return duration <= 5 ? "half_day" : "full_day";
  return explicitType;
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
  const priorDefault = "Hello {first_name}, are you available to work {show_start} through {show_end} for {show_name}? I have some days between those dates I’m looking to get filled. Please respond ASAP, as the positions are filled quickly.";
  const oldNeededDefault = "Hello {first_name}, are you available for {show_name}?\n\nPosition: {position}\nArea: {area}\nRate: {rate}\nNeeded: {availability_schedule}\n\nPlease respond ASAP, as the positions are filled quickly.";
  const oldDatesNeededDefault = "Hello {first_name}, are you available for {show_name}?\n\nPosition: {position}\nArea: {area}\nRate: {rate}\nDates Needed:\n{availability_schedule}\n\nPlease respond ASAP, as the positions are filled quickly.";
  if (!text || text === oldDefault || text === priorDefault || text === oldNeededDefault || text === oldDatesNeededDefault) return defaultAvailabilityTemplate;
  return text.replace(/(?:Dates\s+Needed|Needed):\s*\{availability_schedule\}/i, "Checking availability for these dates:\n{availability_schedule}");
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
  return ensureScheduleTemplateDisclaimers(cleaned);
}

const defaultAvailabilityTemplate = "Hello {first_name}, are you available for {show_reference}?\n\nPosition: {position}\nArea: {area}\nVenue: {venue_or_location}\nRate: {rate}\n\nChecking availability for these dates:\n{availability_schedule}\n\nI have some days in between that range that I am booking.\n\nPlease respond ASAP, as the positions are filled quickly.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services.";
const scheduleDateDisclaimer = "Dates and times are subject to change.";
const updatedScheduleNotice = "*****SCHEDULE UPDATED PLEASE CONFIRM CHANGES*****";
const scheduleLateHourlyDisclaimer = "If anyone is 15 minutes late or more, that shift will be paid hourly.";
const defaultScheduleTemplate = `Hi {first_name} – {show_name} @ {venue}\n\n{location}\n\nMeet-up Location: {meet_up_location}\n\nPosition: {position}\n{area_line}\nRate: {rate}\n{po_line}\n\nSchedule:\n{schedule}\n\n${scheduleDateDisclaimer}\n\n${scheduleLateHourlyDisclaimer}\n\nAttire: Black polo, black pants, and black shoes. Please arrive clean, well-groomed, and professionally presented.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services\n\n{crew_lead_line}\n\nPlease confirm.`;
const defaultReminderTemplate = "Hi {first_name}, quick confirmation for {show_name} at {venue}. Your next call is {next_call}. Meet-up Location: {meet_up_location}. Please reply confirmed.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services";
const defaultDayOfReminderTemplate = "Good Morning, we are meeting at {meet_up_location} for {show_name} at {venue}. See you soon. Please confirm.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services";
const defaultDailyAfterFirstDayTemplate = "Good Morning {first_name}, quick confirmation for {show_name} at {venue}. Your next call is {next_call}.{meet_up_sentence} Please reply confirmed.\n\nCoordinator: {coordinator_name}\nEmanuel Labor Services";

function prependUpdatedScheduleNotice(value: string) {
  const text = safeText(value);
  if (!text) return text;
  if (text.toUpperCase().startsWith(updatedScheduleNotice)) return text;
  return `${updatedScheduleNotice}\n\n${text}`;
}

function ensureScheduleTemplateDisclaimers(value: string) {
  let text = safeText(value);
  if (!text) return defaultScheduleTemplate;
  if (!/\{po_line\}/i.test(text)) {
    text = text.replace(/(Rate:\s*\{rate\})/i, "$1\n{po_line}");
  }
  if (!/\{area_line\}/i.test(text)) {
    text = text.replace(/(Position:\s*\{position\})/i, "$1\n{area_line}");
  }
  if (!/\{crew_lead_line\}/i.test(text)) {
    text = text.replace(/\n\nPlease confirm\./i, "\n\n{crew_lead_line}\n\nPlease confirm.");
  }
  const insertBeforeAttire = (current: string, line: string) => {
    if (/\n\nAttire:/i.test(current)) return current.replace(/\n\nAttire:/i, `\n\n${line}\n\nAttire:`);
    return `${current}\n\n${line}`;
  };
  if (!/dates and times are subject to change/i.test(text)) {
    text = insertBeforeAttire(text, scheduleDateDisclaimer);
  }
  if (!/15 minutes late/i.test(text)) {
    if (/dates and times are subject to change\./i.test(text)) {
      text = text.replace(/Dates and times are subject to change\./i, `${scheduleDateDisclaimer}\n\n${scheduleLateHourlyDisclaimer}`);
    } else {
      text = insertBeforeAttire(text, scheduleLateHourlyDisclaimer);
    }
  }
  return text;
}

function normalizeSettings(bodySettings: Partial<AutomationSettings>, showId: string): AutomationSettings {
  const rawMethod = safeText(bodySettings.sending_method);
  return {
    show_id: showId,
    enabled: Boolean(bodySettings.enabled),
    sending_method: rawMethod === "provider" ? "provider" : rawMethod === "android_messages" ? "android_messages" : rawMethod === "manual" ? "manual" : "shortcut",
    shortcut_token: safeText(bodySettings.shortcut_token),
    send_availability: Boolean(bodySettings.send_availability),
    send_schedule: bodySettings.send_schedule !== false,
    reminder_7_day: bodySettings.reminder_7_day !== false,
    reminder_3_day: Boolean(bodySettings.reminder_3_day),
    reminder_day_before: bodySettings.reminder_day_before !== false,
    reminder_day_of: bodySettings.reminder_day_of !== false,
    reminder_daily_after_first_day: Boolean(bodySettings.reminder_daily_after_first_day),
    timezone: safeText(bodySettings.timezone) || "America/Chicago",
    availability_template: normalizeAvailabilityTemplate(bodySettings.availability_template),
    schedule_template: normalizeScheduleTemplate(bodySettings.schedule_template),
    reminder_template: normalizeReminderTemplate(bodySettings.reminder_template),
  };
}

function nextScheduleByCrew(show: ShowRow, days: LaborDayRow[], calls: SubCallRow[], assignments: AssignmentRow[], crewRows: CrewRow[], masterRates: MasterRateRow[], settings: AutomationSettings, senderName = "", projectManagerContact: ClientContactRow | null = null) {
  const crewById = new Map(crewRows.map((crew) => [crew.id, crew]));
  const dayById = new Map(days.map((day) => [day.id, day]));
  const callById = new Map(calls.map((call) => [call.id, call]));
  const meta = parseEventMeta(show.notes);
  const result = new Map<string, { crew: CrewRow; lines: Array<{ sortKey: string; text: string; area: string; dateLabel: string; availabilityText: string }>; meetUps: string[]; rates: string[]; poNumbers: string[]; areas: string[]; firstCall: { day: LaborDayRow; call: SubCallRow; assignment: AssignmentRow } | null; values: Record<string, string> }>();

  for (const assignment of [...assignments].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const crew = crewById.get(assignment.crew_id);
    const call = callById.get(assignment.sub_call_id);
    const day = call ? dayById.get(call.labor_day_id) : null;
    if (!crew || !call || !day) continue;
    const current = result.get(crew.id) || { crew, lines: [], meetUps: [], rates: [], poNumbers: [], areas: [], firstCall: null, values: {} as Record<string, string> };
    const blockLabel = dayTypeLabel(assignmentDayType(assignment, call));
    const rateText = messageRateForCall(call, crew, show, masterRates, meta);
    const area = safeText(call.area) || "Area TBD";
    current.lines.push({
      sortKey: `${day.labor_date.slice(0, 10)} ${assignment.start_time || call.start_time || ""} ${call.area || ""}`,
      area,
      dateLabel: formatDate(day.labor_date),
      availabilityText: `${formatDate(day.labor_date)} · ${assignmentTimeRange(assignment, call)}`,
      text: `${formatDate(day.labor_date)} - ${assignmentTimeRange(assignment, call)} - ${blockLabel} - ${rateText}`,
    });
    if (rateText !== "Rate TBD") current.rates.push(rateText);
    if (safeText(call.po_number)) current.poNumbers.push(safeText(call.po_number));
    current.areas.push(area);
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
    const sortedLines = item.lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const schedule = sortedLines.map((line) => line.text).join("\n");
    const availabilitySchedule = sortedLines.map((line) => line.availabilityText).join("\n");
    const uniqueRates = [...new Set(item.rates)];
    const rate = uniqueRates.length === 1
      ? uniqueRates[0]
      : uniqueRates.length > 1
        ? "Varies by call (see schedule)"
        : "TBD";
    const uniquePoNumbers = [...new Set(item.poNumbers)];
    const poLine = uniquePoNumbers.length ? `PO: ${uniquePoNumbers.join(" / ")}` : "";
    const uniqueAreas = [...new Set(item.areas)];
    const areaLine = uniqueAreas.length > 1
      ? `Area:\n${[...new Set(sortedLines.map((line) => `${line.dateLabel}: ${line.area}`))].join("\n")}`
      : `Area: ${uniqueAreas.join(" / ") || "Area TBD"}`;
    const leadAssignment = assignments.find((assignment) => {
      const call = callById.get(assignment.sub_call_id);
      const role = normalizeRole(call?.role_name || "");
      return role.includes("crew lead") || role === "lead";
    });
    const leadCrew = leadAssignment ? crewById.get(leadAssignment.crew_id) : null;
    const crewLeadName = safeText(meta.crew_lead_name) || safeText(leadCrew?.name) || safeText(projectManagerContact?.name);
    const crewLeadPhone = safeText(meta.crew_lead_phone) || safeText(leadCrew?.phone) || safeText(projectManagerContact?.cell_phone) || safeText(projectManagerContact?.phone);
    const crewLeadLine = crewLeadName
      ? [`Crew Lead: ${crewLeadName}`, crewLeadPhone ? `Phone: ${crewLeadPhone}` : "Phone: ____________________"].join("\n")
      : "Crew Lead: ____________________\nPhone: ____________________";
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
      show_reference: safeText(show.show_reference_number) || show.name || "ELS Show",
      event_name: show.name || "ELS Show",
      show_name: show.name || "ELS Show",
      client: show.client || "",
      venue: show.venue || "",
      location: show.event_location || show.rate_city || show.venue || "",
      venue_or_location: show.venue || show.event_location || "",
      show_start: formatDate(show.show_start),
      show_end: formatDate(show.show_end),
      meet_up_location: [...new Set(item.meetUps)].length ? [...new Set(item.meetUps)].join(" / ") : meetUp,
      meet_up_sentence: ([...new Set(item.meetUps)].length ? [...new Set(item.meetUps)].join(" / ") : meetUp) ? ` Meet-up Location: ${[...new Set(item.meetUps)].length ? [...new Set(item.meetUps)].join(" / ") : meetUp}.` : "",
      position: positions,
      area: uniqueAreas.join(" / ") || "",
      area_line: areaLine,
      po_line: poLine,
      crew_lead_line: crewLeadLine,
      schedule,
      availability_schedule: availabilitySchedule,
      next_call: nextCall,
      rate,
      coordinator_name: coordinatorName,
      coordinator_phone: coordinatorPhone,
    };
  }

  return result;
}

async function fetchShowBundle(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string) {
  const showRes = await admin.from("shows").select("id, name, show_reference_number, client, client_contact_id, venue, event_location, rate_city, show_start, show_end, notes").eq("id", showId).single();
  if (showRes.error || !showRes.data) throw new Error(showRes.error?.message || "Show not found.");
  const show = showRes.data as ShowRow;
  const projectManagerContactRes = show.client_contact_id
    ? await admin.from("client_contacts").select("id, name, phone, cell_phone").eq("id", show.client_contact_id).maybeSingle()
    : { data: null, error: null };
  const projectManagerContact = projectManagerContactRes.error ? null : (projectManagerContactRes.data as ClientContactRow | null);
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
  return { show, days, calls, assignments, crewRows, masterRates: (masterRatesRes.data || []) as MasterRateRow[], projectManagerContact };
}

function buildQueueRows(
  mode: "availability" | "schedule_reminders",
  settings: AutomationSettings,
  bundle: Awaited<ReturnType<typeof fetchShowBundle>>,
  senderName: string,
  options: { forceNowReminderKey?: string; laborDayId?: string; forceNowLabel?: string; additionalNote?: string; selectedCrewIds?: string[] } = {}
) {
  const filteredDays = options.laborDayId ? bundle.days.filter((day) => day.id === options.laborDayId) : bundle.days;
  const filteredDayIds = new Set(filteredDays.map((day) => day.id));
  const filteredCalls = options.laborDayId ? bundle.calls.filter((call) => filteredDayIds.has(call.labor_day_id)) : bundle.calls;
  const filteredCallIds = new Set(filteredCalls.map((call) => call.id));
  const filteredAssignments = options.laborDayId ? bundle.assignments.filter((assignment) => filteredCallIds.has(assignment.sub_call_id)) : bundle.assignments;
  const byCrew = nextScheduleByCrew(bundle.show, filteredDays, filteredCalls, filteredAssignments, bundle.crewRows, bundle.masterRates, settings, senderName, bundle.projectManagerContact);
  const selectedCrewSet = new Set((options.selectedCrewIds || []).map(safeText).filter(Boolean));
  const rows: QueueRow[] = [];
  const nowIso = new Date(Date.now() + 30_000).toISOString();
  const manualLabel = safeText(options.forceNowLabel).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
  const additionalNote = safeText(options.additionalNote);
  const manualBatchKey = `manual_${options.forceNowReminderKey || ""}${manualLabel ? `_${manualLabel}` : ""}_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  for (const [crewId, item] of byCrew.entries()) {
    if (selectedCrewSet.size && !selectedCrewSet.has(crewId)) continue;
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
        { enabled: Boolean(options.forceNowReminderKey === "daily_after_first_day"), key: "daily_after_first_day", scheduledFor: item.firstCall ? subtractMinutesFromZoned(item.firstCall.day.labor_date, item.firstCall.call.start_time || "09:00", 120, settings.timezone) : zonedDateTimeToUtcIso(bundle.show.show_start, "07:00", settings.timezone), template: defaultDailyAfterFirstDayTemplate, messageType: "reminder" },
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

function formatQueuedLocalDateTime(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function activeAssignmentRows(bundle: Awaited<ReturnType<typeof fetchShowBundle>>) {
  const dayById = new Map(bundle.days.map((day) => [day.id, day]));
  const callById = new Map(bundle.calls.map((call) => [call.id, call]));
  const crewById = new Map(bundle.crewRows.map((crew) => [crew.id, crew]));
  return bundle.assignments
    .map((assignment) => {
      const call = callById.get(assignment.sub_call_id);
      const day = call ? dayById.get(call.labor_day_id) : null;
      const crew = crewById.get(assignment.crew_id);
      return call && day && crew ? { assignment, call, day, crew } : null;
    })
    .filter((row): row is { assignment: AssignmentRow; call: SubCallRow; day: LaborDayRow; crew: CrewRow } => Boolean(row))
    .filter(({ assignment }) => {
      const status = normalizeRole(assignment.status);
      return !["removed", "cancelled", "canceled", "declined", "unavailable", "no show replaced", "called in replacement used"].includes(status);
    })
    .sort((a, b) =>
      a.day.labor_date.localeCompare(b.day.labor_date)
      || String(assignmentStartTime(a.assignment, a.call) || "").localeCompare(String(assignmentStartTime(b.assignment, b.call) || ""))
      || Number(a.call.sort_order || 0) - Number(b.call.sort_order || 0)
      || Number(a.assignment.sort_order || 0) - Number(b.assignment.sort_order || 0)
    );
}

function firstDailyRowsByCrewDate(bundle: Awaited<ReturnType<typeof fetchShowBundle>>) {
  const grouped = new Map<string, { assignment: AssignmentRow; call: SubCallRow; day: LaborDayRow; crew: CrewRow }[]>();
  for (const row of activeAssignmentRows(bundle)) {
    const key = `${row.crew.id}:${row.day.labor_date.slice(0, 10)}`;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  return [...grouped.values()].map((rows) => rows[0]).sort((a, b) =>
    a.crew.name?.localeCompare(b.crew.name || "") || a.day.labor_date.localeCompare(b.day.labor_date)
  );
}

function valuesForSpecificCall(
  baseValues: Record<string, string>,
  row: { assignment: AssignmentRow; call: SubCallRow; day: LaborDayRow; crew: CrewRow },
  show: ShowRow,
) {
  const boothMeetup = callMeetAtBooth(row.call) ? callBoothMeetupLocation(row.call) : "";
  const meetUpLocation = boothMeetup || baseValues.meet_up_location || "";
  return {
    ...baseValues,
    next_call: `${formatDate(row.day.labor_date)} ${assignmentTimeRange(row.assignment, row.call)}`,
    meet_up_location: meetUpLocation,
    meet_up_sentence: meetUpLocation ? ` Meet-up Location: ${meetUpLocation}.` : "",
    venue: show.venue || baseValues.venue || "",
  };
}

function readableReminderLabel(key: string) {
  if (key === "7_day") return "7-day schedule";
  if (key === "3_day") return "3-day reminder";
  if (key === "day_before") return "Day-before reminder";
  if (key === "day_of") return "Day-of morning reminder";
  if (key === "daily_after_first_day") return "Daily reminder after first day";
  return key;
}

function resultForExisting(status: string | null | undefined): ReminderPlanRow["result"] | null {
  const clean = normalizeRole(status);
  if (!clean) return null;
  if (clean === "sent") return "already_sent";
  if (clean === "cancelled" || clean === "canceled") return "previously_cancelled";
  return "already_scheduled";
}

type ExistingQueueState = { id: string | null; status: string; reminder_key: string };

function logicalReminderKey(key: string) {
  const clean = safeText(key);
  const requeueIndex = clean.indexOf("_requeue_");
  return requeueIndex > 0 ? clean.slice(0, requeueIndex) : clean;
}

function requeueReminderKey(key: string) {
  return `${logicalReminderKey(key)}_requeue_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
}

function activeQueueStatus(status: string | null | undefined) {
  const clean = normalizeRole(status);
  return clean === "scheduled" || clean === "waiting" || clean === "due_now" || clean === "queued";
}

function chooseExistingQueueState(current: ExistingQueueState | undefined, next: ExistingQueueState) {
  const currentStatus = normalizeRole(current?.status);
  const nextStatus = normalizeRole(next.status);
  if (!current) return next;
  if (currentStatus === "sent") return current;
  if (nextStatus === "sent") return next;
  if (activeQueueStatus(currentStatus)) return current;
  if (activeQueueStatus(nextStatus)) return next;
  if (currentStatus === "cancelled" || currentStatus === "canceled") return current;
  return next;
}

async function buildFullShowReminderPlan(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  settings: AutomationSettings,
  bundle: Awaited<ReturnType<typeof fetchShowBundle>>,
  senderName: string,
  options: { resendCancelled?: boolean } = {},
) {
  const baseByCrew = nextScheduleByCrew(bundle.show, bundle.days, bundle.calls, bundle.assignments, bundle.crewRows, bundle.masterRates, settings, senderName, bundle.projectManagerContact);
  const dailyRows = firstDailyRowsByCrewDate(bundle);
  const firstDailyByCrew = new Map<string, typeof dailyRows[number]>();
  const rowsByCrew = new Map<string, typeof dailyRows>();
  for (const row of dailyRows) {
    rowsByCrew.set(row.crew.id, [...(rowsByCrew.get(row.crew.id) || []), row]);
  }
  for (const [crewId, rows] of rowsByCrew.entries()) {
    firstDailyByCrew.set(crewId, rows[0]);
  }

  const existingRes = await admin
    .from("text_message_queue")
    .select("id, crew_id, message_type, reminder_key, status")
    .eq("show_id", settings.show_id)
    .limit(5000);
  if (existingRes.error) throw new Error(existingRes.error.message);
  const existing = new Map<string, ExistingQueueState>();
  for (const row of (existingRes.data || []) as Array<{ id?: string | null; crew_id: string | null; message_type: string | null; reminder_key: string | null; status: string | null }>) {
    const logicalKey = `${row.crew_id || ""}|${row.message_type || ""}|${logicalReminderKey(row.reminder_key || "")}`;
    existing.set(logicalKey, chooseExistingQueueState(existing.get(logicalKey), { id: row.id || null, status: row.status || "scheduled", reminder_key: row.reminder_key || "" }));
  }

  const now = Date.now();
  const plan: ReminderPlanRow[] = [];

  for (const [crewId, item] of baseByCrew.entries()) {
    const firstRow = firstDailyByCrew.get(crewId);
    if (!firstRow || !item.firstCall) continue;
    const phone = cleanPhone(item.crew.phone || "");
    const baseValues = item.values;
    const pushPlan = (args: { type: string; enabled: boolean; dueIso: string; messageType: string; reminderKey: string; body: string; row: typeof firstRow }) => {
      if (!args.enabled) return;
      const key = `${crewId}|${args.messageType}|${args.reminderKey}`;
      const existingState = existing.get(key);
      const existingResult = resultForExisting(existingState?.status);
      const dueMs = Date.parse(args.dueIso);
      const result: ReminderPlanRow["result"] = !phone
        ? "no_phone"
        : existingResult === "previously_cancelled" && options.resendCancelled === false
          ? "skipped"
          : existingResult
          ? existingResult
          : Number.isFinite(dueMs) && dueMs < now
            ? "overdue"
            : "will_schedule";
      const resultLabel = result === "will_schedule"
        ? "Will schedule"
        : result === "overdue"
          ? "Overdue"
          : result === "no_phone"
            ? "Skipped: no phone"
            : result === "already_sent"
              ? "Already sent"
              : result === "previously_cancelled"
                ? "Previously cancelled — will requeue"
                : result === "skipped"
                  ? "Previously cancelled — eligible to resend"
                : "Already scheduled";
      plan.push({
        crew_id: crewId,
        crew_name: item.crew.name || "Crew member",
        phone,
        reminder_type: args.type,
        reminder_label: readableReminderLabel(args.type),
        labor_date: args.row.day.labor_date.slice(0, 10),
        assignment_label: `${formatDate(args.row.day.labor_date)} ${assignmentTimeRange(args.row.assignment, args.row.call)} · ${args.row.call.role_name || "Crew"} · Area: ${safeText(args.row.call.area) || "Area TBD"}`,
        scheduled_for: args.dueIso,
        scheduled_local: formatQueuedLocalDateTime(args.dueIso, settings.timezone),
        timezone: settings.timezone,
        result,
        result_label: resultLabel,
        message_type: args.messageType,
        reminder_key: args.reminderKey,
        requeued_from_id: result === "previously_cancelled" ? existingState?.id || null : null,
        body: args.body,
      });
    };

    const firstValues = valuesForSpecificCall(baseValues, firstRow, bundle.show);
    pushPlan({
      type: "7_day",
      enabled: settings.reminder_7_day,
      dueIso: zonedDateTimeToUtcIso(addDays(firstRow.day.labor_date, -7), "09:00", settings.timezone),
      messageType: "schedule",
      reminderKey: `7_day_${firstRow.day.labor_date.slice(0, 10)}`,
      body: ensureSenderIdentity(applyTemplate(settings.schedule_template || defaultScheduleTemplate, firstValues), senderName),
      row: firstRow,
    });
    pushPlan({
      type: "3_day",
      enabled: settings.reminder_3_day,
      dueIso: zonedDateTimeToUtcIso(addDays(firstRow.day.labor_date, -3), "09:00", settings.timezone),
      messageType: "reminder",
      reminderKey: `3_day_${firstRow.day.labor_date.slice(0, 10)}`,
      body: ensureSenderIdentity(applyTemplate(settings.reminder_template || defaultReminderTemplate, firstValues), senderName),
      row: firstRow,
    });
    pushPlan({
      type: "day_before",
      enabled: settings.reminder_day_before,
      dueIso: zonedDateTimeToUtcIso(addDays(firstRow.day.labor_date, -1), "17:00", settings.timezone),
      messageType: "reminder",
      reminderKey: `day_before_${firstRow.day.labor_date.slice(0, 10)}`,
      body: ensureSenderIdentity(applyTemplate(settings.reminder_template || defaultReminderTemplate, firstValues), senderName),
      row: firstRow,
    });
    pushPlan({
      type: "day_of",
      enabled: settings.reminder_day_of,
      dueIso: subtractMinutesFromZoned(firstRow.day.labor_date, assignmentStartTime(firstRow.assignment, firstRow.call) || "09:00", 120, settings.timezone),
      messageType: "reminder",
      reminderKey: `day_of_${firstRow.day.labor_date.slice(0, 10)}`,
      body: ensureSenderIdentity(applyTemplate(defaultDayOfReminderTemplate, firstValues), senderName),
      row: firstRow,
    });

    if (settings.reminder_daily_after_first_day) {
      const crewRows = rowsByCrew.get(crewId) || [];
      for (const laterRow of crewRows.slice(1)) {
        const laterValues = valuesForSpecificCall(baseValues, laterRow, bundle.show);
        pushPlan({
          type: "daily_after_first_day",
          enabled: true,
          dueIso: subtractMinutesFromZoned(laterRow.day.labor_date, assignmentStartTime(laterRow.assignment, laterRow.call) || "09:00", 120, settings.timezone),
          messageType: "reminder",
          reminderKey: `daily_after_first_day_${laterRow.day.labor_date.slice(0, 10)}`,
          body: ensureSenderIdentity(applyTemplate(defaultDailyAfterFirstDayTemplate, laterValues), senderName),
          row: laterRow,
        });
      }
    }
  }

  return plan.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for) || a.crew_name.localeCompare(b.crew_name));
}

async function buildSelectedDayReminderPlan(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  settings: AutomationSettings,
  bundle: Awaited<ReturnType<typeof fetchShowBundle>>,
  senderName: string,
  laborDayId: string,
  reminderKey: string,
) {
  const selectedRows = activeAssignmentRows(bundle)
    .filter((row) => row.day.id === laborDayId)
    .sort((a, b) =>
      String(assignmentStartTime(a.assignment, a.call) || "").localeCompare(String(assignmentStartTime(b.assignment, b.call) || ""))
      || Number(a.call.sort_order || 0) - Number(b.call.sort_order || 0)
      || Number(a.assignment.sort_order || 0) - Number(b.assignment.sort_order || 0)
    );
  const firstSelectedRowByCrew = new Map<string, typeof selectedRows[number]>();
  for (const row of selectedRows) {
    if (!firstSelectedRowByCrew.has(row.crew.id)) firstSelectedRowByCrew.set(row.crew.id, row);
  }

  const existingRes = await admin
    .from("text_message_queue")
    .select("id, crew_id, message_type, reminder_key, status")
    .eq("show_id", settings.show_id)
    .limit(5000);
  if (existingRes.error) throw new Error(existingRes.error.message);
  const existing = new Map<string, ExistingQueueState>();
  for (const row of (existingRes.data || []) as Array<{ id?: string | null; crew_id: string | null; message_type: string | null; reminder_key: string | null; status: string | null }>) {
    const logicalKey = `${row.crew_id || ""}|${row.message_type || ""}|${logicalReminderKey(row.reminder_key || "")}`;
    existing.set(logicalKey, chooseExistingQueueState(existing.get(logicalKey), { id: row.id || null, status: row.status || "scheduled", reminder_key: row.reminder_key || "" }));
  }

  const baseByCrew = nextScheduleByCrew(bundle.show, bundle.days, bundle.calls, bundle.assignments, bundle.crewRows, bundle.masterRates, settings, senderName, bundle.projectManagerContact);
  const now = Date.now();
  const plan: ReminderPlanRow[] = [];

  for (const [crewId, row] of firstSelectedRowByCrew.entries()) {
    const item = baseByCrew.get(crewId);
    const phone = cleanPhone(row.crew.phone || "");
    const dateKey = row.day.labor_date.slice(0, 10);
    const messageType = reminderKey === "7_day" ? "schedule" : "reminder";
    const dueIso = reminderKey === "3_day"
      ? zonedDateTimeToUtcIso(addDays(row.day.labor_date, -3), "09:00", settings.timezone)
      : reminderKey === "day_before"
        ? zonedDateTimeToUtcIso(addDays(row.day.labor_date, -1), "17:00", settings.timezone)
        : subtractMinutesFromZoned(row.day.labor_date, assignmentStartTime(row.assignment, row.call) || "09:00", 120, settings.timezone);
    const storedReminderKey = `${reminderKey}_${dateKey}`;
    const key = `${crewId}|${messageType}|${storedReminderKey}`;
    const existingState = existing.get(key);
    const existingResult = resultForExisting(existingState?.status);
    const dueMs = Date.parse(dueIso);
    const result: ReminderPlanRow["result"] = !phone
      ? "no_phone"
      : existingResult
        ? existingResult
        : Number.isFinite(dueMs) && dueMs < now
          ? "overdue"
          : "will_schedule";
    const resultLabel = result === "will_schedule"
      ? "Will schedule"
      : result === "overdue"
        ? "Overdue - will queue due now"
        : result === "no_phone"
          ? "Skipped: no phone"
          : result === "already_sent"
            ? "Already sent"
            : result === "previously_cancelled"
              ? "Previously cancelled - will requeue"
              : "Already scheduled";
    const baseValues = item?.values || {
      first_name: firstName(row.crew.name || ""),
      crew_name: row.crew.name || "Crew member",
      show_name: bundle.show.name || "ELS Show",
      client: bundle.show.client || "",
      venue: bundle.show.venue || "",
      location: bundle.show.event_location || bundle.show.rate_city || bundle.show.venue || "",
      show_start: formatDate(bundle.show.show_start),
      show_end: formatDate(bundle.show.show_end),
      meet_up_location: "TBD onsite",
      meet_up_sentence: " Meet-up Location: TBD onsite.",
      position: row.call.role_name || "Crew",
      area_line: `Area: ${safeText(row.call.area) || "Area TBD"}`,
      po_line: safeText(row.call.po_number) ? `PO: ${safeText(row.call.po_number)}` : "",
      crew_lead_line: "Crew Lead: ____________________\nPhone: ____________________",
      schedule: `${formatDate(row.day.labor_date)} - ${assignmentTimeRange(row.assignment, row.call)} - ${dayTypeLabel(assignmentDayType(row.assignment, row.call))} - ${messageRateForCall(row.call, row.crew, bundle.show, bundle.masterRates, parseEventMeta(bundle.show.notes))}`,
      next_call: `${formatDate(row.day.labor_date)} ${assignmentTimeRange(row.assignment, row.call)}`,
      rate: messageRateForCall(row.call, row.crew, bundle.show, bundle.masterRates, parseEventMeta(bundle.show.notes)),
      coordinator_name: senderName || "Storm Leigh",
      coordinator_phone: "504-657-6618",
    };
    const values = valuesForSpecificCall(baseValues, row, bundle.show);
    const template = reminderKey === "day_of"
      ? defaultDayOfReminderTemplate
      : reminderKey === "daily_after_first_day"
        ? defaultDailyAfterFirstDayTemplate
        : settings.reminder_template || defaultReminderTemplate;
    plan.push({
      crew_id: crewId,
      crew_name: row.crew.name || "Crew member",
      phone,
      reminder_type: reminderKey,
      reminder_label: readableReminderLabel(reminderKey),
      labor_date: dateKey,
      assignment_label: `${formatDate(row.day.labor_date)} ${assignmentTimeRange(row.assignment, row.call)} · ${row.call.role_name || "Crew"} · Area: ${safeText(row.call.area) || "Area TBD"}`,
      scheduled_for: dueIso,
      scheduled_local: formatQueuedLocalDateTime(dueIso, settings.timezone),
      timezone: settings.timezone,
      result,
      result_label: resultLabel,
      message_type: messageType,
      reminder_key: storedReminderKey,
      requeued_from_id: result === "previously_cancelled" ? existingState?.id || null : null,
      body: ensureSenderIdentity(applyTemplate(template, values), senderName),
    });
  }

  return plan.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for) || a.crew_name.localeCompare(b.crew_name));
}

function queueRowsFromReminderPlan(showId: string, plan: ReminderPlanRow[], user: { id: string; email?: string | null; display_name?: string | null }, includeOverdueNow: boolean, forceNow = false) {
  const nowIso = new Date(Date.now() + 30_000).toISOString();
  const rows = plan.filter((row) => row.result === "will_schedule" || row.result === "previously_cancelled" || (includeOverdueNow && row.result === "overdue"));
  return stampRows(rows.map((row) => ({
    show_id: showId,
    crew_id: row.crew_id,
    crew_name: row.crew_name,
    phone: row.phone,
    message_type: row.message_type,
    reminder_key: row.result === "previously_cancelled" ? requeueReminderKey(row.reminder_key) : row.reminder_key,
    scheduled_for: forceNow || row.result === "overdue" || (row.result === "previously_cancelled" && Date.parse(row.scheduled_for) < Date.now()) ? nowIso : row.scheduled_for,
    status: "scheduled",
    body: row.body,
    requeued_from_id: row.requeued_from_id || null,
    attempt_number: row.result === "previously_cancelled" ? 2 : null,
  })), user);
}

async function buildImmediateFullShowSchedulePlan(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  settings: AutomationSettings,
  bundle: Awaited<ReturnType<typeof fetchShowBundle>>,
  senderName: string,
  additionalNote: string,
  options: { resendCancelled?: boolean; resendSent?: boolean; updatedScheduleNotice?: boolean; selectedCrewIds?: string[]; forceQueue?: boolean; forceUpdatedScheduleNotice?: boolean; reminderKey?: string } = {},
) {
  const byCrew = nextScheduleByCrew(bundle.show, bundle.days, bundle.calls, bundle.assignments, bundle.crewRows, bundle.masterRates, settings, senderName, bundle.projectManagerContact);
  const selectedCrewSet = new Set((options.selectedCrewIds || []).map(safeText).filter(Boolean));
  const existingRes = await admin
    .from("text_message_queue")
    .select("id, crew_id, message_type, reminder_key, status")
    .eq("show_id", settings.show_id)
    .eq("message_type", "schedule")
    .limit(5000);
  if (existingRes.error) throw new Error(existingRes.error.message);

  const existing = new Map<string, ExistingQueueState>();
  for (const row of (existingRes.data || []) as Array<{ id?: string | null; crew_id: string | null; message_type: string | null; reminder_key: string | null; status: string | null }>) {
    const key = row.reminder_key || "";
    if (logicalReminderKey(key) === "full_show_schedule" || key.startsWith("manual_7_day")) {
      const logicalKey = `${row.crew_id || ""}|schedule|full_show_schedule`;
      existing.set(logicalKey, chooseExistingQueueState(existing.get(logicalKey), { id: row.id || null, status: row.status || "scheduled", reminder_key: key }));
    }
  }

  const nowIso = new Date(Date.now() + 30_000).toISOString();
  const note = safeText(additionalNote);
  const rows: ImmediateSchedulePlanRow[] = [];
  for (const [crewId, item] of byCrew.entries()) {
    if (selectedCrewSet.size && !selectedCrewSet.has(crewId)) continue;
    const phone = cleanPhone(item.crew.phone || "");
    const existingState = existing.get(`${crewId}|schedule|full_show_schedule`);
    const existingResult = resultForExisting(existingState?.status);
    const baseBody = ensureSenderIdentity(applyTemplate(settings.schedule_template || defaultScheduleTemplate, item.values), senderName);
    const shouldAddUpdatedNotice = Boolean(options.forceUpdatedScheduleNotice || (options.updatedScheduleNotice && options.resendSent && existingResult === "already_sent"));
    const body = shouldAddUpdatedNotice ? prependUpdatedScheduleNotice(baseBody) : baseBody;
    const result: ImmediateSchedulePlanRow["result"] = !phone
      ? "no_phone"
      : options.forceQueue
        ? "will_queue"
      : existingResult === "already_sent" && options.resendSent
        ? "will_queue"
      : existingResult === "previously_cancelled" && options.resendCancelled === false
        ? "already_scheduled"
      : existingResult === "already_sent"
        ? "already_sent"
        : existingResult === "previously_cancelled"
          ? "previously_cancelled"
          : existingResult
            ? "already_scheduled"
            : "will_queue";
    const resultLabel = result === "will_queue"
      ? options.forceQueue
        ? "Selected — will queue updated schedule"
      : existingResult === "already_sent" && options.resendSent
        ? (shouldAddUpdatedNotice ? "Already sent — resend with update notice" : "Already sent — resend selected")
        : "Will queue due now"
      : result === "no_phone"
        ? "Skipped: no phone"
        : result === "already_sent"
          ? "Already sent"
          : result === "previously_cancelled"
            ? "Previously cancelled — will requeue"
            : existingResult === "previously_cancelled" && options.resendCancelled === false
              ? "Previously cancelled — eligible to resend"
              : "Already queued";
    rows.push({
      crew_id: crewId,
      crew_name: item.crew.name || "Crew member",
      phone,
      scheduled_for: nowIso,
      scheduled_local: "Due now · sends on next Shortcut run",
      result,
      result_label: resultLabel,
      message_type: "schedule",
      reminder_key: options.reminderKey || "full_show_schedule",
      requeued_from_id: result === "previously_cancelled" ? existingState?.id || null : null,
      body: note ? `${body}\n\n${note}` : body,
    });
  }
  return rows.sort((a, b) => a.crew_name.localeCompare(b.crew_name));
}

function queueRowsFromImmediateSchedulePlan(showId: string, plan: ImmediateSchedulePlanRow[], user: { id: string; email?: string | null; display_name?: string | null }, forceNow = false) {
  const nowIso = new Date(Date.now() + 30_000).toISOString();
  return stampRows(plan.filter((row) => row.result === "will_queue" || row.result === "previously_cancelled").map((row) => ({
    show_id: showId,
    crew_id: row.crew_id,
    crew_name: row.crew_name,
    phone: row.phone,
    message_type: row.message_type,
    reminder_key: row.result === "previously_cancelled" ? requeueReminderKey(row.reminder_key) : row.reminder_key,
    scheduled_for: forceNow ? nowIso : row.scheduled_for,
    status: "scheduled",
    body: row.body,
    requeued_from_id: row.requeued_from_id || null,
    attempt_number: row.result === "previously_cancelled" ? 2 : null,
  })), user);
}

function combinedScheduleSummary(schedulePlan: ImmediateSchedulePlanRow[], reminderPlan: ReminderPlanRow[]) {
  const scheduleNow = schedulePlan.filter((row) => row.result === "will_queue" || row.result === "previously_cancelled").length;
  const future = reminderPlan.filter((row) => row.result === "will_schedule" || row.result === "previously_cancelled").length;
  const overdue = reminderPlan.filter((row) => row.result === "overdue").length;
  const alreadyScheduled = schedulePlan.filter((row) => row.result === "already_scheduled").length
    + reminderPlan.filter((row) => row.result === "already_scheduled").length;
  const alreadySent = schedulePlan.filter((row) => row.result === "already_sent").length
    + reminderPlan.filter((row) => row.result === "already_sent").length;
  const noPhone = schedulePlan.filter((row) => row.result === "no_phone").length
    + reminderPlan.filter((row) => row.result === "no_phone").length;
  const skipped = schedulePlan.length + reminderPlan.length - scheduleNow - future - overdue;
  const previouslyCancelled = schedulePlan.filter((row) => row.result === "previously_cancelled").length
    + reminderPlan.filter((row) => row.result === "previously_cancelled").length;
  const crewMembers = new Set([
    ...schedulePlan.map((row) => row.crew_id),
    ...reminderPlan.map((row) => row.crew_id),
  ].filter(Boolean)).size;
  return {
    schedules_now: scheduleNow,
    future,
    overdue,
    already_scheduled: alreadyScheduled,
    already_sent: alreadySent,
    duplicate_skip: alreadyScheduled + alreadySent,
    previously_cancelled: previouslyCancelled,
    no_phone: noPhone,
    skipped,
    crew_members: crewMembers,
  };
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
  const byCrew = nextScheduleByCrew(bundle.show, targetDays, targetCalls, targetAssignments, bundle.crewRows, bundle.masterRates, settings, senderName, bundle.projectManagerContact);

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

async function existingShortcutToken(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string) {
  const personalToken = createPersonalShortcutToken(userId);
  const { data } = await admin
    .from("show_text_automations")
    .select("shortcut_token")
    .eq("sending_method", "shortcut")
    .eq("shortcut_token", personalToken)
    .limit(1);
  return safeText((data?.[0] as { shortcut_token?: string } | undefined)?.shortcut_token) || personalToken;
}

async function saveSettings(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, settings: AutomationSettings, user?: { id: string }) {
  const savedPersonalToken = user?.id ? await existingShortcutToken(admin, user.id) : "";
  const providedPersonalUserId = resolvePersonalShortcutToken(settings.shortcut_token);
  const secureShortcutToken = settings.sending_method === "shortcut"
    ? (providedPersonalUserId ? settings.shortcut_token : savedPersonalToken || randomUUID())
    : settings.shortcut_token;
  const storedSendingMethod = settings.sending_method === "android_messages" ? "shortcut" : settings.sending_method;
  const payload = {
    ...settings,
    sending_method: storedSendingMethod,
    shortcut_token: secureShortcutToken,
    updated_at: new Date().toISOString(),
  };
  const selectColumns = "show_id, enabled, sending_method, shortcut_token, send_availability, send_schedule, reminder_7_day, reminder_3_day, reminder_day_before, reminder_day_of, reminder_daily_after_first_day, timezone, availability_template, schedule_template, reminder_template, updated_at";
  const result = await admin
    .from("show_text_automations")
    .upsert(payload, { onConflict: "show_id" })
    .select(selectColumns)
    .single();
  if (!result.error) return { ...result.data, sending_method: settings.sending_method };
  if (result.error.message.includes("reminder_daily_after_first_day")) {
    throw new Error("Daily-after-first-day reminders are not installed in Supabase yet. Run the ELS376 text automation SQL, then save Apple Shortcut settings again.");
  }

  const uniqueShortcutTokenBlocked = settings.sending_method === "shortcut" && (
    result.error.message.includes("show_text_automations_shortcut_token_idx") ||
    result.error.message.includes("duplicate key value violates unique constraint")
  );
  if (!uniqueShortcutTokenBlocked) throw new Error(result.error.message);

  // Older ELS builds created a unique index on shortcut_token. Universal Shortcut Mode
  // needs the same token available across shows, so save the show as active Shortcut Mode
  // even if the old DB index is still present. The UI can still generate the signed-in
  // user's personal Shortcut URL without relying on this saved column.
  const fallbackPayload = {
    ...payload,
    shortcut_token: null,
  };
  const fallback = await admin
    .from("show_text_automations")
    .upsert(fallbackPayload, { onConflict: "show_id" })
    .select(selectColumns)
    .single();
  if (fallback.error && fallback.error.message.includes("reminder_daily_after_first_day")) {
    throw new Error("Daily-after-first-day reminders are not installed in Supabase yet. Run the ELS376 text automation SQL, then save Apple Shortcut settings again.");
  }
  if (fallback.error) throw new Error(fallback.error.message);
  return { ...fallback.data, shortcut_token: secureShortcutToken, sending_method: settings.sending_method };
}

async function queueIntroText(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, body: Record<string, unknown>, user: { id: string; email?: string | null; display_name?: string | null; messaging_mode?: string | null }) {
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
    admin.from("shows").select("id, name, show_reference_number, venue, event_location, rate_city, show_start, show_end").eq("id", showId).single(),
    admin.from("crew").select("id, name, phone").in("id", crewIds),
  ]);
  if (showRes.error || !showRes.data) throw new Error(showRes.error?.message || "Show not found.");
  if (crewRes.error) throw new Error(crewRes.error.message);

  const show = showRes.data as ShowRow;
  const crewById = new Map(((crewRes.data || []) as Array<{ id: string; name: string | null; phone: string | null }>).map((crew) => [crew.id, crew]));
  const senderName = senderNameForMessage(user);
  const availabilityCalls: AvailabilityCallRequest[] = (Array.isArray(body.availability_calls) ? body.availability_calls : [])
    .map((item) => item as Record<string, unknown>)
    .map((item) => ({
      labor_date: safeText(item.labor_date),
      start_time: safeText(item.start_time),
      end_time: safeText(item.end_time),
      role_name: safeText(item.role_name),
      area: safeText(item.area),
      location: safeText(item.location),
      rate: safeText(item.rate),
    }))
    .filter((item) => item.labor_date || item.start_time || item.end_time || item.role_name || item.area || item.rate);
  const uniqueValues = (values: string[]) => [...new Set(values.map(safeText).filter(Boolean))];
  const callRoles = uniqueValues(availabilityCalls.map((call) => call.role_name || "Crew"));
  const callAreas = uniqueValues(availabilityCalls.map((call) => call.area));
  const callRates = uniqueValues(availabilityCalls.map((call) => call.rate));
  const callDates = uniqueValues(availabilityCalls.map((call) => call.labor_date)).sort();
  const selectedRole = safeText(body.role_name) || callRoles.join(" / ") || "Event crew";
  const selectedCity = safeText(body.city_name) || safeText(show.rate_city) || safeText(show.event_location);
  const availabilitySchedule = availabilityCalls.length
    ? formatAvailabilityScheduleLines(availabilityCalls)
    : safeText(body.availability_schedule) || `${formatDate(show.show_start)} through ${formatDate(show.show_end)}`;
  const availabilityArea = safeText(body.availability_area) || callAreas.join(" / ");
  const availabilityRate = safeText(body.availability_rate) || callRates.join(" / ") || "TBD";
  const venueOrLocation = safeText(show.venue) || safeText(show.event_location);
  const availabilityStart = callDates[0] || show.show_start;
  const availabilityEnd = callDates[callDates.length - 1] || show.show_end;
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
      show_reference: safeText(show.show_reference_number) || safeText(show.name) || "ELS event",
      event_name: safeText(show.name) || "ELS event",
      show_name: safeText(show.name) || "ELS event",
      venue: safeText(show.venue),
      location: safeText(show.event_location) || safeText(show.venue),
      venue_or_location: venueOrLocation,
      city: selectedCity,
      show_start: formatDate(availabilityStart),
      show_end: formatDate(availabilityEnd),
      position: selectedRole,
      area: availabilityArea,
      rate: availabilityRate,
      availability_schedule: availabilitySchedule,
      next_call: availabilitySchedule,
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

function normalizedLookupText(value: unknown) {
  return safeText(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function inferQueueSender(row: RepairableQueueRow, profiles: SenderProfileRow[], fallbackShowCoordinatorId = "") {
  const explicit = safeText(row.queued_by_user_id);
  if (explicit && profiles.some((profile) => profile.id === explicit)) return explicit;
  const email = normalizedLookupText(row.queued_by_email);
  if (email) {
    const match = profiles.find((profile) => normalizedLookupText(profile.email) === email);
    if (match) return match.id;
  }
  const name = normalizedLookupText(row.queued_by_name);
  if (name) {
    const match = profiles.find((profile) => normalizedLookupText(profile.full_name) === name || normalizedLookupText(profile.email) === name);
    if (match) return match.id;
  }
  return fallbackShowCoordinatorId;
}

async function blockAmbiguousQueueRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, ids: string[]) {
  if (!ids.length) return [] as RepairableQueueRow[];
  const message = "Sender required before this message can be sent.";
  const reviewStatus = await admin
    .from("text_message_queue")
    .update({ status: "needs_sender_review", error: message })
    .in("id", ids)
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, error, queued_by_user_id, queued_by_email, queued_by_name");
  if (!reviewStatus.error) return (reviewStatus.data || []) as RepairableQueueRow[];
  const failedFallback = await admin
    .from("text_message_queue")
    .update({ status: "failed", error: message })
    .in("id", ids)
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, error, queued_by_user_id, queued_by_email, queued_by_name");
  if (failedFallback.error) throw new Error(failedFallback.error.message);
  return (failedFallback.data || []) as RepairableQueueRow[];
}

async function repairWaitingMessages(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string) {
  const { data: rowsData, error: rowsError } = await admin
    .from("text_message_queue")
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, error, queued_by_user_id, queued_by_email, queued_by_name")
    .eq("show_id", showId)
    .in("status", REPAIR_QUEUE_STATUSES)
    .order("scheduled_for", { ascending: true })
    .limit(500);
  if (rowsError) throw new Error(rowsError.message);
  const rows = (rowsData || []) as RepairableQueueRow[];
  if (!rows.length) return { updated: [] as RepairableQueueRow[], blocked: [] as RepairableQueueRow[], reviewed: 0 };

  const [{ data: profilesData }, { data: showData }] = await Promise.all([
    admin.from("profiles").select("id, full_name, email, role").limit(1000),
    admin.from("shows").select("id, assigned_coordinator_user_id").eq("id", showId).maybeSingle(),
  ]);
  const profiles = (profilesData || []) as SenderProfileRow[];
  const fallbackShowCoordinatorId = safeText((showData as { assigned_coordinator_user_id?: string | null } | null)?.assigned_coordinator_user_id);
  const grouped = new Map<string, string[]>();
  const blockedIds: string[] = [];
  for (const row of rows) {
    const senderId = inferQueueSender(row, profiles, fallbackShowCoordinatorId);
    if (!senderId) {
      blockedIds.push(row.id);
      continue;
    }
    if (safeText(row.queued_by_user_id) === senderId && safeText(row.status) === "scheduled" && !safeText(row.error)) continue;
    const ids = grouped.get(senderId) || [];
    ids.push(row.id);
    grouped.set(senderId, ids);
  }

  const updated: RepairableQueueRow[] = [];
  for (const [senderId, ids] of grouped.entries()) {
    const sender = profiles.find((profile) => profile.id === senderId);
    const { data, error } = await admin
      .from("text_message_queue")
      .update({
        queued_by_user_id: senderId,
        queued_by_email: sender?.email || null,
        queued_by_name: sender?.full_name || sender?.email || null,
        status: "scheduled",
        error: null,
      })
      .in("id", ids)
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, error, queued_by_user_id, queued_by_email, queued_by_name");
    if (error) throw new Error(error.message);
    updated.push(...((data || []) as RepairableQueueRow[]));
  }
  const blocked = await blockAmbiguousQueueRows(admin, blockedIds);
  return { updated, blocked, reviewed: rows.length };
}

async function claimLegacyQueuedMessagesForUser(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  showId: string,
  user: { id: string; email?: string | null; display_name?: string | null },
) {
  const identity = queueIdentity(user);
  const { data, error } = await admin
    .from("text_message_queue")
    .update({
      ...identity,
      status: "scheduled",
      error: null,
    })
    .eq("show_id", showId)
    .in("status", REPAIR_QUEUE_STATUSES)
    .is("queued_by_user_id", null)
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
  if (error) {
    if (isMissingSenderColumns(error.message)) throw new Error("Sender-bound queue columns are missing. Run the sender queue SQL, then retry.");
    throw new Error(error.message);
  }
  return (data || []) as QueueRow[];
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
    const saved = await saveSettings(admin, settings, auth.user);
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
    if (action === "personal_shortcut_token") {
      return NextResponse.json({
        ok: true,
        shortcut_token: createPersonalShortcutToken(auth.user.id),
        connected_user: senderNameForMessage(auth.user),
        connected_user_id: auth.user.id,
        message: "Personal Shortcut URL ready for this signed-in user.",
      });
    }
    const showId = safeText(body.show_id || body.settings?.show_id);
    if (action === "load_cancellation_notices") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const { data, error } = await admin
        .from("event_removed_crew_assignments")
        .select("id, event_id, crew_contact_id, crew_name, phone, labor_date, role, area, start_time, end_time, removed_at, removed_by_name, cancellation_notice_status, cancellation_notice_message, cancellation_notice_queue_id")
        .eq("event_id", showId)
        .order("removed_at", { ascending: false })
        .limit(500);
      if (error) {
        if (missingRemovedCrewAssignments(error.message)) return NextResponse.json({ ok: true, notices: [], notices_missing: true, message: "Run the cancellation notice SQL to enable removed-crew notices." });
        throw new Error(error.message);
      }
      return NextResponse.json({ ok: true, notices: data || [] });
    }
    if (action === "mark_cancellation_notices") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(safeText).filter(Boolean).slice(0, 250);
      const requestedStatus = safeText(body.status);
      const status = requestedStatus === "handled_manually" || requestedStatus === "suppressed" ? requestedStatus : "";
      if (!ids.length || !status) return NextResponse.json({ message: "Choose cancellation notices and a valid status." }, { status: 400 });
      const { data, error } = await admin
        .from("event_removed_crew_assignments")
        .update({
          cancellation_notice_status: status,
          cancellation_notice_sent_by: auth.user.id,
        })
        .eq("event_id", showId)
        .in("id", ids)
        .select("id, event_id, crew_contact_id, crew_name, phone, labor_date, role, area, start_time, end_time, removed_at, removed_by_name, cancellation_notice_status, cancellation_notice_message, cancellation_notice_queue_id");
      if (error) {
        if (missingRemovedCrewAssignments(error.message)) return NextResponse.json({ ok: false, message: "Run the cancellation notice SQL first." }, { status: 400 });
        throw new Error(error.message);
      }
      return NextResponse.json({ ok: true, notices: data || [], message: status === "handled_manually" ? "Cancellation marked handled manually." : "Cancellation notice suppressed." });
    }
    if (action === "queue_cancellation_notices") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(safeText).filter(Boolean).slice(0, 250);
      const messageEdits = (body.messages || {}) as Record<string, string>;
      if (!ids.length) return NextResponse.json({ message: "Select at least one removed crew member first." }, { status: 400 });
      const [showRes, noticeRes] = await Promise.all([
        admin.from("shows").select("id, name, show_reference_number").eq("id", showId).maybeSingle(),
        admin
          .from("event_removed_crew_assignments")
          .select("id, event_id, crew_contact_id, crew_name, phone, labor_date, role, area, start_time, end_time, removed_at, removed_by_name, cancellation_notice_status, cancellation_notice_message, cancellation_notice_queue_id")
          .eq("event_id", showId)
          .in("id", ids),
      ]);
      if (showRes.error) throw new Error(showRes.error.message);
      if (noticeRes.error) {
        if (missingRemovedCrewAssignments(noticeRes.error.message)) return NextResponse.json({ ok: false, message: "Run the cancellation notice SQL first." }, { status: 400 });
        throw new Error(noticeRes.error.message);
      }
      const show = showRes.data as { name?: string | null; show_reference_number?: string | null } | null;
      const eventName = safeText(show?.show_reference_number) || safeText(show?.name) || "this event";
      const rows = (noticeRes.data || []) as RemovedCrewAssignmentRow[];
      const pendingRows = rows.filter((row) => !["queued", "sent", "handled_manually", "suppressed"].includes(normalizeRole(row.cancellation_notice_status)));
      const grouped = new Map<string, RemovedCrewAssignmentRow[]>();
      for (const row of pendingRows) {
        const key = safeText(row.crew_contact_id) || safeText(row.phone) || row.id;
        grouped.set(key, [...(grouped.get(key) || []), row]);
      }
      const queued: unknown[] = [];
      const updatedNotices: RemovedCrewAssignmentRow[] = [];
      const nowIso = new Date().toISOString();
      for (const [key, groupRows] of grouped.entries()) {
        const first = groupRows[0];
        const phone = cleanPhone(first.phone || "");
        if (!phone) continue;
        const bodyText = safeText(messageEdits[key]) || buildCancellationNoticeBody(eventName, groupRows);
        const queueRow: QueueRow = {
          ...queueIdentity(auth.user),
          show_id: showId,
          crew_id: safeText(first.crew_contact_id),
          crew_name: safeText(first.crew_name) || "Crew member",
          phone,
          message_type: "assignment_cancellation",
          reminder_key: `assignment_cancellation_${randomUUID()}`,
          scheduled_for: nowIso,
          status: "scheduled",
          body: ensureSenderIdentity(bodyText, senderNameForMessage(auth.user)),
        };
        const inserted = await insertCancellationQueueRow(admin, queueRow);
        queued.push(inserted);
        const queueId = safeText((inserted as { id?: string | null } | null)?.id);
        const noticeUpdate = await admin
          .from("event_removed_crew_assignments")
          .update({
            cancellation_notice_status: "queued",
            cancellation_notice_message: queueRow.body,
            cancellation_notice_queue_id: queueId || null,
            cancellation_notice_sent_by: auth.user.id,
          })
          .in("id", groupRows.map((row) => row.id))
          .select("id, event_id, crew_contact_id, crew_name, phone, labor_date, role, area, start_time, end_time, removed_at, removed_by_name, cancellation_notice_status, cancellation_notice_message, cancellation_notice_queue_id");
        if (noticeUpdate.error) throw new Error(noticeUpdate.error.message);
        updatedNotices.push(...((noticeUpdate.data || []) as RemovedCrewAssignmentRow[]));
      }
      return NextResponse.json({
        ok: true,
        queue: queued,
        notices: updatedNotices,
        message: queued.length ? `Queued ${queued.length} cancellation notice${queued.length === 1 ? "" : "s"}.` : "No cancellation notices were queued. Check that selected crew have valid phone numbers and are still pending.",
      });
    }
    if (action === "queue_availability_candidates") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const settings = normalizeSettings(body.settings || {}, showId);
      const saved = await saveSettings(admin, { ...settings, enabled: true, send_availability: true }, auth.user);
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
    if (action === "repair_waiting_messages") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const result = await repairWaitingMessages(admin, showId);
      const { data, error } = await admin
        .from("text_message_queue")
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
        .eq("show_id", showId)
        .order("scheduled_for", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return NextResponse.json({
        ok: true,
        queue: data || [],
        repair: result,
        message: `Reviewed ${result.reviewed} waiting text${result.reviewed === 1 ? "" : "s"}. ${result.updated.length} sender${result.updated.length === 1 ? "" : "s"} assigned. ${result.blocked.length} ambiguous text${result.blocked.length === 1 ? "" : "s"} blocked for sender review.`,
      });
    }
    if (action === "claim_legacy_queued_messages") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const updated = await claimLegacyQueuedMessagesForUser(admin, showId, auth.user);
      return NextResponse.json({
        ok: true,
        queue: updated,
        message: updated.length
          ? `Attached ${updated.length} legacy/no-sender queued text${updated.length === 1 ? "" : "s"} to ${senderNameForMessage(auth.user)}. Run this user's personal iPhone Shortcut to send due texts.`
          : "No legacy/no-sender queued texts were waiting on this show.",
      });
    }
    if (action === "admin_cancel_selected_queue") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const ids = cleanQueueIds(body.ids);
      if (!ids.length) return NextResponse.json({ message: "Select at least one queue row to cancel." }, { status: 400 });
      const cancelPayload = { status: "cancelled", error: "Cancelled by admin before sending.", sent_at: null, cancelled_at: new Date().toISOString(), cancelled_by: auth.user.id };
      let query = admin
        .from("text_message_queue")
        .update(cancelPayload)
        .eq("show_id", showId)
        .in("id", ids)
        .in("status", REPAIR_QUEUE_STATUSES);
      let { data, error } = await query.select(TEXT_QUEUE_SELECT);
      if (error && isMissingQueueAuditColumns(error.message)) {
        const fallback = await admin
          .from("text_message_queue")
          .update({ status: "cancelled", error: "Cancelled by admin before sending.", sent_at: null })
          .eq("show_id", showId)
          .in("id", ids)
          .in("status", REPAIR_QUEUE_STATUSES)
          .select(TEXT_QUEUE_SELECT);
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error && isMissingDeliveryModeColumns(error.message)) {
        const fallback = await admin
          .from("text_message_queue")
          .update({ status: "cancelled", error: "Cancelled by admin before sending.", sent_at: null })
          .eq("show_id", showId)
          .in("id", ids)
          .in("status", REPAIR_QUEUE_STATUSES)
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error) throw new Error(error.message);
      const count = data?.length || 0;
      return NextResponse.json({ ok: true, queue: data || [], message: count ? `Cancelled ${count} selected text${count === 1 ? "" : "s"}.` : "No selected queued/sending texts were available to cancel." });
    }
    if (action === "admin_reset_selected_sending") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const ids = cleanQueueIds(body.ids);
      if (!ids.length) return NextResponse.json({ message: "Select at least one stuck sending row to reset." }, { status: 400 });
      const resetPayload = { status: "scheduled", sent_at: null, error: "Returned to queue by admin.", claimed_at: null, claim_token: null };
      let { data, error } = await admin
        .from("text_message_queue")
        .update(resetPayload)
        .eq("show_id", showId)
        .in("id", ids)
        .in("status", ["sending", "needs_sender_review"])
        .select(TEXT_QUEUE_SELECT);
      if (error && isMissingClaimColumns(error.message)) {
        const fallback = await admin
          .from("text_message_queue")
          .update({ status: "scheduled", sent_at: null, error: "Returned to queue by admin." })
          .eq("show_id", showId)
          .in("id", ids)
          .in("status", ["sending", "needs_sender_review"])
          .select(TEXT_QUEUE_SELECT);
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error && isMissingDeliveryModeColumns(error.message)) {
        const fallback = await admin
          .from("text_message_queue")
          .update({ status: "scheduled", sent_at: null, error: "Returned to queue by admin." })
          .eq("show_id", showId)
          .in("id", ids)
          .in("status", ["sending", "needs_sender_review"])
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error) throw new Error(error.message);
      const count = data?.length || 0;
      return NextResponse.json({ ok: true, queue: data || [], message: count ? `Returned ${count} selected text${count === 1 ? "" : "s"} to the queue.` : "No selected sending rows were available to reset." });
    }
    if (action === "admin_update_selected_sender") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const ids = cleanQueueIds(body.ids);
      const senderUserId = safeText(body.sender_user_id) || auth.user.id;
      if (!ids.length) return NextResponse.json({ message: "Select at least one queue row before changing sender." }, { status: 400 });
      let targetUser: { id: string; email?: string | null; display_name?: string | null; messaging_mode?: string | null } = auth.user;
      if (senderUserId !== auth.user.id) {
        const targetRes = await admin.from("profiles").select("id, full_name, email, messaging_mode, device_type").eq("id", senderUserId).maybeSingle();
        if (targetRes.error && /messaging_mode|device_type|schema cache/i.test(targetRes.error.message)) {
          const fallback = await admin.from("profiles").select("id, full_name, email").eq("id", senderUserId).maybeSingle();
          if (fallback.error) throw new Error(fallback.error.message);
          const profile = fallback.data as Partial<SenderProfileRow> | null;
          if (!profile?.id) return NextResponse.json({ message: "Selected sender profile was not found." }, { status: 404 });
          targetUser = { id: profile.id, email: profile.email || null, display_name: profile.full_name || profile.email || null, messaging_mode: "apple_shortcut" };
        } else {
          if (targetRes.error) throw new Error(targetRes.error.message);
          const profile = targetRes.data as Partial<SenderProfileRow> | null;
          if (!profile?.id) return NextResponse.json({ message: "Selected sender profile was not found." }, { status: 404 });
          targetUser = { id: profile.id, email: profile.email || null, display_name: profile.full_name || profile.email || null, messaging_mode: normalizeMessagingMode(profile.messaging_mode) };
        }
      }
      const identity = queueIdentity(targetUser);
      let { data, error } = await admin
        .from("text_message_queue")
        .update({ ...identity, error: null })
        .eq("show_id", showId)
        .in("id", ids)
        .in("status", REPAIR_QUEUE_STATUSES)
        .select(TEXT_QUEUE_SELECT);
      if (error && isMissingDeliveryModeColumns(error.message)) {
        const fallback = await admin
          .from("text_message_queue")
          .update({ queued_by_user_id: identity.queued_by_user_id, queued_by_email: identity.queued_by_email, queued_by_name: identity.queued_by_name, error: null })
          .eq("show_id", showId)
          .in("id", ids)
          .in("status", REPAIR_QUEUE_STATUSES)
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error) throw new Error(error.message);
      const count = data?.length || 0;
      return NextResponse.json({ ok: true, queue: data || [], message: count ? `Attached ${count} selected text${count === 1 ? "" : "s"} to ${senderNameForMessage(targetUser)}.` : "No selected queued/sending texts were available to attach." });
    }
    if (action === "admin_update_queue_row") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      if (!queueId) return NextResponse.json({ message: "id is required." }, { status: 400 });
      const updatePayload: Record<string, unknown> = {};
      if (Object.prototype.hasOwnProperty.call(body, "body_text")) updatePayload.body = safeText(body.body_text);
      if (Object.prototype.hasOwnProperty.call(body, "scheduled_for")) {
        const scheduledFor = safeText(body.scheduled_for);
        if (!scheduledFor || Number.isNaN(Date.parse(scheduledFor))) return NextResponse.json({ message: "Scheduled time is invalid." }, { status: 400 });
        updatePayload.scheduled_for = new Date(scheduledFor).toISOString();
      }
      if (Object.prototype.hasOwnProperty.call(body, "status")) {
        const nextStatus = cleanQueueStatus(body.status);
        if (!nextStatus) return NextResponse.json({ message: "Status is invalid." }, { status: 400 });
        updatePayload.status = nextStatus;
        if (nextStatus !== "sent") updatePayload.sent_at = null;
      }
      if (!Object.keys(updatePayload).length) return NextResponse.json({ message: "No queue changes were submitted." }, { status: 400 });
      let { data, error } = await admin
        .from("text_message_queue")
        .update(updatePayload)
        .eq("show_id", showId)
        .eq("id", queueId)
        .select(TEXT_QUEUE_SELECT)
        .single();
      if (error && isMissingDeliveryModeColumns(error.message)) {
        const fallback = await admin
          .from("text_message_queue")
          .update(updatePayload)
          .eq("show_id", showId)
          .eq("id", queueId)
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
          .single();
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error) throw new Error(error.message);
      const assignmentChecklist = data && updatePayload.status === "sent" ? await syncAssignmentChecklistFromSentMessage(admin, data).catch(() => null) : null;
      return NextResponse.json({ ok: true, queue: data ? [data] : [], assignmentChecklist, message: "Queue row updated." });
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
      const assignmentChecklist = await syncAssignmentChecklistFromSentMessage(admin, data).catch(() => null);
      return NextResponse.json({ ok: true, queue: [data], assignmentChecklist, message: "Text marked sent manually and the communication checklist was updated." });
    }
    if (action === "mark_opened") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      if (!queueId) return NextResponse.json({ message: "id is required." }, { status: 400 });
      const openedAt = new Date().toISOString();
      const { data, error } = await admin
        .from("text_message_queue")
        .update({ opened_in_messages_at: openedAt, error: "Opened in Android Messages. Mark sent after sending from the phone." })
        .eq("show_id", showId)
        .eq("id", queueId)
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name, delivery_mode, opened_in_messages_at")
        .single();
      if (error && isMissingDeliveryModeColumns(error.message)) {
        return NextResponse.json({ ok: true, queue: [], message: "Opened Messages. Mark sent after the text is sent." });
      }
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, queue: [data], message: "Opened Android Messages. Mark sent after the text is sent." });
    }
    if (action === "return_sending_to_queue") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      if (!queueId) return NextResponse.json({ message: "id is required." }, { status: 400 });
      const resetPayload = {
        status: "scheduled",
        sent_at: null,
        error: "Returned to queue from live Shortcut diagnostic.",
        claimed_at: null,
        claim_token: null,
      };
      let { data, error } = await admin
        .from("text_message_queue")
        .update(resetPayload)
        .eq("show_id", showId)
        .eq("id", queueId)
        .eq("status", "sending")
        .eq("queued_by_user_id", auth.user.id)
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
        .single();
      if (error && isMissingClaimColumns(error.message)) {
        const fallback = await admin
          .from("text_message_queue")
          .update({ status: "scheduled", sent_at: null, error: "Returned to queue from live Shortcut diagnostic." })
          .eq("show_id", showId)
          .eq("id", queueId)
          .eq("status", "sending")
          .eq("queued_by_user_id", auth.user.id)
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
          .single();
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, queue: [data], message: "Returned the live-pull diagnostic text to the queue." });
    }
    if (action === "cancel_queued") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      const cancelPayload = { status: "cancelled", error: "Cancelled before sending.", sent_at: null, cancelled_at: new Date().toISOString(), cancelled_by: auth.user.id };
      let query = admin
        .from("text_message_queue")
        .update(cancelPayload)
        .eq("show_id", showId)
        .in("status", ACTIVE_QUEUE_STATUSES);
      if (queueId) query = query.eq("id", queueId);
      let { data, error } = await query.select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
      if (error && isMissingQueueAuditColumns(error.message)) {
        let fallbackQuery = admin
          .from("text_message_queue")
          .update({ status: "cancelled", error: "Cancelled before sending.", sent_at: null })
          .eq("show_id", showId)
          .in("status", ACTIVE_QUEUE_STATUSES);
        if (queueId) fallbackQuery = fallbackQuery.eq("id", queueId);
        const fallback = await fallbackQuery.select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
        data = fallback.data as unknown as typeof data;
        error = fallback.error;
      }
      if (error) throw new Error(error.message);
      const count = data?.length || 0;
      return NextResponse.json({ ok: true, queue: data || [], message: count ? `Cancelled ${count} queued text${count === 1 ? "" : "s"}.` : "No scheduled queued texts were available to cancel." });
    }
    if (action === "requeue_cancelled") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      if (!queueId) return NextResponse.json({ message: "id is required." }, { status: 400 });
      const { data: cancelledRow, error: cancelledError } = await admin
        .from("text_message_queue")
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status")
        .eq("show_id", showId)
        .eq("id", queueId)
        .maybeSingle();
      if (cancelledError) throw new Error(cancelledError.message);
      const cancelled = cancelledRow as { id: string; show_id: string; crew_id: string | null; crew_name: string | null; phone: string | null; message_type: string | null; reminder_key: string | null; scheduled_for: string | null; status: string | null } | null;
      if (!cancelled || normalizeRole(cancelled.status) !== "cancelled") {
        return NextResponse.json({ message: "Only cancelled queue records can be requeued from this button." }, { status: 400 });
      }
      const settings = normalizeSettings(body.settings || {}, showId);
      const effectiveSettings = { ...settings, enabled: true, send_schedule: true };
      const bundle = await fetchShowBundle(admin, showId);
      const senderName = senderNameForMessage(auth.user);
      const crewId = safeText(cancelled.crew_id);
      const logicalKey = logicalReminderKey(cancelled.reminder_key || "");
      let queueRows: QueueRow[] = [];
      if (cancelled.message_type === "schedule" && (logicalKey === "full_show_schedule" || logicalKey.startsWith("manual_7_day"))) {
        const plan = await buildImmediateFullShowSchedulePlan(admin, effectiveSettings, bundle, senderName, safeText(body.additional_note), { resendCancelled: true });
        queueRows = queueRowsFromImmediateSchedulePlan(showId, plan.filter((row) => row.crew_id === crewId), auth.user, true);
      } else {
        const plan = await buildFullShowReminderPlan(admin, effectiveSettings, bundle, senderName, { resendCancelled: true });
        queueRows = queueRowsFromReminderPlan(showId, plan.filter((row) => row.crew_id === crewId && logicalReminderKey(row.reminder_key) === logicalKey), auth.user, true, Boolean(body.requeue_now));
      }
      if (!queueRows.length) {
        return NextResponse.json({ ok: true, queue: [], message: "No matching current event data was found to requeue this cancelled text." });
      }
      queueRows = queueRows.map((row) => ({ ...row, requeued_from_id: queueId, attempt_number: row.attempt_number || 2 }));
      const data = await upsertTextQueueRows(admin, queueRows);
      return NextResponse.json({ ok: true, queue: data || [], message: `Requeued ${data?.length || queueRows.length} text${(data?.length || queueRows.length) === 1 ? "" : "s"} using current event data.` });
    }
    if (action === "preview_updated_schedules" || action === "send_updated_schedules") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const rawCrewIds = Array.isArray(body.crew_ids) ? body.crew_ids : [];
      const crewIds: string[] = [...new Set(
        rawCrewIds
          .map((value: unknown) => safeText(value))
          .filter((value: string): value is string => Boolean(value)),
      )].slice(0, 200);
      if (!crewIds.length) return NextResponse.json({ message: "Select at least one tech for the updated schedule." }, { status: 400 });
      const settings = normalizeSettings(body.settings || {}, showId);
      const effectiveSettings = { ...settings, enabled: true, send_schedule: true };
      const saved = action === "send_updated_schedules" ? await saveSettings(admin, effectiveSettings, auth.user) : null;
      const bundle = await fetchShowBundle(admin, showId);
      const senderName = senderNameForMessage(auth.user);
      const updateKey = `full_show_schedule_update_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
      const schedulePlan = await buildImmediateFullShowSchedulePlan(admin, effectiveSettings, bundle, senderName, safeText(body.additional_note), {
        selectedCrewIds: crewIds,
        forceQueue: true,
        forceUpdatedScheduleNotice: true,
        reminderKey: updateKey,
      });
      const summary = combinedScheduleSummary(schedulePlan, []);
      if (action === "preview_updated_schedules") {
        return NextResponse.json({
          ok: true,
          schedule_plan: schedulePlan,
          summary,
          message: `${summary.schedules_now} selected updated schedule${summary.schedules_now === 1 ? "" : "s"} will be queued with the update notice.`,
        });
      }

      if (crewIds.length) {
        const cancelExisting = await admin
          .from("text_message_queue")
          .update({ status: "cancelled", error: "Superseded by updated schedule" })
          .eq("show_id", showId)
          .eq("message_type", "schedule")
          .in("crew_id", crewIds)
          .in("status", ACTIVE_QUEUE_STATUSES);
        if (cancelExisting.error) throw new Error(cancelExisting.error.message);
      }
      const queueRows = queueRowsFromImmediateSchedulePlan(showId, schedulePlan, auth.user, true);
      const data = queueRows.length ? await upsertTextQueueRows(admin, queueRows) : [];
      return NextResponse.json({
        ok: true,
        settings: saved,
        queue: data || [],
        schedule_plan: schedulePlan,
        summary,
        message: `${data?.length || queueRows.length} updated schedule${(data?.length || queueRows.length) === 1 ? "" : "s"} queued with the update notice.`,
      });
    }
    if (action === "preview_combined_schedule_reminders" || action === "send_combined_schedule_reminders") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const settings = normalizeSettings(body.settings || {}, showId);
      const effectiveSettings = { ...settings, enabled: true, send_schedule: true };
      const saved = action === "send_combined_schedule_reminders" ? await saveSettings(admin, effectiveSettings, auth.user) : null;
      const bundle = await fetchShowBundle(admin, showId);
      const senderName = senderNameForMessage(auth.user);
      const resendCancelled = body.resend_cancelled !== false;
      const resendSentSchedules = Boolean(body.resend_sent_schedules);
      const addUpdatedScheduleNotice = Boolean(body.updated_schedule_notice);
      const [schedulePlan, reminderPlan] = await Promise.all([
        buildImmediateFullShowSchedulePlan(admin, effectiveSettings, bundle, senderName, safeText(body.additional_note), { resendCancelled, resendSent: resendSentSchedules, updatedScheduleNotice: addUpdatedScheduleNotice }),
        buildFullShowReminderPlan(admin, effectiveSettings, bundle, senderName, { resendCancelled }),
      ]);
      const summary = combinedScheduleSummary(schedulePlan, reminderPlan);
      if (action === "preview_combined_schedule_reminders") {
        return NextResponse.json({
          ok: true,
          schedule_plan: schedulePlan,
          plan: reminderPlan,
          summary,
          message: `${summary.schedules_now} full-show schedule${summary.schedules_now === 1 ? "" : "s"} will be queued now. ${summary.future} future reminder${summary.future === 1 ? "" : "s"} will be scheduled. ${summary.overdue} reminder${summary.overdue === 1 ? " is" : "s are"} overdue.`,
        });
      }

      const includeOverdueNow = Boolean(body.include_overdue_now);
      const queueRows = [
        ...queueRowsFromImmediateSchedulePlan(showId, schedulePlan, auth.user),
        ...queueRowsFromReminderPlan(showId, reminderPlan, auth.user, includeOverdueNow),
      ];
      const data = queueRows.length ? await upsertTextQueueRows(admin, queueRows) : [];
      return NextResponse.json({
        ok: true,
        settings: saved,
        queue: data || [],
        schedule_plan: schedulePlan,
        plan: reminderPlan,
        summary,
        message: `Schedules queued and future reminders scheduled. ${summary.schedules_now} schedule${summary.schedules_now === 1 ? "" : "s"} due now, ${summary.future} future reminder${summary.future === 1 ? "" : "s"} scheduled.${includeOverdueNow && summary.overdue ? ` ${summary.overdue} overdue reminder${summary.overdue === 1 ? " was" : "s were"} queued due now.` : summary.overdue ? ` ${summary.overdue} overdue reminder${summary.overdue === 1 ? " was" : "s were"} skipped.` : ""}`,
      });
    }
    if (action === "preview_checked_reminders" || action === "schedule_checked_reminders") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const settings = normalizeSettings(body.settings || {}, showId);
      const effectiveSettings = { ...settings, enabled: true, send_schedule: true };
      const saved = action === "schedule_checked_reminders" ? await saveSettings(admin, effectiveSettings, auth.user) : null;
      const bundle = await fetchShowBundle(admin, showId);
      const senderName = senderNameForMessage(auth.user);
      const plan = await buildFullShowReminderPlan(admin, effectiveSettings, bundle, senderName);
      const futureCount = plan.filter((row) => row.result === "will_schedule").length;
      const overdueCount = plan.filter((row) => row.result === "overdue").length;
      const skippedCount = plan.length - futureCount - overdueCount;
      if (action === "preview_checked_reminders") {
        return NextResponse.json({
          ok: true,
          plan,
          summary: { future: futureCount, overdue: overdueCount, skipped: skippedCount },
          message: `${futureCount} future reminder${futureCount === 1 ? "" : "s"} will be scheduled. ${overdueCount} reminder${overdueCount === 1 ? " is" : "s are"} overdue.`,
        });
      }
      const includeOverdueNow = Boolean(body.include_overdue_now);
      const queueRows = queueRowsFromReminderPlan(showId, plan, auth.user, includeOverdueNow);
      if (!queueRows.length) {
        return NextResponse.json({
          ok: true,
          settings: saved,
          queue: [],
          plan,
          summary: { future: futureCount, overdue: overdueCount, skipped: skippedCount },
          message: "No new reminders were scheduled. The preview shows what was skipped or already accounted for.",
        });
      }
      const data = await upsertTextQueueRows(admin, queueRows);
      return NextResponse.json({
        ok: true,
        settings: saved,
        queue: data || [],
        plan,
        summary: { future: futureCount, overdue: overdueCount, skipped: skippedCount },
        message: `Scheduled ${data?.length || queueRows.length} reminder${(data?.length || queueRows.length) === 1 ? "" : "s"} for this show.${includeOverdueNow && overdueCount ? ` ${overdueCount} overdue reminder${overdueCount === 1 ? " was" : "s were"} queued due now.` : ""}`,
      });
    }
    const isManualReminderAction = action === "queue_manual_reminder" || action === "queue_manual_day_reminder";
    const isCustomMessageAction = action === "queue_custom_message";
    if (action !== "queue_messages" && !isManualReminderAction && !isCustomMessageAction) return NextResponse.json({ message: "Unsupported action." }, { status: 400 });
    if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
    const mode = isManualReminderAction || isCustomMessageAction ? "schedule_reminders" : body.mode === "availability" ? "availability" : "schedule_reminders";
    const manualReminderKey = safeText(body.reminder_key) || "day_of";
    const manualLaborDayId = safeText(body.labor_day_id);
    const scheduleManualDayAtNormalTime = action === "queue_manual_day_reminder" && Boolean(body.schedule_for_due_time);
    const additionalNote = safeText(body.additional_note);
    if (isManualReminderAction && !["7_day", "3_day", "day_before", "day_of", "daily_after_first_day"].includes(manualReminderKey)) {
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
    const saved = await saveSettings(admin, effectiveSettings, auth.user);
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
    if (scheduleManualDayAtNormalTime && manualDay) {
      const senderName = senderNameForMessage(auth.user);
      const plan = await buildSelectedDayReminderPlan(admin, effectiveSettings, bundle, senderName, manualDay.id, manualReminderKey);
      const queueRows = queueRowsFromReminderPlan(showId, plan, auth.user, true);
      if (!queueRows.length) {
        return NextResponse.json({ ok: true, settings: saved, queue: [], plan, message: "No new selected-day reminders were scheduled. Check for valid phone numbers or already queued/sent reminders for that day." });
      }
      const data = await upsertTextQueueRows(admin, queueRows);
      const normalTimeLabel = manualReminderKey === "day_before"
        ? "5:00 PM the day before"
        : manualReminderKey === "3_day"
          ? "9:00 AM three days before"
          : "2 hours before the selected call";
      return NextResponse.json({
        ok: true,
        settings: saved,
        queue: data || [],
        plan,
        message: `Scheduled ${queueRows.length} selected-day ${readableReminderLabel(manualReminderKey).toLowerCase()} text${queueRows.length === 1 ? "" : "s"} for ${formatDate(manualDay.labor_date)} at the normal time (${normalTimeLabel}, ${effectiveSettings.timezone}).`,
      });
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
