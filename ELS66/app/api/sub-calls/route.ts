import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function cleanSubCallPayload(row: Record<string, unknown>) {
  const payload = {
    labor_day_id: String(row.labor_day_id || "").trim(),
    area: String(row.area || "").trim(),
    location: String(row.location || "").trim() || null,
    role_name: String(row.role_name || "").trim(),
    master_rate_id: String(row.master_rate_id || "").trim() || null,
    message_rate: String(row.message_rate || "").replace(/[^0-9.]/g, "").trim() || null,
    start_time: String(row.start_time || "").trim(),
    end_time: String(row.end_time || "").trim(),
    crew_needed: Math.max(1, Number(row.crew_needed || 1)),
    notes: String(row.notes || "").trim() || null,
  };
  return payload;
}

function validateSubCallPayload(payload: ReturnType<typeof cleanSubCallPayload>) {
  return Boolean(payload.labor_day_id && payload.area && payload.role_name && payload.start_time && payload.end_time);
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const rowsSource: unknown[] = Array.isArray(body.items) ? body.items : [body];
  const rows = rowsSource.map((item: unknown) => cleanSubCallPayload((item || {}) as Record<string, unknown>));
  if (!rows.length) return NextResponse.json({ message: "Choose at least one labor day for this sub-call." }, { status: 400 });
  if (rows.some((payload: ReturnType<typeof cleanSubCallPayload>) => !validateSubCallPayload(payload))) {
    return NextResponse.json({ message: "Area, position, start time, and end time are required for every selected labor day." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("sub_calls")
    .insert(rows)
    .select("id,labor_day_id,area,location,role_name,master_rate_id,message_rate,start_time,end_time,crew_needed,notes");
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  const createdRows = (data ?? []).map((row) => ({ ...row, notes: row.notes || "" }));
  return NextResponse.json({
    ok: true,
    id: createdRows[0]?.id,
    rows: createdRows,
    message: `${createdRows.length} sub-call${createdRows.length === 1 ? "" : "s"} saved.`,
  });
}
