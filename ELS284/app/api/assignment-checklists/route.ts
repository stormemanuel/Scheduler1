import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

const checklistFields = new Set(["schedule_sent", "confirmed", "day_before_confirmed"]);
const showProcessFields = new Set(["event_built", "quote_sent", "approval_received", "show_booked", "crew_list_sent"]);

type ChecklistField = "schedule_sent" | "confirmed" | "day_before_confirmed";
type ShowProcessField = "event_built" | "quote_sent" | "approval_received" | "show_booked" | "crew_list_sent";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
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
    .select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at");
  if (showId) query = query.eq("show_id", showId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json();

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
      day_before_confirmed: field === "day_before_confirmed" ? checked : false,
      schedule_sent_at: field === "schedule_sent" && checked ? now : null,
      confirmed_at: field === "confirmed" && checked ? now : null,
      day_before_confirmed_at: field === "day_before_confirmed" && checked ? now : null,
      updated_at: now,
    }));

  if (insertRows.length) {
    const { error } = await admin.from("assignment_checklists").insert(insertRows);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const { data, error } = await admin
    .from("assignment_checklists")
    .select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at")
    .eq("show_id", showId)
    .in("crew_id", crewIds);

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data?.[0] ?? null, rows: data ?? [], message: checked ? "Checklist updated." : "Checklist unchecked." });
}
