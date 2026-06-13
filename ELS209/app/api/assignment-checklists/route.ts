import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

const checklistFields = new Set(["schedule_sent", "confirmed", "day_before_confirmed"]);

type ChecklistField = "schedule_sent" | "confirmed" | "day_before_confirmed";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function timestampField(field: ChecklistField) {
  if (field === "schedule_sent") return "schedule_sent_at";
  if (field === "confirmed") return "confirmed_at";
  return "day_before_confirmed_at";
}

export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });

  const url = new URL(request.url);
  const showId = url.searchParams.get("show_id");
  let query = supabase
    .from("assignment_checklists")
    .select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at");
  if (showId) query = query.eq("show_id", showId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json();
  const showId = String(body.show_id || "").trim();
  const singleCrewId = String(body.crew_id || "").trim();
  const crewIds: string[] = Array.isArray(body.crew_ids)
    ? body.crew_ids.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : singleCrewId ? [singleCrewId] : [];
  const field = String(body.field || "").trim() as ChecklistField;
  const checked = Boolean(body.checked);

  if (!showId || !crewIds.length) {
    return NextResponse.json({ message: "Show and crew are required." }, { status: 400 });
  }
  if (!checklistFields.has(field)) {
    return NextResponse.json({ message: "Invalid checklist field." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const checkedAtField = timestampField(field);
  const updatePayload = {
    [field]: checked,
    [checkedAtField]: checked ? now : null,
    updated_at: now,
  };

  const existingRes = await admin
    .from("assignment_checklists")
    .select("id, crew_id")
    .eq("show_id", showId)
    .in("crew_id", crewIds);

  if (existingRes.error) return NextResponse.json({ message: existingRes.error.message }, { status: 400 });

  const existing = (existingRes.data ?? []) as Array<{ id: string; crew_id: string }>;
  const existingCrewIds = new Set(existing.map((row) => row.crew_id));

  for (const row of existing) {
    const { error } = await admin.from("assignment_checklists").update(updatePayload).eq("id", row.id);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const insertRows = crewIds
    .filter((crewId) => !existingCrewIds.has(crewId))
    .map((crewId) => ({
      show_id: showId,
      crew_id: crewId,
      schedule_sent: field === "schedule_sent" ? checked : false,
      confirmed: field === "confirmed" ? checked : false,
      day_before_confirmed: field === "day_before_confirmed" ? checked : false,
      schedule_sent_at: field === "schedule_sent" && checked ? now : null,
      confirmed_at: field === "confirmed" && checked ? now : null,
      day_before_confirmed_at: field === "day_before_confirmed" && checked ? now : null,
      updated_at: now,
    }));

  if (insertRows.length) {
    const { error } = await admin.from("assignment_checklists").insert(insertRows);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const { data, error } = await admin
    .from("assignment_checklists")
    .select("id, show_id, crew_id, schedule_sent, confirmed, day_before_confirmed, schedule_sent_at, confirmed_at, day_before_confirmed_at, updated_at")
    .eq("show_id", showId)
    .in("crew_id", crewIds);

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data?.[0] ?? null, rows: data ?? [], message: checked ? "Checklist updated." : "Checklist unchecked." });
}
