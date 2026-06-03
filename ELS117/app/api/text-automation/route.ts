import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

const META_START = "[[ELS_EVENT_MESSAGE_DETAILS]]";
const META_END = "[[/ELS_EVENT_MESSAGE_DETAILS]]";

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

type ShowRow = { id: string; name: string | null; client: string | null; venue: string | null; rate_city: string | null; show_start: string; show_end: string; notes: string | null };
type LaborDayRow = { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null };
type SubCallRow = { id: string; labor_day_id: string; area: string | null; role_name: string | null; start_time: string | null; end_time: string | null; crew_needed: number | null; notes: string | null; sort_order?: number | null; day_type?: string | null; one_hour_walkaway?: boolean | null };
type AssignmentRow = { id: string; sub_call_id: string; crew_id: string; status: string | null; sort_order?: number | null; start_time?: string | null; end_time?: string | null; day_type?: string | null };
type CrewRow = { id: string; name: string | null; phone: string | null; email: string | null };

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
};

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
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
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
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


function normalizeReminderTemplate(value: unknown) {
  const text = safeText(value);
  const oldDefault = "Hi {first_name}, quick confirmation for {show_name}. Your next call is {next_call}. Meet-up Location: {meet_up_location}. Please reply confirmed. - {coordinator_name}";
  if (!text || text === oldDefault) return defaultReminderTemplate;
  return text;
}

const defaultAvailabilityTemplate = "Hi {first_name}, this is {coordinator_name} with Emanuel Labor Services. Are you available for {show_name} at {venue} from {show_start} to {show_end}? Please reply with the dates/times you can work. Thank you.";
const defaultScheduleTemplate = "Hi {first_name}, this is {coordinator_name} with Emanuel Labor Services. Here is your schedule for {show_name}:\n\n{schedule}\n\nMeet-up Location: {meet_up_location}\nRate: {rate}\nAttire: black polo, black pants, black shoes. Please arrive clean, well-groomed, and professionally presented.\n\nPlease confirm.";
const defaultReminderTemplate = "Hi {first_name}, quick confirmation for {show_name} at {venue}. Your next call is {next_call}. Meet-up Location: {meet_up_location}. Please reply confirmed. - {coordinator_name}";
const defaultDayOfReminderTemplate = "Good Morning, we are meeting at {meet_up_location}. See you soon.";

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
    availability_template: safeText(bodySettings.availability_template) || defaultAvailabilityTemplate,
    schedule_template: safeText(bodySettings.schedule_template) || defaultScheduleTemplate,
    reminder_template: normalizeReminderTemplate(bodySettings.reminder_template),
  };
}

function nextScheduleByCrew(show: ShowRow, days: LaborDayRow[], calls: SubCallRow[], assignments: AssignmentRow[], crewRows: CrewRow[], settings: AutomationSettings) {
  const crewById = new Map(crewRows.map((crew) => [crew.id, crew]));
  const dayById = new Map(days.map((day) => [day.id, day]));
  const callById = new Map(calls.map((call) => [call.id, call]));
  const meta = parseEventMeta(show.notes);
  const result = new Map<string, { crew: CrewRow; lines: string[]; firstCall: { day: LaborDayRow; call: SubCallRow; assignment: AssignmentRow } | null; values: Record<string, string> }>();

  for (const assignment of [...assignments].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const crew = crewById.get(assignment.crew_id);
    const call = callById.get(assignment.sub_call_id);
    const day = call ? dayById.get(call.labor_day_id) : null;
    if (!crew || !call || !day) continue;
    const current = result.get(crew.id) || { crew, lines: [], firstCall: null, values: {} as Record<string, string> };
    const blockLabel = [dayTypeLabel(assignmentDayType(assignment, call)), call.one_hour_walkaway ? "1 hr walkaway lunch" : ""].filter(Boolean).join(" / ");
    current.lines.push(`${formatDate(day.labor_date)} - ${assignmentTimeRange(assignment, call)} - ${safeText(call.role_name) || "Crew"} - ${safeText(call.area) || "Area TBD"}${blockLabel ? ` - ${blockLabel}` : ""}`);
    const firstKey = current.firstCall ? `${current.firstCall.day.labor_date} ${current.firstCall.assignment.start_time || current.firstCall.call.start_time || ""}` : "";
    const thisKey = `${day.labor_date} ${assignment.start_time || call.start_time || ""}`;
    if (!current.firstCall || thisKey.localeCompare(firstKey) < 0) current.firstCall = { day, call, assignment };
    result.set(crew.id, current);
  }

  const coordinatorName = meta.coordinator_name || "Storm Leigh";
  const coordinatorPhone = meta.coordinator_phone || "504-657-6618";
  const meetUp = meta.meet_up_location || "TBD onsite";
  const rate = meta.default_hourly_rate ? `$${meta.default_hourly_rate}/hr` : "TBD";

  for (const item of result.values()) {
    const schedule = item.lines.sort().join("\n");
    const nextCall = item.firstCall ? `${formatDate(item.firstCall.day.labor_date)} ${assignmentTimeRange(item.firstCall.assignment, item.firstCall.call)}${item.firstCall.call.one_hour_walkaway ? " (1 hr walkaway)" : ""} ${item.firstCall.call.role_name || "Crew"} ${item.firstCall.call.area || ""}` : "Schedule TBD";
    item.values = {
      first_name: firstName(item.crew.name || ""),
      crew_name: item.crew.name || "Crew member",
      show_name: show.name || "ELS Show",
      client: show.client || "",
      venue: show.venue || "",
      location: show.venue || show.rate_city || "",
      show_start: formatDate(show.show_start),
      show_end: formatDate(show.show_end),
      meet_up_location: meetUp,
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
  const showRes = await admin.from("shows").select("id, name, client, venue, rate_city, show_start, show_end, notes").eq("id", showId).single();
  if (showRes.error || !showRes.data) throw new Error(showRes.error?.message || "Show not found.");
  const show = showRes.data as ShowRow;
  const daysRes = await admin.from("labor_days").select("id, show_id, labor_date, label, notes").eq("show_id", showId);
  if (daysRes.error) throw new Error(daysRes.error.message);
  const days = (daysRes.data || []) as LaborDayRow[];
  const dayIds = days.map((day) => day.id);
  const callsRes = dayIds.length ? await admin.from("sub_calls").select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes, sort_order, day_type, one_hour_walkaway").in("labor_day_id", dayIds) : { data: [], error: null };
  if (callsRes.error) throw new Error(callsRes.error.message);
  const calls = (callsRes.data || []) as SubCallRow[];
  const callIds = calls.map((call) => call.id);
  const assignmentsRes = callIds.length ? await admin.from("assignments").select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type").in("sub_call_id", callIds).order("sort_order", { ascending: true }) : { data: [], error: null };
  if (assignmentsRes.error) throw new Error(assignmentsRes.error.message);
  const assignments = (assignmentsRes.data || []) as AssignmentRow[];
  const crewIds = [...new Set(assignments.map((assignment) => assignment.crew_id))];
  const crewRes = crewIds.length ? await admin.from("crew").select("id, name, phone, email").in("id", crewIds) : { data: [], error: null };
  if (crewRes.error) throw new Error(crewRes.error.message);
  return { show, days, calls, assignments, crewRows: (crewRes.data || []) as CrewRow[] };
}

function buildQueueRows(
  mode: "availability" | "schedule_reminders",
  settings: AutomationSettings,
  bundle: Awaited<ReturnType<typeof fetchShowBundle>>,
  options: { forceNowReminderKey?: string; laborDayId?: string; forceNowLabel?: string } = {}
) {
  const filteredDays = options.laborDayId ? bundle.days.filter((day) => day.id === options.laborDayId) : bundle.days;
  const filteredDayIds = new Set(filteredDays.map((day) => day.id));
  const filteredCalls = options.laborDayId ? bundle.calls.filter((call) => filteredDayIds.has(call.labor_day_id)) : bundle.calls;
  const filteredCallIds = new Set(filteredCalls.map((call) => call.id));
  const filteredAssignments = options.laborDayId ? bundle.assignments.filter((assignment) => filteredCallIds.has(assignment.sub_call_id)) : bundle.assignments;
  const byCrew = nextScheduleByCrew(bundle.show, filteredDays, filteredCalls, filteredAssignments, bundle.crewRows, settings);
  const rows: QueueRow[] = [];
  const nowIso = new Date(Date.now() + 30_000).toISOString();
  const manualLabel = safeText(options.forceNowLabel).replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40);
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
        body: applyTemplate(settings.availability_template || defaultAvailabilityTemplate, item.values),
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
        rows.push({
          show_id: settings.show_id,
          crew_id: crewId,
          crew_name: item.crew.name || "Crew member",
          phone,
          message_type: reminder.messageType,
          reminder_key: forceNow ? manualBatchKey : reminder.key,
          scheduled_for: forceNow ? nowIso : reminder.scheduledFor,
          status: "scheduled",
          body: applyTemplate(reminder.template, item.values),
        });
      }
    }
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

async function queueIntroText(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, body: Record<string, unknown>) {
  const phone = cleanPhone(safeText(body.phone));
  const messageBody = safeText(body.body);
  const crewName = safeText(body.crew_name) || "Crew contact";
  if (!phone) throw new Error("This contact needs a phone number before an intro text can be queued.");
  if (!messageBody) throw new Error("Intro text body is empty.");
  const payload = {
    crew_id: safeText(body.crew_id) || null,
    crew_name: crewName,
    phone,
    body: messageBody,
    status: "scheduled",
    scheduled_for: new Date(Date.now() + 30_000).toISOString(),
    created_at: new Date().toISOString(),
    error: null,
  };
  const { data, error } = await admin
    .from("crew_intro_text_queue")
    .insert(payload)
    .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at")
    .single();
  if (error) throw new Error(error.message);
  return data as IntroQueueRow;
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
      const intro = await queueIntroText(admin, body);
      return NextResponse.json({ ok: true, intro, message: "Intro text queued for the iPhone Shortcut." });
    }
    const showId = safeText(body.show_id || body.settings?.show_id);
    if (action === "cancel_queued") {
      if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
      const queueId = safeText(body.id);
      let query = admin
        .from("text_message_queue")
        .update({ status: "cancelled", error: "Cancelled before sending.", sent_at: null })
        .eq("show_id", showId)
        .eq("status", "scheduled");
      if (queueId) query = query.eq("id", queueId);
      const { data, error } = await query.select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at");
      if (error) throw new Error(error.message);
      const count = data?.length || 0;
      return NextResponse.json({ ok: true, queue: data || [], message: count ? `Cancelled ${count} queued text${count === 1 ? "" : "s"}.` : "No scheduled queued texts were available to cancel." });
    }
    const isManualReminderAction = action === "queue_manual_reminder" || action === "queue_manual_day_reminder";
    if (action !== "queue_messages" && !isManualReminderAction) return NextResponse.json({ message: "Unsupported action." }, { status: 400 });
    if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });
    const mode = isManualReminderAction ? "schedule_reminders" : body.mode === "availability" ? "availability" : "schedule_reminders";
    const manualReminderKey = action === "queue_manual_day_reminder" ? "day_of" : safeText(body.reminder_key);
    const manualLaborDayId = safeText(body.labor_day_id);
    if (action === "queue_manual_reminder" && !["7_day", "3_day", "day_before", "day_of"].includes(manualReminderKey)) {
      return NextResponse.json({ message: "Choose a valid reminder to queue now." }, { status: 400 });
    }
    if (action === "queue_manual_day_reminder" && !manualLaborDayId) {
      return NextResponse.json({ message: "Choose the labor day you want to queue now." }, { status: 400 });
    }
    const settings = normalizeSettings(body.settings || {}, showId);
    const effectiveSettings = isManualReminderAction
      ? { ...settings, enabled: true, send_schedule: true }
      : settings;
    if (!effectiveSettings.enabled) return NextResponse.json({ message: "Activate text automation for this show before queueing texts." }, { status: 400 });
    const saved = await saveSettings(admin, effectiveSettings);
    const bundle = await fetchShowBundle(admin, showId);
    const manualDay = manualLaborDayId ? bundle.days.find((day) => day.id === manualLaborDayId) : null;
    if (action === "queue_manual_day_reminder" && !manualDay) {
      return NextResponse.json({ message: "That labor day was not found on this show." }, { status: 400 });
    }
    const queueOptions = isManualReminderAction
      ? { forceNowReminderKey: manualReminderKey, laborDayId: manualDay?.id, forceNowLabel: manualDay?.labor_date }
      : {};
    const queueRows = buildQueueRows(mode, effectiveSettings, bundle, queueOptions);
    if (!queueRows.length) return NextResponse.json({ ok: true, settings: saved, queue: [], message: "No texts were queued. Make sure assigned crew have phone numbers and assignments on the selected day." });
    const { data, error } = await admin
      .from("text_message_queue")
      .upsert(queueRows, { onConflict: "show_id,crew_id,message_type,reminder_key" })
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at");
    if (error) throw new Error(error.message);
    const manualDayLabel = manualDay ? ` for ${formatDate(manualDay.labor_date)}` : "";
    const manualMessage = `Queued ${queueRows.length} manual reminder text${queueRows.length === 1 ? "" : "s"}${manualDayLabel}. They are due now and will send on the next iPhone Shortcut run.`;
    return NextResponse.json({ ok: true, settings: saved, queue: data || [], message: isManualReminderAction ? manualMessage : `Queued ${queueRows.length} text message${queueRows.length === 1 ? "" : "s"}.` });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to queue text messages." }, { status: 400 });
  }
}
