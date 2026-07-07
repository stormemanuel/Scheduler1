"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  role: string;
  userName: string;
};

type OnboardingNavLinkProps = {
  href: string;
  label: string;
};

function setInstalledAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (contents?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (count > 0 && typeof nav.setAppBadge === "function") {
    void nav.setAppBadge(count).catch(() => undefined);
    return;
  }
  if (count <= 0 && typeof nav.clearAppBadge === "function") {
    void nav.clearAppBadge().catch(() => undefined);
  }
}

function maybeShowLocalAssignmentNotification(count: number) {
  if (typeof window === "undefined" || count <= 0 || !("Notification" in window) || Notification.permission !== "granted") return;
  const previous = Number(window.localStorage.getItem("els-coordinator-unread-count") || "0");
  window.localStorage.setItem("els-coordinator-unread-count", String(count));
  if (count <= previous) return;
  const notification = new Notification("ELS Scheduler", {
    body: `${count} coordinator message${count === 1 ? "" : "s"} need attention.`,
    tag: "els-coordinator-chat",
  });
  notification.onclick = () => {
    window.focus();
    window.location.href = "/coordinator#assignment-chat";
  };
}

export function OnboardingReviewNavLink({ href, label }: OnboardingNavLinkProps) {
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadReviewCount() {
      try {
        const response = await fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_onboarding_review_queue" }),
        });
        const result = (await response.json()) as { ok?: boolean; rows?: Array<{ status?: string }> };
        if (!cancelled && response.ok && result.ok) {
          setReviewCount((result.rows || []).filter((row) => row.status === "submitted").length);
        }
      } catch {
        // Keep navigation usable even when the review count cannot be loaded.
      }
    }

    function handleCountEvent(event: Event) {
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) setReviewCount(nextCount);
    }

    void loadReviewCount();
    const intervalId = window.setInterval(() => void loadReviewCount(), 60000);
    window.addEventListener("focus", loadReviewCount);
    window.addEventListener("els:onboarding-review-count", handleCountEvent);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadReviewCount);
      window.removeEventListener("els:onboarding-review-count", handleCountEvent);
    };
  }, []);

  return (
    <a href={href} className="nav-link-with-badge">
      <span>{label}</span>
      {reviewCount > 0 ? (
        <span className="nav-notification-badge" aria-label={`${reviewCount} submitted onboarding packet${reviewCount === 1 ? "" : "s"} awaiting review`}>
          {reviewCount > 99 ? "99+" : reviewCount}
        </span>
      ) : null}
    </a>
  );
}

export function CoordinatorNotificationNavLink({ href, label }: OnboardingNavLinkProps) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadUnreadCount() {
      try {
        const response = await fetch("/api/user-access?action=coordinator_notifications", { cache: "no-store" });
        const result = (await response.json()) as { ok?: boolean; unread_count?: number };
        if (!cancelled && response.ok && result.ok) {
          setUnreadCount(Math.max(0, Number(result.unread_count || 0)));
        }
      } catch {
        // Keep coordinator navigation usable when the notification count is unavailable.
      }
    }

    function handleCountEvent(event: Event) {
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) setUnreadCount(nextCount);
    }

    void loadUnreadCount();
    const intervalId = window.setInterval(() => void loadUnreadCount(), 60000);
    window.addEventListener("focus", loadUnreadCount);
    window.addEventListener("els:coordinator-notification-count", handleCountEvent);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadUnreadCount);
      window.removeEventListener("els:coordinator-notification-count", handleCountEvent);
    };
  }, []);

  return (
    <a href={href} className="nav-link-with-badge">
      <span>{label}</span>
      {unreadCount > 0 ? (
        <span className="nav-notification-badge" aria-label={`${unreadCount} new coordinator assignment${unreadCount === 1 ? "" : "s"} not viewed yet`}>
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </a>
  );
}

export function CoordinatorNotificationPageMarker({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    async function markViewed() {
      try {
        const response = await fetch("/api/user-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark_coordinator_notifications_viewed" }),
        });
        const result = (await response.json()) as { ok?: boolean };
        if (!cancelled && response.ok && result.ok) {
          window.dispatchEvent(new CustomEvent("els:coordinator-notification-count", { detail: 0 }));
        }
      } catch {
        // Viewing the page should not be blocked by notification bookkeeping.
      }
    }
    void markViewed();
    return () => { cancelled = true; };
  }, [active]);

  return null;
}

export function AppBadgeSync({ role }: { role: string }) {
  useEffect(() => {
    let cancelled = false;

    async function loadCount() {
      try {
        if (role === "owner" || role === "admin") {
          const response = await fetch("/api/onboarding", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "list_onboarding_review_queue" }),
          });
          const result = (await response.json()) as { ok?: boolean; rows?: Array<{ status?: string }> };
          if (!cancelled && response.ok && result.ok) {
            setInstalledAppBadge((result.rows || []).filter((row) => row.status === "submitted").length);
          }
          return;
        }
        if (role === "coordinator") {
          const response = await fetch("/api/user-access?action=coordinator_notifications", { cache: "no-store" });
          const result = (await response.json()) as { ok?: boolean; unread_count?: number };
          if (!cancelled && response.ok && result.ok) {
            const count = Math.max(0, Number(result.unread_count || 0));
            setInstalledAppBadge(count);
            maybeShowLocalAssignmentNotification(count);
          }
        }
      } catch {
        // The badge is a helpful extra, not required for the app to work.
      }
    }

    function handleOnboardingCount(event: Event) {
      if (role !== "owner" && role !== "admin") return;
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) setInstalledAppBadge(nextCount);
    }

    function handleCoordinatorCount(event: Event) {
      if (role !== "coordinator") return;
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) {
        setInstalledAppBadge(nextCount);
        maybeShowLocalAssignmentNotification(nextCount);
      }
    }

    void loadCount();
    const intervalId = window.setInterval(() => void loadCount(), 60000);
    window.addEventListener("focus", loadCount);
    window.addEventListener("els:onboarding-review-count", handleOnboardingCount);
    window.addEventListener("els:coordinator-notification-count", handleCoordinatorCount);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadCount);
      window.removeEventListener("els:onboarding-review-count", handleOnboardingCount);
      window.removeEventListener("els:coordinator-notification-count", handleCoordinatorCount);
    };
  }, [role]);

  return null;
}

type CoordinatorNotificationRow = {
  id: string;
  coordinator_name?: string;
  title?: string;
  body?: string;
  created_at?: string;
  viewed_at?: string | null;
  reply_body?: string | null;
  replied_at?: string | null;
  reply_reviewed_at?: string | null;
  messages?: CoordinatorThreadMessage[];
};

type CoordinatorThreadMessage = {
  id: string;
  sender_role?: string | null;
  body?: string | null;
  created_at?: string | null;
  read_at?: string | null;
};

function formatNotificationTime(value: string | null | undefined) {
  const clean = String(value || "").trim();
  if (!clean) return "—";
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? clean : parsed.toLocaleString();
}

export function CoordinatorMessagesPanel({ role }: { role: string }) {
  const [rows, setRows] = useState<CoordinatorNotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState("unsupported");
  const isAdmin = role === "owner" || role === "admin";
  const isCoordinator = role === "coordinator";

  async function loadRows() {
    if (!isAdmin && !isCoordinator) return;
    setLoading(true);
    try {
      const response = await fetch("/api/user-access?action=coordinator_notifications&include_viewed=1", { cache: "no-store" });
      const result = (await response.json()) as { ok?: boolean; rows?: CoordinatorNotificationRow[]; setup_missing?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to load coordinator messages.");
      if (result.setup_missing) {
        setMessage("Run the coordinator notification SQL to enable assignment messages.");
        setRows([]);
      } else {
        setRows(result.rows || []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load coordinator messages.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setBrowserNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
    void loadRows();
    const intervalId = window.setInterval(() => void loadRows(), 60000);
    window.addEventListener("focus", loadRows);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", loadRows);
    };
  }, [role]);

  async function requestBrowserNotifications() {
    if (!("Notification" in window)) {
      setBrowserNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setBrowserNotificationPermission(permission);
    setMessage(permission === "granted" ? "Phone/browser notifications are allowed while the app is open or installed." : "Notifications were not allowed for this browser.");
  }

  async function sendThreadMessage(row: CoordinatorNotificationRow) {
    const nextMessage = String(messageDrafts[row.id] || "").trim();
    if (!nextMessage) {
      setMessage("Type a message first.");
      return;
    }
    setBusyId(row.id);
    setMessage("");
    try {
      const response = await fetch("/api/user-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_coordinator_notification_message", notification_id: row.id, message_body: nextMessage }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to send message.");
      setMessage(result.message || "Message sent.");
      setMessageDrafts((current) => ({ ...current, [row.id]: "" }));
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setBusyId(null);
    }
  }

  async function markReplyReviewed(row: CoordinatorNotificationRow) {
    setBusyId(row.id);
    setMessage("");
    try {
      const response = await fetch("/api/user-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_coordinator_reply_reviewed", notification_id: row.id }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to mark reviewed.");
      setMessage(result.message || "Reply marked reviewed.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to mark reviewed.");
    } finally {
      setBusyId(null);
    }
  }

  if (!isAdmin && !isCoordinator) return null;

  const visibleRows = isAdmin
    ? rows.slice(0, 30)
    : rows.slice(0, 10);

  return (
    <section id="assignment-chat" className="card">
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>{isAdmin ? "Coordinator Message Box" : "Assignment Message Box"}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {isAdmin ? "Message back and forth with coordinators about assigned events and sub-calls." : "Open assignment chats from ELS. Reply here if you need to answer back."}
          </p>
        </div>
        <div className="toolbar">
          {isCoordinator && browserNotificationPermission !== "granted" && browserNotificationPermission !== "unsupported" ? (
            <button className="ghost" type="button" onClick={() => void requestBrowserNotifications()}>Allow phone/app notices</button>
          ) : null}
          <button className="ghost" type="button" onClick={() => void loadRows()} disabled={loading}>Refresh</button>
        </div>
      </div>
      {message ? <p className={message.toLowerCase().includes("unable") || message.toLowerCase().includes("run the") ? "error" : "success"}>{message}</p> : null}
      <div className="list" style={{ marginTop: 12 }}>
        {visibleRows.map((row) => (
          <article key={row.id} className={`card compact coordinator-message-card ${(row.messages || []).some((threadMessage) => threadMessage.sender_role === "coordinator" && !threadMessage.read_at) ? "coordinator-message-unreviewed" : ""}`} style={{ boxShadow: "none" }}>
            <div className="row" style={{ gap: 10 }}>
              <div>
                <strong>{row.title || "Coordinator assignment"}</strong>
                <div className="muted small">
                  {isAdmin ? `${row.coordinator_name || "Coordinator"} • ` : ""}{formatNotificationTime(row.created_at)}
                  {!row.viewed_at && isCoordinator ? " • New" : ""}
                </div>
              </div>
              {(row.messages || []).some((threadMessage) => threadMessage.sender_role === "coordinator" && !threadMessage.read_at) && isAdmin ? <span className="nav-notification-badge">!</span> : null}
            </div>
            <div className="coordinator-chat-box">
              <div className="coordinator-chat-message coordinator-chat-system">
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>{row.body}</div>
                <div className="muted small">{formatNotificationTime(row.created_at)}</div>
              </div>
              {(row.messages || []).map((threadMessage) => {
                const fromCoordinator = threadMessage.sender_role === "coordinator";
                return (
                  <div key={threadMessage.id} className={`coordinator-chat-message ${fromCoordinator ? "coordinator-chat-coordinator" : "coordinator-chat-admin"}`}>
                    <strong className="small">{fromCoordinator ? row.coordinator_name || "Coordinator" : "Storm / Admin"}</strong>
                    <div className="small" style={{ whiteSpace: "pre-wrap" }}>{threadMessage.body}</div>
                    <div className="muted small">{formatNotificationTime(threadMessage.created_at)}</div>
                  </div>
                );
              })}
            </div>
            {(isCoordinator || isAdmin) ? (
              <div className="toolbar" style={{ marginTop: 10, alignItems: "stretch" }}>
                <textarea
                  rows={2}
                  value={messageDrafts[row.id] || ""}
                  onChange={(event) => setMessageDrafts((current) => ({ ...current, [row.id]: event.target.value }))}
                  placeholder={isAdmin ? "Message this coordinator..." : "Reply to Storm/admin..."}
                  style={{ flex: "1 1 260px" }}
                />
                <button className="primary" type="button" disabled={busyId === row.id} onClick={() => void sendThreadMessage(row)}>
                  {busyId === row.id ? "Sending..." : "Send message"}
                </button>
              </div>
            ) : null}
            {isAdmin && (row.messages || []).some((threadMessage) => threadMessage.sender_role === "coordinator" && !threadMessage.read_at) ? (
              <button className="ghost" type="button" disabled={busyId === row.id} onClick={() => void markReplyReviewed(row)}>
                {busyId === row.id ? "Saving..." : "Mark coordinator messages read"}
              </button>
            ) : null}
          </article>
        ))}
        {!loading && !visibleRows.length ? <p className="muted small" style={{ margin: 0 }}>{isAdmin ? "No coordinator replies yet." : "No assignment messages yet."}</p> : null}
      </div>
    </section>
  );
}

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
