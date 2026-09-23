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
  const showId = url.searchParams.get("show_id");
  let query = supabase
    .from("assignment_notes")
    .select("id, show_id, crew_member_id, assignment_id, note_code, note_label, custom_note, visibility, created_at")
    .order("created_at", { ascending: true });
  if (showId) query = query.eq("show_id", showId);
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
  const notes = Array.isArray(body.notes) ? body.notes : [];
  const showId = String(body.show_id || "").trim();
  const crewMemberId = String(body.crew_member_id || "").trim();
  const assignmentId = String(body.assignment_id || "").trim() || null;
  const assignmentIds = Array.isArray(body.assignment_ids)
    ? [...new Set(body.assignment_ids.map((item: unknown) => String(item || "").trim()).filter(Boolean))]
    : [];
  const targetAssignmentIds = assignmentIds.length ? assignmentIds : [assignmentId];
  const visibility = String(body.visibility || "admin_only").trim() || "admin_only";

  if (!showId || !crewMemberId) {
    return NextResponse.json({ message: "Show and crew member are required." }, { status: 400 });
  }

  const rows = targetAssignmentIds.flatMap((targetAssignmentId) => notes
    .map((note: { note_code?: string; note_label?: string; custom_note?: string }) => ({
      show_id: showId,
      crew_member_id: crewMemberId,
      assignment_id: targetAssignmentId,
      note_code: String(note.note_code || "custom").trim() || "custom",
      note_label: String(note.note_label || "Custom note").trim() || "Custom note",
      custom_note: String(note.custom_note || "").trim(),
      visibility,
    }))
    .filter((note: { note_label: string; custom_note: string }) => note.note_label || note.custom_note));

  if (!rows.length) {
    return NextResponse.json({ message: "Choose at least one note or enter a custom note." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("assignment_notes")
    .insert(rows)
    .select("id, show_id, crew_member_id, assignment_id, note_code, note_label, custom_note, visibility, created_at");
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rows: data ?? [], message: "Worker notes saved." });
}
