import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { buildImportComparison, buildImportPreview, getImportOverrides } from "@/lib/event-import-server";
import { normalizeImportedRoleName, normalizeMatchValue } from "@/lib/event-import";

export const runtime = "nodejs";

type ShowRow = {
  id: string;
  name: string | null;
  show_reference_number?: string | null;
  client: string | null;
  business_client_id?: string | null;
  venue: string | null;
  event_location?: string | null;
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
  po_number?: string | null;
  role_name: string | null;
  message_rate?: string | null;
  start_time: string;
  end_time: string | null;
  crew_needed: number | null;
  notes: string | null;
  day_type?: string | null;
  sub_call_group_id?: string | null;
};

type AssignmentRow = { id: string; sub_call_id: string; crew_id: string; status: string | null; sort_order?: number | null };
type ImportPreviewShape = Awaited<ReturnType<typeof buildImportPreview>>;
type ImportPayloadShape = ImportPreviewShape["payload"];

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

function normalizeTimeKey(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  return raw;
}

function makeSubCallKey(laborDate: string, area: string, roleName: string, startTime: string, endTime: string | null | undefined, poNumber?: string | null) {
  // Supabase returns TIME columns as HH:MM:SS, while the PDF parser emits HH:MM.
  // Normalize both forms so import-created sub-calls can be found again when inserting assignments.
  return [laborDate, normalizeImportArea(area), normalizeImportRole(roleName), normalizeTimeKey(startTime), normalizeTimeKey(endTime), normalizePoNumber(poNumber)].join("|");
}

function normalizeImportArea(value: string | null | undefined) {
  return normalizeMatchValue(value || "")
    .replace(/^area\s+/, "")
    .replace(/\bpo\s*[a-z0-9-]+\b/g, " ")
    .replace(/\bbooth\s*(?:number|no)?\s*[a-z0-9-]*\b/g, " ")
    .replace(/\btbd\b/g, " ")
    .replace(/\blabor\s+and\s+expenses\b$/g, " ")
    .replace(/\blabor\b$/g, " ")
    .replace(/\bexpenses\b$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePoNumber(value: string | null | undefined) {
  const cleaned = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("PO") ? cleaned : `PO${cleaned}`;
}

function normalizeImportRole(value: string | null | undefined) {
  return normalizeMatchValue(normalizeImportedRoleName(value));
}

function subCallReferenceNumberFromNotes(notes: string | null | undefined) {
  return String(notes || "").match(SUB_CALL_REFERENCE_MARKER_RE)?.[1]?.trim() || "";
}

function normalizeImportReference(value: string | null | undefined) {
  return normalizeMatchValue(String(value || "").replace(/^booth\s*/i, ""));
}

function makeSubCallSeriesKey(call: { area?: string | null; role_name?: string | null; po_number?: string | null; sub_call_reference_number?: string | null; notes?: string | null }) {
  // One imported sub-call can span several labor days. Group those date-specific rows together
  // so Add Crew / Change Position can apply across all days from the first imported view.
  // Do not include labor date or time here; strike/load-out dates often use different hours
  // but still belong to the same PO/booth/position series.
  const reference = normalizeImportReference(call.sub_call_reference_number || subCallReferenceNumberFromNotes(call.notes));
  return [
    normalizeImportArea(call.area),
    normalizeImportRole(call.role_name),
    normalizePoNumber(call.po_number),
    reference,
  ].join("|");
}

function makePoDayKey(laborDate: string, poNumber: string | null | undefined, roleName: string | null | undefined) {
  const po = normalizePoNumber(poNumber);
  if (!po) return "";
  return [laborDate, po, normalizeImportRole(roleName)].join("|");
}

function cleanImportDate(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function cleanImportTime(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : "";
}

function cleanImportDayType(value: unknown) {
  const text = String(value || "").trim();
  return ["full_day", "half_day", "hourly", "custom"].includes(text) ? text as "full_day" | "half_day" | "hourly" | "custom" : "full_day";
}

function applyImportPreviewOverrides(payload: ImportPayloadShape, preview: ImportPreviewShape, rawOverrides: string) {
  if (!rawOverrides.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOverrides);
  } catch {
    throw new Error("Import preview edits could not be read. Preview again and try Create Event.");
  }

  const subCalls = Array.isArray((parsed as { subCalls?: unknown[] })?.subCalls)
    ? (parsed as { subCalls: Array<Record<string, unknown>> }).subCalls
    : [];
  if (!subCalls.length) return;

  const editsByKey = new Map<string, Record<string, unknown>>();
  const editsByIndex = new Map<number, Record<string, unknown>>();
  subCalls.forEach((row, index) => {
    const key = String(row.key || "").trim();
    if (key) editsByKey.set(key, row);
    editsByIndex.set(index, row);
  });

  payload.subCallGroups = payload.subCallGroups.map((call, index) => {
    const previewCall = preview.subCallPreview[index];
    const edit = (previewCall?.key ? editsByKey.get(previewCall.key) : null) || editsByIndex.get(index);
    if (!edit) return call;

    return {
      ...call,
      labor_date: cleanImportDate(edit.labor_date) || call.labor_date,
      area: String(edit.area || call.area || "").trim() || call.area,
      role_name: normalizeImportedRoleName(String(edit.role_name || call.role_name || "").trim() || call.role_name),
      start_time: cleanImportTime(edit.start_time) || call.start_time,
      end_time: cleanImportTime(edit.end_time) || call.end_time,
      crew_needed: Math.max(1, Math.floor(Number(edit.crew_needed || call.crew_needed || 1))),
      po_number: String(edit.po_number || "").trim() || null,
      sub_call_reference_number: String(edit.sub_call_reference_number || "").trim() || null,
      message_rate: String(edit.message_rate || "").replace(/[^0-9.]/g, "").trim() || null,
      day_type: cleanImportDayType(edit.day_type),
    };
  });

  const laborDays = new Map<string, { labor_date: string; label: string; notes: string }>();
  for (const call of payload.subCallGroups) {
    if (!laborDays.has(call.labor_date)) {
      laborDays.set(call.labor_date, {
        labor_date: call.labor_date,
        label: "Imported day",
        notes: `Imported from ${preview.parsed.sourceType.toUpperCase()}`,
      });
    }
  }
  payload.laborDays = [...laborDays.values()].sort((a, b) => a.labor_date.localeCompare(b.labor_date));

  preview.subCallPreview = preview.subCallPreview.map((call, index) => {
    const editedCall = payload.subCallGroups[index];
    if (!editedCall) return call;
    return {
      ...call,
      labor_date: editedCall.labor_date,
      area: editedCall.area,
      role_name: editedCall.role_name,
      start_time: editedCall.start_time,
      end_time: editedCall.end_time,
      crew_needed: editedCall.crew_needed,
      po_number: editedCall.po_number || null,
      sub_call_reference_number: editedCall.sub_call_reference_number || null,
      message_rate: editedCall.message_rate || null,
      day_type: editedCall.day_type || null,
    };
  });
}

const SUB_CALL_REFERENCE_MARKER_RE = /\[\[ELS_SUB_CALL_REFERENCE_NUMBER:([^\]]+)\]\]/i;

function notesWithSubCallReferenceMarker(notes: string | null | undefined, referenceNumber: string | null | undefined) {
  const cleaned = String(notes || "").trim().replace(SUB_CALL_REFERENCE_MARKER_RE, "").replace(/\n{3,}/g, "\n\n").trim();
  const reference = String(referenceNumber || "").trim();
  if (!reference) return cleaned;
  return [cleaned, `[[ELS_SUB_CALL_REFERENCE_NUMBER:${reference}]]`].filter(Boolean).join("\n");
}

function parseSelectedImportChangeIds(value: FormDataEntryValue | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function parseExcludedImportIndexes(value: FormDataEntryValue | null) {
  if (!value) return new Set<number>();
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return new Set<number>();
    return new Set(
      parsed
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0)
    );
  } catch {
    return new Set<number>();
  }
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  if (!(await canEditEventDetails(auth.user.id))) {
    return NextResponse.json({ message: "Only owner/admin users or coordinators with Event detail editing enabled can import or merge event details." }, { status: 403 });
  }

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
    const forceCreateNew = String(formData.get("force_create_new") || "").trim() === "1";
    const importSelectionExplicit = String(formData.get("import_selection_explicit") || "").trim() === "1";
    const selectedImportChangeIds = parseSelectedImportChangeIds(formData.get("selected_import_change_ids"));
    const selectedImportChangeSet = new Set(selectedImportChangeIds);
    const excludedImportIndexes = parseExcludedImportIndexes(formData.get("excluded_import_indexes"));

    const preview = await buildImportPreview(admin, file, getImportOverrides(formData), { existingEventId: mode === "merge" ? targetShowId : "" });
    const payload = preview.payload;
    applyImportPreviewOverrides(payload, preview, String(formData.get("import_preview_overrides") || ""));

    let showRow: ShowRow | null = null;

    if (mode === "create") {
      if (preview.importFormat === "estimate" && preview.existingEventMatch && !forceCreateNew) {
        return NextResponse.json(
          {
            message: `Existing event found: ${preview.existingEventMatch.name}. Use Compare / Update Existing, or choose Create As New Event if this is a separate show.`,
            existingEventMatch: preview.existingEventMatch,
            comparison: preview.comparison,
          },
          { status: 409 }
        );
      }

      const existingShowsRes = await admin
        .from("shows")
        .select("id, name, client, venue, event_location, rate_city, show_start, show_end, notes")
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
        show_reference_number: payload.show.show_reference_number || null,
        client: payload.show.client || null,
        business_client_id: preview.clientMatch.status === "matched" ? preview.clientMatch.id || null : null,
        venue: payload.show.venue || null,
        event_location: payload.show.event_location || null,
        rate_city: payload.show.rate_city || "Default",
        show_start: payload.show.show_start,
        show_end: payload.show.show_end,
        notes: payload.show.notes || null,
      };

      const showCreateRes = await admin
        .from("shows")
        .insert({ ...showInsert, created_by: auth.user.id })
        .select("id, name, show_reference_number, client, business_client_id, venue, event_location, rate_city, show_start, show_end, notes")
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
        .select("id, name, show_reference_number, client, business_client_id, venue, event_location, rate_city, show_start, show_end, notes")
        .eq("id", targetShowId)
        .single();
      if (existingShowRes.error || !existingShowRes.data) {
        return NextResponse.json({ message: existingShowRes.error?.message || "Selected event not found." }, { status: 404 });
      }
      showRow = existingShowRes.data as ShowRow;
    }

    const comparison = mode === "merge"
      ? await buildImportComparison(admin, payload, {
          id: showRow.id,
          name: showRow.name || payload.show.name,
          show_reference_number: showRow.show_reference_number || null,
          client: showRow.client || null,
          venue: showRow.venue || null,
          event_location: showRow.event_location || null,
          show_start: showRow.show_start,
          show_end: showRow.show_end,
          match_type: "show_reference_number",
          confidence: "strong",
        })
      : null;
    const mergeHasExplicitSelection = mode === "merge" && importSelectionExplicit;
    const selectedNewImportIndexes = new Set<number>();
    const selectedNewLaborDates = new Set<string>();
    const selectedChangedImportChanges = comparison
      ? comparison.changes.filter((change) => {
          if (!selectedImportChangeSet.has(change.id)) return false;
          if (change.kind === "new") {
            if (typeof change.importedIndex === "number" && !excludedImportIndexes.has(change.importedIndex)) {
              selectedNewImportIndexes.add(change.importedIndex);
              const importedCall = payload.subCallGroups[change.importedIndex] || null;
              if (importedCall?.labor_date) selectedNewLaborDates.add(importedCall.labor_date);
            }
            return false;
          }
          return change.kind === "changed" && Boolean(change.existingSubCallId) && typeof change.importedIndex === "number";
        })
      : [];

    if (mode === "merge" && comparison) {
      const unresolvedNeedsReview = comparison.changes.filter((change) => change.category === "needs_review");
      if (unresolvedNeedsReview.length && !mergeHasExplicitSelection) {
        return NextResponse.json({ message: "This Quote Merge contains Area/position match-review items. Preview the merge and explicitly choose safe updates before applying." }, { status: 400 });
      }
      const selectedNeedsReview = unresolvedNeedsReview.filter((change) => selectedImportChangeSet.has(change.id));
      if (selectedNeedsReview.length) {
        return NextResponse.json({ message: "Resolve Area/position match review items before applying this Quote Merge. Needs-review rows cannot be inserted as new labor." }, { status: 400 });
      }
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

    const laborDaysToConsider = mergeHasExplicitSelection
      ? payload.laborDays.filter((day) => selectedNewLaborDates.has(day.labor_date))
      : payload.laborDays;
    const missingLaborDays = laborDaysToConsider.filter((day) => !laborDayIdByDate.has(day.labor_date));
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
          .select("id, labor_day_id, area, po_number, sub_call_group_id, role_name, message_rate, start_time, end_time, crew_needed, notes, day_type")
          .in("labor_day_id", dayIds)
      : { data: [], error: null };
    if (existingSubCallsRes.error) {
      return NextResponse.json({ message: existingSubCallsRes.error.message }, { status: 400 });
    }

    const laborDateByDayId = new Map(allLaborDays.map((row) => [row.id, row.labor_date]));
    const existingSubCalls = (existingSubCallsRes.data ?? []) as SubCallRow[];
    const existingSubCallById = new Map(existingSubCalls.map((row) => [row.id, row]));
    const subCallIdByKey = new Map<string, string>();
    const subCallIdByPoDay = new Map<string, string>();
    const subCallGroupIdBySeriesKey = new Map<string, string>();
    for (const row of existingSubCalls) {
      const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
      subCallIdByKey.set(makeSubCallKey(laborDate, row.area || "", row.role_name || "", row.start_time, row.end_time, row.po_number), row.id);
      const poDayKey = makePoDayKey(laborDate, row.po_number, row.role_name);
      if (poDayKey && !subCallIdByPoDay.has(poDayKey)) subCallIdByPoDay.set(poDayKey, row.id);
      const seriesKey = makeSubCallSeriesKey(row);
      const groupId = String(row.sub_call_group_id || row.id || "").trim();
      if (seriesKey && groupId && !subCallGroupIdBySeriesKey.has(seriesKey)) subCallGroupIdBySeriesKey.set(seriesKey, groupId);
    }

    const subCallGroupIdForImport = (call: { area: string; role_name: string; po_number?: string | null; sub_call_reference_number?: string | null; notes?: string | null }) => {
      const seriesKey = makeSubCallSeriesKey(call);
      const existingGroupId = subCallGroupIdBySeriesKey.get(seriesKey);
      if (existingGroupId) return existingGroupId;
      const nextGroupId = randomUUID();
      subCallGroupIdBySeriesKey.set(seriesKey, nextGroupId);
      return nextGroupId;
    };

    const existingSubCallIdForImport = (call: { labor_date: string; area: string; role_name: string; start_time: string; end_time?: string | null; po_number?: string | null }) => {
      const poDayKey = makePoDayKey(call.labor_date, call.po_number, call.role_name);
      if (poDayKey && subCallIdByPoDay.has(poDayKey)) return subCallIdByPoDay.get(poDayKey) || "";
      return subCallIdByKey.get(makeSubCallKey(call.labor_date, call.area, call.role_name, call.start_time, call.end_time, call.po_number)) || "";
    };

    let updatedSubCallCount = 0;
    for (const change of selectedChangedImportChanges) {
      const subCallId = change.existingSubCallId || "";
      const importedCall = typeof change.importedIndex === "number" ? payload.subCallGroups[change.importedIndex] : null;
      const existingCall = existingSubCallById.get(subCallId);
      if (!subCallId || !importedCall || !existingCall) continue;

      const patch: Partial<SubCallRow> = {};
      if (change.fields?.start_time || change.fields?.end_time || change.fields?.day_type) {
        patch.start_time = importedCall.start_time;
        patch.end_time = importedCall.end_time || null;
        patch.day_type = importedCall.day_type || "full_day";
      }
      if (change.fields?.po_number) patch.po_number = importedCall.po_number || null;
      if (change.fields?.message_rate) patch.message_rate = importedCall.message_rate || null;
      if (change.fields?.crew_needed) patch.crew_needed = Math.max(1, Number(importedCall.crew_needed || 1));
      if (change.fields?.sub_call_reference_number) {
        patch.notes = notesWithSubCallReferenceMarker(existingCall.notes || importedCall.notes || null, importedCall.sub_call_reference_number || null);
      }
      if (!Object.keys(patch).length) continue;
      const updateRes = await admin.from("sub_calls").update(patch).eq("id", subCallId);
      if (updateRes.error) {
        return NextResponse.json({ message: updateRes.error.message }, { status: 400 });
      }
      updatedSubCallCount += 1;
    }

    const subCallsToConsider = mergeHasExplicitSelection
      ? payload.subCallGroups.filter((_call, index) => selectedNewImportIndexes.has(index))
      : payload.subCallGroups.filter((_call, index) => !excludedImportIndexes.has(index));
    let missingSubCalls = subCallsToConsider.filter(
      (call) => !existingSubCallIdForImport(call)
    );

    let createdSubCalls: SubCallRow[] = [];
    if (missingSubCalls.length) {
      const latestDaysRes = await admin
        .from("labor_days")
        .select("id, show_id, labor_date, label, notes")
        .eq("show_id", showRow.id);
      if (latestDaysRes.error) {
        return NextResponse.json({ message: latestDaysRes.error.message }, { status: 400 });
      }
      const latestDays = (latestDaysRes.data ?? []) as LaborDayRow[];
      const latestLaborDateByDayId = new Map(latestDays.map((row) => [row.id, row.labor_date]));
      const latestSubCallsRes = latestDays.length
        ? await admin
            .from("sub_calls")
            .select("id, labor_day_id, area, po_number, sub_call_group_id, role_name, message_rate, start_time, end_time, crew_needed, notes, day_type")
            .in("labor_day_id", latestDays.map((row) => row.id))
        : { data: [], error: null };
      if (latestSubCallsRes.error) {
        return NextResponse.json({ message: latestSubCallsRes.error.message }, { status: 400 });
      }
      const latestSubCallIdByKey = new Map<string, string>();
      const latestSubCallIdByPoDay = new Map<string, string>();
      for (const row of (latestSubCallsRes.data ?? []) as SubCallRow[]) {
        const laborDate = latestLaborDateByDayId.get(row.labor_day_id) || "";
        latestSubCallIdByKey.set(makeSubCallKey(laborDate, row.area || "", row.role_name || "", row.start_time, row.end_time, row.po_number), row.id);
        const poDayKey = makePoDayKey(laborDate, row.po_number, row.role_name);
        if (poDayKey && !latestSubCallIdByPoDay.has(poDayKey)) latestSubCallIdByPoDay.set(poDayKey, row.id);
        const seriesKey = makeSubCallSeriesKey(row);
        const groupId = String(row.sub_call_group_id || row.id || "").trim();
        if (seriesKey && groupId && !subCallGroupIdBySeriesKey.has(seriesKey)) subCallGroupIdBySeriesKey.set(seriesKey, groupId);
      }
      missingSubCalls = missingSubCalls.filter((call) => {
        const poDayKey = makePoDayKey(call.labor_date, call.po_number, call.role_name);
        if (poDayKey && latestSubCallIdByPoDay.has(poDayKey)) return false;
        return !latestSubCallIdByKey.has(makeSubCallKey(call.labor_date, call.area, call.role_name, call.start_time, call.end_time, call.po_number));
      });
    }

    // Final transaction-local duplicate guard: if the PDF repeats the same logical position row,
    // insert it only once even before the first insert becomes visible to a second query.
    if (missingSubCalls.length) {
      const seenInsertKeys = new Set<string>();
      const seenInsertPoDayKeys = new Set<string>();
      missingSubCalls = missingSubCalls.filter((call) => {
        const exactKey = makeSubCallKey(call.labor_date, call.area, call.role_name, call.start_time, call.end_time, call.po_number);
        const poDayKey = makePoDayKey(call.labor_date, call.po_number, call.role_name);
        if (seenInsertKeys.has(exactKey) || (poDayKey && seenInsertPoDayKeys.has(poDayKey))) return false;
        seenInsertKeys.add(exactKey);
        if (poDayKey) seenInsertPoDayKeys.add(poDayKey);
        return true;
      });
    }

    if (missingSubCalls.length) {
      const insertRes = await admin
        .from("sub_calls")
        .insert(
          missingSubCalls.map((call) => ({
            labor_day_id: laborDayIdByDate.get(call.labor_date) || "",
            area: call.area,
            po_number: call.po_number || null,
            sub_call_group_id: subCallGroupIdForImport(call),
            role_name: call.role_name,
            message_rate: call.message_rate || null,
            start_time: call.start_time,
            end_time: call.end_time || null,
            crew_needed: call.crew_needed,
            notes: notesWithSubCallReferenceMarker(call.notes || null, call.sub_call_reference_number || null),
            day_type: call.day_type || "full_day",
          }))
        )
        .select("id, labor_day_id, area, po_number, sub_call_group_id, role_name, message_rate, start_time, end_time, crew_needed, notes, day_type");
      if (insertRes.error) {
        return NextResponse.json({ message: insertRes.error.message }, { status: 400 });
      }
      createdSubCalls = (insertRes.data ?? []) as SubCallRow[];
      for (const row of createdSubCalls) {
        const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
        subCallIdByKey.set(makeSubCallKey(laborDate, row.area || "", row.role_name || "", row.start_time, row.end_time, row.po_number), row.id);
        const poDayKey = makePoDayKey(laborDate, row.po_number, row.role_name);
        if (poDayKey && !subCallIdByPoDay.has(poDayKey)) subCallIdByPoDay.set(poDayKey, row.id);
        const seriesKey = makeSubCallSeriesKey(row);
        const groupId = String(row.sub_call_group_id || row.id || "").trim();
        if (seriesKey && groupId && !subCallGroupIdBySeriesKey.has(seriesKey)) subCallGroupIdBySeriesKey.set(seriesKey, groupId);
      }
    }

    const assignmentInsert: Array<{ sub_call_id: string; crew_id: string; status: string; sort_order: number }> = [];
    const assignmentKeys = new Set<string>();
    const sortOrderBySubCall = new Map<string, number>();
    for (const call of preview.subCallPreview) {
      const subCallId = existingSubCallIdForImport(call);
      if (!subCallId) continue;
      for (const match of call.matchedCrew) {
        const key = `${subCallId}|${match.crew_id}`;
        if (assignmentKeys.has(key)) continue;
        assignmentKeys.add(key);
        const nextSortOrder = (sortOrderBySubCall.get(subCallId) ?? 0) + 1;
        sortOrderBySubCall.set(subCallId, nextSortOrder);
        assignmentInsert.push({ sub_call_id: subCallId, crew_id: match.crew_id, status: "confirmed", sort_order: nextSortOrder });
      }
    }

    let assignmentRows: AssignmentRow[] = [];
    if (preview.importFormat !== "estimate" && preview.matchedCrewCount > 0 && assignmentInsert.length === 0) {
      return NextResponse.json(
        {
          message:
            "The importer matched crew, but could not attach them to created sub-calls. This usually means the imported time keys did not line up with the saved sub-call times.",
        },
        { status: 400 }
      );
    }

    if (assignmentInsert.length) {
      let assignmentsRes = await admin
        .from("assignments")
        .upsert(assignmentInsert, { onConflict: "sub_call_id,crew_id" })
        .select("id, sub_call_id, crew_id, status, sort_order");
      if (assignmentsRes.error && assignmentsRes.error.message.includes("sort_order")) {
        assignmentsRes = await admin
          .from("assignments")
          .upsert(assignmentInsert.map(({ sort_order: _sort_order, ...row }) => row), { onConflict: "sub_call_id,crew_id" })
          .select("id, sub_call_id, crew_id, status") as typeof assignmentsRes;
      }
      if (assignmentsRes.error) {
        return NextResponse.json({ message: assignmentsRes.error.message }, { status: 400 });
      }
      assignmentRows = (assignmentsRes.data ?? []) as AssignmentRow[];
    }

    const finalSubCallsRes = await admin
      .from("sub_calls")
      .select("id, labor_day_id, area, po_number, sub_call_group_id, role_name, message_rate, start_time, end_time, crew_needed, notes, day_type")
      .in("labor_day_id", allLaborDays.map((row) => row.id))
      .order("start_time", { ascending: true });

    if (finalSubCallsRes.error) {
      return NextResponse.json({ message: finalSubCallsRes.error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message:
        mode === "merge"
          ? `Merged import into ${showRow.name}. Added ${createdLaborDays.length} labor days, ${createdSubCalls.length} sub-calls, updated ${updatedSubCallCount} existing sub-calls, and assigned ${assignmentRows.length} matched crew${preview.unmatchedCrewCount ? `, ${preview.unmatchedCrewCount} unmatched` : ""}.`
          : preview.importFormat === "estimate"
            ? `Imported estimate for ${showRow.name}. Created ${allLaborDays.length} labor days and ${existingSubCalls.length + createdSubCalls.length} sub-calls. No crew were assigned and no messages were queued.`
            : `Imported ${showRow.name}. Created ${allLaborDays.length} labor days, ${existingSubCalls.length + createdSubCalls.length} sub-calls, and assigned ${assignmentRows.length} matched crew${preview.unmatchedCrewCount ? `, ${preview.unmatchedCrewCount} unmatched` : ""}.`,
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
