import { requireUser } from "@/lib/auth";
import { getCrewPageData } from "@/lib/crew-data";
import CrewClient from "./crew-client";

export default async function CrewPage() {
  const session = await requireUser();
  const { cityPools, crewRecords, setupMissing, error } = await getCrewPageData();

  if (setupMissing) {
    return (
      <div className="card">
        <h2>Crew</h2>
        <p className="muted">Supabase environment variables are missing, so Crew cannot load yet.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Crew</h2>
            <p className="muted" style={{ margin: 0 }}>
              Search, add, edit, move, and organize crew across New Orleans, Nashville, and Atlanta.
            </p>
          </div>
          <div className="small muted">
            Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>
          </div>
        </div>
        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>
      <CrewClient cityPools={cityPools} initialCrew={crewRecords} />
    </div>
  );
}
