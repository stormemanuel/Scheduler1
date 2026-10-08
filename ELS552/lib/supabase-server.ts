import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { communicationChecklistStage, type TextMessageQueueRecord } from "@/lib/events-types";

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, anonKey, serviceRoleKey };
}

export function hasSupabaseEnv() {
  const { url, anonKey } = getConfig();
  return Boolean(url && anonKey);
}

async function loggedSupabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (process.env.NODE_ENV === "development") {
    try {
      const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const pathname = new URL(url).pathname;
      if (pathname.includes("/rest/v1/")) {
        const size = response.headers.get("content-length") || "unknown";
        console.info(`[supabase-rest] ${response.status} ${size} bytes ${pathname}`);
      }
    } catch {
      // Development logging should never affect Supabase requests.
    }
  }
  return response;
}

export async function createSupabaseServerClient() {
  const { url, anonKey } = getConfig();
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    global: { fetch: loggedSupabaseFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components may not be allowed to set cookies here.
        }
      },
    },
  });
}

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = getConfig();
  if (!url || !serviceRoleKey) return null;

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: loggedSupabaseFetch },
  });
}

const SCHEDULE_BOOTH_REPAIR_ACTIVE_STATUSES = ["scheduled", "waiting", "queued", "due_now", "pending"];
const SCHEDULE_BOOTH_REPAIR_INACTIVE_ASSIGNMENT_STATUSES = new Set([
  "removed",
  "cancelled",
  "canceled",
  "declined",
  "unavailable",
  "no show replaced",
  "called in replacement used",
]);

const SCHEDULE_BOOTH_MARKER_RE = /\[\[ELS_BOOTH_NUMBER:([^\]]+)\]\]/i;
const SCHEDULE_SUB_CALL_REFERENCE_MARKER_RE = /\[\[ELS_SUB_CALL_REFERENCE_NUMBER:([^\]]+)\]\]/i;

function scheduleBoothRepairText(value: unknown) {
  return String(value ?? "").trim();
}

function scheduleBoothRepairStatus(value: unknown) {
  return scheduleBoothRepairText(value).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function scheduleBoothRepairNumber(call: { area?: string | null; notes?: string | null }) {
  const notes = scheduleBoothRepairText(call.notes);
  const stored = notes.match(SCHEDULE_BOOTH_MARKER_RE)?.[1]?.trim() || "";
  if (stored) return stored;
  const reference = notes.match(SCHEDULE_SUB_CALL_REFERENCE_MARKER_RE)?.[1]?.trim() || "";
  const referenceMatch = reference.match(/^booth\s*(?:(?:number|no\.?|#)\s*)?:?\s*(.+)$/i);
  if (referenceMatch?.[1]) return scheduleBoothRepairText(referenceMatch[1]);
  const areaMatch = scheduleBoothRepairText(call.area).match(/\bbooth\s*(?:(?:number|no\.?|#)\s*)?:?\s*(TBD|[A-Z0-9-]+)/i);
  return scheduleBoothRepairText(areaMatch?.[1]);
}

function scheduleBoothRepairDateLabel(value: string) {
  const [year, month, day] = scheduleBoothRepairText(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return scheduleBoothRepairText(value).slice(0, 10);
  return `${month}/${day}/${year}`;
}

function scheduleBoothRepairBody(body: string, boothLine: string) {
  const cleanBody = scheduleBoothRepairText(body);
  const cleanBoothLine = scheduleBoothRepairText(boothLine);
  if (!cleanBody || !cleanBoothLine || /(^|\n)Booth\s*:/i.test(cleanBody)) return body;

  if (/\nRate\s*:/i.test(body)) return body.replace(/\nRate\s*:/i, `\n${cleanBoothLine}\nRate:`);
  if (/\nPO\s*:/i.test(body)) return body.replace(/\nPO\s*:/i, `\n${cleanBoothLine}\nPO:`);
  if (/\nSchedule\s*:/i.test(body)) return body.replace(/\nSchedule\s*:/i, `\n${cleanBoothLine}\n\nSchedule:`);
  return `${body.trimEnd()}\n\n${cleanBoothLine}`;
}

/**
 * Backfills booth numbers into active schedule queue rows without changing the
 * queue identity, sender, due time, reminder key, or status. This is used both
 * by the queue UI and immediately before the iPhone Shortcut pulls due rows so
 * schedules created before booth-aware formatting are repaired in place.
 */
export async function repairActiveScheduleQueueBoothLines(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  showIds: string[],
  options: { queueIds?: string[] } = {},
) {
  const ids = Array.from(new Set(showIds.map(scheduleBoothRepairText).filter(Boolean)));
  if (!ids.length) return { reviewed: 0, updated: 0, bodies: {} as Record<string, string> };
  const requestedQueueIds = Array.from(new Set((options.queueIds || []).map(scheduleBoothRepairText).filter(Boolean)));
  if (options.queueIds && !requestedQueueIds.length) return { reviewed: 0, updated: 0, bodies: {} as Record<string, string> };

  let queueQuery = admin
    .from("text_message_queue")
    .select("id, show_id, crew_id, body, message_type, status")
    .in("show_id", ids)
    .eq("message_type", "schedule")
    .in("status", SCHEDULE_BOOTH_REPAIR_ACTIVE_STATUSES);
  if (requestedQueueIds.length) queueQuery = queueQuery.in("id", requestedQueueIds);
  const { data: queueData, error: queueError } = await queueQuery.limit(5000);
  if (queueError) throw new Error(queueError.message);

  const queueRows = (queueData || []) as Array<{
    id: string;
    show_id: string | null;
    crew_id: string | null;
    body: string | null;
    message_type: string | null;
    status: string | null;
  }>;
  const repairableRows = queueRows.filter((row) =>
    scheduleBoothRepairText(row.id)
    && scheduleBoothRepairText(row.show_id)
    && scheduleBoothRepairText(row.crew_id)
    && scheduleBoothRepairText(row.body)
    && !/(^|\n)Booth\s*:/i.test(scheduleBoothRepairText(row.body))
  );
  if (!repairableRows.length) return { reviewed: queueRows.length, updated: 0, bodies: {} as Record<string, string> };

  const neededShowIds = Array.from(new Set(repairableRows.map((row) => scheduleBoothRepairText(row.show_id)).filter(Boolean)));
  const { data: dayData, error: dayError } = await admin
    .from("labor_days")
    .select("id, show_id, labor_date")
    .in("show_id", neededShowIds)
    .limit(5000);
  if (dayError) throw new Error(dayError.message);
  const days = (dayData || []) as Array<{ id: string; show_id: string | null; labor_date: string | null }>;
  const dayIds = days.map((day) => scheduleBoothRepairText(day.id)).filter(Boolean);
  if (!dayIds.length) return { reviewed: queueRows.length, updated: 0, bodies: {} as Record<string, string> };

  const { data: callData, error: callError } = await admin
    .from("sub_calls")
    .select("id, labor_day_id, area, notes")
    .in("labor_day_id", dayIds)
    .limit(10000);
  if (callError) throw new Error(callError.message);
  const calls = (callData || []) as Array<{
    id: string;
    labor_day_id: string | null;
    area: string | null;
    notes: string | null;
  }>;
  const callIds = calls.map((call) => scheduleBoothRepairText(call.id)).filter(Boolean);
  if (!callIds.length) return { reviewed: queueRows.length, updated: 0, bodies: {} as Record<string, string> };

  const { data: assignmentData, error: assignmentError } = await admin
    .from("assignments")
    .select("sub_call_id, crew_id, status")
    .in("sub_call_id", callIds)
    .limit(20000);
  if (assignmentError) throw new Error(assignmentError.message);
  const assignments = (assignmentData || []) as Array<{ sub_call_id: string | null; crew_id: string | null; status: string | null }>;

  const dayById = new Map(days.map((day) => [scheduleBoothRepairText(day.id), day]));
  const callById = new Map(calls.map((call) => [scheduleBoothRepairText(call.id), call]));
  const entriesByShowCrew = new Map<string, Array<{ date: string; booth: string }>>();
  for (const assignment of assignments) {
    if (SCHEDULE_BOOTH_REPAIR_INACTIVE_ASSIGNMENT_STATUSES.has(scheduleBoothRepairStatus(assignment.status))) continue;
    const call = callById.get(scheduleBoothRepairText(assignment.sub_call_id));
    const day = call ? dayById.get(scheduleBoothRepairText(call.labor_day_id)) : null;
    const showId = scheduleBoothRepairText(day?.show_id);
    const crewId = scheduleBoothRepairText(assignment.crew_id);
    const booth = call ? scheduleBoothRepairNumber(call) : "";
    const laborDate = scheduleBoothRepairText(day?.labor_date).slice(0, 10);
    if (!showId || !crewId || !booth) continue;
    const key = `${showId}:${crewId}`;
    entriesByShowCrew.set(key, [...(entriesByShowCrew.get(key) || []), { date: laborDate, booth }]);
  }

  const boothLineFor = (showId: string, crewId: string) => {
    const entries = (entriesByShowCrew.get(`${showId}:${crewId}`) || [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.booth.localeCompare(b.booth));
    if (!entries.length) return "";
    const uniqueBooths = Array.from(new Set(entries.map((entry) => entry.booth)));
    if (uniqueBooths.length === 1) return `Booth: ${uniqueBooths[0]}`;
    const dateLines = Array.from(new Set(entries.map((entry) => `${scheduleBoothRepairDateLabel(entry.date)}: ${entry.booth}`)));
    return `Booth:\n${dateLines.join("\n")}`;
  };

  let updated = 0;
  const bodies: Record<string, string> = {};
  for (const row of repairableRows) {
    const boothLine = boothLineFor(scheduleBoothRepairText(row.show_id), scheduleBoothRepairText(row.crew_id));
    if (!boothLine) continue;
    const currentBody = scheduleBoothRepairText(row.body);
    const nextBody = scheduleBoothRepairBody(currentBody, boothLine);
    if (!nextBody || nextBody === currentBody) continue;
    const result = await admin
      .from("text_message_queue")
      .update({ body: nextBody })
      .eq("id", row.id)
      .eq("message_type", "schedule")
      .in("status", SCHEDULE_BOOTH_REPAIR_ACTIVE_STATUSES);
    if (result.error) throw new Error(result.error.message);
    updated += 1;
    bodies[row.id] = nextBody;
  }

  return { reviewed: queueRows.length, updated, bodies };
}



const ASSIGNMENT_CONFLICT_INACTIVE_STATUSES = new Set([
  "no_show_replaced",
  "called_in_replacement_used",
  "cancelled",
  "canceled",
  "removed",
  "declined",
  "unavailable",
]);

function assignmentConflictSafeText(value: unknown) {
  return String(value ?? "").trim();
}

function assignmentConflictIsActive(status: unknown) {
  return !ASSIGNMENT_CONFLICT_INACTIVE_STATUSES.has(assignmentConflictSafeText(status).toLowerCase());
}

function assignmentConflictDateOffset(date: string, days: number) {
  const parts = date.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return date.slice(0, 10);
  const shifted = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return shifted.toISOString().slice(0, 10);
}

function assignmentConflictTimeMinutes(value: unknown) {
  const text = assignmentConflictSafeText(value);
  if (!text) return null;

  const twelveHour = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])\.?m\.?$/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (hour === 12) hour = 0;
    if (twelveHour[3].toLowerCase() === "p") hour += 12;
    return hour * 60 + minute;
  }

  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!twentyFourHour) return null;
  const hour = Number(twentyFourHour[1]);
  const minute = Number(twentyFourHour[2]);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return hour * 60 + minute;
}

function assignmentConflictInterval(laborDate: string, startTime: unknown, endTime: unknown) {
  const date = laborDate.slice(0, 10);
  const dateStart = Date.parse(`${date}T00:00:00Z`);
  const startMinutes = assignmentConflictTimeMinutes(startTime);
  const endMinutes = assignmentConflictTimeMinutes(endTime);
  if (!Number.isFinite(dateStart) || startMinutes === null || endMinutes === null) return null;
  const start = dateStart / 60000 + startMinutes;
  let end = dateStart / 60000 + endMinutes;
  if (end <= start) end += 24 * 60;
  return { start, end };
}

export type CrewAssignmentConflictRecord = {
  assignmentId: string;
  subCallId: string;
  showId: string;
  laborDate: string;
  startTime: string;
  endTime: string;
  roleName: string;
  area: string;
};

export async function findCrewAssignmentConflict(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  options: {
    crewId: string;
    targetSubCallId: string;
    targetStartTime?: string | null;
    targetEndTime?: string | null;
    targetLaborDate?: string | null;
    targetStatus?: string | null;
    ignoreAssignmentIds?: string[];
  },
): Promise<CrewAssignmentConflictRecord | null> {
  const crewId = assignmentConflictSafeText(options.crewId);
  const targetSubCallId = assignmentConflictSafeText(options.targetSubCallId);
  if (!crewId || !targetSubCallId || !assignmentConflictIsActive(options.targetStatus ?? "confirmed")) return null;

  const { data: targetCall, error: targetCallError } = await admin
    .from("sub_calls")
    .select("id, labor_day_id, area, role_name, start_time, end_time")
    .eq("id", targetSubCallId)
    .maybeSingle();
  if (targetCallError) throw new Error(targetCallError.message);
  if (!targetCall?.id || !targetCall.labor_day_id) throw new Error("The destination sub-call could not be found.");

  const { data: targetDay, error: targetDayError } = await admin
    .from("labor_days")
    .select("id, show_id, labor_date")
    .eq("id", targetCall.labor_day_id)
    .maybeSingle();
  if (targetDayError) throw new Error(targetDayError.message);
  const targetDate = (assignmentConflictSafeText(options.targetLaborDate) || assignmentConflictSafeText(targetDay?.labor_date)).slice(0, 10);
  if (!targetDay?.id || !targetDate) throw new Error("The destination labor day could not be found.");

  const targetStartTime = assignmentConflictSafeText(options.targetStartTime) || assignmentConflictSafeText(targetCall.start_time);
  const targetEndTime = assignmentConflictSafeText(options.targetEndTime) || assignmentConflictSafeText(targetCall.end_time);
  const targetInterval = assignmentConflictInterval(targetDate, targetStartTime, targetEndTime);

  const candidateDates = [
    assignmentConflictDateOffset(targetDate, -1),
    targetDate,
    assignmentConflictDateOffset(targetDate, 1),
  ];
  const { data: candidateDays, error: candidateDaysError } = await admin
    .from("labor_days")
    .select("id, show_id, labor_date")
    .in("labor_date", candidateDates);
  if (candidateDaysError) throw new Error(candidateDaysError.message);
  const dayRows = (candidateDays || []) as Array<{ id?: string | null; show_id?: string | null; labor_date?: string | null }>;
  const dayIds = [...new Set(dayRows.map((row) => assignmentConflictSafeText(row.id)).filter(Boolean))];
  if (!dayIds.length) return null;

  const { data: candidateCalls, error: candidateCallsError } = await admin
    .from("sub_calls")
    .select("id, labor_day_id, area, role_name, start_time, end_time")
    .in("labor_day_id", dayIds);
  if (candidateCallsError) throw new Error(candidateCallsError.message);
  const callRows = (candidateCalls || []) as Array<{ id?: string | null; labor_day_id?: string | null; area?: string | null; role_name?: string | null; start_time?: string | null; end_time?: string | null }>;
  const candidateCallIds = [...new Set(callRows.map((row) => assignmentConflictSafeText(row.id)).filter(Boolean))];
  if (!candidateCallIds.length) return null;

  const { data: existingAssignments, error: existingAssignmentsError } = await admin
    .from("assignments")
    .select("id, sub_call_id, crew_id, status, start_time, end_time")
    .eq("crew_id", crewId)
    .in("sub_call_id", candidateCallIds);
  if (existingAssignmentsError) throw new Error(existingAssignmentsError.message);

  const ignoredAssignmentIds = new Set((options.ignoreAssignmentIds || []).map(assignmentConflictSafeText).filter(Boolean));
  const callById = new Map(callRows.map((row) => [assignmentConflictSafeText(row.id), row] as const));
  const dayById = new Map(dayRows.map((row) => [assignmentConflictSafeText(row.id), row] as const));

  for (const assignment of (existingAssignments || []) as Array<{ id?: string | null; sub_call_id?: string | null; status?: string | null; start_time?: string | null; end_time?: string | null }>) {
    const assignmentId = assignmentConflictSafeText(assignment.id);
    const existingSubCallId = assignmentConflictSafeText(assignment.sub_call_id);
    if (!assignmentId || ignoredAssignmentIds.has(assignmentId) || existingSubCallId === targetSubCallId || !assignmentConflictIsActive(assignment.status)) continue;

    const call = callById.get(existingSubCallId);
    const day = call ? dayById.get(assignmentConflictSafeText(call.labor_day_id)) : null;
    const laborDate = assignmentConflictSafeText(day?.labor_date).slice(0, 10);
    if (!call || !day || !laborDate) continue;

    const existingStartTime = assignmentConflictSafeText(assignment.start_time) || assignmentConflictSafeText(call.start_time);
    const existingEndTime = assignmentConflictSafeText(assignment.end_time) || assignmentConflictSafeText(call.end_time);
    const existingInterval = assignmentConflictInterval(laborDate, existingStartTime, existingEndTime);
    const overlaps = targetInterval && existingInterval
      ? targetInterval.start < existingInterval.end && existingInterval.start < targetInterval.end
      : laborDate === targetDate;
    if (!overlaps) continue;

    return {
      assignmentId,
      subCallId: existingSubCallId,
      showId: assignmentConflictSafeText(day.show_id),
      laborDate,
      startTime: existingStartTime,
      endTime: existingEndTime,
      roleName: assignmentConflictSafeText(call.role_name),
      area: assignmentConflictSafeText(call.area),
    };
  }

  return null;
}

type SentQueueChecklistRow = {
  show_id: string;
  crew_id: string | null;
  message_type: string | null;
  reminder_key: string | null;
  sent_at: string | null;
};

export async function syncAssignmentChecklistFromSentMessage(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  row: SentQueueChecklistRow | null | undefined,
) {
  if (!row?.show_id || !row.crew_id || communicationChecklistStage({ message_type: row.message_type || "", reminder_key: row.reminder_key || "" }) !== "schedule") return null;

  const sentAt = row.sent_at || new Date().toISOString();
  const { data: existing, error: existingError } = await admin
    .from("assignment_checklists")
    .select("id, show_id, crew_id, schedule_sent, confirmed, week_before_confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, week_before_confirmed_at, day_before_confirmed_at, updated_at")
    .eq("show_id", row.show_id)
    .eq("crew_id", row.crew_id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  if (existing?.id) {
    if (existing.schedule_sent) return existing;
    const { data, error } = await admin
      .from("assignment_checklists")
      .update({
        schedule_sent: true,
        schedule_sent_at: existing.schedule_sent_at || sentAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id, show_id, crew_id, schedule_sent, confirmed, week_before_confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, week_before_confirmed_at, day_before_confirmed_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const { data, error } = await admin
    .from("assignment_checklists")
    .insert({
      show_id: row.show_id,
      crew_id: row.crew_id,
      schedule_sent: true,
      confirmed: false,
      week_before_confirmed: false,
      day_before_confirmed: false,
      schedule_sent_at: sentAt,
      confirmed_at: null,
      week_before_confirmed_at: null,
      day_before_confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .select("id, show_id, crew_id, schedule_sent, confirmed, week_before_confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, week_before_confirmed_at, day_before_confirmed_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data;
}


const SCHEDULE_CHANGE_ACTIVE_QUEUE_STATUSES = ["scheduled", "waiting", "queued", "due_now", "pending", "sending", "sent"];

function scheduleInvalidationMessage(reason?: string | null) {
  const cleanReason = String(reason || "").trim();
  return cleanReason || "Schedule changed after this message was queued or sent. Send an updated schedule.";
}

export async function invalidateShowScheduleStatus(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  showIds: string[] | string,
  options: { reason?: string | null; changedByUserId?: string | null } = {},
) {
  const ids = [...new Set((Array.isArray(showIds) ? showIds : [showIds]).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return { shows: 0, checklistRows: 0, queueRows: 0 };
  const now = new Date().toISOString();
  const reason = scheduleInvalidationMessage(options.reason);

  let checklistRows = 0;
  let queueRows = 0;

  const checklistUpdate = await admin
    .from("assignment_checklists")
    .update({
      schedule_sent: false,
      confirmed: false,
      schedule_sent_at: null,
      confirmed_at: null,
      updated_at: now,
    })
    .in("show_id", ids);
  if (checklistUpdate.error && !/confirmed_at|updated_at|schedule_sent_at/i.test(checklistUpdate.error.message)) {
    throw new Error(checklistUpdate.error.message);
  }
  if (checklistUpdate.error) {
    const fallback = await admin
      .from("assignment_checklists")
      .update({ schedule_sent: false, confirmed: false })
      .in("show_id", ids);
    if (fallback.error) throw new Error(fallback.error.message);
  }

  const queueRes = await admin
    .from("text_message_queue")
    .select("id, message_type, reminder_key, status")
    .in("show_id", ids)
    .in("status", SCHEDULE_CHANGE_ACTIVE_QUEUE_STATUSES)
    .limit(2000);
  if (queueRes.error) throw new Error(queueRes.error.message);

  const queueIds = (queueRes.data || [])
    .filter((row: { id?: string | null; message_type?: string | null; reminder_key?: string | null }) => communicationChecklistStage({
      message_type: row.message_type || "",
      reminder_key: row.reminder_key || "",
    }) === "schedule")
    .map((row: { id?: string | null }) => String(row.id || "").trim())
    .filter(Boolean);

  if (queueIds.length) {
    const queueUpdatePayload = {
      status: "schedule_outdated",
      error: reason,
      schedule_invalidated_at: now,
      schedule_invalidated_by: options.changedByUserId || null,
    };
    let queueUpdate = await admin.from("text_message_queue").update(queueUpdatePayload).in("id", queueIds);
    if (queueUpdate.error && /schedule_invalidated_at|schedule_invalidated_by/i.test(queueUpdate.error.message)) {
      queueUpdate = await admin.from("text_message_queue").update({ status: "schedule_outdated", error: reason }).in("id", queueIds);
    }
    if (queueUpdate.error) throw new Error(queueUpdate.error.message);
    queueRows = queueIds.length;
  }

  return { shows: ids.length, checklistRows, queueRows };
}

const REMOVAL_ACTIVE_QUEUE_STATUSES = ["scheduled", "waiting", "queued", "due_now", "pending"];

function removalSafeText(value: unknown) {
  return String(value ?? "").trim();
}

function removalMissingTable(message: string | null | undefined) {
  const text = removalSafeText(message).toLowerCase();
  return text.includes("event_removed_crew_assignments")
    && (text.includes("does not exist") || text.includes("schema cache"));
}

function removalMissingQueueAuditColumns(message: string | null | undefined) {
  const text = removalSafeText(message).toLowerCase();
  return text.includes("cancelled_at") || text.includes("cancelled_by");
}

function removalFormatShortDate(value: string | null | undefined) {
  const raw = removalSafeText(value).slice(0, 10);
  const [year, month, day] = raw.split("-").map(Number);
  if (!year || !month || !day) return raw;
  return `${month}/${day}/${String(year).slice(2)}`;
}

type RemovedAssignmentSnapshot = {
  assignment_id: string;
  show_id: string;
  crew_id: string;
  crew_name: string;
  phone: string;
  labor_day_id: string;
  sub_call_id: string;
  labor_date: string;
  role: string;
  area: string;
  start_time: string;
  end_time: string;
};

export async function recordRemovedAssignmentsAndCancelQueue(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  options: {
    assignmentIds?: string[];
    subCallIds?: string[];
    laborDayIds?: string[];
    removedByUserId?: string | null;
    removedByName?: string | null;
    reason?: string;
  },
) {
  const directAssignmentIds = (options.assignmentIds || []).map(removalSafeText).filter(Boolean);
  const subCallIds = (options.subCallIds || []).map(removalSafeText).filter(Boolean);
  const laborDayIds = (options.laborDayIds || []).map(removalSafeText).filter(Boolean);

  const derivedSubCallIds = new Set(subCallIds);
  if (laborDayIds.length) {
    const { data: calls } = await admin.from("sub_calls").select("id").in("labor_day_id", laborDayIds);
    (calls || []).forEach((row: { id?: string | null }) => {
      if (row.id) derivedSubCallIds.add(row.id);
    });
  }

  let assignmentRows: Array<{ id: string; sub_call_id: string | null; crew_id: string | null; start_time?: string | null; end_time?: string | null }> = [];
  if (directAssignmentIds.length) {
    const { data } = await admin
      .from("assignments")
      .select("id, sub_call_id, crew_id, start_time, end_time")
      .in("id", directAssignmentIds);
    assignmentRows = [...assignmentRows, ...((data || []) as typeof assignmentRows)];
  }
  if (derivedSubCallIds.size) {
    const { data } = await admin
      .from("assignments")
      .select("id, sub_call_id, crew_id, start_time, end_time")
      .in("sub_call_id", Array.from(derivedSubCallIds));
    assignmentRows = [...assignmentRows, ...((data || []) as typeof assignmentRows)];
  }

  const uniqueAssignments = new Map<string, typeof assignmentRows[number]>();
  assignmentRows.forEach((row) => {
    if (row.id) uniqueAssignments.set(row.id, row);
  });
  assignmentRows = Array.from(uniqueAssignments.values());
  if (!assignmentRows.length) return { removed: 0, cancelled: 0, noticesAvailable: true };

  const callIds = [...new Set(assignmentRows.map((row) => removalSafeText(row.sub_call_id)).filter(Boolean))];
  const { data: callData } = callIds.length
    ? await admin.from("sub_calls").select("id, labor_day_id, area, role_name, start_time, end_time").in("id", callIds)
    : { data: [] as unknown[] };
  const callById = new Map((callData || []).map((row: any) => [removalSafeText(row.id), row]));

  const dayIds = [...new Set((callData || []).map((row: any) => removalSafeText(row.labor_day_id)).filter(Boolean))];
  const { data: dayData } = dayIds.length
    ? await admin.from("labor_days").select("id, show_id, labor_date").in("id", dayIds)
    : { data: [] as unknown[] };
  const dayById = new Map((dayData || []).map((row: any) => [removalSafeText(row.id), row]));

  const crewIds = [...new Set(assignmentRows.map((row) => removalSafeText(row.crew_id)).filter(Boolean))];
  const { data: crewData } = crewIds.length
    ? await admin.from("crew").select("id, name, phone").in("id", crewIds)
    : { data: [] as unknown[] };
  const crewById = new Map((crewData || []).map((row: any) => [removalSafeText(row.id), row]));

  const snapshots: RemovedAssignmentSnapshot[] = assignmentRows.map((assignment) => {
    const call = callById.get(removalSafeText(assignment.sub_call_id)) || {};
    const day = dayById.get(removalSafeText(call.labor_day_id)) || {};
    const crew = crewById.get(removalSafeText(assignment.crew_id)) || {};
    return {
      assignment_id: removalSafeText(assignment.id),
      show_id: removalSafeText(day.show_id),
      crew_id: removalSafeText(assignment.crew_id),
      crew_name: removalSafeText(crew.name) || "Crew member",
      phone: removalSafeText(crew.phone),
      labor_day_id: removalSafeText(call.labor_day_id),
      sub_call_id: removalSafeText(assignment.sub_call_id),
      labor_date: removalSafeText(day.labor_date).slice(0, 10),
      role: removalSafeText(call.role_name),
      area: removalSafeText(call.area),
      start_time: removalSafeText(assignment.start_time) || removalSafeText(call.start_time),
      end_time: removalSafeText(assignment.end_time) || removalSafeText(call.end_time),
    };
  }).filter((row) => row.show_id && row.crew_id);

  let noticesAvailable = true;
  if (snapshots.length) {
    const noticeRows = snapshots.map((row) => ({
      event_id: row.show_id,
      crew_contact_id: row.crew_id,
      crew_name: row.crew_name,
      phone: row.phone,
      event_day_id: row.labor_day_id,
      sub_call_id: row.sub_call_id,
      assignment_id: row.assignment_id,
      labor_date: row.labor_date || null,
      role: row.role || null,
      area: row.area || null,
      start_time: row.start_time || null,
      end_time: row.end_time || null,
      removed_by: options.removedByUserId || null,
      removed_by_name: options.removedByName || null,
      removal_reason: options.reason || "Crew removed from assignment.",
      cancellation_notice_status: "pending",
    }));
    const inserted = await admin.from("event_removed_crew_assignments").insert(noticeRows);
    if (inserted.error) {
      if (removalMissingTable(inserted.error.message)) noticesAvailable = false;
      else throw new Error(inserted.error.message);
    }
  }

  let cancelled = 0;
  const byShowCrew = new Map<string, RemovedAssignmentSnapshot[]>();
  snapshots.forEach((row) => byShowCrew.set(`${row.show_id}:${row.crew_id}`, [...(byShowCrew.get(`${row.show_id}:${row.crew_id}`) || []), row]));
  for (const [key, rows] of byShowCrew.entries()) {
    const [showId, crewId] = key.split(":");
    const dates = new Set(rows.map((row) => row.labor_date).filter(Boolean));
    const dateNeedles = new Set<string>();
    dates.forEach((date) => {
      dateNeedles.add(date);
      dateNeedles.add(removalFormatShortDate(date));
    });
    const { data: queueRows, error: queueError } = await admin
      .from("text_message_queue")
      .select("id, reminder_key, message_type, body")
      .eq("show_id", showId)
      .eq("crew_id", crewId)
      .in("status", REMOVAL_ACTIVE_QUEUE_STATUSES)
      .limit(500);
    if (queueError) throw new Error(queueError.message);
    const idsToCancel = (queueRows || [])
      .filter((row: any) => {
        const reminderKey = removalSafeText(row.reminder_key).toLowerCase();
        const messageType = removalSafeText(row.message_type).toLowerCase();
        const body = removalSafeText(row.body);
        if (messageType === "schedule" || reminderKey.includes("full_show_schedule")) return true;
        return Array.from(dateNeedles).some((needle) => needle && (reminderKey.includes(needle.toLowerCase()) || body.includes(needle)));
      })
      .map((row: any) => removalSafeText(row.id))
      .filter(Boolean);
    if (!idsToCancel.length) continue;
    const cancelPayload = {
      status: "cancelled",
      sent_at: null,
      error: `Auto-cancelled because this assignment was removed. ${options.reason || ""}`.trim(),
      cancelled_at: new Date().toISOString(),
      cancelled_by: options.removedByUserId || null,
    };
    let result = await admin.from("text_message_queue").update(cancelPayload).in("id", idsToCancel).in("status", REMOVAL_ACTIVE_QUEUE_STATUSES);
    if (result.error && removalMissingQueueAuditColumns(result.error.message)) {
      result = await admin.from("text_message_queue").update({ status: "cancelled", sent_at: null, error: cancelPayload.error }).in("id", idsToCancel).in("status", REMOVAL_ACTIVE_QUEUE_STATUSES);
    }
    if (result.error) throw new Error(result.error.message);
    cancelled += idsToCancel.length;
  }

  return { removed: snapshots.length, cancelled, noticesAvailable };
}
