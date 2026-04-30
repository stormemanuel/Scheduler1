import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
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
  const { data, error } = await admin
    .from("assignments")
    .upsert(payload, { onConflict: "sub_call_id,crew_id" })
    .select("id, sub_call_id, crew_id, status")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data, message: "Crew added to sub-call." });
}
