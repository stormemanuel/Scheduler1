import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { getRatesPageData } from "@/lib/rates-data";
import MasterRatesClient from "./master-rates-client";

export default async function SettingsPage() {
  const session = await requirePage("settings");
  const { cityPools, masterRates, clientRates, clientRatesMissing, setupMissing, error } = await getRatesPageData();
  const role = session.profile?.role as string | undefined;
  const canManage = role === "owner" || role === "admin";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Master Rates</h2>
            <p className="muted" style={{ margin: 0 }}>
              Manage what you pay crew and what you bill clients. Keep default rate cards, then apply city-specific overrides only where a market pays or bills differently.
            </p>
          </div>
          <div className="small muted">Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong></div>
        </div>
        <div className="toolbar" style={{ marginTop: 14 }}>
          <span className="badge">Crew pay master card</span>
          <span className="badge">Client billing master card</span>
          <span className="badge">City overrides</span>
        </div>
        {setupMissing ? <p className="error" style={{ marginTop: 12 }}>Supabase environment variables are missing, so Settings cannot load yet.</p> : null}
        {!setupMissing && error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}
      </section>

      <section className="card color-system-card compact">
        <div className="row">
          <div>
            <h3>Color coordination</h3>
            <p className="muted small" style={{ margin: 0 }}>
              ELS61 applies a cleaner brand system across the app: deep teal for core operations, gold for priority/upcoming work, green for confirmed/current, blue for information, amber for follow-up, and red only for risk or delete actions.
            </p>
          </div>
          <span className="badge">Accessible contrast</span>
        </div>
        <div className="color-swatch-grid" aria-label="ELS app color system">
          <div className="color-swatch swatch-brand"><strong>Operations / Primary</strong><span>#042126 → #11505A</span></div>
          <div className="color-swatch swatch-gold"><strong>Priority / Upcoming</strong><span>#F4C542</span></div>
          <div className="color-swatch swatch-success"><strong>Confirmed / Current</strong><span>#067647</span></div>
          <div className="color-swatch swatch-info"><strong>Information</strong><span>#0369A1</span></div>
          <div className="color-swatch swatch-warning"><strong>Follow-up / Attention</strong><span>#B7791F</span></div>
          <div className="color-swatch swatch-danger"><strong>Risk / Delete only</strong><span>#B42318</span></div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Booth and area cards use a separate high-contrast palette so adjacent areas are easier to tell apart in Events, feedback forms, and exports.
        </p>
      </section>
      {canManage ? (
        <section className="card compact">
          <div className="row">
            <div>
              <h3>User access settings</h3>
              <p className="muted small" style={{ margin: 0 }}>Control Admin, Coordinator, and Salesman page access, crew-pool permissions, and ownership limits.</p>
            </div>
            <Link className="button primary" href="/users">Open user access</Link>
          </div>
        </section>
      ) : null}
      {!setupMissing && !error ? (
        <MasterRatesClient cityPools={cityPools} initialRates={masterRates} initialClientRates={clientRates} clientRatesMissing={clientRatesMissing} canManage={canManage} />
      ) : null}
    </div>
  );
}
