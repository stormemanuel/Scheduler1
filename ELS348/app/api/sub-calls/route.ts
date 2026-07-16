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

async function canCreateOnLaborDay(userId: string, laborDayId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  if (await isOwnerAdmin(userId)) return true;
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

function cleanSubCallPayload(row: Record<string, unknown>, allowCoordinatorAssignment = false) {
  const payload = {
    labor_day_id: String(row.labor_day_id || "").trim(),
    area: String(row.area || "").trim(),
    location: String(row.location || "").trim() || null,
    po_number: String(row.po_number || "").trim() || null,
    area_lead_contact_id: String(row.area_lead_contact_id || "").trim() || null,
    area_lead_name: String(row.area_lead_name || "").trim() || null,
    area_lead_phone: String(row.area_lead_phone || "").trim() || null,
    assigned_coordinator_user_id: allowCoordinatorAssignment ? (String(row.assigned_coordinator_user_id || "").trim() || null) : null,
    role_name: String(row.role_name || "").trim(),
    master_rate_id: String(row.master_rate_id || "").trim() || null,
    message_rate: String(row.message_rate || "").replace(/[^0-9.]/g, "").trim() || null,
    start_time: String(row.start_time || "").trim(),
    end_time: String(row.end_time || "").trim(),
    crew_needed: Math.max(1, Number(row.crew_needed || 1)),
    notes: String(row.notes || "").trim() || null,
    sort_order: Math.max(0, Number(row.sort_order || 0)),
    day_type: ["full_day", "half_day", "hourly", "custom"].includes(String(row.day_type || "")) ? String(row.day_type) : "full_day",
    one_hour_walkaway: row.one_hour_walkaway === true || row.one_hour_walkaway === "true" || row.one_hour_walkaway === "on",
  };
  return payload;
}

function validateSubCallPayload(payload: ReturnType<typeof cleanSubCallPayload>) {
  return Boolean(payload.labor_day_id && payload.area && payload.role_name && payload.start_time && payload.end_time);
}

function coordinatorNotificationsMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("coordinator_event_notifications") && (text.includes("does not exist") || text.includes("schema cache"));
}

async function createSubCallCoordinatorNotifications(admin: ReturnType<typeof createSupabaseAdminClient>, rows: Array<Record<string, unknown>>, createdByUserId: string) {
  if (!admin || !rows.length) return;
  const laborDayIds = Array.from(new Set(rows.map((row) => String(row.labor_day_id || "")).filter(Boolean)));
  if (!laborDayIds.length) return;
  const daysRes = await admin
    .from("labor_days")
    .select("id, show_id, labor_date, label")
    .in("id", laborDayIds);
  if (daysRes.error) return;
  const dayById = new Map((daysRes.data || []).map((day) => [String((day as { id: string }).id), day]));
  const showIds = Array.from(new Set((daysRes.data || []).map((day) => String((day as { show_id?: string | null }).show_id || "")).filter(Boolean)));
  const showsRes = showIds.length
    ? await admin.from("shows").select("id, name, client, venue, event_location, assigned_coordinator_user_id").in("id", showIds)
    : { data: [], error: null };
  if (showsRes.error) return;
  const showById = new Map((showsRes.data || []).map((show) => [String((show as { id: string }).id), show]));
  const inserts = rows.flatMap((row) => {
    const day = dayById.get(String(row.labor_day_id || "")) as { show_id?: string | null; labor_date?: string | null; label?: string | null } | undefined;
    const show = showById.get(String(day?.show_id || "")) as { id?: string; name?: string | null; client?: string | null; venue?: string | null; event_location?: string | null; assigned_coordinator_user_id?: string | null } | undefined;
    const coordinatorUserId = String(row.assigned_coordinator_user_id || show?.assigned_coordinator_user_id || "").trim();
    if (!coordinatorUserId || coordinatorUserId === createdByUserId || !show?.id) return [];
    const area = String(row.area || "Sub-call").trim();
    const role = String(row.role_name || "Crew").trim();
    const title = `New sub-call assigned: ${show.name || "Untitled event"}`;
    const body = [
      `Event: ${show.name || "Untitled event"}`,
      show.client ? `Client: ${show.client}` : "",
      show.venue ? `Venue: ${show.venue}` : "",
      show.event_location ? `Location: ${show.event_location}` : "",
      `Date: ${day?.labor_date || "TBD"}${day?.label ? ` · ${day.label}` : ""}`,
      `Area / booth: ${area}`,
      `Role: ${role}`,
      `Call time: ${String(row.start_time || "TBD")}${row.end_time ? ` to ${String(row.end_time)}` : ""}`,
      `Crew needed: ${String(row.crew_needed || "1")}`,
      row.notes ? `Notes: ${String(row.notes)}` : "",
      "Please review this sub-call in ELS and reply here if anything needs attention.",
    ].filter(Boolean).join("\n");
    return [{
      user_id: coordinatorUserId,
      show_id: show.id,
      sub_call_id: String(row.id || "") || null,
      notification_type: "sub_call_assigned",
      title,
      body,
      created_by: createdByUserId,
    }];
  });
  if (!inserts.length) return;
  const { error } = await admin.from("coordinator_event_notifications").insert(inserts);
  if (error && !coordinatorNotificationsMissing(error.message)) throw new Error(error.message);
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can change event days or sub-calls." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const ownerAdmin = await isOwnerAdmin(auth.user.id);
  const rowsSource: unknown[] = Array.isArray(body.items) ? body.items : [body];
  const rows = rowsSource.map((item: unknown) => cleanSubCallPayload((item || {}) as Record<string, unknown>, ownerAdmin));
  if (!rows.length) return NextResponse.json({ message: "Choose at least one labor day for this sub-call." }, { status: 400 });
  if (rows.some((payload: ReturnType<typeof cleanSubCallPayload>) => !validateSubCallPayload(payload))) {
    return NextResponse.json({ message: "Area, position, start time, and end time are required for every selected labor day." }, { status: 400 });
  }
  if (!ownerAdmin) {
    for (const row of rows) {
      if (!(await canCreateOnLaborDay(auth.user.id, row.labor_day_id))) {
        return NextResponse.json({ message: "You cannot create new sub-calls on a partial-access event. Ask an admin to approve and assign the new sub-call." }, { status: 403 });
      }
    }
  }

  const orderedRows: ReturnType<typeof cleanSubCallPayload>[] = [];
  for (const row of rows) {
    if (row.sort_order > 0) {
      orderedRows.push(row);
      continue;
    }
    const maxOrderRes = await admin
      .from("sub_calls")
      .select("sort_order")
      .eq("labor_day_id", row.labor_day_id)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextSortOrder = maxOrderRes.error ? 0 : Number(maxOrderRes.data?.[0]?.sort_order || 0) + 1;
    orderedRows.push({ ...row, sort_order: nextSortOrder });
  }

  const { data, error } = await admin
    .from("sub_calls")
    .insert(orderedRows)
    .select("id,labor_day_id,area,location,po_number,area_lead_contact_id,area_lead_name,area_lead_phone,assigned_coordinator_user_id,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes,sort_order,day_type,one_hour_walkaway");
  if (error && error.message.includes("assigned_coordinator_user_id")) {
    return NextResponse.json({
      message: "Sub-call coordinator access is not installed yet. Run ELS275_sub_call_coordinator_access.sql in Supabase SQL Editor, then save again.",
      code: "SUB_CALL_COORDINATOR_COLUMN_MISSING",
    }, { status: 409 });
  }
  if (error && (error.message.includes("po_number") || error.message.includes("area_lead"))) {
    return NextResponse.json({
      message: "Sub-call was not saved because the database is missing the PO / Area Lead columns. Run ELS268_required_sql.sql in Supabase SQL Editor, then save again.",
      code: "SUB_CALL_COLUMNS_MISSING",
    }, { status: 409 });
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  const createdRows = (data ?? []).map((row) => ({ ...row, notes: row.notes || "" }));
  await createSubCallCoordinatorNotifications(admin, createdRows, auth.user.id);
  return NextResponse.json({
    ok: true,
    id: createdRows[0]?.id,
    rows: createdRows,
    message: `${createdRows.length} sub-call${createdRows.length === 1 ? "" : "s"} saved.`,
  });
}
