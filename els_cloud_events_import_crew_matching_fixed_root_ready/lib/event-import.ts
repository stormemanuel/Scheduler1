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
  const cleaned = raw.toLowerCase().replace(/\s+/g, "").trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = match[3] || "";
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function parseTimeRange(raw: string) {
  const cleaned = raw.replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").trim();
  const [startRaw, endRaw] = cleaned.split("-");
  return {
    timeRange: cleaned,
    startTime: to24Hour((startRaw || "").trim()),
    endTime: to24Hour((endRaw || "").trim()),
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

function parsePdfText(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => compactSpaces(line))
    .filter(Boolean)
    .filter((line) => !/^page \d+/i.test(line));

  let showName = overrides.name || "Imported Event";
  let client = overrides.client || "";
  let venue = overrides.venue || "";
  let location = "";
  let rateCity = overrides.rate_city || "Default";
  const noteBits: string[] = [];

  const titleIndex = lines.findIndex((line) => /labor call list/i.test(line));
  if (titleIndex >= 0 && lines[titleIndex + 1]) {
    showName = lines[titleIndex + 1];
  }

  const rowDateRegex = new RegExp(`^(${MONTHS.join("|")})\\s+\\d{1,2},\\s*\\d{4}`, "i");
  const genericRowHeader = /^(dates?\s+name\s+times?\s+position)/i;

  const rows: ImportedCrewRow[] = [];
  let currentSection = "Imported Call";
  let pendingSection = "";

  for (const line of lines) {
    if (/^client:/i.test(line)) {
      client = line.replace(/^client:/i, "").trim();
      continue;
    }
    if (/^venue:/i.test(line)) {
      venue = line.replace(/^venue:/i, "").trim();
      continue;
    }
    if (/^location:/i.test(line)) {
      location = line.replace(/^location:/i, "").trim();
      continue;
    }
    if (/^dates?:/i.test(line)) {
      noteBits.push(line);
      continue;
    }
    if (/contact:/i.test(line) || /coordinator:/i.test(line)) {
      noteBits.push(line);
      continue;
    }
    if (genericRowHeader.test(line)) continue;

    if (rowDateRegex.test(line)) {
      if (pendingSection) {
        currentSection = pendingSection;
        pendingSection = "";
      }

      const dateMatch = line.match(rowDateRegex);
      const dateText = dateMatch?.[0] ?? "";
      const date = toISODate(dateText);
      const rest = line.slice(dateText.length).trim();
      const phoneMatch = rest.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})$/);
      const phone = phoneMatch ? cleanPhone(phoneMatch[1]) : "";
      const withoutPhone = phoneMatch ? rest.slice(0, phoneMatch.index).trim() : rest;
      const timeMatch = withoutPhone.match(/(\d{1,2}:\d{2}\s*(?:am|pm)?\s*-\s*\d{1,2}:\d{2}\s*(?:am|pm)?)/i);
      if (!timeMatch || !date) continue;
      const timeRangeText = timeMatch[1];
      const name = withoutPhone.slice(0, timeMatch.index).trim();
      const position = withoutPhone.slice((timeMatch.index || 0) + timeRangeText.length).trim();
      if (!name || !position) continue;
      const { timeRange, startTime, endTime } = parseTimeRange(timeRangeText);
      rows.push({
        area: currentSection,
        date,
        name,
        timeRange,
        startTime,
        endTime,
        position,
        phone,
      });
      continue;
    }

    const sectionLike = /booth|po\d+|#\d+/i.test(line) || /\(.*\)/.test(line);
    if (sectionLike) {
      pendingSection = pendingSection ? `${pendingSection} ${line}` : line;
      continue;
    }
  }

  if (!rows.length) {
    throw new Error("PDF import could not find any labor call rows.");
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
