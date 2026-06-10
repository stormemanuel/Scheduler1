import Link from "next/link";
import { requirePage, normalizeRole } from "@/lib/auth";
import { getEventsPageData } from "@/lib/events-data";
import { money, formatPayrollDate } from "@/lib/payroll-calculations";
import type { ShowRecord, SubCallRecord, AssignmentRecord, LaborDayRecord } from "@/lib/events-types";
import type { AppUserSummaryRecord } from "@/lib/client-types";

type FeeBreakdown = { fullDayTechDays: number; halfDayTechs: number; fullDayFee: number; halfDayFee: number; total: number };

function cleanDate(value: string | null | undefined) { return String(value || "").slice(0, 10); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function safeText(value: unknown, fallback = "") { const text = String(value ?? "").trim(); return text || fallback; }
function timeMinutes(value: string | null | undefined) { const m = String(value || "").match(/^(\d{1,2}):(\d{2})/); if (!m) return null; return Number(m[1]) * 60 + Number(m[2]); }
function durationHours(call: Pick<SubCallRecord, "start_time" | "end_time" | "one_hour_walkaway">) {
  const start = timeMinutes(call.start_time); const end = timeMinutes(call.end_time);
  if (start === null || end === null) return null;
  let diff = end - start; if (diff <= 0) diff += 24 * 60;
  return Math.max(0, diff / 60 - (call.one_hour_walkaway ? 1 : 0));
}
function isHalfDay(call: SubCallRecord) {
  const dayType = safeText(call.day_type).toLowerCase();
  if (dayType.includes("half")) return true;
  if (dayType.includes("full")) return false;
  const hours = durationHours(call);
  return hours !== null && hours <= 5;
}
function marginalFee(count: number, tiers: Array<{ through: number | null; rate: number }>) {
  let remaining = Math.max(0, Math.floor(count)); let previous = 0; let total = 0;
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const span = tier.through === null ? remaining : Math.max(0, tier.through - previous);
    const units = Math.min(remaining, span);
    total += units * tier.rate;
    remaining -= units;
    if (tier.through !== null) previous = tier.through;
  }
  return Math.round(total * 100) / 100;
}
function coordinatorFee(fullDayTechDays: number, halfDayTechs: number): FeeBreakdown {
  const fullDayFee = marginalFee(fullDayTechDays, [
    { through: 20, rate: 25 }, { through: 35, rate: 22.5 }, { through: 50, rate: 20 }, { through: null, rate: 17.5 },
  ]);
  const halfDayFee = marginalFee(halfDayTechs, [{ through: 49, rate: 15 }, { through: null, rate: 10 }]);
  return { fullDayTechDays, halfDayTechs, fullDayFee, halfDayFee, total: Math.round((fullDayFee + halfDayFee) * 100) / 100 };
}
function showRange(show: ShowRecord) {
  const start = cleanDate(show.show_start); const end = cleanDate(show.show_end) || start;
  if (!start) return "Dates TBD";
  return start === end ? formatPayrollDate(start) : `${formatPayrollDate(start)} to ${formatPayrollDate(end)}`;
}
function showStatus(show: ShowRecord) {
  const today = todayKey(); const start = cleanDate(show.show_start); const end = cleanDate(show.show_end) || start;
  if (start && start > today) return "Upcoming";
  if (start && end && start <= today && end >= today) return "Current";
  return "Past";
}
function pct(filled: number, needed: number) { return needed > 0 ? Math.round((filled / needed) * 100) : 0; }

export default async function CoordinatorPage() {
  const session = await requirePage("coordinator");
  const data = await getEventsPageData({ showLimit: 200 });
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const isCoordinator = role === "coordinator";
  const userId = session.user?.id || "";
  const appUsers = data.appUsers as AppUserSummaryRecord[];
  const laborDays = data.laborDays as LaborDayRecord[];
  const subCalls = data.subCalls as SubCallRecord[];
  const assignments = data.assignments as AssignmentRecord[];
  const allShows = data.shows as ShowRecord[];
  const userById = new Map<string, AppUserSummaryRecord>(appUsers.map((user): [string, AppUserSummaryRecord] => [user.id, user]));
  const daysByShow = new Map<string, LaborDayRecord[]>();
  laborDays.forEach((day: LaborDayRecord) => daysByShow.set(day.show_id, [...(daysByShow.get(day.show_id) || []), day]));
  const dayById = new Map<string, LaborDayRecord>(laborDays.map((day): [string, LaborDayRecord] => [day.id, day]));
  const callsByDay = new Map<string, SubCallRecord[]>();
  subCalls.forEach((call: SubCallRecord) => callsByDay.set(call.labor_day_id, [...(callsByDay.get(call.labor_day_id) || []), call]));
  const assignmentsByCall = new Map<string, AssignmentRecord[]>();
  assignments.forEach((assignment: AssignmentRecord) => assignmentsByCall.set(assignment.sub_call_id, [...(assignmentsByCall.get(assignment.sub_call_id) || []), assignment]));

  const today = todayKey();
  const shows = allShows
    .filter((show: ShowRecord) => !isCoordinator || show.assigned_coordinator_user_id === userId || show.created_by === userId)
    .filter((show: ShowRecord) => (cleanDate(show.show_end) || cleanDate(show.show_start)) >= today)
    .sort((a: ShowRecord, b: ShowRecord) => cleanDate(a.show_start).localeCompare(cleanDate(b.show_start)));

  const rows = shows.map((show: ShowRecord) => {
    const days = daysByShow.get(show.id) || [];
    const calls = days.flatMap((day: LaborDayRecord) => callsByDay.get(day.id) || []);
    const needed = calls.reduce((sum: number, call: SubCallRecord) => sum + Math.max(0, Number(call.crew_needed || 0)), 0);
    const filled = calls.reduce((sum: number, call: SubCallRecord) => sum + (assignmentsByCall.get(call.id)?.length || 0), 0);
    let fullDayTechDays = 0; let halfDayTechs = 0;
    for (const call of calls) {
      const assigned = assignmentsByCall.get(call.id)?.length || 0;
      if (isHalfDay(call)) halfDayTechs += assigned; else fullDayTechDays += assigned;
    }
    return { show, days, calls, needed, filled, open: Math.max(0, needed - filled), fee: coordinatorFee(fullDayTechDays, halfDayTechs) };
  });

  const totalNeeded = rows.reduce((sum: number, row) => sum + row.needed, 0);
  const totalFilled = rows.reduce((sum: number, row) => sum + row.filled, 0);
  const totalOpen = rows.reduce((sum: number, row) => sum + row.open, 0);
  const totalProjectedPay = rows.reduce((sum: number, row) => sum + row.fee.total, 0);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card accent-card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Coordinator Dashboard</h2>
            <p className="muted" style={{ margin: 0 }}>Upcoming assigned shows, fill progress, open crew slots, and projected coordinator fee using the 1–20 fee schedule.</p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}><Link className="ghost" href="/events">Open Events</Link><Link className="ghost" href="/payroll">Open Payroll</Link></div>
        </div>
      </section>

      <section className="grid grid-4">
        <div className="card compact"><div className="muted small">Upcoming shows</div><strong style={{ fontSize: 28 }}>{rows.length}</strong></div>
        <div className="card compact"><div className="muted small">Filled tech slots</div><strong style={{ fontSize: 28 }}>{totalFilled}/{totalNeeded}</strong></div>
        <div className="card compact"><div className="muted small">Still open</div><strong style={{ fontSize: 28 }}>{totalOpen}</strong></div>
        <div className="card compact"><div className="muted small">Projected coordinator pay</div><strong style={{ fontSize: 28 }}>{money(totalProjectedPay)}</strong></div>
      </section>

      {data.error ? <p className="error">{data.error}</p> : null}

      <div className="list">
        {rows.map((row) => {
          const coordinator = row.show.assigned_coordinator_user_id ? userById.get(row.show.assigned_coordinator_user_id) : null;
          return (
            <section key={row.show.id} className="card">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>{row.show.name || "Untitled show"}</h2>
                  <p className="muted" style={{ margin: 0 }}>{row.show.client || "No client"} • {row.show.venue || "No venue"} • {showRange(row.show)}</p>
                  <div className="toolbar" style={{ marginTop: 10 }}>
                    <span className="badge">{showStatus(row.show)}</span>
                    <span className="badge">Coordinator: {coordinator?.full_name || coordinator?.email || "Unassigned"}</span>
                    <span className="badge">Filled {row.filled}/{row.needed} · {pct(row.filled, row.needed)}%</span>
                    <span className={row.open ? "badge event-badge-upcoming" : "badge event-badge-current"}>{row.open} open</span>
                    <span className="badge">Projected fee {money(row.fee.total)}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-3" style={{ marginTop: 12 }}>
                <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Full-day tech-days</div><strong>{row.fee.fullDayTechDays}</strong><div className="small muted">Fee: {money(row.fee.fullDayFee)}</div></div>
                <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Half-day techs</div><strong>{row.fee.halfDayTechs}</strong><div className="small muted">Fee: {money(row.fee.halfDayFee)}</div></div>
                <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Open slots</div><strong>{row.open}</strong><div className="small muted">Coordinators cannot exceed subgroup max.</div></div>
              </div>
              <div className="mobile-table" style={{ overflowX: "auto", marginTop: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}><th style={{ padding: 8 }}>Date</th><th style={{ padding: 8 }}>Subgroup / area</th><th style={{ padding: 8 }}>PO</th><th style={{ padding: 8 }}>Role</th><th style={{ padding: 8 }}>Filled</th><th style={{ padding: 8 }}>Open</th><th style={{ padding: 8 }}>Block</th></tr></thead>
                  <tbody>
                    {row.calls.map((call: SubCallRecord) => {
                      const day = dayById.get(call.labor_day_id);
                      const assigned = assignmentsByCall.get(call.id)?.length || 0;
                      const needed = Math.max(0, Number(call.crew_needed || 0));
                      const open = Math.max(0, needed - assigned);
                      return <tr key={call.id} style={{ borderBottom: "1px solid var(--line)" }}><td style={{ padding: 8 }}>{day?.labor_date || "—"}</td><td style={{ padding: 8 }}>{call.area || "Unassigned"}</td><td style={{ padding: 8 }}>{call.po_number || "—"}</td><td style={{ padding: 8 }}>{call.role_name || "General AV"}</td><td style={{ padding: 8 }}>{assigned}/{needed}</td><td style={{ padding: 8 }}>{open}</td><td style={{ padding: 8 }}>{isHalfDay(call) ? "Half day" : "Full day"}</td></tr>;
                    })}
                    {row.calls.length === 0 ? <tr><td colSpan={7} className="muted" style={{ padding: 12 }}>No sub-calls created yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {rows.length === 0 ? <section className="card"><p className="muted">No upcoming coordinator shows found.</p></section> : null}
      </div>
    </div>
  );
}
