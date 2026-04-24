import { requireRole, requireUser } from "@/lib/auth";
import { getRatesPageData } from "@/lib/rates-data";
import MasterRatesClient from "./master-rates-client";

export default async function SettingsPage() {
  const session = await requireUser();
  const { cityPools, masterRates, setupMissing, error } = await getRatesPageData();
  const role = session.profile?.role as string | undefined;
  const canManage = role === "owner" || role === "admin";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Settings</h2>
            <p className="muted" style={{ margin: 0 }}>
              Manage the ELS master rate card and apply city-specific overrides when a market needs different pricing.
            </p>
          </div>
          <div className="small muted">Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong></div>
        </div>
        {setupMissing ? <p className="error" style={{ marginTop: 12 }}>Supabase environment variables are missing, so Settings cannot load yet.</p> : null}
        {!setupMissing && error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>
      {!setupMissing && !error ? (
        <MasterRatesClient cityPools={cityPools} initialRates={masterRates} canManage={canManage} />
      ) : null}
    </div>
  );
}
