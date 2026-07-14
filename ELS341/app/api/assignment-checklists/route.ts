import { NextResponse } from "next/server";
import { getSessionUser, normalizeRole } from "@/lib/auth";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

const checklistFields = new Set(["schedule_sent", "confirmed", "week_before_confirmed", "day_before_confirmed"]);
const showProcessFields = new Set(["event_built", "quote_sent", "approval_received", "show_booked", "crew_list_sent"]);

type ChecklistField = "schedule_sent" | "confirmed" | "week_before_confirmed" | "day_before_confirmed";
type ShowProcessField = "event_built" | "quote_sent" | "approval_received" | "show_booked" | "crew_list_sent";

const coordinatorChecklistItems = [
  ["event_received", "Event received and reviewed", 10],
  ["staffing_completed", "Initial event staffing completed", 20],
  ["onboarding_sent", "Required onboarding requests sent", 30],
  ["schedules_sent", "Crew schedules sent", 40],
  ["week_before_reminders", "Week-before reminders completed", 50],
  ["day_before_reminders", "Day-before reminders completed", 60],
  ["daily_attendance", "Daily attendance verified", 70],
  ["incidents_reported", "Attendance incidents and replacements reported", 80],
  ["invoice_instructions", "Invoice submission instructions sent to crew", 90],
  ["event_closeout", "Coordinator event responsibilities completed", 100],
] as const;

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function isChecklistMissing(error: { message?: string } | null | undefined) {
  return /event_coordinator_|schema cache|does not exist|Could not find the table|relation/i.test(String(error?.message || ""));
}

function clean(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

async function authWithRole() {
  const session = await getSessionUser();
  if (!session.user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, response: NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 }) };
  const role = normalizeRole(session.profile?.role);
  return { ok: true as const, user: session.user, admin, role, profile: session.profile };
}

function isOwnerAdminRole(role: string) {
  return role === "owner" || role === "admin";
}

async function coordinatorIdsForShow(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string) {
  const ids = new Set<string>();
  const { data: show, error: showError } = await admin.from("shows").select("assigned_coordinator_user_id").eq("id", showId).maybeSingle();
  if (showError) throw new Error(showError.message);
  const showCoordinator = clean((show as { assigned_coordinator_user_id?: string | null } | null)?.assigned_coordinator_user_id);
  if (showCoordinator) ids.add(showCoordinator);

  const { data: days, error: dayError } = await admin.from("labor_days").select("id").eq("show_id", showId);
  if (dayError) throw new Error(dayError.message);
  const dayIds = (days ?? []).map((row) => clean((row as { id?: string }).id)).filter(Boolean);
  if (dayIds.length) {
    const { data: calls, error: callError } = await admin.from("sub_calls").select("assigned_coordinator_user_id").in("labor_day_id", dayIds);
    if (callError) throw new Error(callError.message);
    for (const call of calls ?? []) {
      const id = clean((call as { assigned_coordinator_user_id?: string | null }).assigned_coordinator_user_id);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

async function ensureCoordinatorChecklist(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string, coordinatorUserId: string) {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await admin
    .from("event_coordinator_checklists")
    .select("id")
    .eq("event_id", showId)
    .eq("coordinator_user_id", coordinatorUserId)
    .maybeSingle();
  if (existingError && isChecklistMissing(existingError)) throw existingError;
  if (existingError) throw new Error(existingError.message);

  let checklistId = clean((existing as { id?: string } | null)?.id);
  if (!checklistId) {
    const { data: inserted, error: insertError } = await admin
      .from("event_coordinator_checklists")
      .insert({
        event_id: showId,
        coordinator_user_id: coordinatorUserId,
        status: "not_started",
        assigned_at: now,
        staffing_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        last_updated_at: now,
      })
      .select("id")
      .single();
    if (insertError) throw insertError;
    checklistId = clean((inserted as { id?: string } | null)?.id);
  }

  const { data: itemRows, error: itemError } = await admin.from("event_coordinator_checklist_items").select("item_key").eq("checklist_id", checklistId);
  if (itemError) throw itemError;
  const existingKeys = new Set((itemRows ?? []).map((row) => clean((row as { item_key?: string }).item_key)));
  const missingItems = coordinatorChecklistItems
    .filter(([key]) => !existingKeys.has(key))
    .map(([item_key, item_label, sort_order]) => ({ checklist_id: checklistId, item_key, item_label, sort_order, is_required: true, is_complete: false }));
  if (missingItems.length) {
    const { error } = await admin.from("event_coordinator_checklist_items").insert(missingItems);
    if (error) throw error;
  }

  const { data: days, error: dayError } = await admin.from("labor_days").select("id, labor_date").eq("show_id", showId).order("labor_date", { ascending: true });
  if (dayError) throw dayError;
  const { data: dailyRows, error: dailyError } = await admin.from("event_coordinator_daily_checks").select("event_day_id").eq("checklist_id", checklistId);
  if (dailyError) throw dailyError;
  const existingDayIds = new Set((dailyRows ?? []).map((row) => clean((row as { event_day_id?: string }).event_day_id)));
  const missingDays = (days ?? [])
    .filter((day) => !existingDayIds.has(clean((day as { id?: string }).id)))
    .map((day) => ({ checklist_id: checklistId, event_day_id: clean((day as { id?: string }).id), work_date: clean((day as { labor_date?: string }).labor_date) }));
  if (missingDays.length) {
    const { error } = await admin.from("event_coordinator_daily_checks").insert(missingDays);
    if (error) throw error;
  }

  return checklistId;
}

async function coordinatorChecklistPayload(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string, coordinatorIds: string[]) {
  if (!coordinatorIds.length) return { checklists: [], items: [], dailyChecks: [], incidents: [], users: [] };
  for (const coordinatorId of coordinatorIds) await ensureCoordinatorChecklist(admin, showId, coordinatorId);

  const { data: checklists, error: checklistError } = await admin
    .from("event_coordinator_checklists")
    .select("id, event_id, coordinator_user_id, status, assigned_at, staffing_deadline, completed_at, completed_by, last_updated_at, admin_note, created_at, updated_at")
    .eq("event_id", showId)
    .in("coordinator_user_id", coordinatorIds);
  if (checklistError) throw checklistError;

  const checklistIds = (checklists ?? []).map((row) => clean((row as { id?: string }).id)).filter(Boolean);
  if (!checklistIds.length) return { checklists: [], items: [], dailyChecks: [], incidents: [], users: [] };

  const [itemsRes, dailyRes, incidentsRes, usersRes] = await Promise.all([
    admin.from("event_coordinator_checklist_items").select("id, checklist_id, item_key, item_label, is_required, is_complete, completed_at, completed_by, coordinator_note, admin_note, sort_order, created_at, updated_at").in("checklist_id", checklistIds).order("sort_order", { ascending: true }),
    admin.from("event_coordinator_daily_checks").select("id, checklist_id, event_day_id, work_date, scheduled_count, signed_in_count, signed_out_count, missing_count, replacement_needed, replacement_assigned, is_complete, completed_at, completed_by, coordinator_note, created_at, updated_at").in("checklist_id", checklistIds).order("work_date", { ascending: true }),
    admin.from("event_coordinator_incidents").select("id, event_id, checklist_id, event_day_id, crew_contact_id, incident_type, scheduled_call_time, actual_arrival_time, replacement_contact_id, replacement_arrival_time, notes, reported_at, reported_by, created_at, updated_at").in("checklist_id", checklistIds).order("created_at", { ascending: false }),
    admin.from("profiles").select("id, full_name, email, role").in("id", coordinatorIds),
  ]);
  const error = itemsRes.error || dailyRes.error || incidentsRes.error || usersRes.error;
  if (error) throw error;
  return { checklists: checklists ?? [], items: itemsRes.data ?? [], dailyChecks: dailyRes.data ?? [], incidents: incidentsRes.data ?? [], users: usersRes.data ?? [] };
}

async function requireAdmin() {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth;
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, response: NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 }) };

  const { data: profile, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error) return { ok: false as const, response: NextResponse.json({ message: error.message }, { status: 400 }) };
  const role = String(profile?.role || "").trim().toLowerCase();
  if (!["owner", "admin"].includes(role)) {
    return { ok: false as const, response: NextResponse.json({ message: "This show checklist is available to ELS admins only." }, { status: 403 }) };
  }

  return { ok: true as const, user: auth.user, admin };
}

function timestampField(field: ChecklistField) {
  if (field === "schedule_sent") return "schedule_sent_at";
  if (field === "confirmed") return "confirmed_at";
  if (field === "week_before_confirmed") return "week_before_confirmed_at";
  return "day_before_confirmed_at";
}

async function currentShowCounts(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string) {
  const { data: dayRows, error: dayError } = await admin
    .from("labor_days")
    .select("id")
    .eq("show_id", showId);
  if (dayError) throw new Error(dayError.message);

  const dayIds = (dayRows ?? []).map((row) => String(row.id));
  if (!dayIds.length) return { subCallCount: 0, assignmentCount: 0 };

  const { data: callRows, error: callError } = await admin
    .from("sub_calls")
    .select("id")
    .in("labor_day_id", dayIds);
  if (callError) throw new Error(callError.message);

  const callIds = (callRows ?? []).map((row) => String(row.id));
  if (!callIds.length) return { subCallCount: 0, assignmentCount: 0 };

  const { count: assignmentCount, error: assignmentError } = await admin
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .in("sub_call_id", callIds);
  if (assignmentError) throw new Error(assignmentError.message);

  return { subCallCount: callIds.length, assignmentCount: assignmentCount ?? 0 };
}

async function getShowProcessRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId?: string | null) {
  let query = admin
    .from("show_process_checklists")
    .select("id, show_id, cycle_number, reason, addition_sub_call_count, addition_assignment_count, event_built, quote_sent, approval_received, show_booked, crew_list_sent, completed, completed_at, completed_sub_call_count, completed_assignment_count, created_at, updated_at")
    .order("show_id", { ascending: true })
    .order("cycle_number", { ascending: true });
  if (showId) query = query.eq("show_id", showId);
  return query;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const scope = url.searchParams.get("scope");

  if (scope === "coordinator_process") {
    const auth = await authWithRole();
    if (!auth.ok) return auth.response;
    const showId = clean(url.searchParams.get("show_id"));
    if (!showId) return NextResponse.json({ message: "Event is required." }, { status: 400 });
    try {
      const assignedIds = await coordinatorIdsForShow(auth.admin, showId);
      const coordinatorIds = isOwnerAdminRole(auth.role) ? assignedIds : assignedIds.filter((id) => id === auth.user.id);
      if (!isOwnerAdminRole(auth.role) && !coordinatorIds.length) {
        return NextResponse.json({ message: "This coordinator checklist is only available for assigned coordinators." }, { status: 403 });
      }
      const payload = await coordinatorChecklistPayload(auth.admin, showId, coordinatorIds);
      return NextResponse.json({ ok: true, ...payload });
    } catch (error) {
      if (isChecklistMissing(error as { message?: string })) {
        return NextResponse.json({ message: "Run the coordinator event checklist SQL to enable coordinator checklist saving." }, { status: 400 });
      }
      return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to load coordinator checklist." }, { status: 400 });
    }
  }

  if (scope === "show_process") {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const showId = url.searchParams.get("show_id");
    const { data, error } = await getShowProcessRows(auth.admin, showId);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, rows: data ?? [] });
  }

  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });

  const showId = url.searchParams.get("show_id");
  let query = supabase
    .from("assignment_checklists")
    .select("id, show_id, crew_id, schedule_sent, confirmed, week_before_confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, week_before_confirmed_at, day_before_confirmed_at, updated_at");
  if (showId) query = query.eq("show_id", showId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json();

  if (String(body.scope || "") === "coordinator_process") {
    const auth = await authWithRole();
    if (!auth.ok) return auth.response;
    const showId = clean(body.show_id);
    const checklistId = clean(body.checklist_id);
    const action = clean(body.action);
    if (!showId || !checklistId) return NextResponse.json({ message: "Event and coordinator checklist are required." }, { status: 400 });

    try {
      const assignedIds = await coordinatorIdsForShow(auth.admin, showId);
      const { data: checklist, error: checklistError } = await auth.admin
        .from("event_coordinator_checklists")
        .select("id, event_id, coordinator_user_id")
        .eq("id", checklistId)
        .eq("event_id", showId)
        .maybeSingle();
      if (checklistError) throw checklistError;
      const coordinatorUserId = clean((checklist as { coordinator_user_id?: string | null } | null)?.coordinator_user_id);
      if (!checklist || !assignedIds.includes(coordinatorUserId)) return NextResponse.json({ message: "Coordinator checklist is not assigned to this event." }, { status: 403 });
      if (!isOwnerAdminRole(auth.role) && coordinatorUserId !== auth.user.id) {
        return NextResponse.json({ message: "You can only update your own coordinator checklist." }, { status: 403 });
      }

      const now = new Date().toISOString();

      if (action === "update_item") {
        const itemId = clean(body.item_id);
        const checked = Boolean(body.checked);
        const coordinatorNote = body.coordinator_note === undefined ? undefined : clean(body.coordinator_note);
        const adminNote = body.admin_note === undefined ? undefined : clean(body.admin_note);
        if (!itemId) return NextResponse.json({ message: "Checklist item is required." }, { status: 400 });
        const updatePayload: Record<string, unknown> = {
          ...(body.checked === undefined ? {} : { is_complete: checked, completed_at: checked ? now : null, completed_by: checked ? auth.user.id : null }),
          ...(coordinatorNote === undefined ? {} : { coordinator_note: coordinatorNote }),
          ...(adminNote === undefined || !isOwnerAdminRole(auth.role) ? {} : { admin_note: adminNote }),
          updated_at: now,
        };
        const { error } = await auth.admin.from("event_coordinator_checklist_items").update(updatePayload).eq("id", itemId).eq("checklist_id", checklistId);
        if (error) throw error;
        await auth.admin.from("event_coordinator_checklist_audit_log").insert({
          checklist_id: checklistId,
          checklist_item_id: itemId,
          action: checked ? "item_checked" : "item_unchecked",
          new_value: checked ? "true" : "false",
          changed_by: auth.user.id,
          changed_at: now,
        }).then(() => null);
      } else if (action === "update_daily") {
        const dailyId = clean(body.daily_id);
        if (!dailyId) return NextResponse.json({ message: "Daily attendance row is required." }, { status: 400 });
        const checked = Boolean(body.checked);
        const { error } = await auth.admin
          .from("event_coordinator_daily_checks")
          .update({
            scheduled_count: Number(body.scheduled_count || 0),
            signed_in_count: Number(body.signed_in_count || 0),
            signed_out_count: Number(body.signed_out_count || 0),
            missing_count: Number(body.missing_count || 0),
            replacement_needed: Boolean(body.replacement_needed),
            replacement_assigned: Boolean(body.replacement_assigned),
            coordinator_note: clean(body.coordinator_note),
            is_complete: checked,
            completed_at: checked ? now : null,
            completed_by: checked ? auth.user.id : null,
            updated_at: now,
          })
          .eq("id", dailyId)
          .eq("checklist_id", checklistId);
        if (error) throw error;
      } else if (action === "admin_note") {
        if (!isOwnerAdminRole(auth.role)) return NextResponse.json({ message: "Only an admin can save this note." }, { status: 403 });
        const { error } = await auth.admin
          .from("event_coordinator_checklists")
          .update({ admin_note: clean(body.admin_note), last_updated_at: now, updated_at: now })
          .eq("id", checklistId);
        if (error) throw error;
      } else if (action === "add_incident") {
        const { error } = await auth.admin.from("event_coordinator_incidents").insert({
          event_id: showId,
          checklist_id: checklistId,
          event_day_id: clean(body.event_day_id) || null,
          crew_contact_id: clean(body.crew_contact_id) || null,
          incident_type: clean(body.incident_type, "Other"),
          scheduled_call_time: clean(body.scheduled_call_time) || null,
          actual_arrival_time: clean(body.actual_arrival_time) || null,
          replacement_contact_id: clean(body.replacement_contact_id) || null,
          replacement_arrival_time: clean(body.replacement_arrival_time) || null,
          notes: clean(body.notes),
          reported_at: now,
          reported_by: auth.user.id,
        });
        if (error) throw error;
      } else if (action === "closeout") {
        const { data: items, error: itemsError } = await auth.admin.from("event_coordinator_checklist_items").select("item_key, is_complete").eq("checklist_id", checklistId);
        if (itemsError) throw itemsError;
        const incomplete = (items ?? []).filter((item) => clean((item as { item_key?: string }).item_key) !== "event_closeout" && !(item as { is_complete?: boolean }).is_complete);
        if (incomplete.length) return NextResponse.json({ message: "Complete all required checklist items before closing the coordinator process." }, { status: 409 });
        const { error: closeError } = await auth.admin.from("event_coordinator_checklists").update({ status: "complete", completed_at: now, completed_by: auth.user.id, last_updated_at: now, updated_at: now }).eq("id", checklistId);
        if (closeError) throw closeError;
        const { error: itemError } = await auth.admin.from("event_coordinator_checklist_items").update({ is_complete: true, completed_at: now, completed_by: auth.user.id, updated_at: now }).eq("checklist_id", checklistId).eq("item_key", "event_closeout");
        if (itemError) throw itemError;
      } else if (action === "reopen") {
        if (!isOwnerAdminRole(auth.role)) return NextResponse.json({ message: "Only an admin can reopen coordinator checklist closeout." }, { status: 403 });
        const { error } = await auth.admin.from("event_coordinator_checklists").update({ status: "reopened", completed_at: null, completed_by: null, last_updated_at: now, updated_at: now }).eq("id", checklistId);
        if (error) throw error;
      } else {
        return NextResponse.json({ message: "Invalid coordinator checklist action." }, { status: 400 });
      }

      const next = await coordinatorChecklistPayload(auth.admin, showId, isOwnerAdminRole(auth.role) ? assignedIds : [auth.user.id]);
      return NextResponse.json({ ok: true, ...next, message: "Checklist updated." });
    } catch (error) {
      if (isChecklistMissing(error as { message?: string })) {
        return NextResponse.json({ message: "Run the coordinator event checklist SQL to enable coordinator checklist saving." }, { status: 400 });
      }
      return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to update coordinator checklist." }, { status: 400 });
    }
  }

  if (String(body.scope || "") === "show_process") {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const showId = String(body.show_id || "").trim();
    const cycleId = String(body.cycle_id || "").trim();
    const action = String(body.action || "").trim();
    const field = String(body.field || "").trim() as ShowProcessField;
    const checked = Boolean(body.checked);

    if (!showId || !cycleId) return NextResponse.json({ message: "Show and checklist cycle are required." }, { status: 400 });
    if (action !== "complete_all" && !showProcessFields.has(field)) return NextResponse.json({ message: "Invalid show checklist field." }, { status: 400 });

    const { data: latest, error: latestError } = await auth.admin
      .from("show_process_checklists")
      .select("id, cycle_number, completed")
      .eq("show_id", showId)
      .order("cycle_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) return NextResponse.json({ message: latestError.message }, { status: 400 });
    if (!latest || latest.id !== cycleId) return NextResponse.json({ message: "Only the newest show checklist can be updated." }, { status: 409 });
    if (latest.completed) return NextResponse.json({ message: "This checklist is complete and locked. New additions will automatically open the next checklist." }, { status: 409 });

    const now = new Date().toISOString();

    if (action === "complete_all") {
      try {
        const counts = await currentShowCounts(auth.admin, showId);
        const { data: completedRow, error: completedError } = await auth.admin
          .from("show_process_checklists")
          .update({
            event_built: true,
            quote_sent: true,
            approval_received: true,
            show_booked: true,
            crew_list_sent: true,
            completed: true,
            completed_at: now,
            completed_sub_call_count: counts.subCallCount,
            completed_assignment_count: counts.assignmentCount,
            updated_at: now,
          })
          .eq("id", cycleId)
          .select("id, show_id, cycle_number, reason, addition_sub_call_count, addition_assignment_count, event_built, quote_sent, approval_received, show_booked, crew_list_sent, completed, completed_at, completed_sub_call_count, completed_assignment_count, created_at, updated_at")
          .single();
        if (completedError) return NextResponse.json({ message: completedError.message }, { status: 400 });
        return NextResponse.json({ ok: true, row: completedRow, message: "Show checklist marked complete." });
      } catch (error) {
        return NextResponse.json({ message: error instanceof Error ? error.message : "Could not complete the show checklist." }, { status: 400 });
      }
    }

    const { data: updated, error: updateError } = await auth.admin
      .from("show_process_checklists")
      .update({ [field]: checked, updated_at: now })
      .eq("id", cycleId)
      .select("id, show_id, cycle_number, reason, addition_sub_call_count, addition_assignment_count, event_built, quote_sent, approval_received, show_booked, crew_list_sent, completed, completed_at, completed_sub_call_count, completed_assignment_count, created_at, updated_at")
      .single();
    if (updateError) return NextResponse.json({ message: updateError.message }, { status: 400 });

    const isComplete = Boolean(updated.event_built && updated.quote_sent && updated.approval_received && updated.show_booked && updated.crew_list_sent);
    let finalRow = updated;

    if (isComplete) {
      try {
        const counts = await currentShowCounts(auth.admin, showId);
        const { data: completedRow, error: completedError } = await auth.admin
          .from("show_process_checklists")
          .update({
            completed: true,
            completed_at: now,
            completed_sub_call_count: counts.subCallCount,
            completed_assignment_count: counts.assignmentCount,
            updated_at: now,
          })
          .eq("id", cycleId)
          .select("id, show_id, cycle_number, reason, addition_sub_call_count, addition_assignment_count, event_built, quote_sent, approval_received, show_booked, crew_list_sent, completed, completed_at, completed_sub_call_count, completed_assignment_count, created_at, updated_at")
          .single();
        if (completedError) return NextResponse.json({ message: completedError.message }, { status: 400 });
        finalRow = completedRow;
      } catch (error) {
        return NextResponse.json({ message: error instanceof Error ? error.message : "Could not complete the show checklist." }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true, row: finalRow, message: isComplete ? "Show checklist complete." : "Show checklist updated." });
  }

  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const showId = String(body.show_id || "").trim();
  const singleCrewId = String(body.crew_id || "").trim();
  const crewIds: string[] = Array.isArray(body.crew_ids)
    ? body.crew_ids.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : singleCrewId ? [singleCrewId] : [];
  const field = String(body.field || "").trim() as ChecklistField;
  const checked = Boolean(body.checked);

  if (!showId || !crewIds.length) {
    return NextResponse.json({ message: "Show and crew are required." }, { status: 400 });
  }
  if (!checklistFields.has(field)) {
    return NextResponse.json({ message: "Invalid checklist field." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const checkedAtField = timestampField(field);
  const updatePayload = {
    [field]: checked,
    [checkedAtField]: checked ? now : null,
    updated_at: now,
  };

  const existingRes = await admin
    .from("assignment_checklists")
    .select("id, crew_id")
    .eq("show_id", showId)
    .in("crew_id", crewIds);

  if (existingRes.error) return NextResponse.json({ message: existingRes.error.message }, { status: 400 });

  const existing = (existingRes.data ?? []) as Array<{ id: string; crew_id: string }>;
  const existingCrewIds = new Set(existing.map((row) => row.crew_id));

  for (const row of existing) {
    const { error } = await admin.from("assignment_checklists").update(updatePayload).eq("id", row.id);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const insertRows = crewIds
    .filter((crewId) => !existingCrewIds.has(crewId))
    .map((crewId) => ({
      show_id: showId,
      crew_id: crewId,
      schedule_sent: field === "schedule_sent" ? checked : false,
      confirmed: field === "confirmed" ? checked : false,
      week_before_confirmed: field === "week_before_confirmed" ? checked : false,
      day_before_confirmed: field === "day_before_confirmed" ? checked : false,
      schedule_sent_at: field === "schedule_sent" && checked ? now : null,
      confirmed_at: field === "confirmed" && checked ? now : null,
      week_before_confirmed_at: field === "week_before_confirmed" && checked ? now : null,
      day_before_confirmed_at: field === "day_before_confirmed" && checked ? now : null,
      updated_at: now,
    }));

  if (insertRows.length) {
    const { error } = await admin.from("assignment_checklists").insert(insertRows);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const { data, error } = await admin
    .from("assignment_checklists")
    .select("id, show_id, crew_id, schedule_sent, confirmed, week_before_confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, week_before_confirmed_at, day_before_confirmed_at, updated_at")
    .eq("show_id", showId)
    .in("crew_id", crewIds);

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data?.[0] ?? null, rows: data ?? [], message: checked ? "Checklist updated." : "Checklist unchecked." });
}
