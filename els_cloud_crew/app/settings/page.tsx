import { requireUser } from "@/lib/auth";

export default async function SettingsPage() {
  await requireUser();

  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>Environment</h2>
        <div className="code small">
          NEXT_PUBLIC_SUPABASE_URL=...<br />
          NEXT_PUBLIC_SUPABASE_ANON_KEY=...<br />
          SUPABASE_SERVICE_ROLE_KEY=...
        </div>
      </section>
      <section className="card">
        <h2>Auth + users checklist</h2>
        <ul className="small">
          <li>Run the updated schema.</li>
          <li>Create your first Auth user in Supabase.</li>
          <li>Create a matching profile row with role <span className="code">owner</span>.</li>
          <li>Use the Users page to invite more people.</li>
        </ul>
      </section>
    </div>
  );
}
