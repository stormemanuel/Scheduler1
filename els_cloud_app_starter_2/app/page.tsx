import { cityPools, crew, shows, payrollRows } from "@/lib/mock-data";

export default function HomePage() {
  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>What this starter is</h2>
        <p className="muted">
          This is the hosted version path: one responsive app, one shared Supabase backend, and one domain for Mac and phone.
        </p>
        <div>
          <span className="badge">Shared cloud database</span>
          <span className="badge">Realtime-ready</span>
          <span className="badge">Mac + iPhone</span>
          <span className="badge">City pools + groups</span>
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
        <h2>Next steps inside the codebase</h2>
        <ol className="small">
          <li>Run the SQL in <span className="code">supabase/schema.sql</span>.</li>
          <li>Add your Supabase URL and anon key to <span className="code">.env.local</span>.</li>
          <li>Replace mock data with real Supabase queries.</li>
          <li>Deploy to Vercel and connect <span className="code">app.emanuel-labor-services.com</span>.</li>
        </ol>
      </section>
      <section className="card">
        <h2>Restoring New Orleans / Nashville / Atlanta</h2>
        <p className="muted small">
          This starter includes city pools for all three markets. The next data pass should seed your real crew list into Supabase so both Mac and phone read the same crew source.
        </p>
      </section>
    </div>
  );
}
