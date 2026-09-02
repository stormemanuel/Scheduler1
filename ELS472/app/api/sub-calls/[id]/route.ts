import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient, findCrewAssignmentConflict, invalidateShowScheduleStatus, recordRemovedAssignmentsAndCancelQueue } from "@/lib/supabase-server";

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

async function isOwnerAdmin(userId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  const role = String((data as { role?: string | null } | null)?.role || "").toLowerCase().trim();
  return role === "owner" || role === "admin";
}

async function coordinatorCanAccessSubCall(userId: string, subCallId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) return false;
  if (await isOwnerAdmin(userId)) return true;
  const { data: call } = await admin.from("sub_calls").select("labor_day_id, assigned_coordinator_user_id").eq("id", subCallId).maybeSingle();
  const typedCall = call as { labor_day_id?: string | null; assigned_coordinator_user_id?: string | null } | null;
  if (typedCall?.assigned_coordinator_user_id === userId) return true;
  if (!typedCall?.labor_day_id) return false;
  const { data: day } = await admin.from("labor_days").select("show_id").eq("id", typedCall.labor_day_id).maybeSingle();
  const showId = String((day as { show_id?: string | null } | null)?.show_id || "");
  if (!showId) return false;
  const { data: show } = await admin.from("shows").select("created_by, assigned_coordinator_user_id").eq("id", showId).maybeSingle();
  const typedShow = show as { created_by?: string | null; assigned_coordinator_user_id?: string | null } | null;
  if (typedShow?.created_by === userId || typedShow?.assigned_coordinator_user_id === userId) return true;
  const accessByUser = await admin.from("event_user_access").select("id").eq("show_id", showId).eq("user_id", userId).limit(1);
  if (!accessByUser.error && accessByUser.data?.length) return true;
  if (accessByUser.error?.message?.includes("user_id")) {
    const accessByProfile = await admin.from("event_user_access").select("id").eq("show_id", showId).eq("user_profile_id", userId).limit(1);
    return Boolean(!accessByProfile.error && accessByProfile.data?.length);
  }
  return false;
}

function coordinatorNotificationsMissing(message: string | null | undefined) {
  const text = String(message || "").toLowerCase();
  return text.includes("coordinator_event_notifications") && (text.includes("does not exist") || text.includes("schema cache"));
}

async function createSubCallCoordinatorNotification(admin: ReturnType<typeof createSupabaseAdminClient>, row: Record<string, unknown>, createdByUserId: string) {
  if (!admin) return;
  const { data: day } = await admin
    .from("labor_days")
    .select("id, show_id, labor_date, label")
    .eq("id", String(row.labor_day_id || ""))
    .maybeSingle();
  const typedDay = day as { show_id?: string | null; labor_date?: string | null; label?: string | null } | null;
  if (!typedDay?.show_id) return;
  const { data: show } = await admin
    .from("shows")
    .select("id, name, client, venue, event_location, assigned_coordinator_user_id")
    .eq("id", typedDay.show_id)
    .maybeSingle();
  const typedShow = show as { id?: string; name?: string | null; client?: string | null; venue?: string | null; event_location?: string | null; assigned_coordinator_user_id?: string | null } | null;
  const coordinatorUserId = String(row.assigned_coordinator_user_id || typedShow?.assigned_coordinator_user_id || "").trim();
  if (!coordinatorUserId || coordinatorUserId === createdByUserId || !typedShow?.id) return;
  const title = `New sub-call assigned: ${typedShow.name || "Untitled event"}`;
  const body = [
    `Event: ${typedShow.name || "Untitled event"}`,
    typedShow.client ? `Client: ${typedShow.client}` : "",
    typedShow.venue ? `Venue: ${typedShow.venue}` : "",
    typedShow.event_location ? `Location: ${typedShow.event_location}` : "",
    `Date: ${typedDay.labor_date || "TBD"}${typedDay.label ? ` · ${typedDay.label}` : ""}`,
    `Area / booth: ${String(row.area || "Sub-call")}`,
    `Role: ${String(row.role_name || "Crew")}`,
    `Call time: ${String(row.start_time || "TBD")}${row.end_time ? ` to ${String(row.end_time)}` : ""}`,
    `Crew needed: ${String(row.crew_needed || "1")}`,
    row.notes ? `Notes: ${String(row.notes)}` : "",
    "Please review this sub-call in ELS and reply here if anything needs attention.",
  ].filter(Boolean).join("\n");
  const { error } = await admin.from("coordinator_event_notifications").insert({
    user_id: coordinatorUserId,
    show_id: typedShow.id,
    sub_call_id: String(row.id || "") || null,
    notification_type: "sub_call_assigned",
    title,
    body,
    created_by: createdByUserId,
  });
  if (error && !coordinatorNotificationsMissing(error.message)) throw new Error(error.message);
}

const SUB_CALL_REFERENCE_MARKER_RE = /\[\[ELS_SUB_CALL_REFERENCE_NUMBER:([^\]]+)\]\]/i;
const BOOTH_NUMBER_MARKER_RE = /\[\[ELS_BOOTH_NUMBER:([^\]]+)\]\]/i;

function stripSubCallReferenceMarker(notes: string | null | undefined) {
  return String(notes || "").trim().replace(SUB_CALL_REFERENCE_MARKER_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

function notesWithSubCallReferenceMarker(notes: string | null | undefined, referenceNumber: string | null | undefined) {
  const cleaned = stripSubCallReferenceMarker(notes);
  const reference = String(referenceNumber || "").replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
  if (!reference) return cleaned || null;
  return [cleaned, `[[ELS_SUB_CALL_REFERENCE_NUMBER:${reference}]]`].filter(Boolean).join("\n");
}

function boothNumberFromNotes(notes: string | null | undefined) {
  return String(notes || "").match(BOOTH_NUMBER_MARKER_RE)?.[1]?.trim() || "";
}

function notesWithBoothNumberMarker(notes: string | null | undefined, boothNumber: string | null | undefined) {
  const cleaned = String(notes || "").trim().replace(BOOTH_NUMBER_MARKER_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const booth = String(boothNumber || "").replace(/[\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim();
  if (!booth) return cleaned || null;
  return [cleaned, `[[ELS_BOOTH_NUMBER:${booth}]]`].filter(Boolean).join("\n");
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

function normalizeAreaGroupKey(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(area|booth)\b\s*:?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveAreaGroupSubCalls(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  anchorSubCallId: string,
  requestedArea: unknown
) {
  const { data: anchorCall, error: anchorError } = await admin
    .from("sub_calls")
    .select("id, labor_day_id, area")
    .eq("id", anchorSubCallId)
    .maybeSingle();
  if (anchorError) return { error: anchorError.message };
  const typedAnchor = anchorCall as { id?: string | null; labor_day_id?: string | null; area?: string | null } | null;
  if (!typedAnchor?.labor_day_id) return { error: "The selected area could not be found." };

  const { data: anchorDay, error: dayError } = await admin
    .from("labor_days")
    .select("show_id")
    .eq("id", typedAnchor.labor_day_id)
    .maybeSingle();
  if (dayError) return { error: dayError.message };
  const showId = String((anchorDay as { show_id?: string | null } | null)?.show_id || "").trim();
  if (!showId) return { error: "The selected area is missing its event link." };

  const { data: days, error: daysError } = await admin
    .from("labor_days")
    .select("id")
    .eq("show_id", showId);
  if (daysError) return { error: daysError.message };
  const laborDayIds = (days || []).map((row: { id?: string | null }) => String(row.id || "")).filter(Boolean);
  if (!laborDayIds.length) return { error: "No labor days were found for this event." };

  const targetArea = String(requestedArea || typedAnchor.area || "").trim();
  const targetKey = normalizeAreaGroupKey(targetArea);
  if (!targetKey) return { error: "Area name is required." };

  const { data: calls, error: callsError } = await admin
    .from("sub_calls")
    .select("id, area")
    .in("labor_day_id", laborDayIds);
  if (callsError) return { error: callsError.message };

  const subCallIds = (calls || [])
    .filter((row: { area?: string | null }) => normalizeAreaGroupKey(row.area) === targetKey)
    .map((row: { id?: string | null }) => String(row.id || ""))
    .filter(Boolean);
  if (!subCallIds.length) return { error: `No sub-calls were found under Area ${targetArea}.` };

  return { showId, areaName: targetArea, subCallIds };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can change event days or sub-calls." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  if (!(await coordinatorCanAccessSubCall(auth.user.id, id))) {
    return NextResponse.json({ message: "You can only edit sub-calls specifically assigned to you or shows shared with you." }, { status: 403 });
  }
  const { data: existingSubCall } = await admin
    .from("sub_calls")
    .select("id, labor_day_id, area, location, po_number, role_name, message_rate, start_time, end_time, crew_needed, day_type, one_hour_walkaway, assigned_coordinator_user_id, sub_call_group_id, notes")
    .eq("id", id)
    .maybeSingle();
  const previousCoordinatorUserId = String((existingSubCall as { assigned_coordinator_user_id?: string | null } | null)?.assigned_coordinator_user_id || "");
  const existingGroupId = String((existingSubCall as { sub_call_group_id?: string | null } | null)?.sub_call_group_id || "").trim();
  const body = await request.json();
  const ownerAdmin = await isOwnerAdmin(auth.user.id);
  const areaGroupAction = String(body.area_group_action || body.scope || "").toLowerCase().trim();
  if (areaGroupAction === "rename_area" || areaGroupAction === "area_group_rename") {
    if (!ownerAdmin) {
      return NextResponse.json({ message: "Only owner/admin users can rename an entire booth or area." }, { status: 403 });
    }
    const newArea = String(body.new_area || "").replace(/\s+/g, " ").trim();
    if (!newArea) return NextResponse.json({ message: "Enter the new area name before saving." }, { status: 400 });
    const areaGroup = await resolveAreaGroupSubCalls(admin, id, body.old_area || body.area);
    if ("error" in areaGroup) return NextResponse.json({ message: areaGroup.error }, { status: 400 });
    const { data, error } = await admin
      .from("sub_calls")
      .update({ area: newArea })
      .in("id", areaGroup.subCallIds)
      .select("id,labor_day_id,area,location,po_number,sub_call_group_id,area_lead_contact_id,area_lead_name,area_lead_phone,assigned_coordinator_user_id,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes,sort_order,day_type,one_hour_walkaway");
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    const scheduleInvalidation = await invalidateShowScheduleStatus(admin, areaGroup.showId ? [areaGroup.showId] : [], {
      reason: "Area name changed. Send updated schedules.",
      changedByUserId: auth.user.id,
    });
    return NextResponse.json({
      ok: true,
      rows: (data || []).map((row) => ({ ...row, notes: row.notes || "" })),
      subCallIds: areaGroup.subCallIds,
      scheduleInvalidation,
      message: `Area ${areaGroup.areaName} renamed to ${newArea} across ${areaGroup.subCallIds.length} sub-call${areaGroup.subCallIds.length === 1 ? "" : "s"}.`,
    });
  }
  const existingForSchedule = existingSubCall as {
    labor_day_id?: string | null;
    area?: string | null;
    location?: string | null;
    po_number?: string | null;
    role_name?: string | null;
    message_rate?: string | null;
    start_time?: string | null;
    end_time?: string | null;
    crew_needed?: number | string | null;
    day_type?: string | null;
    one_hour_walkaway?: boolean | null;
    notes?: string | null;
  } | null;

  const payload = {
    area: String(body.area || '').trim(),
    location: String(body.location || '').trim() || null,
    po_number: String(body.po_number || '').trim() || null,
    sub_call_group_id: String(body.sub_call_group_id ?? existingGroupId ?? id).trim() || id,
    area_lead_contact_id: String(body.area_lead_contact_id || '').trim() || null,
    area_lead_name: String(body.area_lead_name || '').trim() || null,
    area_lead_phone: String(body.area_lead_phone || '').trim() || null,
    ...(ownerAdmin ? { assigned_coordinator_user_id: String(body.assigned_coordinator_user_id || '').trim() || null } : {}),
    role_name: String(body.role_name || '').trim(),
    master_rate_id: String(body.master_rate_id || '').trim() || null,
    message_rate: String(body.message_rate || '').replace(/[^0-9.]/g, '').trim() || null,
    start_time: String(body.start_time || '').trim(),
    end_time: String(body.end_time || '').trim() || null,
    crew_needed: Math.max(1, Number(body.crew_needed || 1)),
    notes: notesWithBoothNumberMarker(notesWithSubCallReferenceMarker(String(body.notes || '').trim(), String(body.sub_call_reference_number || '').trim()), String(body.booth_number || '').trim()),
    sort_order: Math.max(0, Number(body.sort_order || 0)),
    day_type: ["full_day", "half_day", "hourly", "custom"].includes(String(body.day_type || "")) ? String(body.day_type) : "full_day",
    one_hour_walkaway: body.one_hour_walkaway === true || body.one_hour_walkaway === "true" || body.one_hour_walkaway === "on",
  };
  const scheduleImpactingChange = Boolean(existingForSchedule && (
    String(existingForSchedule.area || "").trim() !== payload.area
    || String(existingForSchedule.location || "").trim() !== String(payload.location || "").trim()
    || String(existingForSchedule.po_number || "").trim() !== String(payload.po_number || "").trim()
    || String(existingForSchedule.role_name || "").trim() !== payload.role_name
    || String(existingForSchedule.message_rate || "").replace(/[^0-9.]/g, "").trim() !== String(payload.message_rate || "").replace(/[^0-9.]/g, "").trim()
    || String(existingForSchedule.start_time || "").trim() !== payload.start_time
    || String(existingForSchedule.end_time || "").trim() !== String(payload.end_time || "").trim()
    || Number(existingForSchedule.crew_needed || 1) !== Number(payload.crew_needed || 1)
    || String(existingForSchedule.day_type || "full_day").trim() !== String(payload.day_type || "full_day").trim()
    || Boolean(existingForSchedule.one_hour_walkaway) !== Boolean(payload.one_hour_walkaway)
    || boothNumberFromNotes(existingForSchedule.notes) !== String(body.booth_number || "").trim()
  ));

  const { data: assignedCrewRows, error: assignedCrewError } = await admin
    .from("assignments")
    .select("id, crew_id, status, start_time, end_time")
    .eq("sub_call_id", id);
  if (assignedCrewError) return NextResponse.json({ message: assignedCrewError.message }, { status: 400 });
  for (const assignment of (assignedCrewRows || []) as Array<{ id?: string | null; crew_id?: string | null; status?: string | null; start_time?: string | null; end_time?: string | null }>) {
    const assignmentId = String(assignment.id || "").trim();
    const crewId = String(assignment.crew_id || "").trim();
    if (!assignmentId || !crewId) continue;
    try {
      const conflict = await findCrewAssignmentConflict(admin, {
        crewId,
        targetSubCallId: id,
        targetStartTime: String(assignment.start_time || "").trim() || payload.start_time,
        targetEndTime: String(assignment.end_time || "").trim() || payload.end_time,
        targetStatus: assignment.status || "confirmed",
        ignoreAssignmentIds: [assignmentId],
      });
      if (conflict) {
        return NextResponse.json({
          message: `This time change would double-book an assigned crew member with another call on ${conflict.laborDate} (${conflict.startTime || "TBD"}–${conflict.endTime || "TBD"}). Move the crew assignment or adjust the call time first.`,
          code: "CREW_TIME_CONFLICT",
        }, { status: 409 });
      }
    } catch (conflictError) {
      return NextResponse.json({ message: conflictError instanceof Error ? conflictError.message : "Could not verify crew booking conflicts." }, { status: 400 });
    }
  }

  const { data, error } = await admin
    .from('sub_calls')
    .update(payload)
    .eq('id', id)
    .select('id,labor_day_id,area,location,po_number,sub_call_group_id,area_lead_contact_id,area_lead_name,area_lead_phone,assigned_coordinator_user_id,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes,sort_order,day_type,one_hour_walkaway')
    .single();
  if (error && error.message.includes('assigned_coordinator_user_id')) {
    return NextResponse.json({
      message: 'Sub-call coordinator access is not installed yet. Run ELS275_sub_call_coordinator_access.sql in Supabase SQL Editor, then save again.',
      code: 'SUB_CALL_COORDINATOR_COLUMN_MISSING',
    }, { status: 409 });
  }
  if (error && (error.message.includes('po_number') || error.message.includes('area_lead'))) {
    return NextResponse.json({
      message: 'Sub-call was not saved because the database is missing the PO / Area Lead columns. Run ELS268_required_sql.sql in Supabase SQL Editor, then save again.',
      code: 'SUB_CALL_COLUMNS_MISSING',
    }, { status: 409 });
  }
  if (error && error.message.includes('sub_call_group_id')) {
    return NextResponse.json({
      message: 'Sub-call grouping is not installed yet. Run the ELS376 sub-call grouping SQL in Supabase, then save again.',
      code: 'SUB_CALL_GROUP_COLUMN_MISSING',
    }, { status: 409 });
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  let scheduleInvalidation: Awaited<ReturnType<typeof invalidateShowScheduleStatus>> | null = null;
  if (scheduleImpactingChange) {
    const laborDayId = String((data as { labor_day_id?: string | null } | null)?.labor_day_id || existingForSchedule?.labor_day_id || "").trim();
    const dayRes = laborDayId ? await admin.from("labor_days").select("show_id").eq("id", laborDayId).maybeSingle() : { data: null, error: null };
    const showId = String((dayRes.data as { show_id?: string | null } | null)?.show_id || "").trim();
    if (showId) {
      scheduleInvalidation = await invalidateShowScheduleStatus(admin, [showId], {
        reason: "Position/time details changed. Send updated schedules.",
        changedByUserId: auth.user.id,
      });
    }
  }
  const nextCoordinatorUserId = String((data as { assigned_coordinator_user_id?: string | null } | null)?.assigned_coordinator_user_id || "");
  if (nextCoordinatorUserId && nextCoordinatorUserId !== previousCoordinatorUserId) {
    await createSubCallCoordinatorNotification(admin, data as Record<string, unknown>, auth.user.id);
  }
  return NextResponse.json({ ok: true, row: { ...data, notes: data?.notes || '' }, scheduleInvalidation, message: 'Sub-call updated.' });
}

function deleteScopeIsEntireSubCall(value: unknown) {
  return value === true || value === "true" || value === "1" || value === "entire_sub_call" || value === "group";
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canDeleteEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users can delete sub-calls. Coordinators can view and help fill events, but they cannot delete event details." }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { entire_sub_call?: unknown; scope?: unknown; area?: unknown; old_area?: unknown };
  const deleteAreaGroup = String(body.scope || "").toLowerCase().trim() === "area_group";
  const deleteEntireSubCall = deleteScopeIsEntireSubCall(body.entire_sub_call) || deleteScopeIsEntireSubCall(body.scope);
  let subCallIds = [id];
  let deleteReason = deleteEntireSubCall ? "Entire sub-call deleted." : "Sub-call day deleted.";
  let areaName = "";
  if (deleteAreaGroup) {
    const areaGroup = await resolveAreaGroupSubCalls(admin, id, body.area || body.old_area);
    if ("error" in areaGroup) return NextResponse.json({ message: areaGroup.error }, { status: 400 });
    subCallIds = areaGroup.subCallIds;
    areaName = areaGroup.areaName;
    deleteReason = `Area ${areaName} deleted.`;
  } else if (deleteEntireSubCall) {
    const { data: anchorCall, error: anchorError } = await admin
      .from("sub_calls")
      .select("id, sub_call_group_id")
      .eq("id", id)
      .maybeSingle();
    if (anchorError) return NextResponse.json({ message: anchorError.message }, { status: 400 });
    const groupId = String((anchorCall as { sub_call_group_id?: string | null } | null)?.sub_call_group_id || "").trim();
    if (groupId) {
      const { data: matchingCalls, error: matchingError } = await admin
        .from("sub_calls")
        .select("id")
        .eq("sub_call_group_id", groupId);
      if (matchingError) return NextResponse.json({ message: matchingError.message }, { status: 400 });
      subCallIds = [...new Set((matchingCalls || []).map((row: { id?: string | null }) => String(row.id || "")).filter(Boolean))];
      if (!subCallIds.length) subCallIds = [id];
    }
  }
  const { data: assignmentRows, error: assignmentCountError } = await admin
    .from("assignments")
    .select("id, crew_id")
    .in("sub_call_id", subCallIds);
  if (assignmentCountError) return NextResponse.json({ message: assignmentCountError.message }, { status: 400 });
  const cancellation = await recordRemovedAssignmentsAndCancelQueue(admin, {
    subCallIds,
    removedByUserId: auth.user.id,
    removedByName: auth.user.email || "ELS user",
    reason: deleteReason,
  });
  const { error } = await admin.from('sub_calls').delete().in('id', subCallIds);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  const crewCount = new Set((assignmentRows || []).map((row: { crew_id?: string | null }) => String(row.crew_id || "")).filter(Boolean)).size;
  return NextResponse.json({
    ok: true,
    cancellation,
    subCallIds,
    deletedCount: subCallIds.length,
    assignmentCount: assignmentRows?.length || 0,
    crewCount,
    message: deleteAreaGroup
      ? `Area ${areaName} deleted. Removed ${subCallIds.length} sub-call${subCallIds.length === 1 ? "" : "s"} and ${assignmentRows?.length || 0} crew assignment${(assignmentRows?.length || 0) === 1 ? "" : "s"}.`
      : deleteEntireSubCall
      ? `Entire sub-call deleted across ${subCallIds.length} labor day${subCallIds.length === 1 ? "" : "s"}.`
      : 'Sub-call day deleted.',
  });
}
