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
  const rating = Math.max(1, Math.min(5, Number(body.rating || 0)));
  const payload = {
    show_id: String(body.show_id || "").trim(),
    client_id: String(body.client_id || "").trim() || null,
    crew_id: String(body.crew_id || "").trim(),
    assignment_id: String(body.assignment_id || "").trim() || null,
    rating,
    notes: String(body.notes || "").trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (!payload.show_id || !payload.crew_id) return NextResponse.json({ message: "Show and crew member are required." }, { status: 400 });
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return NextResponse.json({ message: "Rating must be 1 to 5 stars." }, { status: 400 });

  const { data, error } = await admin
    .from("tech_ratings")
    .upsert(payload, { onConflict: "show_id,crew_id" })
    .select("id, show_id, client_id, crew_id, assignment_id, rating, notes, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rating: data, message: "Rating saved." });
}
