import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CityPoolRecord, CrewGroupRecord, CrewRecord } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { TechRatingRecord } from "@/lib/client-types";

export async function getCrewPageData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      cityPools: [] as CityPoolRecord[],
      crewGroups: [] as CrewGroupRecord[],
      crewRecords: [] as CrewRecord[],
      masterRates: [] as MasterRateRecord[],
      techRatings: [] as TechRatingRecord[],
      setupMissing: true,
      error: null as string | null,
    };
  }

  const [cityPoolsRes, crewGroupsRes, crewResInitial, positionsRes, unavailableRes, ratesRes, extraPoolsRes, ratingsRes] = await Promise.all([
    supabase.from("city_pools").select("id, name").order("name", { ascending: true }),
    supabase.from("crew_groups").select("id, city_pool_id, name").order("name", { ascending: true }),
    supabase
      .from("crew")
      .select("id, name, description, city_pool_id, group_name, tier, email, phone, other_city, ob, blacklisted, blacklist_reason, notes, conflict_companies")
      .order("name", { ascending: true }),
    supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }),
    supabase.from("crew_unavailable_dates").select("crew_id, unavailable_date").order("unavailable_date", { ascending: true }),
    supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").order("city_name", { ascending: true }).order("role_name", { ascending: true }),
    supabase.from("crew_city_pools").select("crew_id, city_pool_id"),
    supabase.from("tech_ratings").select("id, show_id, client_id, crew_id, assignment_id, rating, notes, created_at, updated_at").order("updated_at", { ascending: false }),
  ]);

  const crewBlacklistMissing = Boolean(crewResInitial.error && (crewResInitial.error.message.includes("blacklisted") || crewResInitial.error.message.includes("blacklist_reason")));
  const crewRes = crewBlacklistMissing
    ? await supabase
        .from("crew")
        .select("id, name, description, city_pool_id, group_name, tier, email, phone, other_city, ob, notes, conflict_companies")
        .order("name", { ascending: true })
    : crewResInitial;

  const crewGroupsMissing = Boolean(crewGroupsRes.error && crewGroupsRes.error.message.includes("relation \"crew_groups\" does not exist"));
  const ratesMissing = Boolean(ratesRes.error && ratesRes.error.message.includes('relation "master_rates" does not exist'));
  const extraPoolsMissing = Boolean(extraPoolsRes.error && extraPoolsRes.error.message.includes('relation "crew_city_pools" does not exist'));
  const ratingsMissing = Boolean(ratingsRes.error && ratingsRes.error.message.includes('relation "tech_ratings" does not exist'));
  const error = cityPoolsRes.error || (crewGroupsMissing ? null : crewGroupsRes.error) || crewRes.error || positionsRes.error || unavailableRes.error || (ratesMissing ? null : ratesRes.error) || (extraPoolsMissing ? null : extraPoolsRes.error) || (ratingsMissing ? null : ratingsRes.error);
  if (error) {
    return {
      cityPools: [] as CityPoolRecord[],
      crewGroups: [] as CrewGroupRecord[],
      crewRecords: [] as CrewRecord[],
      masterRates: [] as MasterRateRecord[],
      techRatings: [] as TechRatingRecord[],
      setupMissing: false,
      error: error.message,
    };
  }

  const cityPools = (cityPoolsRes.data ?? []) as CityPoolRecord[];
  const crewGroups = crewGroupsMissing ? ([] as CrewGroupRecord[]) : ((crewGroupsRes.data ?? []) as CrewGroupRecord[]);
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
      blacklisted?: boolean | null;
      blacklist_reason?: string | null;
      notes: string | null;
      conflict_companies: string[] | null;
    };

    return {
      id: typed.id,
      name: typed.name ?? "",
      description: typed.description ?? "",
      city_pool_id: typed.city_pool_id,
      city_name: typed.city_pool_id ? cityMap.get(typed.city_pool_id) ?? "Unassigned" : "Unassigned",
      additional_city_pool_ids: extraPoolsByCrew.get(typed.id) ?? [],
      additional_city_pool_names: (extraPoolsByCrew.get(typed.id) ?? []).map((poolId) => cityMap.get(poolId)).filter((name): name is string => Boolean(name)),
      group_name: typed.group_name ?? "Ungrouped",
      tier: typed.tier ?? "",
      email: typed.email ?? "",
      phone: typed.phone ?? "",
      other_city: typed.other_city ?? "",
      ob: Boolean(typed.ob),
      blacklisted: Boolean(typed.blacklisted),
      blacklist_reason: typed.blacklist_reason ?? "",
      notes: typed.notes ?? "",
      conflict_companies: typed.conflict_companies ?? [],
      positions: positionsByCrew.get(typed.id) ?? [],
      unavailable_dates: unavailableByCrew.get(typed.id) ?? [],
    } satisfies CrewRecord;
  });

  const masterRates = ratesMissing ? ([] as MasterRateRecord[]) : ((ratesRes.data ?? []) as MasterRateRecord[]);
  const techRatings = ratingsMissing ? [] : ((ratingsRes.data ?? []).map((row) => {
    const typed = row as Partial<TechRatingRecord> & { id: string; show_id: string; crew_id: string };
    return {
      id: typed.id,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      rating: Number(typed.rating || 0),
      notes: typed.notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
    } satisfies TechRatingRecord;
  }));

  return { cityPools, crewGroups, crewRecords, masterRates, techRatings, setupMissing: false, error: null as string | null };
}
