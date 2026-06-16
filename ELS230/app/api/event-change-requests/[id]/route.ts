import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type EventChangeRequestRow = {
  id: string;
  show_id: string;
  requested_by: string | null;
  requester_name: string | null;
  requester_email: string | null;
  request_type: "time_change" | "add_day";
  status: "pending" | "approved" | "denied";
  target_labor_day_id: string | null;
  target_sub_call_id: string | null;
  current_start_time: string | null;
  current_end_time: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  requested_labor_date: string | null;
  requested_label: string | null;
  reason: string | null;
  admin_note: string | null;
  created_at: string;
};

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

async function isAdminUser(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  if (!admin) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = String((data as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  return role === "owner" || role === "admin";
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

function formatClock(value: string | null | undefined) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return raw || "not set";
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function formatDateOnly(value: string | null | undefined) {
  return String(value || "").slice(0, 10);
}

function appendAuditNote(existing: string | null | undefined, note: string) {
  return [String(existing || "").trim(), note].filter(Boolean).join("\n\n");
}

async function getReviewerName(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  if (!admin) return "Admin";
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  const typed = data as { full_name?: string | null; email?: string | null } | null;
  return String(typed?.full_name || typed?.email || "Admin").trim();
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  if (!(await isAdminUser(admin, auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users can approve or deny coordinator change requests." }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const action = String(body.status || body.action || "").toLowerCase().trim();
  const adminNote = String(body.admin_note || "").trim();

  if (!["approved", "denied"].includes(action)) {
    return NextResponse.json({ message: "Choose approve or deny." }, { status: 400 });
  }

  const { data: existing, error: fetchError } = await admin
    .from("event_change_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    if (isMissingChangeRequestsTable(fetchError)) {
      return NextResponse.json({ message: "Run the ELS168 SQL once in Supabase to enable coordinator change requests." }, { status: 400 });
    }
    return NextResponse.json({ message: fetchError?.message || "Change request not found." }, { status: 404 });
  }

  const changeRequest = existing as EventChangeRequestRow;
  if (changeRequest.status !== "pending") {
    return NextResponse.json({ message: "This change request has already been reviewed." }, { status: 400 });
  }

  const reviewerName = await getReviewerName(admin, auth.user.id);
  const reviewedAt = new Date().toISOString();
  let appliedLaborDay = null as Record<string, unknown> | null;
  let appliedSubCall = null as Record<string, unknown> | null;
  let appliedLaborDayId: string | null = null;
  let appliedSubCallId: string | null = null;

  if (action === "approved") {
    if (changeRequest.request_type === "add_day") {
      const laborDate = formatDateOnly(changeRequest.requested_labor_date);
      if (!laborDate) return NextResponse.json({ message: "Requested labor date is missing." }, { status: 400 });

      const addNote = [
        `ELS change request approved ${reviewedAt.slice(0, 10)} by ${reviewerName}.`,
        `Request type: Additional labor day.`,
        `Requested by: ${changeRequest.requester_name || changeRequest.requester_email || "Coordinator"} on ${formatDateOnly(changeRequest.created_at)}.`,
        changeRequest.reason ? `Coordinator note: ${changeRequest.reason}` : "",
        adminNote ? `Admin note: ${adminNote}` : "",
      ].filter(Boolean).join("\n");

      const { data: createdDay, error: dayError } = await admin
        .from("labor_days")
        .insert({
          show_id: changeRequest.show_id,
          labor_date: laborDate,
          label: changeRequest.requested_label || null,
          notes: addNote,
        })
        .select("id, show_id, labor_date, label, notes")
        .single();

      if (dayError || !createdDay) {
        return NextResponse.json({ message: dayError?.message || "Could not create the additional labor day." }, { status: 400 });
      }

      appliedLaborDay = createdDay as Record<string, unknown>;
      appliedLaborDayId = String(appliedLaborDay.id || "");
    }

    if (changeRequest.request_type === "time_change") {
      if (!changeRequest.target_sub_call_id || !changeRequest.requested_start_time || !changeRequest.requested_end_time) {
        return NextResponse.json({ message: "Requested time change is missing target sub-call or time." }, { status: 400 });
      }

      const { data: subCall, error: subCallFetchError } = await admin
        .from("sub_calls")
        .select("id, labor_day_id, area, role_name, start_time, end_time, notes")
        .eq("id", changeRequest.target_sub_call_id)
        .single();

      if (subCallFetchError || !subCall) {
        return NextResponse.json({ message: subCallFetchError?.message || "Target sub-call not found." }, { status: 404 });
      }

      const typedSubCall = subCall as { id: string; labor_day_id: string; area?: string | null; role_name?: string | null; start_time?: string | null; end_time?: string | null; notes?: string | null };

      const { data: laborDay } = await admin
        .from("labor_days")
        .select("id, labor_date, label, notes")
        .eq("id", typedSubCall.labor_day_id)
        .maybeSingle();

      const typedLaborDay = laborDay as { id?: string; labor_date?: string | null; label?: string | null; notes?: string | null } | null;
      const dayLabel = [typedLaborDay?.labor_date, typedLaborDay?.label].filter(Boolean).join(" · ");

      const oldStart = changeRequest.current_start_time || typedSubCall.start_time || "";
      const oldEnd = changeRequest.current_end_time || typedSubCall.end_time || "";
      const timeNote = [
        `ELS change request approved ${reviewedAt.slice(0, 10)} by ${reviewerName}.`,
        `Request type: Time change${dayLabel ? ` for ${dayLabel}` : ""}.`,
        `Requested by: ${changeRequest.requester_name || changeRequest.requester_email || "Coordinator"} on ${formatDateOnly(changeRequest.created_at)}.`,
        `Sub-call: ${typedSubCall.area || "Area"} • ${typedSubCall.role_name || "Role"}.`,
        `Original time: ${formatClock(oldStart)}–${formatClock(oldEnd)}.`,
        `Approved time: ${formatClock(changeRequest.requested_start_time)}–${formatClock(changeRequest.requested_end_time)}.`,
        changeRequest.reason ? `Coordinator note: ${changeRequest.reason}` : "",
        adminNote ? `Admin note: ${adminNote}` : "",
      ].filter(Boolean).join("\n");

      const updatedSubCallNotes = appendAuditNote(typedSubCall.notes, timeNote);

      const { data: updatedSubCall, error: subCallUpdateError } = await admin
        .from("sub_calls")
        .update({
          start_time: changeRequest.requested_start_time,
          end_time: changeRequest.requested_end_time,
          notes: updatedSubCallNotes,
        })
        .eq("id", changeRequest.target_sub_call_id)
        .select("id,labor_day_id,area,location,po_number,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes,sort_order,day_type,one_hour_walkaway")
        .single();

      if (subCallUpdateError || !updatedSubCall) {
        return NextResponse.json({ message: subCallUpdateError?.message || "Could not apply the time change." }, { status: 400 });
      }

      appliedSubCall = updatedSubCall as Record<string, unknown>;
      appliedSubCallId = String(appliedSubCall.id || "");

      if (typedLaborDay?.id) {
        const laborDayNote = appendAuditNote(
          typedLaborDay.notes,
          `Time change approved ${reviewedAt.slice(0, 10)} for ${typedSubCall.area || "sub-call"}: ${formatClock(oldStart)}–${formatClock(oldEnd)} changed to ${formatClock(changeRequest.requested_start_time)}–${formatClock(changeRequest.requested_end_time)}.`
        );
        const { data: updatedLaborDay } = await admin
          .from("labor_days")
          .update({ notes: laborDayNote })
          .eq("id", typedLaborDay.id)
          .select("id, show_id, labor_date, label, notes")
          .maybeSingle();
        if (updatedLaborDay) {
          appliedLaborDay = updatedLaborDay as Record<string, unknown>;
          appliedLaborDayId = String(appliedLaborDay.id || "");
        }
      }
    }
  }

  const { data: updatedRequest, error: updateError } = await admin
    .from("event_change_requests")
    .update({
      status: action,
      admin_note: adminNote || null,
      reviewed_by: auth.user.id,
      reviewed_at: reviewedAt,
      applied_labor_day_id: appliedLaborDayId,
      applied_sub_call_id: appliedSubCallId,
      updated_at: reviewedAt,
    })
    .eq("id", changeRequest.id)
    .select("*")
    .single();

  if (updateError || !updatedRequest) {
    return NextResponse.json({ message: updateError?.message || "Could not update the change request." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    request: normalizeRequestRow(updatedRequest as Record<string, unknown>),
    laborDay: appliedLaborDay,
    subCall: appliedSubCall,
    message: action === "approved" ? "Change request approved and applied." : "Change request denied.",
  });
}
