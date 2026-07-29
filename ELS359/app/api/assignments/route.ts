import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { normalizeRole } from "@/lib/auth";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function missingAssignmentColumns(error: { message?: string } | null) {
  return Boolean(
    error?.message?.includes("sort_order") ||
    error?.message?.includes("start_time") ||
    error?.message?.includes("end_time") ||
    error?.message?.includes("day_type") ||
    error?.message?.includes("coordination_owner") ||
    error?.message?.includes("coordination_fee_waived")
  );
}

async function isOwnerAdmin(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string) {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = normalizeRole((data as { role?: string | null } | null)?.role);
  return role === "owner" || role === "admin";
}

async function subCallAccess(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string, subCallId: string) {
  const ownerAdmin = await isOwnerAdmin(admin, userId);
  if (ownerAdmin) return { allowed: true, ownerAdmin: true, coordinatorOwnsCall: false, coordinatorName: "" };

  const { data: call, error: callError } = await admin
    .from("sub_calls")
    .select("labor_day_id, assigned_coordinator_user_id")
    .eq("id", subCallId)
    .maybeSingle();
  if (callError) return { allowed: false, ownerAdmin: false, coordinatorOwnsCall: false, coordinatorName: "" };
  const typedCall = call as { labor_day_id?: string | null; assigned_coordinator_user_id?: string | null } | null;
  const partialOwner = typedCall?.assigned_coordinator_user_id === userId;

  const laborDayId = String(typedCall?.labor_day_id || "");
  if (!laborDayId) return { allowed: partialOwner, ownerAdmin: false, coordinatorOwnsCall: partialOwner, coordinatorName: "" };
  const { data: day } = await admin.from("labor_days").select("show_id").eq("id", laborDayId).maybeSingle();
  const showId = String((day as { show_id?: string | null } | null)?.show_id || "");
  if (!showId) return { allowed: partialOwner, ownerAdmin: false, coordinatorOwnsCall: partialOwner, coordinatorName: "" };

  const { data: show } = await admin.from("shows").select("created_by, assigned_coordinator_user_id").eq("id", showId).maybeSingle();
  const typedShow = show as { created_by?: string | null; assigned_coordinator_user_id?: string | null } | null;
  const wholeShowOwner = typedShow?.assigned_coordinator_user_id === userId;
  const createdByUser = typedShow?.created_by === userId;

  let shared = false;
  const accessByUser = await admin.from("event_user_access").select("id").eq("show_id", showId).eq("user_id", userId).limit(1);
  if (!accessByUser.error && accessByUser.data?.length) shared = true;
  if (!shared && accessByUser.error?.message?.includes("user_id")) {
    const accessByProfile = await admin.from("event_user_access").select("id").eq("show_id", showId).eq("user_profile_id", userId).limit(1);
    shared = Boolean(!accessByProfile.error && accessByProfile.data?.length);
  }

  const { data: profile } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const coordinatorName = String((profile as { full_name?: string | null; email?: string | null } | null)?.full_name || (profile as { email?: string | null } | null)?.email || "Coordinator");
  return {
    allowed: Boolean(partialOwner || wholeShowOwner || createdByUser || shared),
    ownerAdmin: false,
    coordinatorOwnsCall: Boolean(partialOwner || wholeShowOwner),
    coordinatorName,
  };
}

async function canAddToSubCall(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, subCallId: string, replacingAssignmentId: string | null) {
  const callRes = await admin.from("sub_calls").select("id, crew_needed").eq("id", subCallId).maybeSingle();
  if (callRes.error) throw callRes.error;
  const maxCrew = Math.max(0, Number((callRes.data as { crew_needed?: number | null } | null)?.crew_needed || 0));
  if (!maxCrew) return { ok: true, maxCrew, assignedCount: 0 };

  const assignedRes = await admin.from("assignments").select("id", { count: "exact", head: false }).eq("sub_call_id", subCallId);
  if (assignedRes.error) throw assignedRes.error;
  const assignedCount = Number(assignedRes.count ?? assignedRes.data?.length ?? 0);
  if (assignedCount < maxCrew) return { ok: true, maxCrew, assignedCount };

  if (replacingAssignmentId) {
    const replaceRes = await admin.from("assignments").select("id, sub_call_id").eq("id", replacingAssignmentId).eq("sub_call_id", subCallId).maybeSingle();
    if (replaceRes.error) throw replaceRes.error;
    if (replaceRes.data?.id) return { ok: true, maxCrew, assignedCount };
  }

  return { ok: false, maxCrew, assignedCount };
}

export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
  const url = new URL(request.url);
  const subCallId = url.searchParams.get("sub_call_id");
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const ownerAdmin = await isOwnerAdmin(admin, auth.user.id);
  if (!ownerAdmin && !subCallId) return NextResponse.json({ message: "Sub-call is required." }, { status: 400 });
  if (subCallId) {
    const access = await subCallAccess(admin, auth.user.id, subCallId);
    if (!access.allowed) return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }
  let query = supabase.from("assignments").select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived").order("sort_order", { ascending: true });
  if (subCallId) query = query.eq("sub_call_id", subCallId);
  let { data, error } = await query;
  if (missingAssignmentColumns(error)) {
    let fallback = supabase.from("assignments").select("id, sub_call_id, crew_id, status");
    if (subCallId) fallback = fallback.eq("sub_call_id", subCallId);
    const fallbackRes = await fallback;
    data = fallbackRes.data as typeof data;
    error = fallbackRes.error;
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const subCallId = String(body.sub_call_id || "").trim();
  const crewId = String(body.crew_id || "").trim();
  const status = String(body.status || "confirmed").trim() || "confirmed";
  const replacingAssignmentId = String(body.replacing_assignment_id || "").trim() || null;
  const requestedCoordinationOwnerId = String(body.coordination_owner_user_id || "").trim() || null;
  const requestedCoordinationOwnerName = String(body.coordination_owner_name || "").trim() || null;
  const requestedFeeWaived = Boolean(body.coordination_fee_waived);
  if (!subCallId || !crewId) {
    return NextResponse.json({ message: "Sub-call and crew are required." }, { status: 400 });
  }

  const access = await subCallAccess(admin, auth.user.id, subCallId);
  if (!access.allowed) {
    return NextResponse.json({ message: "You can only add crew to sub-calls specifically assigned to you or shows shared with you." }, { status: 403 });
  }
  const coordination_owner_user_id = access.ownerAdmin
    ? (requestedCoordinationOwnerId || null)
    : access.coordinatorOwnsCall ? auth.user.id : null;
  const coordination_owner_name = access.ownerAdmin
    ? (requestedCoordinationOwnerId ? requestedCoordinationOwnerName || auth.user.email || "Admin" : null)
    : access.coordinatorOwnsCall ? access.coordinatorName : null;
  const coordination_fee_waived = access.ownerAdmin && requestedCoordinationOwnerId ? requestedFeeWaived : false;

  const capacity = await canAddToSubCall(admin, subCallId, replacingAssignmentId);
  if (!capacity.ok) {
    return NextResponse.json({ message: `This subgroup is full. Max: ${capacity.maxCrew} / Filled: ${capacity.assignedCount}. Increase crew needed before adding more crew.` }, { status: 400 });
  }

  const existingWithOrder = await admin
    .from("assignments")
    .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived")
    .eq("sub_call_id", subCallId)
    .eq("crew_id", crewId)
    .maybeSingle();

  if (missingAssignmentColumns(existingWithOrder.error) && requestedCoordinationOwnerId) {
    return NextResponse.json({ message: "Run the ELS181 SQL before saving admin-owned coordination assignments." }, { status: 400 });
  }

  if (!missingAssignmentColumns(existingWithOrder.error)) {
    if (existingWithOrder.error) return NextResponse.json({ message: existingWithOrder.error.message }, { status: 400 });
    if (existingWithOrder.data) return NextResponse.json({ ok: true, row: existingWithOrder.data, message: "Crew already exists on this sub-call." });

    const requestedSortOrder = Number(body.sort_order || 0);
    const maxOrderRes = await admin
      .from("assignments")
      .select("sort_order")
      .eq("sub_call_id", subCallId)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (maxOrderRes.error) return NextResponse.json({ message: maxOrderRes.error.message }, { status: 400 });
    const nextSortOrder = requestedSortOrder > 0
      ? requestedSortOrder
      : Number(maxOrderRes.data?.[0]?.sort_order || 0) + 1;

    const { data, error } = await admin
      .from("assignments")
      .insert({ sub_call_id: subCallId, crew_id: crewId, status, sort_order: nextSortOrder, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived })
      .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived")
      .single();
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, row: data, message: "Crew added to sub-call." });
  }

  const existingFallback = await admin
    .from("assignments")
    .select("id, sub_call_id, crew_id, status")
    .eq("sub_call_id", subCallId)
    .eq("crew_id", crewId)
    .maybeSingle();
  if (existingFallback.error) return NextResponse.json({ message: existingFallback.error.message }, { status: 400 });
  if (existingFallback.data) return NextResponse.json({ ok: true, row: existingFallback.data, message: "Crew already exists on this sub-call." });

  const { data, error } = await admin
    .from("assignments")
    .insert({ sub_call_id: subCallId, crew_id: crewId, status })
    .select("id, sub_call_id, crew_id, status")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data, message: "Crew added to sub-call. Run the assignment order SQL to enable saved crew reordering." });
}
