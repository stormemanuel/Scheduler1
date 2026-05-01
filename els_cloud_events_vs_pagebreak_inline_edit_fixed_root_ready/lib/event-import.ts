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
const TIME_PATTERN = "\\d{1,2}(?:(?::|\\s)\\d{2})(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)";
const PHONE_PATTERN = /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g;
const BAD_PDF_GLYPHS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD\u25A0-\u25FF\u2580-\u259F\uE000-\uF8FF]/g;
const PDF_PAGE_BREAK_PATTERN = /^ELS_PDF_PAGE_BREAK_\d+$/i;

function isPageBreakLine(line: string) {
  return PDF_PAGE_BREAK_PATTERN.test(compactSpaces(line));
}


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
  const dateRegex = new RegExp(`^(?:${WEEKDAY_PREFIX.source})?(${MONTH_DATE_PATTERN}|${NUMERIC_DATE_PATTERN})(?=\\s|$|,)`, "i");
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
  return /^(show|event\s*name|client|venue|address|location|project\s*manager|assistant\s*pm|crew\s*lead|contact|coordinator|nmr\s*contact|lead\s*\/\s*coordinator|gear|notes?)\s*:/i.test(line);
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
  return /\b(booth|po\s*\d+|po\d+|floaters?|loaders?|truck|breakout|general\s+session|room|stage|registration|exhibit|strike|load[-\s]?in|dismantle|install|meeting\s+suites?|medical|luxottica|optos|genentech|novartis|ardelyx|fresenius|merck|sanofi|ionis|novo|corcept|axs?ome|esperion|asahi|otsuka)\b|#\s*[A-Z0-9-]+/i.test(clean);
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
    .replace(/^(?:nes|day|wednes|wednesday|tues|tuesday|satur|saturday)\s+/i, " ")
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
  if (/\bled\b/.test(key) && /\blighting\b/.test(key) && /\bassist/.test(key)) return "LED Assist";
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

  return clean;
}

function cleanPosition(value: string) {
  const clean = compactSpaces(value)
    .replace(/^[-|]+|[-|]+$/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\bPO\s*\d+\b/gi, " ")
    .replace(/\bContact\s+Number\b/gi, " ")
    .replace(/[()]+$/g, " ")
    .replace(/^[-|]+|[-|]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return canonicalizeImportedPosition(clean || "Imported Crew");
}

function choosePosition(afterEnd: string, betweenTimes: string) {
  const betweenRaw = betweenTimes
    .replace(/^\|+/, "")
    .replace(/\|+$/g, "")
    .replace(/\bto\b/gi, " ");

  // Some PDF page/table splits put the first word of a role before the second time and the
  // rest after it, for example: "2:00 PM | LED" then "11:59 PM Assist/Lighting Assist".
  if (/\bled\b/i.test(betweenRaw) && /assist/i.test(afterEnd)) {
    const combined = cleanPosition(`${betweenRaw} ${afterEnd}`);
    if (combined && combined !== "Imported Crew") return combined;
  }

  const after = cleanPosition(afterEnd);
  if (after && after !== "Imported Crew") return after;

  const between = cleanPosition(betweenRaw);
  return between && between !== "Imported Crew" ? between : "Imported Crew";
}

function parseCrewCandidateRow(record: string, area: string, fallbackYear: number): ImportedCrewRow | null {
  const cleanRecord = stripPdfHeaderGlue(record);
  const dateInfo = dateStartFromLine(cleanRecord, fallbackYear);
  if (!dateInfo) return null;

  let rest = removeTrailingOnCallNotes(stripPdfHeaderGlue(dateInfo.rest)
    .replace(/^,\s*/, "")
    .replace(/^20\d{2}\s+/, "")
    .trim());

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
  const value = line.replace(/^dates?\s*:/i, "").trim();
  const parts = value.split(/\s*(?:-|\bto\b)\s*/i).map((part) => compactSpaces(part)).filter(Boolean);
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

function mergeSplitDateRow(rawDate: string, leadingRest: string, trailingRest: string) {
  const lead = compactSpaces(leadingRest);
  const trail = compactSpaces(trailingRest);
  if (!lead) return compactSpaces(`${rawDate} ${trail}`);
  if (!trail) return compactSpaces(`${rawDate} ${lead}`);

  const leadTimes = timeMatches(lead);
  const trailTimes = timeMatches(trail);
  if (leadTimes.length === 1 && trailTimes.length >= 1) {
    const first = leadTimes[0];
    const leadBeforeAndTime = compactSpaces(lead.slice(0, first.index + first.text.length));
    const leadAfterTime = compactSpaces(lead.slice(first.index + first.text.length));
    const trailTime = trailTimes[0].text;
    const trailAfterTime = compactSpaces(trail.slice((trailTimes[0].index ?? 0) + trailTime.length));
    return compactSpaces(`${rawDate} ${leadBeforeAndTime} ${trailTime} ${leadAfterTime} ${trailAfterTime}`);
  }

  return compactSpaces(`${rawDate} ${lead} ${trail}`);
}

function splitWeekdayDateContinuation(line: string, nextLine: string | undefined) {
  const clean = compactSpaces(line).replace(/^,\s*/, "");

  const monthOnly = clean.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(.*))?$/i);
  if (monthOnly && nextLine) {
    const next = compactSpaces(nextLine);
    const dayYear = next.match(/^(\d{1,2})(?:,?\s*(\d{2,4}))?(?:\s+(.*))?$/);
    if (dayYear) {
      return {
        consumed: 2,
        rawDate: `${monthOnly[1]} ${dayYear[1]}${dayYear[2] ? `, ${dayYear[2]}` : ""}`,
        rest: compactSpaces(`${monthOnly[2] || ""} ${dayYear[3] || ""}`),
      };
    }
  }

  const monthDay = clean.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{2,4}))?(?:\s+(.*))?$/i);
  if (monthDay) {
    let year = monthDay[3] || "";
    let rest = monthDay[4] || "";
    let consumed = 1;
    if (!year && nextLine) {
      const next = compactSpaces(nextLine);
      const yearLine = next.match(/^(\d{2,4})(?:\s+(.*))?$/);
      if (yearLine) {
        year = yearLine[1];
        rest = compactSpaces(`${rest} ${yearLine[2] || ""}`);
        consumed = 2;
      }
    }
    return {
      consumed,
      rawDate: `${monthDay[1]} ${monthDay[2]}${year ? `, ${year}` : ""}`,
      rest: compactSpaces(rest),
    };
  }

  const dayMonth = clean.match(/^day,?\s+([A-Za-z]+)(?:\s+(.*))?$/i);
  if (dayMonth && nextLine) {
    const next = compactSpaces(nextLine);
    const dayYear = next.match(/^(\d{1,2})(?:,?\s*(\d{2,4}))?(?:\s+(.*))?$/);
    if (dayYear) {
      return {
        consumed: 2,
        rawDate: `${dayMonth[1]} ${dayYear[1]}${dayYear[2] ? `, ${dayYear[2]}` : ""}`,
        rest: compactSpaces(`${dayMonth[2] || ""} ${dayYear[3] || ""}`),
      };
    }
  }

  return null;
}

function repairSplitDateLines(lines: string[]) {
  const repaired: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const weekday = parseWeekdayFragment(line);

    if (weekday && !monthStartInfo(line)) {
      const next = lines[index + 1] || "";
      const splitContinuation = splitWeekdayDateContinuation(next, lines[index + 2]);
      if (splitContinuation) {
        repaired.push(mergeSplitDateRow(splitContinuation.rawDate, weekday.rest, splitContinuation.rest));
        index += splitContinuation.consumed;
        continue;
      }

      const nextMonth = monthStartInfo(next);
      if (nextMonth) {
        repaired.push(mergeSplitDateRow(nextMonth.rawDate, weekday.rest, nextMonth.rest));
        index += 1;
        continue;
      }

      const dayMonth = splitDayMonthInfo(next, lines[index + 2]);
      if (dayMonth) {
        repaired.push(mergeSplitDateRow(dayMonth.rawDate, weekday.rest, dayMonth.rest));
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

function extractPoNumbers(value: string) {
  return [...compactSpaces(value).matchAll(/\bPO\s*(\d{4,})\b/gi)].map((match) => `PO${match[1]}`.toUpperCase());
}

function tableHeaderHasPo(line: string) {
  return /\bname\s+po\s+times?\b/i.test(compactSpaces(line));
}

function rowMatchesSectionPo(row: string, section: string) {
  const rowPos = new Set(extractPoNumbers(row));
  if (!rowPos.size) return false;
  return extractPoNumbers(section).some((po) => rowPos.has(po));
}

function sectionHasPo(section: string) {
  return extractPoNumbers(section).length > 0;
}

function removeTrailingOnCallNotes(value: string) {
  return compactSpaces(value)
    .replace(/\s+[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3}\s+["“”']?On\s*call["“”']?.*$/i, " ")
    .replace(/\s+Available\b.*$/i, " ")
    .trim();
}

function preprocessPdfLines(text: string) {
  const rawLines = cleanPdfArtifacts(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => stripPdfHeaderGlue(normalizeCorruptedPdfTimes(line)))
    .filter(Boolean)
    .filter((line) => !/^page\s+\d+/i.test(line));

  const repaired: string[] = [];
  let pageBuffer: string[] = [];

  const flushPage = () => {
    if (!pageBuffer.length) return;
    repaired.push(...explodeEmbeddedDateRows(repairSplitDateLines(pageBuffer)));
    pageBuffer = [];
  };

  for (const line of rawLines) {
    if (isPageBreakLine(line)) {
      flushPage();
      repaired.push(line);
      continue;
    }
    pageBuffer.push(line);
  }
  flushPage();
  return repaired;
}

function parsePdfText(text: string, overrides: Partial<ImportedEventData["show"]>): ImportedEventData {
  const lines = preprocessPdfLines(text);

  let showName = overrides.name || "Imported Event";
  let client = overrides.client || "";
  let venue = overrides.venue || "";
  let location = "";
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
    if (/^client\s*:/i.test(line)) {
      client = compactSpaces(line.replace(/^client\s*:/i, ""));
      continue;
    }
    if (/^venue\s*:/i.test(line)) {
      venue = compactSpaces(line.replace(/^venue\s*:/i, ""));
      continue;
    }
    if (/^address\s*:/i.test(line)) {
      location = compactSpaces(line.replace(/^address\s*:/i, ""));
      continue;
    }
    if (/^location\s*:/i.test(line)) {
      location = compactSpaces(line.replace(/^location\s*:/i, ""));
      continue;
    }
    if (/^dates?\s*:/i.test(line)) {
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
  let pageContinuationMode = false;
  let deferQueuedSectionUntilMatchingPo = false;

  const queueSection = (line: string) => {
    const clean = compactSpaces(line);
    if (!clean) return;
    sectionQueue.push(clean);
  };

  const activateQueuedSection = () => {
    const next = sectionQueue.shift();
    if (next) currentSection = next;
    pageContinuationMode = false;
    deferQueuedSectionUntilMatchingPo = false;
  };

  const queuedSection = () => sectionQueue[0] || "";

  const shouldActivateQueuedSectionForDateRow = (line: string) => {
    const queued = queuedSection();
    if (!queued) return false;

    if (deferQueuedSectionUntilMatchingPo) {
      return rowMatchesSectionPo(line, queued);
    }

    if (pageContinuationMode && rowBlockActive && currentSection !== "Imported Call") {
      return rowMatchesSectionPo(line, queued);
    }

    return !rowBlockActive;
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

    if (isPageBreakLine(line)) {
      finishPendingRow();
      // Page-break protection: some PDFs print the next booth header at the top of the next
      // page while rows from the previous booth continue before the next table really begins.
      pageContinuationMode = rowBlockActive && currentSection !== "Imported Call";
      continue;
    }

    if (isTableHeaderLine(line)) {
      finishPendingRow();
      const queued = queuedSection();
      if (queued) {
        if (pageContinuationMode && tableHeaderHasPo(line) && sectionHasPo(queued)) {
          deferQueuedSectionUntilMatchingPo = true;
        } else {
          activateQueuedSection();
        }
      }
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
      if (sectionQueue.length && shouldActivateQueuedSectionForDateRow(line)) activateQueuedSection();
      pendingRow = line;
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
        if (pageContinuationMode && sectionHasPo(line)) {
          deferQueuedSectionUntilMatchingPo = true;
        }
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
    venue: compactSpaces([venue, location].filter(Boolean).join(" • ")),
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
