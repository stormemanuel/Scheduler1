import { requirePage } from "@/lib/auth";
import PayrollClient from "./payroll-client";

export default async function PayrollPage() {
  const session = await requirePage("payroll");
  const currentYear = new Date().getFullYear();

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
      <PayrollClient initialRows={[]} availableYears={[currentYear]} initialYear={currentYear} initialError={null} />
    </div>
  );
}
