"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Question = { key: string; label: string; helper: string };
type TechRow = { crew_id: string; crew_name: string; first_schedule: string; profile_photo_url: string };

type SurveyData = {
  token: string;
  form_kind: "project-manager" | "area-manager" | "crew-lead" | "labor-coordinator";
  title: string;
  target_label: string;
  show_name: string;
  client_name: string;
  venue: string;
  date_range: string;
  area_name: string | null;
  questions: Question[];
  tech_rows: TechRow[];
};

type TechRatingDraft = { rating?: number; request_again?: string; notes?: string };
type SubmitState = { kind: "idle" | "saving" | "success" | "error"; text: string };
type FeedbackDraft = {
  version: 1;
  token: string;
  saved_at: string;
  ratings: Record<string, number>;
  tech_ratings: Record<string, TechRatingDraft>;
  respondent_name: string;
  respondent_title: string;
  respondent_email: string;
  request_again: string;
  testimonial_permission: string;
  testimonial_text: string;
  went_well: string;
  follow_up: string;
  additional_comments: string;
};

const scores = [1, 2, 3, 4, 5] as const;

function showRequestAgainQuickQuestion(kind: SurveyData["form_kind"]) {
  return kind === "area-manager" || kind === "labor-coordinator";
}

function safeText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}


function isValidScore(value: unknown) {
  const score = Number(value);
  return Number.isInteger(score) && score >= 1 && score <= 5;
}

function feedbackDraftKey(token: string) {
  return `els-feedback-draft-${token}`;
}

function draftHasContent(draft: Omit<FeedbackDraft, "version" | "token" | "saved_at">) {
  return Boolean(
    Object.keys(draft.ratings).length
    || Object.values(draft.tech_ratings).some((row) => row.rating || safeText(row.request_again) || safeText(row.notes))
    || safeText(draft.respondent_name)
    || safeText(draft.respondent_title)
    || safeText(draft.respondent_email)
    || safeText(draft.request_again)
    || safeText(draft.testimonial_permission)
    || safeText(draft.testimonial_text)
    || safeText(draft.went_well)
    || safeText(draft.follow_up)
    || safeText(draft.additional_comments)
  );
}

function readFeedbackDraft(rawValue: string | null, survey: SurveyData): FeedbackDraft | null {
  if (!rawValue) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Partial<FeedbackDraft>;
  if (raw.token !== survey.token) return null;

  const questionKeys = new Set(survey.questions.map((question) => question.key));
  const crewIds = new Set(survey.tech_rows.map((tech) => tech.crew_id));
  const ratings: Record<string, number> = {};
  if (raw.ratings && typeof raw.ratings === "object") {
    Object.entries(raw.ratings).forEach(([key, value]) => {
      if (questionKeys.has(key) && isValidScore(value)) ratings[key] = Number(value);
    });
  }

  const techRatings: Record<string, TechRatingDraft> = {};
  if (raw.tech_ratings && typeof raw.tech_ratings === "object") {
    Object.entries(raw.tech_ratings).forEach(([crewId, value]) => {
      if (!crewIds.has(crewId) || !value || typeof value !== "object") return;
      const row = value as TechRatingDraft;
      const cleaned: TechRatingDraft = {
        request_again: safeText(row.request_again),
        notes: safeText(row.notes),
      };
      if (isValidScore(row.rating)) cleaned.rating = Number(row.rating);
      if (cleaned.rating || cleaned.request_again || cleaned.notes) techRatings[crewId] = cleaned;
    });
  }

  return {
    version: 1,
    token: survey.token,
    saved_at: safeText(raw.saved_at),
    ratings,
    tech_ratings: techRatings,
    respondent_name: safeText(raw.respondent_name),
    respondent_title: safeText(raw.respondent_title),
    respondent_email: safeText(raw.respondent_email),
    request_again: safeText(raw.request_again),
    testimonial_permission: safeText(raw.testimonial_permission),
    testimonial_text: safeText(raw.testimonial_text),
    went_well: safeText(raw.went_well),
    follow_up: safeText(raw.follow_up),
    additional_comments: safeText(raw.additional_comments),
  };
}

function normalizeSurvey(survey: SurveyData): SurveyData {
  const questions = Array.isArray(survey?.questions)
    ? survey.questions.filter((question) => safeText(question?.key) && safeText(question?.label))
    : [];

  const seenTechs = new Set<string>();
  const tech_rows = Array.isArray(survey?.tech_rows)
    ? survey.tech_rows.flatMap((tech) => {
        const crewId = safeText(tech?.crew_id);
        if (!crewId || seenTechs.has(crewId)) return [];
        seenTechs.add(crewId);
        return [{
          crew_id: crewId,
          crew_name: safeText(tech?.crew_name, "Assigned tech") || "Assigned tech",
          first_schedule: safeText(tech?.first_schedule, "Assigned to this show") || "Assigned to this show",
          profile_photo_url: safeText(tech?.profile_photo_url),
        }];
      })
    : [];

  return {
    ...survey,
    token: safeText(survey?.token),
    form_kind: survey?.form_kind === "area-manager" ? "area-manager" : survey?.form_kind === "crew-lead" ? "crew-lead" : survey?.form_kind === "labor-coordinator" ? "labor-coordinator" : "project-manager",
    title: safeText(survey?.title, "ELS Feedback Survey") || "ELS Feedback Survey",
    target_label: safeText(survey?.target_label, "Feedback Contact") || "Feedback Contact",
    show_name: safeText(survey?.show_name, "ELS Show") || "ELS Show",
    client_name: safeText(survey?.client_name, "Client") || "Client",
    venue: safeText(survey?.venue, "Venue") || "Venue",
    date_range: safeText(survey?.date_range),
    area_name: survey?.area_name ? safeText(survey.area_name) : null,
    questions,
    tech_rows,
  };
}

function techInitials(name: string) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "ELS";
}

function TechAvatar({ tech }: { tech: TechRow }) {
  const [failed, setFailed] = useState(false);
  const photoUrl = safeText(tech.profile_photo_url);
  return (
    <span className="tech-avatar" aria-label={`${tech.crew_name} profile photo`}>
      {photoUrl && !failed ? (
        <img
          src={photoUrl}
          alt={`${tech.crew_name} profile`}
          width={48}
          height={48}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : techInitials(tech.crew_name)}
    </span>
  );
}

function StarRating({
  name,
  value,
  onChange,
  label,
}: {
  name: string;
  value?: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="star-rating" role="radiogroup" aria-label={label}>
      {scores.map((score) => {
        const selected = value === score;
        return (
          <button
            key={`${name}-${score}`}
            type="button"
            className={`star-option${selected ? " selected" : ""}`}
            role="radio"
            aria-checked={selected}
            aria-label={`${score} out of 5 stars`}
            onClick={() => {
              try {
                onChange(score);
              } catch (error) {
                console.error("ELS feedback rating interaction failed", error);
              }
            }}
          >
            <span className="star-number">{score}</span>
            <span className="star-glyph" aria-hidden="true">★</span>
          </button>
        );
      })}
    </div>
  );
}

export default function FeedbackForm({ survey }: { survey: SurveyData }) {
  const safeSurvey = useMemo(() => normalizeSurvey(survey), [survey]);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [techRatings, setTechRatings] = useState<Record<string, TechRatingDraft>>({});
  const [respondentName, setRespondentName] = useState("");
  const [respondentTitle, setRespondentTitle] = useState("");
  const [respondentEmail, setRespondentEmail] = useState("");
  const [requestAgain, setRequestAgain] = useState("");
  const [testimonialPermission, setTestimonialPermission] = useState("");
  const [testimonialText, setTestimonialText] = useState("");
  const [wentWell, setWentWell] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [additionalComments, setAdditionalComments] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle", text: "" });
  const [draftReady, setDraftReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState("Draft autosaves on this browser and device.");
  const loadedDraftTokenRef = useRef("");

  const answeredCount = useMemo(() => Object.values(ratings).filter(Boolean).length, [ratings]);

  useEffect(() => {
    if (!safeSurvey.token || typeof window === "undefined") return;
    if (loadedDraftTokenRef.current === safeSurvey.token) return;

    setDraftReady(false);
    const key = feedbackDraftKey(safeSurvey.token);
    let draft: FeedbackDraft | null = null;
    try {
      draft = readFeedbackDraft(window.localStorage.getItem(key), safeSurvey);
    } catch {
      setDraftNotice("Draft storage is unavailable in this browser.");
    }
    if (draft) {
      setRatings(draft.ratings);
      setTechRatings(draft.tech_ratings);
      setRespondentName(draft.respondent_name);
      setRespondentTitle(draft.respondent_title);
      setRespondentEmail(draft.respondent_email);
      setRequestAgain(draft.request_again);
      setTestimonialPermission(draft.testimonial_permission);
      setTestimonialText(draft.testimonial_text);
      setWentWell(draft.went_well);
      setFollowUp(draft.follow_up);
      setAdditionalComments(draft.additional_comments);
      setDraftNotice(draft.saved_at ? `Draft restored from ${new Date(draft.saved_at).toLocaleString()}.` : "Saved draft restored.");
    } else {
      setDraftNotice("Draft autosaves on this browser and device.");
    }
    loadedDraftTokenRef.current = safeSurvey.token;
    setDraftReady(true);
  }, [safeSurvey]);

  useEffect(() => {
    if (!draftReady || !safeSurvey.token || typeof window === "undefined" || state.kind === "success") return;
    const id = window.setTimeout(() => {
      const draftContent = {
        ratings,
        tech_ratings: techRatings,
        respondent_name: respondentName,
        respondent_title: respondentTitle,
        respondent_email: respondentEmail,
        request_again: requestAgain,
        testimonial_permission: testimonialPermission,
        testimonial_text: testimonialText,
        went_well: wentWell,
        follow_up: followUp,
        additional_comments: additionalComments,
      };
      const key = feedbackDraftKey(safeSurvey.token);
      try {
        if (!draftHasContent(draftContent)) {
          window.localStorage.removeItem(key);
          setDraftNotice("Draft autosaves on this browser and device.");
          return;
        }
        const savedAt = new Date().toISOString();
        window.localStorage.setItem(key, JSON.stringify({
          version: 1,
          token: safeSurvey.token,
          saved_at: savedAt,
          ...draftContent,
        } satisfies FeedbackDraft));
        setDraftNotice(`Draft saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
      } catch {
        setDraftNotice("Draft could not be saved in this browser.");
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [additionalComments, draftReady, followUp, ratings, requestAgain, respondentEmail, respondentName, respondentTitle, safeSurvey.token, state.kind, techRatings, testimonialPermission, testimonialText, wentWell]);

  function setQuestionRating(questionKey: string, value: number) {
    if (!questionKey) return;
    setRatings((current) => ({ ...current, [questionKey]: value }));
  }

  function setTechRatingValue(crewId: string, patch: TechRatingDraft) {
    if (!crewId) return;
    setTechRatings((current) => ({
      ...current,
      [crewId]: {
        ...(current[crewId] ?? {}),
        ...patch,
      },
    }));
  }

  async function submitFeedback() {
    if (state.kind === "saving") return;
    if (!safeSurvey.token) {
      setState({ kind: "error", text: "This feedback link is missing its survey token." });
      return;
    }

    setState({ kind: "saving", text: "Submitting feedback..." });
    try {
      const techPayload = safeSurvey.tech_rows
        .map((row) => ({
          crew_id: row.crew_id,
          rating: techRatings[row.crew_id]?.rating ?? null,
          request_again: techRatings[row.crew_id]?.request_again || "",
          notes: techRatings[row.crew_id]?.notes || "",
        }))
        .filter((row) => row.crew_id);

      const res = await fetch(`/api/feedback/${encodeURIComponent(safeSurvey.token)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          respondent_name: respondentName,
          respondent_title: respondentTitle,
          respondent_email: respondentEmail,
          ratings,
          request_again: showRequestAgainQuickQuestion(safeSurvey.form_kind) ? requestAgain : "",
          testimonial_permission: testimonialPermission,
          testimonial_text: testimonialText,
          went_well: wentWell,
          follow_up: followUp,
          additional_comments: additionalComments,
          tech_ratings: techPayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not submit feedback.");
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(feedbackDraftKey(safeSurvey.token));
      }
      setDraftNotice("");
      setState({ kind: "success", text: "Thank you for your feedback." });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      console.error("ELS feedback survey submit failed", error);
      setState({ kind: "error", text: error instanceof Error ? error.message : "Could not submit feedback." });
    }
  }


  function printAnsweredSurveyPdf() {
    if (typeof window !== "undefined") window.print();
  }

  if (state.kind === "success") {
    return (
      <main className="feedback-public-wrap">
        <section className="feedback-public-card success-card" aria-live="polite">
          <div className="checkmark" aria-hidden="true">✓</div>
          <h1>Thank you for your feedback</h1>
          <p>Your response was submitted to Emanuel Labor Services.</p>
          <p className="muted">You can close this page now.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="feedback-public-wrap">
      <section className="feedback-hero-card">
        <div className="feedback-kicker">Emanuel Labor Services</div>
        <h1>Quick Feedback Survey</h1>
        <p>Thank you for taking 2–3 minutes. Most answers are simple 5-star ratings, and anything that does not apply can be left blank.</p>
        <div className="feedback-meta-grid">
          <div><span>Show</span><strong>{safeSurvey.show_name}</strong></div>
          <div><span>Client</span><strong>{safeSurvey.client_name}</strong></div>
          <div><span>Venue</span><strong>{safeSurvey.venue}</strong></div>
          {safeSurvey.date_range ? <div><span>Dates</span><strong>{safeSurvey.date_range}</strong></div> : null}
          <div><span>Survey</span><strong>{safeSurvey.target_label}</strong></div>
          {safeSurvey.area_name ? <div><span>Area / booth</span><strong>{safeSurvey.area_name}</strong></div> : null}
        </div>
      </section>

      <form className="feedback-public-card" onSubmit={(event) => event.preventDefault()} noValidate>
        <div className="survey-heading-row">
          <div>
            <p className="feedback-kicker">{safeSurvey.form_kind === "area-manager" ? "Area manager survey" : safeSurvey.form_kind === "crew-lead" ? "Crew lead survey" : safeSurvey.form_kind === "labor-coordinator" ? "Client labor coordinator survey" : "Project manager survey"}</p>
            <h2>{safeSurvey.title}</h2>
          </div>
          <span className="time-pill">2–3 min</span>
        </div>
        <p className="muted small" aria-live="polite">{draftNotice}</p>
        <p className="submit-safety-note"><strong>Mobile note:</strong> Using Next on your keyboard only moves through the survey. The survey is sent only when you tap the yellow Submit feedback button at the bottom.</p>

        <div className="feedback-grid two">
          <label>Your name<input value={respondentName} onChange={(event) => setRespondentName(event.currentTarget.value)} placeholder="Name" autoComplete="name" /></label>
          <label>Title / role<input value={respondentTitle} onChange={(event) => setRespondentTitle(event.currentTarget.value)} placeholder="Project Manager, Booth Manager, etc." autoComplete="organization-title" /></label>
        </div>
        <label>Email, if you want us to follow up<input value={respondentEmail} onChange={(event) => setRespondentEmail(event.currentTarget.value)} placeholder="Optional" type="email" autoComplete="email" inputMode="email" /></label>

        <h3>Quick 5-star ratings</h3>
        <p className="muted">5★ = excellent. 1★ = problem. Completed: {answeredCount}/{safeSurvey.questions.length}</p>
        <div className="question-grid">
          {safeSurvey.questions.map((question) => (
            <fieldset className="question-card" key={question.key}>
              <legend>{question.label}</legend>
              <p>{question.helper}</p>
              <StarRating
                name={`question-${question.key}`}
                label={question.label}
                value={ratings[question.key]}
                onChange={(value) => setQuestionRating(question.key, value)}
              />
            </fieldset>
          ))}
        </div>

        <h3>Quick questions</h3>
        <div className="feedback-grid two">
          {showRequestAgainQuickQuestion(safeSurvey.form_kind) ? (
            <label>Would you request Emanuel Labor Services again?
              <select value={requestAgain} onChange={(event) => setRequestAgain(event.currentTarget.value)}>
                <option value="">Choose one</option>
                <option>Yes</option>
                <option>No</option>
                <option>Not sure</option>
              </select>
            </label>
          ) : null}
          <label>May we use your comments for a testimonial?
            <select value={testimonialPermission} onChange={(event) => setTestimonialPermission(event.currentTarget.value)}>
              <option value="">Choose one</option>
              <option>Yes</option>
              <option>No</option>
              <option>Ask first</option>
            </select>
          </label>
        </div>
        <label>{safeSurvey.form_kind === "area-manager" ? "What was your overall experience with Emanuel Labor Services?" : safeSurvey.form_kind === "crew-lead" ? "How was the show? What can be improved?" : safeSurvey.form_kind === "labor-coordinator" ? "How was the booking / labor coordination experience?" : "What went well?"}
          <textarea rows={4} value={wentWell} onChange={(event) => setWentWell(event.currentTarget.value)} placeholder="Positive feedback, testimonial wording, or quick notes" />
        </label>
        <label>Testimonial comment, if different from above
          <textarea rows={3} value={testimonialText} onChange={(event) => setTestimonialText(event.currentTarget.value)} placeholder="Optional" />
        </label>
        <label>Anything we should fix or follow up on?
          <textarea rows={4} value={followUp} onChange={(event) => setFollowUp(event.currentTarget.value)} placeholder="Problems, concerns, or details we should correct" />
        </label>

        <h3>{safeSurvey.form_kind === "area-manager" ? "Tech ratings for this booth / area" : safeSurvey.form_kind === "crew-lead" ? "Crew lead tech ratings" : safeSurvey.form_kind === "labor-coordinator" ? "Crew feedback from labor coordinator" : "Tech feedback"}</h3>
        <p className="muted">{safeSurvey.form_kind === "crew-lead" ? "Crew Lead and Working Crew Lead assignments are not listed here. Rate the crew members you supervised or can speak to." : "Rate only the techs you worked with or can speak to. Notes are optional."}</p>
        <div className="tech-list">
          {safeSurvey.tech_rows.length ? safeSurvey.tech_rows.map((tech) => (
            <div className="tech-card" key={tech.crew_id}>
              <div className="tech-heading">
                <TechAvatar tech={tech} />
                <div className="tech-heading-copy">
                  <strong>{tech.crew_name}</strong>
                  <p>{tech.first_schedule}</p>
                </div>
              </div>
              <StarRating
                name={`tech-${tech.crew_id}`}
                label={`Rate ${tech.crew_name}`}
                value={techRatings[tech.crew_id]?.rating}
                onChange={(value) => setTechRatingValue(tech.crew_id, { rating: value })}
              />
              <div className="feedback-grid two">
                <label>Request this tech again?
                  <select
                    value={techRatings[tech.crew_id]?.request_again || ""}
                    onChange={(event) => setTechRatingValue(tech.crew_id, { request_again: event.currentTarget.value })}
                  >
                    <option value="">Choose one</option>
                    <option>Yes</option>
                    <option>No</option>
                    <option>Not sure</option>
                  </select>
                </label>
                <label>Notes on this tech
                  <input
                    value={techRatings[tech.crew_id]?.notes || ""}
                    onChange={(event) => setTechRatingValue(tech.crew_id, { notes: event.currentTarget.value })}
                    placeholder="Optional notes about performance or follow-up"
                  />
                </label>
              </div>
            </div>
          )) : <p className="muted">No assigned techs are listed for this survey yet.</p>}
        </div>

        <label>Additional comments<textarea rows={4} value={additionalComments} onChange={(event) => setAdditionalComments(event.currentTarget.value)} placeholder="Optional" /></label>
        {state.kind === "error" ? <p className="error" role="alert">{state.text}</p> : null}
        {state.kind === "saving" ? <p className="muted" aria-live="polite">{state.text}</p> : null}
        <div className="submit-row">
          <div className="toolbar">
            <button type="button" className="primary" disabled={state.kind === "saving"} aria-busy={state.kind === "saving"} onClick={() => void submitFeedback()}>{state.kind === "saving" ? "Submitting..." : "Submit feedback"}</button>
            <button type="button" className="ghost" onClick={printAnsweredSurveyPdf}>Print / save PDF with answers</button>
          </div>
          <span className="muted">Your response goes directly to Emanuel Labor Services.</span>
        </div>
      </form>
    </main>
  );
}
