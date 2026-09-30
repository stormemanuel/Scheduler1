import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient, findCrewAssignmentConflict, recordRemovedAssignmentsAndCancelQueue } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

async function canEditEventDetails(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = String((profile as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  if (role === "owner" || role === "admin") return true;

  const { data: access, error } = await admin
    .from("user_access_settings")
    .select("can_edit_event_details")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean((access as { can_edit_event_details?: boolean | null } | null)?.can_edit_event_details);
}


async function canDeleteEventDetails(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = String((data as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  return role === "owner" || role === "admin";
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can change event days or sub-calls." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const body = await request.json();
  const payload = {
    labor_date: String(body.labor_date || '').trim(),
    label: String(body.label || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
  };
  const { data: dayCalls, error: dayCallsError } = await admin
    .from("sub_calls")
    .select("id, start_time, end_time")
    .eq("labor_day_id", id);
  if (dayCallsError) return NextResponse.json({ message: dayCallsError.message }, { status: 400 });
  const callRows = (dayCalls || []) as Array<{ id?: string | null; start_time?: string | null; end_time?: string | null }>;
  const callIds = callRows.map((row) => String(row.id || "").trim()).filter(Boolean);
  if (callIds.length && payload.labor_date) {
    const callById = new Map(callRows.map((row) => [String(row.id || "").trim(), row] as const));
    const { data: dayAssignments, error: dayAssignmentsError } = await admin
      .from("assignments")
      .select("id, sub_call_id, crew_id, status, start_time, end_time")
      .in("sub_call_id", callIds);
    if (dayAssignmentsError) return NextResponse.json({ message: dayAssignmentsError.message }, { status: 400 });
    for (const assignment of (dayAssignments || []) as Array<{ id?: string | null; sub_call_id?: string | null; crew_id?: string | null; status?: string | null; start_time?: string | null; end_time?: string | null }>) {
      const assignmentId = String(assignment.id || "").trim();
      const subCallId = String(assignment.sub_call_id || "").trim();
      const crewId = String(assignment.crew_id || "").trim();
      const call = callById.get(subCallId);
      if (!assignmentId || !subCallId || !crewId || !call) continue;
      try {
        const conflict = await findCrewAssignmentConflict(admin, {
          crewId,
          targetSubCallId: subCallId,
          targetLaborDate: payload.labor_date,
          targetStartTime: String(assignment.start_time || "").trim() || String(call.start_time || "").trim(),
          targetEndTime: String(assignment.end_time || "").trim() || String(call.end_time || "").trim(),
          targetStatus: assignment.status || "confirmed",
          ignoreAssignmentIds: [assignmentId],
        });
        if (conflict) {
          return NextResponse.json({
            message: `Moving this labor day to ${payload.labor_date} would double-book an assigned crew member with another call (${conflict.startTime || "TBD"}–${conflict.endTime || "TBD"}). Move the crew assignment or choose another date first.`,
            code: "CREW_TIME_CONFLICT",
          }, { status: 409 });
        }
      } catch (conflictError) {
        return NextResponse.json({ message: conflictError instanceof Error ? conflictError.message : "Could not verify crew booking conflicts." }, { status: 400 });
      }
    }
  }

  const { error } = await admin.from('labor_days').update(payload).eq('id', id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: 'Labor day updated.' });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canDeleteEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users can delete labor days. Coordinators can view and help fill events, but they cannot delete event details." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const cancellation = await recordRemovedAssignmentsAndCancelQueue(admin, {
    laborDayIds: [id],
    removedByUserId: auth.user.id,
    removedByName: auth.user.email || "ELS user",
    reason: "Labor day deleted.",
  });
  const { error } = await admin.from('labor_days').delete().eq('id', id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, cancellation, message: 'Labor day deleted.' });
}
