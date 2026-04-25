import { requireUser } from "@/lib/auth";
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
            <h2 style={{ marginBottom: 6 }}>Master Rates</h2>
            <p className="muted" style={{ margin: 0 }}>
              Manage what you pay crew. Keep one default pay card, then apply city-specific overrides only where a market pays differently.
            </p>
          </div>
          <div className="small muted">Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong></div>
        </div>
        <div className="toolbar" style={{ marginTop: 14 }}>
          <span className="badge">Crew pay master card</span>
          <span className="badge">City overrides</span>
          <span className="badge">Edit all positions in one place</span>
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
