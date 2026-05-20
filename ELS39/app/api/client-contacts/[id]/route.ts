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
  const body = await request.json().catch(() => ({}));
  const payload = {
    client_id: String(body.client_id || "").trim(),
    name: String(body.name || "").trim(),
    title: String(body.title || "").trim() || null,
    email: String(body.email || "").trim() || null,
    phone: String(body.phone || "").trim() || null,
    notes: String(body.notes || "").trim() || null,
    is_primary: Boolean(body.is_primary),
    updated_at: new Date().toISOString(),
  };
  if (!payload.client_id) return NextResponse.json({ message: "Choose a client first." }, { status: 400 });
  if (!payload.name) return NextResponse.json({ message: "Contact name is required." }, { status: 400 });

  if (payload.is_primary) {
    await admin.from("client_contacts").update({ is_primary: false }).eq("client_id", payload.client_id).neq("id", id);
  }

  const { data, error } = await admin
    .from("client_contacts")
    .update(payload)
    .eq("id", id)
    .select("id, client_id, name, title, email, phone, notes, is_primary, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, contact: data, message: "Client contact updated." });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  await admin.from("shows").update({ client_contact_id: null }).eq("client_contact_id", id);
  const { error } = await admin.from("client_contacts").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Client contact deleted." });
}
