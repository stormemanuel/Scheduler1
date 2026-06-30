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

async function isOwnerAdmin(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string) {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = normalizeRole((data as { role?: string | null } | null)?.role);
  return role === "owner" || role === "admin";
}

async function canAccessAssignment(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userId: string, assignmentId: string) {
  if (await isOwnerAdmin(admin, userId)) return true;
  const { data: assignment } = await admin.from("assignments").select("sub_call_id").eq("id", assignmentId).maybeSingle();
  const subCallId = String((assignment as { sub_call_id?: string | null } | null)?.sub_call_id || "");
  if (!subCallId) return false;
  const { data: call } = await admin.from("sub_calls").select("labor_day_id, assigned_coordinator_user_id").eq("id", subCallId).maybeSingle();
  const typedCall = call as { labor_day_id?: string | null; assigned_coordinator_user_id?: string | null } | null;
  if (typedCall?.assigned_coordinator_user_id === userId) return true;
  const laborDayId = String(typedCall?.labor_day_id || "");
  if (!laborDayId) return false;
  const { data: day } = await admin.from("labor_days").select("show_id").eq("id", laborDayId).maybeSingle();
  const showId = String((day as { show_id?: string | null } | null)?.show_id || "");
  if (!showId) return false;
  const { data: show } = await admin.from("shows").select("created_by, assigned_coordinator_user_id").eq("id", showId).maybeSingle();
  const typedShow = show as { created_by?: string | null; assigned_coordinator_user_id?: string | null } | null;
  if (typedShow?.created_by === userId || typedShow?.assigned_coordinator_user_id === userId) return true;
  const accessByUser = await admin.from("event_user_access").select("id").eq("show_id", showId).eq("user_id", userId).limit(1);
  if (!accessByUser.error && accessByUser.data?.length) return true;
  if (accessByUser.error?.message?.includes("user_id")) {
    const accessByProfile = await admin.from("event_user_access").select("id").eq("show_id", showId).eq("user_profile_id", userId).limit(1);
    return Boolean(!accessByProfile.error && accessByProfile.data?.length);
  }
  return false;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  if (!(await canAccessAssignment(admin, auth.user.id, id))) return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  const body = await request.json();
  const payload: { sort_order?: number; status?: string; start_time?: string | null; end_time?: string | null; day_type?: string | null; coordination_owner_user_id?: string | null; coordination_owner_name?: string | null; coordination_fee_waived?: boolean } = {};
  if (body.sort_order !== undefined) {
    const sortOrder = Math.max(1, Number(body.sort_order || 1));
    payload.sort_order = Number.isFinite(sortOrder) ? sortOrder : 1;
  }
  if (body.status !== undefined) payload.status = String(body.status || "confirmed").trim() || "confirmed";
  if (body.start_time !== undefined) payload.start_time = String(body.start_time || "").trim() || null;
  if (body.end_time !== undefined) payload.end_time = String(body.end_time || "").trim() || null;
  if (body.day_type !== undefined) {
    const dayType = String(body.day_type || "").trim();
    payload.day_type = ["full_day", "half_day", "hourly", "custom"].includes(dayType) ? dayType : null;
  }
  if (body.coordination_owner_user_id !== undefined || body.coordination_owner_name !== undefined || body.coordination_fee_waived !== undefined) {
    const ownerAdmin = await isOwnerAdmin(admin, auth.user.id);
    if (!ownerAdmin) return NextResponse.json({ message: "Only owner/admin users can change coordination fee ownership." }, { status: 403 });
    if (body.coordination_owner_user_id !== undefined) {
      const ownerId = String(body.coordination_owner_user_id || "").trim();
      payload.coordination_owner_user_id = ownerId || null;
    }
    if (body.coordination_owner_name !== undefined) payload.coordination_owner_name = String(body.coordination_owner_name || "").trim() || null;
    if (body.coordination_fee_waived !== undefined) payload.coordination_fee_waived = Boolean(body.coordination_fee_waived);
  }
  if (!Object.keys(payload).length) return NextResponse.json({ message: "Nothing to update." }, { status: 400 });

  const { data, error } = await admin
    .from("assignments")
    .update(payload)
    .eq("id", id)
    .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data, message: "Crew assignment updated." });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const { error } = await admin.from("assignments").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Crew removed from sub-call." });
}
