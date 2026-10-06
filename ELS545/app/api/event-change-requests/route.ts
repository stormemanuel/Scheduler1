import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type UserRole = "owner" | "admin" | "coordinator" | "viewer" | string;

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

async function getUserRole(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string): Promise<UserRole> {
  if (!admin) return "viewer";
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  return String((data as { role?: string | null } | null)?.role || "viewer").toLowerCase().trim();
}

async function canAccessShow(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string, role: UserRole, showId: string) {
  if (!admin) return false;
  if (role === "owner" || role === "admin") return true;

  const { data: show } = await admin
    .from("shows")
    .select("id, created_by, assigned_coordinator_user_id")
    .eq("id", showId)
    .maybeSingle();

  const typedShow = show as { id?: string; created_by?: string | null; assigned_coordinator_user_id?: string | null } | null;
  if (typedShow?.created_by === userId || typedShow?.assigned_coordinator_user_id === userId) return true;

  const { data: access } = await admin
    .from("event_user_access")
    .select("id")
    .eq("show_id", showId)
    .or(`user_id.eq.${userId},user_profile_id.eq.${userId}`)
    .limit(1);

  return Boolean((access ?? []).length);
}

function normalizeRequestRow(row: Record<string, unknown>) {
  return {
    ...row,
    requester_name: String(row.requester_name || row.requester_email || "Coordinator"),
    requester_email: String(row.requester_email || ""),
    reason: String(row.reason || ""),
    admin_note: String(row.admin_note || ""),
  };
}

function isMissingChangeRequestsTable(error: { message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("event_change_requests") || message.includes("schema cache") || message.includes("does not exist");
}

export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const role = await getUserRole(admin, auth.user.id);
  const { searchParams } = new URL(request.url);
  const showId = String(searchParams.get("show_id") || "").trim();

  let query = admin
    .from("event_change_requests")
    .select("id, show_id, requested_by, requester_name, requester_email, request_type, status, target_labor_day_id, target_sub_call_id, current_start_time, current_end_time, requested_start_time, requested_end_time, requested_labor_date, requested_label, reason, admin_note, reviewed_by, reviewed_at, applied_labor_day_id, applied_sub_call_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (showId) {
    if (!(await canAccessShow(admin, auth.user.id, role, showId))) {
      return NextResponse.json({ message: "You do not have access to this event." }, { status: 403 });
    }
    query = query.eq("show_id", showId);
  }

  if (!(role === "owner" || role === "admin")) {
    query = query.eq("requested_by", auth.user.id);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingChangeRequestsTable(error)) {
      return NextResponse.json({
        ok: true,
        requests: [],
        setupMissing: true,
        message: "Run the ELS168 SQL once to enable coordinator change requests.",
      });
    }
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, requests: (data ?? []).map((row) => normalizeRequestRow(row as Record<string, unknown>)) });
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const role = await getUserRole(admin, auth.user.id);
  const body = await request.json();

  const showId = String(body.show_id || "").trim();
  const requestType = String(body.request_type || "").trim();
  if (!showId) return NextResponse.json({ message: "Choose an event first." }, { status: 400 });
  if (!(await canAccessShow(admin, auth.user.id, role, showId))) {
    return NextResponse.json({ message: "You do not have access to this event." }, { status: 403 });
  }
  if (!["time_change", "add_day"].includes(requestType)) {
    return NextResponse.json({ message: "Choose time change or additional day." }, { status: 400 });
  }

  const requesterName =
    String(body.requester_name || "").trim() ||
    String(auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || auth.user.email || "Coordinator").trim();
  const requesterEmail = String(auth.user.email || "").trim();

  const payload = {
    show_id: showId,
    requested_by: auth.user.id,
    requester_name: requesterName,
    requester_email: requesterEmail,
    request_type: requestType,
    status: "pending",
    target_labor_day_id: String(body.target_labor_day_id || "").trim() || null,
    target_sub_call_id: String(body.target_sub_call_id || "").trim() || null,
    current_start_time: String(body.current_start_time || "").trim() || null,
    current_end_time: String(body.current_end_time || "").trim() || null,
    requested_start_time: String(body.requested_start_time || "").trim() || null,
    requested_end_time: String(body.requested_end_time || "").trim() || null,
    requested_labor_date: String(body.requested_labor_date || "").trim() || null,
    requested_label: String(body.requested_label || "").trim() || null,
    reason: String(body.reason || "").trim(),
  };

  if (requestType === "time_change") {
    if (!payload.target_sub_call_id || !payload.requested_start_time || !payload.requested_end_time) {
      return NextResponse.json({ message: "Choose the sub-call and enter the requested start/end time." }, { status: 400 });
    }
  }

  if (requestType === "add_day") {
    if (!payload.requested_labor_date) {
      return NextResponse.json({ message: "Enter the additional labor date." }, { status: 400 });
    }
  }

  const { data, error } = await admin
    .from("event_change_requests")
    .insert(payload)
    .select("id, show_id, requested_by, requester_name, requester_email, request_type, status, target_labor_day_id, target_sub_call_id, current_start_time, current_end_time, requested_start_time, requested_end_time, requested_labor_date, requested_label, reason, admin_note, reviewed_by, reviewed_at, applied_labor_day_id, applied_sub_call_id, created_at, updated_at")
    .single();

  if (error) {
    if (isMissingChangeRequestsTable(error)) {
      return NextResponse.json({ message: "Run the ELS168 SQL once in Supabase to enable coordinator change requests." }, { status: 400 });
    }
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    request: normalizeRequestRow(data as Record<string, unknown>),
    message: "Change request submitted for admin approval.",
  });
}
