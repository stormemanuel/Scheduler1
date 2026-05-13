import { requireUser } from "@/lib/auth";
import { getCrewPageData } from "@/lib/crew-data";
import { shows, payrollRows } from "@/lib/mock-data";

export default async function HomePage() {
  const session = await requireUser();
  const { cityPools, crewRecords, setupMissing } = await getCrewPageData();

  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>Welcome back</h2>
        <p className="muted">
          Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>. The cloud app now has live auth, users, and a Supabase-backed Crew workspace.
        </p>
        <div>
          <span className="badge">Shared cloud database</span>
          <span className="badge">Protected app shell</span>
          <span className="badge">Users + roles</span>
          <span className="badge">Crew connected</span>
        </div>
      </section>
      <section className="card">
        <h2>Current system status</h2>
        <div className="list small">
          <div className="row"><strong>City pools</strong><span>{setupMissing ? "—" : cityPools.length}</span></div>
          <div className="row"><strong>Crew records</strong><span>{setupMissing ? "—" : crewRecords.length}</span></div>
          <div className="row"><strong>Shows</strong><span>{shows.length}</span></div>
          <div className="row"><strong>Payroll rows</strong><span>{payrollRows.length}</span></div>
        </div>
      </section>
      <section className="card">
        <h2>What is ready now</h2>
        <ol className="small">
          <li>Protected routes using Supabase Auth.</li>
          <li>Profiles table with roles.</li>
          <li>Admin Users page for invitations.</li>
          <li>Supabase-backed Crew page with add, edit, search, and move tools.</li>
        </ol>
      </section>
      <section className="card">
        <h2>Next build targets</h2>
        <p className="muted small">
          Events and Payroll still use placeholder data. Once Crew is confirmed, the next step is wiring Shows, Labor Days, Sub-Calls, and Show Payroll to Supabase too.
        </p>
      </section>
    </div>
  );
}
