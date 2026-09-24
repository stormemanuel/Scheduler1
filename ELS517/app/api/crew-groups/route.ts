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

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile, error } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) return { ok: false as const, response: NextResponse.json({ message: error.message }, { status: 400 }) };
  return { ok: true as const, user, role: normalizeRole((profile as { role?: string | null } | null)?.role) };
}

function crewGroupsMissingMessage(errorMessage: string) {
  return errorMessage.includes('relation "crew_groups" does not exist')
    ? "Run the crew groups migration once to enable saved subgroups."
    : errorMessage;
}

async function coordinatorHasPoolAccess(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, cityPoolId: string) {
  if (!admin || !userId || !cityPoolId) return false;
  const { data, error } = await admin
    .from("user_access_settings")
    .select("allowed_city_pool_ids")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.message.includes('relation "user_access_settings" does not exist') || error.message.includes("schema cache")) return false;
    throw new Error(error.message);
  }
  const allowed = (data as { allowed_city_pool_ids?: unknown } | null)?.allowed_city_pool_ids;
  return Array.isArray(allowed) && allowed.map(String).includes(cityPoolId);
}

function scopedOwnerUserId(role: string, authUserId: string, requestedOwnerUserId: unknown) {
  if (!isOwnerAdmin(role)) return authUserId;
  const trimmed = String(requestedOwnerUserId || "").trim();
  return trimmed || null;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json();
  const cityPoolId = String(body.city_pool_id || "").trim();
  const name = String(body.name || "").trim() || "Ungrouped";

  if (!cityPoolId) return NextResponse.json({ message: "City pool is required." }, { status: 400 });
  if (!isOwnerAdmin(auth.role) && !(await coordinatorHasPoolAccess(admin, auth.user.id, cityPoolId))) {
    return NextResponse.json({ message: "This city pool is not assigned to your coordinator account." }, { status: 403 });
  }

  const { data, error } = await admin
    .from("crew_groups")
    .upsert({ city_pool_id: cityPoolId, name }, { onConflict: "city_pool_id,name" })
    .select("id, city_pool_id, name")
    .single();

  if (error) {
    if (error.message.includes('relation "crew_groups" does not exist')) {
      return NextResponse.json({ message: crewGroupsMissingMessage(error.message) }, { status: 400 });
    }
    return NextResponse.json({ message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, group: data });
}

export async function PATCH(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json();
  const cityPoolId = String(body.city_pool_id || "").trim();
  const oldName = String(body.old_name || "").trim() || "Ungrouped";
  const nextName = String(body.name || "").trim() || "Ungrouped";
  const ownerUserId = scopedOwnerUserId(auth.role, auth.user.id, body.owner_user_id);

  if (!cityPoolId) return NextResponse.json({ message: "City pool is required." }, { status: 400 });
  if (!oldName) return NextResponse.json({ message: "Current group name is required." }, { status: 400 });
  if (!nextName) return NextResponse.json({ message: "New group name is required." }, { status: 400 });
  if (!isOwnerAdmin(auth.role) && !(await coordinatorHasPoolAccess(admin, auth.user.id, cityPoolId))) {
    return NextResponse.json({ message: "This city pool is not assigned to your coordinator account." }, { status: 403 });
  }

  if (oldName === nextName) {
    return NextResponse.json({ ok: true, group: { id: "same-name", city_pool_id: cityPoolId, name: nextName }, moved: 0 });
  }

  const { data: targetGroup, error: upsertError } = await admin
    .from("crew_groups")
    .upsert({ city_pool_id: cityPoolId, name: nextName }, { onConflict: "city_pool_id,name" })
    .select("id, city_pool_id, name")
    .single();

  if (upsertError) {
    return NextResponse.json({ message: crewGroupsMissingMessage(upsertError.message) }, { status: 400 });
  }

  let updateQuery = admin
    .from("crew")
    .update({ group_name: nextName, updated_at: new Date().toISOString() })
    .eq("city_pool_id", cityPoolId)
    .eq("group_name", oldName);

  if (ownerUserId) updateQuery = updateQuery.eq("created_by", ownerUserId);

  const { data: movedRows, error: crewError } = await updateQuery.select("id");
  if (crewError) return NextResponse.json({ message: crewError.message }, { status: 400 });

  // Only admin/owner in Master Pool may remove the old shared group row.
  // Coordinator-scoped rename only changes that coordinator's contacts.
  if (isOwnerAdmin(auth.role) && !ownerUserId) {
    const { error: deleteError } = await admin
      .from("crew_groups")
      .delete()
      .eq("city_pool_id", cityPoolId)
      .eq("name", oldName);

    if (deleteError) return NextResponse.json({ message: deleteError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, group: targetGroup, moved: movedRows?.length ?? 0 });
}

export async function DELETE(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const cityPoolId = String(body.city_pool_id || "").trim();
  const groupName = String(body.name || "").trim() || "Ungrouped";
  const ownerUserId = scopedOwnerUserId(auth.role, auth.user.id, body.owner_user_id);

  if (!cityPoolId) return NextResponse.json({ message: "City pool is required." }, { status: 400 });
  if (!groupName || groupName === "Ungrouped") return NextResponse.json({ message: "Choose a saved group to remove." }, { status: 400 });
  if (!isOwnerAdmin(auth.role) && !(await coordinatorHasPoolAccess(admin, auth.user.id, cityPoolId))) {
    return NextResponse.json({ message: "This city pool is not assigned to your coordinator account." }, { status: 403 });
  }

  let updateQuery = admin
    .from("crew")
    .update({ group_name: "Ungrouped", updated_at: new Date().toISOString() })
    .eq("city_pool_id", cityPoolId)
    .eq("group_name", groupName);

  if (ownerUserId) updateQuery = updateQuery.eq("created_by", ownerUserId);

  const { data: movedRows, error: crewError } = await updateQuery.select("id");
  if (crewError) return NextResponse.json({ message: crewError.message }, { status: 400 });

  if (isOwnerAdmin(auth.role) && !ownerUserId) {
    const { error: deleteError } = await admin
      .from("crew_groups")
      .delete()
      .eq("city_pool_id", cityPoolId)
      .eq("name", groupName);
    if (deleteError && !deleteError.message.includes('relation "crew_groups" does not exist')) {
      return NextResponse.json({ message: deleteError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, moved: movedRows?.length ?? 0, group_name: groupName });
}
