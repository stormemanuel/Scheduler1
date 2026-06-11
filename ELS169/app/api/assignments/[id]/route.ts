import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const body = await request.json();
  const payload: { sort_order?: number; status?: string; start_time?: string | null; end_time?: string | null; day_type?: string | null } = {};
  if (body.sort_order !== undefined) {
    const sortOrder = Math.max(1, Number(body.sort_order || 1));
    payload.sort_order = Number.isFinite(sortOrder) ? sortOrder : 1;
  }
  if (body.status !== undefined) payload.status = String(body.status || "confirmed").trim() || "confirmed";
  if (body.start_time !== undefined) payload.start_time = String(body.start_time || "").trim() || null;
  if (body.end_time !== undefined) payload.end_time = String(body.end_time || "").trim() || null;
  if (body.day_type !== undefined) {
    const dayType = String(body.day_type || "").trim();
    payload.day_type = ["full_day", "half_day", "custom"].includes(dayType) ? dayType : null;
  }
  if (!Object.keys(payload).length) return NextResponse.json({ message: "Nothing to update." }, { status: 400 });

  const { data, error } = await admin
    .from("assignments")
    .update(payload)
    .eq("id", id)
    .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data, message: "Crew assignment updated." });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const { id } = await params;
  const { error } = await admin.from("assignments").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Crew removed from sub-call." });
}
