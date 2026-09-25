import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { normalizeRole } from "@/lib/auth";
import { ASSIGNMENT_RATE_OVERRIDE_NOTE_CODE } from "@/lib/events-types";

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
  if (body.action === "set_rate_override") {
    const profile = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    const role = normalizeRole((profile.data as { role?: string | null } | null)?.role);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ message: "Only an owner or admin can change crew pay rates." }, { status: 403 });
    }
    const showId = String(body.show_id || "").trim();
    const assignmentIds = Array.isArray(body.assignment_ids)
      ? [...new Set(body.assignment_ids.map((item: unknown) => String(item || "").trim()).filter(Boolean))]
      : [];
    const parsedRate = Number(body.full_day_rate);
    const clear = body.full_day_rate === null || body.full_day_rate === "" || parsedRate === 0;
    if (!showId || !assignmentIds.length) return NextResponse.json({ message: "Choose at least one assigned person." }, { status: 400 });
    if (!clear && (!Number.isFinite(parsedRate) || parsedRate <= 0)) return NextResponse.json({ message: "Enter a valid full-day crew pay rate." }, { status: 400 });

    const assignmentResult = await admin.from("assignments").select("id, crew_id, sub_call_id").in("id", assignmentIds);
    if (assignmentResult.error) return NextResponse.json({ message: assignmentResult.error.message }, { status: 400 });
    const assignmentRows = (assignmentResult.data || []) as Array<{ id: string; crew_id: string; sub_call_id: string }>;
    if (assignmentRows.length !== assignmentIds.length) return NextResponse.json({ message: "One or more crew assignments could not be found." }, { status: 404 });
    const callIds = [...new Set(assignmentRows.map((row) => row.sub_call_id))];
    const calls = await admin.from("sub_calls").select("id, labor_day_id").in("id", callIds);
    if (calls.error) return NextResponse.json({ message: calls.error.message }, { status: 400 });
    const dayIds = [...new Set(((calls.data || []) as Array<{ labor_day_id: string }>).map((row) => row.labor_day_id))];
    const days = await admin.from("labor_days").select("id, show_id").in("id", dayIds);
    if (days.error || (days.data || []).some((row: { show_id: string }) => row.show_id !== showId)) {
      return NextResponse.json({ message: days.error?.message || "Those assignments do not belong to this show." }, { status: 400 });
    }

    const existing = await admin.from("assignment_notes").select("id").in("assignment_id", assignmentIds).eq("note_code", ASSIGNMENT_RATE_OVERRIDE_NOTE_CODE);
    if (existing.error) return NextResponse.json({ message: existing.error.message }, { status: 400 });
    const removedIds = ((existing.data || []) as Array<{ id: string }>).map((row) => row.id);
    if (removedIds.length) {
      const removed = await admin.from("assignment_notes").delete().in("id", removedIds);
      if (removed.error) return NextResponse.json({ message: removed.error.message }, { status: 400 });
    }
    if (clear) return NextResponse.json({ ok: true, rows: [], removed_ids: removedIds, message: "Show rate override cleared." });
    const rows = assignmentRows.map((assignment) => ({
      show_id: showId,
      crew_member_id: assignment.crew_id,
      assignment_id: assignment.id,
      note_code: ASSIGNMENT_RATE_OVERRIDE_NOTE_CODE,
      note_label: "Show full-day rate",
      custom_note: (Math.round(parsedRate * 100) / 100).toFixed(2),
      visibility: "admin_only",
    }));
    const inserted = await admin.from("assignment_notes").insert(rows).select("id, show_id, crew_member_id, assignment_id, note_code, note_label, custom_note, visibility, created_at");
    if (inserted.error) return NextResponse.json({ message: inserted.error.message }, { status: 400 });
    return NextResponse.json({ ok: true, rows: inserted.data || [], removed_ids: removedIds, message: `Higher rate applied to ${rows.length} crew assignment${rows.length === 1 ? "" : "s"}.` });
  }
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
