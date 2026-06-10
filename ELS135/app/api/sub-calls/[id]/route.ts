import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const body = await request.json();
  const payload = {
    area: String(body.area || '').trim(),
    location: String(body.location || '').trim() || null,
    po_number: String(body.po_number || '').trim() || null,
    role_name: String(body.role_name || '').trim(),
    master_rate_id: String(body.master_rate_id || '').trim() || null,
    message_rate: String(body.message_rate || '').replace(/[^0-9.]/g, '').trim() || null,
    start_time: String(body.start_time || '').trim(),
    end_time: String(body.end_time || '').trim() || null,
    crew_needed: Math.max(1, Number(body.crew_needed || 1)),
    notes: String(body.notes || '').trim() || null,
    sort_order: Math.max(0, Number(body.sort_order || 0)),
    day_type: ["full_day", "half_day", "custom"].includes(String(body.day_type || "")) ? String(body.day_type) : "full_day",
    one_hour_walkaway: body.one_hour_walkaway === true || body.one_hour_walkaway === "true" || body.one_hour_walkaway === "on",
  };
  const { error } = await admin.from('sub_calls').update(payload).eq('id', id);
  if (error && error.message.includes('po_number')) {
    const { po_number: _po_number, ...fallbackPayload } = payload;
    const fallback = await admin.from('sub_calls').update(fallbackPayload).eq('id', id);
    if (fallback.error) return NextResponse.json({ message: fallback.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: 'Sub-call updated. Run the ELS130 SQL to enable PO numbers on sub-calls.' });
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: 'Sub-call updated.' });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const { error } = await admin.from('sub_calls').delete().eq('id', id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: 'Sub-call deleted.' });
}
