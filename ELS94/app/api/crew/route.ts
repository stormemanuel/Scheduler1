import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

function phoneDigits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
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

export async function GET() {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });

  const [crewRes, positionsRes, cityPoolsRes, extraPoolsRes] = await Promise.all([
    supabase.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, blacklisted, blacklist_reason, notes, conflict_companies").order("name", { ascending: true }),
    supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }),
    supabase.from("city_pools").select("id, name"),
    supabase.from("crew_city_pools").select("crew_id, city_pool_id"),
  ]);

  const extraPoolsMissing = Boolean(extraPoolsRes.error && extraPoolsRes.error.message.includes('relation "crew_city_pools" does not exist'));
  const error = crewRes.error || positionsRes.error || cityPoolsRes.error || (extraPoolsMissing ? null : extraPoolsRes.error);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  const cityMap = new Map((cityPoolsRes.data ?? []).map((pool) => [String((pool as {id:string}).id), String((pool as {name:string}).name)]));
  const extraPoolsByCrew = new Map<string, string[]>();
  if (!extraPoolsMissing) {
    for (const row of extraPoolsRes.data ?? []) {
      const key = String((row as { crew_id: string }).crew_id);
      const cityPoolId = String((row as { city_pool_id: string }).city_pool_id);
      const list = extraPoolsByCrew.get(key) ?? [];
      if (cityPoolId && !list.includes(cityPoolId)) list.push(cityPoolId);
      extraPoolsByCrew.set(key, list);
    }
  }

  const positionsByCrew = new Map<string, Array<{ id: string; role_name: string; rate: number }>>();
  for (const row of positionsRes.data ?? []) {
    const typed = row as { id: string; crew_id: string; role_name: string | null; rate: number | string | null };
    const list = positionsByCrew.get(typed.crew_id) ?? [];
    list.push({ id: typed.id, role_name: typed.role_name ?? "", rate: Number(typed.rate ?? 0) });
    positionsByCrew.set(typed.crew_id, list);
  }

  const rows = (crewRes.data ?? []).map((row) => {
    const typed = row as { id: string; name: string | null; description: string | null; city_pool_id: string | null; group_name: string | null; tier: string | null; email: string | null; phone: string | null; address?: string | null; lead_from?: string | null; other_city: string | null; ob: boolean | null; onboarding_texted_called?: boolean | null; onboarding_response?: boolean | null; onboarding_paperwork_sent?: boolean | null; onboarding_successfully_onboarded?: boolean | null; onboarding_called_placed_tier?: boolean | null; blacklisted?: boolean | null; blacklist_reason?: string | null; notes: string | null; conflict_companies: string[] | null };
    return {
      id: typed.id,
      name: typed.name ?? "",
      description: typed.description ?? "",
      city_pool_id: typed.city_pool_id,
      city_name: typed.city_pool_id ? cityMap.get(typed.city_pool_id) ?? "Unassigned" : "Unassigned",
      additional_city_pool_ids: extraPoolsByCrew.get(typed.id) ?? [],
      additional_city_pool_names: (extraPoolsByCrew.get(typed.id) ?? []).map((poolId) => cityMap.get(poolId)).filter(Boolean),
      group_name: typed.group_name ?? "Ungrouped",
      tier: typed.tier ?? "",
      email: typed.email ?? "",
      phone: typed.phone ?? "",
      address: typed.address ?? "",
      lead_from: typed.lead_from ?? "",
      other_city: typed.other_city ?? "",
      ob: Boolean(typed.ob),
      onboarding_texted_called: Boolean(typed.onboarding_texted_called),
      onboarding_response: Boolean(typed.onboarding_response),
      onboarding_paperwork_sent: Boolean(typed.onboarding_paperwork_sent),
      onboarding_successfully_onboarded: Boolean(typed.onboarding_successfully_onboarded),
      onboarding_called_placed_tier: Boolean(typed.onboarding_called_placed_tier),
      blacklisted: Boolean(typed.blacklisted),
      blacklist_reason: typed.blacklist_reason ?? "",
      notes: typed.notes ?? "",
      conflict_companies: typed.conflict_companies ?? [],
      positions: positionsByCrew.get(typed.id) ?? [],
    };
  });

  return NextResponse.json({ ok: true, rows });
}


function pickIncoming<T>(incoming: T | null | undefined, existing: T | null | undefined) {
  if (typeof incoming === "string") return incoming.trim() ? incoming : (existing ?? incoming);
  if (Array.isArray(incoming)) return incoming.length ? incoming : (Array.isArray(existing) ? existing : incoming);
  if (incoming === null || incoming === undefined) return existing ?? incoming;
  return incoming;
}

function mergeBoolean(incoming: unknown, existing: unknown) {
  return Boolean(incoming) || Boolean(existing);
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
    const nextEmail = String(body.email || "").trim();
    const nextPhone = String(body.phone || "").trim();
    const nextPhoneDigits = phoneDigits(nextPhone);
    let existingCrewId = "";
    if (nextEmail) {
      const { data: emailMatch } = await admin.from("crew").select("id").ilike("email", nextEmail).limit(1).maybeSingle();
      if (emailMatch?.id) existingCrewId = String(emailMatch.id);
    }
    if (!existingCrewId && nextPhoneDigits) {
      const { data: phoneRows } = await admin.from("crew").select("id, phone").limit(2000);
      const match = (phoneRows ?? []).find((row) => phoneDigits((row as { phone?: string | null }).phone) === nextPhoneDigits);
      if (match) existingCrewId = String((match as { id: string }).id);
    }
    const nextName = String(body.name || "").trim();
    if (!existingCrewId && nextName) {
      const { data: nameRows } = await admin.from("crew").select("id, name").limit(2000);
      const match = (nameRows ?? []).find((row) => String((row as { name?: string | null }).name || "").trim().toLowerCase() === nextName.toLowerCase());
      if (match) existingCrewId = String((match as { id: string }).id);
    }

    let existingCrew: Record<string, unknown> | null = null;
    let existingAdditionalCityPoolIds: string[] = [];
    let existingPositions: Array<{ role_name: string; rate: number }> = [];
    if (existingCrewId) {
      const { data: existingRow } = await admin.from("crew").select("*").eq("id", existingCrewId).maybeSingle();
      existingCrew = existingRow as Record<string, unknown> | null;
      const { data: existingExtraPools } = await admin.from("crew_city_pools").select("city_pool_id").eq("crew_id", existingCrewId);
      existingAdditionalCityPoolIds = (existingExtraPools ?? []).map((row) => String((row as { city_pool_id: string }).city_pool_id)).filter(Boolean);
      const { data: existingPositionRows } = await admin.from("crew_positions").select("role_name, rate").eq("crew_id", existingCrewId);
      existingPositions = (existingPositionRows ?? []).map((row) => ({ role_name: String((row as { role_name?: string | null }).role_name || ""), rate: Number((row as { rate?: number | string | null }).rate || 0) })).filter((row) => row.role_name);
    }

    const existingPrimaryCityPoolId = existingCrew ? String(existingCrew.city_pool_id || "") : "";
    const finalPrimaryCityPoolId = existingCrewId && existingPrimaryCityPoolId ? existingPrimaryCityPoolId : cityPoolId;

    const crewPayload = {
      name: String(pickIncoming(String(body.name || "").trim(), existingCrew?.name as string | null | undefined) || "").trim(),
      description: pickIncoming(String(body.description || "").trim() || null, existingCrew?.description as string | null | undefined) || null,
      city_pool_id: finalPrimaryCityPoolId,
      group_name: pickIncoming(nextGroupName, existingCrew?.group_name as string | null | undefined) || "Ungrouped",
      tier: pickIncoming(String(body.tier || "").trim() || null, existingCrew?.tier as string | null | undefined) || null,
      email: pickIncoming(nextEmail || null, existingCrew?.email as string | null | undefined) || null,
      phone: pickIncoming(nextPhone || null, existingCrew?.phone as string | null | undefined) || null,
      address: pickIncoming(String(body.address || "").trim() || null, existingCrew?.address as string | null | undefined) || null,
      lead_from: pickIncoming(String(body.lead_from || "").trim() || null, existingCrew?.lead_from as string | null | undefined) || null,
      other_city: pickIncoming(String(body.other_city || "").trim() || null, existingCrew?.other_city as string | null | undefined) || null,
      ob: mergeBoolean(body.ob, existingCrew?.ob),
      onboarding_texted_called: mergeBoolean(body.onboarding_texted_called, existingCrew?.onboarding_texted_called),
      onboarding_response: mergeBoolean(body.onboarding_response, existingCrew?.onboarding_response),
      onboarding_paperwork_sent: mergeBoolean(body.onboarding_paperwork_sent, existingCrew?.onboarding_paperwork_sent),
      onboarding_successfully_onboarded: mergeBoolean(body.onboarding_successfully_onboarded, existingCrew?.onboarding_successfully_onboarded),
      onboarding_called_placed_tier: mergeBoolean(body.onboarding_called_placed_tier, existingCrew?.onboarding_called_placed_tier),
      blacklisted: mergeBoolean(body.blacklisted, existingCrew?.blacklisted),
      blacklist_reason: pickIncoming(String(body.blacklist_reason || "").trim() || null, existingCrew?.blacklist_reason as string | null | undefined) || null,
      notes: [String(existingCrew?.notes || "").trim(), String(body.notes || "").trim()].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join("\n\n") || null,
      conflict_companies: Array.from(new Set([...(Array.isArray(existingCrew?.conflict_companies) ? existingCrew?.conflict_companies as string[] : []), ...(Array.isArray(body.conflict_companies) ? body.conflict_companies.filter(Boolean) : [])])),
      updated_at: new Date().toISOString(),
    };

    let crewId = existingCrewId;
    let merged = Boolean(existingCrewId);
    if (existingCrewId) {
      const { error: updateExistingError } = await admin.from("crew").update(crewPayload).eq("id", existingCrewId);
      if (updateExistingError) return NextResponse.json({ message: updateExistingError.message }, { status: 400 });
      await admin.from("crew_positions").delete().eq("crew_id", existingCrewId);
      await admin.from("crew_unavailable_dates").delete().eq("crew_id", existingCrewId);
    } else {
      const { data: crewRow, error: crewError } = await admin
        .from("crew")
        .insert({ ...crewPayload, created_at: new Date().toISOString() })
        .select("id")
        .single();

      if (crewError) return NextResponse.json({ message: crewError.message }, { status: 400 });
      crewId = String(crewRow.id);
    }

    const incomingPositions = Array.isArray(body.positions) ? body.positions : [];
    const positionMap = new Map<string, { role_name: string; rate: number }>();
    for (const position of existingPositions) {
      const key = String(position.role_name || "").trim().toLowerCase();
      if (key) positionMap.set(key, { role_name: position.role_name, rate: Number(position.rate || 0) });
    }
    for (const position of incomingPositions) {
      const roleName = String((position as { role_name?: string }).role_name || "").trim();
      if (!roleName) continue;
      const key = roleName.toLowerCase();
      const rate = Number((position as { rate?: number }).rate || 0);
      positionMap.set(key, { role_name: roleName, rate: rate || positionMap.get(key)?.rate || 0 });
    }
    const positions = Array.from(positionMap.values());
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

    const incomingAdditionalCityPoolIds = Array.isArray(body.additional_city_pool_ids) ? body.additional_city_pool_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean) : [];
    const importedPrimaryAsAdditional = existingCrewId && cityPoolId && cityPoolId !== finalPrimaryCityPoolId ? [cityPoolId] : [];
    await syncAdditionalCityPools(admin, crewId, Array.from(new Set([...existingAdditionalCityPoolIds, ...incomingAdditionalCityPoolIds, ...importedPrimaryAsAdditional])).filter((id) => id !== finalPrimaryCityPoolId));

    return NextResponse.json({ ok: true, id: crewId, merged });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to create crew member." }, { status: 500 });
  }
}
