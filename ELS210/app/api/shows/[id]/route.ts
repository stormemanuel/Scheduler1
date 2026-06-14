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

async function canDeleteEventDetails(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const role = String((data as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  return role === "owner" || role === "admin";
}

const optionalShowColumns = [
  "business_client_id",
  "client_contact_id",
  "coordinator_contact_id",
  "assigned_coordinator_user_id",
  "event_location",
] as const;

type OptionalShowColumn = (typeof optionalShowColumns)[number];

type ShowUpdatePayload = {
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

async function updateShowWithSchemaFallback(admin: ReturnType<typeof createSupabaseAdminClient>, showId: string, payload: ShowUpdatePayload) {
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const workingPayload: Record<string, unknown> = { ...payload };

  for (let attempt = 0; attempt < optionalShowColumns.length + 1; attempt += 1) {
    const result = await admin.from("shows").update(workingPayload).eq("id", showId);
    if (!result.error) return result;

    const missingColumn = missingShowColumnFromMessage(result.error.message);
    if (!missingColumn) return result;
    delete workingPayload[missingColumn];
  }

  return admin.from("shows").update(workingPayload).eq("id", showId);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can edit event details." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const body = await request.json();
  const payload: ShowUpdatePayload = {
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
  const { error } = await updateShowWithSchemaFallback(admin, id, payload);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  // Keep previously saved show ratings tied to the current saved business client
  // and project manager/contact. If older schemas are missing those columns, do not block saving the event.
  const ratingsUpdate: Record<string, unknown> = {
    client_id: payload.business_client_id ?? null,
    client_contact_id: payload.client_contact_id ?? null,
    updated_at: new Date().toISOString(),
  };
  let ratingsError = (await admin.from("tech_ratings").update(ratingsUpdate).eq("show_id", id)).error;
  if (ratingsError && ratingsError.message.includes("client_contact_id")) {
    delete ratingsUpdate.client_contact_id;
    ratingsError = (await admin.from("tech_ratings").update(ratingsUpdate).eq("show_id", id)).error;
  }
  if (ratingsError && !ratingsError.message.includes("client_id")) return NextResponse.json({ message: ratingsError.message }, { status: 400 });

  return NextResponse.json({ ok: true, message: "Show updated. Ratings are synced to the selected client and project manager/contact." });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canDeleteEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users can delete events. Coordinators can view and help fill assigned events, but they cannot delete event details." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const { error } = await admin.from("shows").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Show deleted." });
}
