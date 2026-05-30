"use server";

import { revalidatePath } from "next/cache";
import { requireRole, type AppPageKey } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const roleDefaults: Record<string, { pages: AppPageKey[]; restrictEvents: boolean; restrictCrew: boolean }> = {
  owner: { pages: ["overview", "crew", "events", "clients", "pipelines", "payroll", "users", "settings"], restrictEvents: false, restrictCrew: false },
  admin: { pages: ["overview", "crew", "events", "clients", "pipelines", "payroll", "users", "settings"], restrictEvents: false, restrictCrew: false },
  coordinator: { pages: ["overview", "events", "crew"], restrictEvents: true, restrictCrew: true },
  salesman: { pages: ["pipelines"], restrictEvents: true, restrictCrew: true },
  sales: { pages: ["pipelines"], restrictEvents: true, restrictCrew: true },
  viewer: { pages: ["overview"], restrictEvents: true, restrictCrew: true },
};

const allowedRoles = new Set(["owner", "admin", "coordinator", "salesman", "sales", "viewer"]);
const allowedPages = new Set<AppPageKey>(["overview", "crew", "events", "clients", "pipelines", "payroll", "users", "settings"]);

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

export async function inviteUserAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const email = String(formData.get("email") || "").trim();
  const fullName = String(formData.get("fullName") || "").trim();
  const role = normalizeStoredRole(formData.get("role"));

  if (!email) return { ok: false, message: "Email is required." };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role },
  });

  if (error) return { ok: false, message: error.message };

  const userId = data.user?.id;
  if (!userId) return { ok: false, message: "Invite succeeded but no user id was returned." };

  const { error: upsertError } = await admin.from("profiles").upsert({
    id: userId,
    email,
    full_name: fullName || null,
    role,
    is_active: true,
  });

  if (upsertError) return { ok: false, message: upsertError.message };

  const defaults = defaultAccessForRole(role);
  await admin.from("user_access_settings").upsert({
    user_id: userId,
    allowed_pages: defaults.pages,
    restrict_events_to_owner: defaults.restrictEvents,
    restrict_crew_to_owner: defaults.restrictCrew,
    allowed_city_pool_ids: [],
  });

  revalidatePath("/users");
  return { ok: true, message: `Invite sent to ${email}.` };
}

export async function updateUserAccessAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const userId = String(formData.get("userId") || "").trim();
  const fullName = String(formData.get("fullName") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const role = normalizeStoredRole(formData.get("role"));
  const isActive = formData.get("isActive") === "on";
  const allowed_pages = pagesFromForm(formData, role);
  const restrict_events_to_owner = formData.get("restrictEventsToOwner") === "on";
  const restrict_crew_to_owner = formData.get("restrictCrewToOwner") === "on";
  const allowed_city_pool_ids = formData.getAll("allowedCityPoolIds").map(String).filter(Boolean);

  if (!userId) return { ok: false, message: "Missing user id." };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const { error: profileError } = await admin.from("profiles").update({
    email: email || null,
    full_name: fullName || null,
    role,
    is_active: isActive,
  }).eq("id", userId);

  if (profileError) return { ok: false, message: profileError.message };

  const { error: accessError } = await admin.from("user_access_settings").upsert({
    user_id: userId,
    allowed_pages,
    restrict_events_to_owner,
    restrict_crew_to_owner,
    allowed_city_pool_ids,
    updated_at: new Date().toISOString(),
  });

  if (accessError) return { ok: false, message: accessError.message };

  revalidatePath("/users");
  revalidatePath("/");
  revalidatePath("/events");
  revalidatePath("/crew");
  revalidatePath("/pipelines");
  return { ok: true, message: "User access updated." };
}
