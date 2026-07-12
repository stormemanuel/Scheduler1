import { NextResponse } from "next/server";

export const runtime = "nodejs";
import { createSupabaseAdminClient, createSupabaseServerClient, syncAssignmentChecklistFromSentMessage } from "@/lib/supabase-server";

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
};

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeQueueRow(row: QueueRow) {
  return {
    id: row.id,
    show_id: row.show_id,
    crew_id: row.crew_id || null,
    crew_name: row.crew_name || "",
    phone: row.phone || "",
    message_type: row.message_type || "schedule",
    reminder_key: row.reminder_key || "manual",
    scheduled_for: row.scheduled_for,
    status: row.status || "scheduled",
    body: row.body || "",
    sent_at: row.sent_at || null,
    error: row.error || null,
    created_at: row.created_at,
    queued_by_user_id: row.queued_by_user_id || null,
    queued_by_email: row.queued_by_email || null,
    queued_by_name: row.queued_by_name || null,
  };
}

async function sendTwilioMessage(to: string, body: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in Vercel first.");
  }
  const params = new URLSearchParams({ To: to, From: fromNumber, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || "Twilio send failed.");
  return data;
}

async function sendDue(showId?: string | null) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
    return NextResponse.json({ ok: false, updated: [], message: "Twilio is not configured yet. Queue is saved, but texts will not send until Twilio environment variables are added." }, { status: 400 });
  }

  let query = admin
    .from("text_message_queue")
    .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(50);
  if (showId) query = query.eq("show_id", showId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  const rows = (data || []) as QueueRow[];
  const updated: ReturnType<typeof normalizeQueueRow>[] = [];

  for (const row of rows) {
    try {
      if (!safeText(row.phone)) throw new Error("Missing phone number.");
      if (!safeText(row.body)) throw new Error("Missing message body.");
      await sendTwilioMessage(safeText(row.phone), safeText(row.body));
      const { data: saved, error: updateError } = await admin
        .from("text_message_queue")
        .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
        .eq("id", row.id)
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
        .single();
      if (updateError) throw new Error(updateError.message);
      await syncAssignmentChecklistFromSentMessage(admin, saved as QueueRow).catch(() => null);
      updated.push(normalizeQueueRow(saved as QueueRow));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send.";
      const { data: saved } = await admin
        .from("text_message_queue")
        .update({ status: "failed", error: message })
        .eq("id", row.id)
        .select("id, show_id, crew_id, crew_name, phone, message_type, reminder_key, scheduled_for, status, body, sent_at, error, created_at, queued_by_user_id, queued_by_email, queued_by_name")
        .single();
      if (saved) updated.push(normalizeQueueRow(saved as QueueRow));
    }
  }

  return NextResponse.json({ ok: true, updated, message: rows.length ? `Processed ${rows.length} due text${rows.length === 1 ? "" : "s"}.` : "No due texts found." });
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  return sendDue(safeText(body.show_id) || null);
}

export async function GET(request: Request) {
  const secret = process.env.TEXT_AUTOMATION_CRON_SECRET;
  if (secret) {
    const incoming = new URL(request.url).searchParams.get("secret");
    if (incoming !== secret) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }
  return sendDue(null);
}
