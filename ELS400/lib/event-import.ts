export type ImportedCrewRow = {
  area: string;
  boothNumber?: string;
  poNumber?: string;
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
  crewNeeded?: number;
  dayType?: "full_day" | "half_day" | "hourly" | "custom";
  clientRate?: number | null;
  amount?: number | null;
  sourceAmount?: string;
  reviewFlags?: string[];
  notes?: string;
};

export type ImportedEventData = {
  show: {
    name: string;
    show_reference_number?: string;
    estimate_number?: string;
    estimate_date?: string;
    estimate_total?: number | null;
    parsed_line_total?: number | null;
    import_format?: "crew_list" | "estimate";
    client: string;
    venue: string;
    event_location: string;
    rate_city: string;
    show_start: string;
    show_end: string;
    notes: string;
  };
  rows: ImportedCrewRow[];
  sourceType: "csv" | "pdf";
  importFormat?: "crew_list" | "estimate";
  needsReview?: string[];
  importDebug?: {
    extractedRows: string[];
    reconstructedRows: string[];
    detectedDates: string[];
    detectedCurrencyValues: string[];
    detectedGroupingHeaders: string[];
    rejectedRows: string[];
  };
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
const ISO_DATE_PATTERN = "20\\d{2}-\\d{1,2}-\\d{1,2}";
const TIME_PATTERN = "\\d{1,2}(?:(?::|\\s)\\d{2})(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?";
const PHONE_PATTERN = /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g;
const BAD_PDF_GLYPHS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD\u25A0-\u25FF\u2580-\u259F\uE000-\uF8FF]/g;

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPdfArtifacts(value: string) {
  return value
    .replace(BAD_PDF_GLYPHS, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—−]/g, "-")
    .replace(/\bWednes\s+day\b/gi, "Wednesday")
    .replace(/\bThurs\s+day\b/gi, "Thursday")
    .replace(/\bSatur\s+day\b/gi, "Saturday")
    .replace(/\bSun\s+day\b/gi, "Sunday")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",");
}

function compactSpaces(value: string) {
  return cleanPdfArtifacts(value).replace(/[\t\u00A0]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return compactSpaces(value);
}

function toISODate(raw: string) {
  const parsed = new Date(compactSpaces(raw));
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function to24Hour(raw: string) {
  const cleaned = compactSpaces(raw)
    .toLowerCase()
    .replace(/\./g, "")
    .trim();
  // PDF extraction sometimes turns the colon in 8:00 AM into a blank/glyph, so support both
  // normal times (8:00 AM) and corrupted times (8 00 AM).
  const match = cleaned.match(/^(\d{1,2})(?::|\s)?(\d{2})(?::\d{2})?\s*(am|pm)?$/);
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
  const cleaned = compactSpaces(raw)
    .replace(/[–—−]/g, "-")
    .replace(/\|/g, "-")
    .replace(/\s*[-]\s*/g, " - ")
    .trim();
  const [startRaw, endRaw] = cleaned.split(" - ");
  return {
    timeRange: cleaned,
    startTime: to24Hour((startRaw || "").trim()),
    endTime: to24Hour((endRaw || "").trim()),
  };
}

function moneyNumber(raw: string | null | undefined) {
  const cleaned = String(raw || "").replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function titleCaseLoose(value: string) {
  return compactSpaces(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\b(Nmr|Av|Po|Ro)\b/g, (match) => match.toUpperCase());
}

function titleCaseVenue(value: string) {
  const clean = compactSpaces(value);
  if (/^[A-Z0-9&.-]{2,10}$/.test(clean)) return clean;
  return titleCaseLoose(clean);
}

const STATE_ABBREVIATIONS: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

function normalizeState(value: string) {
  const clean = compactSpaces(value).replace(/\./g, "");
  if (/^[A-Z]{2}$/i.test(clean)) return clean.toUpperCase();
  return STATE_ABBREVIATIONS[normalize(clean)] || "";
}

function parseCityStateFromAddress(value: string) {
  const clean = compactSpaces(value);
  const stateNames = Object.keys(STATE_ABBREVIATIONS).sort((a, b) => b.length - a.length).map((state) => state.replace(/\s+/g, "\\s+")).join("|");
  const stateMatch = clean.match(new RegExp(`(?:,|\\s)\\s*([A-Z]{2}|${stateNames})\\s*(?:\\d{5}(?:-\\d{4})?)?$`, "i"));
  if (!stateMatch) return { city: "", state: "" };
  const beforeState = compactSpaces(clean.slice(0, stateMatch.index)).replace(/[,\s]+$/g, "");
  const city = beforeState.split(/\s{2,}|,/).map((part) => part.trim()).filter(Boolean).pop() || beforeState.split(/\s+/).slice(-2).join(" ");
  return { city: titleCaseLoose(city), state: normalizeState(stateMatch[1]) };
}

function estimateCrewPool(city: string, state: string) {
  const cityKey = normalize(city);
  const stateKey = normalizeState(state);
  const aliases: Record<string, string> = {
    gretna: "New Orleans",
    "new orleans": "New Orleans",
    "new orleans la": "New Orleans",
    metairie: "New Orleans",
    kenner: "New Orleans",
    mpls: "Minneapolis",
    minneapolis: "Minneapolis",
    "minneapolis mn": "Minneapolis",
  };
  return aliases[cityKey] || aliases[`${cityKey} ${normalize(stateKey)}`] || (city && stateKey ? city : city || "Default");
}

function splitEstimateEventField(value: string) {
  const [eventName, reference, ...rest] = compactSpaces(value).split("|").map((part) => compactSpaces(part));
  return {
    eventName: eventName || "Imported Event",
    showReference: compactSpaces([reference, ...rest].filter(Boolean).join(" | ")),
  };
}

function looksLikeEstimate(text: string) {
  return /Bill\s+to/i.test(text) && /Ship\s+to/i.test(text) && /Estimate\s+no\.?/i.test(text) && /Product\s*\/\s*service/i.test(text);
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
  const venue = overrides.venue || first.venue || "";
  const event_location = overrides.event_location || first.location || "";
  const rate_city = overrides.rate_city || first.rateCity || "Default";

  return {
    show: {
      name: showName,
      client,
      venue,
      event_location,
      rate_city,
      show_start: overrides.show_start || dates[0],
      show_end: overrides.show_end || dates[dates.length - 1],
      notes: overrides.notes || "Imported from CSV",
    },
    rows,
    sourceType: "csv",
  };
}

function csvHeaderValue(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const key = normalize(name);
    if (row[key]) return row[key];
  }
  return "";
}

function parseEstimateCsv(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const headers = splitCsvLine(lines[0]).map((header) => normalize(header));
  const hasEstimateHeaders = ["service date", "role", "qty", "rate", "amount"].some((key) => headers.includes(key)) &&
    ["booth area", "booth number", "po number", "client", "venue"].some((key) => headers.includes(key));
  if (!hasEstimateHeaders) return null;

  const needsReview: string[] = [];
  const rows: ImportedCrewRow[] = [];
  let client = "";
  let venue = "";
  let streetAddress = "";
  let city = "";
  let state = "";
  let estimateNumber = "";
  let estimateDate = "";
  let eventName = "";
  let showReference = "";
  let estimateTotal: number | null = null;

  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });

    client ||= csvHeaderValue(row, ["Client"]);
    venue ||= csvHeaderValue(row, ["Venue"]);
    streetAddress ||= csvHeaderValue(row, ["Street Address", "Address"]);
    city ||= csvHeaderValue(row, ["City"]);
    state ||= csvHeaderValue(row, ["State"]);
    estimateNumber ||= csvHeaderValue(row, ["Estimate Number", "Estimate no", "Estimate no."]);
    estimateDate ||= csvHeaderValue(row, ["Estimate Date"]);
    eventName ||= csvHeaderValue(row, ["Event Name", "Event"]);
    showReference ||= csvHeaderValue(row, ["Show Reference Number", "Show Reference"]);
    estimateTotal ??= moneyNumber(csvHeaderValue(row, ["Estimate Total", "Total"]));

    const rawDate = csvHeaderValue(row, ["Service Date", "Date", "Labor Date"]);
    const date = parseImportDate(rawDate, inferDefaultYear(lines));
    const roleRaw = csvHeaderValue(row, ["Role", "Product/service", "Product Service", "Position"]);
    const dayTypeRaw = csvHeaderValue(row, ["Day Type"]);
    const startRaw = csvHeaderValue(row, ["Start Time", "Start"]);
    const endRaw = csvHeaderValue(row, ["End Time", "End"]);
    const qtyRaw = csvHeaderValue(row, ["Qty", "Quantity"]);
    const rateRaw = csvHeaderValue(row, ["Rate"]);
    const amountRaw = csvHeaderValue(row, ["Amount"]);
    const area = csvHeaderValue(row, ["Booth / Area", "Area", "Booth Area"]) || "Imported Call";
    const boothNumber = csvHeaderValue(row, ["Booth Number", "Booth"]);
    const poNumber = csvHeaderValue(row, ["PO Number", "PO"]);

    if (!date || !roleRaw || !qtyRaw) continue;
    const roleInfo = normalizeEstimateRole(roleRaw, dayTypeRaw);
    const startTime = to24Hour(startRaw);
    const endTime = to24Hour(endRaw);
    const qty = Math.max(1, Math.floor(Number(qtyRaw) || 1));
    const rate = moneyNumber(rateRaw);
    const amount = moneyNumber(amountRaw);
    const reviewFlags = estimateLineReviewFlags({ startTime, endTime, startRaw, endRaw, qtyRaw, rate, amount, qty });
    needsReview.push(...reviewFlags.map((flag) => `${date} ${area}: ${flag}`));

    rows.push({
      area: compactSpaces(area),
      boothNumber: compactSpaces(boothNumber || "TBD"),
      poNumber: compactSpaces(poNumber),
      date,
      name: "",
      timeRange: `${startRaw} - ${endRaw}`,
      startTime,
      endTime,
      position: roleInfo.role,
      phone: "",
      crewNeeded: qty,
      dayType: roleInfo.dayType,
      clientRate: rate,
      amount,
      sourceAmount: amountRaw,
      reviewFlags,
    });
  }

  if (!rows.length) return null;
  const dates = rows.map((row) => row.date).sort();
  const parsedLineTotal = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  if (estimateTotal != null && Math.abs(parsedLineTotal - estimateTotal) > 0.01) needsReview.push("Estimate total does not match parsed lines");
  if (!client) needsReview.push("Missing client");
  if (!venue) needsReview.push("Missing venue");
  if (!eventName) needsReview.push("Missing event name");
  if (!city || !state) needsReview.push("No exact crew pool match found");

  const event_location = [streetAddress, [city, state].filter(Boolean).join(", ")].filter(Boolean).join(" ");
  return {
    show: {
      name: compactSpaces(overrides.name || eventName || "Imported Event"),
      show_reference_number: compactSpaces(overrides.show_reference_number || showReference),
      estimate_number: compactSpaces(estimateNumber),
      estimate_date: estimateDate ? parseImportDate(estimateDate, Number(dates[0]?.slice(0, 4)) || new Date().getFullYear()) : "",
      estimate_total: estimateTotal,
      parsed_line_total: Math.round(parsedLineTotal * 100) / 100,
      import_format: "estimate",
      client: compactSpaces(overrides.client || client),
      venue: compactSpaces(overrides.venue || titleCaseVenue(venue)),
      event_location: compactSpaces(overrides.event_location || event_location),
      rate_city: compactSpaces(overrides.rate_city || estimateCrewPool(city, state)),
      show_start: overrides.show_start || dates[0],
      show_end: overrides.show_end || dates[dates.length - 1],
      notes: [overrides.notes, estimateImportNotes({ estimateNumber, estimateDate, showReference, estimateTotal, parsedLineTotal, needsReview })].filter(Boolean).join("\n"),
    },
    rows,
    sourceType: "csv",
    importFormat: "estimate",
    needsReview: [...new Set(needsReview)].filter(Boolean),
  };
}

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
  const clean = compactSpaces(line);
  const dateRegex = new RegExp(`^(?:${WEEKDAY_PREFIX.source})?(${ISO_DATE_PATTERN}|${MONTH_DATE_PATTERN}|${NUMERIC_DATE_PATTERN})(?=\\s|$|,)`, "i");
  const match = clean.match(dateRegex);
  if (!match) return null;
  const rawDate = match[1];
  const date = parseImportDate(rawDate, fallbackYear);
  if (!date) return null;
  return {
    rawDate,
    date,
    rest: compactSpaces(clean.slice(match[0].length)),
  };
}

function stripPdfHeaderGlue(line: string) {
  return compactSpaces(line)
    .replace(/Dates\s+Name\s+PO\s+Times?\s+Position\s+Contact\s+Number/gi, " ")
    .replace(/Date\s+Name\s+PO\s+Times?\s+Position\s+Contact\s+Number/gi, " ")
    .replace(/Dates\s+Name\s+Times?\s+Position\s+Contact\s+Number/gi, " ")
    .replace(/Date\s+Name\s+Times?\s+Position\s+Contact\s+Number/gi, " ")
    .replace(/^Contact\s*$/i, "")
    .replace(/^Number\s*$/i, "")
    .trim();
}

function isTableHeaderLine(line: string) {
  return /^(dates?|day)\s+name(?:\s+po)?\s+times?\s+position/i.test(line) || /^name(?:\s+po)?\s+times?\s+position/i.test(line) || /^contact\s+number$/i.test(line);
}

function isMetadataLine(line: string) {
  return /^(show|event\s*name|client|venue|address|location|dates?|project\s*manager|assistant\s*pm|crew\s*lead|contact|coordinator|nmr\s*contact|lead\s*\/\s*coordinator|gear|notes?)\s*(?::|\s+)/i.test(line);
}

function isNonLaborNote(line: string) {
  return /\bon\s*call\b/i.test(line) || /^available\b/i.test(line);
}

function lineHasTime(line: string) {
  return new RegExp(TIME_PATTERN, "i").test(line);
}

function lineHasPhone(line: string) {
  PHONE_PATTERN.lastIndex = 0;
  const result = PHONE_PATTERN.test(line);
  PHONE_PATTERN.lastIndex = 0;
  return result;
}

function isLikelySectionLine(line: string) {
  const clean = stripPdfHeaderGlue(line);
  if (!clean || isTableHeaderLine(clean) || isMetadataLine(clean) || isNonLaborNote(clean)) return false;
  if (dateStartFromLine(clean, inferDefaultYear([clean]))) return false;
  if (lineHasTime(clean)) return false;
  if (lineHasPhone(clean)) return false;
  return /\b(booth|po\s*\d+|po\d+|floaters?|loaders?|truck|breakout|general\s+session|room|stage|registration|exhibit|strike|load[-\s]?in|dismantle|install|meeting\s+suites?|medical|warehouse|luxottica|optos|genentech|novartis|ardelyx|fresenius|merck|sanofi|ionis|novo|corcept|axs?ome|esperion|asahi|otsuka)\b|#\s*[A-Z0-9-]+/i.test(clean);
}

function isSectionContinuation(line: string) {
  const clean = compactSpaces(line);
  return /^\(?\s*PO\s*\d+/i.test(clean) || /^\(PO\d+/i.test(clean) || /^\([^)]+\)$/i.test(clean);
}

function removePhoneNumbers(value: string) {
  PHONE_PATTERN.lastIndex = 0;
  const phones = [...value.matchAll(PHONE_PATTERN)].map((match) => cleanPhone(match[0]));
  PHONE_PATTERN.lastIndex = 0;
  const withoutPhones = value.replace(PHONE_PATTERN, " ");
  PHONE_PATTERN.lastIndex = 0;
  return { withoutPhones: compactSpaces(withoutPhones), phone: phones[phones.length - 1] || "" };
}

function timeMatches(value: string) {
  const regex = new RegExp(TIME_PATTERN, "gi");
  return [...value.matchAll(regex)].map((match) => ({ text: match[0], index: match.index ?? 0 }));
}

function cleanImportedName(value: string) {
  return compactSpaces(value)
    .replace(/\bPO\s*\d+\b/gi, " ")
    .replace(/\([^)]*PO\s*\d+[^)]*\)/gi, " ")
    .replace(/^[-|]+|[-|]+$/g, "")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeImportedPosition(value: string) {
  const clean = compactSpaces(value)
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\bPO\s*\d+\b/gi, " ")
    .replace(/\bContact\s+Number\b/gi, " ")
    .replace(/\((?:WL|Waitlist)\)/gi, " ")
    .replace(/^[-|()]+|[-|()]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const key = normalize(clean);
  if (!key) return "Imported Crew";

  // Canonical role names used by master rates / payout estimates.
  // These keep PDF wording variations from creating $0 roles like "LED" or "CF AVT".
  if (/\bworking\s+crew\s+lead\b/.test(key)) {
    if (/\bled\b/.test(key) && /\bassist\b/.test(key)) return "LED Assist (Working Crew Lead)";
    return compactSpaces(clean.replace(/\(\s*working\s+crew\s+lead\s*\)/gi, "(Working Crew Lead)"));
  }
  if (/\bled\b/.test(key) && /\bstagehand\b/.test(key)) return "LED Assist";
  if (key === "led" || key === "led tech" || key === "led technician" || key === "led assist") return "LED Assist";

  if (key === "cf avt" || key === "client facing avt" || key === "client facing av tech" || key === "client facing audio visual tech" || key === "client facing audiovisual tech") {
    return "Client Facing Audio Visual Tech";
  }

  if (key === "gav" || key === "general av" || key === "general audio visual" || key === "avt" || key === "av tech" || key === "audio visual tech" || key === "audio visual technician") {
    return "General AV";
  }

  if (key === "l2" || key === "lighting assist" || key === "lighting assistant") return "Lighting Assist";
  if (key === "a2" || key === "audio assist" || key === "audio assistant") return "Audio Assist";
  if (key === "v2" || key === "video assist" || key === "video assistant") return "Video Assist";
  if (key === "warehouse" || key === "warehouse worker" || key === "warehouse workers") return "Warehouse Worker";

  return clean;
}

function normalizeEstimateRole(roleRaw: string, explicitDayTypeRaw = "") {
  const halfDay = /\bhalf\s*day\b/i.test(roleRaw) || /\bhalf\s*day\b/i.test(explicitDayTypeRaw);
  const cleanRole = compactSpaces(roleRaw.replace(/\(\s*half\s*day\s*\)/gi, "").replace(/\bhalf\s*day\b/gi, ""));
  const normalized = canonicalizeImportedPosition(cleanRole);
  const key = normalize(normalized);
  const role = key === "general av tech" || key === "general av technician" ? "General AV" : normalized;
  return { role, dayType: halfDay ? "half_day" as const : "full_day" as const };
}

function estimateLineReviewFlags(options: {
  startTime: string;
  endTime: string;
  startRaw: string;
  endRaw: string;
  qtyRaw: string;
  rate: number | null;
  amount: number | null;
  qty: number;
}) {
  const flags: string[] = [];
  if (!options.startTime || !options.endTime) flags.push("Time requires review");
  if (!Number.isFinite(Number(options.qtyRaw)) || Number(options.qtyRaw) <= 0) flags.push("Invalid Qty");
  if (options.rate == null) flags.push("Missing rate");
  if (options.amount == null) flags.push("Missing amount");
  if (options.rate != null && options.amount != null) {
    const expected = Math.round(options.qty * options.rate * 100) / 100;
    if (Math.abs(expected - options.amount) > 0.01) flags.push("Line amount requires review");
  }
  const startHour = Number((options.startTime || "0").slice(0, 2));
  if (options.startTime && options.endTime && options.endTime < options.startTime && startHour < 18) {
    flags.push(`Time requires review: ${compactSpaces(options.startRaw)} → ${compactSpaces(options.endRaw)}`);
  }
  return flags;
}

function estimateImportNotes(options: {
  estimateNumber?: string;
  estimateDate?: string;
  showReference?: string;
  estimateTotal?: number | null;
  parsedLineTotal?: number | null;
  needsReview?: string[];
}) {
  return [
    "Imported from ELS standard estimate format.",
    options.estimateNumber ? `Estimate number: ${options.estimateNumber}` : "",
    options.estimateDate ? `Estimate date: ${options.estimateDate}` : "",
    options.showReference ? `Show reference verification: ${options.showReference}` : "",
    options.estimateTotal != null ? `Estimate Total: $${options.estimateTotal.toFixed(2)}` : "",
    options.parsedLineTotal != null ? `Parsed Line Total: $${options.parsedLineTotal.toFixed(2)}` : "",
    options.estimateTotal != null && options.parsedLineTotal != null && Math.abs(options.estimateTotal - options.parsedLineTotal) <= 0.01
      ? "Total verified"
      : "",
    options.needsReview?.length ? `Needs Review: ${[...new Set(options.needsReview)].join("; ")}` : "",
  ].filter(Boolean).join("\n");
}

function cleanPosition(value: string) {
  const clean = compactSpaces(value)
    .replace(/^[-|]+|[-|]+$/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\bPO\s*\d+\b/gi, " ")
    .replace(/\bContact\s+Number\b/gi, " ")
    .replace(/\b(confirmed|tentative|pending|scheduled|cancelled|canceled)\b/gi, " ")
    .replace(/[()]+$/g, " ")
    .replace(/^[-|]+|[-|]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return canonicalizeImportedPosition(clean || "Imported Crew");
}

function choosePosition(afterEnd: string, betweenTimes: string) {
  const after = cleanPosition(afterEnd);
  if (after && after !== "Imported Crew") return after;

  const between = cleanPosition(
    betweenTimes
      .replace(/^\|+/, "")
      .replace(/\|+$/g, "")
      .replace(/\bto\b/gi, " ")
  );
  return between && between !== "Imported Crew" ? between : "Imported Crew";
}

function parseCrewCandidateRow(record: string, area: string, fallbackYear: number): ImportedCrewRow | null {
  const cleanRecord = stripPdfHeaderGlue(record);
  const dateInfo = dateStartFromLine(cleanRecord, fallbackYear);
  if (!dateInfo) return null;

  let rest = stripPdfHeaderGlue(dateInfo.rest)
    .replace(/^,\s*/, "")
    .replace(/^20\d{2}\s+/, "")
    .trim();

  if (!rest || isNonLaborNote(rest)) return null;

  const { withoutPhones, phone } = removePhoneNumbers(rest);
  const times = timeMatches(withoutPhones);
  if (times.length < 2) return null;

  const firstTime = times[0];
  const secondTime = times[1];
  const nameText = cleanImportedName(withoutPhones.slice(0, firstTime.index));
  const betweenTimes = withoutPhones.slice(firstTime.index + firstTime.text.length, secondTime.index);
  const afterEnd = withoutPhones.slice(secondTime.index + secondTime.text.length);
  const position = choosePosition(afterEnd, betweenTimes);

  if (!nameText || /^(name|dates?|date|po)$/i.test(nameText)) return null;
  if (/\bon\s*call\b/i.test(position)) return null;

  const { timeRange, startTime, endTime } = parseTimeRange(`${firstTime.text} - ${secondTime.text}`);
  if (!startTime || !endTime) return null;

  return {
    area: compactSpaces(area || "Imported Call"),
    date: dateInfo.date,
    name: nameText,
    timeRange,
    startTime,
    endTime,
    position,
    phone,
  };
}

function extractShowDateRange(line: string, fallbackYear: number) {
  const value = line.replace(/^dates?\s*(?::|\s+)/i, "").trim();
  const isoRange = value.match(/(20\d{2}-\d{1,2}-\d{1,2})\s*(?:-|\bto\b)\s*(20\d{2}-\d{1,2}-\d{1,2})/i);
  if (isoRange) {
    const start = parseImportDate(isoRange[1], fallbackYear);
    const end = parseImportDate(isoRange[2], fallbackYear);
    if (start && end) return { start, end };
  }
  const parts = value.split(/\s+(?:-|\bto\b)\s+/i).map((part) => compactSpaces(part)).filter(Boolean);
  if (parts.length < 2) return null;
  const start = parseImportDate(parts[0], fallbackYear);
  let end = parseImportDate(parts[1], fallbackYear);
  if (!end && /^\d{1,2}[\/.-]\d{1,2}$/.test(parts[1]) && start) {
    end = parseImportDate(parts[1], Number(start.slice(0, 4)));
  }
  return start && end ? { start, end } : null;
}

function fullWeekdayName(raw: string) {
  const value = raw.toLowerCase();
  if (value.startsWith("mon")) return "Monday";
  if (value.startsWith("tue")) return "Tuesday";
  if (value.startsWith("wed")) return "Wednesday";
  if (value.startsWith("thu")) return "Thursday";
  if (value.startsWith("fri")) return "Friday";
  if (value.startsWith("sat")) return "Saturday";
  if (value.startsWith("sun")) return "Sunday";
  return raw;
}

function parseWeekdayFragment(line: string) {
  const match = compactSpaces(line).match(/^(mon(?:day)?|tue(?:sday)?|tues|wed(?:nesday)?|wednes|thu(?:rsday)?|thurs?|fri(?:day)?|sat(?:urday)?|satur|sun(?:day)?)[,\s]*(.*)$/i);
  if (!match) return null;
  return { weekday: fullWeekdayName(match[1]), rest: compactSpaces(match[2] || "") };
}

function monthStartInfo(line: string) {
  const clean = compactSpaces(line).replace(/^,\s*/, "");
  const regex = new RegExp(`^(${MONTH_DATE_PATTERN})(?=\\s|$|,)`, "i");
  const match = clean.match(regex);
  if (!match) return null;
  return {
    rawDate: match[1],
    rest: compactSpaces(clean.slice(match[0].length).replace(/^,\s*/, "")),
  };
}

function splitDayMonthInfo(line: string, nextLine: string | undefined) {
  const clean = compactSpaces(line);
  const split = clean.match(/^day,?\s+([A-Za-z]+)(?:\s+(.*))?$/i);
  if (!split || !nextLine) return null;
  const next = compactSpaces(nextLine);
  const dayYear = next.match(/^(\d{1,2})(?:,?\s*(\d{2,4}))?(?:\s+(.*))?$/);
  if (!dayYear) return null;
  const rawDate = `${split[1]} ${dayYear[1]}${dayYear[2] ? `, ${dayYear[2]}` : ""}`;
  return {
    rawDate,
    rest: compactSpaces(`${split[2] || ""} ${dayYear[3] || ""}`),
  };
}

function repairSplitDateLines(lines: string[]) {
  const repaired: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const weekday = parseWeekdayFragment(line);

    if (weekday && !monthStartInfo(line)) {
      const next = lines[index + 1] || "";
      const nextMonth = monthStartInfo(next);
      if (nextMonth) {
        repaired.push(compactSpaces(`${weekday.weekday}, ${nextMonth.rawDate} ${weekday.rest} ${nextMonth.rest}`));
        index += 1;
        continue;
      }

      const dayMonth = splitDayMonthInfo(next, lines[index + 2]);
      if (dayMonth) {
        repaired.push(compactSpaces(`${weekday.weekday}, ${dayMonth.rawDate} ${weekday.rest} ${dayMonth.rest}`));
        index += 2;
        continue;
      }
    }

    repaired.push(line);
  }

  return repaired;
}

function normalizeCorruptedPdfTimes(line: string) {
  return compactSpaces(line)
    // Some embedded PDF fonts extract 8:00 AM as 8 00 AM. Convert only when AM/PM is present.
    .replace(/\b(\d{1,2})\s+(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi, "$1:$2 $3")
    .replace(/\b(\d{1,2}:\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi, "$1 $2");
}

function splitEmbeddedDateRows(line: string) {
  const clean = normalizeCorruptedPdfTimes(line);
  if (!clean || isMetadataLine(clean) || isTableHeaderLine(clean)) return [clean].filter(Boolean);

  const weekdayMarker = "(?:mon(?:day)?|tue(?:sday)?|tues|wed(?:nesday)?|wednes|thu(?:rsday)?|thurs?|fri(?:day)?|sat(?:urday)?|satur|sun(?:day)?)[,\\s]+";
  const dateMarker = new RegExp(`(?:^|\\s+|\\|\\s*)((?:${weekdayMarker})?(?:${MONTH_DATE_PATTERN}|${NUMERIC_DATE_PATTERN}))(?=\\s+[A-Za-z])`, "gi");
  const starts: number[] = [];
  for (const match of clean.matchAll(dateMarker)) {
    const captureIndex = match.index ?? 0;
    const leading = match[0].indexOf(match[1]);
    starts.push(captureIndex + leading);
  }

  if (starts.length <= 1) return [clean];

  const pieces: string[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = starts[index + 1] ?? clean.length;
    const piece = compactSpaces(clean.slice(start, end).replace(/^\|\s*/, ""));
    if (piece) pieces.push(piece);
  }
  return pieces;
}

function explodeEmbeddedDateRows(lines: string[]) {
  const expanded: string[] = [];
  for (const line of lines) {
    expanded.push(...splitEmbeddedDateRows(line));
  }
  return expanded;
}

function preprocessPdfLines(text: string) {
  const lines = cleanPdfArtifacts(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => stripPdfHeaderGlue(normalizeCorruptedPdfTimes(line)))
    .filter(Boolean)
    .filter((line) => !/^page\s+\d+/i.test(line));

  return explodeEmbeddedDateRows(repairSplitDateLines(lines));
}

function extractFollowingLines(lines: string[], label: RegExp, stopLabels: RegExp[], maxLines = 4) {
  const start = lines.findIndex((line) => label.test(line));
  if (start < 0) return [];
  const values: string[] = [];
  for (let index = start + 1; index < lines.length && values.length < maxLines; index += 1) {
    const line = compactSpaces(lines[index]);
    if (!line) continue;
    if (stopLabels.some((stop) => stop.test(line))) break;
    values.push(line);
  }
  return values;
}

function collapseRepeatedAdjacentText(value: string) {
  const clean = compactSpaces(value);
  if (!clean) return "";
  const words = clean.split(/\s+/);
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(" ");
    const right = words.slice(half).join(" ");
    if (normalize(left) === normalize(right)) return left;
  }
  return clean.replace(/\b(.+?)\s+\1\b/gi, "$1").trim();
}

function splitRepeatedTwoColumnLine(value: string) {
  const clean = compactSpaces(value);
  if (!clean) return null;
  const words = clean.split(/\s+/);
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const left = words.slice(0, half).join(" ");
    const right = words.slice(half).join(" ");
    if (normalize(left) === normalize(right)) return [left, right] as const;
  }
  return null;
}

function looksLikeStreetAddress(value: string) {
  return /^\d+\s+\S+/i.test(compactSpaces(value));
}

function looksLikeCityStateZip(value: string) {
  const parsed = parseCityStateFromAddress(value);
  return Boolean(parsed.city && parsed.state);
}

function firstNonAddressLine(lines: string[]) {
  return lines
    .map(collapseRepeatedAdjacentText)
    .find((line) => line && !looksLikeStreetAddress(line) && !looksLikeCityStateZip(line)) || "";
}

function firstStreetAddressLine(lines: string[]) {
  return lines.map(collapseRepeatedAdjacentText).find(looksLikeStreetAddress) || "";
}

function firstCityStateLine(lines: string[]) {
  return lines.map(collapseRepeatedAdjacentText).find(looksLikeCityStateZip) || "";
}

function normalizeBillShipBlock(lines: string[]) {
  const clean = lines.map(collapseRepeatedAdjacentText).filter(Boolean);
  return {
    name: firstNonAddressLine(clean),
    streetAddress: firstStreetAddressLine(clean),
    cityState: firstCityStateLine(clean),
    lines: clean,
  };
}

function extractEstimateBillShip(lines: string[]) {
  const stopLabels = [/^Ship\s+to$/i, /^Estimate details$/i, /^Bill\s+to$/i, /^#$/i, /^Service Date/i, /^Note to customer$/i, /^Total$/i];
  const billTo = normalizeBillShipBlock(extractFollowingLines(lines, /^Bill\s+to$/i, stopLabels, 4));
  const shipTo = normalizeBillShipBlock(extractFollowingLines(lines, /^Ship\s+to$/i, stopLabels, 4));
  if (billTo.lines.length || shipTo.lines.length) return { billTo, shipTo };

  const combinedIndex = lines.findIndex((line) => /^Bill\s+to\s+Ship\s+to$/i.test(line));
  if (combinedIndex < 0) return { billTo, shipTo };

  const combinedRows: string[] = [];
  for (let index = combinedIndex + 1; index < lines.length && combinedRows.length < 4; index += 1) {
    const line = compactSpaces(lines[index]);
    if (!line) continue;
    if (stopLabels.some((stop) => stop.test(line))) break;
    combinedRows.push(line);
  }

  const splitRows = combinedRows.map(splitRepeatedTwoColumnLine);
  if (splitRows.some(Boolean)) {
    return {
      billTo: normalizeBillShipBlock(splitRows.map((row, index) => row?.[0] || collapseRepeatedAdjacentText(combinedRows[index])).filter(Boolean)),
      shipTo: normalizeBillShipBlock(splitRows.map((row, index) => row?.[1] || collapseRepeatedAdjacentText(combinedRows[index])).filter(Boolean)),
    };
  }

  const first = compactSpaces(lines[combinedIndex + 1] || "");
  const second = compactSpaces(lines[combinedIndex + 2] || "");
  const third = compactSpaces(lines[combinedIndex + 3] || "");
  const venueMatch = first.match(/^(.+?)\s+([A-Z0-9&'.,\-\s]+(?:CONVENTION\s+CENTER|EXPO\s+CENTER|CENTER|HOTEL|RESORT|MARRIOTT|HYATT|HILTON|SHERATON|VENUE))$/);
  const addressMatch = second.match(/^(.+?)\s+(\d+\s+.+)$/i);
  const cityStateMatch = third.match(/^(.+?\b[A-Z]{2}\s+\d{5}(?:-\d{4})?)\s+(.+?,\s*[A-Z]{2})$/i);

  return {
    billTo: normalizeBillShipBlock([
      compactSpaces(venueMatch?.[1] || first),
      compactSpaces(addressMatch?.[1] || ""),
      compactSpaces(cityStateMatch?.[1] || third),
    ].filter(Boolean)),
    shipTo: normalizeBillShipBlock([
      titleCaseLoose(venueMatch?.[2] || ""),
      titleCaseLoose(addressMatch?.[2] || ""),
      cityStateMatch?.[2] ? compactSpaces(cityStateMatch[2]) : "",
    ].filter(Boolean)),
  };
}

function estimateImportDebug(lines: string[], reconstructedRows: string[], groupingHeaders: string[], rejectedRows: string[]) {
  const joined = lines.join("\n");
  return {
    extractedRows: lines.slice(0, 120),
    reconstructedRows: reconstructedRows.slice(0, 120),
    detectedDates: [...new Set((joined.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g) || []))].slice(0, 120),
    detectedCurrencyValues: [...new Set((joined.match(/\$[\d,]+(?:\.\d{2})?/g) || []))].slice(0, 120),
    detectedGroupingHeaders: [...new Set(groupingHeaders)].slice(0, 120),
    rejectedRows: [...new Set(rejectedRows)].slice(0, 120),
  };
}

function cleanEstimateGroupArea(value: string) {
  return compactSpaces(value)
    .replace(/^(?:Subtotal\b[:\s-]*)+/i, "")
    .replace(/\bSubtotal\b/gi, " ")
    .replace(/\bArea(?=[A-Z])/g, "Area ")
    .replace(/\bBooth(?=[A-Z0-9])/g, "Booth ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEstimateSubtotalPrefix(value: string) {
  return compactSpaces(value).replace(/^(?:Subtotal\b[:\s-]*)+/i, "").trim();
}

function isZeroEstimateArtifactLine(line: string) {
  const clean = compactSpaces(line);
  if (!clean) return false;
  const stripped = clean
    .replace(/\$0(?:\.00)?/gi, " ")
    .replace(/\b0(?:\.0+)?\b/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return stripped === "";
}

function parseEstimateGroupHeaderLine(line: string, fallbackYear: number) {
  const clean = compactSpaces(line);
  const hadSubtotalPrefix = /^Subtotal\b/i.test(clean);
  const headerText = hadSubtotalPrefix ? stripEstimateSubtotalPrefix(clean) : clean;
  if (!headerText || /^Total\b/i.test(headerText) || /^Note to customer\b/i.test(headerText)) return null;
  if (dateStartFromLine(headerText, fallbackYear) || lineHasTime(headerText) || lineHasPhone(headerText)) return null;

  const leadingNumber = headerText.match(/^\d+\.\s*/);
  let working = compactSpaces(headerText.replace(/^\d+\.\s*/, ""));
  const currencyValues = [...working.matchAll(/\$[\d,]+(?:\.\d{2})?/g)].map((match) => moneyNumber(match[0]));
  if (currencyValues.some((value) => value != null && value !== 0)) return null;
  working = compactSpaces(working.replace(/\$0(?:\.00)?/gi, " "));

  const poMatch = working.match(/\b(PO\s*[A-Z0-9-]+)\b/i);
  const boothMatch = working.match(/\bBooth\s*:?\s*([A-Z0-9-]+|TBD)\b/i);
  const poNumber = poMatch ? compactSpaces(poMatch[1].replace(/\s+/g, "")) : "";
  const boothNumber = boothMatch ? compactSpaces(boothMatch[1]) || "TBD" : "";

  if (poMatch) working = compactSpaces(working.replace(poMatch[0], " "));
  if (boothMatch) working = compactSpaces(working.replace(boothMatch[0], " "));
  working = compactSpaces(working.replace(/\b0(?:\.0+)?\b/g, " "));

  const area = cleanEstimateGroupArea(working);
  const hasHeaderEvidence = Boolean(hadSubtotalPrefix || leadingNumber || poNumber || boothNumber || currencyValues.length);
  if (!area || !hasHeaderEvidence) return null;
  if (/^(service date|product\/service|description|qty|rate|amount|accepted by)$/i.test(area)) return null;
  return { area, boothNumber, poNumber };
}

function isEstimateGroupContinuationLine(line: string, fallbackYear: number) {
  const clean = compactSpaces(line);
  const continuationText = /^Subtotal\b/i.test(clean) ? stripEstimateSubtotalPrefix(clean) : clean;
  if (!continuationText || /^Total\b/i.test(continuationText) || /^Note to customer\b/i.test(continuationText)) return false;
  if (dateStartFromLine(continuationText, fallbackYear) || lineHasTime(continuationText) || lineHasPhone(continuationText) || isZeroEstimateArtifactLine(continuationText)) return false;
  if (/\$[\d,]+(?:\.\d{2})?/.test(continuationText)) return false;
  if (/^\d+\./.test(continuationText)) return false;
  if (/^(?:Booth|PO)\b/i.test(continuationText)) return false;
  return /^[A-Z0-9&'.,\-/ ]{3,}$/.test(continuationText);
}

function lineLooksLikeQuickBooksLaborStart(line: string) {
  return /^\d+\.\s*\d{1,2}\/\d{1,2}\/\d{2,4}/.test(compactSpaces(line)) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(compactSpaces(line));
}

function lineHasQuickBooksLaborColumns(line: string) {
  const clean = compactSpaces(line);
  const currencyCount = (clean.match(/\$[\d,]+(?:\.\d{2})?/g) || []).length;
  const timeCount = (clean.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi) || []).length;
  return currencyCount >= 2 && timeCount >= 2;
}

function reconstructEstimateRows(lines: string[]) {
  const reconstructed: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = compactSpaces(lines[index]);
    if (!line) continue;

    if (!lineLooksLikeQuickBooksLaborStart(line)) {
      reconstructed.push(line);
      continue;
    }

    let combined = line;
    let lookahead = index + 1;
    while (
      !lineHasQuickBooksLaborColumns(combined) &&
      lookahead < lines.length &&
      lookahead <= index + 5 &&
      !lineLooksLikeQuickBooksLaborStart(lines[lookahead]) &&
      !/^\d+\.(?!\d{1,2}\/\d{1,2}\/\d{2,4})/.test(compactSpaces(lines[lookahead])) &&
      !/^Subtotal/i.test(compactSpaces(lines[lookahead]))
    ) {
      combined = compactSpaces(`${combined} ${lines[lookahead]}`);
      if (lineHasQuickBooksLaborColumns(combined)) break;
      lookahead += 1;
    }
    reconstructed.push(combined);
    index = Math.max(index, lookahead - 1);
  }
  return reconstructed;
}

function describeRejectedEstimateRow(line: string) {
  const clean = compactSpaces(line);
  if (/^(Estimate date|Accepted date)\b/i.test(clean)) return null;
  if (!/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(clean)) return null;
  if (!/\$[\d,]+(?:\.\d{2})?/.test(clean)) return `Row rejected: found date but no rate/amount currency values — ${clean}`;
  const currencyCount = (clean.match(/\$[\d,]+(?:\.\d{2})?/g) || []).length;
  if (currencyCount < 2) return `Row rejected: found date and one currency value but no amount — ${clean}`;
  if (!/\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(clean)) return `Row rejected: found date and rate but no start/end time — ${clean}`;
  const timeCount = (clean.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi) || []).length;
  if (timeCount < 2) return `Row rejected: found date and rate but no end time — ${clean}`;
  return `Row rejected: date/time/rate found but QuickBooks labor structure was not recognized — ${clean}`;
}

function parseEstimateLaborLine(line: string, currentGroup: { area: string; boothNumber: string; poNumber: string }, fallbackYear: number): ImportedCrewRow | null {
  const clean = compactSpaces(line).replace(/^\d+\.\s*/, "");
  const dateMatch = clean.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})(.+)$/);
  if (!dateMatch) return null;
  const date = parseImportDate(dateMatch[1], fallbackYear);
  if (!date) return null;
  const rest = dateMatch[2];
  const timeMatches = [...rest.matchAll(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi)];
  if (timeMatches.length < 2) return null;

  const startRaw = timeMatches[0][0];
  const endRaw = timeMatches[1][0];
  const roleRaw = compactSpaces(rest.slice(0, timeMatches[0].index ?? 0));
  const afterEnd = rest.slice((timeMatches[1].index ?? 0) + endRaw.length);
  const currencyMatches = [...afterEnd.matchAll(/\$[\d,]+(?:\.\d{2})?/g)];
  if (currencyMatches.length < 2) return null;

  const rateMatch = currencyMatches[0];
  const amountMatch = currencyMatches[1];
  const rateRaw = rateMatch[0];
  const amountRaw = amountMatch[0];
  const beforeRate = compactSpaces(afterEnd.slice(0, rateMatch.index ?? afterEnd.length));
  const qtyRaw = beforeRate.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*$/)?.[1] || "1";
  const roleInfo = normalizeEstimateRole(roleRaw);
  const startTime = to24Hour(startRaw);
  const endTime = to24Hour(endRaw);
  const qty = Math.max(1, Math.floor(Number(qtyRaw) || 1));
  const rate = moneyNumber(rateRaw);
  const amount = moneyNumber(amountRaw);
  const reviewFlags = estimateLineReviewFlags({ startTime, endTime, startRaw, endRaw, qtyRaw, rate, amount, qty });

  return {
    area: currentGroup.area || "Imported Call",
    boothNumber: currentGroup.boothNumber || "TBD",
    poNumber: currentGroup.poNumber || "",
    date,
    name: "",
    timeRange: `${compactSpaces(startRaw)} - ${compactSpaces(endRaw)}`,
    startTime,
    endTime,
    position: roleInfo.role,
    phone: "",
    crewNeeded: qty,
    dayType: roleInfo.dayType,
    clientRate: rate,
    amount,
    sourceAmount: amountRaw,
    reviewFlags,
  };
}

function parseEstimatePdfText(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData | null {
  const lines = preprocessPdfLines(text);
  if (!looksLikeEstimate(lines.join("\n"))) return null;
  const reconstructedRows = reconstructEstimateRows(lines);
  const groupingHeaders: string[] = [];
  const rejectedRows: string[] = [];

  const needsReview: string[] = [];
  const { billTo, shipTo } = extractEstimateBillShip(lines);
  const client = billTo.name || "";
  const venue = shipTo.name || "";
  const streetAddress = shipTo.streetAddress || "";
  const cityState = parseCityStateFromAddress(shipTo.cityState || "");
  const estimateNoLine = lines.find((line) => /^Estimate no\.?\s*:/i.test(line)) || "";
  const estimateNoMatch = estimateNoLine.match(/^Estimate no\.?\s*:\s*([^\s(]+)(?:\s*\(([^)]+)\))?/i);
  const estimateNumber = compactSpaces(estimateNoMatch?.[1] || "");
  const estimateReference = compactSpaces(estimateNoMatch?.[2] || "");
  const estimateDateLine = lines.find((line) => /^Estimate date\s*:/i.test(line)) || "";
  const estimateDateRaw = compactSpaces(estimateDateLine.replace(/^Estimate date\s*:\s*/i, ""));
  const eventLine = lines.find((line) => /\bEvent\s*:/i.test(line)) || "";
  const eventParts = splitEstimateEventField(eventLine.replace(/^.*?\bEvent\s*:\s*/i, ""));
  const totalLineIndex = lines.findIndex((line) => /^Total$/i.test(line));
  const totalCandidate = totalLineIndex >= 0 ? lines[totalLineIndex + 1] : lines.find((line) => /^Total\s+\$/.test(line));
  const estimateTotal = moneyNumber(String(totalCandidate || "").replace(/^Total/i, ""));
  const fallbackYear = inferDefaultYear(lines);
  const estimateDate = estimateDateRaw ? parseImportDate(estimateDateRaw, fallbackYear) : "";

  if (eventParts.showReference && estimateReference && normalize(eventParts.showReference) !== normalize(estimateReference)) {
    needsReview.push(`Show Reference Number mismatch: Event ${eventParts.showReference}; Estimate ${estimateReference}`);
  }

  const rows: ImportedCrewRow[] = [];
  const currentGroup = { area: "", boothNumber: "TBD", poNumber: "" };
  let groupOpenForContinuation = false;

  for (const rawLine of reconstructedRows) {
    const line = compactSpaces(rawLine);
    if (!line || /^Service DateProduct/i.test(line) || /^#$/i.test(line)) continue;
    if (/^Subtotal\b/i.test(line) && !stripEstimateSubtotalPrefix(line)) {
      currentGroup.area = "";
      currentGroup.boothNumber = "TBD";
      currentGroup.poNumber = "";
      groupOpenForContinuation = true;
      continue;
    }

    if (isZeroEstimateArtifactLine(line)) continue;

    const groupHeader = parseEstimateGroupHeaderLine(line, fallbackYear);
    if (groupHeader) {
      currentGroup.area = groupHeader.area;
      currentGroup.boothNumber = groupHeader.boothNumber || "TBD";
      currentGroup.poNumber = groupHeader.poNumber || "";
      groupingHeaders.push(currentGroup.area);
      groupOpenForContinuation = true;
      continue;
    }

    const boothMatch = line.match(/^Booth\s*:?\s*(.+)$/i);
    if (boothMatch) {
      currentGroup.boothNumber = compactSpaces(boothMatch[1]) || "TBD";
      groupOpenForContinuation = true;
      continue;
    }

    const poMatch = line.match(/\b(PO\s*\d+[A-Z0-9-]*)\b/i);
    if (poMatch && !dateStartFromLine(line, fallbackYear)) {
      currentGroup.poNumber = compactSpaces(poMatch[1].replace(/\s+/g, ""));
      groupOpenForContinuation = true;
      continue;
    }

    if (groupOpenForContinuation && isEstimateGroupContinuationLine(line, fallbackYear)) {
      currentGroup.area = cleanEstimateGroupArea(`${currentGroup.area} ${line}`);
      groupingHeaders.push(currentGroup.area);
      continue;
    }

    const parsed = parseEstimateLaborLine(line, currentGroup, fallbackYear);
    if (parsed) {
      groupOpenForContinuation = false;
      if (!parsed.area) parsed.reviewFlags = [...(parsed.reviewFlags || []), "Missing booth"];
      if (!parsed.poNumber) parsed.reviewFlags = [...(parsed.reviewFlags || []), "Missing PO"];
      rows.push(parsed);
      needsReview.push(...(parsed.reviewFlags || []).map((flag) => `${parsed.date} ${parsed.area}: ${flag}`));
    } else {
      const rejected = describeRejectedEstimateRow(line);
      if (rejected) rejectedRows.push(rejected);
    }
  }

  if (!rows.length) {
    const debug = estimateImportDebug(lines, reconstructedRows, groupingHeaders, rejectedRows);
    throw new Error(`QuickBooks estimate import could not find labor rows. Debug: ${JSON.stringify(debug)}`);
  }

  if (!client) needsReview.push("Missing client");
  if (!venue) needsReview.push("Missing venue");
  if (!eventParts.eventName) needsReview.push("Missing event name");
  if (!cityState.city || !cityState.state) needsReview.push("No exact crew pool match found");
  const parsedLineTotal = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  if (estimateTotal != null && Math.abs(parsedLineTotal - estimateTotal) > 0.01) needsReview.push("Estimate total does not match parsed lines");

  const dates = rows.map((row) => row.date).sort();
  const showReference = compactSpaces(overrides.show_reference_number || eventParts.showReference || estimateReference);
  return {
    show: {
      name: compactSpaces(overrides.name || eventParts.eventName || "Imported Event"),
      show_reference_number: showReference,
      estimate_number: estimateNumber,
      estimate_date: estimateDate,
      estimate_total: estimateTotal,
      parsed_line_total: Math.round(parsedLineTotal * 100) / 100,
      import_format: "estimate",
      client: compactSpaces(overrides.client || client),
      venue: compactSpaces(overrides.venue || titleCaseVenue(venue)),
      event_location: compactSpaces(overrides.event_location || [titleCaseLoose(streetAddress), [cityState.city, cityState.state].filter(Boolean).join(", ")].filter(Boolean).join(" ")),
      rate_city: compactSpaces(overrides.rate_city || estimateCrewPool(cityState.city, cityState.state)),
      show_start: overrides.show_start || dates[0],
      show_end: overrides.show_end || dates[dates.length - 1],
      notes: [overrides.notes, estimateImportNotes({ estimateNumber, estimateDate, showReference: estimateReference, estimateTotal, parsedLineTotal, needsReview })].filter(Boolean).join("\n"),
    },
    rows,
    sourceType: "pdf",
    importFormat: "estimate",
    needsReview: [...new Set(needsReview)].filter(Boolean),
    importDebug: estimateImportDebug(lines, reconstructedRows, groupingHeaders, rejectedRows),
  };
}

function parsePdfText(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData {
  const estimate = parseEstimatePdfText(text, overrides);
  if (estimate) return estimate;

  const lines = preprocessPdfLines(text);

  let showName = overrides.name || "Imported Event";
  let client = overrides.client || "";
  let venue = overrides.venue || "";
  let location = overrides.event_location || "";
  let rateCity = overrides.rate_city || "Default";
  let showStart = overrides.show_start || "";
  let showEnd = overrides.show_end || "";
  const noteBits: string[] = [];
  const fallbackYear = inferDefaultYear(lines);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^show\s*:/i.test(line)) {
      showName = compactSpaces(line.replace(/^show\s*:/i, "")) || showName;
      continue;
    }
    if (/labor\s+call\s+list/i.test(line) && showName === "Imported Event") {
      const next = lines[index + 1];
      if (next && !isTableHeaderLine(next) && !isMetadataLine(next)) showName = next;
      continue;
    }
    if (/^event\s*name\s*:/i.test(line)) {
      showName = compactSpaces(line.replace(/^event\s*name\s*:/i, "")) || showName;
      continue;
    }
    if (/^client\s*(?::|\s+)/i.test(line)) {
      client = compactSpaces(line.replace(/^client\s*(?::|\s+)/i, ""));
      continue;
    }
    if (/^venue\s*(?::|\s+)/i.test(line)) {
      venue = compactSpaces(line.replace(/^venue\s*(?::|\s+)/i, ""));
      continue;
    }
    if (/^address\s*(?::|\s+)/i.test(line)) {
      location = compactSpaces(line.replace(/^address\s*(?::|\s+)/i, ""));
      continue;
    }
    if (/^location\s*(?::|\s+)/i.test(line)) {
      location = compactSpaces(line.replace(/^location\s*(?::|\s+)/i, ""));
      continue;
    }
    if (/^dates?\s*(?::|\s+)/i.test(line)) {
      const range = extractShowDateRange(line, fallbackYear);
      if (range) {
        showStart = showStart || range.start;
        showEnd = showEnd || range.end;
      }
      noteBits.push(line);
      continue;
    }
    if (/contact\s*:/i.test(line) || /coordinator\s*:/i.test(line) || /project\s*manager\s*:/i.test(line) || /crew\s*lead\s*:/i.test(line) || /lead\s*\/\s*coordinator\s*:/i.test(line)) {
      noteBits.push(line);
      continue;
    }
  }

  const rows: ImportedCrewRow[] = [];
  let currentSection = "Imported Call";
  const sectionQueue: string[] = [];
  let pendingRow = "";
  let rowBlockActive = false;
  let currentDayDate = "";

  const queueSection = (line: string) => {
    const clean = compactSpaces(line);
    if (!clean) return;
    sectionQueue.push(clean);
  };

  const activateQueuedSection = () => {
    const next = sectionQueue.shift();
    if (next) currentSection = next;
  };

  const appendSectionContinuation = (line: string) => {
    const clean = compactSpaces(line);
    if (!clean) return;
    if (sectionQueue.length) {
      sectionQueue[sectionQueue.length - 1] = compactSpaces(`${sectionQueue[sectionQueue.length - 1]} ${clean}`);
    } else if (currentSection !== "Imported Call") {
      currentSection = compactSpaces(`${currentSection} ${clean}`);
    } else {
      queueSection(clean);
    }
  };

  const finishPendingRow = () => {
    if (!pendingRow) return;
    const parsed = parseCrewCandidateRow(pendingRow, currentSection, fallbackYear);
    if (parsed) {
      rows.push(parsed);
      rowBlockActive = true;
    }
    pendingRow = "";
  };

  for (const rawLine of lines) {
    const line = stripPdfHeaderGlue(rawLine);
    if (!line) continue;

    const dayHeader = line.match(/^(20\d{2}-\d{1,2}-\d{1,2})\s*-\s*(.+)$/);
    if (dayHeader) {
      finishPendingRow();
      currentDayDate = parseImportDate(dayHeader[1], fallbackYear);
      currentSection = compactSpaces(dayHeader[2] || currentSection || "Imported Call");
      sectionQueue.length = 0;
      rowBlockActive = false;
      continue;
    }

    if (isTableHeaderLine(line)) {
      finishPendingRow();
      // Many real call-list PDFs stack booth headers before the table header. Use one queued
      // booth per table block. This also fixes page-break extraction where the next booth header
      // is emitted before the rows that visually continue from the previous page.
      activateQueuedSection();
      rowBlockActive = false;
      continue;
    }

    if (isNonLaborNote(line)) {
      finishPendingRow();
      continue;
    }

    const startsDate = dateStartFromLine(line, fallbackYear);
    if (startsDate) {
      finishPendingRow();
      // If a section was found and no row block has started yet, this is a table without a
      // visible header. Otherwise keep the current section until the next table header confirms
      // that the queued section belongs to a new block.
      if (!rowBlockActive && sectionQueue.length) activateQueuedSection();
      currentDayDate = startsDate.date;
      pendingRow = line;
      continue;
    }

    // App-generated day-separated PDFs list the date once as a section header,
    // then use rows like: Name 07:45:00-17:00:00 Warehouse worker Phone confirmed.
    if (currentDayDate && lineHasTime(line) && lineHasPhone(line)) {
      finishPendingRow();
      pendingRow = `${currentDayDate} ${line}`;
      continue;
    }

    if (pendingRow) {
      if (isMetadataLine(line) || isLikelySectionLine(line)) {
        finishPendingRow();
      } else {
        pendingRow = compactSpaces(`${pendingRow} ${line}`);
        continue;
      }
    }

    if (isLikelySectionLine(line)) {
      if (isSectionContinuation(line)) {
        appendSectionContinuation(line);
      } else {
        queueSection(line);
      }
      continue;
    }
  }
  finishPendingRow();

  const uniqueRows = new Map<string, ImportedCrewRow>();
  for (const row of rows) {
    const key = [row.date, normalize(row.name), row.startTime, row.endTime, normalize(row.position), normalize(row.phone), normalize(row.area)].join("|");
    if (!uniqueRows.has(key)) uniqueRows.set(key, row);
  }
  const dedupedRows = [...uniqueRows.values()];

  if (!dedupedRows.length) {
    const dateLike = lines.filter((line) => dateStartFromLine(line, fallbackYear)).slice(0, 4).join(" | ");
    throw new Error(
      dateLike
        ? `PDF import found date-looking lines but could not split them into clean crew rows. First date lines: ${dateLike}`
        : "PDF import could not find any labor call rows. The uploaded PDF may be scanned/image-only or uses a table order this importer has not seen yet."
    );
  }

  const dates = dedupedRows.map((row) => row.date).sort();
  const show = {
    name: compactSpaces(showName),
    client: compactSpaces(client),
    venue: compactSpaces(venue),
    event_location: compactSpaces(location),
    rate_city: compactSpaces(rateCity || "Default"),
    show_start: showStart || dates[0],
    show_end: showEnd || dates[dates.length - 1],
    notes: [overrides.notes, ...noteBits].filter(Boolean).map((note) => compactSpaces(String(note))).join("\n"),
  };

  return { show, rows: dedupedRows, sourceType: "pdf" };
}

export function parseImportedEventFile(
  fileName: string,
  contents: string,
  overrides: Partial<ImportedEventData["show"]>
): ImportedEventData {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return parseEstimateCsv(contents, overrides) || parseCsv(contents, overrides);
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
      po_number?: string | null;
      sub_call_reference_number?: string | null;
      message_rate?: string | null;
      day_type?: "full_day" | "half_day" | "hourly" | "custom";
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

    const key = [row.date, row.area, row.position, row.startTime, row.endTime, row.poNumber || "", row.boothNumber || ""].join("|");
    const existing = subCallGroups.get(key);
    if (existing) {
      existing.crew_needed += row.crewNeeded || 1;
      existing.crewRows.push(row);
    } else {
      const noteParts = [
        `Imported from ${data.sourceType.toUpperCase()}${data.importFormat === "estimate" ? " estimate" : ""}`,
        row.boothNumber ? `Booth: ${row.boothNumber}` : "",
        row.clientRate != null ? `Client rate: $${row.clientRate.toFixed(2)}` : "",
        row.amount != null ? `Line amount: $${row.amount.toFixed(2)}` : "",
        row.reviewFlags?.length ? `Needs Review: ${row.reviewFlags.join("; ")}` : "",
      ].filter(Boolean);
      subCallGroups.set(key, {
        labor_date: row.date,
        area: row.area || "Imported Call",
        role_name: row.position,
        start_time: row.startTime,
        end_time: row.endTime,
        crew_needed: row.crewNeeded || 1,
        notes: noteParts.join("\n"),
        po_number: row.poNumber || null,
        sub_call_reference_number: row.boothNumber ? `Booth ${row.boothNumber}` : null,
        message_rate: row.clientRate != null ? String(row.clientRate) : null,
        day_type: row.dayType || "full_day",
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
  return cleanPdfArtifacts(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhoneForMatch(value: string) {
  const digits = cleanPdfArtifacts(value).replace(/\D/g, "");
  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return normalized.length >= 10 ? normalized.slice(-10) : normalized;
}

export function runEstimateGroupHeaderSelfTest() {
  const text = [
    "Bill to",
    "NMR Events",
    "Ship to",
    "PHOENIX CONVENTION CENTER",
    "100 N THIRD STREET",
    "PHOENIX, AZ",
    "Estimate details Event: PC | ASH26",
    "Estimate no.: 1025 (ASH26)",
    "Estimate date: 06/02/2026",
    "# Service Date Product/service Description Qty Rate Amount",
    "1. SANOFI Booth 2939 $0.00",
    "PO174811",
    "2. 12/08/2026 LED assist 8:00AM | 6:00PM 4 $500.00 $2,000.00",
    "20. NOVARTIS $0.00",
    "Booth:TBD",
    "PO176495",
    "21. 12/09/2026 LED assist 8:00AM | 6:00PM 4 $500.00 $2,000.00",
    "26. PHAMAESSENTIA LABOR &",
    "EXPENSES",
    "Booth TBD",
    "PO177269",
    "27. 12/10/2026 LED assist 8:00AM | 6:00PM 4 $500.00 $2,000.00",
    "32. PHARMA ESSENTIA LIGHTING",
    "EQUIPMENT",
    "Booth TBD",
    "PO177270",
    "33. 12/11/2026 Lighting Assist 8:00AM | 6:00PM 4 $500.00 $2,000.00",
    "35. AreaJazz AV 0 $0.00 $0.00",
    "PO177252",
    "Booth TBD",
    "36. 12/14/2026 General AV Tech 8:00AM | 6:00PM 1 $450.00 $450.00",
    "Total $8,450.00",
  ].join("\n");
  const parsed = parseImportedEventFile("Estimate 1025 (ASH26) regression.pdf", text, {});
  const areas = new Set(parsed.rows.map((row) => row.area));
  for (const area of ["SANOFI", "NOVARTIS", "PHAMAESSENTIA LABOR & EXPENSES", "PHARMA ESSENTIA LIGHTING EQUIPMENT", "Area Jazz AV"]) {
    if (!areas.has(area)) throw new Error(`Estimate header regression missing ${area}.`);
  }
  if (parsed.rows.some((row) => Number(row.amount || 0) === 0 || Number(row.clientRate || 0) === 0)) {
    throw new Error("Estimate header regression created a zero-dollar labor row.");
  }
  if (parsed.show.parsed_line_total !== 8450) {
    throw new Error(`Estimate header regression parsed total ${parsed.show.parsed_line_total}, expected 8450.`);
  }

  const subtotalHeaderText = [
    "Bill to",
    "NMR Events",
    "Ship to",
    "PHOENIX CONVENTION CENTER",
    "100 N THIRD STREET",
    "PHOENIX, AZ",
    "Estimate details Event: PC | APHON26",
    "Estimate no.: 1043 (APHON26)",
    "Estimate date: 08/17/2026",
    "# Service Date Product/service Description Qty Rate Amount",
    "1. PFIZER $0.00",
    "Booth 206",
    "PO177685",
    "2. 09/16/2026 General AV 8:00AM | 6:00PM 1 $450.00 $450.00",
    "3. 09/17/2026 General AV 3:30PM | 8:30PM 1 $450.00 $450.00",
    "4. SYNDAX $0.00",
    "Booth 304",
    "PO177683",
    "5. 09/16/2026 General AV 8:00AM | 6:00PM 1 $450.00 $450.00",
    "6. 09/17/2026 General AV 3:30PM | 8:30PM 1 $450.00 $450.00",
    "Subtotal ALEXION",
    "Booth 106",
    "PO177684",
    "$0.00",
    "7. 09/16/2026 General AV 8:00AM | 6:00PM 1 $450.00 $450.00",
    "8. 09/17/2026 General AV 3:30PM | 8:30PM 1 $450.00 $450.00",
    "Total $2,700.00",
  ].join("\n");
  const subtotalHeaderParsed = parseImportedEventFile("Estimate 1043 (APHON26) regression.pdf", subtotalHeaderText, {});
  const alexionRows = subtotalHeaderParsed.rows.filter((row) => row.area === "ALEXION");
  if (alexionRows.length !== 2) {
    throw new Error(`Subtotal header regression expected 2 ALEXION rows, found ${alexionRows.length}.`);
  }
  if (alexionRows.some((row) => row.boothNumber !== "106" || row.poNumber !== "PO177684")) {
    throw new Error("Subtotal header regression did not attach Booth 106 / PO177684 to ALEXION.");
  }
  if (subtotalHeaderParsed.rows.some((row) => row.area === "SYNDAX" && row.boothNumber === "106")) {
    throw new Error("Subtotal header regression reused SYNDAX for the ALEXION booth.");
  }

  const billShipParsed = parseImportedEventFile("Estimate 1045 IDETC (1).pdf", [
    "Bill to Ship to",
    "AVPG AVPG",
    "1800 Huey P Long Ave 1800 Huey P Long Ave",
    "Gretna, Louisiana 70053 Gretna, Louisiana 70053",
    "Estimate details Event: IDETC",
    "Estimate no.: 1045 (IDETC)",
    "Estimate date: 08/18/2026",
    "# Service Date Product/service Description Qty Rate Amount",
    "1. GRAY MEDIA REGIONAL MEETING Booth 100 $0.00",
    "PO177777",
    "2. 09/16/2026 General AV 8:00AM | 6:00PM 1 $450.00 $450.00",
    "Total $450.00",
  ].join("\n"), {});
  if (billShipParsed.show.client !== "AVPG") {
    throw new Error(`Bill/Ship regression parsed client ${billShipParsed.show.client}, expected AVPG.`);
  }
  if (billShipParsed.show.venue !== "AVPG") {
    throw new Error(`Bill/Ship regression parsed venue ${billShipParsed.show.venue}, expected AVPG.`);
  }
  if (!/Gretna, LA/.test(billShipParsed.show.event_location)) {
    throw new Error(`Bill/Ship regression parsed location ${billShipParsed.show.event_location}, expected Gretna, LA.`);
  }
  if (billShipParsed.show.rate_city !== "New Orleans") {
    throw new Error(`Bill/Ship regression parsed crew pool ${billShipParsed.show.rate_city}, expected New Orleans.`);
  }
}
