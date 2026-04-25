import { requireUser } from "@/lib/auth";
import { getEventsPageData } from "@/lib/events-data";
import EventsClient from "./events-client";

export default async function EventsPage() {
  const session = await requireUser();
  const { shows, laborDays, subCalls, masterRates, setupMissing, error } = await getEventsPageData();

  if (setupMissing) {
    return (
      <div className="card">
        <h2>Events</h2>
        <p className="muted">Supabase environment variables are missing, so Events cannot load yet.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Events</h2>
            <p className="muted" style={{ margin: 0 }}>Build each show from show span to labor days to sub-calls, and see a rough estimated crew payout for the event.</p>
          </div>
          <div className="small muted">Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong></div>
        </div>
        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>
      <EventsClient initialShows={shows} initialLaborDays={laborDays} initialSubCalls={subCalls} masterRates={masterRates} />
    </div>
  );
}
