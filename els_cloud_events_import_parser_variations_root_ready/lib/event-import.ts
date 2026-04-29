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

const MONTH_ABBR: Record<string, number> = {
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

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function compactSpaces(value: string) {
  return value.replace(/[\t\u00A0]+/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizePdfText(value: string) {
  return value
    .replace(/\uE081/g, "(")
    .replace(/\uE082/g, ")")
    .replace(/\uE088/g, "-")
    .replace(/\uE092/g, ":")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\|/g, " | ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");
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

function zeroPad(value: number) {
  return String(value).padStart(2, "0");
}

function inferYearFromText(text: string) {
  const match = text.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function toISODate(raw: string, fallbackYear?: number) {
  const cleaned = compactSpaces(raw)
    .replace(/^Dates?\s*:?/i, "")
    .replace(/^Date\s+/i, "")
    .replace(new RegExp(`^(?:${WEEKDAYS.join("|")}),?\s+`, "i"), "")
    .trim();

  if (!cleaned) return "";

  const fullMatch = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (fullMatch) {
    const month = MONTH_ABBR[fullMatch[1].toLowerCase()];
    const day = Number(fullMatch[2]);
    const year = Number(fullMatch[3]);
    if (month) return `${year}-${zeroPad(month)}-${zeroPad(day)}`;
  }

  const numericFull = cleaned.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (numericFull) {
    const month = Number(numericFull[1]);
    const day = Number(numericFull[2]);
    const rawYear = numericFull[3];
    const year = rawYear ? Number(rawYear.length === 2 ? `20${rawYear}` : rawYear) : fallbackYear;
    if (month && day && year) return `${year}-${zeroPad(month)}-${zeroPad(day)}`;
  }

  const parsed = new Date(cleaned.replace(/\s+/g, " ").trim());
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function to24Hour(raw: string) {
  const cleaned = raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(am|pm)?$/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = match[3] || "";
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return `${zeroPad(hour)}:${minute}`;
}

function parseTimeRange(raw: string) {
  const matches = [...raw.matchAll(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?/gi)].map((match) => match[0]);
  const startRaw = matches[0] || "";
  const endRaw = matches[1] || "";
  const normalizedRange = startRaw && endRaw ? `${compactSpaces(startRaw)} - ${compactSpaces(endRaw)}` : compactSpaces(raw);
  return {
    timeRange: normalizedRange,
    startTime: to24Hour(startRaw),
    endTime: to24Hour(endRaw),
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

function inferRateCity(location: string, venue: string) {
  const combined = normalize(`${location} ${venue}`);
  if (combined.includes("nashville")) return "Nashville, TN";
  if (combined.includes("atlanta")) return "Atlanta, GA";
  if (combined.includes("new orleans") || combined.includes("mccno") || combined.includes("ernest morial") || combined.includes("convention center")) {
    return "New Orleans, LA";
  }
  return "Default";
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

function extractField(text: string, label: string) {
  const match = text.match(new RegExp(`${label}\\s*:?\\s*(.+?)(?=\\s+(?:Show|Client|Venue|Location|Dates|NMR\\s+Contact|Coordinator|Lead\\s*\/\\s*Coordinator)\\s*:|$)`, "i"));
  return match ? compactSpaces(match[1]) : "";
}

function isRowHeader(line: string) {
  return /^date\s+name/i.test(line) || /^dates\s+name/i.test(line) || /^date\s+name\s+po/i.test(line);
}

function isIgnorableLine(line: string) {
  return /^(available|on call)/i.test(line) || /^contact number$/i.test(line);
}

function isSectionHeader(line: string) {
  return !isRowHeader(line) && !isIgnorableLine(line) && /(booth|meeting suites?|po\d+)/i.test(line);
}

function dateStartMatch(line: string, fallbackYear: number) {
  const cleaned = compactSpaces(line);
  const patterns = [
    new RegExp(`^(?:${WEEKDAYS.join("|")}),?\s+[A-Za-z]+\s+\d{1,2},\s*\d{4}`, "i"),
    /^[A-Za-z]+\s+\d{1,2},\s*\d{4}/,
    /^[A-Za-z]{3}\s+\d{1,2},\s*\d{4}/,
    /^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const iso = toISODate(match[0], fallbackYear);
      if (iso) return { raw: match[0], iso };
    }
  }
  return null;
}

function normalizeRole(value: string) {
  const clean = compactSpaces(value)
    .replace(/\(WL\)/gi, "")
    .replace(/^CF\s+/i, "")
    .trim();
  const token = normalize(clean);
  if (token === "gav") return "General AV";
  if (token === "avt" || token === "cf avt") return "AVT";
  return clean;
}

function splitIntoLines(text: string) {
  const raw = sanitizePdfText(text)
    .replace(/(\bDate\s+Name\s+(?:PO\s+)?Times\s+Position\s+Contact\s+Number\b)/gi, "\n$1\n")
    .replace(/(\b(?:Show|Client|Venue|Location|Dates|NMR Contact|Coordinator|Lead\s*\/\s*Coordinator)\s*:)/gi, "\n$1")
    .replace(/\n+/g, "\n");

  const year = inferYearFromText(raw);
  const lines = raw.split("\n").map((line) => compactSpaces(line)).filter(Boolean);
  const merged: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];

    if (/,\s*$/.test(line) && lines[i + 1] && /^\d{4}$/.test(lines[i + 1])) {
      line = `${line} ${lines[i + 1]}`;
      i += 1;
    }

    if (dateStartMatch(line, year) && lines[i + 1] && !dateStartMatch(lines[i + 1], year) && !isSectionHeader(lines[i + 1]) && !isRowHeader(lines[i + 1]) && !isIgnorableLine(lines[i + 1])) {
      let block = line;
      while (lines[i + 1] && !dateStartMatch(lines[i + 1], year) && !isSectionHeader(lines[i + 1]) && !isRowHeader(lines[i + 1]) && !isIgnorableLine(lines[i + 1])) {
        block += ` ${lines[i + 1]}`;
        i += 1;
        if (/\d{3}[\s().-]*\d{3}[\s.-]*\d{4}\s*$/.test(block)) break;
      }
      line = compactSpaces(block);
    }

    merged.push(line);
  }

  return merged;
}

function parsePdfText(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData {
  const sanitized = sanitizePdfText(text);
  const fallbackYear = inferYearFromText(sanitized);
  const lines = splitIntoLines(sanitized);

  let showName = overrides.name || extractField(sanitized, "Show") || "Imported Event";
  let client = overrides.client || extractField(sanitized, "Client") || "";
  let venue = overrides.venue || extractField(sanitized, "Venue") || "";
  let location = extractField(sanitized, "Location") || "";
  let rateCity = overrides.rate_city || inferRateCity(location, venue);
  const noteBits: string[] = [];

  if (!extractField(sanitized, "Show")) {
    const titleIndex = lines.findIndex((line) => /labor call list/i.test(line));
    if (titleIndex >= 0 && lines[titleIndex + 1]) {
      showName = overrides.name || lines[titleIndex + 1];
    }
  }

  const datesHeader = extractField(sanitized, "Dates");
  if (datesHeader) noteBits.push(`Dates: ${datesHeader}`);
  const nmr = extractField(sanitized, "NMR Contact");
  if (nmr) noteBits.push(`NMR Contact: ${nmr}`);
  const coordinator = extractField(sanitized, "Coordinator") || extractField(sanitized, "Lead / Coordinator");
  if (coordinator) noteBits.push(`Coordinator: ${coordinator}`);

  const rows: ImportedCrewRow[] = [];
  let currentSection = "Imported Call";
  let pendingSections: string[] = [];
  let awaitingRowsForPendingSections = false;

  for (const line of lines) {
    if (!line) continue;
    if (/^show:/i.test(line) || /^client:/i.test(line) || /^venue:/i.test(line) || /^location:/i.test(line) || /^dates?:/i.test(line) || /^nmr contact:/i.test(line) || /^coordinator:/i.test(line) || /^lead\s*\/\s*coordinator:/i.test(line)) {
      continue;
    }
    if (isIgnorableLine(line)) continue;

    if (isSectionHeader(line)) {
      pendingSections.push(line.trim());
      awaitingRowsForPendingSections = true;
      continue;
    }

    if (isRowHeader(line)) {
      if (pendingSections.length) {
        currentSection = pendingSections.shift() || currentSection;
      }
      awaitingRowsForPendingSections = false;
      continue;
    }

    const dateMatch = dateStartMatch(line, fallbackYear);
    if (!dateMatch) continue;

    if (awaitingRowsForPendingSections && pendingSections.length) {
      currentSection = pendingSections.shift() || currentSection;
      awaitingRowsForPendingSections = false;
    }

    const date = dateMatch.iso;
    const rest = compactSpaces(line.slice(dateMatch.raw.length).trim());

    const phoneMatch = rest.match(/(\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})\s*$/);
    const phone = phoneMatch ? cleanPhone(phoneMatch[1]) : "";
    const withoutPhone = phoneMatch ? compactSpaces(rest.slice(0, phoneMatch.index).trim()) : rest;

    const timeMatches = [...withoutPhone.matchAll(/\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?/gi)].map((match) => ({
      text: match[0],
      index: match.index ?? 0,
    }));
    if (timeMatches.length < 2) continue;

    const firstTime = timeMatches[0];
    const secondTime = timeMatches[1];
    const beforeTime = compactSpaces(withoutPhone.slice(0, firstTime.index));
    const afterSecondTime = compactSpaces(withoutPhone.slice(secondTime.index + secondTime.text.length));
    const timeRangeRaw = `${firstTime.text} - ${secondTime.text}`;
    const { timeRange, startTime, endTime } = parseTimeRange(timeRangeRaw);

    if (!startTime || !endTime) continue;

    const name = beforeTime.replace(/\bPO\d+\b/gi, "").trim();
    const poMatch = beforeTime.match(/\bPO\d+\b/gi);
    const position = normalizeRole(afterSecondTime);
    if (!name || !position) continue;

    rows.push({
      area: currentSection || "Imported Call",
      eventName: showName,
      client,
      venue,
      location,
      rateCity,
      date,
      name: compactSpaces(name),
      timeRange,
      startTime,
      endTime,
      position,
      phone,
      notes: poMatch?.length ? poMatch.join(", ") : undefined,
    });
  }

  if (!rows.length) {
    throw new Error("PDF import could not find any labor call rows. This file may need the newer booth/row parser update.");
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
  return normalize(value);
}

export function normalizePhoneForMatch(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
