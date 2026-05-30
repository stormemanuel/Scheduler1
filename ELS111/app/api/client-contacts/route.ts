import { NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

const contactSelect = "id, client_id, name, title, email, phone, cell_phone, notes, contact_type, created_by, is_primary, is_onsite_contact, is_billing_contact, created_at, updated_at";

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
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = normalizeRole(profile?.role as string | null | undefined);
  return { ok: true as const, user, role };
}

async function canUseClient(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, clientId: string, userId: string, role: string) {
  if (role === "owner" || role === "admin") return true;
  const { data, error } = await admin.from("business_clients").select("id, created_by").eq("id", clientId).maybeSingle();
  if (error || !data) return false;
  return String((data as { created_by?: string | null }).created_by || "") === userId;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

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
    created_by: auth.user.id,
    is_primary: Boolean(body.is_primary),
    is_onsite_contact: Boolean(body.is_onsite_contact),
    is_billing_contact: Boolean(body.is_billing_contact),
  };
  if (!payload.client_id) return NextResponse.json({ message: "Choose a client first." }, { status: 400 });
  if (!payload.name) return NextResponse.json({ message: "Contact name is required when adding a contact. The other contact fields are optional." }, { status: 400 });
  if (!(await canUseClient(admin, payload.client_id, auth.user.id, auth.role))) {
    return NextResponse.json({ message: "You can only add contacts to client records you created." }, { status: 403 });
  }

  if (payload.is_primary) {
    await admin.from("client_contacts").update({ is_primary: false }).eq("client_id", payload.client_id);
  }

  const { data, error } = await admin
    .from("client_contacts")
    .insert(payload)
    .select(contactSelect)
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, contact: data, message: "Client contact saved." });
}
