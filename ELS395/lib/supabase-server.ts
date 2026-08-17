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
