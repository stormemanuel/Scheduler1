import FeedbackForm from "./feedback-form";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const projectManagerQuestions = [
  { key: "onsite", label: "Overall on-site experience", helper: "How did the ELS labor support feel on site?" },
  { key: "competence", label: "Staff competence and ability", helper: "Skill level, professionalism, and ability to execute the work." },
  { key: "timeliness", label: "Timeliness", helper: "Arrival, readiness, schedule coverage, and pace of work." },
  { key: "event_success", label: "Was your event successful?", helper: "How successful was the event from your perspective?" },
];

const laborCoordinatorQuestions = [
  { key: "booking", label: "Booking and labor coordination", helper: "How smooth was the scheduling, labor count, and confirmation process?" },
  { key: "communication", label: "Communication and responsiveness", helper: "How well did ELS communicate before and during the show?" },
  { key: "coverage", label: "Crew coverage and readiness", helper: "Were the right techs confirmed, prepared, and on time?" },
  { key: "problem_solving", label: "Problem solving", helper: "How well did ELS handle changes, replacements, or onsite issues?" },
  { key: "use_again", label: "Would you use ELS again?", helper: "Overall confidence in booking Emanuel Labor Services again." },
];

const areaManagerQuestions = [
  { key: "onsite", label: "Overall on-site experience", helper: "How was your experience with ELS support in this booth or area?" },
  { key: "competence", label: "Staff competence", helper: "Did the assigned techs have the skill, attitude, and professionalism needed?" },
];

const crewLeadQuestions = [
  { key: "show", label: "How was the show?", helper: "Overall, how did the show go from the crew lead perspective?" },
  { key: "improvements", label: "What can be improved?", helper: "Rate how much improvement is needed in planning, staffing, or execution." },
  { key: "client_satisfied", label: "Was the client satisfied?", helper: "How satisfied did the client seem with the labor support?" },
  { key: "workflow", label: "Overall work flow", helper: "How smooth was the workflow, communication, and crew coordination?" },
];

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return "";
  if (start === end || !end) return start || "";
  return `${start} to ${end}`;
}

function normalizeRoleName(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isCrewLeadFeedbackRole(roleName: string | null | undefined) {
  const role = normalizeRoleName(roleName);
  return role === "crew lead" || role === "working crew lead" || role === "working lead" || role === "labor lead" || role === "lead labor" || role.includes("crew lead");
}

function timeRange(start: string | null, end: string | null) {
  const trim = (value: string | null) => String(value || "").slice(0, 5);
  return [trim(start), trim(end)].filter(Boolean).join("–");
}

function normalizeProfilePhotoPath(value: string | null | undefined) {
  let path = String(value || "").trim();
  if (!path) return "";
  try {
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
    }
  } catch {
    // Keep the stored path when it is not a valid URL.
  }
  path = path.replace(/^\/+/, "");
  const objectMarker = "storage/v1/object/";
  const objectIndex = path.indexOf(objectMarker);
  if (objectIndex >= 0) path = path.slice(objectIndex + objectMarker.length);
  path = path.replace(/^public\//, "").replace(/^sign\//, "");
  if (path.startsWith("crew-profile-photos/")) path = path.slice("crew-profile-photos/".length);
  return path.replace(/^\/+/, "");
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
  let rosterOverrides: Array<{ id: string; sub_call_id: string | null; crew_id: string }> = [];
  if (callIds.length && link.form_kind === "area-manager") {
    const { data: overrideRows, error: overrideError } = await admin
      .from("feedback_survey_roster_overrides")
      .select("id, sub_call_id, crew_id")
      .eq("show_id", show.id)
      .in("sub_call_id", callIds);
    if (!overrideError) rosterOverrides = (overrideRows ?? []) as typeof rosterOverrides;
  }
  let rosterExclusions: Array<{ id: string; crew_id: string }> = [];
  if (link.form_kind === "project-manager" || link.form_kind === "area-manager") {
    let exclusionQuery = admin
      .from("feedback_survey_roster_exclusions")
      .select("id, crew_id")
      .eq("show_id", show.id)
      .eq("form_kind", link.form_kind as string);
    exclusionQuery = link.area_name ? exclusionQuery.eq("area_name", link.area_name as string) : exclusionQuery.is("area_name", null);
    const { data: exclusionRows, error: exclusionError } = await exclusionQuery;
    if (!exclusionError) rosterExclusions = (exclusionRows ?? []) as typeof rosterExclusions;
  }
  const crewIds = [...new Set([...(assignments ?? []).map((assignment) => assignment.crew_id as string), ...rosterOverrides.map((override) => override.crew_id)])];
  const { data: crewRows } = crewIds.length
    ? await admin.from("crew").select("id, name, profile_photo_url").in("id", crewIds)
    : { data: [] };

  const signedPhotoPairs = await Promise.all((crewRows ?? []).map(async (crew) => {
    const crewId = String((crew as { id?: string | null }).id || "");
    const path = normalizeProfilePhotoPath((crew as { profile_photo_url?: string | null }).profile_photo_url);
    if (!crewId || !path) return [crewId, ""] as const;
    const signed = await admin.storage.from("crew-profile-photos").createSignedUrl(path, 60 * 60 * 2);
    return [crewId, signed.error ? "" : String(signed.data?.signedUrl || "")] as const;
  }));
  const profilePhotoByCrewId = new Map(signedPhotoPairs.filter(([crewId]) => Boolean(crewId)));

  const dayById = new Map((days ?? []).map((day) => [day.id as string, day.labor_date as string]));
  const callById = new Map(calls.map((call) => [call.id, call]));
  const crewById = new Map((crewRows ?? []).map((crew) => [crew.id as string, crew.name as string]));
  const crewLeadCrewIds = new Set<string>();
  if (link.form_kind === "crew-lead") {
    for (const assignment of assignments ?? []) {
      const call = callById.get(assignment.sub_call_id as string);
      if (isCrewLeadFeedbackRole(call?.role_name)) crewLeadCrewIds.add(assignment.crew_id as string);
    }
  }
  const excludedCrewIds = new Set(rosterExclusions.map((row) => row.crew_id));
  const techMap = new Map<string, { crew_id: string; crew_name: string; first_schedule: string; profile_photo_url: string }>();
  for (const assignment of [...(assignments ?? [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))) {
    const crewId = assignment.crew_id as string;
    if (excludedCrewIds.has(crewId)) continue;
    if (crewLeadCrewIds.has(crewId)) continue;
    if (techMap.has(crewId)) continue;
    const call = callById.get(assignment.sub_call_id as string);
    techMap.set(crewId, {
      crew_id: crewId,
      crew_name: crewById.get(crewId) || "Assigned tech",
      first_schedule: call ? [dayById.get(call.labor_day_id), timeRange(call.start_time, call.end_time), call.role_name, call.area].filter(Boolean).join(" · ") : "Assigned to this show",
      profile_photo_url: profilePhotoByCrewId.get(crewId) || "",
    });
  }
  for (const override of rosterOverrides) {
    const crewId = override.crew_id;
    if (!crewId || excludedCrewIds.has(crewId) || techMap.has(crewId)) continue;
    const call = override.sub_call_id ? callById.get(override.sub_call_id) : null;
    techMap.set(crewId, {
      crew_id: crewId,
      crew_name: crewById.get(crewId) || "Assigned tech",
      first_schedule: call ? [dayById.get(call.labor_day_id), timeRange(call.start_time, call.end_time), call.role_name, call.area, "added to this feedback survey"].filter(Boolean).join(" · ") : "Added to this feedback survey roster",
      profile_photo_url: profilePhotoByCrewId.get(crewId) || "",
    });
  }

  const survey = {
    token: link.token as string,
    form_kind: link.form_kind as "project-manager" | "area-manager" | "crew-lead" | "labor-coordinator",
    title: (link.title as string) || `${show.name} Feedback Survey`,
    target_label: (link.target_label as string | null) || (link.form_kind === "area-manager" ? "Booth / Area Manager" : link.form_kind === "crew-lead" ? "Crew Lead" : link.form_kind === "labor-coordinator" ? "Client Labor Coordinator" : "Project Manager"),
    show_name: (show.name as string | null) || "ELS Show",
    client_name: (client?.name as string | undefined) || (show.client as string | null) || "Client",
    venue: (show.venue as string | null) || "Venue",
    date_range: formatDateRange(show.show_start as string | null, show.show_end as string | null),
    area_name: link.area_name as string | null,
    questions: link.form_kind === "area-manager" ? areaManagerQuestions : link.form_kind === "crew-lead" ? crewLeadQuestions : link.form_kind === "labor-coordinator" ? laborCoordinatorQuestions : projectManagerQuestions,
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
    .submit-safety-note { margin: 10px 0 18px; padding: 11px 13px; border: 1px solid rgba(168,115,0,.28); border-radius: 12px; background: rgba(255,210,26,.12); color: var(--text); font-size: .92rem; line-height: 1.45; }
    .feedback-public-card input, .feedback-public-card select, .feedback-public-card textarea { width: 100%; border: 1px solid var(--line); border-radius: 14px; padding: 12px; font: inherit; background: #fff; color: var(--text); font-weight: 400; }
    .feedback-public-card input:focus, .feedback-public-card select:focus, .feedback-public-card textarea:focus, .star-option:focus-visible { outline: 3px solid rgba(255,210,26,.52); outline-offset: 2px; border-color: var(--brand-2); }
    .question-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .question-card, .tech-card { border: 1px solid var(--line); border-radius: 20px; padding: 16px; background: var(--soft); }
    .question-card legend { font-weight: 800; padding: 0 5px; }
    .question-card p, .tech-card p { color: var(--muted); margin: 5px 0 12px; }
    .tech-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
    .tech-heading-copy { min-width: 0; }
    .tech-heading-copy strong { display: block; font-size: 1.02rem; }
    .tech-avatar { width: 48px; height: 48px; flex: 0 0 48px; border-radius: 999px; overflow: hidden; border: 2px solid #fff; box-shadow: 0 0 0 1px var(--line); background: #102a31; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; }
    .tech-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .star-rating { display: grid; grid-template-columns: repeat(5, minmax(48px, 1fr)); gap: 10px; width: 100%; max-width: 410px; }
    .star-option { min-height: 48px; min-width: 48px; border: 1px solid var(--line); border-radius: 16px; background: #fff; color: var(--text); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font: inherit; font-weight: 800; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    .star-option.selected { background: var(--brand); border-color: var(--brand); color: #fff; box-shadow: 0 8px 18px rgba(6,42,49,.18); }
    .star-option:active { transform: scale(.98); }
    .star-glyph { font-size: 1.05rem; line-height: 1; color: #a87300; }
    .star-option.selected .star-glyph { color: #fff; }
    .star-number { font-variant-numeric: tabular-nums; }
    .tech-list { display: grid; gap: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; }
    .primary, .ghost { min-height: 48px; }
    .ghost { border: 1px solid var(--line); border-radius: 14px; background: #fff; color: var(--brand); padding: 12px 16px; font: inherit; font-weight: 800; cursor: pointer; }
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
    @media print {
      .submit-row, .toolbar { display: none !important; }
      .feedback-public-wrap { padding: 0; }
      .feedback-hero-card, .feedback-public-card { box-shadow: none; break-inside: avoid; }
      .question-card, .tech-card { break-inside: avoid; }
    }
  `}</style>;
}
