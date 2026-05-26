import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { createSupabaseAdminClient } from "@/lib/supabase-server";

type AutomationRow = {
  show_id: string;
  enabled: boolean | null;
  sending_method: string | null;
  shortcut_token: string | null;
};

type QueueRow = {
  id: string;
  show_id: string;
  crew_id: string | null;
  crew_name: string | null;
  phone: string | null;
  message_type: string | null;
  reminder_key: string | null;
  scheduled_for: string;
  status: string | null;
  body: string | null;
  sent_at: string | null;
  error: string | null;
  created_at: string;
};

type IntroQueueRow = {
  id: string;
  crew_id: string | null;
  crew_name: string | null;
  phone: string | null;
  body: string | null;
  status: string | null;
  scheduled_for: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
};


function shortcutJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("X-ELS-Shortcut-Response", "json");
  return NextResponse.json(body, { ...init, headers });
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function absoluteUrl(request: Request, pathAndQuery: string) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}${pathAndQuery}`;
}

async function loadAutomation(showId: string, token: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const { data, error } = await admin
    .from("show_text_automations")
    .select("show_id, enabled, sending_method, shortcut_token")
    .eq("show_id", showId)
    .single();
  if (error || !data) throw new Error(error?.message || "Text automation is not set up for this show.");
  const automation = data as AutomationRow;
  if (!automation.enabled) throw new Error("Text automation is not activated for this show.");
  if (automation.sending_method !== "shortcut") throw new Error("This show is not set to Apple Shortcut Mode.");
  if (!automation.shortcut_token || automation.shortcut_token !== token) throw new Error("Invalid Shortcut token.");
  return { admin, automation };
}

async function loadUniversalAutomations(token: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const { data, error } = await admin
    .from("show_text_automations")
    .select("show_id, enabled, sending_method, shortcut_token")
    .eq("enabled", true)
    .eq("sending_method", "shortcut")
    .eq("shortcut_token", token);
  if (error) throw new Error(error.message);
  const automations = ((data || []) as AutomationRow[]).filter((row) => row.shortcut_token === token);
  if (!automations.length) throw new Error("Invalid universal Shortcut token, or no active Apple Shortcut events are using this token.");
  return { admin, automations };
}

function messagePayload(request: Request, row: QueueRow, showId: string, token: string, universal = false) {
  const base = universal
    ? `/api/text-automation/shortcut?all=1&token=${encodeURIComponent(token)}`
    : `/api/text-automation/shortcut?show_id=${encodeURIComponent(showId)}&token=${encodeURIComponent(token)}`;
  const markSent = `${base}&action=sent&id=${encodeURIComponent(row.id)}`;
  const markFailed = `${base}&action=failed&id=${encodeURIComponent(row.id)}`;
  return {
    id: row.id,
    show_id: row.show_id,
    crew_id: row.crew_id,
    crew_name: row.crew_name || "Crew member",
    phone: row.phone || "",
    body: row.body || "",
    message_type: row.message_type || "schedule",
    reminder_key: row.reminder_key || "manual",
    scheduled_for: row.scheduled_for,
    mark_sent_url: absoluteUrl(request, markSent),
    mark_failed_url: absoluteUrl(request, markFailed),
  };
}

function introMessagePayload(request: Request, row: IntroQueueRow, token: string) {
  const base = `/api/text-automation/shortcut?all=1&token=${encodeURIComponent(token)}&source=intro`;
  const markSent = `${base}&action=sent&id=${encodeURIComponent(row.id)}`;
  const markFailed = `${base}&action=failed&id=${encodeURIComponent(row.id)}`;
  return {
    id: row.id,
    show_id: "intro",
    queue_type: "intro",
    crew_id: row.crew_id,
    crew_name: row.crew_name || "Crew contact",
    phone: row.phone || "",
    body: row.body || "",
    message_type: "intro",
    reminder_key: "intro",
    scheduled_for: row.scheduled_for,
    mark_sent_url: absoluteUrl(request, markSent),
    mark_failed_url: absoluteUrl(request, markFailed),
  };
}

async function loadDueEventMessages(request: Request, admin: ReturnType<typeof createSupabaseAdminClient>, showIds: string[], token: string, limit: number, universal = true) {
  if (!admin || !showIds.length) return [];
  const { data, error } = await admin
    .from("text_message_queue")
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
    .in("show_id", showIds)
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data || []) as QueueRow[])
    .filter((row) => safeText(row.phone) && safeText(row.body))
    .map((row) => messagePayload(request, row, row.show_id, token, universal));
}

async function loadDueEventMessagesGlobal(request: Request, admin: ReturnType<typeof createSupabaseAdminClient>, token: string, limit: number) {
  if (!admin || limit <= 0) return [];
  const { data, error } = await admin
    .from("text_message_queue")
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data || []) as QueueRow[])
    .filter((row) => safeText(row.phone) && safeText(row.body))
    .map((row) => messagePayload(request, row, row.show_id, token, true));
}

async function loadDueIntroMessages(request: Request, admin: ReturnType<typeof createSupabaseAdminClient>, token: string, limit: number) {
  if (!admin || limit <= 0) return [];
  const introRes = await admin
    .from("crew_intro_text_queue")
    .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (introRes.error && !introRes.error.message.includes('relation "crew_intro_text_queue" does not exist')) throw new Error(introRes.error.message);
  return ((introRes.data || []) as IntroQueueRow[])
    .filter((row) => safeText(row.phone) && safeText(row.body))
    .map((row) => introMessagePayload(request, row, token));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const showId = safeText(params.get("show_id"));
  const token = safeText(params.get("token"));
  const action = safeText(params.get("action"));
  const id = safeText(params.get("id"));
  const source = safeText(params.get("source"));
  const testMode = safeText(params.get("test")) === "1" || action === "test" || action === "ping";
  const allActive = safeText(params.get("all")) === "1" || safeText(params.get("mode")) === "all";
  const limit = Math.min(Math.max(Number(params.get("limit") || 5), 1), 25);

  if (!token) {
    return shortcutJson({ ok: false, message: "token is required." }, { status: 400 });
  }
  if (!allActive && !showId) {
    return shortcutJson({ ok: false, message: "show_id is required unless all=1 is used." }, { status: 400 });
  }

  try {
    if (allActive) {
      const { admin, automations } = await loadUniversalAutomations(token);
      const showIds = automations.map((row) => row.show_id).filter(Boolean);

      if (testMode) {
        const eventMessages = await loadDueEventMessagesGlobal(request, admin, token, limit);
        const introMessages = await loadDueIntroMessages(request, admin, token, Math.max(0, limit - eventMessages.length));
        const messages = [...eventMessages, ...introMessages].slice(0, limit);
        return shortcutJson({
          ok: true,
          mode: "all",
          test: true,
          json_ready: true,
          active_show_count: showIds.length,
          queue_lookup: "all_due_scheduled_messages",
          count: messages.length,
          messages,
          message: messages.length
            ? `Shortcut endpoint is public and ${messages.length} due message${messages.length === 1 ? " is" : "s are"} ready. Test mode does not mark them sent.`
            : "Shortcut endpoint is public and returning JSON correctly. No due messages are waiting right now."
        });
      }

      if (action === "sent" || action === "failed") {
        if (!id) return shortcutJson({ ok: false, message: "id is required." }, { status: 400 });
        const patch = action === "sent"
          ? { status: "sent", sent_at: new Date().toISOString(), error: null }
          : { status: "failed", error: "Marked failed by Apple Shortcut." };
        if (source === "intro") {
          const { data, error } = await admin
            .from("crew_intro_text_queue")
            .update(patch)
            .eq("id", id)
            .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at")
            .single();
          if (error) throw new Error(error.message);
          return shortcutJson({ ok: true, message: action === "sent" ? "Intro marked sent." : "Intro marked failed.", item: data });
        }
        const { data, error } = await admin
          .from("text_message_queue")
          .update(patch)
          .eq("id", id)
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
          .single();
        if (error) throw new Error(error.message);
        return shortcutJson({ ok: true, message: action === "sent" ? "Marked sent." : "Marked failed.", item: data });
      }

      const eventMessages = await loadDueEventMessagesGlobal(request, admin, token, limit);
      const introMessages = await loadDueIntroMessages(request, admin, token, Math.max(0, limit - eventMessages.length));
      const messages = [...eventMessages, ...introMessages].slice(0, limit);
      return shortcutJson({ ok: true, mode: "all", active_show_count: showIds.length, queue_lookup: "all_due_scheduled_messages", count: messages.length, messages });
    }

    const { admin } = await loadAutomation(showId, token);

    if (testMode) {
      const messages = await loadDueEventMessages(request, admin, [showId], token, limit, false);
      return shortcutJson({
        ok: true,
        mode: "show",
        test: true,
        json_ready: true,
        show_id: showId,
        count: messages.length,
        messages,
        message: messages.length
          ? `Shortcut endpoint is public and ${messages.length} due message${messages.length === 1 ? " is" : "s are"} ready. Test mode does not mark them sent.`
          : "Shortcut endpoint is public and returning JSON correctly. No due messages are waiting right now."
      });
    }

    if (action === "sent" || action === "failed") {
      if (!id) return shortcutJson({ ok: false, message: "id is required." }, { status: 400 });
      const patch = action === "sent"
        ? { status: "sent", sent_at: new Date().toISOString(), error: null }
        : { status: "failed", error: "Marked failed by Apple Shortcut." };
      const { data, error } = await admin
        .from("text_message_queue")
        .update(patch)
        .eq("id", id)
        .eq("show_id", showId)
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
        .single();
      if (error) throw new Error(error.message);
      return shortcutJson({ ok: true, message: action === "sent" ? "Marked sent." : "Marked failed.", item: data });
    }

    const messages = await loadDueEventMessages(request, admin, [showId], token, limit, false);
    return shortcutJson({ ok: true, mode: "show", count: messages.length, messages });
  } catch (error) {
    return shortcutJson({ ok: false, message: error instanceof Error ? error.message : "Shortcut request failed." }, { status: 400 });
  }
}


export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const showId = safeText(body.show_id);
  const token = safeText(body.token);
  const id = safeText(body.id);
  const status = safeText(body.status) === "failed" ? "failed" : "sent";
  const errorMessage = safeText(body.error);

  if (!showId || !token || !id) {
    return shortcutJson({ ok: false, message: "show_id, token, and id are required." }, { status: 400 });
  }

  try {
    const { admin } = await loadAutomation(showId, token);
    const patch = status === "sent"
      ? { status: "sent", sent_at: new Date().toISOString(), error: null }
      : { status: "failed", error: errorMessage || "Marked failed by Apple Shortcut." };
    const { data, error } = await admin
      .from("text_message_queue")
      .update(patch)
      .eq("id", id)
      .eq("show_id", showId)
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
      .single();
    if (error) throw new Error(error.message);
    return shortcutJson({ ok: true, item: data });
  } catch (error) {
    return shortcutJson({ ok: false, message: error instanceof Error ? error.message : "Shortcut update failed." }, { status: 400 });
  }
}
