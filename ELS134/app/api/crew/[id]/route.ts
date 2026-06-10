import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

function phoneDigits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeRole(role: string | null | undefined) {
  const value = String(role || "viewer").toLowerCase().trim();
  if (["owner", "admin", "coordinator", "salesman", "sales", "viewer"].includes(value)) return value === "sales" ? "salesman" : value;
  return "viewer";
}

async function authContext() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = normalizeRole((profile as { role?: string | null } | null)?.role);
  return { ok: true as const, user, role };
}

function isOwnerAdmin(role: string) {
  return role === "owner" || role === "admin";
}

async function syncAdditionalCityPools(admin: ReturnType<typeof createSupabaseAdminClient>, crewId: string, ids: unknown) {
  const cityPoolIds = Array.isArray(ids) ? Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))) : [];
  const { error: deleteError } = await admin!.from("crew_city_pools").delete().eq("crew_id", crewId);
  if (deleteError && !deleteError.message.includes('relation "crew_city_pools" does not exist')) throw new Error(deleteError.message);
  if (!cityPoolIds.length || (deleteError && deleteError.message.includes('relation "crew_city_pools" does not exist'))) return;
  const { error } = await admin!.from("crew_city_pools").insert(cityPoolIds.map((city_pool_id) => ({ crew_id: crewId, city_pool_id })));
  if (error && !error.message.includes('relation "crew_city_pools" does not exist')) throw new Error(error.message);
}

async function requireSignedIn() {
  return authContext();
}


async function ensureCrewGroup(admin: ReturnType<typeof createSupabaseAdminClient>, cityPoolId: string | null | undefined, groupName: string | null | undefined) {
  const trimmedGroup = String(groupName || "").trim() || "Ungrouped";
  if (!cityPoolId || !admin) return;
  const { error } = await admin
    .from("crew_groups")
    .upsert({ city_pool_id: cityPoolId, name: trimmedGroup }, { onConflict: "city_pool_id,name" });
  if (error) {
    if (error.message.includes("relation \"crew_groups\" does not exist")) return;
    throw new Error(error.message);
  }
}
async function resolveCityPoolId(admin: ReturnType<typeof createSupabaseAdminClient>, cityPoolId: string | null | undefined, cityName: string | null | undefined) {
  if (cityPoolId) return cityPoolId;
  const trimmed = (cityName || "").trim();
  if (!trimmed || !admin) return null;
  const { data, error } = await admin.from("city_pools").upsert({ name: trimmed }, { onConflict: "name" }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  const body = await request.json();

  try {
    if (!isOwnerAdmin(auth.role)) {
      const { data: existingCrew } = await admin.from("crew").select("created_by").eq("id", id).maybeSingle();
      if (String((existingCrew as { created_by?: string | null } | null)?.created_by || "") !== auth.user.id) {
        return NextResponse.json({ message: "Coordinator access is limited to crew they added. Ask an admin to edit this contact." }, { status: 403 });
      }
    }
    const cityPoolId = await resolveCityPoolId(admin, body.city_pool_id, body.city_name);
    const nextGroupName = String(body.group_name || "Ungrouped").trim() || "Ungrouped";
    await ensureCrewGroup(admin, cityPoolId, nextGroupName);
    const { error: updateError } = await admin
      .from("crew")
      .update({
        name: String(body.name || "").trim(),
        description: String(body.description || "").trim() || null,
        city_pool_id: cityPoolId,
        group_name: nextGroupName,
        tier: String(body.tier || "").trim() || null,
        email: String(body.email || "").trim() || null,
        phone: String(body.phone || "").trim() || null,
        other_city: String(body.other_city || "").trim() || null,
        ob: Boolean(body.ob),
        blacklisted: Boolean(body.blacklisted),
        blacklist_reason: String(body.blacklist_reason || "").trim() || null,
        notes: String(body.notes || "").trim() || null,
        conflict_companies: Array.isArray(body.conflict_companies) ? body.conflict_companies.filter(Boolean) : [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) return NextResponse.json({ message: updateError.message }, { status: 400 });

    await admin.from("crew_positions").delete().eq("crew_id", id);
    await admin.from("crew_unavailable_dates").delete().eq("crew_id", id);

    const positions = Array.isArray(body.positions) ? body.positions : [];
    const unavailableDates = Array.isArray(body.unavailable_dates) ? body.unavailable_dates : [];

    if (positions.length) {
      const { error } = await admin.from("crew_positions").insert(
        positions
          .filter((position: { role_name?: string; rate?: number }) => String(position.role_name || "").trim())
          .map((position: { role_name: string; rate: number }) => ({
            crew_id: id,
            role_name: String(position.role_name).trim(),
            rate: Number(position.rate || 0),
          }))
      );
      if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    }

    if (unavailableDates.length) {
      const { error } = await admin.from("crew_unavailable_dates").insert(
        unavailableDates
          .filter((value: string) => String(value || "").trim())
          .map((value: string) => ({ crew_id: id, unavailable_date: value }))
      );
      if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    }

    await syncAdditionalCityPools(admin, id, body.additional_city_pool_ids);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to update crew member." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  if (!isOwnerAdmin(auth.role)) {
    const { data: existingCrew, error: existingError } = await admin.from("crew").select("created_by").eq("id", id).maybeSingle();
    if (existingError) return NextResponse.json({ message: existingError.message }, { status: 400 });
    if (String((existingCrew as { created_by?: string | null } | null)?.created_by || "") !== auth.user.id) {
      return NextResponse.json({ ok: false, protected: true, message: "Coordinator deletion is blocked for contacts they did not add. Ask an admin to archive or delete this contact." }, { status: 403 });
    }
    const hiddenPatch = { coordinator_hidden_at: new Date().toISOString(), coordinator_hidden_by: auth.user.id, updated_at: new Date().toISOString() };
    const { error: hideError } = await admin.from("crew").update(hiddenPatch).eq("id", id);
    if (hideError) {
      if (hideError.message.includes("coordinator_hidden_at") || hideError.message.includes("coordinator_hidden_by") || hideError.message.includes("schema cache")) {
        return NextResponse.json({ ok: false, message: "Coordinator soft-delete columns are missing. Run supabase/ELS127_required_migrations.sql, then retry." }, { status: 400 });
      }
      return NextResponse.json({ message: hideError.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, soft_deleted: true, message: "Contact removed from coordinator view. Admin records were preserved." });
  }
  const { error } = await admin.from("crew").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
