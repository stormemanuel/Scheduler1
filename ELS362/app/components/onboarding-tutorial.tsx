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

type CachedCount = {
  value: number;
  expiresAt: number;
  promise: Promise<number> | null;
};

const COUNT_CACHE_MS = 60_000;
const RECENT_ACTIVITY_MS = 2 * 60_000;
const onboardingReviewCountCache: CachedCount = { value: 0, expiresAt: 0, promise: null };
const inboxUnreadCountCache: CachedCount = { value: 0, expiresAt: 0, promise: null };
let appActivityTrackingInstalled = false;
let lastAppActivityAt = Date.now();

function markAppActivity() {
  lastAppActivityAt = Date.now();
}

function shouldRunActivityFetch() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden" && Date.now() - lastAppActivityAt <= RECENT_ACTIVITY_MS;
}

function ensureAppActivityTracking() {
  if (typeof window === "undefined" || appActivityTrackingInstalled) return;
  appActivityTrackingInstalled = true;
  const options: AddEventListenerOptions = { passive: true, capture: true };
  ["pointerdown", "keydown", "touchstart", "scroll"].forEach((eventName) => window.addEventListener(eventName, markAppActivity, options));
  window.addEventListener("focus", markAppActivity);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") markAppActivity();
  });
}

function runAfterAppActivity(callback: () => void | Promise<void>) {
  markAppActivity();
  void callback();
}

function clearCountCache(cache: CachedCount, value?: number) {
  cache.value = typeof value === "number" ? value : cache.value;
  cache.expiresAt = 0;
  cache.promise = null;
}

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

async function loadOnboardingReviewCount({ force = false } = {}) {
  const now = Date.now();
  if (!force && onboardingReviewCountCache.promise) return onboardingReviewCountCache.promise;
  if (!force && onboardingReviewCountCache.expiresAt > now) return onboardingReviewCountCache.value;

  onboardingReviewCountCache.promise = fetch("/api/onboarding?action=review_count", { cache: "no-store" })
    .then(async (response) => {
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; review_count?: number };
      const count = response.ok && result.ok ? Math.max(0, Number(result.review_count || 0)) : 0;
      onboardingReviewCountCache.value = count;
      onboardingReviewCountCache.expiresAt = Date.now() + COUNT_CACHE_MS;
      return count;
    })
    .finally(() => {
      onboardingReviewCountCache.promise = null;
    });
  return onboardingReviewCountCache.promise;
}

async function loadInboxUnreadCount() {
  const now = Date.now();
  if (inboxUnreadCountCache.promise) return inboxUnreadCountCache.promise;
  if (inboxUnreadCountCache.expiresAt > now) return inboxUnreadCountCache.value;

  inboxUnreadCountCache.promise = (async () => {
  const [coordinatorResponse, directResponse] = await Promise.all([
    fetch("/api/user-access?action=coordinator_notifications&count_only=1", { cache: "no-store" }),
    fetch("/api/user-access?action=direct_message_count", { cache: "no-store" }),
  ]);
  const coordinatorResult = (await coordinatorResponse.json().catch(() => ({}))) as { ok?: boolean; unread_count?: number };
  const directResult = (await directResponse.json().catch(() => ({}))) as { ok?: boolean; unread_count?: number };
  const coordinatorCount = coordinatorResponse.ok && coordinatorResult.ok ? Number(coordinatorResult.unread_count || 0) : 0;
  const directCount = directResponse.ok && directResult.ok ? Number(directResult.unread_count || 0) : 0;
    const count = Math.max(0, coordinatorCount) + Math.max(0, directCount);
    inboxUnreadCountCache.value = count;
    inboxUnreadCountCache.expiresAt = Date.now() + COUNT_CACHE_MS;
    return count;
  })().finally(() => {
    inboxUnreadCountCache.promise = null;
  });
  return inboxUnreadCountCache.promise;
}

export function OnboardingReviewNavLink({ href, label }: OnboardingNavLinkProps) {
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    ensureAppActivityTracking();

    async function loadReviewCount() {
      if (!shouldRunActivityFetch()) return;
      try {
        const count = await loadOnboardingReviewCount();
        if (!cancelled) setReviewCount(count);
      } catch {
        // Keep navigation usable even when the review count cannot be loaded.
      }
    }

    function handleCountEvent(event: Event) {
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) {
        clearCountCache(onboardingReviewCountCache, nextCount);
        setReviewCount(nextCount);
      }
    }

    void loadReviewCount();
    const intervalId = window.setInterval(() => {
      if (shouldRunActivityFetch()) void loadReviewCount();
    }, 300000);
    const handleFocus = () => runAfterAppActivity(loadReviewCount);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("els:onboarding-review-count", handleCountEvent);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
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
    ensureAppActivityTracking();

    async function loadUnreadCount() {
      if (!shouldRunActivityFetch()) return;
      try {
        const count = await loadInboxUnreadCount();
        if (!cancelled) setUnreadCount(count);
      } catch {
        // Keep coordinator navigation usable when the notification count is unavailable.
      }
    }

    function handleCountEvent(event: Event) {
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) {
        clearCountCache(inboxUnreadCountCache, nextCount);
        setUnreadCount(nextCount);
      }
    }

    void loadUnreadCount();
    const intervalId = window.setInterval(() => {
      if (shouldRunActivityFetch()) void loadUnreadCount();
    }, 300000);
    const handleFocus = () => runAfterAppActivity(loadUnreadCount);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("els:coordinator-notification-count", handleCountEvent);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
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

export function CoordinatorInboxButton({ href = "/coordinator#assignment-chat", label = "Inbox", role = "coordinator" }: Partial<OnboardingNavLinkProps> & { role?: string }) {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    ensureAppActivityTracking();

    async function loadUnreadCount() {
      if (!shouldRunActivityFetch()) return;
      try {
        const count = await loadInboxUnreadCount();
        if (!cancelled) setUnreadCount(count);
      } catch {
        // Inbox remains usable even if the badge count cannot load.
      }
    }

    function handleCountEvent(event: Event) {
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) {
        clearCountCache(inboxUnreadCountCache, nextCount);
        setUnreadCount(nextCount);
      }
    }

    void loadUnreadCount();
    const intervalId = window.setInterval(() => {
      if (shouldRunActivityFetch()) void loadUnreadCount();
    }, 300000);
    const handleFocus = () => runAfterAppActivity(loadUnreadCount);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("els:coordinator-notification-count", handleCountEvent);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("els:coordinator-notification-count", handleCountEvent);
    };
  }, [role]);

  return (
    <a href={href} className="ghost nav-link-with-badge">
      <span>{label}</span>
      {unreadCount > 0 ? (
        <span className="nav-notification-badge" aria-label={`${unreadCount} inbox item${unreadCount === 1 ? "" : "s"} not viewed yet`}>
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
          clearCountCache(inboxUnreadCountCache, 0);
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
    ensureAppActivityTracking();

    async function loadCount() {
      if (!shouldRunActivityFetch()) return;
      try {
        if (role === "owner" || role === "admin") {
          const count = await loadOnboardingReviewCount();
          if (!cancelled) setInstalledAppBadge(count);
          return;
        }
        if (role === "coordinator") {
          const count = await loadInboxUnreadCount();
          if (!cancelled) {
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
      if (Number.isFinite(nextCount) && nextCount >= 0) {
        clearCountCache(onboardingReviewCountCache, nextCount);
        setInstalledAppBadge(nextCount);
      }
    }

    function handleCoordinatorCount(event: Event) {
      if (role !== "coordinator") return;
      const nextCount = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(nextCount) && nextCount >= 0) {
        clearCountCache(inboxUnreadCountCache, nextCount);
        setInstalledAppBadge(nextCount);
        maybeShowLocalAssignmentNotification(nextCount);
      }
    }

    void loadCount();
    const intervalId = window.setInterval(() => {
      if (shouldRunActivityFetch()) void loadCount();
    }, 300000);
    const handleFocus = () => runAfterAppActivity(loadCount);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("els:onboarding-review-count", handleOnboardingCount);
    window.addEventListener("els:coordinator-notification-count", handleCoordinatorCount);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
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

type CoordinatorBoardMessage = {
  id: string;
  notificationId: string;
  title: string;
  coordinatorName: string;
  senderLabel: string;
  senderRole: string;
  body: string;
  createdAt: string;
  unread: boolean;
};

type DirectMessageUser = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  role?: string | null;
  is_active?: boolean | null;
};

type DirectUserMessage = {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  body: string;
  created_at: string;
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
  const [directMessages, setDirectMessages] = useState<DirectUserMessage[]>([]);
  const [directUsers, setDirectUsers] = useState<DirectMessageUser[]>([]);
  const [directCurrentUserId, setDirectCurrentUserId] = useState("");
  const [directRecipientId, setDirectRecipientId] = useState("");
  const [directDraft, setDirectDraft] = useState("");
  const [directSetupMissing, setDirectSetupMissing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState("unsupported");
  const isAdmin = role === "owner" || role === "admin";
  const isCoordinator = role === "coordinator";

  async function loadRows() {
    if (!isAdmin && !isCoordinator) return;
    if (!shouldRunActivityFetch()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/user-access?action=coordinator_notifications&include_viewed=1", { cache: "no-store" });
      const result = (await response.json()) as { ok?: boolean; rows?: CoordinatorNotificationRow[]; setup_missing?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to load coordinator messages.");
      if (result.setup_missing) {
        setMessage("Message tables are not visible yet. Run the ELS316 message SQL, then refresh this page.");
        setRows([]);
      } else {
        setMessage("");
        setRows(result.rows || []);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load coordinator messages.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDirectMessages() {
    if (!isAdmin && !isCoordinator) return;
    if (!shouldRunActivityFetch()) return;
    try {
      const response = await fetch("/api/user-access?action=direct_messages", { cache: "no-store" });
      const result = (await response.json()) as {
        ok?: boolean;
        current_user_id?: string;
        rows?: DirectUserMessage[];
        users?: DirectMessageUser[];
        setup_missing?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to load direct messages.");
      setDirectSetupMissing(Boolean(result.setup_missing));
      setDirectCurrentUserId(result.current_user_id || "");
      setDirectMessages(result.rows || []);
      setDirectUsers(result.users || []);
      setDirectRecipientId((current) => {
        if (current && (result.users || []).some((user) => user.id === current)) return current;
        return (result.users || []).find((user) => user.id !== result.current_user_id)?.id || "";
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load direct messages.");
    }
  }

  useEffect(() => {
    ensureAppActivityTracking();
    setBrowserNotificationPermission("Notification" in window ? Notification.permission : "unsupported");
    void loadRows();
    void loadDirectMessages();
    const intervalId = window.setInterval(() => {
      if (shouldRunActivityFetch()) void loadRows();
    }, 300000);
    const directIntervalId = window.setInterval(() => {
      if (shouldRunActivityFetch()) void loadDirectMessages();
    }, 300000);
    const handleRowsFocus = () => runAfterAppActivity(loadRows);
    const handleDirectFocus = () => runAfterAppActivity(loadDirectMessages);
    window.addEventListener("focus", handleRowsFocus);
    window.addEventListener("focus", handleDirectFocus);
    return () => {
      window.clearInterval(intervalId);
      window.clearInterval(directIntervalId);
      window.removeEventListener("focus", handleRowsFocus);
      window.removeEventListener("focus", handleDirectFocus);
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

  async function sendDirectMessage() {
    const nextMessage = directDraft.trim();
    if (!directRecipientId) {
      setMessage("Choose who to message.");
      return;
    }
    if (!nextMessage) {
      setMessage("Type a message first.");
      return;
    }
    setBusyId("direct-message");
    setMessage("");
    try {
      const response = await fetch("/api/user-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_direct_message", recipient_id: directRecipientId, message_body: nextMessage }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; setup_missing?: boolean };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to send direct message.");
      setDirectDraft("");
      setMessage(result.message || "Direct message sent.");
      await loadDirectMessages();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send direct message.");
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
  const directUserById = new Map(directUsers.map((user) => [user.id, user]));
  const directBoardMessages = [...directMessages].reverse();
  const directRecipientOptions = directUsers.filter((user) => user.id !== directCurrentUserId);
  const boardMessages: CoordinatorBoardMessage[] = visibleRows
    .flatMap((row) => {
      const title = row.title || "Coordinator assignment";
      const coordinatorName = row.coordinator_name || "Coordinator";
      const systemMessage: CoordinatorBoardMessage = {
        id: `${row.id}:system`,
        notificationId: row.id,
        title,
        coordinatorName,
        senderLabel: "ELS assignment",
        senderRole: "system",
        body: row.body || "",
        createdAt: row.created_at || "",
        unread: Boolean(!row.viewed_at && isCoordinator),
      };
      const threadMessages = (row.messages || []).map((threadMessage): CoordinatorBoardMessage => {
        const fromCoordinator = threadMessage.sender_role === "coordinator";
        const fromAdmin = threadMessage.sender_role === "admin";
        return {
          id: threadMessage.id,
          notificationId: row.id,
          title,
          coordinatorName,
          senderLabel: fromCoordinator ? coordinatorName : fromAdmin ? "Storm / Admin" : "ELS",
          senderRole: threadMessage.sender_role || "system",
          body: threadMessage.body || "",
          createdAt: threadMessage.created_at || "",
          unread: Boolean(!threadMessage.read_at && ((isAdmin && fromCoordinator) || (isCoordinator && fromAdmin))),
        };
      });
      return [systemMessage, ...threadMessages].filter((item) => item.body);
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <section id="assignment-chat" className="card">
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>{isAdmin ? "Coordinator Message Board" : "Assignment Message Board"}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {isAdmin ? "Every assignment message and coordinator reply appears here in one running board." : "Every assignment message from ELS and your replies appear here in one running board."}
          </p>
        </div>
        <div className="toolbar">
          {isCoordinator && browserNotificationPermission !== "granted" && browserNotificationPermission !== "unsupported" ? (
            <button className="ghost" type="button" onClick={() => void requestBrowserNotifications()}>Allow phone/app notices</button>
          ) : null}
          <button className="ghost" type="button" onClick={() => void loadRows()} disabled={loading}>Refresh</button>
        </div>
      </div>
      {message ? <p className={message.toLowerCase().includes("unable") || message.toLowerCase().includes("not visible") || message.toLowerCase().includes("run the") ? "error" : "success"}>{message}</p> : null}
      <div className="card compact" style={{ marginTop: 12, boxShadow: "none" }}>
        <h3 style={{ marginTop: 0 }}>Direct Messages</h3>
        {directSetupMissing ? <p className="error">Direct message table is not visible yet. Run the ELS316 message SQL, then refresh this page.</p> : null}
        <div className="toolbar" style={{ alignItems: "stretch" }}>
          <select value={directRecipientId} onChange={(event) => setDirectRecipientId(event.target.value)} style={{ flex: "0 1 260px" }}>
            <option value="">Choose a user</option>
            {directRecipientOptions.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name || user.email || "User"}{user.role ? ` • ${user.role}` : ""}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            value={directDraft}
            onChange={(event) => setDirectDraft(event.target.value)}
            placeholder="Send a direct message..."
            style={{ flex: "1 1 320px" }}
          />
          <button className="primary" type="button" disabled={busyId === "direct-message" || directSetupMissing} onClick={() => void sendDirectMessage()}>
            {busyId === "direct-message" ? "Sending..." : "Send direct"}
          </button>
        </div>
        <div className="coordinator-message-board" style={{ marginTop: 12 }}>
          {directBoardMessages.map((directMessage) => {
            const sentByMe = directMessage.sender_user_id === directCurrentUserId;
            const otherUser = directUserById.get(sentByMe ? directMessage.recipient_user_id : directMessage.sender_user_id);
            return (
              <article key={directMessage.id} className={`coordinator-board-post ${sentByMe ? "coordinator-board-admin" : "coordinator-board-coordinator"}`}>
                <div className="row" style={{ gap: 10 }}>
                  <div>
                    <strong>{sentByMe ? `To ${otherUser?.full_name || otherUser?.email || "User"}` : `From ${otherUser?.full_name || otherUser?.email || "User"}`}</strong>
                    <div className="muted small">{formatNotificationTime(directMessage.created_at)}</div>
                  </div>
                  {!sentByMe && !directMessage.read_at ? <span className="nav-notification-badge">!</span> : null}
                </div>
                <div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{directMessage.body}</div>
              </article>
            );
          })}
          {!directSetupMissing && !directBoardMessages.length ? <p className="muted small" style={{ margin: 0 }}>No direct messages yet.</p> : null}
        </div>
      </div>
      <div className="coordinator-message-board" style={{ marginTop: 12 }}>
        {boardMessages.map((boardMessage) => (
          <article key={boardMessage.id} className={`coordinator-board-post ${boardMessage.senderRole === "coordinator" ? "coordinator-board-coordinator" : boardMessage.senderRole === "admin" ? "coordinator-board-admin" : "coordinator-board-system"}`}>
            <div className="row" style={{ gap: 10 }}>
              <div>
                <strong>{boardMessage.senderLabel}</strong>
                <div className="muted small">
                  {isAdmin ? `${boardMessage.coordinatorName} • ` : ""}{boardMessage.title} • {formatNotificationTime(boardMessage.createdAt)}
                </div>
              </div>
              {boardMessage.unread ? <span className="nav-notification-badge">!</span> : null}
            </div>
            <div className="small" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{boardMessage.body}</div>
          </article>
        ))}
        {!loading && !boardMessages.length ? <p className="muted small" style={{ margin: 0 }}>{isAdmin ? "No coordinator messages yet." : "No assignment messages yet."}</p> : null}
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        {visibleRows.map((row) => (
          <article key={row.id} className={`card compact coordinator-message-card ${(row.messages || []).some((threadMessage) => threadMessage.sender_role === "coordinator" && !threadMessage.read_at) ? "coordinator-message-unreviewed" : ""}`} style={{ boxShadow: "none" }}>
            <div className="row" style={{ gap: 10 }}>
              <div>
                <strong>Reply on: {row.title || "Coordinator assignment"}</strong>
                <div className="muted small">
                  {isAdmin ? `${row.coordinator_name || "Coordinator"} • ` : ""}{formatNotificationTime(row.created_at)}
                  {!row.viewed_at && isCoordinator ? " • New" : ""}
                </div>
              </div>
              {(row.messages || []).some((threadMessage) => threadMessage.sender_role === "coordinator" && !threadMessage.read_at) && isAdmin ? <span className="nav-notification-badge">!</span> : null}
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
