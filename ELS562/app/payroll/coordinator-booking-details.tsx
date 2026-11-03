import type { CoordinatorOrderLine } from "@/lib/coordinator-purchase-order-types";

export function CoordinatorBookingDetails({ line }: { line: CoordinatorOrderLine }) {
  if (!line.technicians) return <p className="small muted">Technician details were not saved for this version.</p>;
  if (!line.technicians.length) return <p className="small muted">No individual booking credits; coordinator pay may include a manual agreement adjustment.</p>;
  return <div style={{ marginTop: 8 }}><div className="small muted">Technician booking dates</div>{line.technicians.map((tech) => <div key={tech.crewId} style={{ marginTop: 6 }}><strong>{tech.crewName}</strong>{tech.dates.map((date, index) => <div className="small" key={index}>{date}</div>)}</div>)}</div>;
}
