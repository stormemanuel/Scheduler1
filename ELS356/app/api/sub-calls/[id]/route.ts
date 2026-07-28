import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

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

async function isOwnerAdmin(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = String((data as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  return role === "owner" || role === "admin";
}

async function coordinatorCanAccessSubCall(userId: string, subCallId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  if (await isOwnerAdmin(userId)) return true;
  const { data: call } = await admin.from("sub_calls").select("labor_day_id, assigned_coordinator_user_id").eq("id", subCallId).maybeSingle();
  const typedCall = call as { labor_day_id?: string | null; assigned_coordinator_user_id?: string | null } | null;
  if (typedCall?.assigned_coordinator_user_id === userId) return true;
  if (!typedCall?.labor_day_id) return false;
  const { data: day } = await admin.from("labor_days").select("show_id").eq("id", typedCall.labor_day_id).maybeSingle();
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

function coordinatorNotificationsMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("coordinator_event_notifications") && (text.includes("does not exist") || text.includes("schema cache"));
}

async function createSubCallCoordinatorNotification(admin: ReturnType<typeof createSupabaseAdminClient>, row: Record<string, unknown>, createdByUserId: string) {
  if (!admin) return;
  const { data: day } = await admin
    .from("labor_days")
    .select("id, show_id, labor_date, label")
    .eq("id", String(row.labor_day_id || ""))
    .maybeSingle();
  const typedDay = day as { show_id?: string | null; labor_date?: string | null; label?: string | null } | null;
  if (!typedDay?.show_id) return;
  const { data: show } = await admin
    .from("shows")
    .select("id, name, client, venue, event_location, assigned_coordinator_user_id")
    .eq("id", typedDay.show_id)
    .maybeSingle();
  const typedShow = show as { id?: string; name?: string | null; client?: string | null; venue?: string | null; event_location?: string | null; assigned_coordinator_user_id?: string | null } | null;
  const coordinatorUserId = String(row.assigned_coordinator_user_id || typedShow?.assigned_coordinator_user_id || "").trim();
  if (!coordinatorUserId || coordinatorUserId === createdByUserId || !typedShow?.id) return;
  const title = `New sub-call assigned: ${typedShow.name || "Untitled event"}`;
  const body = [
    `Event: ${typedShow.name || "Untitled event"}`,
    typedShow.client ? `Client: ${typedShow.client}` : "",
    typedShow.venue ? `Venue: ${typedShow.venue}` : "",
    typedShow.event_location ? `Location: ${typedShow.event_location}` : "",
    `Date: ${typedDay.labor_date || "TBD"}${typedDay.label ? ` · ${typedDay.label}` : ""}`,
    `Area / booth: ${String(row.area || "Sub-call")}`,
    `Role: ${String(row.role_name || "Crew")}`,
    `Call time: ${String(row.start_time || "TBD")}${row.end_time ? ` to ${String(row.end_time)}` : ""}`,
    `Crew needed: ${String(row.crew_needed || "1")}`,
    row.notes ? `Notes: ${String(row.notes)}` : "",
    "Please review this sub-call in ELS and reply here if anything needs attention.",
  ].filter(Boolean).join("\n");
  const { error } = await admin.from("coordinator_event_notifications").insert({
    user_id: coordinatorUserId,
    show_id: typedShow.id,
    sub_call_id: String(row.id || "") || null,
    notification_type: "sub_call_assigned",
    title,
    body,
    created_by: createdByUserId,
  });
  if (error && !coordinatorNotificationsMissing(error.message)) throw new Error(error.message);
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
  if (!(await coordinatorCanAccessSubCall(auth.user.id, id))) {
    return NextResponse.json({ message: "You can only edit sub-calls specifically assigned to you or shows shared with you." }, { status: 403 });
  }
  const { data: existingSubCall } = await admin
    .from("sub_calls")
    .select("assigned_coordinator_user_id")
    .eq("id", id)
    .maybeSingle();
  const previousCoordinatorUserId = String((existingSubCall as { assigned_coordinator_user_id?: string | null } | null)?.assigned_coordinator_user_id || "");
  const body = await request.json();
  const ownerAdmin = await isOwnerAdmin(auth.user.id);
  const payload = {
    area: String(body.area || '').trim(),
    location: String(body.location || '').trim() || null,
    po_number: String(body.po_number || '').trim() || null,
    area_lead_contact_id: String(body.area_lead_contact_id || '').trim() || null,
    area_lead_name: String(body.area_lead_name || '').trim() || null,
    area_lead_phone: String(body.area_lead_phone || '').trim() || null,
    ...(ownerAdmin ? { assigned_coordinator_user_id: String(body.assigned_coordinator_user_id || '').trim() || null } : {}),
    role_name: String(body.role_name || '').trim(),
    master_rate_id: String(body.master_rate_id || '').trim() || null,
    message_rate: String(body.message_rate || '').replace(/[^0-9.]/g, '').trim() || null,
    start_time: String(body.start_time || '').trim(),
    end_time: String(body.end_time || '').trim() || null,
    crew_needed: Math.max(1, Number(body.crew_needed || 1)),
    notes: String(body.notes || '').trim() || null,
    sort_order: Math.max(0, Number(body.sort_order || 0)),
    day_type: ["full_day", "half_day", "hourly", "custom"].includes(String(body.day_type || "")) ? String(body.day_type) : "full_day",
    one_hour_walkaway: body.one_hour_walkaway === true || body.one_hour_walkaway === "true" || body.one_hour_walkaway === "on",
  };
  const { data, error } = await admin
    .from('sub_calls')
    .update(payload)
    .eq('id', id)
    .select('id,labor_day_id,area,location,po_number,area_lead_contact_id,area_lead_name,area_lead_phone,assigned_coordinator_user_id,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes,sort_order,day_type,one_hour_walkaway')
    .single();
  if (error && error.message.includes('assigned_coordinator_user_id')) {
    return NextResponse.json({
      message: 'Sub-call coordinator access is not installed yet. Run ELS275_sub_call_coordinator_access.sql in Supabase SQL Editor, then save again.',
      code: 'SUB_CALL_COORDINATOR_COLUMN_MISSING',
    }, { status: 409 });
  }
  if (error && (error.message.includes('po_number') || error.message.includes('area_lead'))) {
    return NextResponse.json({
      message: 'Sub-call was not saved because the database is missing the PO / Area Lead columns. Run ELS268_required_sql.sql in Supabase SQL Editor, then save again.',
      code: 'SUB_CALL_COLUMNS_MISSING',
    }, { status: 409 });
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  const nextCoordinatorUserId = String((data as { assigned_coordinator_user_id?: string | null } | null)?.assigned_coordinator_user_id || "");
  if (nextCoordinatorUserId && nextCoordinatorUserId !== previousCoordinatorUserId) {
    await createSubCallCoordinatorNotification(admin, data as Record<string, unknown>, auth.user.id);
  }
  return NextResponse.json({ ok: true, row: { ...data, notes: data?.notes || '' }, message: 'Sub-call updated.' });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canDeleteEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users can delete sub-calls. Coordinators can view and help fill events, but they cannot delete event details." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const { error } = await admin.from('sub_calls').delete().eq('id', id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: 'Sub-call deleted.' });
}
