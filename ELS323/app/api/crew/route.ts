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
  return { ok: true as const, user, profile: profile as { full_name?: string | null; email?: string | null; role?: string | null } | null, role, restrictCrewToOwner, allowedCityPoolIds };
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
    .select("id, created_by, city_pool_id, onboarding_status, profile_photo_url, coordinator_hidden_at, coordinator_hidden_by")
    .eq("id", crewId)
    .maybeSingle();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  if (!crew || String((crew as { onboarding_status?: string | null }).onboarding_status || "") === "pending_contact") {
    return NextResponse.json({ message: "Profile photo was not found." }, { status: 404 });
  }

  if (!isOwnerAdmin(auth.role)) {
    if (auth.role !== "coordinator") return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    const typed = crew as { created_by?: string | null; city_pool_id?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null; coordinator_hidden_reviewed_at?: string | null };
    if (String(typed.created_by || "") !== auth.user.id) return NextResponse.json({ message: "Forbidden." }, { status: 403 });
    if (typed.coordinator_hidden_at && typed.coordinator_hidden_by === auth.user.id) return NextResponse.json({ message: "Profile photo was not found." }, { status: 404 });

    const allowedPools = new Set(auth.allowedCityPoolIds);
    let allowed = Boolean(typed.city_pool_id && allowedPools.has(String(typed.city_pool_id)));
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
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
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

  const [crewRes, positionsRes, cityPoolsRes, extraPoolsRes] = await Promise.all([
    // Do not let one absent optional migration column suppress all onboarding
    // fields in the Crew API response.
    supabase.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, onboarding_status, w9_status, contract_status, questionnaire_status, tax_profile_status, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, tax_profile_notes, onboarding_request_sent_at, onboarding_completed_at, blacklisted, blacklist_reason, notes, conflict_companies, created_by, coordinator_hidden_at, coordinator_hidden_by, coordinator_hidden_reviewed_at").order("name", { ascending: true }),
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

  let rawCrewRows = (crewRes.data ?? []).filter((row) => String((row as { onboarding_status?: string | null }).onboarding_status || "") !== "pending_contact");
  if (!isOwnerAdmin(auth.role) && auth.role === "coordinator") {
    const allowedPoolSet = new Set(auth.allowedCityPoolIds);
    rawCrewRows = rawCrewRows.filter((row) => {
      const typed = row as { created_by?: string | null; city_pool_id?: string | null; id?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null; coordinator_hidden_reviewed_at?: string | null };
      if (typed.coordinator_hidden_at && typed.coordinator_hidden_by === auth.user.id) return false;
      // Hard privacy boundary: checking/allowing a city pool gives a coordinator
      // access to that city workspace, not to Storm/admin master contacts in that city.
      if (String(typed.created_by || "") !== auth.user.id) return false;
      const extraPoolIds = extraPoolsByCrew.get(String(typed.id || "")) ?? [];
      const primaryAllowed = Boolean(typed.city_pool_id && allowedPoolSet.has(String(typed.city_pool_id)));
      const extraAllowed = extraPoolIds.some((poolId) => allowedPoolSet.has(poolId));
      const ownUnassignedCrew = !typed.city_pool_id && extraPoolIds.length === 0;
      return primaryAllowed || extraAllowed || ownUnassignedCrew;
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
      tax_profile_notes: typed.tax_profile_notes || "",
      onboarding_request_sent_at: typed.onboarding_request_sent_at || null,
      onboarding_completed_at: typed.onboarding_completed_at || null,
      blacklisted: Boolean(typed.blacklisted),
      blacklist_reason: typed.blacklist_reason ?? "",
      notes: typed.notes ?? "",
      conflict_companies: typed.conflict_companies ?? [],
      positions: positionsByCrew.get(typed.id) ?? [],
      unavailable_dates: [],
      created_by: typed.created_by ?? null,
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
    const requestedCityPoolId = await resolveCityPoolId(admin, body.city_pool_id, body.city_name);
    const coordinatorOwned = !isOwnerAdmin(auth.role);
    const canWritePrivateTaxInfo = isOwnerAdmin(auth.role);
    // Coordinator-added crew should stay in the real staffing city / crew pool.
    // Their separate "Juan Martinez Pool" admin view is derived from created_by, not from a fake city pool.
    const cityPoolId = requestedCityPoolId;
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
        existingPositions = (existingPositionRows ?? []).map((row) => ({ role_name: String((row as { role_name?: string | null }).role_name || ""), rate: Number((row as { rate?: number | string | null }).rate || 0) })).filter((row) => row.role_name);
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
      tax_profile_notes: canWritePrivateTaxInfo ? pickIncoming(String(body.tax_profile_notes || "").trim() || null, existingCrew?.tax_profile_notes as string | null | undefined) || null : existingCrew?.tax_profile_notes || null,
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
      await admin.from("crew_positions").delete().eq("crew_id", existingCrewId);
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
