"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  role: string;
  userName: string;
};

type TutorialStep = {
  title: string;
  body: string;
};

function currentPath() {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

function stepsForPath(pathname: string): TutorialStep[] {
  if (pathname.startsWith("/crew")) {
    return [
      { title: "Crew page purpose", body: "Use this page to add qualified crew contacts and keep their phone, email, city, skills, and notes easy to find later." },
      { title: "City pools", body: "Choose the city or market where the crew member can work, such as Houston, TX. Use additional city pools only when the same person can also work nearby markets or travel." },
      { title: "Groups", body: "Groups help organize a city pool into simple sections such as Tier 1, Breakouts, LED, Audio, Video, or Crew Leads. Pick an existing group when possible so the list stays clean." },
      { title: "Adding one contact", body: "Use Add contact for one person at a time. Fill in name, phone, email, city pool, group, tier, positions, rate notes, and any useful availability or skill notes." },
      { title: "CSV upload", body: "Use Paste form / upload text when adding several contacts. For best results, use headers in this order: Contact Name, Description, Location, Other City, OB, Tier, Positions, Rate, Email, Phone, Notes." },
      { title: "Preview before saving", body: "Always preview the upload first. Check that names, phone numbers, city, group, skills, and rates landed in the correct fields before saving." },
      { title: "Messaging crew", body: "Select the crew you want, choose Message selected, write the message, and queue it. The app creates one message per person, not a group text." },
    ];
  }
  if (pathname.startsWith("/events") || pathname.startsWith("/coordinator")) {
    return [
      { title: "Assigned shows", body: "Use this page to see shows assigned to you, the show dates, location, and which crew spots still need to be filled." },
      { title: "Review the show details", body: "Open the show and review the venue, dates, start times, report-to contact, attire, and each labor section before adding crew." },
      { title: "Fill open crew spots", body: "For each labor section, add qualified crew only where there are open spots. If a section is full, choose a different open section or ask Storm before changing the plan." },
      { title: "Choose the right crew", body: "Match each person to the requested role, city, skill level, and availability. Add clear notes if someone is a backup, has a schedule limit, or needs special instructions." },
      { title: "Keep confirmations clean", body: "Mark crew confirmations accurately and update any changes quickly. If someone cancels, is late, or needs to be replaced, update the show and notify Storm." },
      { title: "Before the show", body: "Review the final assigned crew list, make sure every person has the correct call time and location, and keep backup names ready when possible." },
    ];
  }
  return [
    { title: "Coordinator start", body: "Start with your assigned shows, then use Crew to add or review contacts needed to fill those shows." },
    { title: "Keep information clean", body: "Use clear names, current phone numbers, accurate city pools, and short professional notes so the team can trust the records." },
    { title: "Ask when unsure", body: "If a show detail, crew role, rate note, or schedule change is unclear, pause and ask Storm before saving the wrong information." },
  ];
}

export default function OnboardingTutorial({ role, userName }: Props) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [pathname, setPathname] = useState("/");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (role !== "coordinator") return;
    const path = currentPath();
    setPathname(path);
    const key = `els-tutorial-dismissed:${path}`;
    const stored = window.localStorage.getItem(key) === "1";
    setDismissed(stored);
    setOpen(!stored);
  }, [role]);

  const steps = useMemo(() => stepsForPath(pathname), [pathname]);
  const step = steps[Math.min(stepIndex, steps.length - 1)] || steps[0];

  function closeForNow() {
    setOpen(false);
  }

  function dismiss() {
    window.localStorage.setItem(`els-tutorial-dismissed:${pathname}`, "1");
    setDismissed(true);
    setOpen(false);
  }

  function restart() {
    window.localStorage.removeItem(`els-tutorial-dismissed:${pathname}`);
    setDismissed(false);
    setStepIndex(0);
    setOpen(true);
  }

  if (role !== "coordinator") return null;

  return (
    <div className="tutorial-widget" aria-live="polite">
      {!open ? (
        <button type="button" className="tutorial-icon" onClick={restart} aria-label="Open page tutorial" title="Open page tutorial">?</button>
      ) : (
        <div className="tutorial-card card compact">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="eyebrow">ELS APP TUTORIAL</div>
              <strong>{step.title}</strong>
              <p className="muted small" style={{ margin: "6px 0 0" }}>{step.body}</p>
            </div>
            <div className="toolbar tight"><span className="badge">{stepIndex + 1}/{steps.length}</span><button type="button" className="icon-button" onClick={closeForNow} aria-label="Close tutorial">×</button></div>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>Signed in as {userName || role}. This guide changes by page.</div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="ghost" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={stepIndex <= 0}>Back</button>
            <button type="button" className="primary" onClick={() => setStepIndex((value) => value >= steps.length - 1 ? 0 : value + 1)}>{stepIndex >= steps.length - 1 ? "Restart" : "Next"}</button>
            <button type="button" className="ghost" onClick={closeForNow}>Close</button>
            <button type="button" className="ghost" onClick={dismiss}>Don’t show on this page again</button>
          </div>
        </div>
      )}
    </div>
  );
}
