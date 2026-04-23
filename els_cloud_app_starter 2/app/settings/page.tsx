export default function SettingsPage() {
  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>Environment</h2>
        <div className="code small">
          NEXT_PUBLIC_SUPABASE_URL=...
          <br />
          NEXT_PUBLIC_SUPABASE_ANON_KEY=...
        </div>
      </section>
      <section className="card">
        <h2>Production targets</h2>
        <ul className="small">
          <li>Production app: app.emanuel-labor-services.com</li>
          <li>Mac: install site as a web app from browser</li>
          <li>iPhone: add site to Home Screen</li>
        </ul>
      </section>
    </div>
  );
}
