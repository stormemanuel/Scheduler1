import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { resolvePersonalShortcutToken } from "@/lib/auth";
import { createSupabaseAdminClient, syncAssignmentChecklistFromSentMessage } from "@/lib/supabase-server";

const ACTIVE_SENDABLE_STATUSES = ["scheduled", "waiting", "queued", "due_now", "pending"];
const DIAGNOSTIC_STATUSES = [...ACTIVE_SENDABLE_STATUSES, "needs_sender_review", "sending"];
const SENDING_LEASE_MINUTES = 10;
const TEXT_QUEUE_SELECT = "id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name, delivery_mode";
const TEXT_QUEUE_SELECT_LEGACY = "id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name";
const INTRO_QUEUE_SELECT = "id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name, delivery_mode";
const INTRO_QUEUE_SELECT_LEGACY = "id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name";

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
  queued_by_user_id?: string | null;
  queued_by_email?: string | null;
  queued_by_name?: string | null;
  delivery_mode?: string | null;
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
  queued_by_user_id?: string | null;
  queued_by_email?: string | null;
  queued_by_name?: string | null;
  delivery_mode?: string | null;
};

type QueueDiagnosticRow = {
  id: string;
  show_id?: string | null;
  status?: string | null;
  scheduled_for?: string | null;
  phone?: string | null;
  body?: string | null;
  queued_by_user_id?: string | null;
  queued_by_email?: string | null;
  queued_by_name?: string | null;
  delivery_mode?: string | null;
};

type ShortcutDiagnostics = {
  checked_queue_count: number;
  scheduled_count: number;
  due_scheduled_count: number;
  ready_due_for_this_sender: number;
  future_for_this_sender: number;
  due_missing_phone_or_body_for_this_sender: number;
  due_wrong_sender: number;
  due_missing_sender: number;
  sending_for_this_sender: number;
  needs_sender_review: number;
  sender_bound: boolean;
  sender_user_id: string;
  blocked_sender_samples: Array<{ sender: string; count: number }>;
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

function cancellationNoticeTableMissing(message: string | null | undefined) {
  const text = safeText(message).toLowerCase();
  return text.includes("event_removed_crew_assignments") && (text.includes("does not exist") || text.includes("schema cache"));
}

async function syncCancellationNoticeFromSentMessage(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  row: { id?: string | null; message_type?: string | null; sent_at?: string | null } | null | undefined,
) {
  if (!row?.id || safeText(row.message_type) !== "assignment_cancellation") return;
  const { error } = await admin
    .from("event_removed_crew_assignments")
    .update({
      cancellation_notice_status: "sent",
      cancellation_notice_sent_at: row.sent_at || new Date().toISOString(),
    })
    .eq("cancellation_notice_queue_id", row.id);
  if (error && !cancellationNoticeTableMissing(error.message)) throw new Error(error.message);
}

function isMissingSenderColumns(message: string) {
  return message.includes("queued_by_user_id") || message.includes("schema cache");
}

function isMissingDeliveryModeColumns(message: string) {
  return message.includes("delivery_mode") || message.includes("schema cache");
}

function isAppleShortcutQueueRow(row: { delivery_mode?: string | null }) {
  const mode = safeText(row.delivery_mode);
  return !mode || mode === "apple_shortcut" || mode === "shortcut";
}

function isMissingClaimColumns(message: string) {
  return message.includes("claimed_at") || message.includes("claim_token") || message.includes("schema cache");
}

function isStatusConstraintError(message: string) {
  return message.includes("text_message_queue_status_check")
    || message.includes("crew_intro_text_queue_status_check")
    || (message.includes("violates check constraint") && message.includes("status"));
}

function senderFilterValue(value: string) {
  const clean = safeText(value);
  return clean || "";
}

function absoluteUrl(request: Request, pathAndQuery: string) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}${pathAndQuery}`;
}

async function tokenExists(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, token: string) {
  const { data, error } = await admin
    .from("show_text_automations")
    .select("show_id, shortcut_token")
    .eq("shortcut_token", token)
    .limit(1);
  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

async function shortcutSender(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, token: string) {
  const senderUserId = resolvePersonalShortcutToken(token);
  if (senderUserId) {
    const { data } = await admin
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", senderUserId)
      .maybeSingle();
    const profile = data as { id?: string | null; full_name?: string | null; email?: string | null } | null;
    return {
      senderUserId,
      connectedName: safeText(profile?.full_name) || safeText(profile?.email) || senderUserId,
      connectedEmail: safeText(profile?.email),
      legacy: false,
    };
  }
  if (safeText(token).startsWith("elsu_")) {
    throw new Error("Your personal Shortcut token is invalid. Generate/copy a fresh My Shortcut URL after deploying the token-parser fix.");
  }
  if (await tokenExists(admin, token)) {
    return { senderUserId: "", connectedName: "Legacy shared Shortcut token", connectedEmail: "", legacy: true };
  }
  throw new Error("Invalid Shortcut token.");
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
  const sender = await shortcutSender(admin, token);
  if (!sender.senderUserId && automation.shortcut_token !== token) throw new Error("Invalid Shortcut token.");
  return { admin, automation, sender };
}

async function loadUniversalAutomations(token: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const sender = await shortcutSender(admin, token);
  const { data, error } = await admin
    .from("show_text_automations")
    .select("show_id, enabled, sending_method, shortcut_token")
    .eq("enabled", true)
    .eq("sending_method", "shortcut");
  if (error) throw new Error(error.message);
  const automations = (data || []) as AutomationRow[];
  if (!automations.length) throw new Error("No active Apple Shortcut events are enabled.");
  return { admin, automations, sender };
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

type ShortcutOutboundMessage = ReturnType<typeof messagePayload> | ReturnType<typeof introMessagePayload>;

function shortcutEnvelope(base: Record<string, unknown>, messages: ShortcutOutboundMessage[]) {
  const first = messages[0] || null;
  return {
    ...base,
    count: messages.length,
    messages_count: messages.length,
    has_messages: messages.length > 0,
    messages,
    items: messages,
    first_message: first,
    message_id: first?.id || "",
    phone: first?.phone || "",
    body: first?.body || "",
    mark_sent_url: first?.mark_sent_url || "",
    mark_failed_url: first?.mark_failed_url || "",
    shortcut_contract: "Preferred: loop through the messages array. Backward compatible: top-level phone/body/mark_sent_url contain the first due message.",
  };
}

function queueSenderLabel(row: QueueDiagnosticRow) {
  return safeText(row.queued_by_name) || safeText(row.queued_by_email) || safeText(row.queued_by_user_id) || "Legacy / no sender";
}

function shortcutNoDueMessage(diagnostics: ShortcutDiagnostics | null) {
  if (!diagnostics) return "Shortcut endpoint is public and returning JSON correctly. No due messages are waiting right now.";
  if (diagnostics.ready_due_for_this_sender > 0) return `Shortcut endpoint is public and ${diagnostics.ready_due_for_this_sender} due message${diagnostics.ready_due_for_this_sender === 1 ? " is" : "s are"} ready.`;
  if (diagnostics.due_wrong_sender || diagnostics.due_missing_sender) {
    const parts = [];
    if (diagnostics.due_wrong_sender) parts.push(`${diagnostics.due_wrong_sender} due text${diagnostics.due_wrong_sender === 1 ? " is" : "s are"} queued under another sender`);
    if (diagnostics.due_missing_sender) parts.push(`${diagnostics.due_missing_sender} due text${diagnostics.due_missing_sender === 1 ? " has" : "s have"} no sender attached`);
    const senderHint = diagnostics.blocked_sender_samples.length
      ? ` Seen under: ${diagnostics.blocked_sender_samples.map((sample) => `${sample.sender} (${sample.count})`).join(", ")}.`
      : "";
    return `No due texts are available for this phone's personal Shortcut URL because ${parts.join(" and ")}.${senderHint} Run the matching user's Shortcut URL, or requeue/repair the messages from the correct signed-in user.`;
  }
  if (diagnostics.due_missing_phone_or_body_for_this_sender) {
    return `${diagnostics.due_missing_phone_or_body_for_this_sender} due text${diagnostics.due_missing_phone_or_body_for_this_sender === 1 ? " is" : "s are"} assigned to this Shortcut but missing a phone number or message body.`;
  }
  if (diagnostics.sending_for_this_sender) {
    return `${diagnostics.sending_for_this_sender} text${diagnostics.sending_for_this_sender === 1 ? " was" : "s were"} already claimed by this Shortcut and are waiting for a sent/failed callback. If the iPhone did not send them, use Review Waiting Messages to return stuck rows to the active queue.`;
  }
  if (diagnostics.needs_sender_review) {
    return `${diagnostics.needs_sender_review} queued text${diagnostics.needs_sender_review === 1 ? " needs" : "s need"} sender review before any Shortcut can send them.`;
  }
  if (diagnostics.future_for_this_sender) {
    return `${diagnostics.future_for_this_sender} text${diagnostics.future_for_this_sender === 1 ? " is" : "s are"} queued for this Shortcut, but scheduled for later. The iPhone Shortcut will send them after their due time.`;
  }
  if (diagnostics.scheduled_count) {
    return `${diagnostics.scheduled_count} active queued text${diagnostics.scheduled_count === 1 ? " exists" : "s exist"}, but none are due for this signed-in user's Shortcut URL yet.`;
  }
  return "Shortcut endpoint is public and returning JSON correctly. No active queue rows are waiting for active Shortcut events.";
}

async function loadEventQueueDiagnostics(admin: ReturnType<typeof createSupabaseAdminClient>, showIds: string[], senderUserId: string) {
  if (!admin) return null;
  await recoverStaleSendingRows(admin, showIds, senderUserId);
  let query = admin
    .from("text_message_queue")
    .select("id, show_id, status, scheduled_for, phone, body, queued_by_user_id, queued_by_email, queued_by_name, delivery_mode")
    .in("status", DIAGNOSTIC_STATUSES)
    .order("scheduled_for", { ascending: true })
    .limit(1000);
  if (showIds.length) query = query.in("show_id", showIds);
  let { data, error } = await query as { data: unknown[] | null; error: { message: string } | null };
  if (error && isMissingDeliveryModeColumns(error.message)) {
    let legacyQuery = admin
      .from("text_message_queue")
      .select("id, show_id, status, scheduled_for, phone, body, queued_by_user_id, queued_by_email, queued_by_name")
      .in("status", DIAGNOSTIC_STATUSES)
      .order("scheduled_for", { ascending: true })
      .limit(1000);
    if (showIds.length) legacyQuery = legacyQuery.in("show_id", showIds);
    const legacy = await legacyQuery as { data: unknown[] | null; error: { message: string } | null };
    data = legacy.data;
    error = legacy.error;
  }
  if (error) {
    if (senderUserId && isMissingSenderColumns(error.message)) {
      return {
        checked_queue_count: 0,
        scheduled_count: 0,
        due_scheduled_count: 0,
        ready_due_for_this_sender: 0,
        future_for_this_sender: 0,
        due_missing_phone_or_body_for_this_sender: 0,
        due_wrong_sender: 0,
        due_missing_sender: 0,
        sending_for_this_sender: 0,
        needs_sender_review: 0,
        sender_bound: Boolean(senderUserId),
        sender_user_id: senderUserId,
        blocked_sender_samples: [],
      } satisfies ShortcutDiagnostics;
    }
    return null;
  }

  const rows = ((data || []) as QueueDiagnosticRow[]).filter(isAppleShortcutQueueRow);
  const activeRows = rows.filter((row) => ACTIVE_SENDABLE_STATUSES.includes(safeText(row.status)));
  const sendingRows = rows.filter((row) => safeText(row.status) === "sending");
  const needsReviewRows = rows.filter((row) => safeText(row.status) === "needs_sender_review");
  const nowMs = Date.now();
  const dueRows = activeRows.filter((row) => Date.parse(safeText(row.scheduled_for)) <= nowMs);
  const senderMatches = (row: QueueDiagnosticRow) => !senderUserId || safeText(row.queued_by_user_id) === senderUserId;
  const hasPhoneAndBody = (row: QueueDiagnosticRow) => Boolean(safeText(row.phone) && safeText(row.body));
  const wrongSenderDueRows = senderUserId
    ? dueRows.filter((row) => {
        const queuedBy = safeText(row.queued_by_user_id);
        return queuedBy && queuedBy !== senderUserId;
      })
    : [];
  const missingSenderDueRows = senderUserId ? dueRows.filter((row) => !safeText(row.queued_by_user_id)) : [];
  const blockedSenderCounts = new Map<string, number>();
  [...wrongSenderDueRows, ...missingSenderDueRows].forEach((row) => {
    const label = queueSenderLabel(row);
    blockedSenderCounts.set(label, (blockedSenderCounts.get(label) || 0) + 1);
  });

  return {
    checked_queue_count: rows.length,
    scheduled_count: activeRows.length,
    due_scheduled_count: dueRows.length,
    ready_due_for_this_sender: dueRows.filter((row) => senderMatches(row) && hasPhoneAndBody(row)).length,
    future_for_this_sender: activeRows.filter((row) => Date.parse(safeText(row.scheduled_for)) > nowMs && senderMatches(row)).length,
    due_missing_phone_or_body_for_this_sender: dueRows.filter((row) => senderMatches(row) && !hasPhoneAndBody(row)).length,
    due_wrong_sender: wrongSenderDueRows.length,
    due_missing_sender: missingSenderDueRows.length,
    sending_for_this_sender: sendingRows.filter(senderMatches).length,
    needs_sender_review: needsReviewRows.length,
    sender_bound: Boolean(senderUserId),
    sender_user_id: senderUserId,
    blocked_sender_samples: Array.from(blockedSenderCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4)
      .map(([sender, count]) => ({ sender, count })),
  } satisfies ShortcutDiagnostics;
}

async function recoverStaleSendingRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showIds: string[], senderUserId = "") {
  const cutoff = new Date(Date.now() - SENDING_LEASE_MINUTES * 60 * 1000).toISOString();
  let query = admin
    .from("text_message_queue")
    .update({ status: "scheduled", error: "Returned to queue after stale Shortcut claim.", claimed_at: null, claim_token: null })
    .eq("status", "sending")
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`);
  if (showIds.length) query = query.in("show_id", showIds);
  if (senderUserId) query = query.eq("queued_by_user_id", senderUserId);
  const { error } = await query.select("id").limit(1);
  if (error && !isMissingClaimColumns(error.message)) throw new Error(error.message);
}

async function recoverStaleIntroSendingRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, senderUserId = "") {
  const cutoff = new Date(Date.now() - SENDING_LEASE_MINUTES * 60 * 1000).toISOString();
  let query = admin
    .from("crew_intro_text_queue")
    .update({ status: "scheduled", error: "Returned to queue after stale Shortcut claim.", claimed_at: null, claim_token: null })
    .eq("status", "sending")
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`);
  if (senderUserId) query = query.eq("queued_by_user_id", senderUserId);
  const { error } = await query.select("id").limit(1);
  if (error && !isMissingClaimColumns(error.message) && !error.message.includes('relation "crew_intro_text_queue" does not exist')) throw new Error(error.message);
}

async function claimEventQueueRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, rows: QueueRow[], senderUserId: string) {
  const ids = rows.map((row) => safeText(row.id)).filter(Boolean);
  if (!ids.length) return [] as QueueRow[];
  const claimToken = randomUUID();
  let query = admin
    .from("text_message_queue")
    .update({ status: "sending", error: null, claimed_at: new Date().toISOString(), claim_token: claimToken })
    .in("id", ids)
    .in("status", ACTIVE_SENDABLE_STATUSES);
  if (senderUserId) query = query.eq("queued_by_user_id", senderUserId);
  const { data, error } = await query
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
  if (error) {
    if (isStatusConstraintError(error.message)) {
      let fallbackClaimQuery = admin
        .from("text_message_queue")
        .update({ error: "Pulled by Apple Shortcut. Database does not allow temporary sending status yet.", claimed_at: new Date().toISOString(), claim_token: claimToken })
        .in("id", ids)
        .in("status", ACTIVE_SENDABLE_STATUSES);
      if (senderUserId) fallbackClaimQuery = fallbackClaimQuery.eq("queued_by_user_id", senderUserId);
      const fallbackClaim = await fallbackClaimQuery
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
      if (!fallbackClaim.error) return (fallbackClaim.data || []) as QueueRow[];
      if (!isMissingClaimColumns(fallbackClaim.error.message)) throw new Error(fallbackClaim.error.message);
      return rows;
    }
    if (!isMissingClaimColumns(error.message)) throw new Error(error.message);
    let fallbackQuery = admin
      .from("text_message_queue")
      .update({ status: "sending", error: null })
      .in("id", ids)
      .in("status", ACTIVE_SENDABLE_STATUSES);
    if (senderUserId) fallbackQuery = fallbackQuery.eq("queued_by_user_id", senderUserId);
    const fallback = await fallbackQuery
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
    if (fallback.error) throw new Error(fallback.error.message);
    return (fallback.data || []) as QueueRow[];
  }
  return (data || []) as QueueRow[];
}

async function claimIntroQueueRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, rows: IntroQueueRow[], senderUserId: string) {
  const ids = rows.map((row) => safeText(row.id)).filter(Boolean);
  if (!ids.length) return [] as IntroQueueRow[];
  const claimToken = randomUUID();
  let query = admin
    .from("crew_intro_text_queue")
    .update({ status: "sending", error: null, claimed_at: new Date().toISOString(), claim_token: claimToken })
    .in("id", ids)
    .in("status", ACTIVE_SENDABLE_STATUSES);
  if (senderUserId) query = query.eq("queued_by_user_id", senderUserId);
  const { data, error } = await query
    .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
  if (error) {
    if (isStatusConstraintError(error.message)) {
      let fallbackClaimQuery = admin
        .from("crew_intro_text_queue")
        .update({ error: "Pulled by Apple Shortcut. Database does not allow temporary sending status yet.", claimed_at: new Date().toISOString(), claim_token: claimToken })
        .in("id", ids)
        .in("status", ACTIVE_SENDABLE_STATUSES);
      if (senderUserId) fallbackClaimQuery = fallbackClaimQuery.eq("queued_by_user_id", senderUserId);
      const fallbackClaim = await fallbackClaimQuery
        .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
      if (!fallbackClaim.error) return (fallbackClaim.data || []) as IntroQueueRow[];
      if (!isMissingClaimColumns(fallbackClaim.error.message) && !fallbackClaim.error.message.includes('relation "crew_intro_text_queue" does not exist')) throw new Error(fallbackClaim.error.message);
      return rows;
    }
    if (!isMissingClaimColumns(error.message)) throw new Error(error.message);
    let fallbackQuery = admin
      .from("crew_intro_text_queue")
      .update({ status: "sending", error: null })
      .in("id", ids)
      .in("status", ACTIVE_SENDABLE_STATUSES);
    if (senderUserId) fallbackQuery = fallbackQuery.eq("queued_by_user_id", senderUserId);
    const fallback = await fallbackQuery
      .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name");
    if (fallback.error) throw new Error(fallback.error.message);
    return (fallback.data || []) as IntroQueueRow[];
  }
  return (data || []) as IntroQueueRow[];
}

async function loadDueEventMessages(request: Request, admin: ReturnType<typeof createSupabaseAdminClient>, showIds: string[], token: string, limit: number, universal = true, senderUserId = "", claim = false) {
  if (!admin || !showIds.length) return [];
  await recoverStaleSendingRows(admin, showIds, senderUserId);
  let query = admin
    .from("text_message_queue")
    .select(TEXT_QUEUE_SELECT)
    .in("show_id", showIds)
    .in("status", ACTIVE_SENDABLE_STATUSES)
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (senderUserId) query = query.eq("queued_by_user_id", senderUserId);
  let { data, error } = await query as { data: unknown[] | null; error: { message: string } | null };
  if (error && isMissingDeliveryModeColumns(error.message)) {
    let legacyQuery = admin
      .from("text_message_queue")
      .select(TEXT_QUEUE_SELECT_LEGACY)
      .in("show_id", showIds)
      .in("status", ACTIVE_SENDABLE_STATUSES)
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    if (senderUserId) legacyQuery = legacyQuery.eq("queued_by_user_id", senderUserId);
    const legacy = await legacyQuery as { data: unknown[] | null; error: { message: string } | null };
    data = legacy.data;
    error = legacy.error;
  }
  if (error) {
    if (senderUserId && isMissingSenderColumns(error.message)) throw new Error("Sender-bound queue columns are missing. Run supabase/ELS127_required_migrations.sql, then retry this Shortcut URL.");
    throw new Error(error.message);
  }
  const readyRows = ((data || []) as QueueRow[]).filter((row) => isAppleShortcutQueueRow(row) && safeText(row.phone) && safeText(row.body));
  const rowsToReturn = claim ? await claimEventQueueRows(admin, readyRows, senderUserId) : readyRows;
  return rowsToReturn
    .map((row) => messagePayload(request, row, row.show_id, token, universal));
}

async function loadDueEventMessagesGlobal(request: Request, admin: ReturnType<typeof createSupabaseAdminClient>, showIds: string[], token: string, limit: number, senderUserId = "", claim = false) {
  if (!admin || limit <= 0) return [];
  await recoverStaleSendingRows(admin, showIds, senderUserId);
  let query = admin
    .from("text_message_queue")
    .select(TEXT_QUEUE_SELECT)
    .in("status", ACTIVE_SENDABLE_STATUSES)
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (showIds.length) query = query.in("show_id", showIds);
  if (senderUserId) query = query.eq("queued_by_user_id", senderUserId);
  let { data, error } = await query as { data: unknown[] | null; error: { message: string } | null };
  if (error && isMissingDeliveryModeColumns(error.message)) {
    let legacyQuery = admin
      .from("text_message_queue")
      .select(TEXT_QUEUE_SELECT_LEGACY)
      .in("status", ACTIVE_SENDABLE_STATUSES)
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    if (showIds.length) legacyQuery = legacyQuery.in("show_id", showIds);
    if (senderUserId) legacyQuery = legacyQuery.eq("queued_by_user_id", senderUserId);
    const legacy = await legacyQuery as { data: unknown[] | null; error: { message: string } | null };
    data = legacy.data;
    error = legacy.error;
  }
  if (error) {
    if (senderUserId && isMissingSenderColumns(error.message)) throw new Error("Sender-bound queue columns are missing. Run supabase/ELS127_required_migrations.sql, then retry this Shortcut URL.");
    throw new Error(error.message);
  }
  const readyRows = ((data || []) as QueueRow[]).filter((row) => isAppleShortcutQueueRow(row) && safeText(row.phone) && safeText(row.body));
  const rowsToReturn = claim ? await claimEventQueueRows(admin, readyRows, senderUserId) : readyRows;
  return rowsToReturn
    .map((row) => messagePayload(request, row, row.show_id, token, true));
}

async function loadDueIntroMessages(request: Request, admin: ReturnType<typeof createSupabaseAdminClient>, token: string, limit: number, senderUserId = "", claim = false) {
  if (!admin || limit <= 0) return [];
  await recoverStaleIntroSendingRows(admin, senderUserId);
  let query = admin
    .from("crew_intro_text_queue")
    .select(INTRO_QUEUE_SELECT)
    .in("status", ACTIVE_SENDABLE_STATUSES)
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (senderUserId) query = query.eq("queued_by_user_id", senderUserId);
  let introRes = await query as { data: unknown[] | null; error: { message: string } | null };
  if (introRes.error && isMissingDeliveryModeColumns(introRes.error.message)) {
    let legacyQuery = admin
      .from("crew_intro_text_queue")
      .select(INTRO_QUEUE_SELECT_LEGACY)
      .in("status", ACTIVE_SENDABLE_STATUSES)
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(limit);
    if (senderUserId) legacyQuery = legacyQuery.eq("queued_by_user_id", senderUserId);
    introRes = await legacyQuery as { data: unknown[] | null; error: { message: string } | null };
  }
  if (introRes.error && !introRes.error.message.includes('relation "crew_intro_text_queue" does not exist')) {
    if (senderUserId && isMissingSenderColumns(introRes.error.message)) throw new Error("Sender-bound intro queue columns are missing. Run supabase/ELS127_required_migrations.sql, then retry this Shortcut URL.");
    throw new Error(introRes.error.message);
  }
  const readyRows = ((introRes.data || []) as IntroQueueRow[]).filter((row) => isAppleShortcutQueueRow(row) && safeText(row.phone) && safeText(row.body));
  const rowsToReturn = claim ? await claimIntroQueueRows(admin, readyRows, senderUserId) : readyRows;
  return rowsToReturn
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
  const ignoredSenderQuery = senderFilterValue(params.get("sender_user_id") || params.get("queued_by_user_id") || "");
  const limit = Math.min(Math.max(Number(params.get("limit") || 125), 1), 125);

  if (!token) {
    return shortcutJson({ ok: false, message: "token is required." }, { status: 400 });
  }
  if (!allActive && !showId) {
    return shortcutJson({ ok: false, message: "show_id is required unless all=1 is used." }, { status: 400 });
  }

  try {
    if (allActive) {
      const { admin, automations, sender } = await loadUniversalAutomations(token);
      const senderUserId = sender.senderUserId;
      const showIds = automations.map((row) => row.show_id).filter(Boolean);

      if (testMode) {
        if (sender.legacy) {
          return shortcutJson({
            ok: false,
            mode: "all",
            test: true,
            json_ready: true,
            active_show_count: showIds.length,
            connected_user: sender.connectedName,
            ignored_sender_query: Boolean(ignoredSenderQuery),
            count: 0,
            messages: [],
            message: "This is a legacy shared Shortcut token. Save Apple Shortcut Mode while signed in as this user to generate a personal My Shortcut URL before pulling due texts.",
          }, { status: 400 });
        }
        const eventMessages = await loadDueEventMessagesGlobal(request, admin, showIds, token, limit, senderUserId);
        const introMessages = await loadDueIntroMessages(request, admin, token, Math.max(0, limit - eventMessages.length), senderUserId);
        const messages = [...eventMessages, ...introMessages].slice(0, limit);
        const diagnostics = await loadEventQueueDiagnostics(admin, showIds, senderUserId);
        return shortcutJson(shortcutEnvelope({
          ok: true,
          mode: "all",
          test: true,
          json_ready: true,
          active_show_count: showIds.length,
          connected_user: sender.connectedName,
          connected_user_id: sender.senderUserId,
          ignored_sender_query: Boolean(ignoredSenderQuery),
          queue_lookup: senderUserId ? "sender_bound_due_active_messages" : "all_due_active_messages",
          diagnostics,
          message: messages.length
            ? `Shortcut endpoint is public and ${messages.length} due message${messages.length === 1 ? " is" : "s are"} ready. Test mode does not mark them sent.`
            : shortcutNoDueMessage(diagnostics)
        }, messages));
      }

      if (action === "sent" || action === "failed") {
        if (sender.legacy || !senderUserId) {
          return shortcutJson({ ok: false, message: "Use a personal My Shortcut URL before marking messages sent or failed." }, { status: 400 });
        }
        if (!id) return shortcutJson({ ok: false, message: "id is required." }, { status: 400 });
        const patch = action === "sent"
          ? { status: "sent", sent_at: new Date().toISOString(), error: null }
          : { status: "failed", error: "Marked failed by Apple Shortcut." };
        if (source === "intro") {
          let markIntroQuery = admin
            .from("crew_intro_text_queue")
            .update(patch)
            .eq("id", id);
          if (senderUserId) markIntroQuery = markIntroQuery.eq("queued_by_user_id", senderUserId);
          const { data, error } = await markIntroQuery
            .select("id, crew_id, crew_name, phone, body, status, scheduled_for, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
            .single();
          if (error) throw new Error(error.message);
          return shortcutJson({ ok: true, message: action === "sent" ? "Intro marked sent." : "Intro marked failed.", item: data });
        }
        let markQuery = admin
          .from("text_message_queue")
          .update(patch)
          .eq("id", id);
        if (senderUserId) markQuery = markQuery.eq("queued_by_user_id", senderUserId);
        const { data, error } = await markQuery
          .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
          .single();
        if (error) throw new Error(error.message);
        if (action === "sent") {
          await syncAssignmentChecklistFromSentMessage(admin, data).catch(() => null);
          await syncCancellationNoticeFromSentMessage(admin, data).catch(() => null);
        }
        return shortcutJson({ ok: true, message: action === "sent" ? "Marked sent and checklist updated." : "Marked failed.", item: data });
      }

      if (sender.legacy) {
        return shortcutJson({
          ok: false,
          mode: "all",
          active_show_count: showIds.length,
          count: 0,
          messages: [],
          message: "This shared legacy Shortcut URL is blocked from pulling due texts. Save Apple Shortcut Mode to generate this phone user's personal My Shortcut URL.",
        }, { status: 400 });
      }
      const eventMessages = await loadDueEventMessagesGlobal(request, admin, showIds, token, limit, senderUserId, true);
      const introMessages = await loadDueIntroMessages(request, admin, token, Math.max(0, limit - eventMessages.length), senderUserId, true);
      const messages = [...eventMessages, ...introMessages].slice(0, limit);
      const diagnostics = messages.length ? null : await loadEventQueueDiagnostics(admin, showIds, senderUserId);
      return shortcutJson(shortcutEnvelope({
        ok: true,
        mode: "all",
        active_show_count: showIds.length,
        connected_user: sender.connectedName,
        connected_user_id: sender.senderUserId,
        queue_lookup: senderUserId ? "sender_bound_due_active_messages" : "all_due_active_messages",
        diagnostics,
        message: messages.length
          ? `Pulled and claimed ${messages.length} due text${messages.length === 1 ? "" : "s"} for this Shortcut run.`
          : shortcutNoDueMessage(diagnostics),
      }, messages));
    }

    const { admin, sender } = await loadAutomation(showId, token);
    const senderUserId = sender.senderUserId;

    if (testMode) {
      if (sender.legacy) {
        return shortcutJson({
          ok: false,
          mode: "show",
          test: true,
          json_ready: true,
          show_id: showId,
          connected_user: sender.connectedName,
          ignored_sender_query: Boolean(ignoredSenderQuery),
          count: 0,
          messages: [],
          message: "This is a legacy shared Shortcut token. Save Apple Shortcut Mode while signed in as this user to generate a personal My Shortcut URL.",
        }, { status: 400 });
      }
      const messages = await loadDueEventMessages(request, admin, [showId], token, limit, false, senderUserId);
      const diagnostics = await loadEventQueueDiagnostics(admin, [showId], senderUserId);
      return shortcutJson(shortcutEnvelope({
        ok: true,
        mode: "show",
        test: true,
        json_ready: true,
        show_id: showId,
        connected_user: sender.connectedName,
        connected_user_id: sender.senderUserId,
        ignored_sender_query: Boolean(ignoredSenderQuery),
        diagnostics,
        message: messages.length
          ? `Shortcut endpoint is public and ${messages.length} due message${messages.length === 1 ? " is" : "s are"} ready. Test mode does not mark them sent.`
          : shortcutNoDueMessage(diagnostics)
      }, messages));
    }

    if (action === "sent" || action === "failed") {
      if (sender.legacy || !senderUserId) {
        return shortcutJson({ ok: false, message: "Use a personal My Shortcut URL before marking messages sent or failed." }, { status: 400 });
      }
      if (!id) return shortcutJson({ ok: false, message: "id is required." }, { status: 400 });
      const patch = action === "sent"
        ? { status: "sent", sent_at: new Date().toISOString(), error: null }
        : { status: "failed", error: "Marked failed by Apple Shortcut." };
      let markQuery = admin
        .from("text_message_queue")
        .update(patch)
        .eq("id", id)
        .eq("show_id", showId);
      if (senderUserId) markQuery = markQuery.eq("queued_by_user_id", senderUserId);
      const { data, error } = await markQuery
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
        .single();
      if (error) throw new Error(error.message);
      if (action === "sent") {
        await syncAssignmentChecklistFromSentMessage(admin, data).catch(() => null);
        await syncCancellationNoticeFromSentMessage(admin, data).catch(() => null);
      }
      return shortcutJson({ ok: true, message: action === "sent" ? "Marked sent and checklist updated." : "Marked failed.", item: data });
    }

    if (sender.legacy) {
      return shortcutJson({
        ok: false,
        mode: "show",
        show_id: showId,
        count: 0,
        messages: [],
        message: "This shared legacy Shortcut URL is blocked from pulling due texts. Save Apple Shortcut Mode to generate this phone user's personal My Shortcut URL.",
      }, { status: 400 });
    }
    const messages = await loadDueEventMessages(request, admin, [showId], token, limit, false, senderUserId, true);
    const diagnostics = messages.length ? null : await loadEventQueueDiagnostics(admin, [showId], senderUserId);
    return shortcutJson(shortcutEnvelope({
      ok: true,
      mode: "show",
      show_id: showId,
      connected_user: sender.connectedName,
      connected_user_id: sender.senderUserId,
      diagnostics,
      message: messages.length
        ? `Pulled and claimed ${messages.length} due text${messages.length === 1 ? "" : "s"} for this Shortcut run.`
        : shortcutNoDueMessage(diagnostics),
    }, messages));
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
    const { admin, sender } = await loadAutomation(showId, token);
    if (sender.legacy || !sender.senderUserId) {
      return shortcutJson({ ok: false, message: "Use a personal My Shortcut URL before marking messages sent or failed." }, { status: 400 });
    }
    const patch = status === "sent"
      ? { status: "sent", sent_at: new Date().toISOString(), error: null }
      : { status: "failed", error: errorMessage || "Marked failed by Apple Shortcut." };
    const { data, error } = await admin
      .from("text_message_queue")
      .update(patch)
      .eq("id", id)
      .eq("show_id", showId)
      .eq("queued_by_user_id", sender.senderUserId)
      .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
      .single();
    if (error) throw new Error(error.message);
    if (status === "sent") {
      await syncAssignmentChecklistFromSentMessage(admin, data).catch(() => null);
      await syncCancellationNoticeFromSentMessage(admin, data).catch(() => null);
    }
    return shortcutJson({ ok: true, item: data });
  } catch (error) {
    return shortcutJson({ ok: false, message: error instanceof Error ? error.message : "Shortcut update failed." }, { status: 400 });
  }
}
