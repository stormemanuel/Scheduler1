import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

const contactSelect = "id, client_id, name, title, email, phone, cell_phone, notes, contact_type, is_primary, is_onsite_contact, is_billing_contact, created_at, updated_at";

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function contactType(value: unknown) {
  const text = String(value || "").trim();
  return ["labor-coordinator", "project-manager", "booth-manager", "client-tech"].includes(text) ? text : "labor-coordinator";
}

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
    title: optionalText(body.title),
    email: optionalText(body.email),
    phone: optionalText(body.phone),
    cell_phone: optionalText(body.cell_phone),
    notes: optionalText(body.notes),
    contact_type: contactType(body.contact_type),
    is_primary: Boolean(body.is_primary),
    is_onsite_contact: Boolean(body.is_onsite_contact),
    is_billing_contact: Boolean(body.is_billing_contact),
    updated_at: new Date().toISOString(),
  };
  if (!payload.client_id) return NextResponse.json({ message: "Choose a client first." }, { status: 400 });
  if (!payload.name) return NextResponse.json({ message: "Contact name is required when adding a contact. The other contact fields are optional." }, { status: 400 });

  if (payload.is_primary) {
    await admin.from("client_contacts").update({ is_primary: false }).eq("client_id", payload.client_id).neq("id", id);
  }

  const { data, error } = await admin
    .from("client_contacts")
    .update(payload)
    .eq("id", id)
    .select(contactSelect)
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
