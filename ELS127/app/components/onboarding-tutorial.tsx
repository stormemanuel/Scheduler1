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

function stepsForPath(pathname: string, role: string): TutorialStep[] {
  const coordinator = role === "coordinator";
  if (pathname.startsWith("/crew")) {
    return [
      { title: "Crew pools", body: coordinator ? "Contacts you add are saved under your own Coordinator pool so admin can review them separately from Storm's main crew." : "Use city pools and groups to organize crew. Coordinator-created contacts appear in their own Coordinator pool." },
      { title: "Add or edit crew", body: "Use Add Crew for new contacts, add roles/rates, phone, email, notes, and city pools. Phone numbers are required for text queues." },
      { title: "Bulk message", body: "Select multiple crew, open Message selected, write one message, and queue it. Each person receives an individual text through the iPhone Shortcut queue." },
      { title: "Protected admin records", body: "Coordinator users cannot permanently delete admin crew records. This protects the company list during separation or access changes." },
    ];
  }
  if (pathname.startsWith("/events")) {
    return [
      { title: "Events workflow", body: "Build the show first, add labor days, add sub-calls, then assign crew. Keep dates/times clean because payroll and text messages use this data." },
      { title: "Confirmation Text Center", body: "Queue availability, schedule, reminders, custom texts, and invoice reminders from the event. Queued texts are not sent until an iPhone Shortcut pulls them." },
      { title: "Shortcut ownership", body: "Texts send from whichever iPhone runs the Shortcut. If Storm's phone runs it, texts send from Storm. If the coordinator's phone runs it, texts send from that coordinator." },
      { title: "Feedback links", body: "Feedback links are public survey pages only. They should not show the internal app navigation or search bar." },
    ];
  }
  if (pathname.startsWith("/payroll")) {
    return [
      { title: "Payroll by event", body: "Mark each contractor paid/unpaid, add payout overrides only when needed, and export payroll or 1099 prep files." },
      { title: "P&L expenses", body: "Open the expense dropdown only when you need itemized show expenses. Add category, amount, receipt status, and tax notes." },
      { title: "Reserves", body: "Use reserve checkoffs to track taxes and Consecrated Hands after profit is calculated." },
    ];
  }
  if (pathname.startsWith("/users")) {
    return [
      { title: "User roles", body: "Owner/Admin has full access. Coordinator should usually get Overview, Events, and Crew only." },
      { title: "Restrictions", body: "Use event and crew restrictions to limit a coordinator to their assigned events, their own crew, or specific city pools." },
      { title: "Coordinator phone setup", body: "A coordinator needs the Shortcut installed on their own iPhone if texts should come from their phone instead of Storm's." },
    ];
  }
  return [
    { title: "Overview", body: "Start here to see current and upcoming shows. Use Events for scheduling, Crew for contacts, and Payroll for P&L." },
    { title: "Coordinator basics", body: "A new coordinator should learn Events first, then Crew, then Confirmation Text Center." },
    { title: "Text messages", body: "The app queues texts. The iPhone Shortcut sends them from the phone that runs the Shortcut." },
  ];
}

export default function OnboardingTutorial({ role, userName }: Props) {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [pathname, setPathname] = useState("/");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const path = currentPath();
    setPathname(path);
    const key = `els-tutorial-dismissed:${role}`;
    const stored = window.localStorage.getItem(key) === "1";
    setDismissed(stored);
    setOpen(!stored && role === "coordinator");
  }, [role]);

  const steps = useMemo(() => stepsForPath(pathname, role), [pathname, role]);
  const step = steps[Math.min(stepIndex, steps.length - 1)] || steps[0];

  function closeForNow() {
    setOpen(false);
  }

  function dismiss() {
    window.localStorage.setItem(`els-tutorial-dismissed:${role}`, "1");
    setDismissed(true);
    setOpen(false);
  }

  function restart() {
    window.localStorage.removeItem(`els-tutorial-dismissed:${role}`);
    setDismissed(false);
    setStepIndex(0);
    setOpen(true);
  }

  return (
    <div className="tutorial-widget" aria-live="polite">
      {!open ? (
        <button type="button" className="tutorial-button" onClick={restart}>{dismissed ? "Tutorial" : "Open tutorial"}</button>
      ) : (
        <div className="tutorial-card card compact">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="eyebrow">ELS APP TUTORIAL</div>
              <strong>{step.title}</strong>
              <p className="muted small" style={{ margin: "6px 0 0" }}>{step.body}</p>
            </div>
            <span className="badge">{stepIndex + 1}/{steps.length}</span>
          </div>
          <div className="small muted" style={{ marginTop: 8 }}>Signed in as {userName || role}. This guide changes by page.</div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="ghost" onClick={() => setStepIndex((value) => Math.max(0, value - 1))} disabled={stepIndex <= 0}>Back</button>
            <button type="button" className="primary" onClick={() => setStepIndex((value) => value >= steps.length - 1 ? 0 : value + 1)}>{stepIndex >= steps.length - 1 ? "Restart" : "Next"}</button>
            <button type="button" className="ghost" onClick={closeForNow}>Close</button>
            <button type="button" className="ghost" onClick={dismiss}>Don’t show again</button>
          </div>
        </div>
      )}
    </div>
  );
}
