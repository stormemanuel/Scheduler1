import { createRequire } from "node:module";
import { buildImportedEventPayload, normalizeMatchValue, normalizePhoneForMatch, parseImportedEventFile, type ImportedCrewRow, type ImportedEventData } from "@/lib/event-import";

type ShowOverrides = Partial<ImportedEventData["show"]>;

type CrewLookupRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email?: string | null;
  city_pool_id?: string | null;
  group_name?: string | null;
};

type CrewMatchCandidate = {
  crew_id: string;
  name: string;
  confidence: number;
  reason: string;
};

type ResolvedCrewMatch =
  | {
      status: "matched";
      crew_id: string;
      name: string;
      confidence: number;
      reason: string;
      candidates: CrewMatchCandidate[];
    }
  | {
      status: "unmatched";
      importedName: string;
      reason: string;
      candidates: CrewMatchCandidate[];
    };

type ExistingImportShowMatch = {
  id: string;
  name: string;
  show_reference_number?: string | null;
  client?: string | null;
  venue?: string | null;
  event_location?: string | null;
  show_start?: string | null;
  show_end?: string | null;
  match_type: "show_reference_number" | "reference_client" | "event_client_dates" | "event_venue_dates";
  confidence: "strong" | "possible";
};

export type ImportComparisonChange = {
  id: string;
  kind: "new" | "changed" | "removed" | "unchanged";
  category:
    | "new_labor_day"
    | "new_booth_area"
    | "new_sub_call"
    | "new_position"
    | "crew_count_increase"
    | "crew_count_decrease"
    | "time_change"
    | "po_change"
    | "booth_update"
    | "rate_change"
    | "removed_labor"
    | "unchanged";
  title: string;
  detail: string;
  importedIndex?: number;
  importedKey?: string;
  existingSubCallId?: string;
  selectedDefault: boolean;
  warning?: string;
  fields?: Record<string, { existing: string | number | null; imported: string | number | null }>;
};

export type ImportComparison = {
  existingEvent: ExistingImportShowMatch;
  summary: {
    newLaborDays: number;
    newSubCalls: number;
    newPositions: number;
    crewCountIncreases: number;
    crewCountDecreases: number;
    timeChanges: number;
    poChanges: number;
    boothUpdates: number;
    rateChanges: number;
    removedLabor: number;
    unchanged: number;
  };
  changes: ImportComparisonChange[];
};

export type ImportPreview = {
  parsed: ImportedEventData;
  payload: ReturnType<typeof buildImportedEventPayload>;
  needsReview: string[];
  importDebug?: ImportedEventData["importDebug"];
  importFormat: "crew_list" | "estimate";
  clientMatch: { status: "matched" | "none" | "multiple"; name?: string; id?: string; candidates?: string[] };
  matchedCrewCount: number;
  unmatchedCrewCount: number;
  existingEventMatch?: ExistingImportShowMatch | null;
  comparison?: ImportComparison | null;
  subCallPreview: Array<{
    key: string;
    labor_date: string;
    area: string;
    role_name: string;
    start_time: string;
    end_time: string;
    crew_needed: number;
    po_number?: string | null;
    sub_call_reference_number?: string | null;
    message_rate?: string | null;
    day_type?: string | null;
    reviewFlags?: string[];
    matchedCrew: Array<{ name: string; crew_id: string; importedName: string; confidence: number; reason: string }>;
    unmatchedCrew: string[];
  }>;
};

type ImportedPayload = ReturnType<typeof buildImportedEventPayload>;
type ImportedSubCall = ImportedPayload["subCallGroups"][number];
type ExistingShowRow = {
  id: string;
  name: string | null;
  show_reference_number?: string | null;
  client?: string | null;
  venue?: string | null;
  event_location?: string | null;
  show_start?: string | null;
  show_end?: string | null;
};
type ExistingLaborDayRow = { id: string; show_id: string; labor_date: string; label?: string | null; notes?: string | null };
type ExistingSubCallRow = {
  id: string;
  labor_day_id: string;
  area?: string | null;
  po_number?: string | null;
  role_name?: string | null;
  message_rate?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  crew_needed?: number | null;
  notes?: string | null;
  day_type?: string | null;
};

const SUB_CALL_REFERENCE_MARKER_RE = /\[\[ELS_SUB_CALL_REFERENCE_NUMBER:([^\]]+)\]\]/i;

function normalizeTimeKey(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;
  return raw;
}

function subCallReferenceNumberFromNotes(notes: string | null | undefined) {
  return String(notes || "").match(SUB_CALL_REFERENCE_MARKER_RE)?.[1]?.trim() || "";
}

function normalizedDateOverlap(leftStart?: string | null, leftEnd?: string | null, rightStart?: string | null, rightEnd?: string | null) {
  const aStart = String(leftStart || "");
  const aEnd = String(leftEnd || leftStart || "");
  const bStart = String(rightStart || "");
  const bEnd = String(rightEnd || rightStart || "");
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart <= bEnd && bStart <= aEnd;
}

function normalizeArea(value: string | null | undefined) {
  return normalizeMatchValue(value || "")
    .replace(/^area\s+/, "")
    .replace(/\bbooth\b/g, "")
    .replace(/\btbd\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePoNumber(value: string | null | undefined) {
  const cleaned = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("PO") ? cleaned : `PO${cleaned}`;
}

function normalizeRate(value: string | number | null | undefined) {
  const clean = String(value ?? "").replace(/[^0-9.]/g, "");
  return clean ? Number(clean).toFixed(2) : "";
}

function normalizeClientNameForMatch(value: string | null | undefined) {
  const normalized = normalizeMatchValue(String(value || ""))
    .replace(/\b(?:llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|limited|pllc|lp|llp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.length % 2 === 0) {
    const half = parts.length / 2;
    const left = parts.slice(0, half).join(" ");
    const right = parts.slice(half).join(" ");
    if (left === right) return left;
  }
  return normalized;
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined) {
  return `${normalizeTimeKey(start) || "TBD"}-${normalizeTimeKey(end) || "TBD"}`;
}

function importedCallKey(call: ImportedSubCall, index: number) {
  return `import-${index}-${[call.labor_date, call.area, call.sub_call_reference_number || "", call.role_name, call.start_time, call.end_time || ""].map((part) => normalizeMatchValue(String(part || ""))).join("-")}`;
}

function existingSubCallReference(row: ExistingSubCallRow) {
  return subCallReferenceNumberFromNotes(row.notes) || "";
}

function normalizeReferenceValue(value: string | null | undefined) {
  return normalizeMatchValue(value || "");
}

function poDayIdentity(parts: { labor_date?: string | null; po_number?: string | null; role_name?: string | null }) {
  const po = normalizePoNumber(parts.po_number);
  if (!po) return "";
  return [parts.labor_date || "", po, normalizeMatchValue(parts.role_name || "")].join("|");
}

function comparableIdentity(parts: { labor_date?: string | null; area?: string | null; reference?: string | null; role_name?: string | null }) {
  return [
    parts.labor_date || "",
    normalizeArea(parts.area || ""),
    normalizeMatchValue(parts.reference || ""),
    normalizeMatchValue(parts.role_name || ""),
  ].join("|");
}

function logicalIdentity(parts: { area?: string | null; reference?: string | null; role_name?: string | null }) {
  return [
    normalizeArea(parts.area || ""),
    normalizeMatchValue(parts.reference || ""),
    normalizeMatchValue(parts.role_name || ""),
  ].join("|");
}

function existingChangeValue(row: ExistingSubCallRow, laborDate: string) {
  return {
    labor_date: laborDate,
    area: row.area || "",
    reference: existingSubCallReference(row),
    po_number: row.po_number || "",
    role_name: row.role_name || "",
    start_time: normalizeTimeKey(row.start_time),
    end_time: normalizeTimeKey(row.end_time),
    crew_needed: Number(row.crew_needed || 1),
    message_rate: normalizeRate(row.message_rate),
    day_type: row.day_type || "full_day",
  };
}

function importedChangeValue(call: ImportedSubCall) {
  return {
    labor_date: call.labor_date,
    area: call.area || "",
    reference: call.sub_call_reference_number || "",
    po_number: call.po_number || "",
    role_name: call.role_name || "",
    start_time: normalizeTimeKey(call.start_time),
    end_time: normalizeTimeKey(call.end_time),
    crew_needed: Number(call.crew_needed || 1),
    message_rate: normalizeRate(call.message_rate),
    day_type: call.day_type || "full_day",
  };
}

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
};

async function renderPdfPageVisually(pageData: { getTextContent: (options?: Record<string, boolean>) => Promise<{ items: PdfTextItem[] }> }) {
  const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const rows = new Map<number, PdfTextItem[]>();

  for (const item of textContent.items ?? []) {
    const text = String(item.str || "").trim();
    if (!text) continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const y = Math.round(Number(transform[5] || 0) / 3) * 3;
    const row = rows.get(y) ?? [];
    row.push(item);
    rows.set(y, row);
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, items]) =>
      items
        .sort((a, b) => Number(a.transform?.[4] || 0) - Number(b.transform?.[4] || 0))
        .map((item) => String(item.str || "").trim())
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean)
    .join("\n");
}

export async function readImportFileText(file: File) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const buffer = Buffer.from(await file.arrayBuffer());

    // Import the parser implementation directly instead of the pdf-parse package
    // entrypoint. The package entrypoint can execute its bundled debug/test path
    // in serverless builds and look for ./test/data/05-versions-space.pdf, which
    // causes PDF imports to fail on Vercel.
    const require = createRequire(import.meta.url);
    const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
      dataBuffer: Buffer,
      options?: { pagerender?: typeof renderPdfPageVisually }
    ) => Promise<{ text?: string }>;

    const parsed = await pdfParse(buffer, { pagerender: renderPdfPageVisually });
    return parsed.text || "";
  }
  return await file.text();
}

export function getImportOverrides(formData: FormData): ShowOverrides {
  return {
    name: String(formData.get("show_name") || "").trim() || undefined,
    show_reference_number: String(formData.get("show_reference_number") || "").trim() || undefined,
    client: String(formData.get("client") || "").trim() || undefined,
    venue: String(formData.get("venue") || "").trim() || undefined,
    event_location: String(formData.get("event_location") || "").trim() || undefined,
    rate_city: String(formData.get("rate_city") || "").trim() || undefined,
    show_start: String(formData.get("show_start") || "").trim() || undefined,
    show_end: String(formData.get("show_end") || "").trim() || undefined,
    notes: String(formData.get("notes") || "").trim() || undefined,
  };
}

async function resolveClientMatch(admin: { from: (table: string) => any }, clientName: string): Promise<ImportPreview["clientMatch"]> {
  const target = normalizeClientNameForMatch(clientName || "");
  if (!target) return { status: "none" };
  const res = await admin.from("business_clients").select("id, name").limit(1000);
  if (res.error) return { status: "none" };
  const matches = ((res.data ?? []) as Array<{ id: string; name?: string | null }>)
    .filter((row) => normalizeClientNameForMatch(row.name || "") === target);
  if (matches.length === 1) return { status: "matched", id: matches[0].id, name: matches[0].name || clientName };
  if (matches.length > 1) return { status: "multiple", candidates: matches.map((row) => row.name || row.id) };
  return { status: "none" };
}

async function findExistingEventMatch(admin: { from: (table: string) => any }, payload: ImportedPayload): Promise<ExistingImportShowMatch | null> {
  const show = payload.show;
  const reference = String(show.show_reference_number || "").trim();
  const client = normalizeMatchValue(show.client || "");
  const name = normalizeMatchValue(show.name || "");
  const venue = normalizeMatchValue(show.venue || "");
  const selectFields = "id, name, show_reference_number, client, venue, event_location, show_start, show_end";

  if (reference) {
    const byReference = await admin
      .from("shows")
      .select(selectFields)
      .eq("show_reference_number", reference)
      .limit(5);
    if (byReference.error) throw new Error(byReference.error.message);
    const rows = (byReference.data || []) as ExistingShowRow[];
    const exact = rows[0];
    if (exact) {
      return {
        id: exact.id,
        name: exact.name || show.name,
        show_reference_number: exact.show_reference_number,
        client: exact.client,
        venue: exact.venue,
        event_location: exact.event_location,
        show_start: exact.show_start,
        show_end: exact.show_end,
        match_type: rows.some((row) => normalizeMatchValue(row.client || "") === client) ? "reference_client" : "show_reference_number",
        confidence: "strong",
      };
    }
  }

  const candidatesRes = await admin
    .from("shows")
    .select(selectFields)
    .gte("show_end", show.show_start)
    .lte("show_start", show.show_end)
    .limit(100);
  if (candidatesRes.error) throw new Error(candidatesRes.error.message);
  const candidates = ((candidatesRes.data || []) as ExistingShowRow[]).filter((row) =>
    normalizedDateOverlap(row.show_start, row.show_end, show.show_start, show.show_end)
  );

  const byNameClient = candidates.find((row) => normalizeMatchValue(row.name || "") === name && normalizeMatchValue(row.client || "") === client);
  if (byNameClient) {
    return {
      id: byNameClient.id,
      name: byNameClient.name || show.name,
      show_reference_number: byNameClient.show_reference_number,
      client: byNameClient.client,
      venue: byNameClient.venue,
      event_location: byNameClient.event_location,
      show_start: byNameClient.show_start,
      show_end: byNameClient.show_end,
      match_type: "event_client_dates",
      confidence: "strong",
    };
  }

  const byNameVenue = candidates.find((row) => normalizeMatchValue(row.name || "") === name && normalizeMatchValue(row.venue || "") === venue);
  if (byNameVenue) {
    return {
      id: byNameVenue.id,
      name: byNameVenue.name || show.name,
      show_reference_number: byNameVenue.show_reference_number,
      client: byNameVenue.client,
      venue: byNameVenue.venue,
      event_location: byNameVenue.event_location,
      show_start: byNameVenue.show_start,
      show_end: byNameVenue.show_end,
      match_type: "event_venue_dates",
      confidence: "possible",
    };
  }

  return null;
}

export async function buildImportComparison(admin: { from: (table: string) => any }, payload: ImportedPayload, existingEvent: ExistingImportShowMatch): Promise<ImportComparison> {
  const daysRes = await admin
    .from("labor_days")
    .select("id, show_id, labor_date, label, notes")
    .eq("show_id", existingEvent.id)
    .order("labor_date", { ascending: true });
  if (daysRes.error) throw new Error(daysRes.error.message);

  const existingDays = (daysRes.data || []) as ExistingLaborDayRow[];
  const laborDateByDayId = new Map(existingDays.map((day) => [day.id, day.labor_date]));
  const existingDateSet = new Set(existingDays.map((day) => day.labor_date));
  const dayIds = existingDays.map((day) => day.id);
  const subCallsRes = dayIds.length
    ? await admin
        .from("sub_calls")
        .select("id, labor_day_id, area, po_number, role_name, message_rate, start_time, end_time, crew_needed, notes, day_type")
        .in("labor_day_id", dayIds)
    : { data: [], error: null };
  if (subCallsRes.error) throw new Error(subCallsRes.error.message);

  const existingSubCalls = (subCallsRes.data || []) as ExistingSubCallRow[];
  const existingByComparable = new Map<string, ExistingSubCallRow>();
  const existingByLogical = new Map<string, ExistingSubCallRow[]>();
  const existingByPoDay = new Map<string, ExistingSubCallRow>();
  const existingByPo = new Map<string, ExistingSubCallRow>();
  const importedComparableKeys = new Set<string>();
  const importedPoDayKeys = new Set<string>();

  for (const row of existingSubCalls) {
    const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
    const reference = existingSubCallReference(row);
    const comparable = comparableIdentity({ labor_date: laborDate, area: row.area, reference, role_name: row.role_name });
    const logical = logicalIdentity({ area: row.area, reference, role_name: row.role_name });
    const poDay = poDayIdentity({ labor_date: laborDate, po_number: row.po_number, role_name: row.role_name });
    const po = normalizePoNumber(row.po_number);
    if (!existingByComparable.has(comparable)) existingByComparable.set(comparable, row);
    existingByLogical.set(logical, [...(existingByLogical.get(logical) || []), row]);
    if (poDay && !existingByPoDay.has(poDay)) existingByPoDay.set(poDay, row);
    if (po && !existingByPo.has(po)) existingByPo.set(po, row);
  }

  const changes: ImportComparisonChange[] = [];
  const seenNewLaborDates = new Set<string>();
  const seenNewAreaKeys = new Set<string>();
  const seenNewPositionKeys = new Set<string>();

  payload.subCallGroups.forEach((call, index) => {
    const existingForPo = existingByPo.get(normalizePoNumber(call.po_number));
    if (existingForPo) {
      const canonicalReference = existingSubCallReference(existingForPo);
      if (existingForPo.area && normalizeArea(existingForPo.area) !== normalizeArea(call.area)) {
        call.area = existingForPo.area;
      }
      if (canonicalReference && normalizeReferenceValue(canonicalReference) !== normalizeReferenceValue(call.sub_call_reference_number)) {
        call.sub_call_reference_number = canonicalReference;
      }
    }
    const imported = importedChangeValue(call);
    const comparable = comparableIdentity({ labor_date: call.labor_date, area: call.area, reference: call.sub_call_reference_number, role_name: call.role_name });
    const importedPoDay = poDayIdentity({ labor_date: call.labor_date, po_number: call.po_number, role_name: call.role_name });
    importedComparableKeys.add(comparable);
    if (importedPoDay) importedPoDayKeys.add(importedPoDay);
    const importKey = importedCallKey(call, index);
    const exactish = (importedPoDay ? existingByPoDay.get(importedPoDay) : undefined) || existingByComparable.get(comparable);

    if (!existingDateSet.has(call.labor_date) && !seenNewLaborDates.has(call.labor_date)) {
      seenNewLaborDates.add(call.labor_date);
      changes.push({
        id: `new_labor_day:${index}:${call.labor_date}`,
        kind: "new",
        category: "new_labor_day",
        title: `New labor day: ${call.labor_date}`,
        detail: `Will add ${call.labor_date} and the estimate labor on that date.`,
        importedIndex: index,
        importedKey: importKey,
        selectedDefault: true,
      });
    }

    if (!exactish) {
      const samePoExisting = Boolean(existingForPo);
      const sameAreaOnDate = existingSubCalls.find((row) => {
        const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
        return laborDate === call.labor_date && normalizeArea(row.area) === normalizeArea(call.area);
      });
      const logicalMatches = existingByLogical.get(logicalIdentity({ area: call.area, reference: call.sub_call_reference_number, role_name: call.role_name })) || [];
      const areaKey = `${call.labor_date}|${normalizeArea(call.area)}|${normalizeMatchValue(call.sub_call_reference_number || "")}`;
      const positionKey = `${areaKey}|${normalizeMatchValue(call.role_name)}`;
      let category: ImportComparisonChange["category"] = "new_sub_call";
      let title = `New sub-call: ${call.area}`;
      if (samePoExisting && !seenNewPositionKeys.has(positionKey)) {
        seenNewPositionKeys.add(positionKey);
        category = "new_position";
        title = `New position under existing PO: ${call.role_name}`;
      } else if (!sameAreaOnDate && !seenNewAreaKeys.has(areaKey)) {
        seenNewAreaKeys.add(areaKey);
        category = "new_booth_area";
        title = `New area: ${call.area}`;
      } else if (sameAreaOnDate && !seenNewPositionKeys.has(positionKey)) {
        seenNewPositionKeys.add(positionKey);
        category = "new_position";
        title = `New position in existing area: ${call.role_name}`;
      } else if (logicalMatches.length) {
        title = `Add ${call.labor_date} to existing ${call.area} sub-call`;
      }
      changes.push({
        id: `new_sub_call:${index}`,
        kind: "new",
        category,
        title,
        detail: `${call.area} • ${call.role_name} • ${call.labor_date} • ${formatTimeRange(call.start_time, call.end_time)} • Qty ${call.crew_needed}`,
        importedIndex: index,
        importedKey: importKey,
        selectedDefault: true,
      });
      return;
    }

    const laborDate = laborDateByDayId.get(exactish.labor_day_id) || "";
    const existing = existingChangeValue(exactish, laborDate);
    const fieldChanges: ImportComparisonChange[] = [];

    if (existing.start_time !== imported.start_time || existing.end_time !== imported.end_time || existing.day_type !== imported.day_type) {
      fieldChanges.push({
        id: `time_change:${index}:${exactish.id}`,
        kind: "changed",
        category: "time_change",
        title: `Time change: ${call.area}`,
        detail: `${call.labor_date} • ${call.role_name} • ${formatTimeRange(existing.start_time, existing.end_time)} → ${formatTimeRange(imported.start_time, imported.end_time)}`,
        importedIndex: index,
        importedKey: importKey,
        existingSubCallId: exactish.id,
        selectedDefault: true,
        fields: { start_time: { existing: existing.start_time, imported: imported.start_time }, end_time: { existing: existing.end_time, imported: imported.end_time }, day_type: { existing: existing.day_type, imported: imported.day_type } },
      });
    }
    if (existing.po_number !== imported.po_number) {
      fieldChanges.push({
        id: `po_change:${index}:${exactish.id}`,
        kind: "changed",
        category: "po_change",
        title: `PO number changed: ${call.area}`,
        detail: `${existing.po_number || "No PO"} → ${imported.po_number || "No PO"}`,
        importedIndex: index,
        importedKey: importKey,
        existingSubCallId: exactish.id,
        selectedDefault: true,
        fields: { po_number: { existing: existing.po_number, imported: imported.po_number } },
      });
    }
    if (existing.reference !== imported.reference) {
      fieldChanges.push({
        id: `booth_update:${index}:${exactish.id}`,
        kind: "changed",
        category: "booth_update",
        title: `Booth number updated: ${call.area}`,
        detail: `${existing.reference || "TBD"} → ${imported.reference || "TBD"}`,
        importedIndex: index,
        importedKey: importKey,
        existingSubCallId: exactish.id,
        selectedDefault: true,
        fields: { sub_call_reference_number: { existing: existing.reference, imported: imported.reference } },
      });
    }
    if (existing.message_rate !== imported.message_rate) {
      fieldChanges.push({
        id: `rate_change:${index}:${exactish.id}`,
        kind: "changed",
        category: "rate_change",
        title: `Client rate changed: ${call.area}`,
        detail: `${existing.message_rate || "No rate"} → ${imported.message_rate || "No rate"}`,
        importedIndex: index,
        importedKey: importKey,
        existingSubCallId: exactish.id,
        selectedDefault: false,
        fields: { message_rate: { existing: existing.message_rate, imported: imported.message_rate } },
      });
    }
    if (existing.crew_needed !== imported.crew_needed) {
      const increase = imported.crew_needed > existing.crew_needed;
      fieldChanges.push({
        id: `${increase ? "crew_count_increase" : "crew_count_decrease"}:${index}:${exactish.id}`,
        kind: "changed",
        category: increase ? "crew_count_increase" : "crew_count_decrease",
        title: increase ? `Crew count increased: ${call.area}` : `Crew count decreased: ${call.area}`,
        detail: `${existing.crew_needed} → ${imported.crew_needed}${increase ? ` (+${imported.crew_needed - existing.crew_needed})` : ""}`,
        importedIndex: index,
        importedKey: importKey,
        existingSubCallId: exactish.id,
        selectedDefault: increase,
        warning: increase ? undefined : "Crew decreases are not selected by default. Review assigned crew before reducing requested count.",
        fields: { crew_needed: { existing: existing.crew_needed, imported: imported.crew_needed } },
      });
    }

    if (fieldChanges.length) changes.push(...fieldChanges);
    else {
      changes.push({
        id: `unchanged:${index}:${exactish.id}`,
        kind: "unchanged",
        category: "unchanged",
        title: `Unchanged: ${call.area}`,
        detail: `${call.labor_date} • ${call.role_name}`,
        importedIndex: index,
        importedKey: importKey,
        existingSubCallId: exactish.id,
        selectedDefault: false,
      });
    }
  });

  for (const row of existingSubCalls) {
    const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
    const comparable = comparableIdentity({ labor_date: laborDate, area: row.area, reference: existingSubCallReference(row), role_name: row.role_name });
    const poDay = poDayIdentity({ labor_date: laborDate, po_number: row.po_number, role_name: row.role_name });
    if (importedComparableKeys.has(comparable)) continue;
    if (poDay && importedPoDayKeys.has(poDay)) continue;
    changes.push({
      id: `removed_labor:${row.id}`,
      kind: "removed",
      category: "removed_labor",
      title: `Missing from updated quote: ${row.area || "Sub-call"}`,
      detail: `${laborDate} • ${row.role_name || "Role"} • ${formatTimeRange(row.start_time, row.end_time)} • Qty ${row.crew_needed || 1}`,
      existingSubCallId: row.id,
      selectedDefault: false,
      warning: "Kept by default. Removing labor must be reviewed separately so assigned crew and cancellation notices stay protected.",
    });
  }

  const summary = {
    newLaborDays: changes.filter((change) => change.category === "new_labor_day").length,
    newSubCalls: changes.filter((change) => change.category === "new_sub_call" || change.category === "new_booth_area").length,
    newPositions: changes.filter((change) => change.category === "new_position").length,
    crewCountIncreases: changes.filter((change) => change.category === "crew_count_increase").length,
    crewCountDecreases: changes.filter((change) => change.category === "crew_count_decrease").length,
    timeChanges: changes.filter((change) => change.category === "time_change").length,
    poChanges: changes.filter((change) => change.category === "po_change").length,
    boothUpdates: changes.filter((change) => change.category === "booth_update").length,
    rateChanges: changes.filter((change) => change.category === "rate_change").length,
    removedLabor: changes.filter((change) => change.category === "removed_labor").length,
    unchanged: changes.filter((change) => change.category === "unchanged").length,
  };

  return { existingEvent, summary, changes };
}

function splitNameTokens(value: string) {
  return normalizeMatchValue(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function nameVariants(value: string) {
  const normalized = normalizeMatchValue(value);
  const variants = new Set<string>();
  if (normalized) variants.add(normalized);

  const commaParts = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(",")
    .map((part) => normalizeMatchValue(part));

  if (commaParts.length >= 2 && commaParts[0] && commaParts[1]) {
    variants.add(`${commaParts[1]} ${commaParts[0]}`.trim());
  }

  const tokens = splitNameTokens(value);
  if (tokens.length >= 2) {
    variants.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
    variants.add(`${tokens[tokens.length - 1]} ${tokens[0]}`);
  }

  return [...variants].filter(Boolean);
}

function firstLast(tokens: string[]) {
  if (!tokens.length) return { first: "", last: "" };
  return { first: tokens[0] || "", last: tokens[tokens.length - 1] || "" };
}

function tokenLooksLikeInitial(token: string) {
  return token.length === 1;
}

function initialsCompatible(importedToken: string, crewToken: string) {
  if (!importedToken || !crewToken) return false;
  if (importedToken === crewToken) return true;
  if (tokenLooksLikeInitial(importedToken)) return crewToken.startsWith(importedToken);
  if (tokenLooksLikeInitial(crewToken)) return importedToken.startsWith(crewToken);
  return false;
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length];
}

function stringSimilarity(a: string, b: string) {
  const left = normalizeMatchValue(a);
  const right = normalizeMatchValue(b);
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const maxLength = Math.max(left.length, right.length);
  return maxLength ? 1 - levenshtein(left, right) / maxLength : 0;
}

function bestNameScore(importedName: string, crewName: string) {
  const importedVariants = nameVariants(importedName);
  const crewVariants = nameVariants(crewName);

  if (importedVariants.some((variant) => crewVariants.includes(variant))) return 1;

  const importedTokens = splitNameTokens(importedName);
  const crewTokens = splitNameTokens(crewName);
  const imported = firstLast(importedTokens);
  const crew = firstLast(crewTokens);

  const firstCompatible = initialsCompatible(imported.first, crew.first);
  const lastCompatible = initialsCompatible(imported.last, crew.last);

  if (firstCompatible && lastCompatible) {
    return tokenLooksLikeInitial(imported.first) || tokenLooksLikeInitial(crew.first) ? 0.92 : 0.97;
  }

  // Handle common middle-name differences: "John Christman" should match "John Jack Christman".
  if (imported.first === crew.first && imported.last === crew.last) return 0.97;

  const importedSet = new Set(importedTokens);
  const crewSet = new Set(crewTokens);
  const shared = importedTokens.filter((token) => crewSet.has(token)).length;
  const coverage = importedTokens.length ? shared / importedTokens.length : 0;
  if (coverage === 1 && importedTokens.length >= 2) return 0.9;

  const bestVariantSimilarity = Math.max(
    0,
    ...importedVariants.flatMap((importedVariant) => crewVariants.map((crewVariant) => stringSimilarity(importedVariant, crewVariant)))
  );

  return Math.max(bestVariantSimilarity, coverage * 0.86);
}

function importedNameHasEnoughSignal(name: string) {
  const tokens = splitNameTokens(name);
  return tokens.length >= 2 || tokens.some((token) => token.length >= 4);
}

function resolveCrewMember(importedRow: ImportedCrewRow, crewRows: CrewLookupRow[]): ResolvedCrewMatch {
  const importedPhone = normalizePhoneForMatch(importedRow.phone || "");
  const candidates: CrewMatchCandidate[] = [];

  if (importedPhone.length >= 7) {
    const phoneMatch = crewRows.find((crew) => normalizePhoneForMatch(crew.phone || "") === importedPhone);
    if (phoneMatch?.id) {
      return {
        status: "matched",
        crew_id: phoneMatch.id,
        name: phoneMatch.name || importedRow.name,
        confidence: 1,
        reason: "phone",
        candidates: [],
      };
    }
  }

  if (!importedNameHasEnoughSignal(importedRow.name)) {
    return {
      status: "unmatched",
      importedName: importedRow.name,
      reason: "not_enough_name_signal",
      candidates: [],
    };
  }

  for (const crew of crewRows) {
    if (!crew.name) continue;
    const score = bestNameScore(importedRow.name, crew.name);
    if (score >= 0.72) {
      candidates.push({
        crew_id: crew.id,
        name: crew.name,
        confidence: Number(score.toFixed(2)),
        reason: score === 1 ? "exact_name" : score >= 0.9 ? "strong_name" : "possible_name",
      });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  const best = candidates[0];
  const second = candidates[1];

  const separation = best && second ? best.confidence - second.confidence : 1;
  const confidentEnough = Boolean(
    best &&
      (
        best.confidence >= 0.96 ||
        (best.confidence >= 0.9 && separation >= 0.04) ||
        (best.confidence >= 0.84 && separation >= 0.08)
      )
  );

  if (best && confidentEnough) {
    return {
      status: "matched",
      crew_id: best.crew_id,
      name: best.name,
      confidence: best.confidence,
      reason: best.reason,
      candidates: candidates.slice(0, 5),
    };
  }

  return {
    status: "unmatched",
    importedName: importedRow.name,
    reason: best ? "needs_review" : "no_match",
    candidates: candidates.slice(0, 5),
  };
}

export async function buildImportPreview(admin: { from: (table: string) => any }, file: File, overrides: ShowOverrides): Promise<ImportPreview> {
  const text = await readImportFileText(file);
  if (!text.trim()) {
    throw new Error("The uploaded file did not contain readable text.");
  }

  const parsed = parseImportedEventFile(file.name, text, overrides);
  const payload = buildImportedEventPayload(parsed);
  const importFormat = parsed.importFormat || parsed.show.import_format || "crew_list";
  const clientMatch = await resolveClientMatch(admin, payload.show.client);
  const existingEventMatch = importFormat === "estimate" ? await findExistingEventMatch(admin, payload) : null;
  const comparison = existingEventMatch ? await buildImportComparison(admin, payload, existingEventMatch) : null;

  const crewRows = importFormat === "estimate"
    ? []
    : await (async () => {
        const crewRes = await admin.from("crew").select("id, name, phone, email, city_pool_id, group_name");
        if (crewRes.error) throw new Error(crewRes.error.message);
        return ((crewRes.data ?? []) as CrewLookupRow[]).filter((row) => row.id && row.name);
      })();

  let matchedCrewCount = 0;
  let unmatchedCrewCount = 0;

  const subCallPreview = payload.subCallGroups.map((call) => {
    const matchedCrew: Array<{ name: string; crew_id: string; importedName: string; confidence: number; reason: string }> = [];
    const unmatchedCrew: string[] = [];
    const matchedIdsForCall = new Set<string>();

    for (const crewRow of call.crewRows) {
      const resolved = resolveCrewMember(crewRow, crewRows);

      if (resolved.status !== "matched") {
        unmatchedCrewCount += 1;
        const topCandidates = resolved.candidates.length
          ? ` (possible: ${resolved.candidates.map((candidate) => candidate.name).join(", ")})`
          : "";
        unmatchedCrew.push(`${crewRow.name}${topCandidates}`);
        continue;
      }

      if (matchedIdsForCall.has(resolved.crew_id)) continue;
      matchedIdsForCall.add(resolved.crew_id);
      matchedCrewCount += 1;
      matchedCrew.push({
        name: resolved.name,
        crew_id: resolved.crew_id,
        importedName: crewRow.name,
        confidence: resolved.confidence,
        reason: resolved.reason,
      });
    }

    return {
      key: [call.labor_date, call.area, call.role_name, call.start_time, call.end_time || ""].join("|"),
      labor_date: call.labor_date,
      area: call.area,
      role_name: call.role_name,
      start_time: call.start_time,
      end_time: call.end_time,
      crew_needed: call.crew_needed,
      po_number: call.po_number || null,
      sub_call_reference_number: call.sub_call_reference_number || null,
      message_rate: call.message_rate || null,
      day_type: call.day_type || null,
      reviewFlags: [...new Set(call.crewRows.flatMap((row) => row.reviewFlags || []))],
      matchedCrew,
      unmatchedCrew,
    };
  });

  return {
    parsed,
    payload,
    needsReview: [...new Set(parsed.needsReview || [])],
    importDebug: parsed.importDebug,
    importFormat,
    clientMatch,
    matchedCrewCount,
    unmatchedCrewCount,
    existingEventMatch,
    comparison,
    subCallPreview,
  };
}
