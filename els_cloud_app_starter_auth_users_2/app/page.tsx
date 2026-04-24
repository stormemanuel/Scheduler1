import { requireUser } from "@/lib/auth";
import { cityPools, crew, shows, payrollRows } from "@/lib/mock-data";

export default async function HomePage() {
  const session = await requireUser();

  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>Welcome back</h2>
        <p className="muted">
          Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>. This scaffold now includes login, protected routes, and admin-managed users.
        </p>
        <div>
          <span className="badge">Shared cloud database</span>
          <span className="badge">Protected app shell</span>
          <span className="badge">Users + roles</span>
          <span className="badge">Mac + iPhone</span>
        </div>
      </section>
      <section className="card">
        <h2>Seed summary</h2>
        <div className="list small">
          <div className="row"><strong>City pools</strong><span>{cityPools.length}</span></div>
          <div className="row"><strong>Crew records</strong><span>{crew.length}</span></div>
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
          <li>Starter shell still ready for real crew / events / payroll queries.</li>
        </ol>
      </section>
      <section className="card">
        <h2>Next data pass</h2>
        <p className="muted small">
          After auth is working, the next step is replacing mock reads with Supabase queries and loading New Orleans, Nashville, and Atlanta into the database.
        </p>
      </section>
    </div>
  );
}
