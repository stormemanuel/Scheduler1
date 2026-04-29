import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import InviteUserForm from "./invite-user-form";

export default async function UsersPage() {
  await requireRole(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  let profiles: Array<{ id: string; email: string | null; full_name: string | null; role: string | null; is_active: boolean | null }> = [];
  let setupError: string | null = null;

  if (!admin) {
    setupError = "SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel before using the Users page.";
  } else {
    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, role, is_active")
      .order("created_at", { ascending: true });

    if (error) setupError = error.message;
    else profiles = data ?? [];
  }

  return (
    <div className="grid grid-2">
      <section className="card">
        <h2>Users</h2>
        <p className="muted">Add users, assign roles, and control who can access the ELS scheduler.</p>
        {setupError ? <p className="error">{setupError}</p> : null}
        <div className="list">
          {profiles.map((profile) => (
            <div key={profile.id} className="card compact">
              <div className="row">
                <div>
                  <strong>{profile.full_name || profile.email || profile.id}</strong>
                  <div className="muted small">{profile.email || "No email"}</div>
                </div>
                <div className="small">
                  <span className="badge">{profile.role || "viewer"}</span>
                  <span className="badge">{profile.is_active ? "Active" : "Inactive"}</span>
                </div>
              </div>
            </div>
          ))}
          {!profiles.length && !setupError ? <p className="muted small">No users found yet.</p> : null}
        </div>
      </section>
      <section className="card">
        <h2>Invite user</h2>
        <p className="muted small">This sends a Supabase invite email and creates a matching profile row.</p>
        <InviteUserForm />
      </section>
    </div>
  );
}
