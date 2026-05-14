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

export type ImportPreview = {
  parsed: ImportedEventData;
  payload: ReturnType<typeof buildImportedEventPayload>;
  matchedCrewCount: number;
  unmatchedCrewCount: number;
  subCallPreview: Array<{
    key: string;
    labor_date: string;
    area: string;
    role_name: string;
    start_time: string;
    end_time: string;
    crew_needed: number;
    matchedCrew: Array<{ name: string; crew_id: string; importedName: string; confidence: number; reason: string }>;
    unmatchedCrew: string[];
  }>;
};

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
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer, { pagerender: renderPdfPageVisually } as any);
    return parsed.text || "";
  }
  return await file.text();
}

export function getImportOverrides(formData: FormData): ShowOverrides {
  return {
    name: String(formData.get("show_name") || "").trim() || undefined,
    client: String(formData.get("client") || "").trim() || undefined,
    venue: String(formData.get("venue") || "").trim() || undefined,
    rate_city: String(formData.get("rate_city") || "").trim() || undefined,
    show_start: String(formData.get("show_start") || "").trim() || undefined,
    show_end: String(formData.get("show_end") || "").trim() || undefined,
    notes: String(formData.get("notes") || "").trim() || undefined,
  };
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

  const crewRes = await admin.from("crew").select("id, name, phone, email, city_pool_id, group_name");
  if (crewRes.error) {
    throw new Error(crewRes.error.message);
  }

  const crewRows = ((crewRes.data ?? []) as CrewLookupRow[]).filter((row) => row.id && row.name);

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
      matchedCrew,
      unmatchedCrew,
    };
  });

  return {
    parsed,
    payload,
    matchedCrewCount,
    unmatchedCrewCount,
    subCallPreview,
  };
}
