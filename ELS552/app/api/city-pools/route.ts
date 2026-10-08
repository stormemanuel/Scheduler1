import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

function normalizeRole(role: string | null | undefined) {
  const value = String(role || "viewer").toLowerCase().trim();
  if (["owner", "admin", "coordinator", "salesman", "sales", "viewer"].includes(value)) return value === "sales" ? "salesman" : value;
  return "viewer";
}

function isOwnerAdmin(role: string) {
  return role === "owner" || role === "admin";
}

async function authContext() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) return { ok: false as const, response: NextResponse.json({ message: error.message }, { status: 400 }) };
  return { ok: true as const, user, role: normalizeRole((profile as { role?: string | null } | null)?.role) };
}

function requireOwnerAdminResponse(role: string) {
  if (isOwnerAdmin(role)) return null;
  return NextResponse.json({ message: "Only admin/owner can rename or permanently delete city pools. Coordinator users can remove a pool from their own view only." }, { status: 403 });
}

async function addPoolToCurrentUserAccess(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, cityPoolId: string) {
  if (!admin || !userId || !cityPoolId) return [] as string[];
  const { data: existing } = await admin
    .from("user_access_settings")
    .select("allowed_pages, restrict_events_to_owner, restrict_crew_to_owner, allowed_city_pool_ids")
    .eq("user_id", userId)
    .maybeSingle();
  const row = existing as { allowed_pages?: string[] | null; restrict_events_to_owner?: boolean | null; restrict_crew_to_owner?: boolean | null; allowed_city_pool_ids?: string[] | null } | null;
  const existingIds = Array.isArray(row?.allowed_city_pool_ids) ? row!.allowed_city_pool_ids!.map(String).filter(Boolean) : [];
  const nextIds = Array.from(new Set([...existingIds, cityPoolId]));
  const { error } = await admin.from("user_access_settings").upsert({
    user_id: userId,
    allowed_pages: row?.allowed_pages ?? ["overview", "coordinator", "events", "crew", "onboarding"],
    restrict_events_to_owner: row?.restrict_events_to_owner ?? true,
    restrict_crew_to_owner: row?.restrict_crew_to_owner ?? true,
    allowed_city_pool_ids: nextIds,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return nextIds;
}

export async function POST(request: Request) {
  const auth = await authContext();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json();
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ message: "City name is required." }, { status: 400 });

  const { data, error } = await admin
    .from("city_pools")
    .upsert({ name }, { onConflict: "name" })
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  try {
    const allowedCityPoolIds = isOwnerAdmin(auth.role) ? undefined : await addPoolToCurrentUserAccess(admin, auth.user.id, String(data.id));
    return NextResponse.json({ ok: true, cityPool: data, allowed_city_pool_ids: allowedCityPoolIds });
  } catch (accessError) {
    return NextResponse.json({ message: accessError instanceof Error ? accessError.message : "City pool was created, but could not be added to this coordinator account." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const auth = await authContext();
  if (!auth.ok) return auth.response;
  const ownerAdminError = requireOwnerAdminResponse(auth.role);
  if (ownerAdminError) return ownerAdminError;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  const name = String(body.name || "").trim();
  if (!id) return NextResponse.json({ message: "City pool id is required." }, { status: 400 });
  if (!name) return NextResponse.json({ message: "City pool name is required." }, { status: 400 });

  const { data, error } = await admin
    .from("city_pools")
    .update({ name })
    .eq("id", id)
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, cityPool: data });
}

export async function DELETE(request: Request) {
  const auth = await authContext();
  if (!auth.ok) return auth.response;
  const ownerAdminError = requireOwnerAdminResponse(auth.role);
  if (ownerAdminError) return ownerAdminError;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ message: "City pool id is required." }, { status: 400 });

  await admin.from("crew").update({ city_pool_id: null }).eq("city_pool_id", id);
  const { error: extraDeleteError } = await admin.from("crew_city_pools").delete().eq("city_pool_id", id);
  if (extraDeleteError && !extraDeleteError.message.includes('relation "crew_city_pools" does not exist')) {
    return NextResponse.json({ message: extraDeleteError.message }, { status: 400 });
  }

  const { error } = await admin
    .from("city_pools")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
