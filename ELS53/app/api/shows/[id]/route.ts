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
    name: String(body.name || "").trim(),
    client: String(body.client || "").trim() || null,
    business_client_id: String(body.business_client_id || "").trim() || null,
    client_contact_id: String(body.client_contact_id || "").trim() || null,
    venue: String(body.venue || "").trim() || null,
    rate_city: String(body.rate_city || "Default").trim() || 'Default',
    show_start: String(body.show_start || "").trim(),
    show_end: String(body.show_end || "").trim(),
    notes: String(body.notes || "").trim() || null,
  };
  const { error } = await admin.from('shows').update(payload).eq('id', id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  // Keep previously saved show ratings tied to the current saved business client
  // and project manager/contact. This fixes older events that were created before
  // client and contact rating links were available.
  const { error: ratingsError } = await admin
    .from('tech_ratings')
    .update({ client_id: payload.business_client_id, client_contact_id: payload.client_contact_id, updated_at: new Date().toISOString() })
    .eq('show_id', id);
  if (ratingsError) return NextResponse.json({ message: ratingsError.message }, { status: 400 });

  return NextResponse.json({ ok: true, message: 'Show updated. Ratings are synced to the selected client and project manager/contact.' });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const { error } = await admin.from('shows').delete().eq('id', id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: 'Show deleted.' });
}
