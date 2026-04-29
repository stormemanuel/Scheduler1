export type ImportedCrewRow = {
  area: string;
  eventName?: string;
  client?: string;
  venue?: string;
  location?: string;
  rateCity?: string;
  date: string; // YYYY-MM-DD
  name: string;
  timeRange: string;
  startTime: string;
  endTime: string;
  position: string;
  phone: string;
  notes?: string;
};

export type ImportedEventData = {
  show: {
    name: string;
    client: string;
    venue: string;
    rate_city: string;
    show_start: string;
    show_end: string;
    notes: string;
  };
  rows: ImportedCrewRow[];
  sourceType: "csv" | "pdf";
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function compactSpaces(value: string) {
  return value.replace(/[\t\u00A0]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return value.trim();
}

function toISODate(raw: string) {
  const parsed = new Date(raw.replace(/\s+/g, " ").trim());
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function to24Hour(raw: string) {
  const cleaned = raw
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .trim();
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2] || "00";
  const suffix = match[3] || "";
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  if (hour > 23 || Number(minute) > 59) return "";
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function parseTimeRange(raw: string) {
  const cleaned = raw
    .replace(/[–—]/g, "-")
    .replace(/\|/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, " - ")
    .trim();
  const [startRaw, endRaw] = cleaned.split(" - ");
  const endLooksLikeTime = /\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/i.test(endRaw || "");
  return {
    timeRange: cleaned,
    startTime: to24Hour((startRaw || "").trim()),
    endTime: endLooksLikeTime ? to24Hour((endRaw || "").trim()) : "",
  };
}

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map((value) => value.trim());
}

function inferAreaFromRow(row: Record<string, string>) {
  return (
    row.area ||
    row.section ||
    row.booth ||
    row.call ||
    row.group ||
    row["booth name"] ||
    row["call section"] ||
    "Imported Call"
  );
}

function parseCsv(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV does not contain enough rows to import.");
  }

  const headers = splitCsvLine(lines[0]).map((header) => normalize(header));
  const rows: ImportedCrewRow[] = [];

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });

    const rawDate = row.date || row.dates || row.day || row["labor date"] || row["work date"];
    const name = row.name || row["contact name"] || row.crew || row.technician || "";
    const timeValue = row.times || row.time || row["time range"] || `${row.start || row["start time"] || ""}-${row.end || row["end time"] || ""}`;
    const position = row.position || row.role || row["role name"] || "";
    const phone = row.phone || row["contact number"] || row.contact || "";
    const area = inferAreaFromRow(row);

    const date = toISODate(rawDate);
    if (!date || !name || !position || !timeValue) continue;

    const { timeRange, startTime, endTime } = parseTimeRange(timeValue);

    rows.push({
      area: compactSpaces(area),
      eventName: row.event || row["event name"] || row.show || row["show name"] || undefined,
      client: row.client || row.company || undefined,
      venue: row.venue || undefined,
      location: row.location || undefined,
      rateCity: row["rate city"] || row.city || undefined,
      date,
      name: compactSpaces(name),
      timeRange,
      startTime,
      endTime,
      position: compactSpaces(position),
      phone: cleanPhone(phone),
      notes: row.notes || undefined,
    });
  }

  if (!rows.length) {
    throw new Error("CSV import did not find any usable crew rows.");
  }

  const dates = rows.map((row) => row.date).sort();
  const first = rows[0];
  const showName = overrides.name || first.eventName || "Imported Event";
  const client = overrides.client || first.client || "";
  const venue = [overrides.venue || first.venue || "", first.location || ""].filter(Boolean).join(" • ");
  const rate_city = overrides.rate_city || first.rateCity || "Default";

  return {
    show: {
      name: showName,
      client,
      venue,
      rate_city,
      show_start: overrides.show_start || dates[0],
      show_end: overrides.show_end || dates[dates.length - 1],
      notes: overrides.notes || "Imported from CSV",
    },
    rows,
    sourceType: "csv",
  };
}

const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const WEEKDAY_PREFIX = /^(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)[,\s]+/i;
const MONTH_DATE_PATTERN = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\s+\\d{1,2}(?:,?\\s*\\d{2,4})?";
const NUMERIC_DATE_PATTERN = "\\d{1,2}[\\/.-]\\d{1,2}(?:[\\/.-]\\d{2,4})?";
const TIME_PATTERN = "\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)";
const PHONE_PATTERN = /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function normalizeYear(value: string | undefined, fallbackYear: number) {
  if (!value) return fallbackYear;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallbackYear;
  if (numeric < 100) return numeric >= 70 ? 1900 + numeric : 2000 + numeric;
  return numeric;
}

function inferDefaultYear(lines: string[]) {
  const joined = lines.join(" ");
  const years = [...joined.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  if (years.length) {
    const counts = new Map<number, number>();
    for (const year of years) counts.set(year, (counts.get(year) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const shortYear = joined.match(/\b[A-Z]{2,}[\s-]*(\d{2})\b/);
  if (shortYear) return 2000 + Number(shortYear[1]);

  return new Date().getFullYear();
}

function parseImportDate(raw: string, fallbackYear: number) {
  const cleaned = compactSpaces(raw)
    .replace(WEEKDAY_PREFIX, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const numeric = cleaned.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = normalizeYear(numeric[3], fallbackYear);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const monthNamed = cleaned.toLowerCase().match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s+(\d{2,4}))?$/);
  if (monthNamed) {
    const month = MONTH_LOOKUP[monthNamed[1]];
    const day = Number(monthNamed[2]);
    const year = normalizeYear(monthNamed[3], fallbackYear);
    if (month && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function dateStartFromLine(line: string, fallbackYear: number) {
  const dateRegex = new RegExp(`^(?:${WEEKDAY_PREFIX.source})?(${MONTH_DATE_PATTERN}|${NUMERIC_DATE_PATTERN})(?=\\s|$)`, "i");
  const match = line.match(dateRegex);
  if (!match) return null;
  const rawDate = match[1];
  const date = parseImportDate(rawDate, fallbackYear);
  if (!date) return null;
  return {
    rawDate,
    date,
    rest: compactSpaces(line.slice(match[0].length)),
  };
}

function stripPdfHeaderGlue(line: string) {
  return compactSpaces(line)
    .replace(/Dates\s+Name\s+Times?\s+Position\s+Contact\s+Number/gi, " ")
    .replace(/Date\s+Name\s+Times?\s+Position\s+Contact\s+Number/gi, " ")
    .replace(/Contact\s+Number/gi, "Contact Number")
    .trim();
}

function isTableHeaderLine(line: string) {
  return /^(dates?|day)\s+name\s+times?\s+position/i.test(line) || /^name\s+times?\s+position/i.test(line);
}

function isMetadataLine(line: string) {
  return /^(event\s*name|client|venue|address|location|project\s*manager|assistant\s*pm|crew\s*lead|contact|coordinator|nmr\s*contact|gear|notes?)\s*:/i.test(line);
}

function isNonLaborNote(line: string) {
  return /\bon\s*call\b/i.test(line) && !new RegExp(TIME_PATTERN, "i").test(line);
}

function isLikelySectionLine(line: string) {
  if (!line || isTableHeaderLine(line) || isMetadataLine(line)) return false;
  if (new RegExp(TIME_PATTERN, "i").test(line)) return false;
  PHONE_PATTERN.lastIndex = 0;
  if (PHONE_PATTERN.test(line)) return false;
  PHONE_PATTERN.lastIndex = 0;
  return /\b(booth|po\s*\d+|po\d+|floaters?|loaders?|truck|breakout|general\s+session|room|stage|registration|exhibit|strike|load[-\s]?in|dismantle|install)\b|#\s*\d+/i.test(line);
}

function lineHasPhone(line: string) {
  PHONE_PATTERN.lastIndex = 0;
  const result = PHONE_PATTERN.test(line);
  PHONE_PATTERN.lastIndex = 0;
  return result;
}

function lineHasTime(line: string) {
  return new RegExp(TIME_PATTERN, "i").test(line);
}

function lineLooksLikeCompleteCrewRow(line: string) {
  return lineHasTime(line) && lineHasPhone(line);
}

function splitPhoneFromRow(value: string) {
  PHONE_PATTERN.lastIndex = 0;
  const matches = [...value.matchAll(PHONE_PATTERN)];
  PHONE_PATTERN.lastIndex = 0;
  if (!matches.length) return { beforePhone: value, phone: "" };
  const match = matches[matches.length - 1];
  const index = match.index ?? value.length;
  return {
    beforePhone: compactSpaces(value.slice(0, index)),
    phone: cleanPhone(match[0]),
  };
}

function parseCrewCandidateRow(line: string, area: string, fallbackYear: number): ImportedCrewRow | null {
  const dateInfo = dateStartFromLine(line, fallbackYear);
  if (!dateInfo) return null;

  const rest = stripPdfHeaderGlue(dateInfo.rest);
  if (!rest || isNonLaborNote(rest)) return null;

  const { beforePhone, phone } = splitPhoneFromRow(rest);
  const timeRegex = new RegExp(`(${TIME_PATTERN})\\s*(?:[-–—|]|to)?\\s*((?:${TIME_PATTERN})|(?:full\\s*day|half\\s*day|full\\s*shift|half\\s*shift))?`, "i");
  const timeMatch = beforePhone.match(timeRegex);
  if (!timeMatch) return null;

  const rawName = compactSpaces(beforePhone.slice(0, timeMatch.index).replace(/\s+/g, " "));
  const endSpec = timeMatch[2] ? timeMatch[2] : "";
  const timeRangeText = compactSpaces(`${timeMatch[1]}${endSpec ? ` - ${endSpec}` : ""}`);
  const position = compactSpaces(beforePhone.slice((timeMatch.index || 0) + timeMatch[0].length)) || "Imported Crew";

  if (!rawName || /^(name|dates?)$/i.test(rawName)) return null;

  const { timeRange, startTime, endTime } = parseTimeRange(timeRangeText);
  if (!startTime) return null;

  return {
    area: area || "Imported Call",
    date: dateInfo.date,
    name: rawName,
    timeRange,
    startTime,
    endTime,
    position,
    phone,
  };
}

function parsePdfText(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => stripPdfHeaderGlue(line))
    .filter(Boolean)
    .filter((line) => !/^page\s+\d+/i.test(line));

  let showName = overrides.name || "Imported Event";
  let client = overrides.client || "";
  let venue = overrides.venue || "";
  let location = "";
  let rateCity = overrides.rate_city || "Default";
  const noteBits: string[] = [];
  const fallbackYear = inferDefaultYear(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/labor\s+call\s+list/i.test(line) && showName === "Imported Event") {
      const next = lines[index + 1];
      if (next && !isTableHeaderLine(next)) showName = next;
    }
    if (/^event\s*name\s*:/i.test(line)) {
      showName = line.replace(/^event\s*name\s*:/i, "").trim() || showName;
      continue;
    }
    if (/^client\s*:/i.test(line)) {
      client = line.replace(/^client\s*:/i, "").trim();
      continue;
    }
    if (/^venue\s*:/i.test(line)) {
      venue = line.replace(/^venue\s*:/i, "").trim();
      continue;
    }
    if (/^address\s*:/i.test(line)) {
      location = line.replace(/^address\s*:/i, "").trim();
      continue;
    }
    if (/^location\s*:/i.test(line)) {
      location = line.replace(/^location\s*:/i, "").trim();
      continue;
    }
    if (/^dates?\s*:/i.test(line)) {
      noteBits.push(line);
      continue;
    }
    if (/contact\s*:/i.test(line) || /coordinator\s*:/i.test(line) || /project\s*manager\s*:/i.test(line) || /crew\s*lead\s*:/i.test(line)) {
      noteBits.push(line);
      continue;
    }
  }

  const rows: ImportedCrewRow[] = [];
  let currentSection = "Imported Call";
  let pendingRow = "";

  const finishPendingRow = () => {
    if (!pendingRow) return;
    const parsed = parseCrewCandidateRow(pendingRow, currentSection, fallbackYear);
    if (parsed) rows.push(parsed);
    pendingRow = "";
  };

  for (const rawLine of lines) {
    const line = stripPdfHeaderGlue(rawLine);
    if (!line || isTableHeaderLine(line) || isNonLaborNote(line)) continue;

    const startsDate = dateStartFromLine(line, fallbackYear);
    if (startsDate) {
      finishPendingRow();
      pendingRow = line;
      continue;
    }

    if (pendingRow) {
      if (lineLooksLikeCompleteCrewRow(pendingRow) && (isMetadataLine(line) || isLikelySectionLine(line) || isTableHeaderLine(line))) {
        finishPendingRow();
      } else if (!isMetadataLine(line) && !isTableHeaderLine(line)) {
        pendingRow = compactSpaces(`${pendingRow} ${line}`);
        continue;
      }
    }

    if (isLikelySectionLine(line)) {
      currentSection = line;
      continue;
    }
  }
  finishPendingRow();

  if (!rows.length) {
    const dateLike = lines.filter((line) => dateStartFromLine(line, fallbackYear)).slice(0, 3).join(" | ");
    throw new Error(
      dateLike
        ? `PDF import found date-looking lines but could not split them into crew rows. First date lines: ${dateLike}`
        : "PDF import could not find any labor call rows. The parser now supports numeric dates, month dates, full-day/half-day calls, and multi-line names; this PDF may be scanned/image-only or uses a different table extraction order."
    );
  }

  const dates = rows.map((row) => row.date).sort();
  const show = {
    name: showName,
    client,
    venue: [venue, location].filter(Boolean).join(" • "),
    rate_city: rateCity,
    show_start: overrides.show_start || dates[0],
    show_end: overrides.show_end || dates[dates.length - 1],
    notes: [overrides.notes, ...noteBits].filter(Boolean).join("\n"),
  };

  return { show, rows, sourceType: "pdf" };
}


export function parseImportedEventFile(
  fileName: string,
  contents: string,
  overrides: Partial<ImportedEventData["show"]>
): ImportedEventData {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return parseCsv(contents, overrides);
  return parsePdfText(contents, overrides);
}

export function buildImportedEventPayload(data: ImportedEventData) {
  const laborDays = new Map<string, { labor_date: string; label: string; notes: string }>();
  const subCallGroups = new Map<
    string,
    {
      labor_date: string;
      area: string;
      role_name: string;
      start_time: string;
      end_time: string;
      crew_needed: number;
      notes: string;
      crewRows: ImportedCrewRow[];
    }
  >();

  for (const row of data.rows) {
    if (!laborDays.has(row.date)) {
      laborDays.set(row.date, {
        labor_date: row.date,
        label: "Imported day",
        notes: `Imported from ${data.sourceType.toUpperCase()}`,
      });
    }

    const key = [row.date, row.area, row.position, row.startTime, row.endTime].join("|");
    const existing = subCallGroups.get(key);
    if (existing) {
      existing.crew_needed += 1;
      existing.crewRows.push(row);
    } else {
      subCallGroups.set(key, {
        labor_date: row.date,
        area: row.area || "Imported Call",
        role_name: row.position,
        start_time: row.startTime,
        end_time: row.endTime,
        crew_needed: 1,
        notes: `Imported from ${data.sourceType.toUpperCase()}`,
        crewRows: [row],
      });
    }
  }

  return {
    show: data.show,
    laborDays: [...laborDays.values()].sort((a, b) => a.labor_date.localeCompare(b.labor_date)),
    subCallGroups: [...subCallGroups.values()].sort((a, b) => {
      if (a.labor_date !== b.labor_date) return a.labor_date.localeCompare(b.labor_date);
      return a.start_time.localeCompare(b.start_time);
    }),
  };
}

export function normalizeMatchValue(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhoneForMatch(value: string) {
  const digits = value.replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return normalized.length >= 10 ? normalized.slice(-10) : normalized;
}
