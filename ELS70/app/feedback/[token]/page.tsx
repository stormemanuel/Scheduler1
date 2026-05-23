import FeedbackForm from "./feedback-form";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projectManagerQuestions = [
  { key: "recommend", label: "Overall intent to recommend", helper: "How likely are you to recommend Emanuel Labor Services?" },
  { key: "planning", label: "Overall planning experience", helper: "Scheduling, preparation, clarity, and ease before show site." },
  { key: "response_time", label: "Response time", helper: "How quickly and clearly did we respond?" },
  { key: "offerings_match", label: "Did our offerings match your needs?", helper: "Were the labor roles, support level, and coverage a good fit?" },
  { key: "billing", label: "Billing experience", helper: "Clarity of rates, invoices, PO handling, and billing communication." },
  { key: "onsite", label: "Overall on-site experience", helper: "How did the ELS labor support feel on site?" },
  { key: "competence", label: "Staff competence and ability", helper: "Skill level, professionalism, and ability to execute the work." },
  { key: "timeliness", label: "Timeliness", helper: "Arrival, readiness, schedule coverage, and pace of work." },
  { key: "event_success", label: "Was your event successful?", helper: "How successful was the event from your perspective?" },
];

const areaManagerQuestions = [
  { key: "onsite", label: "Overall on-site experience", helper: "How was your experience with ELS support in this booth or area?" },
  { key: "competence", label: "Staff competence", helper: "Did the assigned techs have the skill, attitude, and professionalism needed?" },
];

const crewLeadQuestions = [
  { key: "onsite", label: "Overall on-site execution", helper: "How smoothly did the work run on site?" },
  { key: "communication", label: "Communication with ELS and client", helper: "Were details, changes, and expectations clear?" },
  { key: "crew_readiness", label: "Crew readiness and punctuality", helper: "Did the crew arrive prepared and ready to work?" },
  { key: "staff_competence", label: "Staff competence and ability", helper: "Did the team have the skill level needed for the assignment?" },
  { key: "teamwork", label: "Teamwork and attitude", helper: "How well did the crew work together and represent ELS?" },
];

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return "";
  if (start === end || !end) return start || "";
  return `${start} to ${end}`;
}

function timeRange(start: string | null, end: string | null) {
  const trim = (value: string | null) => String(value || "").slice(0, 5);
  return [trim(start), trim(end)].filter(Boolean).join("–");
}

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const admin = createSupabaseAdminClient();
  const { token } = await params;
  const cleanToken = String(token || "").trim();
  if (!/^[a-zA-Z0-9_-]{12,96}$/.test(cleanToken)) {
    return <PublicMessage title="Survey unavailable" message="This feedback link is not valid." />;
  }
  if (!admin) {
    return <PublicMessage title="Survey unavailable" message="Feedback surveys are not configured yet." />;
  }

  const { data: link } = await admin
    .from("feedback_survey_links")
    .select("id, token, show_id, client_id, client_contact_id, form_kind, area_name, title, target_label, status")
    .eq("token", cleanToken)
    .maybeSingle();

  if (!link || link.status !== "open") {
    return <PublicMessage title="Survey unavailable" message="This feedback link is closed or was not found." />;
  }

  const { data: show } = await admin
    .from("shows")
    .select("id, name, client, venue, show_start, show_end, business_client_id, client_contact_id")
    .eq("id", link.show_id)
    .single();

  if (!show) {
    return <PublicMessage title="Survey unavailable" message="The show for this survey could not be found." />;
  }

  const clientId = (link.client_id as string | null) || (show.business_client_id as string | null) || null;
  const { data: client } = clientId ? await admin.from("business_clients").select("name").eq("id", clientId).maybeSingle() : { data: null };

  const { data: days } = await admin.from("labor_days").select("id, labor_date").eq("show_id", show.id).order("labor_date", { ascending: true });
  const dayIds = (days ?? []).map((day) => day.id as string);
  let calls: Array<{ id: string; area: string | null; role_name: string | null; start_time: string | null; end_time: string | null; labor_day_id: string }> = [];
  if (dayIds.length) {
    let callQuery = admin.from("sub_calls").select("id, area, role_name, start_time, end_time, labor_day_id").in("labor_day_id", dayIds);
    if (link.form_kind === "area-manager" && link.area_name) callQuery = callQuery.eq("area", link.area_name);
    const { data } = await callQuery.order("start_time", { ascending: true });
    calls = (data ?? []) as typeof calls;
  }

  const callIds = calls.map((call) => call.id);
  const { data: assignments } = callIds.length
    ? await admin.from("assignments").select("id, sub_call_id, crew_id, sort_order").in("sub_call_id", callIds).order("sort_order", { ascending: true })
    : { data: [] };
  const crewIds = [...new Set((assignments ?? []).map((assignment) => assignment.crew_id as string))];
  const { data: crewRows } = crewIds.length
    ? await admin.from("crew").select("id, name").in("id", crewIds)
    : { data: [] };

  const dayById = new Map((days ?? []).map((day) => [day.id as string, day.labor_date as string]));
  const callById = new Map(calls.map((call) => [call.id, call]));
  const crewById = new Map((crewRows ?? []).map((crew) => [crew.id as string, crew.name as string]));
  const techMap = new Map<string, { crew_id: string; crew_name: string; first_schedule: string }>();
  for (const assignment of [...(assignments ?? [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const crewId = assignment.crew_id as string;
    if (techMap.has(crewId)) continue;
    const call = callById.get(assignment.sub_call_id as string);
    techMap.set(crewId, {
      crew_id: crewId,
      crew_name: crewById.get(crewId) || "Assigned tech",
      first_schedule: call ? [dayById.get(call.labor_day_id), timeRange(call.start_time, call.end_time), call.role_name, call.area].filter(Boolean).join(" · ") : "Assigned to this show",
    });
  }

  const survey = {
    token: link.token as string,
    form_kind: link.form_kind as "project-manager" | "area-manager" | "crew-lead",
    title: (link.title as string) || `${show.name} Feedback Survey`,
    target_label: (link.target_label as string | null) || (link.form_kind === "area-manager" ? "Booth / Area Manager" : link.form_kind === "crew-lead" ? "Crew Lead" : "Project Manager"),
    show_name: (show.name as string | null) || "ELS Show",
    client_name: (client?.name as string | undefined) || (show.client as string | null) || "Client",
    venue: (show.venue as string | null) || "Venue",
    date_range: formatDateRange(show.show_start as string | null, show.show_end as string | null),
    area_name: link.area_name as string | null,
    questions: link.form_kind === "area-manager" ? areaManagerQuestions : link.form_kind === "crew-lead" ? crewLeadQuestions : projectManagerQuestions,
    tech_rows: [...techMap.values()].sort((a, b) => a.crew_name.localeCompare(b.crew_name)),
  };

  return (
    <>
      <PublicStyles />
      <FeedbackForm survey={survey} />
    </>
  );
}

function PublicMessage({ title, message }: { title: string; message: string }) {
  return (
    <>
      <PublicStyles />
      <main className="feedback-public-wrap"><section className="feedback-public-card"><h1>{title}</h1><p>{message}</p></section></main>
    </>
  );
}

function PublicStyles() {
  return <style>{`
    .topbar, .sessionbar { display: none !important; }
    .shell { max-width: 980px !important; padding-left: 16px !important; padding-right: 16px !important; }
    .feedback-public-wrap { display: grid; gap: 18px; padding-bottom: 48px; }
    .feedback-hero-card, .feedback-public-card { background: rgba(255,255,255,.96); border: 1px solid var(--line); border-radius: 28px; padding: 24px; box-shadow: var(--shadow); }
    .feedback-hero-card { background: linear-gradient(135deg, #ffffff 0%, #fff8d8 100%); }
    .feedback-kicker { color: var(--brand-2); text-transform: uppercase; font-size: .78rem; letter-spacing: .10em; font-weight: 800; margin-bottom: 6px; }
    .feedback-hero-card h1, .feedback-public-card h1, .feedback-public-card h2 { margin: 0 0 8px; letter-spacing: -.03em; }
    .feedback-hero-card p { color: var(--muted); max-width: 760px; font-size: 1.05rem; }
    .feedback-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-top: 16px; }
    .feedback-meta-grid div { background: rgba(255,255,255,.82); border: 1px solid var(--line); border-radius: 16px; padding: 12px; }
    .feedback-meta-grid span { display: block; color: var(--muted); font-size: .82rem; margin-bottom: 3px; }
    .survey-heading-row, .submit-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; }
    .time-pill { background: var(--accent-soft); border: 1px solid rgba(255,210,26,.65); border-radius: 999px; padding: 7px 12px; font-weight: 700; white-space: nowrap; }
    .feedback-grid { display: grid; gap: 12px; }
    .feedback-grid.two { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .feedback-public-card label { display: grid; gap: 6px; color: var(--text); font-weight: 650; margin: 12px 0; }
    .feedback-public-card input, .feedback-public-card select, .feedback-public-card textarea { width: 100%; border: 1px solid var(--line); border-radius: 14px; padding: 12px; font: inherit; background: #fff; color: var(--text); font-weight: 400; }
    .feedback-public-card input:focus, .feedback-public-card select:focus, .feedback-public-card textarea:focus, .star-option:focus-visible { outline: 3px solid rgba(255,210,26,.52); outline-offset: 2px; border-color: var(--brand-2); }
    .question-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .question-card, .tech-card { border: 1px solid var(--line); border-radius: 20px; padding: 16px; background: var(--soft); }
    .question-card legend { font-weight: 800; padding: 0 5px; }
    .question-card p, .tech-card p { color: var(--muted); margin: 5px 0 12px; }
    .star-rating { display: grid; grid-template-columns: repeat(5, minmax(48px, 1fr)); gap: 10px; width: 100%; max-width: 410px; }
    .star-option { min-height: 48px; min-width: 48px; border: 1px solid var(--line); border-radius: 16px; background: #fff; color: var(--text); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font: inherit; font-weight: 800; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    .star-option.selected { background: var(--brand); border-color: var(--brand); color: #fff; box-shadow: 0 8px 18px rgba(6,42,49,.18); }
    .star-option:active { transform: scale(.98); }
    .star-glyph { font-size: 1.05rem; line-height: 1; color: #a87300; }
    .star-option.selected .star-glyph { color: #fff; }
    .star-number { font-variant-numeric: tabular-nums; }
    .tech-list { display: grid; gap: 12px; }
    .primary { min-height: 48px; }
    .primary[disabled] { opacity: .72; cursor: wait; transform: none; }
    .success-card { text-align: center; max-width: 640px; margin: 0 auto; }
    .checkmark { width: 58px; height: 58px; border-radius: 999px; background: var(--success); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 800; margin-bottom: 8px; }
    @media (max-width: 680px) {
      .shell { padding: 12px !important; }
      .feedback-hero-card, .feedback-public-card { border-radius: 20px; padding: 18px; }
      .survey-heading-row, .submit-row { display: grid; }
      .question-grid { grid-template-columns: 1fr; }
      .feedback-grid.two { grid-template-columns: 1fr; }
      .star-rating { grid-template-columns: repeat(5, minmax(52px, 1fr)); gap: 8px; max-width: none; }
      .star-option { min-height: 54px; border-radius: 14px; font-size: 1rem; }
      .feedback-meta-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 370px) {
      .star-rating { grid-template-columns: repeat(5, minmax(46px, 1fr)); gap: 6px; }
      .star-option { min-width: 46px; min-height: 50px; padding: 0 2px; }
    }
  `}</style>;
}
