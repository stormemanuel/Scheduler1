import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import {
  buildImportedEventPayload,
  normalizeMatchValue,
  normalizePhoneForMatch,
  parseImportedEventFile,
} from "@/lib/event-import";

export const runtime = "nodejs";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }),
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }),
    };
  }
  return { ok: true as const, user };
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { message: "SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Import file is required." }, { status: 400 });
  }

  const overrides = {
    name: String(formData.get("show_name") || "").trim() || undefined,
    client: String(formData.get("client") || "").trim() || undefined,
    venue: String(formData.get("venue") || "").trim() || undefined,
    rate_city: String(formData.get("rate_city") || "").trim() || undefined,
    show_start: String(formData.get("show_start") || "").trim() || undefined,
    show_end: String(formData.get("show_end") || "").trim() || undefined,
    notes: String(formData.get("notes") || "").trim() || undefined,
  };

  let text = "";
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const pdfParse = (await import("pdf-parse")).default;
    const parsed = await pdfParse(buffer);
    text = parsed.text || "";
  } else {
    text = await file.text();
  }

  if (!text.trim()) {
    return NextResponse.json({ message: "The uploaded file did not contain readable text." }, { status: 400 });
  }

  const parsed = parseImportedEventFile(file.name, text, overrides);
  const payload = buildImportedEventPayload(parsed);

  const showInsert = {
    name: payload.show.name,
    client: payload.show.client || null,
    venue: payload.show.venue || null,
    rate_city: payload.show.rate_city || "Default",
    show_start: payload.show.show_start,
    show_end: payload.show.show_end,
    notes: payload.show.notes || null,
  };

  const { data: showRow, error: showError } = await admin
    .from("shows")
    .insert(showInsert)
    .select("id, name, client, venue, rate_city, show_start, show_end, notes")
    .single();

  if (showError || !showRow) {
    return NextResponse.json({ message: showError?.message || "Could not create the show." }, { status: 400 });
  }

  const laborDayInsert = payload.laborDays.map((day) => ({
    show_id: showRow.id,
    labor_date: day.labor_date,
    label: day.label || null,
    notes: day.notes || null,
  }));

  const { data: laborDayRows, error: laborDayError } = await admin
    .from("labor_days")
    .insert(laborDayInsert)
    .select("id, show_id, labor_date, label, notes");

  if (laborDayError || !laborDayRows) {
    return NextResponse.json({ message: laborDayError?.message || "Could not create labor days." }, { status: 400 });
  }

  const laborDayIdByDate = new Map(
    laborDayRows.map((row) => [String((row as { labor_date: string }).labor_date), String((row as { id: string }).id)])
  );

  const subCallInsert = payload.subCallGroups.map((call) => ({
    labor_day_id: laborDayIdByDate.get(call.labor_date) || "",
    area: call.area,
    role_name: call.role_name,
    start_time: call.start_time,
    end_time: call.end_time || null,
    crew_needed: call.crew_needed,
    notes: call.notes || null,
  }));

  const { data: subCallRows, error: subCallError } = await admin
    .from("sub_calls")
    .insert(subCallInsert)
    .select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes");

  if (subCallError || !subCallRows) {
    return NextResponse.json({ message: subCallError?.message || "Could not create sub-calls." }, { status: 400 });
  }

  const crewRes = await admin.from("crew").select("id, name, phone");
  if (crewRes.error) {
    return NextResponse.json({ message: crewRes.error.message }, { status: 400 });
  }

  const crewByName = new Map<string, string>();
  const crewByPhone = new Map<string, string>();
  for (const row of crewRes.data ?? []) {
    const typed = row as { id: string; name: string | null; phone: string | null };
    if (typed.name) crewByName.set(normalizeMatchValue(typed.name), typed.id);
    if (typed.phone) crewByPhone.set(normalizePhoneForMatch(typed.phone), typed.id);
  }

  const subCallIdByKey = new Map<string, string>();
  for (const row of subCallRows) {
    const typed = row as {
      id: string;
      labor_day_id: string;
      area: string;
      role_name: string;
      start_time: string;
      end_time: string | null;
    };
    const laborDate = laborDayRows.find((day) => String((day as { id: string }).id) === typed.labor_day_id);
    const date = String((laborDate as { labor_date: string } | undefined)?.labor_date || "");
    const key = [date, typed.area, typed.role_name, typed.start_time, typed.end_time || ""].join("|");
    subCallIdByKey.set(key, typed.id);
  }

  const assignmentInsert: Array<{ sub_call_id: string; crew_id: string; status: string }> = [];
  let matchedCrewCount = 0;
  let unmatchedCrewCount = 0;

  for (const call of payload.subCallGroups) {
    const subCallId = subCallIdByKey.get([call.labor_date, call.area, call.role_name, call.start_time, call.end_time || ""].join("|"));
    if (!subCallId) continue;
    for (const crewRow of call.crewRows) {
      const byPhone = crewRow.phone ? crewByPhone.get(normalizePhoneForMatch(crewRow.phone)) : undefined;
      const byName = crewByName.get(normalizeMatchValue(crewRow.name));
      const crewId = byPhone || byName;
      if (!crewId) {
        unmatchedCrewCount += 1;
        continue;
      }
      matchedCrewCount += 1;
      assignmentInsert.push({ sub_call_id: subCallId, crew_id: crewId, status: "confirmed" });
    }
  }

  let assignmentRows: Array<{ id: string; sub_call_id: string; crew_id: string; status: string }> = [];
  if (assignmentInsert.length) {
    const { data, error } = await admin
      .from("assignments")
      .upsert(assignmentInsert, { onConflict: "sub_call_id,crew_id" })
      .select("id, sub_call_id, crew_id, status");
    if (error) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    assignmentRows = (data ?? []) as Array<{ id: string; sub_call_id: string; crew_id: string; status: string }>;
  }

  return NextResponse.json({
    ok: true,
    message: `Imported ${payload.subCallGroups.length} sub-calls from ${file.name}. Matched ${matchedCrewCount} crew${unmatchedCrewCount ? `, ${unmatchedCrewCount} unmatched` : ""}.`,
    show: showRow,
    laborDays: laborDayRows,
    subCalls: subCallRows,
    assignments: assignmentRows,
  });
}
