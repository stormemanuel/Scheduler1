import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projectManagerQuestions = [
  ["recommend", "Overall intent to recommend"],
  ["planning", "Overall planning experience"],
  ["response_time", "Response time"],
  ["offerings_match", "Did our offerings match your needs?"],
  ["billing", "Billing experience"],
  ["onsite", "Overall on-site experience"],
  ["competence", "Staff competence and ability"],
  ["timeliness", "Timeliness"],
  ["event_success", "Was your event successful?"],
] as const;

const areaManagerQuestions = [
  ["onsite", "Overall on-site experience"],
  ["competence", "Staff competence"],
] as const;

type LinkRow = {
  id: string;
  show_id: string;
  client_id: string | null;
  client_contact_id: string | null;
  form_kind: "project-manager" | "area-manager";
  area_name: string | null;
  status: string;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim() || null;
}

function ratingValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 5) return null;
  return Math.round(numeric);
}

async function resolveClientContactId(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, link: LinkRow, body: Record<string, unknown>) {
  if (link.client_contact_id) return link.client_contact_id;
  if (!link.client_id) return null;

  const respondentName = cleanText(body.respondent_name);
  const respondentEmail = cleanText(body.respondent_email);
  if (!respondentName && !respondentEmail) return null;

  if (respondentEmail) {
    const { data, error } = await admin
      .from("client_contacts")
      .select("id")
      .eq("client_id", link.client_id)
      .eq("email", respondentEmail)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data.id as string;
  }

  if (respondentName) {
    const { data, error } = await admin
      .from("client_contacts")
      .select("id")
      .eq("client_id", link.client_id)
      .ilike("name", respondentName)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return data.id as string;
  }

  const { data, error } = await admin
    .from("client_contacts")
    .insert({
      client_id: link.client_id,
      name: respondentName || respondentEmail || "Feedback Respondent",
      title: cleanText(body.respondent_title) || (link.form_kind === "area-manager" ? "Booth / Area Manager" : "Project Manager"),
      email: respondentEmail,
      is_primary: false,
      is_onsite_contact: link.form_kind === "area-manager",
      is_billing_contact: false,
      notes: "Created from a connected ELS feedback survey submission.",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function getAllowedTechs(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string, areaName: string | null) {
  const { data: days, error: daysError } = await admin.from("labor_days").select("id").eq("show_id", showId);
  if (daysError) throw daysError;
  const dayIds = ((days ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (!dayIds.length) return new Map<string, { assignmentId: string | null; areaName: string | null }>();

  let callQuery = admin.from("sub_calls").select("id, area").in("labor_day_id", dayIds);
  if (areaName) callQuery = callQuery.eq("area", areaName);
  const { data: calls, error: callsError } = await callQuery;
  if (callsError) throw callsError;
  const callRows = (calls ?? []) as Array<{ id: string; area: string | null }>;
  const callIds = callRows.map((row) => row.id);
  const areaByCallId = new Map<string, string | null>(callRows.map((row) => [row.id, row.area || null]));
  if (!callIds.length) return new Map<string, { assignmentId: string | null; areaName: string | null }>();

  const { data: assignments, error: assignmentsError } = await admin
    .from("assignments")
    .select("id, sub_call_id, crew_id, sort_order")
    .in("sub_call_id", callIds)
    .order("sort_order", { ascending: true });
  if (assignmentsError) throw assignmentsError;

  const allowed = new Map<string, { assignmentId: string | null; areaName: string | null }>();
  for (const assignment of (assignments ?? []) as Array<{ id: string; sub_call_id: string; crew_id: string }>) {
    const crewId = assignment.crew_id;
    if (!allowed.has(crewId)) {
      allowed.set(crewId, { assignmentId: assignment.id, areaName: areaByCallId.get(assignment.sub_call_id) ?? null });
    }
  }
  return allowed;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "Supabase service role is not configured." }, { status: 500 });

  const { token } = await params;
  const cleanToken = String(token || "").trim();
  if (!/^[a-zA-Z0-9_-]{12,96}$/.test(cleanToken)) {
    return NextResponse.json({ message: "This feedback link is not valid." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const { data: link, error: linkError } = await admin
    .from("feedback_survey_links")
    .select("id, show_id, client_id, client_contact_id, form_kind, area_name, status")
    .eq("token", cleanToken)
    .single();
  if (linkError || !link) return NextResponse.json({ message: "This feedback link was not found." }, { status: 404 });
  const linkRow = link as LinkRow;
  if (linkRow.status !== "open") return NextResponse.json({ message: "This feedback survey is closed." }, { status: 400 });

  try {
    const clientContactId = await resolveClientContactId(admin, linkRow, body);
    const responsePayload = {
      survey_link_id: linkRow.id,
      show_id: linkRow.show_id,
      client_id: linkRow.client_id,
      client_contact_id: clientContactId,
      form_kind: linkRow.form_kind,
      area_name: linkRow.area_name,
      respondent_name: cleanText(body.respondent_name),
      respondent_title: cleanText(body.respondent_title),
      respondent_email: cleanText(body.respondent_email),
      request_again: cleanText(body.request_again),
      testimonial_permission: cleanText(body.testimonial_permission),
      testimonial_text: cleanText(body.testimonial_text),
      went_well: cleanText(body.went_well),
      follow_up: cleanText(body.follow_up),
      additional_comments: cleanText(body.additional_comments),
    };

    const { data: responseRow, error: responseError } = await admin
      .from("client_feedback_responses")
      .insert(responsePayload)
      .select("id")
      .single();
    if (responseError) throw responseError;
    const responseId = responseRow.id as string;

    const questionPairs = linkRow.form_kind === "area-manager" ? areaManagerQuestions : projectManagerQuestions;
    const ratings = (body.ratings && typeof body.ratings === "object") ? body.ratings as Record<string, unknown> : {};
    const scoreRows = questionPairs
      .map(([key, label]) => ({
        response_id: responseId,
        question_key: key,
        question_label: label,
        rating: ratingValue(ratings[key]),
      }))
      .filter((row) => row.rating !== null);
    if (scoreRows.length) {
      const { error } = await admin.from("client_feedback_scores").insert(scoreRows);
      if (error) throw error;
    }

    const techRatings = Array.isArray(body.tech_ratings) ? body.tech_ratings as Array<Record<string, unknown>> : [];
    const allowedTechs = await getAllowedTechs(admin, linkRow.show_id, linkRow.form_kind === "area-manager" ? linkRow.area_name : null);
    const techRows = techRatings.flatMap((item) => {
      const crewId = cleanText(item.crew_id);
      const rating = ratingValue(item.rating);
      if (!crewId || rating === null || !allowedTechs.has(crewId)) return [];
      const allowed = allowedTechs.get(crewId)!;
      return [{
        response_id: responseId,
        survey_link_id: linkRow.id,
        show_id: linkRow.show_id,
        client_id: linkRow.client_id,
        client_contact_id: clientContactId,
        crew_id: crewId,
        assignment_id: allowed.assignmentId,
        area_name: linkRow.area_name || allowed.areaName,
        rating,
        request_again: cleanText(item.request_again),
        notes: cleanText(item.notes),
      }];
    });
    if (techRows.length) {
      const { error } = await admin.from("feedback_tech_ratings").insert(techRows);
      if (error) throw error;
    }

    return NextResponse.json(
      { ok: true, message: "Thank you for your feedback." },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit feedback.";
    console.error("ELS feedback submission failed", error);
    return NextResponse.json({ message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
