import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

const clientSelect = "id, name, legal_company_name, billing_address, billing_city, billing_state, billing_zip, main_phone, main_email, website, default_rate_city, default_market_notes, notes, ap_contact_name, ap_email, ap_phone, payment_terms, po_required, w9_coi_notes, default_invoice_email, billing_notes, created_at, updated_at";

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalBoolean(value: unknown) {
  if (value === true || value === "true" || value === "yes") return true;
  if (value === false || value === "false" || value === "no") return false;
  return null;
}

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

  const body = await request.json().catch(() => ({}));
  const payload = {
    name: String(body.name || "").trim(),
    legal_company_name: optionalText(body.legal_company_name),
    billing_address: optionalText(body.billing_address),
    billing_city: optionalText(body.billing_city),
    billing_state: optionalText(body.billing_state),
    billing_zip: optionalText(body.billing_zip),
    main_phone: optionalText(body.main_phone),
    main_email: optionalText(body.main_email),
    website: optionalText(body.website),
    default_rate_city: String(body.default_rate_city || "Default").trim() || "Default",
    default_market_notes: optionalText(body.default_market_notes),
    notes: optionalText(body.notes),
    ap_contact_name: optionalText(body.ap_contact_name),
    ap_email: optionalText(body.ap_email),
    ap_phone: optionalText(body.ap_phone),
    payment_terms: optionalText(body.payment_terms),
    po_required: optionalBoolean(body.po_required),
    w9_coi_notes: optionalText(body.w9_coi_notes),
    default_invoice_email: optionalText(body.default_invoice_email),
    billing_notes: optionalText(body.billing_notes),
  };
  if (!payload.name) return NextResponse.json({ message: "Client name is required. All other company details are optional." }, { status: 400 });

  const { data, error } = await admin
    .from("business_clients")
    .upsert(payload, { onConflict: "name" })
    .select(clientSelect)
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, client: data, message: "Client saved." });
}
