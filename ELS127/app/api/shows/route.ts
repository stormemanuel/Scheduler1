import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const payload = {
    name: String(body.name || "").trim(),
    client: String(body.client || "").trim() || null,
    business_client_id: String(body.business_client_id || "").trim() || null,
    client_contact_id: String(body.client_contact_id || "").trim() || null,
    coordinator_contact_id: String(body.coordinator_contact_id || "").trim() || null,
    assigned_coordinator_user_id: String(body.assigned_coordinator_user_id || "").trim() || null,
    venue: String(body.venue || "").trim() || null,
    rate_city: String(body.rate_city || "Default").trim() || 'Default',
    show_start: String(body.show_start || "").trim(),
    show_end: String(body.show_end || "").trim(),
    notes: String(body.notes || "").trim() || null,
  };
  if (!payload.name || !payload.show_start || !payload.show_end) return NextResponse.json({ message: 'Show name, start, and end are required.' }, { status: 400 });
  let { data, error } = await admin.from('shows').insert({ ...payload, created_by: auth.user.id }).select('id').single();
  if (error && error.message.includes('assigned_coordinator_user_id')) {
    const { assigned_coordinator_user_id: _ignored, ...fallbackPayload } = payload;
    const fallback = await admin.from('shows').insert({ ...fallbackPayload, created_by: auth.user.id }).select('id').single();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ message: 'Show save did not return an id.' }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id, message: 'Show saved.' });
}
