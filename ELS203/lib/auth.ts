import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export type AppRole = "owner" | "admin" | "coordinator" | "salesman" | "viewer";

export type AppPageKey =
  | "overview"
  | "coordinator"
  | "crew"
  | "events"
  | "clients"
  | "pipelines"
  | "payroll"
  | "users"
  | "settings";

export type UserAccessSettings = {
  user_id: string;
  allowed_pages: AppPageKey[];
  restrict_events_to_owner: boolean;
  restrict_crew_to_owner: boolean;
  can_edit_event_details: boolean;
  allowed_city_pool_ids: string[];
};

export const pageHrefByKey: Record<AppPageKey, string> = {
  overview: "/",
  coordinator: "/coordinator",
  crew: "/crew",
  events: "/events",
  clients: "/clients",
  pipelines: "/pipelines",
  payroll: "/payroll",
  users: "/users",
  settings: "/settings",
};

export const pageLabelByKey: Record<AppPageKey, string> = {
  overview: "Overview",
  coordinator: "Coordinator",
  crew: "Crew",
  events: "Events",
  clients: "Clients",
  pipelines: "Sales Pipeline",
  payroll: "Payroll",
  users: "Users",
  settings: "Settings",
};

const validPageKeys = Object.keys(pageHrefByKey) as AppPageKey[];

export function normalizeRole(role: string | null | undefined): AppRole {
  const value = String(role || "viewer").toLowerCase().trim();
  if (value === "owner") return "owner";
  if (value === "admin") return "admin";
  if (value === "coordinator") return "coordinator";
  if (value === "sales" || value === "salesman") return "salesman";
  return "viewer";
}

export function defaultPagesForRole(role: AppRole): AppPageKey[] {
  if (role === "owner" || role === "admin") return validPageKeys;
  if (role === "coordinator") return ["overview", "coordinator", "events", "crew"];
  if (role === "salesman") return ["pipelines"];
  return ["overview"];
}

function sanitizePageList(value: unknown, role: AppRole): AppPageKey[] {
  const incoming = Array.isArray(value) ? value : [];
  const pages = incoming.filter((page): page is AppPageKey => validPageKeys.includes(page as AppPageKey));
  return pages.length ? pages : defaultPagesForRole(role);
}

export function canUsePage(role: AppRole, settings: UserAccessSettings | null, page: AppPageKey) {
  if (role === "owner" || role === "admin") return true;
  const allowed = settings?.allowed_pages?.length ? settings.allowed_pages : defaultPagesForRole(role);
  return allowed.includes(page);
}

export async function getSessionUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { user: null, profile: null, access: null as UserAccessSettings | null, setupMissing: true };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, access: null as UserAccessSettings | null, setupMissing: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  const role = normalizeRole(profile?.role as string | null | undefined);
  let access: UserAccessSettings | null = null;
  const { data: accessRow, error: accessError } = await supabase
    .from("user_access_settings")
    .select("user_id, allowed_pages, restrict_events_to_owner, restrict_crew_to_owner, can_edit_event_details, allowed_city_pool_ids")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!accessError && accessRow) {
    access = {
      user_id: user.id,
      allowed_pages: sanitizePageList((accessRow as { allowed_pages?: unknown }).allowed_pages, role),
      restrict_events_to_owner: Boolean((accessRow as { restrict_events_to_owner?: boolean }).restrict_events_to_owner),
      restrict_crew_to_owner: Boolean((accessRow as { restrict_crew_to_owner?: boolean }).restrict_crew_to_owner),
      can_edit_event_details: Boolean((accessRow as { can_edit_event_details?: boolean }).can_edit_event_details),
      allowed_city_pool_ids: Array.isArray((accessRow as { allowed_city_pool_ids?: unknown }).allowed_city_pool_ids)
        ? ((accessRow as { allowed_city_pool_ids?: string[] }).allowed_city_pool_ids || []).filter(Boolean)
        : [],
    };
  } else {
    access = {
      user_id: user.id,
      allowed_pages: defaultPagesForRole(role),
      restrict_events_to_owner: role === "coordinator",
      restrict_crew_to_owner: role === "coordinator",
      can_edit_event_details: false,
      allowed_city_pool_ids: [],
    };
  }

  return { user, profile, access, setupMissing: false };
}

export async function requireUser() {
  const session = await getSessionUser();
  if (session.setupMissing) return session;
  if (!session.user) redirect("/login");
  return session;
}

export async function requireRole(allowed: AppRole[]) {
  const session = await requireUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  if (!allowed.includes(role)) redirect("/");
  return session;
}

export async function requirePage(page: AppPageKey) {
  const session = await requireUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  if (!canUsePage(role, session.access, page)) redirect("/");
  return { ...session, role, access: session.access };
}
