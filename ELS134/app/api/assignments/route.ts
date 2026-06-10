import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function missingAssignmentColumns(error: { message?: string } | null) {
  return Boolean(error?.message?.includes("sort_order") || error?.message?.includes("start_time") || error?.message?.includes("end_time") || error?.message?.includes("day_type"));
}

async function canAddToSubCall(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, subCallId: string, replacingAssignmentId: string | null) {
  const callRes = await admin.from("sub_calls").select("id, crew_needed").eq("id", subCallId).maybeSingle();
  if (callRes.error) throw callRes.error;
  const maxCrew = Math.max(0, Number((callRes.data as { crew_needed?: number | null } | null)?.crew_needed || 0));
  if (!maxCrew) return { ok: true, maxCrew, assignedCount: 0 };

  const assignedRes = await admin.from("assignments").select("id", { count: "exact", head: false }).eq("sub_call_id", subCallId);
  if (assignedRes.error) throw assignedRes.error;
  const assignedCount = Number(assignedRes.count ?? assignedRes.data?.length ?? 0);
  if (assignedCount < maxCrew) return { ok: true, maxCrew, assignedCount };

  if (replacingAssignmentId) {
    const replaceRes = await admin.from("assignments").select("id, sub_call_id").eq("id", replacingAssignmentId).eq("sub_call_id", subCallId).maybeSingle();
    if (replaceRes.error) throw replaceRes.error;
    if (replaceRes.data?.id) return { ok: true, maxCrew, assignedCount };
  }

  return { ok: false, maxCrew, assignedCount };
}

export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
  const url = new URL(request.url);
  const subCallId = url.searchParams.get("sub_call_id");
  let query = supabase.from("assignments").select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type").order("sort_order", { ascending: true });
  if (subCallId) query = query.eq("sub_call_id", subCallId);
  let { data, error } = await query;
  if (missingAssignmentColumns(error)) {
    let fallback = supabase.from("assignments").select("id, sub_call_id, crew_id, status");
    if (subCallId) fallback = fallback.eq("sub_call_id", subCallId);
    const fallbackRes = await fallback;
    data = fallbackRes.data as typeof data;
    error = fallbackRes.error;
  }
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rows: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const subCallId = String(body.sub_call_id || "").trim();
  const crewId = String(body.crew_id || "").trim();
  const status = String(body.status || "confirmed").trim() || "confirmed";
  const replacingAssignmentId = String(body.replacing_assignment_id || "").trim() || null;
  if (!subCallId || !crewId) {
    return NextResponse.json({ message: "Sub-call and crew are required." }, { status: 400 });
  }

  const capacity = await canAddToSubCall(admin, subCallId, replacingAssignmentId);
  if (!capacity.ok) {
    return NextResponse.json({ message: `This subgroup is full. Max: ${capacity.maxCrew} / Filled: ${capacity.assignedCount}. Increase crew needed before adding more crew.` }, { status: 400 });
  }

  const existingWithOrder = await admin
    .from("assignments")
    .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type")
    .eq("sub_call_id", subCallId)
    .eq("crew_id", crewId)
    .maybeSingle();

  if (!missingAssignmentColumns(existingWithOrder.error)) {
    if (existingWithOrder.error) return NextResponse.json({ message: existingWithOrder.error.message }, { status: 400 });
    if (existingWithOrder.data) return NextResponse.json({ ok: true, row: existingWithOrder.data, message: "Crew already exists on this sub-call." });

    const requestedSortOrder = Number(body.sort_order || 0);
    const maxOrderRes = await admin
      .from("assignments")
      .select("sort_order")
      .eq("sub_call_id", subCallId)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (maxOrderRes.error) return NextResponse.json({ message: maxOrderRes.error.message }, { status: 400 });
    const nextSortOrder = requestedSortOrder > 0
      ? requestedSortOrder
      : Number(maxOrderRes.data?.[0]?.sort_order || 0) + 1;

    const { data, error } = await admin
      .from("assignments")
      .insert({ sub_call_id: subCallId, crew_id: crewId, status, sort_order: nextSortOrder })
      .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type")
      .single();
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, row: data, message: "Crew added to sub-call." });
  }

  const existingFallback = await admin
    .from("assignments")
    .select("id, sub_call_id, crew_id, status")
    .eq("sub_call_id", subCallId)
    .eq("crew_id", crewId)
    .maybeSingle();
  if (existingFallback.error) return NextResponse.json({ message: existingFallback.error.message }, { status: 400 });
  if (existingFallback.data) return NextResponse.json({ ok: true, row: existingFallback.data, message: "Crew already exists on this sub-call." });

  const { data, error } = await admin
    .from("assignments")
    .insert({ sub_call_id: subCallId, crew_id: crewId, status })
    .select("id, sub_call_id, crew_id, status")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data, message: "Crew added to sub-call. Run the assignment order SQL to enable saved crew reordering." });
}
