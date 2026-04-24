import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CityPoolRecord, CrewRecord } from "@/lib/crew-types";

export async function getCrewPageData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return { cityPools: [] as CityPoolRecord[], crewRecords: [] as CrewRecord[], setupMissing: true, error: null as string | null };
  }

  const [cityPoolsRes, crewRes, positionsRes, unavailableRes] = await Promise.all([
    supabase.from("city_pools").select("id, name").order("name", { ascending: true }),
    supabase
      .from("crew")
      .select("id, name, description, city_pool_id, group_name, tier, email, phone, other_city, ob, notes, conflict_companies")
      .order("name", { ascending: true }),
    supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }),
    supabase.from("crew_unavailable_dates").select("crew_id, unavailable_date").order("unavailable_date", { ascending: true }),
  ]);

  const error = cityPoolsRes.error || crewRes.error || positionsRes.error || unavailableRes.error;
  if (error) {
    return { cityPools: [] as CityPoolRecord[], crewRecords: [] as CrewRecord[], setupMissing: false, error: error.message };
  }

  const cityPools = (cityPoolsRes.data ?? []) as CityPoolRecord[];
  const cityMap = new Map(cityPools.map((pool) => [pool.id, pool.name]));

  const positionsByCrew = new Map<string, CrewRecord["positions"]>();
  for (const row of positionsRes.data ?? []) {
    const key = String((row as { crew_id: string }).crew_id);
    const list = positionsByCrew.get(key) ?? [];
    list.push({
      id: String((row as { id: string }).id),
      role_name: String((row as { role_name: string }).role_name ?? ""),
      rate: Number((row as { rate: number | string }).rate ?? 0),
    });
    positionsByCrew.set(key, list);
  }

  const unavailableByCrew = new Map<string, string[]>();
  for (const row of unavailableRes.data ?? []) {
    const key = String((row as { crew_id: string }).crew_id);
    const list = unavailableByCrew.get(key) ?? [];
    list.push(String((row as { unavailable_date: string }).unavailable_date));
    unavailableByCrew.set(key, list);
  }

  const crewRecords: CrewRecord[] = (crewRes.data ?? []).map((row) => {
    const typed = row as {
      id: string;
      name: string;
      description: string | null;
      city_pool_id: string | null;
      group_name: string | null;
      tier: string | null;
      email: string | null;
      phone: string | null;
      other_city: string | null;
      ob: boolean | null;
      notes: string | null;
      conflict_companies: string[] | null;
    };

    return {
      id: typed.id,
      name: typed.name ?? "",
      description: typed.description ?? "",
      city_pool_id: typed.city_pool_id,
      city_name: typed.city_pool_id ? cityMap.get(typed.city_pool_id) ?? "Unassigned" : "Unassigned",
      group_name: typed.group_name ?? "Ungrouped",
      tier: typed.tier ?? "",
      email: typed.email ?? "",
      phone: typed.phone ?? "",
      other_city: typed.other_city ?? "",
      ob: Boolean(typed.ob),
      notes: typed.notes ?? "",
      conflict_companies: typed.conflict_companies ?? [],
      positions: positionsByCrew.get(typed.id) ?? [],
      unavailable_dates: unavailableByCrew.get(typed.id) ?? [],
    } satisfies CrewRecord;
  });

  return { cityPools, crewRecords, setupMissing: false, error: null as string | null };
}
