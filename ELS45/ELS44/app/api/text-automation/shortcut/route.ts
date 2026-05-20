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

function messagePayload(request: Request, row: QueueRow, showId: string, token: string) {
  const markSent = `/api/text-automation/shortcut?show_id=${encodeURIComponent(showId)}&token=${encodeURIComponent(token)}&action=sent&id=${encodeURIComponent(row.id)}`;
  const markFailed = `/api/text-automation/shortcut?show_id=${encodeURIComponent(showId)}&token=${encodeURIComponent(token)}&action=failed&id=${encodeURIComponent(row.id)}`;
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

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const showId = safeText(params.get("show_id"));
  const token = safeText(params.get("token"));
  const action = safeText(params.get("action"));
  const id = safeText(params.get("id"));
  const limit = Math.min(Math.max(Number(params.get("limit") || 5), 1), 25);

  if (!showId || !token) {
    return NextResponse.json({ ok: false, message: "show_id and token are required." }, { status: 400 });
  }

  try {
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

    return NextResponse.json({ ok: true, count: messages.length, messages });
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
