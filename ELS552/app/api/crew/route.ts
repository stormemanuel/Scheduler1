import { NextResponse } from "next/server";
import { phoneDigitsForMatch, normalizePhoneForStorage } from "@/lib/crew-types";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { defaultNewCrewPositions, getDefaultCrewPayRate } from "@/lib/crew-pay-defaults";
import { assignedCrewIds, sharedCoordinatorUserIds } from "@/lib/auth";
import { directDepositReadyFromTaxNotes, taxNotesWithDirectDepositReady, taxNotesWithoutDirectDepositMarker } from "@/lib/crew-types";

function phoneDigits(value: string | null | undefined) {
  return phoneDigitsForMatch(value);
}

function normalizeRole(role: string | null | undefined) {
  const value = String(role || "viewer").toLowerCase().trim();
  if (["owner", "admin", "coordinator", "salesman", "sales", "viewer"].includes(value)) return value === "sales" ? "salesman" : value;
  return "viewer";
}

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type StoredCrewPosition = { id: string; role_name: string; rate: number };
type RequestedCrewPosition = { role_name: string; rate: number };

function canonicalCrewPositionName(value: unknown) {
  const original = String(value || "").replace(/\s+/g, " ").trim();
  const normalized = normalizeText(original);
  if (!normalized) return "";
  if (["general av", "general av tech", "general av technician", "gav", "general audio visual", "general audio visual tech", "general audio visual technician"].includes(normalized)) return "General AV";
  if (["avt working lead", "av tech working lead", "audio visual tech working lead", "general av working lead"].includes(normalized)) return "AVT / Working Lead";
  if (["led engineer", "led eng", "led engineering"].includes(normalized)) return "LED Engineer";
  if (["led stagehand", "led stage hand", "led assist", "led assistant", "led tech", "led technician"].includes(normalized)) return "LED Stagehand";
  if (["lighting stagehand", "lighting stage hand", "lighting assist", "lighting assistant"].includes(normalized)) return "Lighting Stagehand";
  if (["l2", "lighting tech l2", "lighting technician l2"].includes(normalized)) return "Lighting Tech L2";
  return original;
}

function crewPositionKey(value: unknown) {
  return normalizeText(canonicalCrewPositionName(value));
}

function crewPositionRate(roleName: string, value: unknown, existingRate = 0) {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (Number.isFinite(existingRate) && existingRate > 0) return existingRate;
  return Number(getDefaultCrewPayRate(roleName) || 0);
}

function normalizeRequestedCrewPositions(rawPositions: unknown, fallbackPositions: RequestedCrewPosition[] = []) {
  const requested = new Map<string, RequestedCrewPosition>();
  const addPosition = (rawPosition: unknown) => {
    const position = rawPosition as { role_name?: unknown; rate?: unknown };
    const roleName = canonicalCrewPositionName(position?.role_name);
    if (!roleName) return;
    const key = crewPositionKey(roleName);
    const existing = requested.get(key);
    requested.set(key, {
      role_name: roleName,
      rate: crewPositionRate(roleName, position?.rate, existing?.rate || 0),
    });
  };
  fallbackPositions.forEach(addPosition);
  if (Array.isArray(rawPositions)) rawPositions.forEach(addPosition);
  return Array.from(requested.values());
}

function assertCrewPositionsPersisted(storedPositions: StoredCrewPosition[], requestedPositions: RequestedCrewPosition[]) {
  const storedByKey = new Map(storedPositions.map((position) => [crewPositionKey(position.role_name), position]));
  const missing = requestedPositions.filter((position) => !storedByKey.has(crewPositionKey(position.role_name)));
  if (missing.length) {
    throw new Error(`Crew position save failed verification. Missing: ${missing.map((position) => position.role_name).join(", ")}.`);
  }
}

async function syncCrewPositionsSafely(admin: AdminClient, crewId: string, requestedPositions: RequestedCrewPosition[]) {
  const existingResult = await admin
    .from("crew_positions")
    .select("id, role_name, rate")
    .eq("crew_id", crewId);
  if (existingResult.error) throw new Error(existingResult.error.message);

  const existingPositions = (existingResult.data || []).map((row) => ({
    id: String((row as { id?: string }).id || ""),
    role_name: String((row as { role_name?: string | null }).role_name || ""),
    rate: Number((row as { rate?: number | string | null }).rate || 0),
  })).filter((position) => position.id && position.role_name);
  const existingByKey = new Map(existingPositions.map((position) => [crewPositionKey(position.role_name), position]));
  const retainedIds = new Set<string>();

  for (const requestedPosition of requestedPositions) {
    const key = crewPositionKey(requestedPosition.role_name);
    const existingPosition = existingByKey.get(key);
    const roleName = canonicalCrewPositionName(requestedPosition.role_name);
    const rate = crewPositionRate(roleName, requestedPosition.rate, existingPosition?.rate || 0);
    if (existingPosition?.id) {
      const updatePosition = await admin
        .from("crew_positions")
        .update({ role_name: roleName, rate })
        .eq("id", existingPosition.id)
        .eq("crew_id", crewId);
      if (updatePosition.error) throw new Error(`Position ${roleName} was not saved: ${updatePosition.error.message}`);
      retainedIds.add(existingPosition.id);
    } else {
      const insertPosition = await admin
        .from("crew_positions")
        .insert({ crew_id: crewId, role_name: roleName, rate })
        .select("id")
        .single();
      if (insertPosition.error) throw new Error(`Position ${roleName} was not saved: ${insertPosition.error.message}`);
      if (insertPosition.data?.id) retainedIds.add(String(insertPosition.data.id));
    }
  }

  const afterWriteResult = await admin
    .from("crew_positions")
    .select("id, role_name, rate")
    .eq("crew_id", crewId);
  if (afterWriteResult.error) throw new Error(afterWriteResult.error.message);
  const afterWritePositions = (afterWriteResult.data || []).map((row) => ({
    id: String((row as { id?: string }).id || ""),
    role_name: canonicalCrewPositionName((row as { role_name?: string | null }).role_name),
    rate: Number((row as { rate?: number | string | null }).rate || 0),
  })).filter((position) => position.id && position.role_name);
  assertCrewPositionsPersisted(afterWritePositions, requestedPositions);

  const removedPositionIds = existingPositions.map((position) => position.id).filter((positionId) => !retainedIds.has(positionId));
  if (removedPositionIds.length) {
    const removePositions = await admin.from("crew_positions").delete().in("id", removedPositionIds).eq("crew_id", crewId);
    if (removePositions.error) throw new Error(`New positions were saved, but removed positions could not be cleared: ${removePositions.error.message}`);
  }

  const finalResult = await admin
    .from("crew_positions")
    .select("id, role_name, rate")
    .eq("crew_id", crewId)
    .order("role_name", { ascending: true });
  if (finalResult.error) throw new Error(finalResult.error.message);
  const finalPositions = (finalResult.data || []).map((row) => ({
    id: String((row as { id?: string }).id || ""),
    role_name: canonicalCrewPositionName((row as { role_name?: string | null }).role_name),
    rate: Number((row as { rate?: number | string | null }).rate || getDefaultCrewPayRate((row as { role_name?: string | null }).role_name) || 0),
  })).filter((position) => position.id && position.role_name);
  assertCrewPositionsPersisted(finalPositions, requestedPositions);
  return finalPositions;
}

async function loadCrewRecordForResponse(admin: AdminClient, crewId: string, canViewPrivateTaxInfo: boolean) {
  const [crewRes, positionsRes, cityPoolsRes, extraPoolsRes, unavailableRes] = await Promise.all([
    admin.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, onboarding_status, w9_status, contract_status, questionnaire_status, tax_profile_status, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, tax_profile_notes, onboarding_request_sent_at, onboarding_completed_at, blacklisted, blacklist_reason, notes, conflict_companies, created_by, coordinator_hidden_at, coordinator_hidden_by, coordinator_hidden_reviewed_at").eq("id", crewId).maybeSingle(),
    admin.from("crew_positions").select("id, role_name, rate").eq("crew_id", crewId).order("role_name", { ascending: true }),
    admin.from("city_pools").select("id, name"),
    admin.from("crew_city_pools").select("city_pool_id").eq("crew_id", crewId),
    admin.from("crew_unavailable_dates").select("unavailable_date").eq("crew_id", crewId),
  ]);
  const extraPoolsMissing = Boolean(extraPoolsRes.error && extraPoolsRes.error.message.includes('relation "crew_city_pools" does not exist'));
  const error = crewRes.error || positionsRes.error || cityPoolsRes.error || unavailableRes.error || (extraPoolsMissing ? null : extraPoolsRes.error);
  if (error) throw new Error(error.message);
  if (!crewRes.data) throw new Error("Saved crew contact could not be read back from the database.");

  const cityMap = new Map((cityPoolsRes.data ?? []).map((pool) => [String((pool as { id: string }).id), String((pool as { name: string }).name)]));
  const typed = crewRes.data as { id: string; name: string | null; description: string | null; city_pool_id: string | null; group_name: string | null; tier: string | null; email: string | null; address?: string | null; lead_from?: string | null; phone: string | null; other_city: string | null; ob: boolean | null; onboarding_texted_called?: boolean | null; onboarding_response?: boolean | null; onboarding_paperwork_sent?: boolean | null; onboarding_successfully_onboarded?: boolean | null; onboarding_called_placed_tier?: boolean | null; onboarding_status?: string | null; w9_status?: string | null; contract_status?: string | null; questionnaire_status?: string | null; tax_profile_status?: string | null; profile_photo_url?: string | null; work_photo_urls?: string[] | null; w9_document_url?: string | null; contract_document_url?: string | null; tax_profile_notes?: string | null; onboarding_request_sent_at?: string | null; onboarding_completed_at?: string | null; blacklisted?: boolean | null; blacklist_reason?: string | null; notes: string | null; conflict_companies: string[] | null; created_by?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null; coordinator_hidden_reviewed_at?: string | null };
  const additionalCityPoolIds = extraPoolsMissing ? [] : (extraPoolsRes.data ?? []).map((row) => String((row as { city_pool_id?: string | null }).city_pool_id || "")).filter(Boolean);

  return stripPrivateOnboardingFields({
    id: typed.id,
    name: typed.name ?? "",
    description: typed.description ?? "",
    city_pool_id: typed.city_pool_id,
    city_name: typed.city_pool_id ? cityMap.get(typed.city_pool_id) ?? "Unassigned" : "Unassigned",
    additional_city_pool_ids: additionalCityPoolIds,
    additional_city_pool_names: additionalCityPoolIds.map((poolId) => cityMap.get(poolId)).filter(Boolean),
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
    onboarding_status: typed.onboarding_status || "not_started",
    w9_status: typed.w9_status || "missing",
    contract_status: typed.contract_status || "missing",
    questionnaire_status: typed.questionnaire_status || "missing",
    tax_profile_status: typed.tax_profile_status || "missing",
    profile_photo_url: typed.profile_photo_url || null,
    work_photo_urls: Array.isArray(typed.work_photo_urls) ? typed.work_photo_urls : [],
    w9_document_url: typed.w9_document_url || null,
    contract_document_url: typed.contract_document_url || null,
    tax_profile_notes: taxNotesWithoutDirectDepositMarker(typed.tax_profile_notes),
    direct_deposit_ready: directDepositReadyFromTaxNotes(typed.tax_profile_notes),
    onboarding_request_sent_at: typed.onboarding_request_sent_at || null,
    onboarding_completed_at: typed.onboarding_completed_at || null,
    blacklisted: Boolean(typed.blacklisted),
    blacklist_reason: typed.blacklist_reason ?? "",
    notes: typed.notes ?? "",
    conflict_companies: typed.conflict_companies ?? [],
    positions: (positionsRes.data ?? []).map((row) => ({
      id: String((row as { id?: string }).id || ""),
      role_name: canonicalCrewPositionName((row as { role_name?: string | null }).role_name),
      rate: Number((row as { rate?: number | string | null }).rate || getDefaultCrewPayRate((row as { role_name?: string | null }).role_name) || 0),
    })).filter((position) => position.id && position.role_name),
    unavailable_dates: (unavailableRes.data ?? []).map((row) => String((row as { unavailable_date?: string | null }).unavailable_date || "")).filter(Boolean),
    created_by: typed.created_by ?? null,
    assigned_coordinator_user_ids: [],
    coordinator_hidden_at: typed.coordinator_hidden_at ?? null,
    coordinator_hidden_by: typed.coordinator_hidden_by ?? null,
    coordinator_hidden_reviewed_at: typed.coordinator_hidden_reviewed_at ?? null,
  }, canViewPrivateTaxInfo);
}

function leadFromMatchesCurrentUser(value: unknown, auth: { user: { id: string; email?: string | null }; profile: { full_name?: string | null; email?: string | null } | null }) {
  const lead = normalizeText(value);
  if (!lead || !auth.user?.id) return false;
  const fullName = normalizeText(auth.profile?.full_name);
  const emailName = normalizeText(String(auth.profile?.email || auth.user.email || "").split("@")[0] || "");
  const firstName = fullName.split(" ")[0] || emailName.split(" ")[0] || "";
  return Boolean(
    (fullName && (lead === fullName || lead.includes(fullName) || fullName.includes(lead))) ||
    (emailName && lead === emailName) ||
    (firstName && lead === firstName)
  );
}

async function authContext() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("id, email, full_name, role, is_active").eq("id", user.id).maybeSingle();
  const role = normalizeRole((profile as { role?: string | null } | null)?.role);
  const { data: accessRow } = await supabase
    .from("user_access_settings")
    .select("restrict_crew_to_owner, allowed_city_pool_ids")
    .eq("user_id", user.id)
    .maybeSingle();
  const allowedCityPoolIds = Array.isArray((accessRow as { allowed_city_pool_ids?: unknown } | null)?.allowed_city_pool_ids)
    ? ((accessRow as { allowed_city_pool_ids?: string[] }).allowed_city_pool_ids || []).filter(Boolean)
    : [];
  const restrictCrewToOwner = Boolean((accessRow as { restrict_crew_to_owner?: boolean } | null)?.restrict_crew_to_owner ?? (role === "coordinator"));
  return { ok: true as const, user, profile: profile as { full_name?: string | null; email?: string | null; role?: string | null } | null, role, restrictCrewToOwner, allowedCityPoolIds, sharedCoordinatorUserIds: sharedCoordinatorUserIds(user), assignedCrewIds: assignedCrewIds(user) };
}

function isOwnerAdmin(role: string) {
  return role === "owner" || role === "admin";
}

function stripPrivateOnboardingFields<T extends Record<string, unknown>>(record: T, canViewPrivateTaxInfo: boolean): T {
  if (canViewPrivateTaxInfo) return record;
  return {
    ...record,
    // Coordinators may see operational onboarding progress for crew in their
    // own pool, but private files, tax data, and document locations stay hidden.
    profile_photo_url: null,
    work_photo_urls: [],
    w9_document_url: null,
    contract_document_url: null,
    tax_profile_notes: "",
    // Do not return document-specific or tax-profile status values to coordinators.
    // They receive only the overall onboarding summary and non-tax questionnaire progress.
    w9_status: "private",
    contract_status: "private",
    tax_profile_status: "private",
  };
}

async function ensureUserCityPoolAccess(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, cityPoolId: string | null | undefined) {
  if (!admin || !userId || !cityPoolId) return;
  const { data: existing } = await admin
    .from("user_access_settings")
    .select("allowed_pages, restrict_events_to_owner, restrict_crew_to_owner, allowed_city_pool_ids")
    .eq("user_id", userId)
    .maybeSingle();
  const row = existing as { allowed_pages?: string[] | null; restrict_events_to_owner?: boolean | null; restrict_crew_to_owner?: boolean | null; allowed_city_pool_ids?: string[] | null } | null;
  const existingIds = Array.isArray(row?.allowed_city_pool_ids) ? row!.allowed_city_pool_ids!.map(String).filter(Boolean) : [];
  if (existingIds.includes(cityPoolId)) return;
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
}

async function syncAdditionalCityPools(admin: ReturnType<typeof createSupabaseAdminClient>, crewId: string, ids: unknown) {
  const cityPoolIds = Array.isArray(ids) ? Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))) : [];
  const { error: deleteError } = await admin!.from("crew_city_pools").delete().eq("crew_id", crewId);
  if (deleteError && !deleteError.message.includes('relation "crew_city_pools" does not exist')) throw new Error(deleteError.message);
  if (!cityPoolIds.length || (deleteError && deleteError.message.includes('relation "crew_city_pools" does not exist'))) return;
  const { error } = await admin!.from("crew_city_pools").insert(cityPoolIds.map((city_pool_id) => ({ crew_id: crewId, city_pool_id })));
  if (error && !error.message.includes('relation "crew_city_pools" does not exist')) throw new Error(error.message);
}

async function syncAssignedCoordinators(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, crewId: string, ids: unknown) {
  const requestedIds = Array.isArray(ids) ? Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))) : [];
  const profiles = await admin.from("profiles").select("id, role, is_active");
  if (profiles.error) throw new Error(profiles.error.message);
  const coordinatorIds = new Set((profiles.data || [])
    .filter((row) => normalizeRole((row as { role?: string | null }).role) === "coordinator" && (row as { is_active?: boolean | null }).is_active !== false)
    .map((row) => String((row as { id?: string | null }).id || "")).filter(Boolean));
  if (requestedIds.some((id) => !coordinatorIds.has(id))) throw new Error("One or more selected coordinators is no longer active.");
  const authUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (authUsers.error) throw new Error(authUsers.error.message);
  for (const user of authUsers.data.users) {
    if (!coordinatorIds.has(user.id)) continue;
    const current = assignedCrewIds(user);
    const shouldInclude = requestedIds.includes(user.id);
    const next = shouldInclude ? Array.from(new Set([...current, crewId])) : current.filter((id) => id !== crewId);
    if (JSON.stringify(current.slice().sort()) === JSON.stringify(next.slice().sort())) continue;
    const updated = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...(user.user_metadata || {}), els_assigned_crew_ids: next },
    });
    if (updated.error) throw new Error(updated.error.message);
  }
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

function normalizeProfilePhotoPath(value: string | null | undefined) {
  let path = String(value || "").trim();
  if (!path) return "";
  try {
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
    }
  } catch {
    // Preserve the stored path when it is not a valid URL.
  }
  path = path.replace(/^\/+/, "");
  const objectMarker = "storage/v1/object/";
  const objectIndex = path.indexOf(objectMarker);
  if (objectIndex >= 0) path = path.slice(objectIndex + objectMarker.length);
  path = path.replace(/^public\//, "").replace(/^sign\//, "");
  if (path.startsWith("crew-profile-photos/")) path = path.slice("crew-profile-photos/".length);
  return path.replace(/^\/+/, "");
}

async function serveCrewProfilePhoto(auth: Awaited<ReturnType<typeof authContext>>, crewId: string) {
  if (!auth.ok) return auth.response;
  if (!crewId) return NextResponse.json({ message: "Crew contact is required." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "Supabase service role is not configured." }, { status: 500 });

  const { data: crew, error } = await admin
    .from("crew")
    .select("id, created_by, city_pool_id, lead_from, onboarding_status, profile_photo_url, coordinator_hidden_at, coordinator_hidden_by")
    .eq("id", crewId)
    .maybeSingle();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  if (!crew || String((crew as { onboarding_status?: string | null }).onboarding_status || "") === "pending_contact") {
    return NextResponse.json({ message: "Profile photo was not found." }, { status: 404 });
  }

  if (!isOwnerAdmin(auth.role)) {
    if (auth.role !== "coordinator") return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    const typed = crew as { created_by?: string | null; city_pool_id?: string | null; lead_from?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null; coordinator_hidden_reviewed_at?: string | null };
    if (typed.coordinator_hidden_at && typed.coordinator_hidden_by === auth.user.id) return NextResponse.json({ message: "Profile photo was not found." }, { status: 404 });

    const allowedPools = new Set(auth.allowedCityPoolIds);
    const sharedOwnerIds = new Set([auth.user.id, ...auth.sharedCoordinatorUserIds]);
    let allowed = auth.assignedCrewIds.includes(crewId) || sharedOwnerIds.has(String(typed.created_by || "")) || leadFromMatchesCurrentUser(typed.lead_from, auth) || Boolean(typed.city_pool_id && allowedPools.has(String(typed.city_pool_id)));
    if (!allowed) {
      const { data: extraPools } = await admin.from("crew_city_pools").select("city_pool_id").eq("crew_id", crewId);
      allowed = (extraPools ?? []).some((row) => allowedPools.has(String((row as { city_pool_id?: string | null }).city_pool_id || "")));
      if (!typed.city_pool_id && !(extraPools ?? []).length) allowed = true;
    }
    if (!allowed) return NextResponse.json({ message: "Forbidden." }, { status: 403 });
  }

  const path = normalizeProfilePhotoPath((crew as { profile_photo_url?: string | null }).profile_photo_url);
  if (!path) return NextResponse.json({ message: "Profile photo was not found." }, { status: 404 });

  const signed = await admin.storage.from("crew-profile-photos").createSignedUrl(path, 60 * 10);
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json({ message: signed.error?.message || "Unable to open profile photo." }, { status: 404 });
  }

  const response = NextResponse.redirect(signed.data.signedUrl, 302);
  response.headers.set("Cache-Control", "private, max-age=300");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  return response;
}

export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const photoCrewId = new URL(request.url).searchParams.get("profile_photo_for")?.trim() || "";
  if (photoCrewId) return serveCrewProfilePhoto(auth, photoCrewId);

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });

  const assignedCoordinatorIdsByCrew = new Map<string, string[]>();
  if (isOwnerAdmin(auth.role)) {
    const authUsers = await createSupabaseAdminClient()?.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authUsers && !authUsers.error) {
      for (const user of authUsers.data.users) {
        for (const crewId of assignedCrewIds(user)) assignedCoordinatorIdsByCrew.set(crewId, [...(assignedCoordinatorIdsByCrew.get(crewId) || []), user.id]);
      }
    }
  }
  const dataClient = createSupabaseAdminClient() || supabase;
  const [crewRes, positionsRes, cityPoolsRes, extraPoolsRes] = await Promise.all([
    // Do not let one absent optional migration column suppress all onboarding
    // fields in the Crew API response.
    dataClient.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, onboarding_status, w9_status, contract_status, questionnaire_status, tax_profile_status, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, tax_profile_notes, onboarding_request_sent_at, onboarding_completed_at, blacklisted, blacklist_reason, notes, conflict_companies, created_by, coordinator_hidden_at, coordinator_hidden_by, coordinator_hidden_reviewed_at").order("name", { ascending: true }),
    dataClient.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }),
    dataClient.from("city_pools").select("id, name"),
    dataClient.from("crew_city_pools").select("crew_id, city_pool_id"),
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

  let rawCrewRows = (crewRes.data ?? []).filter((row) => String((row as { onboarding_status?: string | null }).onboarding_status || "") !== "pending_contact");
  if (!isOwnerAdmin(auth.role) && auth.role === "coordinator") {
    const allowedPoolSet = new Set(auth.allowedCityPoolIds);
    const sharedOwnerIds = new Set([auth.user.id, ...auth.sharedCoordinatorUserIds]);
    rawCrewRows = rawCrewRows.filter((row) => {
      const typed = row as { created_by?: string | null; city_pool_id?: string | null; id?: string | null; lead_from?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null; coordinator_hidden_reviewed_at?: string | null };
      if (typed.coordinator_hidden_at && typed.coordinator_hidden_by === auth.user.id) return false;
      // Hard privacy boundary: checking/allowing a city pool gives a coordinator
      // access to that city workspace, not to Storm/admin master contacts in that city.
      return auth.assignedCrewIds.includes(String(typed.id || "")) || sharedOwnerIds.has(String(typed.created_by || "")) || leadFromMatchesCurrentUser(typed.lead_from, auth);
    });
  }

  const rows = rawCrewRows.map((row) => {
    const typed = row as { id: string; name: string | null; description: string | null; city_pool_id: string | null; group_name: string | null; tier: string | null; email: string | null; address?: string | null; lead_from?: string | null; phone: string | null; other_city: string | null; ob: boolean | null; onboarding_texted_called?: boolean | null; onboarding_response?: boolean | null; onboarding_paperwork_sent?: boolean | null; onboarding_successfully_onboarded?: boolean | null; onboarding_called_placed_tier?: boolean | null; onboarding_status?: string | null; w9_status?: string | null; contract_status?: string | null; questionnaire_status?: string | null; tax_profile_status?: string | null; profile_photo_url?: string | null; work_photo_urls?: string[] | null; w9_document_url?: string | null; contract_document_url?: string | null; tax_profile_notes?: string | null; onboarding_request_sent_at?: string | null; onboarding_completed_at?: string | null; blacklisted?: boolean | null; blacklist_reason?: string | null; notes: string | null; conflict_companies: string[] | null; created_by?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null; coordinator_hidden_reviewed_at?: string | null };
    return stripPrivateOnboardingFields({
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
      onboarding_status: typed.onboarding_status || "not_started",
      w9_status: typed.w9_status || "missing",
      contract_status: typed.contract_status || "missing",
      questionnaire_status: typed.questionnaire_status || "missing",
      tax_profile_status: typed.tax_profile_status || "missing",
      profile_photo_url: typed.profile_photo_url || null,
      work_photo_urls: Array.isArray(typed.work_photo_urls) ? typed.work_photo_urls : [],
      w9_document_url: typed.w9_document_url || null,
      contract_document_url: typed.contract_document_url || null,
      tax_profile_notes: taxNotesWithoutDirectDepositMarker(typed.tax_profile_notes),
      direct_deposit_ready: directDepositReadyFromTaxNotes(typed.tax_profile_notes),
      onboarding_request_sent_at: typed.onboarding_request_sent_at || null,
      onboarding_completed_at: typed.onboarding_completed_at || null,
      blacklisted: Boolean(typed.blacklisted),
      blacklist_reason: typed.blacklist_reason ?? "",
      notes: typed.notes ?? "",
      conflict_companies: typed.conflict_companies ?? [],
      positions: positionsByCrew.get(typed.id) ?? [],
      unavailable_dates: [],
      created_by: typed.created_by ?? null,
      assigned_coordinator_user_ids: assignedCoordinatorIdsByCrew.get(typed.id) ?? [],
      coordinator_hidden_at: typed.coordinator_hidden_at ?? null,
      coordinator_hidden_by: typed.coordinator_hidden_by ?? null,
      coordinator_hidden_reviewed_at: typed.coordinator_hidden_reviewed_at ?? null,
    }, isOwnerAdmin(auth.role));
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
    if (body.action === "normalize_phone_numbers") {
      if (!isOwnerAdmin(auth.role)) return NextResponse.json({ message: "Owner/admin access required." }, { status: 403 });
      const all: Array<{ id: string; name: string | null; phone: string | null }> = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await admin.from("crew").select("id,name,phone").order("id").range(offset, offset + 999);
        if (page.error) throw page.error;
        const rows = (page.data || []) as typeof all;
        all.push(...rows);
        if (rows.length < 1000) break;
      }
      const duplicates = new Map<string, Array<{ id: string; name: string }>>();
      let updated = 0;
      for (const row of all) {
        const key = phoneDigitsForMatch(row.phone);
        if (key) duplicates.set(key, [...(duplicates.get(key) || []), { id: row.id, name: row.name || "Unnamed crew" }]);
        const normalized = normalizePhoneForStorage(row.phone);
        if (normalized !== (row.phone || "")) {
          const saved = await admin.from("crew").update({ phone: normalized || null, updated_at: new Date().toISOString() }).eq("id", row.id);
          if (saved.error) throw saved.error;
          updated++;
        }
      }
      return NextResponse.json({ ok: true, scanned: all.length, updated, duplicates: Array.from(duplicates.entries()).filter(([, people]) => people.length > 1).map(([phone, people]) => ({ phone: normalizePhoneForStorage(phone), people })) });
    }
    if (body.action === "bulk_direct_deposit_ready") {
      if (!isOwnerAdmin(auth.role)) return NextResponse.json({ message: "Only owner/admin can update direct deposit readiness." }, { status: 403 });
      const crewIds = Array.isArray(body.crew_ids) ? Array.from(new Set<string>(body.crew_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean))) : [];
      if (!crewIds.length) return NextResponse.json({ message: "Select at least one crew contact." }, { status: 400 });
      const existing = await admin.from("crew").select("id,tax_profile_notes").in("id", crewIds);
      if (existing.error) throw existing.error;
      for (const row of existing.data || []) {
        const typed = row as { id: string; tax_profile_notes?: string | null };
        const update = await admin.from("crew").update({ tax_profile_notes: taxNotesWithDirectDepositReady(typed.tax_profile_notes, Boolean(body.ready)), updated_at: new Date().toISOString() }).eq("id", typed.id);
        if (update.error) throw update.error;
      }
      return NextResponse.json({ ok: true, updated: (existing.data || []).length, ready: Boolean(body.ready) });
    }
    const requestedCityPoolId = await resolveCityPoolId(admin, body.city_pool_id, body.city_name);
    const coordinatorOwned = !isOwnerAdmin(auth.role);
    const canWritePrivateTaxInfo = isOwnerAdmin(auth.role);
    // Coordinator-added crew should stay in the real staffing city / crew pool.
    // Their separate "Juan Martinez Pool" admin view is derived from created_by, not from a fake city pool.
    const cityPoolId = requestedCityPoolId;
    const nextGroupName = String(body.group_name || "Ungrouped").trim() || "Ungrouped";
    await ensureCrewGroup(admin, cityPoolId, nextGroupName);
    const nextEmail = String(body.email || "").trim();
    const nextPhone = normalizePhoneForStorage(body.phone);
    const nextPhoneDigits = phoneDigits(nextPhone);
    let existingCrewId = "";
    if (nextEmail) {
      const { data: emailMatch } = await admin.from("crew").select("id").ilike("email", nextEmail).limit(1).maybeSingle();
      if (emailMatch?.id) existingCrewId = String(emailMatch.id);
    }
    if (!existingCrewId && nextPhoneDigits) {
      const phoneRows: Array<{ id: string; name: string | null; email: string | null; phone: string | null }> = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await admin.from("crew").select("id,name,email,phone").order("id").range(offset, offset + 999);
        if (page.error) throw page.error;
        const rows = (page.data || []) as typeof phoneRows;
        phoneRows.push(...rows);
        if (rows.length < 1000) break;
      }
      const collisions = phoneRows.filter((row) => phoneDigits(row.phone) === nextPhoneDigits && row.id !== existingCrewId);
      const conflicting = collisions.filter((row) => normalizeText(row.name) !== normalizeText(body.name) || (nextEmail && row.email && row.email.toLowerCase() !== nextEmail.toLowerCase()));
      if (conflicting.length) return NextResponse.json({ message: `Phone number ${nextPhone} is already used by: ${conflicting.map((row) => row.name || "Unnamed crew").join(", ")}. Please verify the contact; no records were merged.`, conflicts: conflicting }, { status: 409 });
      if (!existingCrewId && collisions.length === 1 && normalizeText(collisions[0].name) === normalizeText(body.name)) existingCrewId = collisions[0].id;
    }
    if (existingCrewId) {
      const identity = await admin.from("crew").select("name,email").eq("id", existingCrewId).maybeSingle();
      if (identity.error) throw identity.error;
      if (identity.data && normalizeText(identity.data.name) !== normalizeText(body.name)) {
        return NextResponse.json({ message: `An existing contact (${identity.data.name}) uses this email or phone. No contacts were merged.`, conflicts: [identity.data] }, { status: 409 });
      }
    }
    const nextName = String(body.name || "").trim();
    // Exact-name matching is only safe when the incoming row has no durable contact
    // identifier. Two different technicians can have the same name; silently merging a
    // new email/phone into the older name match made the newly entered contact appear to
    // disappear later.
    if (!existingCrewId && !nextEmail && !nextPhoneDigits && nextName) {
      const { data: nameRows } = await admin.from("crew").select("id, name").limit(2000);
      const match = (nameRows ?? []).find((row) => String((row as { name?: string | null }).name || "").trim().toLowerCase() === nextName.toLowerCase());
      if (match) existingCrewId = String((match as { id: string }).id);
    }

    let existingCrew: Record<string, unknown> | null = null;
    let existingAdditionalCityPoolIds: string[] = [];
    let existingPositions: Array<{ role_name: string; rate: number }> = [];
    if (existingCrewId) {
      const { data: existingRow } = await admin.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, onboarding_status, w9_status, contract_status, questionnaire_status, tax_profile_status, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, tax_profile_notes, onboarding_request_sent_at, onboarding_completed_at, blacklisted, blacklist_reason, notes, conflict_companies, created_by").eq("id", existingCrewId).maybeSingle();
      existingCrew = existingRow as Record<string, unknown> | null;
      if (coordinatorOwned && String(existingCrew?.created_by || "") !== auth.user.id) {
        // Coordinators must never merge into or overwrite Storm/admin crew records.
        existingCrewId = "";
        existingCrew = null;
      } else {
        const { data: existingExtraPools } = await admin.from("crew_city_pools").select("city_pool_id").eq("crew_id", existingCrewId);
        existingAdditionalCityPoolIds = (existingExtraPools ?? []).map((row) => String((row as { city_pool_id: string }).city_pool_id)).filter(Boolean);
        const { data: existingPositionRows } = await admin.from("crew_positions").select("role_name, rate").eq("crew_id", existingCrewId);
        existingPositions = (existingPositionRows ?? []).map((row) => {
          const roleName = canonicalCrewPositionName((row as { role_name?: string | null }).role_name);
          return { role_name: roleName, rate: Number((row as { rate?: number | string | null }).rate || getDefaultCrewPayRate(roleName) || 0) };
        }).filter((row) => row.role_name);
      }
    }

    const existingPrimaryCityPoolId = existingCrew ? String(existingCrew.city_pool_id || "") : "";
    const finalPrimaryCityPoolId = existingCrewId && existingPrimaryCityPoolId ? existingPrimaryCityPoolId : cityPoolId;
    if (coordinatorOwned) await ensureUserCityPoolAccess(admin, auth.user.id, finalPrimaryCityPoolId);

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
      onboarding_status: canWritePrivateTaxInfo ? pickIncoming(String(body.onboarding_status || "").trim() || null, existingCrew?.onboarding_status as string | null | undefined) || "not_started" : String(existingCrew?.onboarding_status || "not_started"),
      w9_status: canWritePrivateTaxInfo ? pickIncoming(String(body.w9_status || "").trim() || null, existingCrew?.w9_status as string | null | undefined) || "missing" : String(existingCrew?.w9_status || "missing"),
      contract_status: canWritePrivateTaxInfo ? pickIncoming(String(body.contract_status || "").trim() || null, existingCrew?.contract_status as string | null | undefined) || "missing" : String(existingCrew?.contract_status || "missing"),
      questionnaire_status: canWritePrivateTaxInfo ? pickIncoming(String(body.questionnaire_status || "").trim() || null, existingCrew?.questionnaire_status as string | null | undefined) || "missing" : String(existingCrew?.questionnaire_status || "missing"),
      tax_profile_status: canWritePrivateTaxInfo ? pickIncoming(String(body.tax_profile_status || "").trim() || null, existingCrew?.tax_profile_status as string | null | undefined) || "missing" : String(existingCrew?.tax_profile_status || "missing"),
      profile_photo_url: canWritePrivateTaxInfo ? pickIncoming(String(body.profile_photo_url || "").trim() || null, existingCrew?.profile_photo_url as string | null | undefined) || null : existingCrew?.profile_photo_url || null,
      work_photo_urls: canWritePrivateTaxInfo ? (Array.isArray(body.work_photo_urls) ? body.work_photo_urls.map(String).filter(Boolean) : Array.isArray(existingCrew?.work_photo_urls) ? existingCrew?.work_photo_urls : []) : Array.isArray(existingCrew?.work_photo_urls) ? existingCrew?.work_photo_urls : [],
      w9_document_url: canWritePrivateTaxInfo ? pickIncoming(String(body.w9_document_url || "").trim() || null, existingCrew?.w9_document_url as string | null | undefined) || null : existingCrew?.w9_document_url || null,
      contract_document_url: canWritePrivateTaxInfo ? pickIncoming(String(body.contract_document_url || "").trim() || null, existingCrew?.contract_document_url as string | null | undefined) || null : existingCrew?.contract_document_url || null,
      tax_profile_notes: canWritePrivateTaxInfo ? taxNotesWithDirectDepositReady(pickIncoming(String(body.tax_profile_notes || "").trim() || null, taxNotesWithoutDirectDepositMarker(existingCrew?.tax_profile_notes)) || null, body.direct_deposit_ready === undefined ? directDepositReadyFromTaxNotes(existingCrew?.tax_profile_notes) : Boolean(body.direct_deposit_ready)) : existingCrew?.tax_profile_notes || null,
      onboarding_request_sent_at: canWritePrivateTaxInfo ? body.onboarding_request_sent_at || existingCrew?.onboarding_request_sent_at || null : existingCrew?.onboarding_request_sent_at || null,
      onboarding_completed_at: canWritePrivateTaxInfo ? body.onboarding_completed_at || existingCrew?.onboarding_completed_at || null : existingCrew?.onboarding_completed_at || null,
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
      await admin.from("crew_unavailable_dates").delete().eq("crew_id", existingCrewId);
    } else {
      const { data: crewRow, error: crewError } = await admin
        .from("crew")
        .insert({ ...crewPayload, created_by: auth.user.id, created_at: new Date().toISOString() })
        .select("id")
        .single();

      if (crewError) return NextResponse.json({ message: crewError.message }, { status: 400 });
      crewId = String(crewRow.id);
    }

    const incomingPositions = normalizeRequestedCrewPositions(body.positions);
    const finalPositions = existingCrewId
      ? normalizeRequestedCrewPositions(incomingPositions, existingPositions)
      : (incomingPositions.length ? incomingPositions : defaultNewCrewPositions());
    const unavailableDates = Array.isArray(body.unavailable_dates) ? body.unavailable_dates : [];

    const persistedPositions = await syncCrewPositionsSafely(admin, crewId, finalPositions);

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
    if (isOwnerAdmin(auth.role)) await syncAssignedCoordinators(admin, crewId, body.assigned_coordinator_user_ids);
    const savedRow = await loadCrewRecordForResponse(admin, crewId, canWritePrivateTaxInfo);
    assertCrewPositionsPersisted(savedRow.positions, persistedPositions);

    return NextResponse.json({ ok: true, id: crewId, merged, row: savedRow, positions: savedRow.positions });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to create crew member." }, { status: 500 });
  }
}
