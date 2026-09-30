import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

type FeedbackFormKind = "project-manager" | "area-manager" | "crew-lead" | "labor-coordinator";

type OverrideRow = {
  id: string;
  show_id: string;
  sub_call_id: string | null;
  crew_id: string;
  reason: string | null;
  created_at: string;
};

type ExclusionRow = {
  id: string;
  show_id: string;
  form_kind: FeedbackFormKind;
  area_name: string | null;
  crew_id: string;
  reason: string | null;
  created_at: string;
};

async function requireOwnerAdmin() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, response: NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 }) };

  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = String((profile as { role?: string | null } | null)?.role || "viewer").toLowerCase();
  if (error || !["owner", "admin"].includes(role)) {
    return { ok: false as const, response: NextResponse.json({ message: "Only owner/admin users can manage feedback survey rosters." }, { status: 403 }) };
  }

  return { ok: true as const, user, admin };
}

function schemaMissing(error: { message?: string } | null | undefined) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("feedback_survey_roster_overrides") || message.includes("feedback_survey_roster_exclusions") || message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find");
}

function cleanKind(value: unknown): FeedbackFormKind {
  const text = String(value || "project-manager").trim();
  if (text === "area-manager" || text === "crew-lead" || text === "labor-coordinator" || text === "project-manager") return text;
  return "project-manager";
}

function cleanArea(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

async function loadShowCallIds(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string) {
  const { data: days, error: daysError } = await admin.from("labor_days").select("id").eq("show_id", showId);
  if (daysError) throw daysError;
  const dayIds = ((days ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (!dayIds.length) return new Set<string>();

  const { data: calls, error: callsError } = await admin.from("sub_calls").select("id").in("labor_day_id", dayIds);
  if (callsError) throw callsError;
  return new Set(((calls ?? []) as Array<{ id: string }>).map((row) => row.id));
}

async function crewWorkedShow(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string, crewId: string) {
  const showCallIds = await loadShowCallIds(admin, showId);
  if (!showCallIds.size) return false;
  const { data, error } = await admin
    .from("assignments")
    .select("id, sub_call_id")
    .eq("crew_id", crewId)
    .in("sub_call_id", [...showCallIds])
    .limit(1);
  if (error) throw error;
  return Boolean((data ?? []).length);
}

async function findExclusion(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  showId: string,
  formKind: FeedbackFormKind,
  areaName: string | null,
  crewId: string,
) {
  let query = admin
    .from("feedback_survey_roster_exclusions")
    .select("id, show_id, form_kind, area_name, crew_id, reason, created_at")
    .eq("show_id", showId)
    .eq("form_kind", formKind)
    .eq("crew_id", crewId);
  query = areaName ? query.eq("area_name", areaName) : query.is("area_name", null);
  const { data, error } = await query.maybeSingle();
  if (error && !schemaMissing(error)) throw error;
  return data as ExclusionRow | null;
}

export async function GET(request: Request) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;
  const showId = String(new URL(request.url).searchParams.get("show_id") || "").trim();
  if (!showId) return NextResponse.json({ message: "show_id is required." }, { status: 400 });

  const { data, error } = await auth.admin
    .from("feedback_survey_roster_overrides")
    .select("id, show_id, sub_call_id, crew_id, reason, created_at")
    .eq("show_id", showId)
    .order("created_at", { ascending: true });

  let exclusions: ExclusionRow[] = [];
  const exclusionRes = await auth.admin
    .from("feedback_survey_roster_exclusions")
    .select("id, show_id, form_kind, area_name, crew_id, reason, created_at")
    .eq("show_id", showId)
    .order("created_at", { ascending: true });
  if (!exclusionRes.error) exclusions = (exclusionRes.data ?? []) as ExclusionRow[];

  if (error) {
    if (schemaMissing(error)) {
      return NextResponse.json({ ok: true, overrides: [] as OverrideRow[], exclusions, message: "Run supabase/ELS148_required_migrations.sql to enable feedback survey roster tools." });
    }
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, overrides: (data ?? []) as OverrideRow[], exclusions });
}

export async function POST(request: Request) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const mode = String(body.mode || "add").trim();
  const showId = String(body.show_id || "").trim();
  const subCallId = String(body.sub_call_id || "").trim();
  const crewId = String(body.crew_id || "").trim();
  const formKind = cleanKind(body.form_kind);
  const areaName = cleanArea(body.area_name);
  const reason = String(body.reason || "").trim() || (mode === "exclude" ? "Removed from this feedback rating list." : "Added to this feedback survey roster.");

  if (!showId || !crewId) {
    return NextResponse.json({ message: "Show and crew member are required." }, { status: 400 });
  }

  try {
    if (!(await crewWorkedShow(auth.admin, showId, crewId))) {
      return NextResponse.json({ message: "Only crew members already assigned somewhere on this show can be managed on a feedback survey roster." }, { status: 400 });
    }

    if (mode === "exclude") {
      const existing = await findExclusion(auth.admin, showId, formKind, areaName, crewId);
      if (existing) return NextResponse.json({ ok: true, exclusion: existing, message: "This crew member is already removed from this rating list." });

      const { data, error } = await auth.admin
        .from("feedback_survey_roster_exclusions")
        .insert({ show_id: showId, form_kind: formKind, area_name: areaName, crew_id: crewId, added_by: auth.user.id, reason })
        .select("id, show_id, form_kind, area_name, crew_id, reason, created_at")
        .single();
      if (error) throw error;
      return NextResponse.json({ ok: true, exclusion: data as ExclusionRow, message: "Crew member removed from this feedback rating list only." });
    }

    const existingExclusion = await findExclusion(auth.admin, showId, formKind, areaName, crewId);
    if (existingExclusion) {
      const { error } = await auth.admin.from("feedback_survey_roster_exclusions").delete().eq("id", existingExclusion.id);
      if (error) throw error;
      return NextResponse.json({ ok: true, removed_exclusion_id: existingExclusion.id, message: "Crew member added back to this feedback rating list." });
    }

    if (formKind === "area-manager") {
      if (!subCallId) return NextResponse.json({ message: "Sub-call is required for booth / area feedback roster additions." }, { status: 400 });
      const showCallIds = await loadShowCallIds(auth.admin, showId);
      if (!showCallIds.has(subCallId)) return NextResponse.json({ message: "That sub-call does not belong to the selected show." }, { status: 400 });

      const { data: directAssignment, error: directError } = await auth.admin
        .from("assignments")
        .select("id")
        .eq("sub_call_id", subCallId)
        .eq("crew_id", crewId)
        .limit(1);
      if (directError) throw directError;
      if ((directAssignment ?? []).length) {
        return NextResponse.json({ ok: true, already_in_roster: true, message: "This crew member is already assigned to this feedback roster." });
      }

      const { data: existing, error: existingError } = await auth.admin
        .from("feedback_survey_roster_overrides")
        .select("id, show_id, sub_call_id, crew_id, reason, created_at")
        .eq("show_id", showId)
        .eq("sub_call_id", subCallId)
        .eq("crew_id", crewId)
        .maybeSingle();
      if (existingError && !schemaMissing(existingError)) throw existingError;
      if (existing) {
        return NextResponse.json({ ok: true, override: existing as OverrideRow, message: "This crew member is already on this feedback survey roster." });
      }

      const { data, error } = await auth.admin
        .from("feedback_survey_roster_overrides")
        .insert({ show_id: showId, sub_call_id: subCallId, crew_id: crewId, added_by: auth.user.id, reason })
        .select("id, show_id, sub_call_id, crew_id, reason, created_at")
        .single();
      if (error) throw error;

      return NextResponse.json({ ok: true, override: data as OverrideRow, message: "Crew member added to this feedback survey roster." });
    }

    return NextResponse.json({ ok: true, message: "Crew member is already on this rating list." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not manage feedback survey roster.";
    return NextResponse.json({ message: schemaMissing(error as { message?: string }) ? `${message} Run supabase/ELS148_required_migrations.sql first.` : message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const url = new URL(request.url);
  const id = String(body.id || url.searchParams.get("id") || "").trim();
  const exclusionId = String(body.exclusion_id || url.searchParams.get("exclusion_id") || "").trim();

  if (exclusionId) {
    const { error } = await auth.admin.from("feedback_survey_roster_exclusions").delete().eq("id", exclusionId);
    if (error) return NextResponse.json({ message: schemaMissing(error) ? `${error.message} Run supabase/ELS148_required_migrations.sql first.` : error.message }, { status: 400 });
    return NextResponse.json({ ok: true, message: "Crew member added back to this feedback rating list." });
  }

  if (!id) return NextResponse.json({ message: "Override id is required." }, { status: 400 });
  const { error } = await auth.admin.from("feedback_survey_roster_overrides").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ message: schemaMissing(error) ? `${error.message} Run supabase/ELS148_required_migrations.sql first.` : error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: "Feedback-only roster addition removed." });
}
