import { requireUser } from "@/lib/auth";
import { crew } from "@/lib/mock-data";

export default async function CrewPage() {
  await requireUser();

  return (
    <div className="card">
      <h2>Crew starter</h2>
      <p className="muted">This page is the cloud-ready replacement for your local Crew board.</p>
      <div className="list">
        {crew.map((member) => (
          <div key={member.id} className="card">
            <div className="row">
              <div>
                <strong>{member.name}</strong>
                <div className="muted small">{member.city} • {member.group} • Tier {member.tier}</div>
              </div>
              <div className="small muted">{member.email}</div>
            </div>
            <div style={{ marginTop: 12 }}>
              {member.positions.map((position) => (
                <span key={`${member.id}-${position.role}`} className="badge">
                  {position.role}: ${position.rate}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
