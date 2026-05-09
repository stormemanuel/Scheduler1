import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function timeToMinutes(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function rangesOverlap(aStart: string | null | undefined, aEnd: string | null | undefined, bStart: string | null | undefined, bEnd: string | null | undefined) {
  let startA = timeToMinutes(aStart);
  let endA = timeToMinutes(aEnd) || startA;
  let startB = timeToMinutes(bStart);
  let endB = timeToMinutes(bEnd) || startB;
  if (endA <= startA) endA += 24 * 60;
  if (endB <= startB) endB += 24 * 60;
  return startA < endB && startB < endA;
}

async function findCrewTimeConflict(admin: ReturnType<typeof createSupabaseAdminClient>, crewId: string, targetSubCallId: string) {
  if (!admin) return null;

  const targetRes = await admin
    .from("sub_calls")
    .select("id, labor_day_id, area, role_name, start_time, end_time")
    .eq("id", targetSubCallId)
    .single();
  if (targetRes.error || !targetRes.data) return null;
  const target = targetRes.data as { id: string; labor_day_id: string; area: string | null; role_name: string | null; start_time: string; end_time: string | null };

  const targetDayRes = await admin
    .from("labor_days")
    .select("id, labor_date")
    .eq("id", target.labor_day_id)
    .single();
  if (targetDayRes.error || !targetDayRes.data) return null;
  const targetDay = targetDayRes.data as { id: string; labor_date: string };

  const sameDateDaysRes = await admin
    .from("labor_days")
    .select("id, labor_date")
    .eq("labor_date", targetDay.labor_date);
  if (sameDateDaysRes.error) return null;
  const sameDateDayIds = ((sameDateDaysRes.data ?? []) as Array<{ id: string; labor_date: string }>).map((day) => day.id);

  const sameDaySubCallsRes = sameDateDayIds.length
    ? await admin
        .from("sub_calls")
        .select("id, area, role_name, start_time, end_time")
        .in("labor_day_id", sameDateDayIds)
    : { data: [], error: null };
  if (sameDaySubCallsRes.error) return null;

  const sameDaySubCalls = (sameDaySubCallsRes.data ?? []) as Array<{ id: string; area: string | null; role_name: string | null; start_time: string; end_time: string | null }>;
  const subCallById = new Map(sameDaySubCalls.map((row) => [row.id, row]));
  const sameDayIds = sameDaySubCalls.map((row) => row.id);
  if (!sameDayIds.length) return null;

  const existingAssignmentsRes = await admin
    .from("assignments")
    .select("id, sub_call_id, crew_id, status")
    .eq("crew_id", crewId)
    .in("sub_call_id", sameDayIds);
  if (existingAssignmentsRes.error) return null;

  for (const assignment of existingAssignmentsRes.data ?? []) {
    const existing = subCallById.get(String(assignment.sub_call_id));
    if (!existing || existing.id === target.id) continue;
    if (rangesOverlap(target.start_time, target.end_time, existing.start_time, existing.end_time)) {
      return existing;
    }
  }

  return null;
}

export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
  const url = new URL(request.url);
  const subCallId = url.searchParams.get("sub_call_id");
  let query = supabase.from("assignments").select("id, sub_call_id, crew_id, status");
  if (subCallId) query = query.eq("sub_call_id", subCallId);
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
  const payload = {
    sub_call_id: String(body.sub_call_id || "").trim(),
    crew_id: String(body.crew_id || "").trim(),
    status: String(body.status || "confirmed").trim() || "confirmed",
  };
  if (!payload.sub_call_id || !payload.crew_id) {
    return NextResponse.json({ message: "Sub-call and crew are required." }, { status: 400 });
  }

  const conflict = await findCrewTimeConflict(admin, payload.crew_id, payload.sub_call_id);
  if (conflict) {
    return NextResponse.json(
      {
        message: `This crew member is already assigned during that time on the same day (${conflict.start_time}${conflict.end_time ? `-${conflict.end_time}` : ""}, ${conflict.area || "another sub-call"}).`,
      },
      { status: 409 }
    );
  }

  const { data, error } = await admin
    .from("assignments")
    .upsert(payload, { onConflict: "sub_call_id,crew_id" })
    .select("id, sub_call_id, crew_id, status")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data, message: "Crew added to sub-call." });
}
