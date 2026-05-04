import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { buildImportPreview, getImportOverrides } from "@/lib/event-import-server";
import { normalizeMatchValue } from "@/lib/event-import";

export const runtime = "nodejs";

type ShowRow = {
  id: string;
  name: string | null;
  client: string | null;
  venue: string | null;
  rate_city: string | null;
  show_start: string;
  show_end: string;
  notes: string | null;
};

type LaborDayRow = { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null };
type SubCallRow = {
  id: string;
  labor_day_id: string;
  area: string | null;
  role_name: string | null;
  start_time: string;
  end_time: string | null;
  crew_needed: number | null;
  notes: string | null;
};

type AssignmentRow = { id: string; sub_call_id: string; crew_id: string; status: string | null };

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }),
    };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }),
    };
  }
  return { ok: true as const, user };
}

function normalizeTimeKey(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  return raw;
}

function makeSubCallKey(laborDate: string, area: string, roleName: string, startTime: string, endTime: string | null | undefined) {
  // Supabase returns TIME columns as HH:MM:SS, while the PDF parser emits HH:MM.
  // Normalize both forms so import-created sub-calls can be found again when inserting assignments.
  return [laborDate, area || "", roleName || "", normalizeTimeKey(startTime), normalizeTimeKey(endTime)].join("|");
}

function timeToMinutes(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function rangesOverlap(aStart: string | null | undefined, aEnd: string | null | undefined, bStart: string | null | undefined, bEnd: string | null | undefined) {
  let startA = timeToMinutes(aStart);
  let endA = timeToMinutes(aEnd) || startA;
  let startB = timeToMinutes(bStart);
  let endB = timeToMinutes(bEnd) || startB;
  if (endA <= startA) endA += 24 * 60;
  if (endB <= startB) endB += 24 * 60;
  return startA < endB && startB < endA;
}

type AssignmentCandidate = {
  sub_call_id: string;
  crew_id: string;
  status: string;
  labor_date: string;
  start_time: string;
  end_time: string | null;
};

async function removeSchedulingConflicts(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  candidates: AssignmentCandidate[],
  laborDates: string[]
) {
  if (!admin || !candidates.length) return { assignments: candidates, skipped: 0 };

  const uniqueDates = [...new Set(laborDates)].filter(Boolean);
  const candidateCrewIds = [...new Set(candidates.map((candidate) => candidate.crew_id))];

  const sameDateDaysRes = uniqueDates.length
    ? await admin.from("labor_days").select("id, labor_date").in("labor_date", uniqueDates)
    : { data: [], error: null };
  if (sameDateDaysRes.error) throw new Error(sameDateDaysRes.error.message);

  const dayRows = (sameDateDaysRes.data ?? []) as Array<{ id: string; labor_date: string }>;
  const laborDateByDayId = new Map(dayRows.map((row) => [row.id, row.labor_date]));
  const dayIds = dayRows.map((row) => row.id);

  const sameDateSubCallsRes = dayIds.length
    ? await admin
        .from("sub_calls")
        .select("id, labor_day_id, start_time, end_time")
        .in("labor_day_id", dayIds)
    : { data: [], error: null };
  if (sameDateSubCallsRes.error) throw new Error(sameDateSubCallsRes.error.message);

  const subCalls = (sameDateSubCallsRes.data ?? []) as Array<{ id: string; labor_day_id: string; start_time: string; end_time: string | null }>;
  const subCallById = new Map(
    subCalls.map((row) => [
      row.id,
      {
        labor_date: laborDateByDayId.get(row.labor_day_id) || "",
        start_time: row.start_time,
        end_time: row.end_time,
      },
    ])
  );

  const allSubCallIds = subCalls.map((row) => row.id);
  const existingAssignmentsRes = allSubCallIds.length && candidateCrewIds.length
    ? await admin
        .from("assignments")
        .select("id, sub_call_id, crew_id, status")
        .in("sub_call_id", allSubCallIds)
        .in("crew_id", candidateCrewIds)
    : { data: [], error: null };
  if (existingAssignmentsRes.error) throw new Error(existingAssignmentsRes.error.message);

  const existingAssignments = (existingAssignmentsRes.data ?? []) as Array<{ id: string; sub_call_id: string; crew_id: string; status: string | null }>;
  const accepted: AssignmentCandidate[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    const existingConflict = existingAssignments.some((assignment) => {
      if (assignment.crew_id !== candidate.crew_id || assignment.sub_call_id === candidate.sub_call_id) return false;
      const existingCall = subCallById.get(assignment.sub_call_id);
      if (!existingCall || existingCall.labor_date !== candidate.labor_date) return false;
      return rangesOverlap(candidate.start_time, candidate.end_time, existingCall.start_time, existingCall.end_time);
    });

    const newConflict = accepted.some((assignment) => {
      if (assignment.crew_id !== candidate.crew_id || assignment.sub_call_id === candidate.sub_call_id || assignment.labor_date !== candidate.labor_date) return false;
      return rangesOverlap(candidate.start_time, candidate.end_time, assignment.start_time, assignment.end_time);
    });

    if (existingConflict || newConflict) {
      skipped += 1;
      continue;
    }

    accepted.push(candidate);
  }

  return { assignments: accepted, skipped };
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Import file is required." }, { status: 400 });
    }

    const modeRaw = String(formData.get("mode") || "create").trim().toLowerCase();
    const mode = modeRaw === "merge" ? "merge" : "create";
    const targetShowId = String(formData.get("target_show_id") || "").trim();

    const preview = await buildImportPreview(admin, file, getImportOverrides(formData));
    const payload = preview.payload;

    let showRow: ShowRow | null = null;

    if (mode === "create") {
      const existingShowsRes = await admin
        .from("shows")
        .select("id, name, client, venue, rate_city, show_start, show_end, notes")
        .eq("show_start", payload.show.show_start)
        .eq("show_end", payload.show.show_end);

      if (existingShowsRes.error) {
        return NextResponse.json({ message: existingShowsRes.error.message }, { status: 400 });
      }

      const duplicate = ((existingShowsRes.data ?? []) as ShowRow[]).find(
        (row) => normalizeMatchValue(row.name || "") === normalizeMatchValue(payload.show.name)
      );

      if (duplicate) {
        return NextResponse.json(
          {
            message: `A matching event already exists for ${payload.show.name} (${payload.show.show_start} to ${payload.show.show_end}). Choose Merge into selected or rename the event.`,
          },
          { status: 409 }
        );
      }

      const showInsert = {
        name: payload.show.name,
        client: payload.show.client || null,
        venue: payload.show.venue || null,
        rate_city: payload.show.rate_city || "Default",
        show_start: payload.show.show_start,
        show_end: payload.show.show_end,
        notes: payload.show.notes || null,
      };

      const showCreateRes = await admin
        .from("shows")
        .insert(showInsert)
        .select("id, name, client, venue, rate_city, show_start, show_end, notes")
        .single();

      if (showCreateRes.error || !showCreateRes.data) {
        return NextResponse.json({ message: showCreateRes.error?.message || "Could not create the show." }, { status: 400 });
      }

      showRow = showCreateRes.data as ShowRow;
    } else {
      if (!targetShowId) {
        return NextResponse.json({ message: "Choose an event to merge into." }, { status: 400 });
      }
      const existingShowRes = await admin
        .from("shows")
        .select("id, name, client, venue, rate_city, show_start, show_end, notes")
        .eq("id", targetShowId)
        .single();
      if (existingShowRes.error || !existingShowRes.data) {
        return NextResponse.json({ message: existingShowRes.error?.message || "Selected event not found." }, { status: 404 });
      }
      showRow = existingShowRes.data as ShowRow;
    }

    const existingLaborDaysRes = await admin
      .from("labor_days")
      .select("id, show_id, labor_date, label, notes")
      .eq("show_id", showRow.id)
      .order("labor_date", { ascending: true });
    if (existingLaborDaysRes.error) {
      return NextResponse.json({ message: existingLaborDaysRes.error.message }, { status: 400 });
    }

    const existingLaborDays = (existingLaborDaysRes.data ?? []) as LaborDayRow[];
    const laborDayIdByDate = new Map(existingLaborDays.map((row) => [row.labor_date, row.id]));

    const missingLaborDays = payload.laborDays.filter((day) => !laborDayIdByDate.has(day.labor_date));
    let createdLaborDays: LaborDayRow[] = [];
    if (missingLaborDays.length) {
      const insertRes = await admin
        .from("labor_days")
        .insert(
          missingLaborDays.map((day) => ({
            show_id: showRow.id,
            labor_date: day.labor_date,
            label: day.label || null,
            notes: day.notes || null,
          }))
        )
        .select("id, show_id, labor_date, label, notes");
      if (insertRes.error) {
        return NextResponse.json({ message: insertRes.error.message }, { status: 400 });
      }
      createdLaborDays = (insertRes.data ?? []) as LaborDayRow[];
      for (const row of createdLaborDays) laborDayIdByDate.set(row.labor_date, row.id);
    }

    const allLaborDays = [...existingLaborDays, ...createdLaborDays].sort((a, b) => a.labor_date.localeCompare(b.labor_date));
    const dayIds = allLaborDays.map((row) => row.id);
    const existingSubCallsRes = dayIds.length
      ? await admin
          .from("sub_calls")
          .select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes")
          .in("labor_day_id", dayIds)
      : { data: [], error: null };
    if (existingSubCallsRes.error) {
      return NextResponse.json({ message: existingSubCallsRes.error.message }, { status: 400 });
    }

    const laborDateByDayId = new Map(allLaborDays.map((row) => [row.id, row.labor_date]));
    const existingSubCalls = (existingSubCallsRes.data ?? []) as SubCallRow[];
    const subCallIdByKey = new Map<string, string>();
    for (const row of existingSubCalls) {
      const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
      subCallIdByKey.set(makeSubCallKey(laborDate, row.area || "", row.role_name || "", row.start_time, row.end_time), row.id);
    }

    const missingSubCalls = payload.subCallGroups.filter(
      (call) => !subCallIdByKey.has(makeSubCallKey(call.labor_date, call.area, call.role_name, call.start_time, call.end_time))
    );

    let createdSubCalls: SubCallRow[] = [];
    if (missingSubCalls.length) {
      const insertRes = await admin
        .from("sub_calls")
        .insert(
          missingSubCalls.map((call) => ({
            labor_day_id: laborDayIdByDate.get(call.labor_date) || "",
            area: call.area,
            role_name: call.role_name,
            start_time: call.start_time,
            end_time: call.end_time || null,
            crew_needed: call.crew_needed,
            notes: call.notes || null,
          }))
        )
        .select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes");
      if (insertRes.error) {
        return NextResponse.json({ message: insertRes.error.message }, { status: 400 });
      }
      createdSubCalls = (insertRes.data ?? []) as SubCallRow[];
      for (const row of createdSubCalls) {
        const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
        subCallIdByKey.set(makeSubCallKey(laborDate, row.area || "", row.role_name || "", row.start_time, row.end_time), row.id);
      }
    }

    const assignmentCandidates: AssignmentCandidate[] = [];
    const assignmentKeys = new Set<string>();
    for (const call of preview.subCallPreview) {
      const subCallId = subCallIdByKey.get(makeSubCallKey(call.labor_date, call.area, call.role_name, call.start_time, call.end_time));
      if (!subCallId) continue;
      for (const match of call.matchedCrew) {
        const key = `${subCallId}|${match.crew_id}`;
        if (assignmentKeys.has(key)) continue;
        assignmentKeys.add(key);
        assignmentCandidates.push({
          sub_call_id: subCallId,
          crew_id: match.crew_id,
          status: "confirmed",
          labor_date: call.labor_date,
          start_time: call.start_time,
          end_time: call.end_time || null,
        });
      }
    }

    const conflictFiltered = await removeSchedulingConflicts(admin, assignmentCandidates, allLaborDays.map((row) => row.labor_date));
    const assignmentInsert = conflictFiltered.assignments.map((assignment) => ({
      sub_call_id: assignment.sub_call_id,
      crew_id: assignment.crew_id,
      status: assignment.status,
    }));
    const skippedConflicts = conflictFiltered.skipped;

    let assignmentRows: AssignmentRow[] = [];
    if (preview.matchedCrewCount > 0 && assignmentCandidates.length === 0) {
      return NextResponse.json(
        {
          message:
            "The importer matched crew, but could not attach them to created sub-calls. This usually means the imported time keys did not line up with the saved sub-call times.",
        },
        { status: 400 }
      );
    }

    if (assignmentInsert.length) {
      const assignmentsRes = await admin
        .from("assignments")
        .upsert(assignmentInsert, { onConflict: "sub_call_id,crew_id" })
        .select("id, sub_call_id, crew_id, status");
      if (assignmentsRes.error) {
        return NextResponse.json({ message: assignmentsRes.error.message }, { status: 400 });
      }
      assignmentRows = (assignmentsRes.data ?? []) as AssignmentRow[];
    }

    const finalSubCallsRes = await admin
      .from("sub_calls")
      .select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes")
      .in("labor_day_id", allLaborDays.map((row) => row.id))
      .order("start_time", { ascending: true });

    if (finalSubCallsRes.error) {
      return NextResponse.json({ message: finalSubCallsRes.error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message:
        mode === "merge"
          ? `Merged import into ${showRow.name}. Added ${createdLaborDays.length} labor days, ${createdSubCalls.length} sub-calls, and assigned ${assignmentRows.length} matched crew${skippedConflicts ? `, ${skippedConflicts} skipped schedule conflict(s)` : ""}${preview.unmatchedCrewCount ? `, ${preview.unmatchedCrewCount} unmatched` : ""}.`
          : `Imported ${showRow.name}. Created ${allLaborDays.length} labor days, ${existingSubCalls.length + createdSubCalls.length} sub-calls, and assigned ${assignmentRows.length} matched crew${skippedConflicts ? `, ${skippedConflicts} skipped schedule conflict(s)` : ""}${preview.unmatchedCrewCount ? `, ${preview.unmatchedCrewCount} unmatched` : ""}.`,
      show: showRow,
      laborDays: allLaborDays,
      subCalls: (finalSubCallsRes.data ?? []) as SubCallRow[],
      assignments: assignmentRows,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Import failed." },
      { status: 400 }
    );
  }
}
