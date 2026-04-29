import { requireUser } from "@/lib/auth";
import { getCrewPageData } from "@/lib/crew-data";
import { getEventsPageData } from "@/lib/events-data";
import EventsClient from "./events-client";

export default async function EventsPage() {
  const session = await requireUser();
  const { shows, laborDays, subCalls, assignments, masterRates, setupMissing, error } = await getEventsPageData();
  const { crewRecords } = await getCrewPageData();

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
            <p className="muted" style={{ margin: 0 }}>
              Review events as event → labor day → sub-call → assigned crew, preview imports before saving, merge into existing events when needed, and export clean crew lists.
            </p>
          </div>
          <div className="small muted">
            Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>
          </div>
        </div>
        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>
      <EventsClient
        initialShows={shows}
        initialLaborDays={laborDays}
        initialSubCalls={subCalls}
        initialAssignments={assignments}
        initialCrew={crewRecords}
        masterRates={masterRates}
      />
    </div>
  );
}
