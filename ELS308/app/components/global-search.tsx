"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type SearchResult = {
  id: string;
  type: string;
  label: string;
  detail: string;
  href: string;
};

type Props = {
  enabled: boolean;
  readOnly?: boolean;
  trackActivity?: boolean;
};

type ActivityContext = {
  type?: string;
  id?: string;
  label?: string;
};

const pageLabelByPath: Record<string, string> = {
  "/": "Overview",
  "/coordinator": "Coordinator",
  "/crew": "Crew",
  "/onboarding-center": "Onboarding",
  "/events": "Events",
  "/clients": "Clients",
  "/pipelines": "Sales Pipeline",
  "/payroll": "Payroll",
  "/users": "Users",
  "/settings": "Settings",
  "/account": "Account",
};

function cleanActivityLabel(value: string | null | undefined, maxLength = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function readActivityContext(pathname: string): ActivityContext {
  if (typeof window === "undefined" || pathname !== "/events") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem("els.activity.context") || "{}") as ActivityContext;
    return {
      type: cleanActivityLabel(value.type, 40),
      id: cleanActivityLabel(value.id, 100),
      label: cleanActivityLabel(value.label, 180),
    };
  } catch {
    return {};
  }
}

export default function GlobalSearch({ enabled, readOnly = false, trackActivity = false }: Props) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastActionRef = useRef("");

  useEffect(() => {
    if (!enabled || readOnly) return;
    const clean = query.trim();
    if (clean.length < 2) {
      abortRef.current?.abort();
      setResults([]);
      setOpen(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/global-search?q=${encodeURIComponent(clean)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({ results: [] }));
        setResults(Array.isArray(data.results) ? data.results : []);
        setOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResults([]);
          setOpen(false);
        }
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query, enabled, readOnly]);

  useEffect(() => {
    if (!enabled || !trackActivity) return;
    let stopped = false;

    const activityPayload = () => {
      const context = readActivityContext(pathname);
      return {
        action: "heartbeat",
        current_path: pathname || "/",
        page_label: pageLabelByPath[pathname] || pathname.split("/").filter(Boolean).join(" / ") || "Overview",
        context_type: context.type || "",
        context_id: context.id || "",
        context_label: context.label || "",
        last_action: lastActionRef.current,
        is_visible: document.visibilityState === "visible",
      };
    };

    const sendHeartbeat = async () => {
      if (stopped) return;
      try {
        await fetch("/api/user-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(activityPayload()),
          cache: "no-store",
          keepalive: true,
        });
      } catch {
        // Activity reporting must never interrupt normal app work.
      }
    };

    const handleClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target.closest("button, a, [role='button']") : null;
      if (!element || element.hasAttribute("data-activity-ignore") || element.closest("[data-activity-ignore]")) return;
      const label = cleanActivityLabel(element.getAttribute("aria-label") || element.textContent, 100);
      if (!label) return;
      lastActionRef.current = element.tagName === "A" ? `Opened ${label}` : `Used ${label}`;
      window.setTimeout(() => void sendHeartbeat(), 0);
    };

    const handleVisibility = () => void sendHeartbeat();
    const handleContext = () => void sendHeartbeat();
    const handlePageHide = () => {
      try {
        const blob = new Blob([JSON.stringify({ ...activityPayload(), is_visible: false })], { type: "application/json" });
        navigator.sendBeacon("/api/user-access", blob);
      } catch {
        // Best-effort only.
      }
    };

    void sendHeartbeat();
    const timer = window.setInterval(() => void sendHeartbeat(), 15_000);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("els-activity-context", handleContext);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("els-activity-context", handleContext);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [enabled, pathname, trackActivity]);

  if (!enabled) return null;

  return (
    <div className="global-search-wrap" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <label className="global-search-label">
        <span className="sr-only">Search across the app</span>
        <input
          value={query}
          disabled={readOnly}
          onFocus={() => !readOnly && query.trim().length >= 2 && setOpen(true)}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={readOnly ? "Search disabled while viewing as another user" : "Search events, techs, clients, pipeline..."}
          autoComplete="off"
        />
      </label>
      {open && !readOnly ? (
        <div className="global-search-popover" role="listbox" aria-label="Search results">
          {loading ? <div className="global-search-empty">Searching...</div> : null}
          {!loading && results.length === 0 ? <div className="global-search-empty">No matching results yet.</div> : null}
          {!loading && results.map((result) => (
            <a key={`${result.type}-${result.id}`} className="global-search-result" href={result.href}>
              <span className="global-search-type">{result.type}</span>
              <strong>{result.label}</strong>
              <span>{result.detail}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
