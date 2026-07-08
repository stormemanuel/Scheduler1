import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { VIEW_AS_USER_COOKIE } from "@/lib/auth";

const ELS_APP_ICON_BASE64 = "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";

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

function decodeBase64Bytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function tableMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("user_live_activity") && (text.includes("does not exist") || text.includes("schema cache"));
}

function coordinatorNotificationsMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return (text.includes("coordinator_event_notifications") || text.includes("coordinator_event_notification_messages")) && (text.includes("does not exist") || text.includes("schema cache"));
}

function directMessagesMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("direct_user_messages") && (text.includes("does not exist") || text.includes("schema cache"));
}

type CoordinatorNotificationMessage = {
  id: string;
  notification_id: string;
  sender_user_id?: string | null;
  sender_role?: string | null;
  body?: string | null;
  created_at?: string | null;
  read_at?: string | null;
};

type DirectUserMessage = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  body: string;
  created_at: string;
  read_at?: string | null;
};

async function loadCoordinatorNotificationMessages(admin: ReturnType<typeof createSupabaseAdminClient>, notificationIds: string[]) {
  if (!admin || !notificationIds.length) return { setupMissing: false, messagesByNotification: new Map<string, CoordinatorNotificationMessage[]>(), unreadAdminReplyCount: 0, unreadCoordinatorReplyCount: 0 };
  const { data, error } = await admin
    .from("coordinator_event_notification_messages")
    .select("id, notification_id, sender_user_id, sender_role, body, created_at, read_at")
    .in("notification_id", notificationIds)
    .order("created_at", { ascending: true });
  if (error && coordinatorNotificationsMissing(error.message)) {
    return { setupMissing: true, messagesByNotification: new Map<string, CoordinatorNotificationMessage[]>(), unreadAdminReplyCount: 0, unreadCoordinatorReplyCount: 0 };
  }
  if (error) throw new Error(error.message);
  const messages = (data || []) as CoordinatorNotificationMessage[];
  const messagesByNotification = new Map<string, CoordinatorNotificationMessage[]>();
  let unreadAdminReplyCount = 0;
  let unreadCoordinatorReplyCount = 0;
  for (const message of messages) {
    const notificationId = String(message.notification_id || "");
    if (!notificationId) continue;
    messagesByNotification.set(notificationId, [...(messagesByNotification.get(notificationId) || []), message]);
    if (!message.read_at && message.sender_role === "admin") unreadAdminReplyCount += 1;
    if (!message.read_at && message.sender_role === "coordinator") unreadCoordinatorReplyCount += 1;
  }
  return { setupMissing: false, messagesByNotification, unreadAdminReplyCount, unreadCoordinatorReplyCount };
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

  if (action === "app_icon") {
    return new NextResponse(decodeBase64Bytes(ELS_APP_ICON_BASE64), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  }

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
          src: "/api/user-access?action=app_icon",
          sizes: "180x180",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=300, must-revalidate",
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

  if (action === "coordinator_notifications") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profileError) return NextResponse.json({ message: profileError.message }, { status: 400 });
    const role = normalizeRole((profile as { role?: string | null } | null)?.role);
    const includeViewed = request.nextUrl.searchParams.get("include_viewed") === "1";
    if (role === "owner" || role === "admin") {
      const { data, error } = await admin
        .from("coordinator_event_notifications")
        .select("id, user_id, show_id, sub_call_id, notification_type, title, body, created_at, viewed_at, reply_body, replied_at, reply_reviewed_at, profiles:user_id(full_name,email)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error && coordinatorNotificationsMissing(error.message)) {
        return NextResponse.json({ ok: true, setup_missing: true, unread_count: 0, rows: [] });
      }
      if (error) return NextResponse.json({ message: error.message }, { status: 400 });
      const notificationIds = (data || []).map((row) => String((row as { id?: string }).id || "")).filter(Boolean);
      const messageState = await loadCoordinatorNotificationMessages(admin, notificationIds).catch((messageError: unknown) => {
        throw messageError instanceof Error ? messageError : new Error("Unable to load coordinator messages.");
      });
      const rows = (data || []).map((row) => {
        const typed = row as Record<string, unknown> & { profiles?: { full_name?: string | null; email?: string | null } | null };
        const id = String(typed.id || "");
        return {
          ...typed,
          coordinator_name: typed.profiles?.full_name || typed.profiles?.email || "Coordinator",
          messages: messageState.messagesByNotification.get(id) || [],
          profiles: undefined,
        };
      });
      return NextResponse.json({
        ok: true,
        setup_missing: messageState.setupMissing,
        unread_count: messageState.unreadCoordinatorReplyCount,
        rows,
      });
    }
    if (role !== "coordinator") {
      return NextResponse.json({ ok: true, unread_count: 0, rows: [] });
    }
    let query = admin
      .from("coordinator_event_notifications")
      .select("id, show_id, sub_call_id, notification_type, title, body, created_at, viewed_at, reply_body, replied_at, reply_reviewed_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(99);
    if (!includeViewed) query = query.is("viewed_at", null);
    const { data, error } = await query;
    if (error && coordinatorNotificationsMissing(error.message)) {
      return NextResponse.json({ ok: true, setup_missing: true, unread_count: 0, rows: [] });
    }
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    const notificationIds = (data || []).map((row) => String((row as { id?: string }).id || "")).filter(Boolean);
    const messageState = await loadCoordinatorNotificationMessages(admin, notificationIds).catch((messageError: unknown) => {
      throw messageError instanceof Error ? messageError : new Error("Unable to load coordinator messages.");
    });
    const rows = (data || []).map((row) => {
      const typed = row as Record<string, unknown>;
      const id = String(typed.id || "");
      return { ...typed, messages: messageState.messagesByNotification.get(id) || [] };
    });
    return NextResponse.json({
      ok: true,
      setup_missing: messageState.setupMissing,
      unread_count: (data || []).filter((row) => !(row as { viewed_at?: string | null }).viewed_at).length + messageState.unreadAdminReplyCount,
      rows,
    });
  }

  if (action === "direct_messages") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

    const usersRes = await admin
      .from("profiles")
      .select("id, email, full_name, role, is_active")
      .order("full_name", { ascending: true });
    if (usersRes.error) return NextResponse.json({ message: usersRes.error.message }, { status: 400 });

    const { data, error } = await admin
      .from("direct_user_messages")
      .select("id, sender_user_id, recipient_user_id, body, created_at, read_at")
      .or(`sender_user_id.eq.${auth.user.id},recipient_user_id.eq.${auth.user.id}`)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error && directMessagesMissing(error.message)) {
      return NextResponse.json({
        ok: true,
        setup_missing: true,
        current_user_id: auth.user.id,
        unread_count: 0,
        rows: [],
        users: (usersRes.data ?? []).filter((row) => (row as { is_active?: boolean | null }).is_active !== false),
      });
    }
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });

    const unreadIds = (data ?? [])
      .filter((row) => String((row as { recipient_user_id?: string }).recipient_user_id || "") === auth.user.id && !(row as { read_at?: string | null }).read_at)
      .map((row) => String((row as { id?: string }).id || ""))
      .filter(Boolean);
    if (unreadIds.length) {
      await admin
        .from("direct_user_messages")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds);
    }

    return NextResponse.json({
      ok: true,
      setup_missing: false,
      current_user_id: auth.user.id,
      unread_count: unreadIds.length,
      rows: (data ?? []) as DirectUserMessage[],
      users: (usersRes.data ?? []).filter((row) => (row as { is_active?: boolean | null }).is_active !== false),
    });
  }

  if (action === "direct_message_count") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const { count, error } = await admin
      .from("direct_user_messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", auth.user.id)
      .is("read_at", null);
    if (error && directMessagesMissing(error.message)) {
      return NextResponse.json({ ok: true, setup_missing: true, unread_count: 0 });
    }
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, setup_missing: false, unread_count: count || 0 });
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

  if (action === "mark_coordinator_notifications_viewed") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profileError) return NextResponse.json({ message: profileError.message }, { status: 400 });
    if (normalizeRole((profile as { role?: string | null } | null)?.role) !== "coordinator") {
      return NextResponse.json({ ok: true, viewed_count: 0 });
    }
    const { data, error } = await admin
      .from("coordinator_event_notifications")
      .update({ viewed_at: new Date().toISOString() })
      .eq("user_id", auth.user.id)
      .is("viewed_at", null)
      .select("id");
    if (error && coordinatorNotificationsMissing(error.message)) {
      return NextResponse.json({ ok: true, setup_missing: true, viewed_count: 0 });
    }
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    const notificationIds = (data || []).map((row) => String((row as { id?: string }).id || "")).filter(Boolean);
    if (notificationIds.length) {
      const readMessages = await admin
        .from("coordinator_event_notification_messages")
        .update({ read_at: new Date().toISOString() })
        .in("notification_id", notificationIds)
        .eq("sender_role", "admin")
        .is("read_at", null);
      if (readMessages.error && !coordinatorNotificationsMissing(readMessages.error.message)) return NextResponse.json({ message: readMessages.error.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, setup_missing: false, viewed_count: data?.length || 0 });
  }

  if (action === "send_coordinator_notification_message") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const notificationId = cleanText(body.notification_id || body.notificationId, 80);
    const messageBody = cleanText(body.message_body || body.messageBody || body.reply_body || body.replyBody, 1000);
    if (!notificationId) return NextResponse.json({ message: "Chat is required." }, { status: 400 });
    if (!messageBody) return NextResponse.json({ message: "Type a message first." }, { status: 400 });

    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profileError) return NextResponse.json({ message: profileError.message }, { status: 400 });
    const role = normalizeRole((profile as { role?: string | null } | null)?.role);
    const ownerAdmin = role === "owner" || role === "admin";
    const notificationQuery = admin
      .from("coordinator_event_notifications")
      .select("id, user_id")
      .eq("id", notificationId);
    const { data: notification, error: notificationError } = ownerAdmin
      ? await notificationQuery.maybeSingle()
      : await notificationQuery.eq("user_id", auth.user.id).maybeSingle();
    if (notificationError && coordinatorNotificationsMissing(notificationError.message)) {
      return NextResponse.json({ ok: false, setup_missing: true, message: "Coordinator notification SQL has not been installed yet." }, { status: 409 });
    }
    if (notificationError) return NextResponse.json({ message: notificationError.message }, { status: 400 });
    if (!notification) return NextResponse.json({ message: "Chat was not found or is not assigned to you." }, { status: 404 });

    const senderRole = ownerAdmin ? "admin" : "coordinator";
    const { error: messageError } = await admin.from("coordinator_event_notification_messages").insert({
      notification_id: notificationId,
      sender_user_id: auth.user.id,
      sender_role: senderRole,
      body: messageBody,
    });
    if (messageError && coordinatorNotificationsMissing(messageError.message)) {
      return NextResponse.json({ ok: false, setup_missing: true, message: "Coordinator notification SQL has not been installed yet." }, { status: 409 });
    }
    if (messageError) return NextResponse.json({ message: messageError.message }, { status: 400 });

    const patch = senderRole === "coordinator"
      ? { reply_body: messageBody, replied_at: new Date().toISOString(), reply_reviewed_at: null }
      : { viewed_at: null };
    await admin.from("coordinator_event_notifications").update(patch).eq("id", notificationId);
    return NextResponse.json({ ok: true, message: senderRole === "coordinator" ? "Message sent to admin." : "Message sent to coordinator." });
  }

  if (action === "reply_to_coordinator_notification") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const notificationId = cleanText(body.notification_id || body.notificationId, 80);
    const replyBody = cleanText(body.reply_body || body.replyBody, 1000);
    if (!notificationId) return NextResponse.json({ message: "Notification is required." }, { status: 400 });
    if (!replyBody) return NextResponse.json({ message: "Type a reply first." }, { status: 400 });
    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (profileError) return NextResponse.json({ message: profileError.message }, { status: 400 });
    if (normalizeRole((profile as { role?: string | null } | null)?.role) !== "coordinator") {
      return NextResponse.json({ message: "Only coordinators can reply to coordinator assignment messages." }, { status: 403 });
    }
    const { error } = await admin.from("coordinator_event_notification_messages").insert({
      notification_id: notificationId,
      sender_user_id: auth.user.id,
      sender_role: "coordinator",
      body: replyBody,
    });
    if (error && coordinatorNotificationsMissing(error.message)) {
      return NextResponse.json({ ok: false, setup_missing: true, message: "Coordinator notification SQL has not been installed yet." }, { status: 409 });
    }
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    await admin
      .from("coordinator_event_notifications")
      .update({ reply_body: replyBody, replied_at: new Date().toISOString(), reply_reviewed_at: null })
      .eq("id", notificationId)
      .eq("user_id", auth.user.id);
    return NextResponse.json({ ok: true, message: "Reply sent to admin." });
  }

  if (action === "mark_coordinator_reply_reviewed") {
    const auth = await requireOwnerAdmin();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const notificationId = cleanText(body.notification_id || body.notificationId, 80);
    if (!notificationId) return NextResponse.json({ message: "Notification is required." }, { status: 400 });
    const { error } = await admin
      .from("coordinator_event_notifications")
      .update({ reply_reviewed_at: new Date().toISOString() })
      .eq("id", notificationId);
    if (error && coordinatorNotificationsMissing(error.message)) return NextResponse.json({ ok: true, setup_missing: true });
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    const readMessages = await admin
      .from("coordinator_event_notification_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("notification_id", notificationId)
      .eq("sender_role", "coordinator")
      .is("read_at", null);
    if (readMessages.error && !coordinatorNotificationsMissing(readMessages.error.message)) return NextResponse.json({ message: readMessages.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Reply marked reviewed." });
  }

  if (action === "send_direct_message") {
    const auth = await requireSignedIn();
    if (!auth.ok) return auth.response;
    const admin = createSupabaseAdminClient();
    if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
    const recipientId = cleanText(body.recipient_id || body.recipientId, 80);
    const messageBody = cleanText(body.message_body || body.messageBody, 2000);
    if (!recipientId) return NextResponse.json({ message: "Choose who to message." }, { status: 400 });
    if (recipientId === auth.user.id) return NextResponse.json({ message: "Choose another user." }, { status: 400 });
    if (!messageBody) return NextResponse.json({ message: "Type a message first." }, { status: 400 });

    const { data: recipient, error: recipientError } = await admin
      .from("profiles")
      .select("id, is_active")
      .eq("id", recipientId)
      .maybeSingle();
    if (recipientError) return NextResponse.json({ message: recipientError.message }, { status: 400 });
    if (!recipient || (recipient as { is_active?: boolean | null }).is_active === false) {
      return NextResponse.json({ message: "That user is not active." }, { status: 404 });
    }

    const { error } = await admin.from("direct_user_messages").insert({
      sender_user_id: auth.user.id,
      recipient_user_id: recipientId,
      body: messageBody,
    });
    if (error && directMessagesMissing(error.message)) {
      return NextResponse.json({ ok: false, setup_missing: true, message: "Direct message SQL has not been installed yet." }, { status: 409 });
    }
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Direct message sent." });
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
    allowed_pages: existingRow?.allowed_pages ?? ["overview", "coordinator", "events", "crew", "onboarding"],
    restrict_events_to_owner: existingRow?.restrict_events_to_owner ?? true,
    restrict_crew_to_owner: existingRow?.restrict_crew_to_owner ?? true,
    can_edit_event_details: existingRow?.can_edit_event_details ?? false,
    allowed_city_pool_ids: allowedCityPoolIds,
    updated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, allowed_city_pool_ids: allowedCityPoolIds });
}
