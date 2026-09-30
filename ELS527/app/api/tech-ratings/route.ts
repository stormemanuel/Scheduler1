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
  const showId = String(body.show_id || "").trim();
  const crewId = String(body.crew_id || "").trim();
  if (!showId || !crewId) return NextResponse.json({ message: "Show and crew member are required." }, { status: 400 });
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) return NextResponse.json({ message: "Rating must be 1 to 5 stars." }, { status: 400 });

  // Important: old events may have been created before the client selector existed.
  // Always look up the current show client here, so ratings still attach to the
  // saved business client after the event is edited or imported.
  const bodyClientId = String(body.client_id || "").trim() || null;
  const { data: showRow, error: showError } = await admin
    .from("shows")
    .select("business_client_id, client_contact_id")
    .eq("id", showId)
    .single();
  if (showError) return NextResponse.json({ message: showError.message }, { status: 400 });

  const payload = {
    show_id: showId,
    client_id: bodyClientId || (showRow?.business_client_id as string | null) || null,
    client_contact_id: String(body.client_contact_id || "").trim() || (showRow?.client_contact_id as string | null) || null,
    crew_id: crewId,
    assignment_id: String(body.assignment_id || "").trim() || null,
    rating,
    notes: String(body.notes || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("tech_ratings")
    .upsert(payload, { onConflict: "show_id,crew_id" })
    .select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rating: data, message: "Rating saved." });
}
