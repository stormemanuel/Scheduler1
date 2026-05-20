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

  const body = await request.json().catch(() => ({}));
  const payload = {
    name: String(body.name || "").trim(),
    default_rate_city: String(body.default_rate_city || "Default").trim() || "Default",
    notes: String(body.notes || "").trim() || null,
  };
  if (!payload.name) return NextResponse.json({ message: "Client name is required." }, { status: 400 });

  const { data, error } = await admin
    .from("business_clients")
    .upsert(payload, { onConflict: "name" })
    .select("id, name, default_rate_city, notes, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, client: data, message: "Client saved." });
}
