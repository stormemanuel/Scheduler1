"use server";

import { revalidatePath } from "next/cache";
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
function nonNegativeMoneyFromForm(formData: FormData, key: string, fallback: number) {
  const parsed = Number(String(formData.get(key) ?? "").trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

const defaultCoordinatorCompensation = {
  full_day_rate_1_20: 25,
  full_day_rate_21_35: 22.5,
  full_day_rate_36_50: 20,
  full_day_rate_51_plus: 17.5,
  half_day_rate_1_49: 15,
  half_day_rate_50_plus: 10,
};

function compensationSaveIssueMessage(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return "";
  const code = String(error.code || "");
  const message = String(error.message || "");
  const lower = message.toLowerCase();
  if (code === "42P01" || /relation .*coordinator_compensation_settings.* does not exist/i.test(message)) {
    return " Coordinator payout rates were not saved because the ELS295 compensation SQL has not been run.";
  }
  if (code.startsWith("PGRST") || lower.includes("schema cache")) {
    return " Coordinator payout rates were not saved because Supabase has not refreshed the API schema for the compensation table yet. Wait a minute, refresh the app, and try again.";
  }
  return ` Coordinator payout rate issue: ${message}`;
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

  const { error: upsertError } = await admin.from("profiles").upsert({
    id: userId,
    email,
    full_name: fullName || null,
    role,
    is_active: true,
  });

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

  if (role === "coordinator") {
    await admin.from("coordinator_compensation_settings").upsert({
      coordinator_user_id: userId,
      ...defaultCoordinatorCompensation,
      notes: null,
      updated_by: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "coordinator_user_id" });
  }

  revalidatePath("/users");
  if (createWithPassword) {
    return { ok: true, message: `Login created for ${email}. You can test it now, then send them the email and temporary password.` };
  }
  return { ok: true, message: `Invite sent to ${email}.` };
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

  if (!userId) return { ok: false, message: "Missing user id." };
  if (temporaryPassword && temporaryPassword.length < 8) {
    return { ok: false, message: "Temporary password must be at least 8 characters." };
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const resolvedPools = await resolveAllowedCityPoolIds(admin, rawAllowedCityPoolIds);
  if (resolvedPools.message && !resolvedPools.ids.length && rawAllowedCityPoolIds.length) {
    return { ok: false, message: resolvedPools.message.trim() };
  }
  const allowed_city_pool_ids = resolvedPools.ids;

  const { error: profileError } = await admin.from("profiles").update({
    email: email || null,
    full_name: fullName || null,
    role,
    is_active: isActive,
  }).eq("id", userId);

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
      compensationMessage = " Coordinator payout rates were skipped because the compensation table is not available to the Supabase API yet.";
    } else {
      const compensationPayload = {
        coordinator_user_id: userId,
        full_day_rate_1_20: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate1_20", defaultCoordinatorCompensation.full_day_rate_1_20),
        full_day_rate_21_35: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate21_35", defaultCoordinatorCompensation.full_day_rate_21_35),
        full_day_rate_36_50: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate36_50", defaultCoordinatorCompensation.full_day_rate_36_50),
        full_day_rate_51_plus: nonNegativeMoneyFromForm(formData, "coordinatorFullDayRate51Plus", defaultCoordinatorCompensation.full_day_rate_51_plus),
        half_day_rate_1_49: nonNegativeMoneyFromForm(formData, "coordinatorHalfDayRate1_49", defaultCoordinatorCompensation.half_day_rate_1_49),
        half_day_rate_50_plus: nonNegativeMoneyFromForm(formData, "coordinatorHalfDayRate50Plus", defaultCoordinatorCompensation.half_day_rate_50_plus),
        notes: String(formData.get("coordinatorCompensationNotes") || "").trim() || null,
        updated_by: session.user?.id || null,
        updated_at: new Date().toISOString(),
      };
      const { error: compensationError } = await admin
        .from("coordinator_compensation_settings")
        .upsert(compensationPayload, { onConflict: "coordinator_user_id" });
      if (compensationError) {
        compensationMessage = compensationSaveIssueMessage(compensationError);
      } else {
        compensationMessage = " Coordinator payout rates updated.";
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
  return { ok: true, message: `User access updated.${passwordMessage}${compensationMessage}` };
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
  const existingAuth = await admin.auth.admin.getUserById(userId);
  if (existingAuth.error || !existingAuth.data.user) {
    return { ok: false, message: `Password update failed: Auth user not found for this ELS profile ID. ${existingAuth.error?.message || ""}`.trim() };
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
  if (error) return { ok: false, message: `Password could not be updated: ${error.message}` };
  const verifiedAuth = await admin.auth.admin.getUserById(userId);
  if (verifiedAuth.error || !verifiedAuth.data.user) {
    return { ok: false, message: `Password update failed: Supabase could not verify the updated Auth user. ${verifiedAuth.error?.message || ""}`.trim() };
  }

  revalidatePath("/users");
  return {
    ok: true,
    message: `Temporary password successfully set for ${typedProfile?.full_name || typedProfile?.email || authUser.user?.email || "this user"}. Auth user updated: Yes. Updated at: ${new Date(updatedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}.`,
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
  const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
  await auditAuthAction(admin, {
    user_id: userId,
    admin_user_id: session.user?.id || null,
    action: "password_reset_email_requested",
    success: !error,
    message: error?.message || `redirect: ${redirectTo}`,
  });
  if (error) return { ok: false, message: `Reset request failed: ${error.message}` };
  return { ok: true, message: `Password reset email sent to ${email}. Reset link opens ${redirectTo}.` };
}
