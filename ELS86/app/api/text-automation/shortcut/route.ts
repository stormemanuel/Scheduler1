import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
    .eq("sending_method", "shortcut");
  if (error) throw new Error(error.message);
  const automations = ((data || []) as AutomationRow[]).filter((row) => row.shortcut_token);
  const tokenIsValid = automations.some((row) => row.shortcut_token === token);
  if (!tokenIsValid) throw new Error("Invalid universal Shortcut token.");
  if (!automations.length) throw new Error("No active Apple Shortcut automations were found.");
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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const showId = safeText(params.get("show_id"));
  const token = safeText(params.get("token"));
  const action = safeText(params.get("action"));
  const id = safeText(params.get("id"));
  const source = safeText(params.get("source"));
  const allActive = safeText(params.get("all")) === "1" || safeText(params.get("mode")) === "all";
  const limit = Math.min(Math.max(Number(params.get("limit") || 5), 1), 25);

  if (!token) {
    return NextResponse.json({ ok: false, message: "token is required." }, { status: 400 });
  }
  if (!allActive && !showId) {
    return NextResponse.json({ ok: false, message: "show_id is required unless all=1 is used." }, { status: 400 });
  }

  try {
    if (allActive) {
      const { admin, automations } = await loadUniversalAutomations(token);
      const showIds = automations.map((row) => row.show_id).filter(Boolean);

      if (action === "sent" || action === "failed") {
        if (!id) return NextResponse.json({ ok: false, message: "id is required." }, { status: 400 });
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
          return NextResponse.json({ ok: true, message: action === "sent" ? "Intro marked sent." : "Intro marked failed.", item: data });
        }
        const { data, error } = await admin
          .from("text_message_queue")
          .update(patch)
          .eq("id", id)
          .in("show_id", showIds)
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, message: action === "sent" ? "Marked sent." : "Marked failed.", item: data });
      }

      const { data, error } = await admin
        .from("text_message_queue")
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
        .in("show_id", showIds)
        .eq("status", "scheduled")
        .lte("scheduled_for", new Date().toISOString())
        .order("scheduled_for", { ascending: true })
        .limit(limit);

      if (error) throw new Error(error.message);
      const eventMessages = ((data || []) as QueueRow[])
        .filter((row) => safeText(row.phone) && safeText(row.body))
        .map((row) => messagePayload(request, row, row.show_id, token, true));

      let introMessages: ReturnType<typeof introMessagePayload>[] = [];
      const remainingLimit = Math.max(0, limit - eventMessages.length);
      if (remainingLimit > 0) {
        const introRes = await admin
          .from("crew_intro_text_queue")
          .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at")
          .eq("status", "scheduled")
          .lte("scheduled_for", new Date().toISOString())
          .order("scheduled_for", { ascending: true })
          .limit(remainingLimit);
        if (introRes.error && !introRes.error.message.includes('relation "crew_intro_text_queue" does not exist')) throw new Error(introRes.error.message);
        introMessages = ((introRes.data || []) as IntroQueueRow[])
          .filter((row) => safeText(row.phone) && safeText(row.body))
          .map((row) => introMessagePayload(request, row, token));
      }

      const messages = [...eventMessages, ...introMessages].slice(0, limit);
      return NextResponse.json({ ok: true, mode: "all", active_show_count: showIds.length, count: messages.length, messages });
    }

    const { admin } = await loadAutomation(showId, token);

    if (action === "sent" || action === "failed") {
      if (!id) return NextResponse.json({ ok: false, message: "id is required." }, { status: 400 });
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
      return NextResponse.json({ ok: true, message: action === "sent" ? "Marked sent." : "Marked failed.", item: data });
    }

    const { data, error } = await admin
      .from("text_message_queue")
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at")
      .eq("show_id", showId)
      .eq("status", "scheduled")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(limit);

    if (error) throw new Error(error.message);
    const messages = ((data || []) as QueueRow[])
      .filter((row) => safeText(row.phone) && safeText(row.body))
      .map((row) => messagePayload(request, row, showId, token));

    return NextResponse.json({ ok: true, mode: "show", count: messages.length, messages });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Shortcut request failed." }, { status: 400 });
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
    return NextResponse.json({ ok: false, message: "show_id, token, and id are required." }, { status: 400 });
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
    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Shortcut update failed." }, { status: 400 });
  }
}
