import { createRequire } from "node:module";
import { buildImportedEventPayload, normalizeImportedRoleName, normalizeMatchValue, normalizePhoneForMatch, parseImportedEventFile, type ImportedCrewRow, type ImportedEventData } from "@/lib/event-import";

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
  match_type: "selected_event" | "show_reference_number" | "reference_client" | "event_client_dates" | "event_venue_dates";
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
    | "needs_review"
    | "unchanged";
  title: string;
  detail: string;
  importedIndex?: number;
  importedKey?: string;
  existingSubCallId?: string;
  selectedDefault: boolean;
  warning?: string;
  matchReason?: string;
  fields?: Record<string, { existing: string | number | null; imported: string | number | null }>;
};

export type ImportAreaMatch = {
  importedAreaKey: string;
  importedAreaName: string;
  importedIndexes: number[];
  areaMatchStatus: "matched" | "new" | "needs_review";
  matchedAreaName: string | null;
  matchedAreaKey: string | null;
  matchedPo: string | null;
  matchedSubCallIds: string[];
  matchReason: string;
  matchConfidence: "strong" | "possible" | "none";
  candidateAreaNames?: string[];
};

export type ImportComparison = {
  existingEvent: ExistingImportShowMatch;
  summary: {
    matchedAreas: number;
    newAreas: number;
    newLaborDays: number;
    newSubCalls: number;
    newPositions: number;
    crewCountIncreases: number;
    crewCountDecreases: number;
    timeChanges: number;
    poChanges: number;
    boothUpdates: number;
    rateChanges: number;
    needsReview: number;
    removedLabor: number;
    unchanged: number;
  };
  areaMatches: ImportAreaMatch[];
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

function normalizeRoleNameForMatch(value: string | null | undefined) {
  return normalizeMatchValue(normalizeImportedRoleName(value));
}

function importedCallKey(call: ImportedSubCall, index: number) {
  return `import-${index}-${[call.labor_date, call.area, call.sub_call_reference_number || "", normalizeImportedRoleName(call.role_name), call.start_time, call.end_time || ""].map((part) => normalizeMatchValue(String(part || ""))).join("-")}`;
}

function existingSubCallReference(row: ExistingSubCallRow) {
  return subCallReferenceNumberFromNotes(row.notes) || "";
}

function normalizeReferenceValue(value: string | null | undefined) {
  return normalizeMatchValue(value || "");
}

function normalizeBoothValue(value: string | null | undefined) {
  const normalized = normalizeMatchValue(value || "");
  if (!normalized) return "";
  if (/\b(?:tbd|to be determined|unknown)\b/.test(normalized)) return "tbd";
  if (/^ro\s*[a-z0-9-]+$/.test(normalized)) return "";
  return normalized
    .replace(/\b(?:booth|number|no)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boothMatchStrength(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeBoothValue(left);
  const b = normalizeBoothValue(right);
  if (a && b && a === b) return "exact" as const;
  if ((a === "tbd" && b) || (b === "tbd" && a) || (!a && b) || (a && !b)) return "partial" as const;
  if (!a && !b) return "missing" as const;
  return "conflict" as const;
}

function areaSimilarityScore(left: string | null | undefined, right: string | null | undefined) {
  const a = normalizeArea(left);
  const b = normalizeArea(right);
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  const jaccard = shared / union;
  const subset = shared === Math.min(aTokens.size, bTokens.size) ? 0.9 : 0;
  return Math.max(jaccard, subset, stringSimilarity(a, b));
}

function isSimilarArea(left: string | null | undefined, right: string | null | undefined) {
  return areaSimilarityScore(left, right) >= 0.78;
}

function poDayIdentity(parts: { labor_date?: string | null; po_number?: string | null; role_name?: string | null }) {
  const po = normalizePoNumber(parts.po_number);
  if (!po) return "";
  return [parts.labor_date || "", po, normalizeRoleNameForMatch(parts.role_name)].join("|");
}

function comparableIdentity(parts: { labor_date?: string | null; area?: string | null; reference?: string | null; role_name?: string | null }) {
  return [
    parts.labor_date || "",
    normalizeArea(parts.area || ""),
    normalizeMatchValue(parts.reference || ""),
    normalizeRoleNameForMatch(parts.role_name),
  ].join("|");
}

function logicalIdentity(parts: { area?: string | null; reference?: string | null; role_name?: string | null }) {
  return [
    normalizeArea(parts.area || ""),
    normalizeMatchValue(parts.reference || ""),
    normalizeRoleNameForMatch(parts.role_name),
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
    role_name: normalizeImportedRoleName(call.role_name),
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

async function findExistingEventById(admin: { from: (table: string) => any }, showId: string): Promise<ExistingImportShowMatch | null> {
  const cleanId = String(showId || "").trim();
  if (!cleanId) return null;
  const res = await admin
    .from("shows")
    .select("id, name, show_reference_number, client, venue, event_location, show_start, show_end")
    .eq("id", cleanId)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  const row = res.data as ExistingShowRow | null;
  if (!row?.id) return null;
  return {
    id: row.id,
    name: row.name || "Selected event",
    show_reference_number: row.show_reference_number,
    client: row.client,
    venue: row.venue,
    event_location: row.event_location,
    show_start: row.show_start,
    show_end: row.show_end,
    match_type: "selected_event",
    confidence: "strong",
  };
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

  type ExistingAreaGroup = {
    key: string;
    name: string;
    rows: ExistingSubCallRow[];
    normalizedPos: Set<string>;
    normalizedBooths: Set<string>;
  };
  type ImportedAreaGroup = {
    key: string;
    name: string;
    rows: Array<{ call: ImportedSubCall; index: number }>;
    normalizedPos: Set<string>;
    normalizedBooths: Set<string>;
  };

  const existingAreaGroups = new Map<string, ExistingAreaGroup>();
  const existingAreaKeyBySubCallId = new Map<string, string>();
  const existingAreaKeysByPo = new Map<string, Set<string>>();

  for (const row of existingSubCalls) {
    const areaKey = normalizeArea(row.area) || `unknown:${row.id}`;
    const group = existingAreaGroups.get(areaKey) || {
      key: areaKey,
      name: String(row.area || "Area TBD").trim() || "Area TBD",
      rows: [],
      normalizedPos: new Set<string>(),
      normalizedBooths: new Set<string>(),
    };
    group.rows.push(row);
    const po = normalizePoNumber(row.po_number);
    if (po) {
      group.normalizedPos.add(po);
      const keys = existingAreaKeysByPo.get(po) || new Set<string>();
      keys.add(areaKey);
      existingAreaKeysByPo.set(po, keys);
    }
    const booth = normalizeBoothValue(existingSubCallReference(row));
    if (booth) group.normalizedBooths.add(booth);
    existingAreaGroups.set(areaKey, group);
    existingAreaKeyBySubCallId.set(row.id, areaKey);
  }

  const importedAreaGroups = new Map<string, ImportedAreaGroup>();
  payload.subCallGroups.forEach((call, index) => {
    call.role_name = normalizeImportedRoleName(call.role_name);
    const normalizedArea = normalizeArea(call.area);
    const fallbackIdentity = normalizePoNumber(call.po_number) || normalizeBoothValue(call.sub_call_reference_number) || String(index);
    const areaKey = normalizedArea || `unknown:${fallbackIdentity}`;
    const group = importedAreaGroups.get(areaKey) || {
      key: areaKey,
      name: String(call.area || "Area TBD").trim() || "Area TBD",
      rows: [],
      normalizedPos: new Set<string>(),
      normalizedBooths: new Set<string>(),
    };
    group.rows.push({ call, index });
    const po = normalizePoNumber(call.po_number);
    if (po) group.normalizedPos.add(po);
    const booth = normalizeBoothValue(call.sub_call_reference_number);
    if (booth) group.normalizedBooths.add(booth);
    importedAreaGroups.set(areaKey, group);
  });

  function sharedCount(left: Set<string>, right: Set<string>) {
    let count = 0;
    for (const value of left) if (right.has(value)) count += 1;
    return count;
  }

  function areaMatchForGroup(group: ImportedAreaGroup): ImportAreaMatch {
    const exactPoAreaKeys = new Set<string>();
    for (const po of group.normalizedPos) {
      for (const areaKey of existingAreaKeysByPo.get(po) || []) exactPoAreaKeys.add(areaKey);
    }

    if (exactPoAreaKeys.size === 1) {
      const matchedKey = [...exactPoAreaKeys][0];
      const matched = existingAreaGroups.get(matchedKey)!;
      const score = areaSimilarityScore(group.name, matched.name);
      const exactArea = normalizeArea(group.name) === normalizeArea(matched.name);
      return {
        importedAreaKey: group.key,
        importedAreaName: group.name,
        importedIndexes: group.rows.map((row) => row.index),
        areaMatchStatus: "matched",
        matchedAreaName: matched.name,
        matchedAreaKey: matched.key,
        matchedPo: [...group.normalizedPos].find((po) => matched.normalizedPos.has(po)) || null,
        matchedSubCallIds: matched.rows.map((row) => row.id),
        matchReason: exactArea
          ? "Exact normalized Area and exact PO."
          : score >= 0.78
            ? "Exact PO and similar Area name."
            : "Exact PO already belongs to this existing Area.",
        matchConfidence: "strong",
      };
    }

    if (exactPoAreaKeys.size > 1) {
      const possible = [...exactPoAreaKeys].map((key) => existingAreaGroups.get(key)?.name).filter(Boolean).join(", ");
      return {
        importedAreaKey: group.key,
        importedAreaName: group.name,
        importedIndexes: group.rows.map((row) => row.index),
        areaMatchStatus: "needs_review",
        matchedAreaName: possible || null,
        matchedAreaKey: null,
        matchedPo: [...group.normalizedPos][0] || null,
        matchedSubCallIds: [],
        matchReason: "The imported PO is already used by more than one existing Area. Choose the correct Area before applying.",
        matchConfidence: "possible",
        candidateAreaNames: [...exactPoAreaKeys].map((key) => existingAreaGroups.get(key)?.name).filter((name): name is string => Boolean(name)),
      };
    }

    const exactAreaKey = normalizeArea(group.name);
    const exactArea = exactAreaKey ? existingAreaGroups.get(exactAreaKey) : undefined;
    if (exactArea) {
      const boothShared = sharedCount(group.normalizedBooths, exactArea.normalizedBooths);
      const boothConflict = Boolean(group.normalizedBooths.size && exactArea.normalizedBooths.size && boothShared === 0
        && !group.normalizedBooths.has("tbd") && !exactArea.normalizedBooths.has("tbd"));
      const importedPos = [...group.normalizedPos];
      const existingPos = [...exactArea.normalizedPos];
      const poConflict = Boolean(importedPos.length && existingPos.length && !importedPos.some((po) => exactArea.normalizedPos.has(po)));

      // Same Area name is still Area identity. A different PO can be a valid new child Sub-Call,
      // but a simultaneous booth conflict is suspicious enough to require review.
      if (boothConflict && poConflict) {
        return {
          importedAreaKey: group.key,
          importedAreaName: group.name,
          importedIndexes: group.rows.map((row) => row.index),
          areaMatchStatus: "needs_review",
          matchedAreaName: exactArea.name,
          matchedAreaKey: exactArea.key,
          matchedPo: null,
          matchedSubCallIds: exactArea.rows.map((row) => row.id),
          matchReason: "Exact normalized Area name, but both booth and PO conflict with the existing Area.",
          matchConfidence: "possible",
          candidateAreaNames: [exactArea.name],
        };
      }

      return {
        importedAreaKey: group.key,
        importedAreaName: group.name,
        importedIndexes: group.rows.map((row) => row.index),
        areaMatchStatus: "matched",
        matchedAreaName: exactArea.name,
        matchedAreaKey: exactArea.key,
        matchedPo: importedPos.find((po) => exactArea.normalizedPos.has(po)) || null,
        matchedSubCallIds: exactArea.rows.map((row) => row.id),
        matchReason: boothShared ? "Exact normalized Area and exact booth." : "Exact normalized Area name.",
        matchConfidence: "strong",
      };
    }

    const candidates = [...existingAreaGroups.values()]
      .map((candidate) => {
        const areaScore = areaSimilarityScore(group.name, candidate.name);
        const boothShared = sharedCount(group.normalizedBooths, candidate.normalizedBooths);
        const boothPartial = [...group.normalizedBooths].some((booth) => booth === "tbd") || [...candidate.normalizedBooths].some((booth) => booth === "tbd");
        const poShared = sharedCount(group.normalizedPos, candidate.normalizedPos);
        return { candidate, areaScore, boothShared, boothPartial, poShared };
      })
      .filter((row) => row.areaScore >= 0.78)
      .sort((a, b) => b.poShared - a.poShared || b.boothShared - a.boothShared || b.areaScore - a.areaScore);

    const confirmed = candidates.filter((row) => row.poShared > 0 || row.boothShared > 0);
    if (confirmed.length === 1) {
      const best = confirmed[0];
      return {
        importedAreaKey: group.key,
        importedAreaName: group.name,
        importedIndexes: group.rows.map((row) => row.index),
        areaMatchStatus: "matched",
        matchedAreaName: best.candidate.name,
        matchedAreaKey: best.candidate.key,
        matchedPo: [...group.normalizedPos].find((po) => best.candidate.normalizedPos.has(po)) || null,
        matchedSubCallIds: best.candidate.rows.map((row) => row.id),
        matchReason: best.poShared > 0
          ? "Exact PO and similar Area name."
          : "Exact booth and similar Area name.",
        matchConfidence: "strong",
      };
    }

    if (confirmed.length > 1) {
      return {
        importedAreaKey: group.key,
        importedAreaName: group.name,
        importedIndexes: group.rows.map((row) => row.index),
        areaMatchStatus: "needs_review",
        matchedAreaName: confirmed.map((row) => row.candidate.name).join(", "),
        matchedAreaKey: null,
        matchedPo: null,
        matchedSubCallIds: [],
        matchReason: "Multiple existing Areas have similar names and matching booth/PO signals. Choose the correct Area before applying.",
        matchConfidence: "possible",
        candidateAreaNames: confirmed.map((row) => row.candidate.name),
      };
    }

    if (candidates.length === 1) {
      const best = candidates[0];
      return {
        importedAreaKey: group.key,
        importedAreaName: group.name,
        importedIndexes: group.rows.map((row) => row.index),
        areaMatchStatus: "needs_review",
        matchedAreaName: best.candidate.name,
        matchedAreaKey: best.candidate.key,
        matchedPo: null,
        matchedSubCallIds: best.candidate.rows.map((row) => row.id),
        matchReason: "Similar Area name found, but booth/PO did not safely confirm the match.",
        matchConfidence: "possible",
        candidateAreaNames: [best.candidate.name],
      };
    }

    if (candidates.length > 1) {
      return {
        importedAreaKey: group.key,
        importedAreaName: group.name,
        importedIndexes: group.rows.map((row) => row.index),
        areaMatchStatus: "needs_review",
        matchedAreaName: candidates.slice(0, 3).map((row) => row.candidate.name).join(", "),
        matchedAreaKey: null,
        matchedPo: null,
        matchedSubCallIds: [],
        matchReason: "Multiple existing Areas have similar names. Choose the correct Area before applying.",
        matchConfidence: "possible",
        candidateAreaNames: candidates.slice(0, 3).map((row) => row.candidate.name),
      };
    }

    return {
      importedAreaKey: group.key,
      importedAreaName: group.name,
      importedIndexes: group.rows.map((row) => row.index),
      areaMatchStatus: "new",
      matchedAreaName: null,
      matchedAreaKey: null,
      matchedPo: null,
      matchedSubCallIds: [],
      matchReason: "No safe existing Area match found.",
      matchConfidence: "none",
    };
  }

  const areaMatches = [...importedAreaGroups.values()]
    .map(areaMatchForGroup)
    .sort((a, b) => Math.min(...a.importedIndexes) - Math.min(...b.importedIndexes));
  const areaMatchByImportedIndex = new Map<number, ImportAreaMatch>();
  for (const match of areaMatches) {
    for (const index of match.importedIndexes) areaMatchByImportedIndex.set(index, match);
  }

  // Canonicalize only the Area display name after Stage A succeeds. Do NOT replace the imported
  // booth/reference here: a real quote update such as Booth TBD -> 2939 must remain visible as a diff.
  for (const match of areaMatches) {
    if (match.areaMatchStatus !== "matched" || !match.matchedAreaName) continue;
    for (const index of match.importedIndexes) {
      const call = payload.subCallGroups[index];
      if (call) call.area = match.matchedAreaName;
    }
  }

  const existingByComparable = new Map<string, ExistingSubCallRow>();
  const existingByLogical = new Map<string, ExistingSubCallRow[]>();
  const existingByPoDay = new Map<string, ExistingSubCallRow>();
  const importedComparableKeys = new Set<string>();
  const importedPoDayKeys = new Set<string>();
  const matchedExistingSubCallIds = new Set<string>();

  for (const row of existingSubCalls) {
    const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
    const reference = existingSubCallReference(row);
    const comparable = comparableIdentity({ labor_date: laborDate, area: row.area, reference, role_name: row.role_name });
    const logical = logicalIdentity({ area: row.area, reference, role_name: row.role_name });
    const poDay = poDayIdentity({ labor_date: laborDate, po_number: row.po_number, role_name: row.role_name });
    if (!existingByComparable.has(comparable)) existingByComparable.set(comparable, row);
    existingByLogical.set(logical, [...(existingByLogical.get(logical) || []), row]);
    if (poDay && !existingByPoDay.has(poDay)) existingByPoDay.set(poDay, row);
  }

  const changes: ImportComparisonChange[] = [];
  const seenNewLaborDates = new Set<string>();
  const seenNewAreaKeys = new Set<string>();
  const seenNewPositionKeys = new Set<string>();

  const findExistingRowWithinMatchedArea = (call: ImportedSubCall, index: number) => {
    const areaMatch = areaMatchByImportedIndex.get(index);
    if (!areaMatch || areaMatch.areaMatchStatus !== "matched" || !areaMatch.matchedAreaKey) return null;

    const importedPo = normalizePoNumber(call.po_number);
    const importedReference = normalizeReferenceValue(call.sub_call_reference_number);
    const importedRole = normalizeRoleNameForMatch(call.role_name);
    const candidateRows = existingSubCalls.filter((row) => existingAreaKeyBySubCallId.get(row.id) === areaMatch.matchedAreaKey);

    const sameDateRole = candidateRows.filter((row) => {
      const laborDate = laborDateByDayId.get(row.labor_day_id) || "";
      return laborDate === call.labor_date && normalizeRoleNameForMatch(row.role_name) === importedRole;
    });
    if (!sameDateRole.length) return null;

    const ranked = sameDateRole.map((row) => {
      const existingPo = normalizePoNumber(row.po_number);
      const existingReference = normalizeReferenceValue(existingSubCallReference(row));
      const poExact = Boolean(importedPo && existingPo && importedPo === existingPo);
      const boothStrength = boothMatchStrength(existingReference, importedReference);
      const existing = existingChangeValue(row, call.labor_date);
      const sameTime = existing.start_time === normalizeTimeKey(call.start_time) && existing.end_time === normalizeTimeKey(call.end_time);
      const score = (poExact ? 100 : 0)
        + (boothStrength === "exact" ? 30 : boothStrength === "partial" || boothStrength === "missing" ? 10 : 0)
        + (sameTime ? 20 : 0);
      return { row, poExact, boothStrength, sameTime, score };
    }).sort((a, b) => b.score - a.score);

    const poMatches = ranked.filter((candidate) => candidate.poExact);
    if (poMatches.length === 1) {
      return { row: poMatches[0].row, reason: "Matched position/date inside the existing Area by exact PO." };
    }
    if (poMatches.length > 1) {
      const sameTime = poMatches.filter((candidate) => candidate.sameTime);
      if (sameTime.length === 1) return { row: sameTime[0].row, reason: "Matched position/date inside the existing Area by exact PO and time." };
      return { row: null, reason: "Multiple existing rows in the matched Area share this PO, date, and position.", reviewOnly: true as const };
    }

    const exactBooth = ranked.filter((candidate) => candidate.boothStrength === "exact");
    if (exactBooth.length === 1) {
      return { row: exactBooth[0].row, reason: "Matched position/date inside the existing Area by exact booth." };
    }

    if (ranked.length === 1) {
      const only = ranked[0];
      const existingPo = normalizePoNumber(only.row.po_number);
      const incompatiblePo = Boolean(importedPo && existingPo && importedPo !== existingPo);
      const boothConflict = only.boothStrength === "conflict";
      if (!incompatiblePo && !boothConflict) {
        return { row: only.row, reason: "Matched position/date inside the already matched Area." };
      }
    }

    return null;
  };

  payload.subCallGroups.forEach((call, index) => {
    const areaMatch = areaMatchByImportedIndex.get(index);
    const imported = importedChangeValue(call);
    const comparable = comparableIdentity({ labor_date: call.labor_date, area: call.area, reference: call.sub_call_reference_number, role_name: call.role_name });
    const importedPoDay = poDayIdentity({ labor_date: call.labor_date, po_number: call.po_number, role_name: call.role_name });
    importedComparableKeys.add(comparable);
    if (importedPoDay) importedPoDayKeys.add(importedPoDay);
    const importKey = importedCallKey(call, index);

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

    if (areaMatch?.areaMatchStatus === "needs_review") {
      changes.push({
        id: `needs_review:${index}`,
        kind: "new",
        category: "needs_review",
        title: `Needs Area match review: ${areaMatch.importedAreaName}`,
        detail: `${areaMatch.importedAreaName} • ${call.role_name} • ${call.labor_date} • ${formatTimeRange(call.start_time, call.end_time)} • Qty ${call.crew_needed}`,
        importedIndex: index,
        importedKey: importKey,
        selectedDefault: false,
        warning: areaMatch.matchReason,
        matchReason: areaMatch.matchReason,
      });
      return;
    }

    let exactish: ExistingSubCallRow | undefined;
    let rowMatchReason = "";
    if (areaMatch?.areaMatchStatus === "matched") {
      const scoped = findExistingRowWithinMatchedArea(call, index);
      if (scoped?.reviewOnly) {
        changes.push({
          id: `needs_review:${index}`,
          kind: "new",
          category: "needs_review",
          title: `Needs position match review: ${call.area}`,
          detail: `${call.area} • ${call.role_name} • ${call.labor_date} • ${formatTimeRange(call.start_time, call.end_time)} • Qty ${call.crew_needed}`,
          importedIndex: index,
          importedKey: importKey,
          selectedDefault: false,
          warning: scoped.reason,
          matchReason: `${areaMatch.matchReason} ${scoped.reason}`.trim(),
        });
        return;
      }
      exactish = scoped?.row || undefined;
      rowMatchReason = scoped?.reason || "";
    } else {
      // New Areas should not borrow a row from another Area merely because date + role happen to match.
      exactish = undefined;
    }

    if (!exactish) {
      const areaMatched = areaMatch?.areaMatchStatus === "matched";
      const areaKey = `${areaMatch?.matchedAreaKey || areaMatch?.importedAreaKey || normalizeArea(call.area)}|${normalizeMatchValue(call.sub_call_reference_number || "")}`;
      const positionKey = `${areaKey}|${call.labor_date}|${normalizeRoleNameForMatch(call.role_name)}|${normalizePoNumber(call.po_number)}`;
      let category: ImportComparisonChange["category"] = "new_sub_call";
      let title = `New sub-call: ${call.area}`;

      if (areaMatched && !seenNewPositionKeys.has(positionKey)) {
        seenNewPositionKeys.add(positionKey);
        category = "new_position";
        title = normalizePoNumber(call.po_number)
          ? `New position under existing Area/PO: ${call.role_name}`
          : `New position in existing Area: ${call.role_name}`;
      } else if (!areaMatched && !seenNewAreaKeys.has(areaKey)) {
        seenNewAreaKeys.add(areaKey);
        category = "new_booth_area";
        title = `New area: ${call.area}`;
      } else if (!seenNewPositionKeys.has(positionKey)) {
        seenNewPositionKeys.add(positionKey);
        category = "new_position";
        title = `New position: ${call.role_name}`;
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
        matchReason: areaMatch?.matchReason || undefined,
      });
      return;
    }

    const laborDate = laborDateByDayId.get(exactish.labor_day_id) || "";
    matchedExistingSubCallIds.add(exactish.id);
    const existing = existingChangeValue(exactish, laborDate);
    const fieldChanges: ImportComparisonChange[] = [];
    const matchReason = [areaMatch?.matchReason, rowMatchReason].filter(Boolean).join(" ");

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
        matchReason,
        fields: { start_time: { existing: existing.start_time, imported: imported.start_time }, end_time: { existing: existing.end_time, imported: imported.end_time }, day_type: { existing: existing.day_type, imported: imported.day_type } },
      });
    }
    if (normalizePoNumber(existing.po_number) !== normalizePoNumber(imported.po_number)) {
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
        matchReason,
        fields: { po_number: { existing: existing.po_number, imported: imported.po_number } },
      });
    }
    if (normalizeReferenceValue(existing.reference) !== normalizeReferenceValue(imported.reference)) {
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
        matchReason,
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
        matchReason,
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
        warning: increase ? undefined : "Crew decreases are not selected by default. Existing assigned crew are never removed by Quote Merge; manual review is required before lowering requested quantity.",
        matchReason,
        fields: { crew_needed: { existing: existing.crew_needed, imported: imported.crew_needed } },
      });
    }

    if (fieldChanges.length) changes.push(...fieldChanges);
    else {
      changes.push({
        id: `unchanged:${index}:${exactish.id}`,
        kind: "unchanged",
        category: "unchanged",
        title: `Existing / Unchanged: ${call.area}`,
        detail: `${call.labor_date} • ${call.role_name}`,
        importedIndex: index,
        importedKey: importKey,
        existingSubCallId: exactish.id,
        selectedDefault: false,
        matchReason,
      });
    }
  });

  for (const row of existingSubCalls) {
    if (matchedExistingSubCallIds.has(row.id)) continue;
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
      warning: "Kept by default. Quote Merge never deletes this existing labor, assigned crew, reminders, payroll relationships, or notes.",
    });
  }

  const summary = {
    matchedAreas: areaMatches.filter((match) => match.areaMatchStatus === "matched").length,
    newAreas: areaMatches.filter((match) => match.areaMatchStatus === "new").length,
    newLaborDays: changes.filter((change) => change.category === "new_labor_day").length,
    newSubCalls: changes.filter((change) => change.category === "new_sub_call" || change.category === "new_booth_area").length,
    newPositions: changes.filter((change) => change.category === "new_position").length,
    crewCountIncreases: changes.filter((change) => change.category === "crew_count_increase").length,
    crewCountDecreases: changes.filter((change) => change.category === "crew_count_decrease").length,
    timeChanges: changes.filter((change) => change.category === "time_change").length,
    poChanges: changes.filter((change) => change.category === "po_change").length,
    boothUpdates: changes.filter((change) => change.category === "booth_update").length,
    rateChanges: changes.filter((change) => change.category === "rate_change").length,
    needsReview: areaMatches.filter((match) => match.areaMatchStatus === "needs_review").length,
    removedLabor: changes.filter((change) => change.category === "removed_labor").length,
    unchanged: changes.filter((change) => change.category === "unchanged").length,
  };

  return { existingEvent, summary, areaMatches, changes };
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

export async function buildImportPreview(
  admin: { from: (table: string) => any },
  file: File,
  overrides: ShowOverrides,
  options: { existingEventId?: string | null } = {}
): Promise<ImportPreview> {
  const text = await readImportFileText(file);
  if (!text.trim()) {
    throw new Error("The uploaded file did not contain readable text.");
  }

  const parsed = parseImportedEventFile(file.name, text, overrides);
  const payload = buildImportedEventPayload(parsed);
  const importFormat = parsed.importFormat || parsed.show.import_format || "crew_list";
  const clientMatch = await resolveClientMatch(admin, payload.show.client);
  const selectedEventMatch = importFormat === "estimate" ? await findExistingEventById(admin, options.existingEventId || "") : null;
  const existingEventMatch = importFormat === "estimate" ? selectedEventMatch || await findExistingEventMatch(admin, payload) : null;
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
