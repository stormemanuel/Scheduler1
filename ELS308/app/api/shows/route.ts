import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

async function canEditEventDetails(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = String((profile as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  if (role === "owner" || role === "admin") return true;

  const { data: access, error } = await admin
    .from("user_access_settings")
    .select("can_edit_event_details")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return Boolean((access as { can_edit_event_details?: boolean | null } | null)?.can_edit_event_details);
}

const optionalShowColumns = [
  "business_client_id",
  "client_contact_id",
  "coordinator_contact_id",
  "assigned_coordinator_user_id",
  "event_location",
  "created_by",
] as const;

type OptionalShowColumn = (typeof optionalShowColumns)[number];

type ShowInsertPayload = {
  name: string;
  client: string | null;
  business_client_id?: string | null;
  client_contact_id?: string | null;
  coordinator_contact_id?: string | null;
  assigned_coordinator_user_id?: string | null;
  venue: string | null;
  event_location?: string | null;
  rate_city: string;
  show_start: string;
  show_end: string;
  notes: string | null;
};

function missingShowColumnFromMessage(message: string): OptionalShowColumn | null {
  return optionalShowColumns.find((column) => message.includes(column)) ?? null;
}

function coordinatorNotificationsMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("coordinator_event_notifications") && (text.includes("does not exist") || text.includes("schema cache"));
}

async function createCoordinatorEventNotification(admin: ReturnType<typeof createSupabaseAdminClient>, payload: ShowInsertPayload, showId: string, createdByUserId: string) {
  const coordinatorUserId = String(payload.assigned_coordinator_user_id || "").trim();
  if (!admin || !coordinatorUserId || coordinatorUserId === createdByUserId) return;
  const title = `New event assigned: ${payload.name || "Untitled event"}`;
  const details = [
    `Event: ${payload.name || "Untitled event"}`,
    payload.client ? `Client: ${payload.client}` : "",
    payload.venue ? `Venue: ${payload.venue}` : "",
    payload.event_location ? `Location: ${payload.event_location}` : "",
    `Dates: ${payload.show_start || "TBD"} to ${payload.show_end || payload.show_start || "TBD"}`,
    "Please review the event in ELS and reply here if anything needs attention.",
  ].filter(Boolean).join("\n");
  const { error } = await admin.from("coordinator_event_notifications").insert({
    user_id: coordinatorUserId,
    show_id: showId,
    notification_type: "event_assigned",
    title,
    body: details,
    created_by: createdByUserId,
  });
  if (error && !coordinatorNotificationsMissing(error.message)) throw new Error(error.message);
}

async function insertShowWithSchemaFallback(admin: ReturnType<typeof createSupabaseAdminClient>, payload: ShowInsertPayload, userId: string) {
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  let workingPayload: Record<string, unknown> = { ...payload };
  let includeCreatedBy = true;

  for (let attempt = 0; attempt < optionalShowColumns.length + 1; attempt += 1) {
    const insertPayload = includeCreatedBy ? { ...workingPayload, created_by: userId } : workingPayload;
    const result = await admin.from("shows").insert(insertPayload).select("id").single();
    if (!result.error) return result;

    const missingColumn = missingShowColumnFromMessage(result.error.message);
    if (!missingColumn) return result;

    if (missingColumn === "created_by") {
      includeCreatedBy = false;
    } else {
      delete workingPayload[missingColumn];
    }
  }

  return admin.from("shows").insert(workingPayload).select("id").single();
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can create events." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const payload: ShowInsertPayload = {
    name: String(body.name || "").trim(),
    client: String(body.client || "").trim() || null,
    business_client_id: String(body.business_client_id || "").trim() || null,
    client_contact_id: String(body.client_contact_id || "").trim() || null,
    coordinator_contact_id: String(body.coordinator_contact_id || "").trim() || null,
    assigned_coordinator_user_id: String(body.assigned_coordinator_user_id || "").trim() || null,
    venue: String(body.venue || "").trim() || null,
    event_location: String(body.event_location || "").trim() || null,
    rate_city: String(body.rate_city || "Default").trim() || "Default",
    show_start: String(body.show_start || "").trim(),
    show_end: String(body.show_end || "").trim(),
    notes: String(body.notes || "").trim() || null,
  };
  if (!payload.name || !payload.show_start || !payload.show_end) return NextResponse.json({ message: "Show name, start, and end are required." }, { status: 400 });

  const { data, error } = await insertShowWithSchemaFallback(admin, payload, auth.user.id);

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ message: "Show save did not return an id." }, { status: 500 });
  await createCoordinatorEventNotification(admin, payload, (data as { id: string }).id, auth.user.id);
  return NextResponse.json({ ok: true, id: (data as { id: string }).id, message: "Show saved." });
}
