"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { requireRole, type AppPageKey } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const roleDefaults: Record<string, { pages: AppPageKey[]; restrictEvents: boolean; restrictCrew: boolean; canEditEventDetails: boolean }> = {
  owner: { pages: ["overview", "coordinator", "crew", "onboarding", "events", "clients", "pipelines", "payroll", "users", "settings"], restrictEvents: false, restrictCrew: false, canEditEventDetails: true },
  admin: { pages: ["overview", "coordinator", "crew", "onboarding", "events", "clients", "pipelines", "payroll", "users", "settings"], restrictEvents: false, restrictCrew: false, canEditEventDetails: true },
  coordinator: { pages: ["overview", "coordinator", "events", "crew", "onboarding"], restrictEvents: true, restrictCrew: true, canEditEventDetails: false },
  salesman: { pages: ["pipelines"], restrictEvents: true, restrictCrew: true, canEditEventDetails: false },
  sales: { pages: ["pipelines"], restrictEvents: true, restrictCrew: true, canEditEventDetails: false },
  viewer: { pages: ["overview"], restrictEvents: true, restrictCrew: true, canEditEventDetails: false },
};

const allowedRoles = new Set(["owner", "admin", "coordinator", "salesman", "sales", "viewer"]);
const allowedPages = new Set<AppPageKey>(["overview", "coordinator", "crew", "onboarding", "events", "clients", "pipelines", "payroll", "users", "settings"]);
const allowedMessagingModes = new Set(["apple_shortcut", "android_messages"]);

function normalizeStoredRole(value: FormDataEntryValue | null) {
  const role = String(value || "viewer").toLowerCase().trim();
  if (!allowedRoles.has(role)) return "viewer";
  return role === "sales" ? "salesman" : role;
}

function pagesFromForm(formData: FormData, role: string) {
  const pages = formData
    .getAll("allowedPages")
    .map((value) => String(value))
    .filter((page): page is AppPageKey => allowedPages.has(page as AppPageKey));
  if (pages.length) return pages;
  return roleDefaults[role]?.pages ?? roleDefaults.viewer.pages;
}

function defaultAccessForRole(role: string) {
  return roleDefaults[role] ?? roleDefaults.viewer;
}

function normalizeMessagingModeFromForm(value: FormDataEntryValue | null) {
  const mode = String(value || "apple_shortcut").trim();
  return allowedMessagingModes.has(mode) ? mode : "apple_shortcut";
}

function profileMessagingColumnsMissing(error: { message?: string | null } | null | undefined) {
  const message = String(error?.message || "");
  return message.includes("messaging_mode") || message.includes("device_type") || message.toLowerCase().includes("schema cache");
}

function nonNegativeMoneyFromForm(formData: FormData, key: string, fallback: number) {
  const parsed = Number(String(formData.get(key) ?? "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

const coordinatorCompensationFormKeys = [
  "coordinatorFullDayRate1_20",
  "coordinatorFullDayRate21_35",
  "coordinatorFullDayRate36_50",
  "coordinatorFullDayRate51Plus",
  "coordinatorHalfDayRate1_49",
  "coordinatorHalfDayRate50Plus",
];

function missingCoordinatorCompensationFormKeys(formData: FormData) {
  return coordinatorCompensationFormKeys.filter((key) => !formData.has(key));
}

function coordinatorCompensationNotesColumnMissing(error: { message?: string | null; details?: string | null; hint?: string | null } | null | undefined) {
  const combined = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return combined.includes("notes") || combined.includes("schema cache");
}

function coordinatorCompensationIdColumnMissing(error: { message?: string | null; details?: string | null; hint?: string | null } | null | undefined, columnName: string) {
  const combined = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return combined.includes(columnName.toLowerCase());
}

function uniqueCoordinatorCompensationTargetIds(formData: FormData, primaryUserId: string) {
  const ids = [primaryUserId, ...formData.getAll("linkedCoordinatorCompensationIds").map((value) => String(value || "").trim())]
    .filter((value) => Boolean(value));
  return Array.from(new Set(ids)).slice(0, 5);
}

const defaultCoordinatorCompensation = {
  full_day_rate_1_20: 25,
  full_day_rate_21_35: 22.5,
  full_day_rate_36_50: 20,
  full_day_rate_51_plus: 17.5,
  half_day_rate_1_49: 15,
  half_day_rate_50_plus: 10,
};

type SupabaseAdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type CoordinatorCompensationSaveResult = { ok: boolean; message: string; error?: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null };
type CoordinatorCompensationSettingsPayload = {
  coordinator_user_id: string;
  full_day_rate_1_20: number;
  full_day_rate_21_35: number;
  full_day_rate_36_50: number;
  full_day_rate_51_plus: number;
  half_day_rate_1_49: number;
  half_day_rate_50_plus: number;
  notes: string | null;
};

function compensationSaveIssueMessage(error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined) {
  if (!error) return "";
  const code = String(error.code || "");
  const message = String(error.message || "");
  const details = String(error.details || "");
  const hint = String(error.hint || "");
  const combined = `${message} ${details} ${hint}`.trim();
  const lower = combined.toLowerCase();
  if (code === "42P01" || /relation .*coordinator_compensation_settings.* does not exist/i.test(combined)) {
    return " Coordinator payout rates were not saved because the ELS295 compensation SQL has not been run.";
  }
  if (code.startsWith("PGRST") || lower.includes("schema cache")) {
    return " Coordinator payout rates were not saved because Supabase has not refreshed the API schema for the compensation table yet. Wait a minute, refresh the app, and try again.";
  }
  return ` Coordinator payout rate issue: ${combined || "Unknown Supabase error."}`;
}

function coordinatorCompensationPayloadFromForm(formData: FormData, userId: string): CoordinatorCompensationSettingsPayload {
  return {
    coordinator_user_id: userId,
    full_day_rate_1_20: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate1_20", defaultCoordinatorCompensation.full_day_rate_1_20),
    full_day_rate_21_35: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate21_35", defaultCoordinatorCompensation.full_day_rate_21_35),
    full_day_rate_36_50: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate36_50", defaultCoordinatorCompensation.full_day_rate_36_50),
    full_day_rate_51_plus: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate51Plus", defaultCoordinatorCompensation.full_day_rate_51_plus),
    half_day_rate_1_49: nonNegativeMoneyFromForm(formData, "coordinatorHalfDayRate1_49", defaultCoordinatorCompensation.half_day_rate_1_49),
    half_day_rate_50_plus: nonNegativeMoneyFromForm(formData, "coordinatorHalfDayRate50Plus", defaultCoordinatorCompensation.half_day_rate_50_plus),
    notes: String(formData.get("coordinatorCompensationNotes") || "").trim() || null,
  };
}

function defaultCoordinatorCompensationPayload(userId: string): CoordinatorCompensationSettingsPayload {
  return {
    coordinator_user_id: userId,
    ...defaultCoordinatorCompensation,
    notes: null,
  };
}

async function saveCoordinatorCompensationSettingsWithIdColumn(
  admin: SupabaseAdminClient,
  payload: CoordinatorCompensationSettingsPayload,
  idColumn: "coordinator_user_id" | "user_id",
): Promise<CoordinatorCompensationSaveResult> {
  const { coordinator_user_id, ...settingsPayload } = payload;
  const { notes: _notes, ...settingsPayloadWithoutNotes } = settingsPayload;
  const fullInsertPayload = { [idColumn]: coordinator_user_id, ...settingsPayload };
  const insertPayloadWithoutNotes = { [idColumn]: coordinator_user_id, ...settingsPayloadWithoutNotes };

  let updateResult = await admin
    .from("coordinator_compensation_settings")
    .update(settingsPayload)
    .eq(idColumn, coordinator_user_id)
    .select(idColumn);

  if (updateResult.error && coordinatorCompensationNotesColumnMissing(updateResult.error)) {
    updateResult = await admin
      .from("coordinator_compensation_settings")
      .update(settingsPayloadWithoutNotes)
      .eq(idColumn, coordinator_user_id)
      .select(idColumn);
  }

  if (updateResult.error) return { ok: false, message: compensationSaveIssueMessage(updateResult.error), error: updateResult.error };
  if ((updateResult.data ?? []).length > 0) return { ok: true, message: " Coordinator payout rates updated." };

  let insertResult = await admin
    .from("coordinator_compensation_settings")
    .insert(fullInsertPayload)
    .select(idColumn);

  if (insertResult.error && coordinatorCompensationNotesColumnMissing(insertResult.error)) {
    insertResult = await admin
      .from("coordinator_compensation_settings")
      .insert(insertPayloadWithoutNotes)
      .select(idColumn);
  }

  if (!insertResult.error) return { ok: true, message: " Coordinator payout rates updated." };

  const combined = `${insertResult.error.message || ""} ${insertResult.error.details || ""} ${insertResult.error.hint || ""}`.toLowerCase();
  if (insertResult.error.code === "23505" || combined.includes("duplicate")) {
    let retry = await admin
      .from("coordinator_compensation_settings")
      .update(settingsPayload)
      .eq(idColumn, coordinator_user_id)
      .select(idColumn);
    if (retry.error && coordinatorCompensationNotesColumnMissing(retry.error)) {
      retry = await admin
        .from("coordinator_compensation_settings")
        .update(settingsPayloadWithoutNotes)
        .eq(idColumn, coordinator_user_id)
        .select(idColumn);
    }
    if (!retry.error && (retry.data ?? []).length > 0) return { ok: true, message: " Coordinator payout rates updated." };
    return { ok: false, message: compensationSaveIssueMessage(retry.error || insertResult.error), error: retry.error || insertResult.error };
  }

  return { ok: false, message: compensationSaveIssueMessage(insertResult.error), error: insertResult.error };
}

async function saveCoordinatorCompensationSettings(admin: SupabaseAdminClient, payload: CoordinatorCompensationSettingsPayload): Promise<CoordinatorCompensationSaveResult> {
  // Do not use Supabase upsert here. Some deployed ELS databases do not have a
  // unique constraint exposed for coordinator_user_id, which makes upsert fail
  // silently from the form because the Users page does not display action results.
  // Update existing rows first, then insert only when no row exists. This also
  // updates duplicate legacy rows instead of letting an older duplicate continue
  // to win when the page reloads.
  const primary = await saveCoordinatorCompensationSettingsWithIdColumn(admin, payload, "coordinator_user_id");
  if (primary.ok) return primary;
  if (coordinatorCompensationIdColumnMissing(primary.error, "coordinator_user_id")) {
    const fallback = await saveCoordinatorCompensationSettingsWithIdColumn(admin, payload, "user_id");
    if (fallback.ok) return fallback;
    return { ok: false, message: fallback.message || primary.message };
  }
  return { ok: false, message: primary.message };
}

function normalizedIdentityText(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " " );
}

async function resolveLinkedCoordinatorProfileIds(
  admin: SupabaseAdminClient,
  formData: FormData,
  primaryUserId: string,
) {
  const ids = new Set(uniqueCoordinatorCompensationTargetIds(formData, primaryUserId));
  const email = normalizedIdentityText(formData.get("email"));
  const fullName = normalizedIdentityText(formData.get("fullName"));

  const profiles = await admin.from("profiles").select("id, email, full_name").limit(1000);
  if (!profiles.error) {
    for (const row of profiles.data ?? []) {
      const typed = row as { id?: string | null; email?: string | null; full_name?: string | null };
      const id = String(typed.id || "").trim();
      if (!id) continue;
      const sameEmail = Boolean(email && normalizedIdentityText(typed.email) === email);
      const sameNameWithoutEmail = Boolean(!email && fullName && normalizedIdentityText(typed.full_name) === fullName);
      if (id === primaryUserId || sameEmail || sameNameWithoutEmail) ids.add(id);
    }
  }

  return Array.from(ids).slice(0, 10);
}

async function saveCoordinatorCompensationSettingsForLinkedUsers(
  admin: SupabaseAdminClient,
  formData: FormData,
  primaryUserId: string,
): Promise<CoordinatorCompensationSaveResult> {
  const targetIds = await resolveLinkedCoordinatorProfileIds(admin, formData, primaryUserId);
  let firstFailure = "";
  let savedCount = 0;
  for (const targetId of targetIds) {
    const result = await saveCoordinatorCompensationSettings(admin, coordinatorCompensationPayloadFromForm(formData, targetId));
    if (result.ok) savedCount += 1;
    else if (!firstFailure) firstFailure = result.message;
  }
  if (savedCount > 0) {
    const linkedMessage = savedCount > 1 ? ` Coordinator payout rates updated for ${savedCount} linked profile/login IDs.` : " Coordinator payout rates updated.";
    return { ok: true, message: linkedMessage };
  }
  return { ok: false, message: firstFailure || "Coordinator payout rates were not saved." };
}

function accessCanEditColumnMissing(error: { message?: string | null } | null | undefined) {
  return Boolean(error?.message && error.message.includes("can_edit_event_details"));
}

function appBaseUrl() {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercelUrl = String(process.env.VERCEL_URL || "").trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;
  return "https://app.emanuel-labor-services.com";
}

function supabasePublicUrl() {
  return String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
}

function supabaseProjectRef(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".supabase.co") ? hostname.replace(".supabase.co", "") : hostname;
  } catch {
    return url ? "configured-but-invalid-url" : "missing";
  }
}

function authDebugError(error: unknown) {
  const typed = error as { code?: string | null; message?: string | null; status?: number | string | null; name?: string | null } | null;
  const code = typed?.code ? ` code=${typed.code}` : "";
  const status = typed?.status ? ` status=${typed.status}` : "";
  const name = typed?.name ? ` name=${typed.name}` : "";
  const message = typed?.message ? ` message=${typed.message}` : " message=Unknown error";
  return `${name}${code}${status}${message}`.trim();
}

async function testPasswordSignIn(email: string, password: string) {
  const url = supabasePublicUrl();
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anonKey) {
    return {
      ok: false,
      userId: "",
      message: "Login test skipped: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.",
    };
  }

  const loginClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await loginClient.auth.signInWithPassword({ email, password });
  await loginClient.auth.signOut();
  if (error) {
    return {
      ok: false,
      userId: "",
      message: `Login test failed:${authDebugError(error)}`,
    };
  }
  return {
    ok: true,
    userId: data.user?.id || "",
    message: `Login test succeeded for Auth user ${data.user?.id || "unknown"}.`,
  };
}

async function resolveAllowedCityPoolIds(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, rawValues: string[]) {
  const requested = Array.from(new Set(rawValues.map((value) => String(value || "").trim()).filter(Boolean)));
  if (!requested.length) return { ids: [] as string[], message: "" };

  const { data, error } = await admin.from("city_pools").select("id, name");
  if (error) {
    return { ids: requested, message: ` Could not verify city pool records: ${error.message}` };
  }

  const pools = (data ?? []) as { id?: string | null; name?: string | null }[];
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const pool of pools) {
    const id = String(pool.id || "").trim();
    const name = String(pool.name || "").trim().toLowerCase();
    if (id) byId.set(id, id);
    if (id && name) byName.set(name, id);
  }
  const resolved: string[] = [];
  const missing: string[] = [];

  for (const value of requested) {
    const match = byId.get(value) || byName.get(value.toLowerCase());
    if (match && !resolved.includes(match)) resolved.push(match);
    else missing.push(value);
  }

  if (missing.length) {
    return { ids: resolved, message: ` Could not save city assignment: ${missing.join(", ")} was not found in city pools.` };
  }
  return { ids: resolved, message: "" };
}

async function auditAuthAction(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, payload: Record<string, unknown>) {
  const { error } = await admin.from("auth_audit_log").insert({
    ...payload,
    created_at: new Date().toISOString(),
  });
  if (error && !/auth_audit_log|schema cache|does not exist/i.test(error.message || "")) {
    console.error("Auth audit log failed", error.message);
  }
}

export async function inviteUserAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") || "").trim();
  const role = normalizeStoredRole(formData.get("role"));
  const temporaryPassword = String(formData.get("temporaryPassword") || "").trim();
  const messagingMode = normalizeMessagingModeFromForm(formData.get("messagingMode"));
  const deviceType = String(formData.get("deviceType") || "").trim();

  if (!email) return { ok: false, message: "Email is required." };
  if (temporaryPassword && temporaryPassword.length < 8) {
    return { ok: false, message: "Temporary password must be at least 8 characters." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const createWithPassword = Boolean(temporaryPassword);
  const authResult = createWithPassword
    ? await admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, role, force_password_change: true },
      })
    : await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, role, force_password_change: false },
      });

  if (authResult.error) return { ok: false, message: authResult.error.message };

  const userId = authResult.data.user?.id;
  if (!userId) {
    return { ok: false, message: createWithPassword ? "User creation succeeded but no user id was returned." : "Invite succeeded but no user id was returned." };
  }

  const messagingMetadataResult = await saveUserMessagingMetadata(admin, userId, messagingMode, deviceType || (messagingMode === "android_messages" ? "Android" : ""));

  const profilePayload = {
    id: userId,
    email,
    full_name: fullName || null,
    role,
    is_active: true,
    messaging_mode: messagingMode,
    device_type: deviceType || (messagingMode === "android_messages" ? "Android" : null),
  };

  let { error: upsertError } = await admin.from("profiles").upsert(profilePayload);
  let messagingModeMessage = "";
  if (profileMessagingColumnsMissing(upsertError)) {
    const { messaging_mode: _messagingMode, device_type: _deviceType, ...fallbackProfilePayload } = profilePayload;
    const retry = await admin.from("profiles").upsert(fallbackProfilePayload);
    upsertError = retry.error;
    messagingModeMessage = messagingMetadataResult.ok ? " Messaging mode saved through Auth metadata fallback." : ` Messaging mode fallback failed: ${messagingMetadataResult.message}`;
  }

  if (upsertError) return { ok: false, message: upsertError.message };

  const defaults = defaultAccessForRole(role);
  const { error: accessError } = await admin.from("user_access_settings").upsert({
    user_id: userId,
    allowed_pages: defaults.pages,
    restrict_events_to_owner: defaults.restrictEvents,
    restrict_crew_to_owner: defaults.restrictCrew,
    can_edit_event_details: defaults.canEditEventDetails,
    allowed_city_pool_ids: [],
  });
  if (accessCanEditColumnMissing(accessError)) {
    await admin.from("user_access_settings").upsert({
      user_id: userId,
      allowed_pages: defaults.pages,
      restrict_events_to_owner: defaults.restrictEvents,
      restrict_crew_to_owner: defaults.restrictCrew,
      allowed_city_pool_ids: [],
    });
  }

  let compensationMessage = "";
  if (role === "coordinator") {
    const compensationResult = await saveCoordinatorCompensationSettings(admin, defaultCoordinatorCompensationPayload(userId));
    compensationMessage = compensationResult.ok ? " Coordinator default payout rates created." : compensationResult.message;
  }

  revalidatePath("/users");
  if (createWithPassword) {
    return { ok: true, message: `Login created for ${email}. You can test it now, then send them the email and temporary password.${messagingModeMessage}${compensationMessage}` };
  }
  return { ok: true, message: `Invite sent to ${email}.${messagingModeMessage}${compensationMessage}` };
}


async function saveUserMessagingMetadata(admin: SupabaseAdminClient, userId: string, messagingMode: string, deviceType: string) {
  const current = await admin.auth.admin.getUserById(userId);
  if (current.error || !current.data.user) return { ok: false, message: current.error?.message || "Auth user not found." };
  const existing = (current.data.user.user_metadata || {}) as Record<string, unknown>;
  const result = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...existing,
      els_messaging_mode: messagingMode,
      els_device_type: deviceType || null,
    },
  });
  return { ok: !result.error, message: result.error?.message || "" };
}

async function resolveLinkedAuthUserIds(admin: SupabaseAdminClient, formData: FormData, primaryUserId: string) {
  const candidateIds = await resolveLinkedCoordinatorProfileIds(admin, formData, primaryUserId);
  const resolvedIds: string[] = [];

  for (const candidateId of candidateIds) {
    const current = await admin.auth.admin.getUserById(candidateId);
    if (!current.error && current.data.user?.id) resolvedIds.push(current.data.user.id);
  }

  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (email) {
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (!listed.error) {
      for (const user of listed.data.users || []) {
        if (String(user.email || "").trim().toLowerCase() === email) resolvedIds.push(user.id);
      }
    }
  }

  return Array.from(new Set(resolvedIds));
}

async function saveUserMessagingMetadataForLinkedUsers(
  admin: SupabaseAdminClient,
  formData: FormData,
  primaryUserId: string,
  messagingMode: string,
  deviceType: string,
) {
  const targetIds = await resolveLinkedAuthUserIds(admin, formData, primaryUserId);
  let saved = 0;
  let firstError = "";

  for (const targetId of targetIds) {
    const current = await admin.auth.admin.getUserById(targetId);
    if (current.error || !current.data.user) {
      if (!firstError) firstError = current.error?.message || "Auth user not found.";
      continue;
    }
    const existing = (current.data.user.user_metadata || {}) as Record<string, unknown>;
    const result = await admin.auth.admin.updateUserById(targetId, {
      user_metadata: {
        ...existing,
        els_messaging_mode: messagingMode,
        els_device_type: deviceType || null,
      },
    });
    if (result.error) {
      if (!firstError) firstError = result.error.message;
    } else saved += 1;
  }

  return { ok: saved > 0, saved, message: firstError || (targetIds.length ? "" : "No matching Supabase Auth login was found for this user.") };
}

async function saveCoordinatorCompensationMetadataForLinkedUsers(
  admin: SupabaseAdminClient,
  formData: FormData,
  primaryUserId: string,
) {
  const payload = coordinatorCompensationPayloadFromForm(formData, primaryUserId);
  const metadataPayload = {
    full_day_rate_1_20: payload.full_day_rate_1_20,
    full_day_rate_21_35: payload.full_day_rate_21_35,
    full_day_rate_36_50: payload.full_day_rate_36_50,
    full_day_rate_51_plus: payload.full_day_rate_51_plus,
    half_day_rate_1_49: payload.half_day_rate_1_49,
    half_day_rate_50_plus: payload.half_day_rate_50_plus,
    notes: payload.notes,
  };
  let saved = 0;
  let firstError = "";
  const authTargetIds = await resolveLinkedAuthUserIds(admin, formData, primaryUserId);
  for (const targetId of authTargetIds) {
    const current = await admin.auth.admin.getUserById(targetId);
    if (current.error || !current.data.user) {
      if (!firstError) firstError = current.error?.message || "Auth user not found.";
      continue;
    }
    const existing = (current.data.user.user_metadata || {}) as Record<string, unknown>;
    const result = await admin.auth.admin.updateUserById(targetId, {
      user_metadata: { ...existing, els_coordinator_compensation: metadataPayload },
    });
    if (result.error) {
      if (!firstError) firstError = result.error.message;
    } else saved += 1;
  }
  return { ok: saved > 0, saved, message: firstError };
}

export async function updateUserAccessAction(formData: FormData) {
  const session = await requireRole(["owner", "admin"]);

  const userId = String(formData.get("userId") || "").trim();
  const fullName = String(formData.get("fullName") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const role = normalizeStoredRole(formData.get("role"));
  const isActive = formData.get("isActive") === "on";
  const allowed_pages = pagesFromForm(formData, role);
  const restrict_events_to_owner = formData.get("restrictEventsToOwner") === "on";
  const restrict_crew_to_owner = formData.get("restrictCrewToOwner") === "on";
  const can_edit_event_details = formData.get("canEditEventDetails") === "on";
  const rawAllowedCityPoolIds = formData.getAll("allowedCityPoolIds").map(String).filter(Boolean);
  const temporaryPassword = String(formData.get("temporaryPassword") || "").trim();
  const skipCoordinatorCompensation = formData.get("skipCoordinatorCompensation") === "true";
  const messagingMode = normalizeMessagingModeFromForm(formData.get("messagingMode"));
  const deviceType = String(formData.get("deviceType") || "").trim();

  if (!userId) return { ok: false, message: "Missing user id." };
  if (temporaryPassword && temporaryPassword.length < 8) {
    return { ok: false, message: "Temporary password must be at least 8 characters." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const messagingMetadataResult = await saveUserMessagingMetadataForLinkedUsers(admin, formData, userId, messagingMode, deviceType);

  const resolvedPools = await resolveAllowedCityPoolIds(admin, rawAllowedCityPoolIds);
  if (resolvedPools.message && !resolvedPools.ids.length && rawAllowedCityPoolIds.length) {
    return { ok: false, message: resolvedPools.message.trim() };
  }
  const allowed_city_pool_ids = resolvedPools.ids;

  const profilePayload = {
    email: email || null,
    full_name: fullName || null,
    role,
    is_active: isActive,
    messaging_mode: messagingMode,
    device_type: deviceType || null,
  };

  let { error: profileError } = await admin.from("profiles").update(profilePayload).eq("id", userId);
  let messagingModeMessage = "";
  if (profileMessagingColumnsMissing(profileError)) {
    const { messaging_mode: _messagingMode, device_type: _deviceType, ...fallbackProfilePayload } = profilePayload;
    const retry = await admin.from("profiles").update(fallbackProfilePayload).eq("id", userId);
    profileError = retry.error;
    if (!messagingMetadataResult.ok) {
      return { ok: false, message: `Messaging mode could not be saved: ${messagingMetadataResult.message || "no matching Auth login was found."}` };
    }
    messagingModeMessage = " Messaging mode saved through the linked Auth login fallback.";
  }

  if (profileError) return { ok: false, message: profileError.message };

  const accessPayload = {
    user_id: userId,
    allowed_pages,
    restrict_events_to_owner,
    restrict_crew_to_owner,
    can_edit_event_details,
    allowed_city_pool_ids,
    updated_at: new Date().toISOString(),
  };

  let { error: accessError } = await admin.from("user_access_settings").upsert(accessPayload);
  if (accessCanEditColumnMissing(accessError)) {
    const { can_edit_event_details: _canEditEventDetails, ...fallbackAccessPayload } = accessPayload;
    const retry = await admin.from("user_access_settings").upsert(fallbackAccessPayload);
    accessError = retry.error;
  }
  if (accessError) return { ok: false, message: `Could not save city assignment or page access: ${accessError.message}` };

  let compensationMessage = "";
  if (role === "coordinator") {
    if (skipCoordinatorCompensation) {
      const metadataCompensation = await saveCoordinatorCompensationMetadataForLinkedUsers(admin, formData, userId);
      if (!metadataCompensation.ok) return { ok: false, message: metadataCompensation.message || "Coordinator payout rates were not saved." };
      compensationMessage = " Coordinator payout rates saved through Auth metadata fallback.";
    } else {
      const missingKeys = missingCoordinatorCompensationFormKeys(formData);
      if (missingKeys.length) return { ok: false, message: `Coordinator payout rates were not saved because the form did not submit these fields: ${missingKeys.join(", ")}.` };
      const metadataCompensation = await saveCoordinatorCompensationMetadataForLinkedUsers(admin, formData, userId);
      const compensationResult = await saveCoordinatorCompensationSettingsForLinkedUsers(admin, formData, userId);
      if (compensationResult.ok || metadataCompensation.ok) {
        compensationMessage = compensationResult.ok ? compensationResult.message : " Coordinator payout rates saved through Auth metadata fallback.";
      } else {
        return { ok: false, message: compensationResult.message || metadataCompensation.message || "Coordinator payout rates were not saved." };
      }
    }
  }

  let passwordMessage = "";
  if (temporaryPassword) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, {
      password: temporaryPassword,
      user_metadata: { full_name: fullName, role, force_password_change: true },
    });
    await auditAuthAction(admin, {
      user_id: userId,
      admin_user_id: session.user?.id || null,
      action: "temporary_password_set",
      success: !passwordError,
      message: passwordError?.message || null,
    });
    if (passwordError) return { ok: false, message: `Password could not be updated: ${passwordError.message}` };
    passwordMessage = ` Temporary password successfully set for ${fullName || email || "this user"}.`;
  }

  revalidatePath("/users");
  revalidatePath("/");
  revalidatePath("/events");
  revalidatePath("/crew");
  revalidatePath("/pipelines");
  revalidatePath("/coordinator");
  revalidatePath("/payroll");
  return { ok: true, message: `User access updated.${messagingModeMessage}${passwordMessage}${compensationMessage}` };
}


export async function updateCoordinatorPayoutAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const userId = String(formData.get("userId") || "").trim();
  const skipCoordinatorCompensation = formData.get("skipCoordinatorCompensation") === "true";
  if (!userId) return { ok: false, message: "Missing user id." };
  // Even when the compensation table is unavailable, Auth metadata is a durable fallback.
  void skipCoordinatorCompensation;

  const missingKeys = missingCoordinatorCompensationFormKeys(formData);
  if (missingKeys.length) return { ok: false, message: `Coordinator payout rates were not saved because the form did not submit these fields: ${missingKeys.join(", ")}.` };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const metadataCompensation = await saveCoordinatorCompensationMetadataForLinkedUsers(admin, formData, userId);
  const compensationResult = skipCoordinatorCompensation
    ? { ok: false, message: "Coordinator compensation table unavailable." }
    : await saveCoordinatorCompensationSettingsForLinkedUsers(admin, formData, userId);
  const finalResult = compensationResult.ok
    ? compensationResult
    : metadataCompensation.ok
      ? { ok: true, message: "Coordinator payout rates saved through Auth metadata fallback." }
      : { ok: false, message: compensationResult.message || metadataCompensation.message || "Coordinator payout rates were not saved." };

  revalidatePath("/users");
  revalidatePath("/payroll");
  revalidatePath("/coordinator");
  return finalResult;
}

export async function setTemporaryPasswordAction(formData: FormData) {
  const session = await requireRole(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const userId = String(formData.get("userId") || "").trim();
  const password = String(formData.get("temporaryPassword") || "").trim();
  const requireChange = formData.get("requirePasswordChange") === "on";
  if (!userId) return { ok: false, message: "Missing user id." };
  if (password.length < 8) return { ok: false, message: "Temporary password must be at least 8 characters." };

  const { data: profile } = await admin.from("profiles").select("email, full_name, role").eq("id", userId).maybeSingle();
  const typedProfile = profile as { email?: string | null; full_name?: string | null; role?: string | null } | null;
  const email = String(typedProfile?.email || "").trim();
  if (!email) return { ok: false, message: "Password update failed: this ELS profile does not have a login email." };
  const projectUrl = supabasePublicUrl();
  const projectRef = supabaseProjectRef(projectUrl);
  console.info("ELS auth debug: temporary password update requested", {
    userId,
    projectUrl,
    projectRef,
    adminProjectSource: "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    loginProjectSource: "NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY",
  });
  const existingAuth = await admin.auth.admin.getUserById(userId);
  if (existingAuth.error || !existingAuth.data.user) {
    const message = `Password update failed before updateUserById. userId=${userId}; project=${projectRef}; ${authDebugError(existingAuth.error)}`;
    console.error("ELS auth debug:", message);
    return { ok: false, message };
  }
  const updatedAt = new Date().toISOString();
  const { data: authUser, error } = await admin.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    user_metadata: {
      full_name: typedProfile?.full_name || typedProfile?.email || "",
      role: normalizeStoredRole(typedProfile?.role || "coordinator"),
      force_password_change: requireChange,
      last_admin_password_reset_at: updatedAt,
      last_admin_password_reset_by: session.user?.id || null,
    },
  });
  await auditAuthAction(admin, {
    user_id: userId,
    admin_user_id: session.user?.id || null,
    action: "temporary_password_set",
    success: !error,
    message: error?.message || null,
  });
  if (error) {
    const message = `Password update failed at updateUserById. userId=${userId}; project=${projectRef}; ${authDebugError(error)}`;
    console.error("ELS auth debug:", message);
    return { ok: false, message };
  }
  const returnedUserId = authUser.user?.id || "";
  if (returnedUserId !== userId) {
    const message = `Password update returned the wrong Auth user. requested=${userId}; returned=${returnedUserId || "missing"}; project=${projectRef}.`;
    console.error("ELS auth debug:", message);
    return { ok: false, message };
  }
  const verifiedAuth = await admin.auth.admin.getUserById(userId);
  if (verifiedAuth.error || !verifiedAuth.data.user) {
    const message = `Password update failed after updateUserById: Supabase could not verify the updated Auth user. userId=${userId}; project=${projectRef}; ${authDebugError(verifiedAuth.error)}`;
    console.error("ELS auth debug:", message);
    return { ok: false, message };
  }
  const loginTest = await testPasswordSignIn(email, password);
  const verifiedAt = new Date().toISOString();
  console.info("ELS auth debug: temporary password update completed", {
    requestedUserId: userId,
    returnedUserId,
    verifiedUserId: verifiedAuth.data.user.id,
    projectUrl,
    projectRef,
    updatedAt,
    verifiedAt,
    loginTestOk: loginTest.ok,
    loginTestUserId: loginTest.userId,
    loginTestMessage: loginTest.message,
  });

  revalidatePath("/users");
  return {
    ok: loginTest.ok && loginTest.userId === userId,
    message: [
      `Temporary password update reached Supabase project ${projectRef} (${projectUrl || "missing URL"}).`,
      `Requested userId: ${userId}. Returned Auth user ID: ${returnedUserId}. Verified at: ${new Date(verifiedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}.`,
      loginTest.ok && loginTest.userId === userId
        ? `Immediate login test passed for ${typedProfile?.full_name || email}.`
        : `Immediate login test did not pass for Juan's exact Auth user. ${loginTest.message}`,
    ].join(" "),
  };
}

export async function sendPasswordResetEmailAction(formData: FormData) {
  const session = await requireRole(["owner", "admin"]);
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const userId = String(formData.get("userId") || "").trim();
  if (!userId) return { ok: false, message: "Missing user id." };
  const { data: profile, error: profileError } = await admin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
  if (profileError) return { ok: false, message: profileError.message };
  const email = String((profile as { email?: string | null } | null)?.email || "").trim();
  if (!email) return { ok: false, message: "This user does not have a login email." };

  const redirectTo = `${appBaseUrl()}/update-password`;
  console.info("ELS auth debug: password reset email requested", {
    userId,
    email,
    redirectTo,
    projectUrl: supabasePublicUrl(),
    projectRef: supabaseProjectRef(supabasePublicUrl()),
  });
  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
  await auditAuthAction(admin, {
    user_id: userId,
    admin_user_id: session.user?.id || null,
    action: "password_reset_email_requested",
    success: !error,
    message: error?.message || `redirect: ${redirectTo}`,
  });
  if (error) return { ok: false, message: `Reset request failed: redirectTo=${redirectTo}; ${authDebugError(error)}` };
  return { ok: true, message: `Password reset email sent to ${email}. Reset link opens ${redirectTo}.` };
}
