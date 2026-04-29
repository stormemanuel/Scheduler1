import { buildImportedEventPayload, normalizeMatchValue, normalizePhoneForMatch, parseImportedEventFile, type ImportedEventData } from "@/lib/event-import";

type ShowOverrides = Partial<ImportedEventData["show"]>;

type CrewLookupRow = {
  id: string;
  name: string | null;
  phone: string | null;
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
    matchedCrew: Array<{ name: string; crew_id: string }>;
    unmatchedCrew: string[];
  }>;
};

export async function readImportFileText(file: File) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
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

export async function buildImportPreview(admin: { from: (table: string) => any }, file: File, overrides: ShowOverrides): Promise<ImportPreview> {
  const text = await readImportFileText(file);
  if (!text.trim()) {
    throw new Error("The uploaded file did not contain readable text.");
  }

  const parsed = parseImportedEventFile(file.name, text, overrides);
  const payload = buildImportedEventPayload(parsed);

  const crewRes = await admin.from("crew").select("id, name, phone");
  if (crewRes.error) {
    throw new Error(crewRes.error.message);
  }

  const crewByName = new Map<string, string>();
  const crewByPhone = new Map<string, string>();
  const crewNameById = new Map<string, string>();

  for (const row of (crewRes.data ?? []) as CrewLookupRow[]) {
    if (row.name) {
      crewByName.set(normalizeMatchValue(row.name), row.id);
      crewNameById.set(row.id, row.name);
    }
    if (row.phone) {
      crewByPhone.set(normalizePhoneForMatch(row.phone), row.id);
    }
  }

  let matchedCrewCount = 0;
  let unmatchedCrewCount = 0;

  const subCallPreview = payload.subCallGroups.map((call) => {
    const matchedCrew: Array<{ name: string; crew_id: string }> = [];
    const unmatchedCrew: string[] = [];

    for (const crewRow of call.crewRows) {
      const byPhone = crewRow.phone ? crewByPhone.get(normalizePhoneForMatch(crewRow.phone)) : undefined;
      const byName = crewByName.get(normalizeMatchValue(crewRow.name));
      const crewId = byPhone || byName;

      if (!crewId) {
        unmatchedCrewCount += 1;
        unmatchedCrew.push(crewRow.name);
        continue;
      }

      matchedCrewCount += 1;
      matchedCrew.push({ name: crewNameById.get(crewId) || crewRow.name, crew_id: crewId });
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
