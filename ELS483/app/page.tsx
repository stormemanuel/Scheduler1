import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { ShowRecord } from "@/lib/events-types";

type OverviewShow = ShowRecord & { calendar_dates?: string[] };

type OverviewResult = {
  shows: OverviewShow[];
  crewCount: number | null;
  cityPoolCount: number | null;
  pendingFeedbackCount: number;
  setupMissing: boolean;
  error: string | null;
};

function emptyOverview(setupMissing = false, error: string | null = null): OverviewResult {
  return { shows: [], crewCount: null, cityPoolCount: null, pendingFeedbackCount: 0, setupMissing, error };
}

async function getOverviewData(session: Awaited<ReturnType<typeof requirePage>>): Promise<OverviewResult> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return emptyOverview(true);

  const role = String(session.profile?.role || "viewer").toLowerCase().trim();
  const currentUserId = session.user?.id || "";
  const profileId = String((session.profile as { id?: string } | null)?.id || currentUserId);
  const userAccessIds = [currentUserId, profileId].filter(Boolean);
  const restrictEventsToOwner = Boolean(role === "coordinator" && currentUserId);
  const todayKey = new Date().toISOString().slice(0, 10);
  const lookbackKey = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 10);

  const [showsRes, crewCountRes, cityPoolCountRes, feedbackCountRes] = await Promise.all([
    supabase
      .from("shows")
      .select("id, name, client, venue, event_location, rate_city, show_start, show_end, created_by, assigned_coordinator_user_id")
      .or(`show_end.gte.${lookbackKey},show_start.gte.${todayKey}`)
      .order("show_start", { ascending: true })
      .limit(90),
    supabase.from("crew").select("id", { count: "exact", head: true }).neq("onboarding_status", "pending_contact"),
    supabase.from("city_pools").select("id", { count: "exact", head: true }),
    role === "owner" || role === "admin"
      ? supabase
          .from("client_feedback_responses")
          .select("id", { count: "exact", head: true })
          .or("rating_approved.is.null,rating_approved.eq.false")
          .or("excluded_from_ratings.is.null,excluded_from_ratings.eq.false")
      : Promise.resolve({ count: 0, error: null }),
  ]);

  const setupMissing = Boolean(showsRes.error?.message.includes('relation "shows" does not exist') || crewCountRes.error?.message.includes('relation "crew" does not exist'));
  const feedbackMissing = Boolean(feedbackCountRes.error && /client_feedback_responses|schema cache|relation/i.test(feedbackCountRes.error.message || ""));
  const error = setupMissing ? null : showsRes.error || crewCountRes.error || cityPoolCountRes.error || (feedbackMissing ? null : feedbackCountRes.error);
  if (error) return emptyOverview(false, error.message);

  const showRows = (showsRes.data ?? []) as Array<{
    id: string;
    name?: string | null;
    client?: string | null;
    venue?: string | null;
    event_location?: string | null;
    rate_city?: string | null;
    show_start?: string | null;
    show_end?: string | null;
    created_by?: string | null;
    assigned_coordinator_user_id?: string | null;
  }>;

  let visibleShowIds = new Set(showRows.map((show) => show.id));
  if (restrictEventsToOwner) {
    const initialVisibleIds = new Set(
      showRows
        .filter((show) => show.created_by === currentUserId || userAccessIds.includes(String(show.assigned_coordinator_user_id || "")))
        .map((show) => show.id)
    );
    const showIds = showRows.map((show) => show.id);
    if (showIds.length) {
      const accessRes = await supabase
        .from("event_user_access")
        .select("show_id, user_id, user_profile_id")
        .in("show_id", showIds);
      if (!accessRes.error) {
        for (const row of accessRes.data ?? []) {
          const typed = row as { show_id?: string | null; user_id?: string | null; user_profile_id?: string | null };
          if (userAccessIds.includes(String(typed.user_id || "")) || userAccessIds.includes(String(typed.user_profile_id || ""))) {
            initialVisibleIds.add(String(typed.show_id || ""));
          }
        }
      }
    }
    visibleShowIds = initialVisibleIds;
  }

  const visibleShowRows = showRows.filter((show) => visibleShowIds.has(show.id));
  const calendarDatesByShowId = new Map<string, string[]>();
  const visibleIds = visibleShowRows.map((show) => show.id);
  if (visibleIds.length) {
    const laborDaysRes = await supabase
      .from("labor_days")
      .select("id, show_id, labor_date")
      .in("show_id", visibleIds)
      .order("labor_date", { ascending: true })
      .limit(500);
    if (!laborDaysRes.error) {
      const dayRows = (laborDaysRes.data ?? []) as Array<{ id?: string | null; show_id?: string | null; labor_date?: string | null }>;
      const dayToShow = new Map(dayRows.map((day) => [String(day.id || ""), String(day.show_id || "")]));
      const dayToDate = new Map(dayRows.map((day) => [String(day.id || ""), cleanDateKey(day.labor_date)]));
      const dayIds = dayRows.map((day) => String(day.id || "")).filter(Boolean);
      const subCallsRes = dayIds.length
        ? await supabase.from("sub_calls").select("labor_day_id").in("labor_day_id", dayIds).limit(2000)
        : { data: [], error: null };
      if (!subCallsRes.error) {
        const seenDayIds = new Set((subCallsRes.data ?? []).map((row) => String((row as { labor_day_id?: string | null }).labor_day_id || "")).filter(Boolean));
        for (const dayId of seenDayIds) {
          const showId = dayToShow.get(dayId) || "";
          const date = dayToDate.get(dayId) || "";
          if (!showId || !date) continue;
          const dates = calendarDatesByShowId.get(showId) ?? [];
          if (!dates.includes(date)) dates.push(date);
          calendarDatesByShowId.set(showId, dates);
        }
      }
    }
  }

  const shows = visibleShowRows
    .map((show) => ({
      id: show.id,
      name: show.name || "",
      client: show.client || "",
      business_client_id: null,
      client_contact_id: null,
      coordinator_contact_id: null,
      assigned_coordinator_user_id: show.assigned_coordinator_user_id || null,
      venue: show.venue || "",
      event_location: show.event_location || "",
      rate_city: show.rate_city || "Default",
      show_start: show.show_start || "",
      show_end: show.show_end || show.show_start || "",
      notes: "",
      created_by: show.created_by || null,
      access_scope: "full",
      calendar_dates: (calendarDatesByShowId.get(show.id) ?? []).sort(),
    })) satisfies OverviewShow[];

  return {
    shows,
    crewCount: crewCountRes.count ?? 0,
    cityPoolCount: cityPoolCountRes.count ?? 0,
    pendingFeedbackCount: feedbackMissing ? 0 : feedbackCountRes.count ?? 0,
    setupMissing,
    error: null,
  };
}

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

function showTouchesDate(show: OverviewShow, dayKey: string) {
  if (Array.isArray(show.calendar_dates)) return show.calendar_dates.includes(dayKey);
  const start = cleanDateKey(show.show_start);
  const end = cleanDateKey(show.show_end) || start;
  return Boolean(start && end && start <= dayKey && end >= dayKey);
}

function buildCalendar(baseDate: Date, shows: OverviewShow[]) {
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

function EventMiniList({ title, shows, status }: { title: string; shows: OverviewShow[]; status: "current" | "upcoming" }) {
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

function MonthCalendar({ date, shows, today }: { date: Date; shows: OverviewShow[]; today: string }) {
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
  const overviewData = await getOverviewData(session);
  const today = dateKeyFromDate(new Date());
  const shows = overviewData.shows ?? [];
  const upcomingShows = shows.filter((show) => eventStatus(show, today) === "upcoming").sort((a, b) => cleanDateKey(a.show_start).localeCompare(cleanDateKey(b.show_start)));
  const currentShows = shows.filter((show) => eventStatus(show, today) === "current").sort((a, b) => cleanDateKey(a.show_start).localeCompare(cleanDateKey(b.show_start)));
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const role = String(session.profile?.role || "viewer");
  const isOwnerAdmin = role === "owner" || role === "admin";
  const pendingFeedbackCount = overviewData.pendingFeedbackCount;

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
        <div className="card compact"><div className="muted small">Crew records</div><strong style={{ fontSize: 30 }}>{overviewData.setupMissing ? "—" : overviewData.crewCount ?? 0}</strong><div className="muted small">{overviewData.setupMissing ? "Setup missing" : `${overviewData.cityPoolCount ?? 0} city pools`}</div></div>
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

      {overviewData.error ? <p className="error">{overviewData.error}</p> : null}

      <section className="grid grid-2">
        <MonthCalendar date={new Date()} shows={shows} today={today} />
        <MonthCalendar date={nextMonth} shows={shows} today={today} />
      </section>
    </div>
  );
}
