"use client";

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
};

export default function GlobalSearch({ enabled, readOnly = false }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || readOnly) return;
    const clean = query.trim();
    if (clean.length < 3) {
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
    }, 500);

    return () => window.clearTimeout(timer);
  }, [query, enabled, readOnly]);

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
          onFocus={() => !readOnly && query.trim().length >= 3 && setOpen(true)}
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
