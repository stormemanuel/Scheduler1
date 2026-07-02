import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export type AppRole = "owner" | "admin" | "coordinator" | "salesman" | "viewer";

export type AppPageKey =
  | "overview"
  | "coordinator"
  | "crew"
  | "onboarding"
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

export type SessionProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  is_active: boolean | null;
};

export const VIEW_AS_USER_COOKIE = "els_view_as_user";

export const pageHrefByKey: Record<AppPageKey, string> = {
  overview: "/",
  coordinator: "/coordinator",
  crew: "/crew",
  onboarding: "/onboarding-center",
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
  onboarding: "Onboarding",
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

async function loadAccessSettings(
  client: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>> | NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userId: string,
  role: AppRole
): Promise<UserAccessSettings> {
  const { data: accessRow, error: accessError } = await client
    .from("user_access_settings")
    .select("user_id, allowed_pages, restrict_events_to_owner, restrict_crew_to_owner, can_edit_event_details, allowed_city_pool_ids")
    .eq("user_id", userId)
    .maybeSingle();

  if (!accessError && accessRow) {
    return {
      user_id: userId,
      allowed_pages: sanitizePageList((accessRow as { allowed_pages?: unknown }).allowed_pages, role),
      restrict_events_to_owner: Boolean((accessRow as { restrict_events_to_owner?: boolean }).restrict_events_to_owner),
      restrict_crew_to_owner: Boolean((accessRow as { restrict_crew_to_owner?: boolean }).restrict_crew_to_owner),
      can_edit_event_details: Boolean((accessRow as { can_edit_event_details?: boolean }).can_edit_event_details),
      allowed_city_pool_ids: Array.isArray((accessRow as { allowed_city_pool_ids?: unknown }).allowed_city_pool_ids)
        ? ((accessRow as { allowed_city_pool_ids?: string[] }).allowed_city_pool_ids || []).filter(Boolean)
        : [],
    };
  }

  return {
    user_id: userId,
    allowed_pages: defaultPagesForRole(role),
    restrict_events_to_owner: role === "coordinator",
    restrict_crew_to_owner: role === "coordinator",
    can_edit_event_details: false,
    allowed_city_pool_ids: [],
  };
}

export async function getSessionUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      user: null,
      profile: null,
      access: null as UserAccessSettings | null,
      setupMissing: true,
      isViewingAs: false,
      actorUser: null,
      actorProfile: null as SessionProfile | null,
      actorAccess: null as UserAccessSettings | null,
    };
  }

  const { data: { user: actorUser } } = await supabase.auth.getUser();
  if (!actorUser) {
    return {
      user: null,
      profile: null,
      access: null as UserAccessSettings | null,
      setupMissing: false,
      isViewingAs: false,
      actorUser: null,
      actorProfile: null as SessionProfile | null,
      actorAccess: null as UserAccessSettings | null,
    };
  }

  const { data: actorProfileData } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", actorUser.id)
    .maybeSingle();

  const actorProfile = (actorProfileData ?? {
    id: actorUser.id,
    email: actorUser.email || null,
    full_name: String(actorUser.user_metadata?.full_name || actorUser.email || ""),
    role: "viewer",
    is_active: true,
  }) as SessionProfile;
  const actorRole = normalizeRole(actorProfile.role);
  const actorAccess = await loadAccessSettings(supabase, actorUser.id, actorRole);

  let user = actorUser;
  let profile = actorProfile;
  let access = actorAccess;
  let isViewingAs = false;

  if (actorRole === "owner" || actorRole === "admin") {
    const cookieStore = await cookies();
    const requestedUserId = String(cookieStore.get(VIEW_AS_USER_COOKIE)?.value || "").trim();
    if (requestedUserId && requestedUserId !== actorUser.id) {
      const admin = createSupabaseAdminClient();
      const lookupClient = admin ?? supabase;
      const { data: targetProfileData } = await lookupClient
        .from("profiles")
        .select("id, email, full_name, role, is_active")
        .eq("id", requestedUserId)
        .maybeSingle();
      const targetProfile = targetProfileData as SessionProfile | null;

      if (targetProfile && targetProfile.is_active !== false) {
        const targetRole = normalizeRole(targetProfile.role);
        const targetAccess = await loadAccessSettings(lookupClient, targetProfile.id, targetRole);
        user = {
          ...actorUser,
          id: targetProfile.id,
          email: targetProfile.email || undefined,
          user_metadata: {
            ...(actorUser.user_metadata || {}),
            full_name: targetProfile.full_name || targetProfile.email || "",
            role: targetRole,
            force_password_change: false,
          },
        };
        profile = targetProfile;
        access = targetAccess;
        isViewingAs = true;
      }
    }
  }

  return {
    user,
    profile,
    access,
    setupMissing: false,
    isViewingAs,
    actorUser,
    actorProfile,
    actorAccess,
  };
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
