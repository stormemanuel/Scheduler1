import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { VIEW_AS_USER_COOKIE } from "@/lib/auth";

function normalizeRole(role: string | null | undefined) {
  return String(role || "viewer").toLowerCase().trim();
}

function isOwnerAdminRole(role: string | null | undefined) {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "admin";
}

function cleanText(value: unknown, maxLength = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanPath(value: unknown) {
  const path = cleanText(value, 300);
  return path.startsWith("/") ? path : "/";
}

function tableMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("user_live_activity") && (text.includes("does not exist") || text.includes("schema cache"));
}

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user, supabase };
}

async function requireOwnerAdmin() {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth;
  const { data: profile, error } = await auth.supabase.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (error) return { ok: false as const, response: NextResponse.json({ message: error.message }, { status: 400 }) };
  if (!isOwnerAdminRole((profile as { role?: string | null } | null)?.role)) {
    return { ok: false as const, response: NextResponse.json({ message: "Admin access is required." }, { status: 403 }) };
  }
  return { ok: true as const, user: auth.user, supabase: auth.supabase };
}

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "activity";

  if (action === "manifest") {
    return new NextResponse(JSON.stringify({
      name: "ELS Scheduler",
      short_name: "ELS",
      description: "Emanuel Labor Services scheduling, staffing, client, and payroll app.",
      id: "/",
      start_url: "/",
      scope: "/",
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
      orientation: "portrait-primary",
      background_color: "#f7f8f4",
      theme_color: "#0d333d",
      icons: [
        {
          src: "/apple-touch-icon.png?v=2",
          sizes: "180x180",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  }

  if (action === "exit_preview") {
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(VIEW_AS_USER_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const [profilesRes, activityRes] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, role, is_active").order("full_name", { ascending: true }),
    admin.from("user_live_activity").select("user_id, current_path, page_label, context_type, context_id, context_label, last_action, is_visible, last_seen_at, updated_at"),
  ]);

  if (profilesRes.error) return NextResponse.json({ message: profilesRes.error.message }, { status: 400 });
  if (activityRes.error && !tableMissing(activityRes.error.message)) {
    return NextResponse.json({ message: activityRes.error.message }, { status: 400 });
  }

  const activityByUser = new Map((activityRes.data ?? []).map((row) => [String((row as { user_id: string }).user_id), row]));
  const now = Date.now();
  const activities = (profilesRes.data ?? [])
    .filter((profile) => (profile as { is_active?: boolean | null }).is_active !== false)
    .map((profile) => {
      const typedProfile = profile as { id: string; email?: string | null; full_name?: string | null; role?: string | null };
      const activity = activityByUser.get(typedProfile.id) as {
        current_path?: string | null;
        page_label?: string | null;
        context_type?: string | null;
        context_id?: string | null;
        context_label?: string | null;
        last_action?: string | null;
        is_visible?: boolean | null;
        last_seen_at?: string | null;
      } | undefined;
      const seenAt = activity?.last_seen_at ? new Date(activity.last_seen_at).getTime() : 0;
      const ageMs = seenAt ? Math.max(0, now - seenAt) : Number.POSITIVE_INFINITY;
      const status = ageMs <= 45_000 && activity?.is_visible !== false
        ? "online"
        : ageMs <= 5 * 60_000
          ? "idle"
          : "offline";

      return {
        user_id: typedProfile.id,
        full_name: typedProfile.full_name || typedProfile.email || "Unknown user",
        email: typedProfile.email || "",
        role: normalizeRole(typedProfile.role),
        status,
        current_path: activity?.current_path || "",
        page_label: activity?.page_label || "",
        context_type: activity?.context_type || "",
        context_id: activity?.context_id || "",
        context_label: activity?.context_label || "",
        last_action: activity?.last_action || "",
        last_seen_at: activity?.last_seen_at || null,
      };
    })
    .sort((a, b) => {
      const rank = { online: 0, idle: 1, offline: 2 } as const;
      const statusDiff = rank[a.status as keyof typeof rank] - rank[b.status as keyof typeof rank];
      if (statusDiff) return statusDiff;
      return a.full_name.localeCompare(b.full_name);
    });

  return NextResponse.json({
    setup_missing: Boolean(activityRes.error && tableMissing(activityRes.error.message)),
    current_user_id: auth.user.id,
    activities,
    refreshed_at: new Date(now).toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = cleanText(body.action, 40);

  if (action === "heartbeat") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    if (request.cookies.get(VIEW_AS_USER_COOKIE)?.value) return new NextResponse(null, { status: 204 });

    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

    const payload: Record<string, unknown> = {
      user_id: auth.user.id,
      current_path: cleanPath(body.current_path),
      page_label: cleanText(body.page_label, 80) || null,
      context_type: cleanText(body.context_type, 40) || null,
      context_id: cleanText(body.context_id, 100) || null,
      context_label: cleanText(body.context_label, 180) || null,
      is_visible: body.is_visible !== false,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const lastAction = cleanText(body.last_action, 180);
    if (lastAction) payload.last_action = lastAction;

    const { error } = await admin.from("user_live_activity").upsert(payload, { onConflict: "user_id" });
    if (error && tableMissing(error.message)) return new NextResponse(null, { status: 204 });
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return new NextResponse(null, { status: 204 });
  }

  if (action === "start_preview") {
    const auth = await requireOwnerAdmin();
    if (!auth.ok) return auth.response;
    const userId = cleanText(body.user_id || body.userId, 80);
    if (!userId) return NextResponse.json({ message: "User is required." }, { status: 400 });
    if (userId === auth.user.id) return NextResponse.json({ message: "You are already viewing your own account." }, { status: 400 });

    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const { data: target, error } = await admin
      .from("profiles")
      .select("id, full_name, email, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    if (!target) return NextResponse.json({ message: "User was not found." }, { status: 404 });
    if ((target as { is_active?: boolean | null }).is_active === false) {
      return NextResponse.json({ message: "Inactive users cannot be previewed." }, { status: 400 });
    }

    const response = NextResponse.json({
      ok: true,
      user_id: userId,
      full_name: (target as { full_name?: string | null; email?: string | null }).full_name || (target as { email?: string | null }).email || "User",
    });
    response.cookies.set(VIEW_AS_USER_COOKIE, userId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 2,
    });
    return response;
  }

  return NextResponse.json({ message: "Unsupported action." }, { status: 400 });
}

export async function PATCH(request: Request) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const userId = String(body.user_id || body.userId || "").trim();
  const allowedCityPoolIds = Array.isArray(body.allowed_city_pool_ids)
    ? Array.from(new Set(body.allowed_city_pool_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean)))
    : [];

  if (!userId) return NextResponse.json({ message: "User is required." }, { status: 400 });

  const { data: existing } = await admin
    .from("user_access_settings")
    .select("allowed_pages, restrict_events_to_owner, restrict_crew_to_owner, can_edit_event_details")
    .eq("user_id", userId)
    .maybeSingle();

  const existingRow = existing as { allowed_pages?: string[] | null; restrict_events_to_owner?: boolean | null; restrict_crew_to_owner?: boolean | null; can_edit_event_details?: boolean | null } | null;
  const { error } = await admin.from("user_access_settings").upsert({
    user_id: userId,
    allowed_pages: existingRow?.allowed_pages ?? ["overview", "coordinator", "events", "crew"],
    restrict_events_to_owner: existingRow?.restrict_events_to_owner ?? true,
    restrict_crew_to_owner: existingRow?.restrict_crew_to_owner ?? true,
    can_edit_event_details: existingRow?.can_edit_event_details ?? false,
    allowed_city_pool_ids: allowedCityPoolIds,
    updated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, allowed_city_pool_ids: allowedCityPoolIds });
}
