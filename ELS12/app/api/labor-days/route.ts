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
    show_id: String(body.show_id || '').trim(),
    labor_date: String(body.labor_date || '').trim(),
    label: String(body.label || '').trim() || null,
    notes: String(body.notes || '').trim() || null,
  };
  if (!payload.show_id || !payload.labor_date) return NextResponse.json({ message: 'Show and date are required.' }, { status: 400 });
  const { data, error } = await admin.from('labor_days').insert(payload).select('id').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data.id, message: 'Labor day saved.' });
}
