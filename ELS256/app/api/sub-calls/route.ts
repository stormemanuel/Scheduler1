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

function cleanSubCallPayload(row: Record<string, unknown>) {
  const payload = {
    labor_day_id: String(row.labor_day_id || "").trim(),
    area: String(row.area || "").trim(),
    location: String(row.location || "").trim() || null,
    po_number: String(row.po_number || "").trim() || null,
    area_lead_contact_id: String(row.area_lead_contact_id || "").trim() || null,
    area_lead_name: String(row.area_lead_name || "").trim() || null,
    area_lead_phone: String(row.area_lead_phone || "").trim() || null,
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

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can change event days or sub-calls." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const rowsSource: unknown[] = Array.isArray(body.items) ? body.items : [body];
  const rows = rowsSource.map((item: unknown) => cleanSubCallPayload((item || {}) as Record<string, unknown>));
  if (!rows.length) return NextResponse.json({ message: "Choose at least one labor day for this sub-call." }, { status: 400 });
  if (rows.some((payload: ReturnType<typeof cleanSubCallPayload>) => !validateSubCallPayload(payload))) {
    return NextResponse.json({ message: "Area, position, start time, and end time are required for every selected labor day." }, { status: 400 });
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
    .select("id,labor_day_id,area,location,po_number,area_lead_contact_id,area_lead_name,area_lead_phone,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes,sort_order,day_type,one_hour_walkaway");
  if (error && (error.message.includes("po_number") || error.message.includes("area_lead"))) {
    const fallbackRows = orderedRows.map(({ po_number: _po_number, area_lead_contact_id: _area_lead_contact_id, area_lead_name: _area_lead_name, area_lead_phone: _area_lead_phone, ...row }) => row);
    const fallback = await admin
      .from("sub_calls")
      .insert(fallbackRows)
      .select("id,labor_day_id,area,location,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes,sort_order,day_type,one_hour_walkaway");
    if (fallback.error) return NextResponse.json({ message: fallback.error.message }, { status: 400 });
    const fallbackRowsData = (fallback.data ?? []).map((row) => ({ ...row, po_number: null, area_lead_contact_id: null, area_lead_name: null, area_lead_phone: null, notes: row.notes || "" }));
    return NextResponse.json({
      ok: true,
      id: fallbackRowsData[0]?.id,
      rows: fallbackRowsData,
      message: `${fallbackRowsData.length} sub-call${fallbackRowsData.length === 1 ? "" : "s"} saved. Run the latest ELS SQL to enable PO numbers and Area Leads on sub-calls.`,
    });
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  const createdRows = (data ?? []).map((row) => ({ ...row, notes: row.notes || "" }));
  return NextResponse.json({
    ok: true,
    id: createdRows[0]?.id,
    rows: createdRows,
    message: `${createdRows.length} sub-call${createdRows.length === 1 ? "" : "s"} saved.`,
  });
}
