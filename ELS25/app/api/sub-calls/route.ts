import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const payload = {
    labor_day_id: String(body.labor_day_id || '').trim(),
    area: String(body.area || '').trim(),
    role_name: String(body.role_name || '').trim(),
    start_time: String(body.start_time || '').trim(),
    end_time: String(body.end_time || '').trim() || null,
    crew_needed: Math.max(1, Number(body.crew_needed || 1)),
    notes: String(body.notes || '').trim() || null,
  };
  if (!payload.labor_day_id || !payload.area || !payload.role_name || !payload.start_time) return NextResponse.json({ message: 'Area, role, and start time are required.' }, { status: 400 });
  const { data, error } = await admin.from('sub_calls').insert(payload).select('id').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data.id, message: 'Sub-call saved.' });
}
