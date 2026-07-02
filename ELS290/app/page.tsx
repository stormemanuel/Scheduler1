import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { getCrewPageData } from "@/lib/crew-data";
import { getEventsPageData } from "@/lib/events-data";
import type { ShowRecord } from "@/lib/events-types";

function dateKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanDateKey(value: string | null | undefined) {
  return String(value ?? "").slice(0, 10);
}

function parseDateKey(value: string) {
  const [year, month, day] = cleanDateKey(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatShortDate(value: string) {
  const date = parseDateKey(value);
  if (!date) return "Date TBD";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function eventStatus(show: ShowRecord, today: string) {
  const start = cleanDateKey(show.show_start);
  const end = cleanDateKey(show.show_end) || start;
  if (start && start > today) return "upcoming" as const;
  if (start && end && start <= today && end >= today) return "current" as const;
  return "past" as const;
}

function showRange(show: ShowRecord) {
  const start = cleanDateKey(show.show_start);
  const end = cleanDateKey(show.show_end) || start;
  if (!start) return "Dates TBD";
  if (start === end) return formatShortDate(start);
  return `${formatShortDate(start)}–${formatShortDate(end)}`;
}

function monthTitle(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function showTouchesDate(show: ShowRecord, dayKey: string) {
  const start = cleanDateKey(show.show_start);
  const end = cleanDateKey(show.show_end) || start;
  return Boolean(start && end && start <= dayKey && end >= dayKey);
}

function buildCalendar(baseDate: Date, shows: ShowRecord[]) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ key: string; day: number | null; shows: ShowRecord[] }> = [];

  for (let i = 0; i < first.getDay(); i += 1) {
    cells.push({ key: `blank-${year}-${month}-${i}`, day: null, shows: [] });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKeyFromDate(new Date(year, month, day));
    cells.push({ key, day, shows: shows.filter((show) => showTouchesDate(show, key)) });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `blank-end-${year}-${month}-${cells.length}`, day: null, shows: [] });
  }

  return cells;
}

function EventMiniList({ title, shows, status }: { title: string; shows: ShowRecord[]; status: "current" | "upcoming" }) {
  return (
    <section className="card">
      <div className="row" style={{ alignItems: "center" }}>
        <h2 style={{ marginBottom: 0 }}>{title}</h2>
        <span className={`badge event-badge-${status}`}>{shows.length}</span>
      </div>
      <div className="list" style={{ marginTop: 12 }}>
        {shows.slice(0, 8).map((show) => (
          <Link key={show.id} href="/events" className={`overview-event-card event-card-${status}`}>
            <strong>{show.name || "Untitled show"}</strong>
            <span className="muted small">{show.client || "No client"} • {show.venue || "No venue"}</span>
            <span className="small">{showRange(show)}</span>
          </Link>
        ))}
        {shows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No {status} shows found.</p> : null}
      </div>
    </section>
  );
}

function MonthCalendar({ date, shows, today }: { date: Date; shows: ShowRecord[]; today: string }) {
  const cells = buildCalendar(date, shows);
  return (
    <section className="card calendar-card">
      <div className="row" style={{ alignItems: "center" }}>
        <h2 style={{ marginBottom: 0 }}>{monthTitle(date)}</h2>
        <span className="badge">Calendar</span>
      </div>
      <div className="calendar-weekdays small muted">
        <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
      </div>
      <div className="calendar-grid">
        {cells.map((cell) => (
          <div key={cell.key} className={`calendar-day ${cell.day ? "" : "calendar-empty"} ${cell.key === today ? "calendar-today" : ""}`}>
            {cell.day ? <strong>{cell.day}</strong> : null}
            <div className="calendar-events">
              {cell.shows.slice(0, 2).map((show) => (
                <span key={show.id} className={`calendar-event event-badge-${eventStatus(show, today)}`}>{show.name || "Untitled"}</span>
              ))}
              {cell.shows.length > 2 ? <span className="calendar-more">+{cell.shows.length - 2} more</span> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function HomePage() {
  const session = await requirePage("overview");
  const { cityPools, crewRecords, setupMissing } = await getCrewPageData();
  const eventsData = await getEventsPageData();
  const today = dateKeyFromDate(new Date());
  const shows = eventsData.shows ?? [];
  const upcomingShows = shows.filter((show) => eventStatus(show, today) === "upcoming").sort((a, b) => cleanDateKey(a.show_start).localeCompare(cleanDateKey(b.show_start)));
  const currentShows = shows.filter((show) => eventStatus(show, today) === "current").sort((a, b) => cleanDateKey(a.show_start).localeCompare(cleanDateKey(b.show_start)));
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const role = String(session.profile?.role || "viewer");
  const isOwnerAdmin = role === "owner" || role === "admin";
  const pendingFeedbackCount = (eventsData.clientFeedbackResponses ?? []).filter(
    (response) => !response.excluded_from_ratings && !response.rating_approved
  ).length;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card accent-card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>{isOwnerAdmin ? "Owner / Admin Overview" : "Operations Overview"}</h2>
            <p className="muted" style={{ margin: 0 }}>
              Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>. Upcoming and current shows are shown first so dispatch, confirmations, and payroll stay visible.
            </p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <Link className="ghost" href="/events">Open Events</Link>
            <Link className="ghost" href="/payroll">Open Payroll</Link>
          </div>
        </div>
      </section>

      <section className={`grid ${isOwnerAdmin ? "grid-4" : "grid-3"}`}>
        <div className="card compact"><div className="muted small">Current shows</div><strong style={{ fontSize: 30 }}>{currentShows.length}</strong></div>
        <div className="card compact"><div className="muted small">Upcoming shows</div><strong style={{ fontSize: 30 }}>{upcomingShows.length}</strong></div>
        <div className="card compact"><div className="muted small">Crew records</div><strong style={{ fontSize: 30 }}>{setupMissing ? "—" : crewRecords.length}</strong><div className="muted small">{setupMissing ? "Setup missing" : `${cityPools.length} city pools`}</div></div>
        {isOwnerAdmin ? (
          <Link
            href="/events?feedback=1&review=1"
            className="card compact"
            aria-label={`Open feedback forms${pendingFeedbackCount ? ` with ${pendingFeedbackCount} pending review` : ""}`}
            style={{ display: "block" }}
          >
            <div className="row" style={{ alignItems: "center" }}>
              <div className="muted small">Feedback forms</div>
              {pendingFeedbackCount ? <span className="badge danger" style={{ margin: 0 }}>{pendingFeedbackCount}</span> : null}
            </div>
            <strong style={{ display: "block", fontSize: 30, marginTop: 4 }}>{pendingFeedbackCount}</strong>
            <div className="muted small">Pending review</div>
          </Link>
        ) : null}
      </section>

      <section className="grid grid-2">
        <EventMiniList title="Current shows" shows={currentShows} status="current" />
        <EventMiniList title="Upcoming shows" shows={upcomingShows} status="upcoming" />
      </section>

      {eventsData.error ? <p className="error">{eventsData.error}</p> : null}

      <section className="grid grid-2">
        <MonthCalendar date={new Date()} shows={shows} today={today} />
        <MonthCalendar date={nextMonth} shows={shows} today={today} />
      </section>
    </div>
  );
}
