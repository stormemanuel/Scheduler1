import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
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

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json();
  try {
    const cityPoolId = await resolveCityPoolId(admin, body.city_pool_id, body.city_name);
    const nextGroupName = String(body.group_name || "Ungrouped").trim() || "Ungrouped";
    await ensureCrewGroup(admin, cityPoolId, nextGroupName);
    const { data: crewRow, error: crewError } = await admin
      .from("crew")
      .insert({
        name: String(body.name || "").trim(),
        description: String(body.description || "").trim() || null,
        city_pool_id: cityPoolId,
        group_name: nextGroupName,
        tier: String(body.tier || "").trim() || null,
        email: String(body.email || "").trim() || null,
        phone: String(body.phone || "").trim() || null,
        other_city: String(body.other_city || "").trim() || null,
        ob: Boolean(body.ob),
        notes: String(body.notes || "").trim() || null,
        conflict_companies: Array.isArray(body.conflict_companies) ? body.conflict_companies.filter(Boolean) : [],
      })
      .select("id")
      .single();

    if (crewError) return NextResponse.json({ message: crewError.message }, { status: 400 });

    const crewId = String(crewRow.id);
    const positions = Array.isArray(body.positions) ? body.positions : [];
    const unavailableDates = Array.isArray(body.unavailable_dates) ? body.unavailable_dates : [];

    if (positions.length) {
      const { error } = await admin.from("crew_positions").insert(
        positions
          .filter((position: { role_name?: string; rate?: number }) => String(position.role_name || "").trim())
          .map((position: { role_name: string; rate: number }) => ({
            crew_id: crewId,
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
          .map((value: string) => ({ crew_id: crewId, unavailable_date: value }))
      );
      if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: crewId });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to create crew member." }, { status: 500 });
  }
}
