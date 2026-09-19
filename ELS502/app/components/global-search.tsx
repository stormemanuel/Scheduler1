"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

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

export type OverviewCalendarShow = {
  id: string;
  name: string;
  client: string;
  venue: string;
  show_start: string;
  show_end: string;
  calendar_dates: string[];
};

type GoogleOverviewEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location: string;
  html_link: string;
  can_delete: boolean;
};

type CalendarView = "year" | "month" | "agenda";

function calendarDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarMonthTitle(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function calendarVisibleRange(date: Date, view: CalendarView) {
  const start = view === "year" ? new Date(date.getFullYear(), 0, 1) : new Date(date.getFullYear(), date.getMonth(), 1);
  const end = view === "year" ? new Date(date.getFullYear() + 1, 0, 1) : new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function calendarCellsForMonth(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const result: Array<{ key: string; day: number | null }> = [];
  for (let index = 0; index < firstDay; index += 1) result.push({ key: `blank-${year}-${month}-${index}`, day: null });
  for (let day = 1; day <= daysInMonth; day += 1) result.push({ key: calendarDateKey(new Date(year, month, day)), day });
  while (result.length % 7) result.push({ key: `blank-end-${year}-${month}-${result.length}`, day: null });
  return result;
}

function displayCalendarTime(value: string, allDay: boolean) {
  if (allDay || !value.includes("T")) return "All day";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function addOneHour(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "10:00";
  const total = Math.min(hours * 60 + minutes + 60, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function showTouchesCalendarDate(show: OverviewCalendarShow, dayKey: string) {
  if (show.calendar_dates.length) return show.calendar_dates.includes(dayKey);
  const start = String(show.show_start || "").slice(0, 10);
  const end = String(show.show_end || show.show_start || "").slice(0, 10);
  return Boolean(start && start <= dayKey && end >= dayKey);
}

export function OverviewCalendar({ shows, canCreateElsEvent }: { shows: OverviewCalendarShow[]; canCreateElsEvent: boolean }) {
  const today = calendarDateKey(new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [view, setView] = useState<CalendarView>("year");
  const [selectedDate, setSelectedDate] = useState(today);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [googleEvents, setGoogleEvents] = useState<GoogleOverviewEvent[]>([]);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [googleAccount, setGoogleAccount] = useState("");
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [calendarMessage, setCalendarMessage] = useState("");
  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const loadGoogleEvents = async (month: Date, rangeView: CalendarView = view) => {
    setLoadingGoogle(true);
    setCalendarMessage("");
    try {
      const statusResponse = await fetch("/api/shows/google-calendar?action=status", { cache: "no-store" });
      const status = await statusResponse.json().catch(() => ({}));
      const connected = Boolean(status.connected);
      setGoogleConnected(connected);
      setGoogleAccount(String(status.account_email || ""));
      if (!connected) {
        setGoogleEvents([]);
        return;
      }
      const range = calendarVisibleRange(month, rangeView);
      const params = new URLSearchParams({ action: "overview-events", time_min: range.start, time_max: range.end });
      const response = await fetch(`/api/shows/google-calendar?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.message || "Google Calendar could not be loaded."));
      setGoogleEvents(Array.isArray(data.events) ? data.events : []);
    } catch (error) {
      setGoogleEvents([]);
      setCalendarMessage(error instanceof Error ? error.message : "Google Calendar could not be loaded.");
    } finally {
      setLoadingGoogle(false);
    }
  };

  useEffect(() => {
    void loadGoogleEvents(visibleMonth, view);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMonth.getFullYear(), visibleMonth.getMonth(), view]);

  const cells = useMemo(() => calendarCellsForMonth(visibleMonth), [visibleMonth]);

  const calendarItems = useMemo(() => {
    const monthPrefix = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
    const yearPrefix = `${visibleMonth.getFullYear()}-`;
    const visiblePrefix = view === "year" ? yearPrefix : monthPrefix;
    const items: Array<{ key: string; date: string; title: string; detail: string; href: string; kind: "els" | "google"; time: string; canDelete: boolean; googleId: string }> = [];
    for (const show of shows) {
      const explicitDates = show.calendar_dates.length ? show.calendar_dates : [];
      if (explicitDates.length) {
        for (const date of explicitDates.filter((value) => value.startsWith(visiblePrefix))) {
          items.push({ key: `els-${show.id}-${date}`, date, title: show.name || "Untitled event", detail: [show.client, show.venue].filter(Boolean).join(" • "), href: `/events?show_id=${encodeURIComponent(show.id)}`, kind: "els", time: "ELS event", canDelete: false, googleId: "" });
        }
      } else {
        const datesToCheck = view === "year"
          ? Array.from({ length: 12 }, (_, month) => calendarCellsForMonth(new Date(visibleMonth.getFullYear(), month, 1))).flat()
          : cells;
        for (const cell of datesToCheck) {
          if (cell.day && showTouchesCalendarDate(show, cell.key)) items.push({ key: `els-${show.id}-${cell.key}`, date: cell.key, title: show.name || "Untitled event", detail: [show.client, show.venue].filter(Boolean).join(" • "), href: `/events?show_id=${encodeURIComponent(show.id)}`, kind: "els", time: "ELS event", canDelete: false, googleId: "" });
        }
      }
    }
    for (const event of googleEvents) {
      const date = String(event.start || "").slice(0, 10);
      if (!date.startsWith(visiblePrefix)) continue;
      items.push({ key: `google-${event.id}`, date, title: event.title || "Busy", detail: event.location || "Google Calendar", href: event.html_link || "", kind: "google", time: displayCalendarTime(event.start, event.all_day), canDelete: event.can_delete, googleId: event.id });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
  }, [cells, googleEvents, shows, view, visibleMonth]);

  const moveCalendar = (amount: number) => setVisibleMonth((current) => view === "year" ? new Date(current.getFullYear() + amount, 0, 1) : new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const openDate = (date: string) => {
    setSelectedDate(date);
    setPersonalOpen(true);
    setCalendarMessage("");
  };
  const openNewElsEvent = (date = selectedDate) => {
    window.location.href = `/events?create=1&date=${encodeURIComponent(date)}`;
  };

  const savePersonalItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setCalendarMessage("Enter a title for the appointment or reminder.");
      return;
    }
    setSavingPersonal(true);
    setCalendarMessage("");
    try {
      const response = await fetch("/api/shows/google-calendar?action=create-personal-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, date: selectedDate, all_day: allDay, start_time: startTime, end_time: endTime, location, notes, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.message || "The Google Calendar item could not be created."));
      setTitle("");
      setLocation("");
      setNotes("");
      setPersonalOpen(false);
      setCalendarMessage("Added to ELS and Google Calendar.");
      await loadGoogleEvents(visibleMonth, view);
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : "The Google Calendar item could not be created.");
    } finally {
      setSavingPersonal(false);
    }
  };

  const deletePersonalItem = async (googleId: string) => {
    if (!window.confirm("Delete this personal item from ELS and Google Calendar?")) return;
    setCalendarMessage("");
    try {
      const response = await fetch("/api/shows/google-calendar?action=delete-personal-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: googleId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(data.message || "The calendar item could not be deleted."));
      setGoogleEvents((current) => current.filter((item) => item.id !== googleId));
      setCalendarMessage("Personal item deleted from Google Calendar.");
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : "The calendar item could not be deleted.");
    }
  };

  return (
    <section className="card calendar-card interactive-calendar">
      <div className="calendar-toolbar">
        <div>
          <div className="calendar-title-row">
            <h2>{view === "year" ? visibleMonth.getFullYear() : calendarMonthTitle(visibleMonth)}</h2>
            {loadingGoogle ? <span className="badge">Syncing Google…</span> : null}
          </div>
          <p className="small muted">ELS events and Google Calendar items together. Personal items never enter Payroll or crew scheduling.</p>
        </div>
        <div className="toolbar calendar-actions">
          <button type="button" className="ghost" onClick={() => moveCalendar(-1)} aria-label={view === "year" ? "Previous year" : "Previous month"}>‹</button>
          <button type="button" className="ghost" onClick={() => setVisibleMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</button>
          <button type="button" className="ghost" onClick={() => moveCalendar(1)} aria-label={view === "year" ? "Next year" : "Next month"}>›</button>
          <button type="button" className={view === "year" ? "primary" : "ghost"} onClick={() => setView("year")}>Year</button>
          <button type="button" className={view === "month" ? "primary" : "ghost"} onClick={() => setView("month")}>Month</button>
          <button type="button" className={view === "agenda" ? "primary" : "ghost"} onClick={() => setView("agenda")}>List</button>
          {canCreateElsEvent ? <button type="button" className="primary" onClick={() => openNewElsEvent(today)}>New ELS Event</button> : null}
          <button type="button" className="ghost" onClick={() => openDate(selectedDate || today)}>New Personal Item</button>
        </div>
      </div>

      <div className="calendar-sync-row">
        <span className="calendar-legend calendar-legend-els">ELS event</span>
        <span className="calendar-legend calendar-legend-google">Google Calendar</span>
        {googleConnected === false ? <a className="ghost calendar-connect" href="/api/shows/google-calendar?action=connect&return_to=overview">Connect Google Calendar</a> : null}
        {googleConnected ? <span className="small muted">Connected{googleAccount ? ` as ${googleAccount}` : ""}</span> : null}
      </div>
      {calendarMessage ? <p className={/could not|enter|connect/i.test(calendarMessage) ? "error" : "success"}>{calendarMessage}</p> : null}

      {view === "year" ? (
        <div className="calendar-year-grid">
          {Array.from({ length: 12 }, (_, month) => {
            const monthDate = new Date(visibleMonth.getFullYear(), month, 1);
            const miniCells = calendarCellsForMonth(monthDate);
            return (
              <section key={month} className="calendar-mini-month">
                <button type="button" className="calendar-mini-title" onClick={() => { setVisibleMonth(monthDate); setView("month"); }}>{monthDate.toLocaleDateString("en-US", { month: "long" })}</button>
                <div className="calendar-mini-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
                <div className="calendar-mini-grid">
                  {miniCells.map((cell) => {
                    const dayItems = cell.day ? calendarItems.filter((item) => item.date === cell.key) : [];
                    return cell.day ? (
                      <button type="button" key={cell.key} className={`calendar-mini-day ${cell.key === today ? "calendar-mini-today" : ""} ${dayItems.length ? "calendar-mini-busy" : ""}`} onClick={() => openDate(cell.key)} title={dayItems.map((item) => item.title).join(" • ") || `Add to ${cell.key}`}>
                        <span>{cell.day}</span>
                        {dayItems.length ? <span className="calendar-mini-dots">{dayItems.slice(0, 3).map((item) => <i key={item.key} className={`calendar-mini-dot calendar-mini-dot-${item.kind}`} />)}{dayItems.length > 3 ? <small>+{dayItems.length - 3}</small> : null}</span> : null}
                      </button>
                    ) : <span key={cell.key} className="calendar-mini-empty" />;
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : view === "month" ? (
        <>
          <div className="calendar-weekdays small muted"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>
          <div className="calendar-grid">
            {cells.map((cell) => {
              const dayItems = cell.day ? calendarItems.filter((item) => item.date === cell.key) : [];
              return (
                <div key={cell.key} className={`calendar-day ${cell.day ? "calendar-clickable" : "calendar-empty"} ${cell.key === today ? "calendar-today" : ""}`} onDoubleClick={() => cell.day && openDate(cell.key)}>
                  {cell.day ? <button type="button" className="calendar-day-number" onClick={() => openDate(cell.key)} aria-label={`Add to ${cell.key}`}>{cell.day}</button> : null}
                  <div className="calendar-events">
                    {dayItems.map((item) => item.href ? (
                      <a key={item.key} href={item.href} target={item.kind === "google" ? "_blank" : undefined} rel={item.kind === "google" ? "noreferrer" : undefined} className={`calendar-event calendar-event-${item.kind}`} title={[item.title, item.time, item.detail].filter(Boolean).join(" — ")}>
                        {item.kind === "google" && item.time !== "All day" ? <small>{item.time}</small> : null}{item.title}
                      </a>
                    ) : <span key={item.key} className={`calendar-event calendar-event-${item.kind}`}>{item.title}</span>)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="calendar-agenda">
          {calendarItems.map((item) => (
            <div key={item.key} className={`calendar-agenda-item calendar-agenda-${item.kind}`}>
              <div className="calendar-agenda-date"><strong>{new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</strong><span>{item.time}</span></div>
              <div><a href={item.href || undefined} target={item.kind === "google" ? "_blank" : undefined} rel={item.kind === "google" ? "noreferrer" : undefined}><strong>{item.title}</strong></a><div className="small muted">{item.detail || (item.kind === "els" ? "ELS event" : "Google Calendar")}</div></div>
              {item.canDelete ? <button type="button" className="ghost danger" onClick={() => void deletePersonalItem(item.googleId)}>Delete</button> : null}
            </div>
          ))}
          {!calendarItems.length ? <p className="muted">Nothing scheduled this month. Click New ELS Event or New Personal Item to add something.</p> : null}
        </div>
      )}

      {personalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPersonalOpen(false); }}>
          <form className="card calendar-create-modal" onSubmit={savePersonalItem}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div><h3 style={{ margin: 0 }}>Add to {new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h3><p className="small muted">Choose a full ELS event or a personal Google Calendar item.</p></div>
              <button type="button" className="ghost" onClick={() => setPersonalOpen(false)}>Close</button>
            </div>
            {canCreateElsEvent ? <button type="button" className="primary calendar-full-button" onClick={() => openNewElsEvent(selectedDate)}>Create full ELS event for this date</button> : null}
            <div className="divider calendar-or">Personal appointment or reminder</div>
            {googleConnected === false ? <div className="card compact accent-card"><strong>Connect Google Calendar first</strong><p className="small muted">Personal items are stored in Google so they stay available here and in Google Calendar.</p><a className="primary" href="/api/shows/google-calendar?action=connect&return_to=overview">Connect Google Calendar</a></div> : (
              <div className="grid" style={{ gap: 12 }}>
                <label className="field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.currentTarget.value)} placeholder="Appointment, reminder, meeting…" autoFocus /></label>
                <label className="checkbox-line"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.currentTarget.checked)} /><span>All day</span></label>
                {!allDay ? <div className="grid grid-2"><label className="field"><span>Starts</span><input type="time" value={startTime} onChange={(event) => { setStartTime(event.currentTarget.value); setEndTime(addOneHour(event.currentTarget.value)); }} /></label><label className="field"><span>Ends</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.currentTarget.value)} /></label></div> : null}
                <label className="field"><span>Location</span><input value={location} onChange={(event) => setLocation(event.currentTarget.value)} placeholder="Optional" /></label>
                <label className="field"><span>Notes</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} placeholder="Optional" /></label>
                <div className="toolbar"><button type="submit" className="primary" disabled={savingPersonal || !googleConnected}>{savingPersonal ? "Adding…" : "Add to ELS + Google"}</button><button type="button" className="ghost" onClick={() => setPersonalOpen(false)}>Cancel</button></div>
              </div>
            )}
          </form>
        </div>
      ) : null}
    </section>
  );
}
