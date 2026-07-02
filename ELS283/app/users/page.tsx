import { requireRole, pageHrefByKey, pageLabelByKey, type AppPageKey } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import InviteUserForm, { LiveUserActivityPanel, ViewAsUserButton } from "./invite-user-form";
import { updateUserAccessAction } from "./actions";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  is_active: boolean | null;
};

type AccessRow = {
  user_id: string;
  allowed_pages: AppPageKey[] | null;
  restrict_events_to_owner: boolean | null;
  restrict_crew_to_owner: boolean | null;
  allowed_city_pool_ids: string[] | null;
  can_edit_event_details?: boolean | null;
};

type CityPoolRow = { id: string; name: string };
type CoordinatorRatingRow = { user_id: string; rated_show_count: number | null; coordinator_rating: number | null; median_show_rating: number | null; last_show_at: string | null };

const pageKeys: AppPageKey[] = ["overview", "coordinator", "events", "crew", "clients", "pipelines", "payroll", "users", "settings"];

const roleOptions = [
  { value: "owner", label: "Owner", help: "Full access. Use sparingly." },
  { value: "admin", label: "Admin", help: "Full app management access." },
  { value: "coordinator", label: "Coordinator", help: "Events and crew, limited by access settings." },
  { value: "salesman", label: "Salesman", help: "Sales Pipeline only by default." },
  { value: "viewer", label: "Viewer", help: "Read-only/light access by default." },
];

function normalizeRoleForDisplay(role: string | null | undefined) {
  const value = String(role || "viewer").toLowerCase().trim();
  if (value === "sales") return "salesman";
  return value;
}

function defaultPages(role: string): AppPageKey[] {
  if (role === "owner" || role === "admin") return pageKeys;
  if (role === "salesman" || role === "sales") return ["pipelines"];
  if (role === "coordinator") return ["overview", "coordinator", "events", "crew"];
  return ["overview"];
}

function defaultRestricted(role: string) {
  return role === "coordinator" || role === "salesman" || role === "sales" || role === "viewer";
}

export default async function UsersPage() {
  const session = await requireRole(["owner", "admin"]);
  const admin = createSupabaseAdminClient();

  let profiles: ProfileRow[] = [];
  let accessRows: AccessRow[] = [];
  let cityPools: CityPoolRow[] = [];
  let coordinatorRatings: CoordinatorRatingRow[] = [];
  let setupError: string | null = null;

  if (!admin) {
    setupError = "SUPABASE_SERVICE_ROLE_KEY is missing. Add it in Vercel before using the Users page.";
  } else {
    const [profilesRes, accessResInitial, poolsRes, coordinatorRatingsRes] = await Promise.all([
      admin.from("profiles").select("id, email, full_name, role, is_active").order("created_at", { ascending: true }),
      admin.from("user_access_settings").select("user_id, allowed_pages, restrict_events_to_owner, restrict_crew_to_owner, allowed_city_pool_ids, can_edit_event_details"),
      admin.from("city_pools").select("id, name").order("name", { ascending: true }),
      admin.from("coordinator_performance_rollup").select("user_id, rated_show_count, coordinator_rating, median_show_rating, last_show_at"),
    ]);

    let accessRes = accessResInitial;
    if (accessResInitial.error && accessResInitial.error.message.includes("can_edit_event_details")) {
      accessRes = await admin.from("user_access_settings").select("user_id, allowed_pages, restrict_events_to_owner, restrict_crew_to_owner, allowed_city_pool_ids");
    }

    if (profilesRes.error) setupError = profilesRes.error.message;
    else profiles = (profilesRes.data ?? []) as ProfileRow[];

    if (accessRes.error && !setupError) setupError = `User access table issue: ${accessRes.error.message}`;
    else accessRows = (accessRes.data ?? []) as AccessRow[];

    if (poolsRes.error && !setupError) setupError = `Crew pool load issue: ${poolsRes.error.message}`;
    else cityPools = (poolsRes.data ?? []) as CityPoolRow[];

    if (!coordinatorRatingsRes.error) coordinatorRatings = (coordinatorRatingsRes.data ?? []) as CoordinatorRatingRow[];
  }

  const accessByUser = new Map(accessRows.map((row) => [row.user_id, row]));
  const coordinatorRatingByUser = new Map(coordinatorRatings.map((row) => [row.user_id, row]));

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2>Users & access</h2>
            <p className="muted" style={{ margin: 0 }}>
              Set each user as Admin, Coordinator, or Salesman, then limit exactly which pages, events, crew, and pools they can access.
            </p>
          </div>
        </div>
        {setupError ? <p className="error" style={{ marginTop: 12 }}>{setupError}</p> : null}
      </section>

      <section className="grid grid-3">
        <div className="card compact accent-card">
          <strong>Admin</strong>
          <div className="small muted">Full access to all pages, payroll, users, settings, events, crew, clients, and sales.</div>
        </div>
        <div className="card compact accent-card">
          <strong>Coordinator</strong>
          <div className="small muted">Overview, Events, and Crew only by default. No client directory access unless you intentionally grant it.</div>
        </div>
        <div className="card compact accent-card">
          <strong>Salesman</strong>
          <div className="small muted">Sales Pipeline only by default. Other pages stay hidden and blocked unless you grant access.</div>
        </div>
      </section>

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <section className="card">
          <h2>Create / invite user</h2>
          <p className="muted small">Create a login with a temporary password for testing, or leave password blank to send a normal email invite. You can fine-tune page and pool access afterward.</p>
          <InviteUserForm />
        </section>

        <section className="card">
          <h2>Access rules</h2>
          <div className="list small muted">
            <p><strong>Salesman:</strong> starts with Sales Pipeline only. Events, Crew, Payroll, Clients, Users, and Settings are empty/blocked.</p>
            <p><strong>Coordinator:</strong> starts with Overview, Events, and Crew only. Client directory access stays off unless you intentionally grant it, and coordinator client records stay scoped to what they created.</p>
            <p><strong>Admin:</strong> can manage the full system. Use Admin only for trusted office leadership.</p>
          </div>
        </section>
      </div>

      <LiveUserActivityPanel />

      <section className="card">
        <h2>Current users</h2>
        <p className="muted small">Edit role, page access, coordinator restrictions, and optional temporary password resets. Save each card separately.</p>
        <div className="list">
          {profiles.map((profile) => {
            const role = normalizeRoleForDisplay(profile.role);
            const access = accessByUser.get(profile.id);
            const selectedPages = new Set(access?.allowed_pages?.length ? access.allowed_pages : defaultPages(role));
            const restrictEvents = access?.restrict_events_to_owner ?? defaultRestricted(role);
            const restrictCrew = access?.restrict_crew_to_owner ?? defaultRestricted(role);
            const selectedPools = new Set(access?.allowed_city_pool_ids ?? []);
            const canEditEventDetails = Boolean(access?.can_edit_event_details);

            return (
              <form key={profile.id} action={async (formData) => {
                "use server";
                await updateUserAccessAction(formData);
              }} className="card compact" style={{ gap: 14 }}>
                <input type="hidden" name="userId" value={profile.id} />
                <div className="row">
                  <div>
                    <strong>{profile.full_name || profile.email || profile.id}</strong>
                    <div className="muted small">{profile.email || "No email"}</div>
                    <div className="small" style={{ marginTop: 6 }}>
                      <span className="badge">{role === "salesman" ? "Salesman" : role}</span>
                      <span className="badge">{profile.is_active ? "Active" : "Inactive"}</span>
                    </div>
                  </div>
                  <div className="toolbar">
                    <a className="ghost" href={`#activity-${profile.id}`}>Live activity</a>
                    <ViewAsUserButton
                      userId={profile.id}
                      userName={profile.full_name || profile.email || "this user"}
                      disabled={profile.id === session.user?.id || profile.is_active === false}
                    />
                  </div>
                </div>
                {(() => {
                  const coordinatorRating = coordinatorRatingByUser.get(profile.id);
                  if (!coordinatorRating || !Number(coordinatorRating.rated_show_count || 0)) return null;
                  return (
                    <div className="card compact accent-card">
                      <strong>Coordinator performance</strong>
                      <div className="small muted">Based on the median crew rating from each assigned event.</div>
                      <div className="toolbar small" style={{ marginTop: 8 }}>
                        <span className="badge">Overall {Number(coordinatorRating.coordinator_rating || 0).toFixed(1)}★</span>
                        <span className="badge">Median show {Number(coordinatorRating.median_show_rating || 0).toFixed(1)}★</span>
                        <span className="badge">{Number(coordinatorRating.rated_show_count || 0)} rated show{Number(coordinatorRating.rated_show_count || 0) === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                  );
                })()}

                <div className="grid grid-3">
                  <label className="field">
                    <span>Full name</span>
                    <input name="fullName" defaultValue={profile.full_name || ""} />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input name="email" type="email" defaultValue={profile.email || ""} />
                  </label>
                  <label className="field">
                    <span>Role</span>
                    <select name="role" defaultValue={role}>
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="checkbox-line">
                  <input type="checkbox" name="isActive" defaultChecked={Boolean(profile.is_active)} />
                  <span>Active user</span>
                </label>

                <div className="card compact accent-card">
                  <h3 style={{ marginBottom: 8 }}>Temporary password reset</h3>
                  <label className="field">
                    <span>New temporary password</span>
                    <input name="temporaryPassword" type="text" minLength={8} placeholder="Optional — only fill this when resetting" autoComplete="off" />
                  </label>
                  <p className="muted small" style={{ marginBottom: 0 }}>
                    Leave blank to keep their current password. If filled, the user can sign in with this temporary password and change it from Account.
                  </p>
                </div>

                <div>
                  <h3 style={{ marginBottom: 8 }}>Page access</h3>
                  <div className="permission-grid">
                    {pageKeys.map((page) => (
                      <label key={page} className="checkbox-card">
                        <input type="checkbox" name="allowedPages" value={page} defaultChecked={selectedPages.has(page)} />
                        <span>
                          <strong>{pageLabelByKey[page]}</strong>
                          <small>{pageHrefByKey[page]}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 style={{ marginBottom: 8 }}>Coordinator restrictions</h3>
                  <div className="grid grid-2">
                    <label className="checkbox-card">
                      <input type="checkbox" name="restrictEventsToOwner" defaultChecked={restrictEvents} />
                      <span>
                        <strong>Only events they build</strong>
                        <small>Hide other events unless separately shared.</small>
                      </span>
                    </label>
                    <label className="checkbox-card">
                      <input type="checkbox" name="restrictCrewToOwner" defaultChecked={restrictCrew} />
                      <span>
                        <strong>Only crew they add / allowed pools</strong>
                        <small>Do not expose your full labor pool unless granted.</small>
                      </span>
                    </label>
                    <label className="checkbox-card">
                      <input type="checkbox" name="canEditEventDetails" defaultChecked={canEditEventDetails} />
                      <span>
                        <strong>Can edit event details</strong>
                        <small>Optional. Lets a coordinator create/edit events, labor days, sub-calls, and imports. Off by default.</small>
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <h3 style={{ marginBottom: 8 }}>Allowed crew pools</h3>
                  {cityPools.length ? (
                    <div className="permission-grid">
                      {cityPools.map((pool) => (
                        <label key={pool.id} className="checkbox-card">
                          <input type="checkbox" name="allowedCityPoolIds" value={pool.id} defaultChecked={selectedPools.has(pool.id)} />
                          <span><strong>{pool.name}</strong><small>Grant pool access</small></span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="muted small">No city/pool records found yet.</p>
                  )}
                </div>

                <div className="row">
                  <button type="submit" className="primary">Save access</button>
                  <p className="muted small" style={{ margin: 0 }}>
                    Leave temporary password blank unless you are intentionally creating or resetting login access.
                  </p>
                </div>
              </form>
            );
          })}
          {!profiles.length && !setupError ? <p className="muted small">No users found yet.</p> : null}
        </div>
      </section>
    </div>
  );
}
