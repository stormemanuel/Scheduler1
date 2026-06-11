import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

function normalizeRole(role: string | null | undefined) {
  return String(role || "viewer").toLowerCase().trim();
}

function isOwnerAdminRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "admin";
}

async function requireOwnerAdmin() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) return { ok: false as const, response: NextResponse.json({ message: error.message }, { status: 400 }) };
  if (!isOwnerAdminRole((profile as { role?: string | null } | null)?.role)) {
    return { ok: false as const, response: NextResponse.json({ message: "Admin access is required." }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

export async function PATCH(request: Request) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || body.userId || "").trim();
  const allowedCityPoolIds = Array.isArray(body.allowed_city_pool_ids)
    ? Array.from(new Set(body.allowed_city_pool_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean)))
    : [];

  if (!userId) return NextResponse.json({ message: "User is required." }, { status: 400 });

  const { data: existing } = await admin
    .from("user_access_settings")
    .select("allowed_pages, restrict_events_to_owner, restrict_crew_to_owner")
    .eq("user_id", userId)
    .maybeSingle();

  const existingRow = existing as { allowed_pages?: string[] | null; restrict_events_to_owner?: boolean | null; restrict_crew_to_owner?: boolean | null } | null;
  const { error } = await admin.from("user_access_settings").upsert({
    user_id: userId,
    allowed_pages: existingRow?.allowed_pages ?? ["overview", "coordinator", "events", "crew"],
    restrict_events_to_owner: existingRow?.restrict_events_to_owner ?? true,
    restrict_crew_to_owner: existingRow?.restrict_crew_to_owner ?? true,
    allowed_city_pool_ids: allowedCityPoolIds,
    updated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, allowed_city_pool_ids: allowedCityPoolIds });
}
