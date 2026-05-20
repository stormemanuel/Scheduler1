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
  const showId = String(body.show_id || "").trim();
  const crewId = String(body.crew_id || "").trim();
  const active = body.active !== false;
  if (!showId || !crewId) return NextResponse.json({ message: "Show and crew member are required." }, { status: 400 });

  const { data: showRow, error: showError } = await admin
    .from("shows")
    .select("business_client_id, client_contact_id")
    .eq("id", showId)
    .single();
  if (showError) return NextResponse.json({ message: showError.message }, { status: 400 });

  const clientContactId = String(body.client_contact_id || "").trim() || (showRow?.client_contact_id as string | null) || null;
  const clientId = String(body.client_id || "").trim() || (showRow?.business_client_id as string | null) || null;
  if (!clientContactId) {
    return NextResponse.json({ message: "Choose a project manager/client contact before marking a favorite." }, { status: 400 });
  }

  if (!active) {
    const { error } = await admin
      .from("project_manager_favorites")
      .delete()
      .eq("client_contact_id", clientContactId)
      .eq("crew_id", crewId);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, deleted: true, message: "Project manager favorite removed." });
  }

  const payload = {
    client_id: clientId,
    client_contact_id: clientContactId,
    crew_id: crewId,
    source_show_id: showId,
    source_assignment_id: String(body.assignment_id || "").trim() || null,
    favorite_note: String(body.favorite_note || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("project_manager_favorites")
    .upsert(payload, { onConflict: "client_contact_id,crew_id" })
    .select("id, client_id, client_contact_id, crew_id, source_show_id, source_assignment_id, favorite_note, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, favorite: data, message: "Marked as requested back / project manager favorite." });
}
