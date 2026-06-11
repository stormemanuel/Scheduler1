import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, normalizeRole } from "@/lib/auth";
import type { CityPoolRecord, CrewGroupRecord, CrewRecord } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { AppUserSummaryRecord, TechRatingRecord } from "@/lib/client-types";

export async function getCrewPageData() {
  const session = await getSessionUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const restrictToOwner = Boolean(session.access?.restrict_crew_to_owner && role === "coordinator" && session.user?.id);
  const allowedPoolIds = new Set(session.access?.allowed_city_pool_ids ?? []);
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      cityPools: [] as CityPoolRecord[],
      crewGroups: [] as CrewGroupRecord[],
      crewRecords: [] as CrewRecord[],
      masterRates: [] as MasterRateRecord[],
      techRatings: [] as TechRatingRecord[],
      appUsers: [] as AppUserSummaryRecord[],
      currentUserId: session.user?.id || "",
      currentUserName: session.profile?.full_name || session.user?.email || "",
      currentUserRole: role,
      setupMissing: true,
      error: null as string | null,
    };
  }

  const [cityPoolsRes, crewGroupsRes, crewResInitial, positionsRes, unavailableRes, ratesRes, extraPoolsRes, ratingsRes, profilesRes, accessSettingsRes] = await Promise.all([
    supabase.from("city_pools").select("id, name").order("name", { ascending: true }),
    supabase.from("crew_groups").select("id, city_pool_id, name").order("name", { ascending: true }),
    supabase
      .from("crew")
      .select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, blacklisted, blacklist_reason, notes, conflict_companies, created_by, coordinator_hidden_at, coordinator_hidden_by")
      .order("name", { ascending: true }),
    supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }),
    supabase.from("crew_unavailable_dates").select("crew_id, unavailable_date").order("unavailable_date", { ascending: true }),
    supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").order("city_name", { ascending: true }).order("role_name", { ascending: true }),
    supabase.from("crew_city_pools").select("crew_id, city_pool_id"),
    supabase.from("tech_ratings").select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at").order("updated_at", { ascending: false }),
    supabase.from("profiles").select("id, email, full_name, role, is_active"),
    supabase.from("user_access_settings").select("user_id, restrict_crew_to_owner, allowed_city_pool_ids"),
  ]);

  const feedbackRatingsRes = await supabase
    .from("client_feedback_top_tech_ratings")
    .select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at, rating_source")
    .order("updated_at", { ascending: false });

  const crewBlacklistMissing = Boolean(crewResInitial.error && (crewResInitial.error.message.includes("blacklisted") || crewResInitial.error.message.includes("blacklist_reason") || crewResInitial.error.message.includes("created_by") || crewResInitial.error.message.includes("coordinator_hidden") || crewResInitial.error.message.includes("onboarding_") || crewResInitial.error.message.includes("lead_from") || crewResInitial.error.message.includes("address")));
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
  const feedbackRatingsMissing = Boolean(feedbackRatingsRes.error && (feedbackRatingsRes.error.message.includes('relation "client_feedback_top_tech_ratings" does not exist') || feedbackRatingsRes.error.message.includes('client_feedback_top_tech_ratings') || feedbackRatingsRes.error.message.includes('schema cache')));
  const profilesMissing = Boolean(profilesRes.error && (profilesRes.error.message.includes('relation "profiles" does not exist') || profilesRes.error.message.includes('schema cache')));
  const accessSettingsMissing = Boolean(accessSettingsRes.error && (accessSettingsRes.error.message.includes('relation "user_access_settings" does not exist') || accessSettingsRes.error.message.includes('schema cache')));
  const error = cityPoolsRes.error || (crewGroupsMissing ? null : crewGroupsRes.error) || crewRes.error || positionsRes.error || unavailableRes.error || (ratesMissing ? null : ratesRes.error) || (extraPoolsMissing ? null : extraPoolsRes.error) || (ratingsMissing ? null : ratingsRes.error) || (feedbackRatingsMissing ? null : feedbackRatingsRes.error) || (profilesMissing ? null : profilesRes.error) || (accessSettingsMissing ? null : accessSettingsRes.error);
  if (error) {
    return {
      cityPools: [] as CityPoolRecord[],
      crewGroups: [] as CrewGroupRecord[],
      crewRecords: [] as CrewRecord[],
      masterRates: [] as MasterRateRecord[],
      techRatings: [] as TechRatingRecord[],
      appUsers: [] as AppUserSummaryRecord[],
      currentUserId: session.user?.id || "",
      currentUserName: session.profile?.full_name || session.user?.email || "",
      currentUserRole: role,
      setupMissing: false,
      error: error.message,
    };
  }

  const cityPools = (cityPoolsRes.data ?? []) as CityPoolRecord[];
  const crewGroups = crewGroupsMissing ? ([] as CrewGroupRecord[]) : ((crewGroupsRes.data ?? []) as CrewGroupRecord[]);
  const accessByUserId = new Map<string, { allowed_city_pool_ids: string[]; restrict_crew_to_owner: boolean }>();
  if (!accessSettingsMissing) {
    for (const row of accessSettingsRes.data ?? []) {
      const typed = row as { user_id?: string | null; allowed_city_pool_ids?: string[] | null; restrict_crew_to_owner?: boolean | null };
      if (!typed.user_id) continue;
      accessByUserId.set(String(typed.user_id), {
        allowed_city_pool_ids: Array.isArray(typed.allowed_city_pool_ids) ? typed.allowed_city_pool_ids.filter(Boolean) : [],
        restrict_crew_to_owner: Boolean(typed.restrict_crew_to_owner),
      });
    }
  }
  const appUsers = profilesMissing ? ([] as AppUserSummaryRecord[]) : ((profilesRes.data ?? []).map((row) => {
    const typed = row as Partial<AppUserSummaryRecord> & { id: string };
    const access = accessByUserId.get(typed.id);
    return {
      id: typed.id,
      email: typed.email || "",
      full_name: typed.full_name || typed.email || "Unknown user",
      role: typed.role || "viewer",
      is_active: typed.is_active !== false,
      allowed_city_pool_ids: access?.allowed_city_pool_ids ?? [],
      restrict_crew_to_owner: access?.restrict_crew_to_owner ?? false,
    } satisfies AppUserSummaryRecord;
  }));
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

  const crewRecords: CrewRecord[] = (crewRes.data ?? []).filter((row) => {
    const typed = row as { id?: string | null; created_by?: string | null; city_pool_id?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null };
    if (role === "coordinator" && typed.coordinator_hidden_at && typed.coordinator_hidden_by === session.user?.id) return false;
    if (role === "coordinator") {
      const ownCrew = typed.created_by === session.user?.id;
      const primaryAllowed = Boolean(typed.city_pool_id && allowedPoolIds.has(typed.city_pool_id));
      const extraAllowed = (extraPoolsByCrew.get(String(typed.id || "")) ?? []).some((poolId) => allowedPoolIds.has(poolId));
      if (restrictToOwner || allowedPoolIds.size) return ownCrew || primaryAllowed || extraAllowed;
    }
    return true;
  }).map((row) => {
    const typed = row as {
      id: string;
      name: string;
      description: string | null;
      city_pool_id: string | null;
      group_name: string | null;
      tier: string | null;
      email: string | null;
      phone: string | null;
      address?: string | null;
      lead_from?: string | null;
      other_city: string | null;
      ob: boolean | null;
      onboarding_texted_called?: boolean | null;
      onboarding_response?: boolean | null;
      onboarding_paperwork_sent?: boolean | null;
      onboarding_successfully_onboarded?: boolean | null;
      onboarding_called_placed_tier?: boolean | null;
      blacklisted?: boolean | null;
      blacklist_reason?: string | null;
      notes: string | null;
      conflict_companies: string[] | null;
      created_by?: string | null;
      coordinator_hidden_at?: string | null;
      coordinator_hidden_by?: string | null;
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
      unavailable_dates: unavailableByCrew.get(typed.id) ?? [],
      created_by: typed.created_by ?? null,
      coordinator_hidden_at: typed.coordinator_hidden_at ?? null,
      coordinator_hidden_by: typed.coordinator_hidden_by ?? null,
    } satisfies CrewRecord;
  });

  const masterRates = ratesMissing ? ([] as MasterRateRecord[]) : ((ratesRes.data ?? []) as MasterRateRecord[]);
  const adminRatings = ratingsMissing ? [] : ((ratingsRes.data ?? []).map((row) => {
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
      rating_source: "admin",
    } satisfies TechRatingRecord;
  }));

  // Client-submitted survey ratings are stored in feedback_tech_ratings so they
  // can be excluded/restored with the submitted feedback form. Pull the cleaned
  // view here so crew contact rating averages include accepted client feedback.
  const feedbackRatings = feedbackRatingsMissing ? [] : ((feedbackRatingsRes.data ?? []).map((row) => {
    const typed = row as Partial<TechRatingRecord> & { id: string; show_id: string; crew_id: string };
    return {
      id: `feedback-${typed.id}`,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      rating: Number(typed.rating || 0),
      notes: typed.notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
      rating_source: typed.rating_source || "client_feedback",
    } satisfies TechRatingRecord;
  }));

  const techRatings = [...adminRatings, ...feedbackRatings];

  return { cityPools, crewGroups, crewRecords, masterRates, techRatings, appUsers, currentUserId: session.user?.id || "", currentUserName: session.profile?.full_name || session.user?.email || "", currentUserRole: role, setupMissing: false, error: null as string | null };
}
