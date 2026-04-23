import { hasSupabaseEnv } from "@/lib/supabase";
import LoginForm from "./login-form";

export default function LoginPage() {
  const ready = hasSupabaseEnv();

  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>Sign in</h2>
        <p className="muted">Use your Emanuel Labor Services user account to access Crew, Events, Payroll, and Settings.</p>
        {ready ? <LoginForm /> : (
          <div className="code small">
            Add these environment variables before login will work:


            NEXT_PUBLIC_SUPABASE_URL

            NEXT_PUBLIC_SUPABASE_ANON_KEY

            SUPABASE_SERVICE_ROLE_KEY
          </div>
        )}
      </section>
      <section className="card">
        <h2>User access model</h2>
        <ul className="small">
          <li><strong>Owner</strong> — full access, user management, data administration.</li>
          <li><strong>Admin</strong> — operations and user invites.</li>
          <li><strong>Coordinator</strong> — crew, events, and payroll edits.</li>
          <li><strong>Viewer</strong> — read-only access.</li>
        </ul>
      </section>
    </div>
  );
}
