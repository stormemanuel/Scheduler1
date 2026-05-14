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
    venue: String(body.venue || "").trim() || null,
    rate_city: String(body.rate_city || "Default").trim() || 'Default',
    show_start: String(body.show_start || "").trim(),
    show_end: String(body.show_end || "").trim(),
    notes: String(body.notes || "").trim() || null,
  };
  const { error } = await admin.from('shows').update(payload).eq('id', id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: 'Show updated.' });
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
