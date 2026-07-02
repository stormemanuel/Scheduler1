import { NextResponse } from "next/server";
import { normalizeRole } from "@/lib/auth";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { halfDayFromFullDay } from "@/lib/rates-types";

const clientSelect = "id, name, legal_company_name, billing_address, billing_city, billing_state, billing_zip, main_phone, main_email, website, default_rate_city, default_market_notes, notes, ap_contact_name, ap_email, ap_phone, payment_terms, po_required, w9_coi_notes, default_invoice_email, billing_notes, created_by, created_at, updated_at";

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function optionalBoolean(value: unknown) {
  if (value === true || value === "true" || value === "yes") return true;
  if (value === false || value === "false" || value === "no") return false;
  return null;
}

function optionalPositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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

async function canManageClient(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, clientId: string, userId: string, role: string) {
  if (role === "owner" || role === "admin") return true;
  const { data, error } = await admin.from("business_clients").select("id, created_by").eq("id", clientId).maybeSingle();
  if (error || !data) return false;
  return String((data as { created_by?: string | null }).created_by || "") === userId;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  if (!(await canManageClient(admin, id, auth.user.id, auth.role))) {
    return NextResponse.json({ message: "You can only edit client records you created." }, { status: 403 });
  }

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
    updated_at: new Date().toISOString(),
  };
  if (!payload.name) return NextResponse.json({ message: "Client name is required. All other company details are optional." }, { status: 400 });

  const { data, error } = await admin
    .from("business_clients")
    .update(payload)
    .eq("id", id)
    .select(clientSelect)
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, client: data, message: "Client updated." });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  if (!(await canManageClient(admin, id, auth.user.id, auth.role))) {
    return NextResponse.json({ message: "You can only edit pricing for client records you created." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.action !== "save-city-rates") {
    return NextResponse.json({ message: "Unknown client update action." }, { status: 400 });
  }

  const cityName = String(body.city_name || "Default").trim() || "Default";
  const inputRows = Array.isArray(body.rows) ? body.rows : [];
  const seenRoles = new Set<string>();
  const rows = inputRows.flatMap((row: Record<string, unknown>) => {
    const roleName = String(row.role_name || "").trim();
    const roleKey = roleName.toLowerCase();
    if (!roleName || seenRoles.has(roleKey)) return [];
    seenRoles.add(roleKey);
    const fullDay = optionalPositiveNumber(row.full_day);
    const halfDay = halfDayFromFullDay(fullDay);
    const overtimeMultiplier = optionalPositiveNumber(row.overtime_multiplier);
    const doubletimeMultiplier = optionalPositiveNumber(row.doubletime_multiplier);
    if (fullDay === null && halfDay === null && overtimeMultiplier === null && doubletimeMultiplier === null) return [];
    return [{
      client_id: id,
      city_name: cityName,
      role_name: roleName,
      full_day: fullDay,
      half_day: halfDay,
      overtime_multiplier: overtimeMultiplier,
      doubletime_multiplier: doubletimeMultiplier,
      updated_at: new Date().toISOString(),
    }];
  });

  const existingRes = await admin
    .from("client_rate_overrides")
    .select("id, role_name")
    .eq("client_id", id)
    .eq("city_name", cityName);
  if (existingRes.error) return NextResponse.json({ message: existingRes.error.message }, { status: 400 });

  if (rows.length) {
    const { error: upsertError } = await admin
      .from("client_rate_overrides")
      .upsert(rows, { onConflict: "client_id,city_name,role_name" });
    if (upsertError) return NextResponse.json({ message: upsertError.message }, { status: 400 });
  }

  const submittedRoleKeys = new Set(rows.map((row: { role_name: string }) => row.role_name.toLowerCase()));
  const deleteIds = (existingRes.data ?? [])
    .filter((row) => !submittedRoleKeys.has(String((row as { role_name?: string | null }).role_name || "").toLowerCase()))
    .map((row) => String((row as { id: string }).id));
  if (deleteIds.length) {
    const { error: deleteError } = await admin.from("client_rate_overrides").delete().in("id", deleteIds);
    if (deleteError) return NextResponse.json({ message: deleteError.message }, { status: 400 });
  }

  const savedRes = await admin
    .from("client_rate_overrides")
    .select("id, client_id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier, created_at, updated_at")
    .eq("client_id", id)
    .eq("city_name", cityName)
    .order("role_name", { ascending: true });
  if (savedRes.error) return NextResponse.json({ message: savedRes.error.message }, { status: 400 });

  return NextResponse.json({
    ok: true,
    rows: savedRes.data ?? [],
    message: `${cityName} prices saved for this client.`,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  if (!(await canManageClient(admin, id, auth.user.id, auth.role))) {
    return NextResponse.json({ message: "You can only delete client records you created." }, { status: 403 });
  }

  await admin.from("shows").update({ business_client_id: null, client_contact_id: null }).eq("business_client_id", id);
  const { error } = await admin.from("business_clients").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Client deleted." });
}
