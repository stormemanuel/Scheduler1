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
    area: String(body.area || '').trim(),
    location: String(body.location || '').trim() || null,
    po_number: String(body.po_number || '').trim() || null,
    area_lead_contact_id: String(body.area_lead_contact_id || '').trim() || null,
    area_lead_name: String(body.area_lead_name || '').trim() || null,
    area_lead_phone: String(body.area_lead_phone || '').trim() || null,
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
  const { error } = await admin.from('sub_calls').update(payload).eq('id', id);
  if (error && (error.message.includes('po_number') || error.message.includes('area_lead'))) {
    const { po_number: _po_number, area_lead_contact_id: _area_lead_contact_id, area_lead_name: _area_lead_name, area_lead_phone: _area_lead_phone, ...fallbackPayload } = payload;
    const fallback = await admin.from('sub_calls').update(fallbackPayload).eq('id', id);
    if (fallback.error) return NextResponse.json({ message: fallback.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: 'Sub-call updated. Run the latest ELS SQL to enable PO numbers and Area Leads on sub-calls.' });
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: 'Sub-call updated.' });
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
