import { requirePage } from "@/lib/auth";
import { getPayrollPageData } from "@/lib/payroll-data";
import PayrollClient from "./payroll-client";

export default async function PayrollPage() {
  const session = await requirePage("payroll");
  const { crewRows, availableYears, setupMissing, error } = await getPayrollPageData();

  if (setupMissing) {
    return (
      <div className="card">
        <h2>Payroll</h2>
        <p className="muted">Supabase environment variables are missing, so Payroll cannot load yet.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row">
          <div>
            <h2 style={{ marginBottom: 6 }}>Payroll</h2>
            <p className="muted" style={{ margin: 0 }}>
              Track event payouts by tech, mark each person paid or unpaid, and keep year-end paid totals for 1099 preparation.
            </p>
          </div>
          <div className="small muted">
            Signed in as <strong>{session.profile?.full_name || session.user?.email}</strong>
          </div>
        </div>
      </section>
      <PayrollClient initialRows={crewRows} availableYears={availableYears} initialError={error} />
    </div>
  );
}
