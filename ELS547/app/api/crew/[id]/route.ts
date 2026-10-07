import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { assignedCrewIds } from "@/lib/auth";
import { getDefaultCrewPayRate } from "@/lib/crew-pay-defaults";
import { directDepositReadyFromTaxNotes, taxNotesWithDirectDepositReady, taxNotesWithoutDirectDepositMarker } from "@/lib/crew-types";

function phoneDigits(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeRole(role: string | null | undefined) {
  const value = String(role || "viewer").toLowerCase().trim();
  if (["owner", "admin", "coordinator", "salesman", "sales", "viewer"].includes(value)) return value === "sales" ? "salesman" : value;
  return "viewer";
}

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type StoredCrewPosition = { id: string; role_name: string; rate: number };
type RequestedCrewPosition = { role_name: string; rate: number };

function normalizeText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalCrewPositionName(value: unknown) {
  const original = String(value || "").replace(/\s+/g, " ").trim();
  const normalized = normalizeText(original);
  if (!normalized) return "";
  if (["general av", "general av tech", "general av technician", "gav", "general audio visual", "general audio visual tech", "general audio visual technician"].includes(normalized)) return "General AV";
  if (["avt working lead", "av tech working lead", "audio visual tech working lead", "general av working lead"].includes(normalized)) return "AVT / Working Lead";
  if (["led stagehand", "led stage hand"].includes(normalized)) return "LED Stagehand";
  if (["led assist", "led assistant"].includes(normalized)) return "LED Assist";
  if (["lighting stagehand", "lighting stage hand"].includes(normalized)) return "Lighting Stagehand";
  if (["lighting assist", "lighting assistant"].includes(normalized)) return "Lighting Assist";
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

function normalizeRequestedCrewPositions(rawPositions: unknown) {
  const requested = new Map<string, RequestedCrewPosition>();
  if (!Array.isArray(rawPositions)) return [];
  for (const rawPosition of rawPositions) {
    const position = rawPosition as { role_name?: unknown; rate?: unknown };
    const roleName = canonicalCrewPositionName(position?.role_name);
    if (!roleName) continue;
    const key = crewPositionKey(roleName);
    const existing = requested.get(key);
    requested.set(key, {
      role_name: roleName,
      rate: crewPositionRate(roleName, position?.rate, existing?.rate || 0),
    });
  }
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
  const existingPositionsResult = await admin
    .from("crew_positions")
    .select("id, role_name, rate")
    .eq("crew_id", crewId);
  if (existingPositionsResult.error) throw new Error(existingPositionsResult.error.message);

  const existingPositions = (existingPositionsResult.data || []).map((row) => ({
    id: String((row as { id?: string }).id || ""),
    role_name: String((row as { role_name?: string | null }).role_name || ""),
    rate: Number((row as { rate?: number | string | null }).rate || 0),
  })).filter((position) => position.id && position.role_name);
  const existingByKey = new Map(existingPositions.map((position) => [crewPositionKey(position.role_name), position]));
  const retainedPositionIds = new Set<string>();

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
      retainedPositionIds.add(existingPosition.id);
    } else {
      const insertPosition = await admin
        .from("crew_positions")
        .insert({ crew_id: crewId, role_name: roleName, rate })
        .select("id")
        .single();
      if (insertPosition.error) throw new Error(`Position ${roleName} was not saved: ${insertPosition.error.message}`);
      if (insertPosition.data?.id) retainedPositionIds.add(String(insertPosition.data.id));
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

  const removedPositionIds = existingPositions.map((position) => position.id).filter((positionId) => !retainedPositionIds.has(positionId));
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

async function syncAssignedCoordinators(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, crewId: string, ids: unknown) {
  const requested = Array.isArray(ids) ? Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))) : [];
  const profiles = await admin.from("profiles").select("id, role, is_active");
  if (profiles.error) throw new Error(profiles.error.message);
  const coordinatorIds = new Set((profiles.data || []).filter((row) => normalizeRole((row as { role?: string | null }).role) === "coordinator" && (row as { is_active?: boolean | null }).is_active !== false).map((row) => String((row as { id?: string | null }).id || "")).filter(Boolean));
  if (requested.some((id) => !coordinatorIds.has(id))) throw new Error("One or more selected coordinators is no longer active.");
  const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (users.error) throw new Error(users.error.message);
  for (const user of users.data.users) {
    if (!coordinatorIds.has(user.id)) continue;
    const current = assignedCrewIds(user);
    const next = requested.includes(user.id) ? Array.from(new Set([...current, crewId])) : current.filter((id) => id !== crewId);
    if (JSON.stringify(current.slice().sort()) === JSON.stringify(next.slice().sort())) continue;
    const updated = await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(user.user_metadata || {}), els_assigned_crew_ids: next } });
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
  const baseRecord = {
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
    tax_profile_notes: canViewPrivateTaxInfo ? taxNotesWithoutDirectDepositMarker(typed.tax_profile_notes) : "",
    direct_deposit_ready: canViewPrivateTaxInfo ? directDepositReadyFromTaxNotes(typed.tax_profile_notes) : false,
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
  };
  if (canViewPrivateTaxInfo) return baseRecord;
  return {
    ...baseRecord,
    profile_photo_url: null,
    work_photo_urls: [],
    w9_document_url: null,
    contract_document_url: null,
    tax_profile_notes: "",
    w9_status: "private",
    contract_status: "private",
    tax_profile_status: "private",
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  const body = await request.json();
  const canWritePrivateTaxInfo = isOwnerAdmin(auth.role);

  try {
    if (body.action === "acknowledge_coordinator_hidden") {
      if (!isOwnerAdmin(auth.role)) {
        return NextResponse.json({ message: "Only an owner or admin can clear a coordinator-hidden review notice." }, { status: 403 });
      }
      const reviewedAt = new Date().toISOString();
      const { error: acknowledgeError } = await admin
        .from("crew")
        .update({
          coordinator_hidden_reviewed_at: reviewedAt,
          updated_at: reviewedAt,
        })
        .eq("id", id);
      if (acknowledgeError) return NextResponse.json({ message: acknowledgeError.message }, { status: 400 });
      return NextResponse.json({
        ok: true,
        reviewed_at: reviewedAt,
        message: "Red notice cleared. The contact remains hidden from the coordinator and preserved in Storm’s Master Pool.",
      });
    }

    if (body.action === "restore_coordinator_hidden") {
      if (!isOwnerAdmin(auth.role)) {
        return NextResponse.json({ message: "Only an owner or admin can restore a coordinator-hidden contact." }, { status: 403 });
      }
      const { error: restoreError } = await admin
        .from("crew")
        .update({
          coordinator_hidden_at: null,
          coordinator_hidden_by: null,
          coordinator_hidden_reviewed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (restoreError) return NextResponse.json({ message: restoreError.message }, { status: 400 });
      return NextResponse.json({
        ok: true,
        restored: true,
        message: "Contact restored to the coordinator’s view and retained in Storm’s Master Pool.",
      });
    }
    if (!isOwnerAdmin(auth.role)) {
      const { data: existingCrew } = await admin.from("crew").select("created_by").eq("id", id).maybeSingle();
      if (String((existingCrew as { created_by?: string | null } | null)?.created_by || "") !== auth.user.id) {
        return NextResponse.json({ message: "Coordinator access is limited to crew they added. Ask an admin to edit this contact." }, { status: 403 });
      }
    }
    const { data: existingPrivateCrew } = await admin
      .from("crew")
      .select("onboarding_status, w9_status, contract_status, questionnaire_status, tax_profile_status, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, tax_profile_notes, onboarding_request_sent_at, onboarding_completed_at")
      .eq("id", id)
      .maybeSingle();
    const existingPrivate = existingPrivateCrew as Record<string, unknown> | null;
    const cityPoolId = await resolveCityPoolId(admin, body.city_pool_id, body.city_name);
    const nextGroupName = String(body.group_name || "Ungrouped").trim() || "Ungrouped";
    await ensureCrewGroup(admin, cityPoolId, nextGroupName);
    const { data: updatedCrew, error: updateError } = await admin
      .from("crew")
      .update({
        name: String(body.name || "").trim(),
        description: String(body.description || "").trim() || null,
        city_pool_id: cityPoolId,
        group_name: nextGroupName,
        tier: String(body.tier || "").trim() || null,
        email: String(body.email || "").trim() || null,
        phone: String(body.phone || "").trim() || null,
        address: String(body.address || "").trim() || null,
        lead_from: String(body.lead_from || "").trim() || null,
        other_city: String(body.other_city || "").trim() || null,
        ob: Boolean(body.ob),
        onboarding_texted_called: Boolean(body.onboarding_texted_called),
        onboarding_response: Boolean(body.onboarding_response),
        onboarding_paperwork_sent: Boolean(body.onboarding_paperwork_sent),
        onboarding_successfully_onboarded: Boolean(body.onboarding_successfully_onboarded),
        onboarding_called_placed_tier: Boolean(body.onboarding_called_placed_tier),
        onboarding_status: canWritePrivateTaxInfo ? String(body.onboarding_status || "not_started").trim() || "not_started" : String(existingPrivate?.onboarding_status || "not_started"),
        w9_status: canWritePrivateTaxInfo ? String(body.w9_status || "missing").trim() || "missing" : String(existingPrivate?.w9_status || "missing"),
        contract_status: canWritePrivateTaxInfo ? String(body.contract_status || "missing").trim() || "missing" : String(existingPrivate?.contract_status || "missing"),
        questionnaire_status: canWritePrivateTaxInfo ? String(body.questionnaire_status || "missing").trim() || "missing" : String(existingPrivate?.questionnaire_status || "missing"),
        tax_profile_status: canWritePrivateTaxInfo ? String(body.tax_profile_status || "missing").trim() || "missing" : String(existingPrivate?.tax_profile_status || "missing"),
        profile_photo_url: canWritePrivateTaxInfo ? String(body.profile_photo_url || "").trim() || null : existingPrivate?.profile_photo_url || null,
        work_photo_urls: canWritePrivateTaxInfo ? (Array.isArray(body.work_photo_urls) ? body.work_photo_urls.map(String).filter(Boolean) : []) : Array.isArray(existingPrivate?.work_photo_urls) ? existingPrivate?.work_photo_urls : [],
        w9_document_url: canWritePrivateTaxInfo ? String(body.w9_document_url || "").trim() || null : existingPrivate?.w9_document_url || null,
        contract_document_url: canWritePrivateTaxInfo ? String(body.contract_document_url || "").trim() || null : existingPrivate?.contract_document_url || null,
        tax_profile_notes: canWritePrivateTaxInfo ? taxNotesWithDirectDepositReady(String(body.tax_profile_notes || "").trim() || null, body.direct_deposit_ready === undefined ? directDepositReadyFromTaxNotes(existingPrivate?.tax_profile_notes) : Boolean(body.direct_deposit_ready)) : existingPrivate?.tax_profile_notes || null,
        onboarding_request_sent_at: canWritePrivateTaxInfo ? String(body.onboarding_request_sent_at || "").trim() || null : existingPrivate?.onboarding_request_sent_at || null,
        onboarding_completed_at: canWritePrivateTaxInfo ? String(body.onboarding_completed_at || "").trim() || null : existingPrivate?.onboarding_completed_at || null,
        blacklisted: Boolean(body.blacklisted),
        blacklist_reason: String(body.blacklist_reason || "").trim() || null,
        notes: String(body.notes || "").trim() || null,
        conflict_companies: Array.isArray(body.conflict_companies) ? body.conflict_companies.filter(Boolean) : [],
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (updateError) return NextResponse.json({ message: updateError.message }, { status: 400 });
    if (!updatedCrew?.id) {
      return NextResponse.json({ message: "Crew contact was not found, so no changes were saved. Refresh Crew and try again." }, { status: 404 });
    }

    const requestedPositions = normalizeRequestedCrewPositions(body.positions);
    const persistedPositions = await syncCrewPositionsSafely(admin, id, requestedPositions);

    await admin.from("crew_unavailable_dates").delete().eq("crew_id", id);

    const unavailableDates = Array.isArray(body.unavailable_dates) ? body.unavailable_dates : [];

    if (unavailableDates.length) {
      const { error } = await admin.from("crew_unavailable_dates").insert(
        unavailableDates
          .filter((value: string) => String(value || "").trim())
          .map((value: string) => ({ crew_id: id, unavailable_date: value }))
      );
      if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    }

    if (isOwnerAdmin(auth.role)) {
      await syncAdditionalCityPools(admin, id, body.additional_city_pool_ids);
      await syncAssignedCoordinators(admin, id, body.assigned_coordinator_user_ids);
    } else if (Array.isArray(body.additional_city_pool_ids) && body.additional_city_pool_ids.length) {
      const cityPoolIds = Array.from(new Set(body.additional_city_pool_ids.map((poolId: unknown) => String(poolId || "").trim()).filter(Boolean)));
      const { error: extraError } = await admin
        .from("crew_city_pools")
        .upsert(cityPoolIds.map((city_pool_id) => ({ crew_id: id, city_pool_id })), { onConflict: "crew_id,city_pool_id" });
      if (extraError && !extraError.message.includes('relation "crew_city_pools" does not exist')) {
        return NextResponse.json({ message: extraError.message }, { status: 400 });
      }
    }

    const savedRow = await loadCrewRecordForResponse(admin, id, canWritePrivateTaxInfo);
    assertCrewPositionsPersisted(savedRow.positions, persistedPositions);

    return NextResponse.json({
      ok: true,
      id,
      row: savedRow,
      positions: savedRow.positions,
      message: `${savedRow.positions.length} position${savedRow.positions.length === 1 ? "" : "s"} saved to this crew contact.`,
    });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to update crew member." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  const url = new URL(request.url);
  const softDeleteOnly = url.searchParams.get("soft") === "1";
  const requestedHiddenBy = String(url.searchParams.get("hidden_by") || "").trim();
  const hiddenByUserId = isOwnerAdmin(auth.role) && requestedHiddenBy ? requestedHiddenBy : auth.user.id;

  if (!isOwnerAdmin(auth.role)) {
    const { data: existingCrew, error: existingError } = await admin.from("crew").select("created_by").eq("id", id).maybeSingle();
    if (existingError) return NextResponse.json({ message: existingError.message }, { status: 400 });
    if (String((existingCrew as { created_by?: string | null } | null)?.created_by || "") !== auth.user.id) {
      return NextResponse.json({ ok: false, protected: true, message: "Coordinator deletion is blocked for contacts they did not add. Ask an admin to archive or delete this contact." }, { status: 403 });
    }
  }

  if (softDeleteOnly || !isOwnerAdmin(auth.role)) {
    const hiddenPatch = { coordinator_hidden_at: new Date().toISOString(), coordinator_hidden_by: hiddenByUserId, coordinator_hidden_reviewed_at: null, updated_at: new Date().toISOString() };
    const { error: hideError } = await admin.from("crew").update(hiddenPatch).eq("id", id);
    if (hideError) {
      if (hideError.message.includes("coordinator_hidden_at") || hideError.message.includes("coordinator_hidden_by") || hideError.message.includes("coordinator_hidden_reviewed_at") || hideError.message.includes("schema cache")) {
        return NextResponse.json({ ok: false, message: "Coordinator soft-delete columns are missing. Run sql/ELS250_required_sql.sql, then retry." }, { status: 400 });
      }
      return NextResponse.json({ message: hideError.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, soft_deleted: true, message: "Contact hidden from the coordinator view. Storm’s Master Pool record was preserved." });
  }

  const { error } = await admin.from("crew").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
