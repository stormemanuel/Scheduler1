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

type SubmitState = { kind: "idle" | "saving" | "success" | "error"; text: string };

const scores = [5, 4, 3, 2, 1];

export default function FeedbackForm({ survey }: { survey: SurveyData }) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [techRatings, setTechRatings] = useState<Record<string, { rating?: number; request_again?: string; notes?: string }>>({});
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

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ kind: "saving", text: "Submitting feedback..." });
    try {
      const res = await fetch(`/api/feedback/${survey.token}/submit`, {
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
          tech_ratings: survey.tech_rows.map((row) => ({
            crew_id: row.crew_id,
            rating: techRatings[row.crew_id]?.rating || null,
            request_again: techRatings[row.crew_id]?.request_again || "",
            notes: techRatings[row.crew_id]?.notes || "",
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not submit feedback.");
      setState({ kind: "success", text: "Thank you for your feedback." });
    } catch (error) {
      setState({ kind: "error", text: error instanceof Error ? error.message : "Could not submit feedback." });
    }
  }

  if (state.kind === "success") {
    return (
      <main className="feedback-public-wrap">
        <section className="feedback-public-card success-card">
          <div className="checkmark">✓</div>
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
          <div><span>Show</span><strong>{survey.show_name}</strong></div>
          <div><span>Client</span><strong>{survey.client_name}</strong></div>
          <div><span>Venue</span><strong>{survey.venue}</strong></div>
          <div><span>Dates</span><strong>{survey.date_range}</strong></div>
          <div><span>Survey</span><strong>{survey.target_label}</strong></div>
          {survey.area_name ? <div><span>Area / booth</span><strong>{survey.area_name}</strong></div> : null}
        </div>
      </section>

      <form className="feedback-public-card" onSubmit={submitFeedback}>
        <div className="survey-heading-row">
          <div>
            <p className="feedback-kicker">{survey.form_kind === "area-manager" ? "Area manager survey" : "Project manager survey"}</p>
            <h2>{survey.title}</h2>
          </div>
          <span className="time-pill">2–3 min</span>
        </div>

        <div className="feedback-grid two">
          <label>Your name<input value={respondentName} onChange={(event) => setRespondentName(event.currentTarget.value)} placeholder="Name" /></label>
          <label>Title / role<input value={respondentTitle} onChange={(event) => setRespondentTitle(event.currentTarget.value)} placeholder="Project Manager, Booth Manager, etc." /></label>
        </div>
        <label>Email, if you want us to follow up<input value={respondentEmail} onChange={(event) => setRespondentEmail(event.currentTarget.value)} placeholder="Optional" type="email" /></label>

        <h3>Quick 5-star ratings</h3>
        <p className="muted">5★ = excellent. 1★ = problem. Completed: {answeredCount}/{survey.questions.length}</p>
        <div className="question-grid">
          {survey.questions.map((question) => (
            <fieldset className="question-card" key={question.key}>
              <legend>{question.label}</legend>
              <p>{question.helper}</p>
              <div className="rating-row">
                {scores.map((score) => (
                  <label key={score} className={ratings[question.key] === score ? "selected" : ""}>
                    <input
                      type="radio"
                      name={question.key}
                      value={score}
                      checked={ratings[question.key] === score}
                      onChange={() => setRatings((current) => ({ ...current, [question.key]: score }))}
                    />
                    <span>{score}★</span>
                  </label>
                ))}
              </div>
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
        <label>{survey.form_kind === "area-manager" ? "What was your overall experience with Emanuel Labor Services?" : "What went well?"}
          <textarea rows={4} value={wentWell} onChange={(event) => setWentWell(event.currentTarget.value)} placeholder="Positive feedback, testimonial wording, or quick notes" />
        </label>
        <label>Testimonial comment, if different from above
          <textarea rows={3} value={testimonialText} onChange={(event) => setTestimonialText(event.currentTarget.value)} placeholder="Optional" />
        </label>
        <label>Anything we should fix or follow up on?
          <textarea rows={4} value={followUp} onChange={(event) => setFollowUp(event.currentTarget.value)} placeholder="Problems, concerns, or details we should correct" />
        </label>

        <h3>{survey.form_kind === "area-manager" ? "Tech ratings for this booth / area" : "Tech feedback"}</h3>
        <p className="muted">Rate only the techs you worked with or can speak to. Notes are optional.</p>
        <div className="tech-list">
          {survey.tech_rows.length ? survey.tech_rows.map((tech) => (
            <div className="tech-card" key={tech.crew_id}>
              <div>
                <strong>{tech.crew_name}</strong>
                <p>{tech.first_schedule}</p>
              </div>
              <div className="rating-row">
                {scores.map((score) => (
                  <label key={score} className={techRatings[tech.crew_id]?.rating === score ? "selected" : ""}>
                    <input
                      type="radio"
                      name={`tech-${tech.crew_id}`}
                      value={score}
                      checked={techRatings[tech.crew_id]?.rating === score}
                      onChange={() => setTechRatings((current) => ({ ...current, [tech.crew_id]: { ...current[tech.crew_id], rating: score } }))}
                    />
                    <span>{score}★</span>
                  </label>
                ))}
              </div>
              <div className="feedback-grid two">
                <label>Request this tech again?
                  <select
                    value={techRatings[tech.crew_id]?.request_again || ""}
                    onChange={(event) => setTechRatings((current) => ({ ...current, [tech.crew_id]: { ...current[tech.crew_id], request_again: event.currentTarget.value } }))}
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
                    onChange={(event) => setTechRatings((current) => ({ ...current, [tech.crew_id]: { ...current[tech.crew_id], notes: event.currentTarget.value } }))}
                    placeholder="Optional notes about performance or follow-up"
                  />
                </label>
              </div>
            </div>
          )) : <p className="muted">No assigned techs are listed for this survey yet.</p>}
        </div>

        <label>Additional comments<textarea rows={4} value={additionalComments} onChange={(event) => setAdditionalComments(event.currentTarget.value)} placeholder="Optional" /></label>
        {state.kind === "error" ? <p className="error">{state.text}</p> : null}
        {state.kind === "saving" ? <p className="muted">{state.text}</p> : null}
        <div className="submit-row">
          <button type="submit" className="primary" disabled={state.kind === "saving"}>{state.kind === "saving" ? "Submitting..." : "Submit feedback"}</button>
          <span className="muted">Your response goes directly to Emanuel Labor Services.</span>
        </div>
      </form>
    </main>
  );
}
