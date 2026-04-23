import { crew, payrollRows, shows } from "@/lib/mock-data";

export default function PayrollPage() {
  return (
    <div className="card">
      <h2>Show payroll starter</h2>
      <div className="list">
        {shows.map((show) => {
          const rows = payrollRows.filter((row) => row.showId === show.id);
          const total = rows.reduce((sum, row) => sum + row.baseEstimate, 0);
          return (
            <div key={show.id} className="card">
              <div className="row">
                <strong>{show.name}</strong>
                <span>${total.toFixed(2)} est.</span>
              </div>
              <div className="list" style={{ marginTop: 10 }}>
                {rows.map((row) => {
                  const member = crew.find((item) => item.id === row.crewId);
                  return (
                    <div key={row.id} className="row small">
                      <span>{member?.name || row.crewId} • {row.role}</span>
                      <span>{row.payType} • {row.paid ? "Paid" : "Unpaid"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
