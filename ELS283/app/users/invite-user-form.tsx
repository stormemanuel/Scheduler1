"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { inviteUserAction } from "./actions";

type ActivityRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  status: "online" | "idle" | "offline";
  current_path: string;
  page_label: string;
  context_type: string;
  context_id: string;
  context_label: string;
  last_action: string;
  last_seen_at: string | null;
};

function relativeSeen(value: string | null) {
  if (!value) return "No activity recorded";
  const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (ageSeconds < 10) return "Just now";
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function activityStatusLabel(status: ActivityRow["status"]) {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  return "Offline";
}

export function ViewAsUserButton({ userId, userName, disabled = false }: { userId: string; userName: string; disabled?: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function startPreview() {
    if (disabled || pending) return;
    const confirmed = window.confirm(`Open the app as ${userName} in read-only mode?`);
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/user-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_preview", user_id: userId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not start user view.");
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start user view.");
      setPending(false);
    }
  }

  return (
    <span style={{ display: "inline-grid", gap: 4 }}>
      <button type="button" className="ghost" onClick={startPreview} disabled={disabled || pending}>
        {disabled ? "Your account" : pending ? "Opening..." : "View as user"}
      </button>
      {error ? <span className="error small">{error}</span> : null}
    </span>
  );
}

export function LiveUserActivityPanel({ compact = false }: { compact?: boolean }) {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [setupMissing, setSetupMissing] = useState(false);
  const [error, setError] = useState("");

  const loadActivity = useCallback(async () => {
    try {
      const response = await fetch("/api/user-access?action=activity", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Could not load live activity.");
      setActivities(Array.isArray(data.activities) ? data.activities : []);
      setCurrentUserId(String(data.current_user_id || ""));
      setSetupMissing(Boolean(data.setup_missing));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load live activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadActivity();
    const timer = window.setInterval(() => void loadActivity(), 5_000);
    return () => window.clearInterval(timer);
  }, [loadActivity]);

  const visibleRows = compact
    ? activities.filter((activity) => activity.status !== "offline").slice(0, 6)
    : activities;
  const onlineCount = activities.filter((activity) => activity.status === "online").length;
  const idleCount = activities.filter((activity) => activity.status === "idle").length;

  return (
    <section className={`card ${compact ? "compact" : ""}`} id="live-user-activity">
      <div className="row" style={{ alignItems: "center" }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{compact ? "Active users" : "Live user activity"}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {onlineCount} online{idleCount ? ` • ${idleCount} idle` : ""}. Refreshes every five seconds.
          </p>
        </div>
        <button type="button" className="ghost" onClick={() => void loadActivity()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {setupMissing ? (
        <p className="error small" style={{ marginTop: 12 }}>
          Live activity is waiting for the ELS282 Supabase migration. View as user is still available.
        </p>
      ) : null}
      {error ? <p className="error small" style={{ marginTop: 12 }}>{error}</p> : null}

      <div className="list" style={{ marginTop: 12 }}>
        {visibleRows.map((activity) => (
          <article key={activity.user_id} id={`activity-${activity.user_id}`} className="activity-user-row">
            <div className="activity-user-main">
              <div className="toolbar" style={{ gap: 6 }}>
                <strong>{activity.full_name}</strong>
                <span className={`badge activity-status activity-${activity.status}`}>{activityStatusLabel(activity.status)}</span>
                <span className="badge">{activity.role}</span>
              </div>
              <div className="muted small">{activity.email}</div>
              <div className="small" style={{ marginTop: 6 }}>
                <strong>{activity.page_label || "No page reported"}</strong>
                {activity.context_label ? <span> • {activity.context_label}</span> : null}
              </div>
              {activity.last_action ? <div className="muted small">Last action: {activity.last_action}</div> : null}
              <div className="muted small">Last seen: {relativeSeen(activity.last_seen_at)}</div>
            </div>
            <div className="toolbar activity-user-actions">
              {activity.current_path ? <a className="ghost" href={activity.current_path}>Open page</a> : null}
              <ViewAsUserButton
                userId={activity.user_id}
                userName={activity.full_name}
                disabled={activity.user_id === currentUserId}
              />
            </div>
          </article>
        ))}
        {!loading && visibleRows.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            {compact ? "No other users are currently online or idle." : "No user activity has been recorded yet."}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default function InviteUserForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form className="list" action={(formData) => {
      setMessage(null);
      setError(null);
      startTransition(async () => {
        const result = await inviteUserAction(formData);
        if (result.ok) setMessage(result.message);
        else setError(result.message);
      });
    }}>
      <label className="field">
        <span>Full name</span>
        <input name="fullName" type="text" placeholder="Storm Leigh" />
      </label>
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" required placeholder="name@example.com" />
      </label>
      <label className="field">
        <span>Role</span>
        <select name="role" defaultValue="coordinator">
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="coordinator">Coordinator</option>
          <option value="salesman">Salesman</option>
          <option value="viewer">Viewer</option>
        </select>
      </label>
      <label className="field">
        <span>Temporary password</span>
        <input name="temporaryPassword" type="text" minLength={8} placeholder="Optional — creates login now" autoComplete="off" />
      </label>
      <p className="muted small">
        Fill in a temporary password to create the login immediately so you can test it before sending access. Leave it blank to send a normal Supabase invite email. Coordinators can change their password later from Account.
      </p>
      {message ? <p className="success">{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <button type="submit" className="primary" disabled={pending}>{pending ? "Saving user..." : "Create / invite user"}</button>
    </form>
  );
}
