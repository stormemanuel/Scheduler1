"use client";

import { useMemo, useState, type FormEvent } from "react";

type Question = { key: string; label: string; helper: string };
type TechRow = { crew_id: string; crew_name: string; first_schedule: string };

type SurveyData = {
  token: string;
  form_kind: "project-manager" | "area-manager";
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

const scores = [1, 2, 3, 4, 5] as const;

function safeText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
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
        }];
      })
    : [];

  return {
    ...survey,
    token: safeText(survey?.token),
    form_kind: survey?.form_kind === "area-manager" ? "area-manager" : "project-manager",
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

  const answeredCount = useMemo(() => Object.values(ratings).filter(Boolean).length, [ratings]);

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

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
          request_again: requestAgain,
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
      setState({ kind: "success", text: "Thank you for your feedback." });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      console.error("ELS feedback survey submit failed", error);
      setState({ kind: "error", text: error instanceof Error ? error.message : "Could not submit feedback." });
    }
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

      <form className="feedback-public-card" onSubmit={submitFeedback} noValidate>
        <div className="survey-heading-row">
          <div>
            <p className="feedback-kicker">{safeSurvey.form_kind === "area-manager" ? "Area manager survey" : "Project manager survey"}</p>
            <h2>{safeSurvey.title}</h2>
          </div>
          <span className="time-pill">2–3 min</span>
        </div>

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
          <label>Would you request Emanuel Labor Services again?
            <select value={requestAgain} onChange={(event) => setRequestAgain(event.currentTarget.value)}>
              <option value="">Choose one</option>
              <option>Yes</option>
              <option>No</option>
              <option>Not sure</option>
            </select>
          </label>
          <label>May we use your comments for a testimonial?
            <select value={testimonialPermission} onChange={(event) => setTestimonialPermission(event.currentTarget.value)}>
              <option value="">Choose one</option>
              <option>Yes</option>
              <option>No</option>
              <option>Ask first</option>
            </select>
          </label>
        </div>
        <label>{safeSurvey.form_kind === "area-manager" ? "What was your overall experience with Emanuel Labor Services?" : "What went well?"}
          <textarea rows={4} value={wentWell} onChange={(event) => setWentWell(event.currentTarget.value)} placeholder="Positive feedback, testimonial wording, or quick notes" />
        </label>
        <label>Testimonial comment, if different from above
          <textarea rows={3} value={testimonialText} onChange={(event) => setTestimonialText(event.currentTarget.value)} placeholder="Optional" />
        </label>
        <label>Anything we should fix or follow up on?
          <textarea rows={4} value={followUp} onChange={(event) => setFollowUp(event.currentTarget.value)} placeholder="Problems, concerns, or details we should correct" />
        </label>

        <h3>{safeSurvey.form_kind === "area-manager" ? "Tech ratings for this booth / area" : "Tech feedback"}</h3>
        <p className="muted">Rate only the techs you worked with or can speak to. Notes are optional.</p>
        <div className="tech-list">
          {safeSurvey.tech_rows.length ? safeSurvey.tech_rows.map((tech) => (
            <div className="tech-card" key={tech.crew_id}>
              <div>
                <strong>{tech.crew_name}</strong>
                <p>{tech.first_schedule}</p>
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
          <button type="submit" className="primary" disabled={state.kind === "saving"} aria-busy={state.kind === "saving"}>{state.kind === "saving" ? "Submitting..." : "Submit feedback"}</button>
          <span className="muted">Your response goes directly to Emanuel Labor Services.</span>
        </div>
      </form>
    </main>
  );
}
