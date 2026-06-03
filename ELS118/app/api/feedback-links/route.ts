import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

type SurveyLinkRow = {
  id: string;
  token: string;
  show_id: string;
  client_id: string | null;
  client_contact_id: string | null;
  form_kind: "project-manager" | "area-manager" | "crew-lead" | "labor-coordinator";
  area_name: string | null;
  title: string;
  target_label: string | null;
  status: string;
};

async function findExistingLink(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string, formKind: string, areaName: string | null) {
  let query = admin
    .from("feedback_survey_links")
    .select("id, token, show_id, client_id, client_contact_id, form_kind, area_name, title, target_label, status")
    .eq("show_id", showId)
    .eq("form_kind", formKind);
  query = areaName ? query.eq("area_name", areaName) : query.is("area_name", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data as SurveyLinkRow | null;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  const showId = String(body.show_id || "").trim();
  if (!showId) return NextResponse.json({ message: "Show is required." }, { status: 400 });

  const { data: show, error: showError } = await admin
    .from("shows")
    .select("id, name, client, business_client_id, client_contact_id, coordinator_contact_id, venue")
    .eq("id", showId)
    .single();
  if (showError || !show) return NextResponse.json({ message: showError?.message || "Show not found." }, { status: 404 });

  const { data: laborDays, error: daysError } = await admin
    .from("labor_days")
    .select("id")
    .eq("show_id", showId);
  if (daysError) return NextResponse.json({ message: daysError.message }, { status: 400 });

  const dayIds = ((laborDays ?? []) as Array<{ id: string }>).map((row) => row.id);
  const { data: calls, error: callsError } = dayIds.length
    ? await admin.from("sub_calls").select("area").in("labor_day_id", dayIds)
    : { data: [], error: null };
  if (callsError) return NextResponse.json({ message: callsError.message }, { status: 400 });

  const callRows = (calls ?? []) as Array<{ area?: string | null }>;
  const areas = [...new Set(callRows.map((row) => String(row.area || "").trim()).filter(Boolean))].sort((a: string, b: string) => a.localeCompare(b));
  const specs = [
    {
      form_kind: "labor-coordinator" as const,
      area_name: null as string | null,
      title: `${show.name || "ELS Show"} - Client Labor Coordinator Feedback Survey`,
      target_label: "Client Labor Coordinator",
      client_contact_id: (show.coordinator_contact_id as string | null) || null,
    },
    {
      form_kind: "project-manager" as const,
      area_name: null as string | null,
      title: `${show.name || "ELS Show"} - Project Manager Feedback Survey`,
      target_label: "Project Manager / Overall Event Contact",
      client_contact_id: (show.client_contact_id as string | null) || null,
    },
    ...areas.map((area) => ({
      form_kind: "area-manager" as const,
      area_name: area,
      title: `${show.name || "ELS Show"} - ${area} Area Manager Feedback Survey`,
      target_label: `Booth / Area Manager - ${area}`,
      client_contact_id: null as string | null,
    })),
    {
      form_kind: "crew-lead" as const,
      area_name: null as string | null,
      title: `${show.name || "ELS Show"} - Crew Lead Feedback Survey`,
      target_label: "Crew Lead / ELS Internal Feedback",
      client_contact_id: null as string | null,
    },
  ];

  const links: SurveyLinkRow[] = [];
  for (const spec of specs) {
    const existing = await findExistingLink(admin, showId, spec.form_kind, spec.area_name);
    if (existing) {
      const { data, error } = await admin
        .from("feedback_survey_links")
        .update({
          client_id: (show.business_client_id as string | null) || null,
          client_contact_id: spec.client_contact_id || null,
          title: spec.title,
          target_label: spec.target_label,
          status: "open",
        })
        .eq("id", existing.id)
        .select("id, token, show_id, client_id, client_contact_id, form_kind, area_name, title, target_label, status")
        .single();
      if (error) return NextResponse.json({ message: error.message }, { status: 400 });
      links.push(data as SurveyLinkRow);
    } else {
      const { data, error } = await admin
        .from("feedback_survey_links")
        .insert({
          show_id: showId,
          client_id: (show.business_client_id as string | null) || null,
          client_contact_id: spec.client_contact_id || null,
          form_kind: spec.form_kind,
          area_name: spec.area_name,
          title: spec.title,
          target_label: spec.target_label,
          status: "open",
        })
        .select("id, token, show_id, client_id, client_contact_id, form_kind, area_name, title, target_label, status")
        .single();
      if (error) return NextResponse.json({ message: error.message }, { status: 400 });
      links.push(data as SurveyLinkRow);
    }
  }

  return NextResponse.json({
    ok: true,
    links: links.map((link) => ({ ...link, url_path: `/feedback/${link.token}` })),
    message: `${links.length} connected feedback survey link${links.length === 1 ? "" : "s"} ready.`,
  });
}
