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
function coordinatorBlockLabel(call: SubCallRecord) {
  const dayType = safeText(call.day_type).toLowerCase();
  const hours = durationHours(call);
  if (dayType.includes("hourly")) return hours !== null ? `Hourly · ${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h` : "Hourly";
  if (dayType.includes("custom")) return hours !== null ? `Custom · ${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h` : "Custom";
  if (dayType.includes("half")) return "Half day";
  if (dayType.includes("full")) return "Full day";
  if (hours !== null && hours <= 5) return `Half day · ${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
  if (hours !== null) return `Full day · ${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
  return "Full day";
}
function assignmentCountsAsFilled(assignment: AssignmentRecord) {
  const status = safeText(assignment.status).toLowerCase();
  return status !== "no_show_replaced" && status !== "called_in_replacement_used" && status !== "cancelled";
}
function assignmentCountsForCoordinator(assignment: AssignmentRecord, show: ShowRecord) {
  if (!assignmentCountsAsFilled(assignment)) return false;
  const ownerId = safeText(assignment.coordination_owner_user_id);
  if (!ownerId) return !assignment.coordination_fee_waived;
  return Boolean(ownerId === safeText(show.assigned_coordinator_user_id) && !assignment.coordination_fee_waived);
}
function coordinatorVisibleCounts(call: SubCallRecord, show: ShowRecord, assignmentsForCall: AssignmentRecord[]) {
  const totalNeeded = Math.max(0, Number(call.crew_needed || 0));
  const coordinatorAssigned = assignmentsForCall.filter((assignment) => assignmentCountsForCoordinator(assignment, show)).length;
  const adminOwned = assignmentsForCall.filter((assignment) => {
    const ownerId = safeText(assignment.coordination_owner_user_id);
    return Boolean(ownerId && ownerId !== safeText(show.assigned_coordinator_user_id));
  }).length;
  const coordinatorNeeded = Math.max(0, totalNeeded - adminOwned);
  return { needed: coordinatorNeeded, filled: coordinatorAssigned, open: Math.max(0, coordinatorNeeded - coordinatorAssigned), adminOwned };
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
type CoordinatorView = "day" | "booth";
type CoordinatorSearchParams = { view?: string | string[] };
function singleSearchValue(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function formatDisplayTime(value: string | null | undefined) {
  const minutes = timeMinutes(value);
  if (minutes === null) return safeText(value, "—");
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
function formatTimeRange(call: SubCallRecord) {
  return `${formatDisplayTime(call.start_time)}${call.end_time ? `–${formatDisplayTime(call.end_time)}` : ""}`;
}
function compareCoordinatorCalls(a: SubCallRecord, b: SubCallRecord, dayById: Map<string, LaborDayRecord>) {
  const aDay = dayById.get(a.labor_day_id)?.labor_date || "";
  const bDay = dayById.get(b.labor_day_id)?.labor_date || "";
  return aDay.localeCompare(bDay) || a.start_time.localeCompare(b.start_time) || safeText(a.area).localeCompare(safeText(b.area)) || safeText(a.role_name).localeCompare(safeText(b.role_name));
}
function groupCallsByBooth(calls: SubCallRecord[]) {
  const map = new Map<string, SubCallRecord[]>();
  for (const call of calls) {
    const area = safeText(call.area, "Unassigned booth / area");
    map.set(area, [...(map.get(area) || []), call]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default async function CoordinatorPage({ searchParams }: { searchParams?: Promise<CoordinatorSearchParams> }) {
  const resolvedSearchParams = await searchParams;
  const coordinatorView: CoordinatorView = singleSearchValue(resolvedSearchParams?.view) === "day" ? "day" : "booth";
  const session = await requirePage("coordinator");
  const data = await getEventsPageData({ showLimit: 200 });
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const isCoordinator = role === "coordinator";
  const canViewInternalCoordinatorPay = !isCoordinator;
  const userId = session.user?.id || "";
  const profileId = String((session.profile as { id?: string } | null)?.id || userId);
  const userAccessIds = new Set([userId, profileId].filter(Boolean));
  const appUsers = data.appUsers as AppUserSummaryRecord[];
  const laborDays = data.laborDays as LaborDayRecord[];
  const subCalls = data.subCalls as SubCallRecord[];
  const assignments = data.assignments as AssignmentRecord[];
  const allShows = data.shows as ShowRecord[];
  const eventAccess = data.eventUserAccess || [];
  const sharedShowIds = new Set(eventAccess.filter((row) => userAccessIds.has(row.user_id || "") || userAccessIds.has(row.user_profile_id || "")).map((row) => row.show_id));
  const canViewCoordinatorFeeForShow = (show: ShowRecord) => canViewInternalCoordinatorPay || userAccessIds.has(show.assigned_coordinator_user_id || "") || sharedShowIds.has(show.id);
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
    .filter((show: ShowRecord) => !isCoordinator || userAccessIds.has(show.assigned_coordinator_user_id || "") || show.created_by === userId || sharedShowIds.has(show.id))
    .filter((show: ShowRecord) => (cleanDate(show.show_end) || cleanDate(show.show_start)) >= today)
    .sort((a: ShowRecord, b: ShowRecord) => cleanDate(a.show_start).localeCompare(cleanDate(b.show_start)));

  const rows = shows.map((show: ShowRecord) => {
    const days = daysByShow.get(show.id) || [];
    const calls = days.flatMap((day: LaborDayRecord) => callsByDay.get(day.id) || []);
    let needed = 0;
    let filled = 0;
    let open = 0;
    let fullDayTechDays = 0; let halfDayTechs = 0;
    for (const call of calls) {
      const counts = coordinatorVisibleCounts(call, show, assignmentsByCall.get(call.id) || []);
      needed += counts.needed;
      filled += counts.filled;
      open += counts.open;
      if (isHalfDay(call)) halfDayTechs += counts.filled; else fullDayTechDays += counts.filled;
    }
    return { show, days, calls, needed, filled, open, fee: coordinatorFee(fullDayTechDays, halfDayTechs), canViewFee: canViewCoordinatorFeeForShow(show) };
  });

  const totalNeeded = rows.reduce((sum: number, row) => sum + row.needed, 0);
  const totalFilled = rows.reduce((sum: number, row) => sum + row.filled, 0);
  const totalOpen = rows.reduce((sum: number, row) => sum + row.open, 0);
  const totalProjectedPay = rows.reduce((sum: number, row) => sum + (row.canViewFee ? row.fee.total : 0), 0);

  const coordinatorBreakdown = canViewInternalCoordinatorPay
    ? Array.from(rows.reduce((map, row) => {
        const coordinatorId = safeText(row.show.assigned_coordinator_user_id) || "__unassigned__";
        const existing = map.get(coordinatorId) ?? {
          coordinatorId,
          coordinator: coordinatorId === "__unassigned__" ? null : userById.get(coordinatorId) ?? null,
          showCount: 0,
          needed: 0,
          filled: 0,
          open: 0,
          fullDayTechDays: 0,
          halfDayTechs: 0,
          projectedFee: 0,
          shows: [] as typeof rows,
        };
        existing.showCount += 1;
        existing.needed += row.needed;
        existing.filled += row.filled;
        existing.open += row.open;
        existing.fullDayTechDays += row.fee.fullDayTechDays;
        existing.halfDayTechs += row.fee.halfDayTechs;
        existing.projectedFee += row.fee.total;
        existing.shows.push(row);
        map.set(coordinatorId, existing);
        return map;
      }, new Map<string, {
        coordinatorId: string;
        coordinator: AppUserSummaryRecord | null;
        showCount: number;
        needed: number;
        filled: number;
        open: number;
        fullDayTechDays: number;
        halfDayTechs: number;
        projectedFee: number;
        shows: typeof rows;
      }>()).values()).sort((a, b) => {
        if (a.coordinatorId === "__unassigned__") return 1;
        if (b.coordinatorId === "__unassigned__") return -1;
        return (a.coordinator?.full_name || a.coordinator?.email || "Coordinator").localeCompare(b.coordinator?.full_name || b.coordinator?.email || "Coordinator");
      })
    : [];

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card accent-card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Coordinator Dashboard</h2>
            <p className="muted" style={{ margin: 0 }}>{"Upcoming assigned shows, fill progress, open crew slots, and coordinator fee totals for invoicing. Different roles/times show as separate rows with their own block type."}</p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <Link className="ghost" href="/coordinator?view=day" style={coordinatorView === "day" ? { borderColor: "#d4a62a", background: "#fff8cf" } : undefined}>Day View</Link>
            <Link className="ghost" href="/coordinator?view=booth" style={coordinatorView === "booth" ? { borderColor: "#d4a62a", background: "#fff8cf" } : undefined}>Booth / Area View</Link>
            <Link className="ghost" href="/events">Open Events</Link>
            {canViewInternalCoordinatorPay ? <Link className="ghost" href="/payroll">Open Payroll</Link> : null}
          </div>
        </div>
      </section>

      <section className="grid grid-4">
        <div className="card compact"><div className="muted small">Upcoming shows</div><strong style={{ fontSize: 28 }}>{rows.length}</strong></div>
        <div className="card compact"><div className="muted small">Filled tech slots</div><strong style={{ fontSize: 28 }}>{totalFilled}/{totalNeeded}</strong></div>
        <div className="card compact"><div className="muted small">Still open</div><strong style={{ fontSize: 28 }}>{totalOpen}</strong></div>
        <div className="card compact"><div className="muted small">Projected coordinator fee</div><strong style={{ fontSize: 28 }}>{money(totalProjectedPay)}</strong><div className="small muted">For assigned coordinator invoicing.</div></div>
      </section>

      {data.error ? <p className="error">{data.error}</p> : null}

      {canViewInternalCoordinatorPay ? (
        <section className="card">
          <div className="row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <h3 style={{ marginBottom: 4 }}>Coordinator Breakdown</h3>
              <p className="muted" style={{ margin: 0 }}>Owner/admin view. Each coordinator has their own workload, open slots, and projected coordinator fee. Unassigned shows are listed separately.</p>
            </div>
          </div>
          {coordinatorBreakdown.length ? (
            <div className="grid grid-2">
              {coordinatorBreakdown.map((coordinatorRow) => {
                const isUnassigned = coordinatorRow.coordinatorId === "__unassigned__";
                const coordinatorName = isUnassigned
                  ? "Unassigned"
                  : coordinatorRow.coordinator?.full_name || coordinatorRow.coordinator?.email || "Coordinator";
                const coordinatorEmail = isUnassigned ? "No coordinator assigned yet" : coordinatorRow.coordinator?.email || "No email";
                return (
                  <div key={coordinatorRow.coordinatorId} className="card compact" style={{ boxShadow: "none", borderLeft: `4px solid ${isUnassigned ? "#b45309" : "#d4a62a"}` }}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <div>
                        <strong>{coordinatorName}</strong>
                        <div className="small muted">{coordinatorEmail}</div>
                      </div>
                      <span className={coordinatorRow.open ? "badge event-badge-upcoming" : "badge event-badge-current"}>{coordinatorRow.open} open</span>
                    </div>
                    <div className="grid grid-4" style={{ marginTop: 10 }}>
                      <div><div className="muted small">Shows</div><strong>{coordinatorRow.showCount}</strong></div>
                      <div><div className="muted small">Filled</div><strong>{coordinatorRow.filled}/{coordinatorRow.needed}</strong></div>
                      <div><div className="muted small">Full-day</div><strong>{coordinatorRow.fullDayTechDays}</strong></div>
                      <div><div className="muted small">Half-day</div><strong>{coordinatorRow.halfDayTechs}</strong></div>
                    </div>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <span className="badge">Fill {pct(coordinatorRow.filled, coordinatorRow.needed)}%</span>
                      <span className="badge">Projected fee {money(coordinatorRow.projectedFee)}</span>
                      {isUnassigned ? <span className="badge">Potential only until assigned</span> : null}
                    </div>
                    <div className="list" style={{ marginTop: 10 }}>
                      {coordinatorRow.shows.slice(0, 4).map((row) => (
                        <div key={row.show.id} className="small" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                          <strong>{row.show.name || "Untitled show"}</strong>
                          <div className="muted">{showRange(row.show)} · Filled {row.filled}/{row.needed} · {row.open} open · Fee {money(row.fee.total)}</div>
                        </div>
                      ))}
                      {coordinatorRow.shows.length > 4 ? <div className="small muted">+ {coordinatorRow.shows.length - 4} more show{coordinatorRow.shows.length - 4 === 1 ? "" : "s"}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0 }}>No upcoming coordinator workload found.</p>
          )}
        </section>
      ) : null}

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
                    {row.canViewFee ? <span className="badge">Projected fee {money(row.fee.total)}</span> : null}
                  </div>
                </div>
              </div>
              <div className={row.canViewFee ? "grid grid-3" : "grid"} style={{ marginTop: 12 }}>
                {row.canViewFee ? <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Full-day tech-days</div><strong>{row.fee.fullDayTechDays}</strong><div className="small muted">Fee: {money(row.fee.fullDayFee)}</div></div> : null}
                {row.canViewFee ? <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Half-day techs</div><strong>{row.fee.halfDayTechs}</strong><div className="small muted">Fee: {money(row.fee.halfDayFee)}</div></div> : null}
                <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Open slots</div><strong>{row.open}</strong><div className="small muted">Coordinators cannot exceed subgroup max.</div></div>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <div className="small muted">{coordinatorView === "booth" ? "Booth / Area View: grouped by booth, then sorted by day." : "Day View: sorted by date, then time and booth."}</div>
                </div>
                {coordinatorView === "day" ? (
                  <div className="mobile-table" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}><th style={{ padding: 8 }}>Date</th><th style={{ padding: 8 }}>Subgroup / area</th><th style={{ padding: 8 }}>Time</th><th style={{ padding: 8 }}>PO</th><th style={{ padding: 8 }}>Role</th><th style={{ padding: 8 }}>Filled</th><th style={{ padding: 8 }}>Open</th><th style={{ padding: 8 }}>Block</th></tr></thead>
                      <tbody>
                        {[...row.calls].sort((a, b) => compareCoordinatorCalls(a, b, dayById)).map((call: SubCallRecord) => {
                          const day = dayById.get(call.labor_day_id);
                          const counts = coordinatorVisibleCounts(call, row.show, assignmentsByCall.get(call.id) || []);
                          return <tr key={call.id} style={{ borderBottom: "1px solid var(--line)" }}><td style={{ padding: 8 }}>{day?.labor_date || "—"}</td><td style={{ padding: 8 }}>{call.area || "Unassigned"}</td><td style={{ padding: 8, whiteSpace: "nowrap" }}>{formatTimeRange(call)}</td><td style={{ padding: 8 }}>{call.po_number || "—"}</td><td style={{ padding: 8 }}>{call.role_name || "General AV"}</td><td style={{ padding: 8 }}>{counts.filled}/{counts.needed}</td><td style={{ padding: 8 }}>{counts.open}</td><td style={{ padding: 8 }}>{coordinatorBlockLabel(call)}</td></tr>;
                        })}
                        {row.calls.length === 0 ? <tr><td colSpan={8} className="muted" style={{ padding: 12 }}>No sub-calls created yet.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="grid" style={{ gap: 12 }}>
                    {groupCallsByBooth([...row.calls].sort((a, b) => compareCoordinatorCalls(a, b, dayById))).map(([booth, calls]) => (
                      <div key={booth} className="card compact" style={{ boxShadow: "none", borderLeft: "4px solid #d4a62a" }}>
                        <div className="row" style={{ alignItems: "flex-start", marginBottom: 8 }}>
                          <div>
                            <strong>{booth}</strong>
                            <div className="small muted">{calls.length} sub-call{calls.length === 1 ? "" : "s"}</div>
                          </div>
                        </div>
                        <div className="mobile-table" style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead><tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}><th style={{ padding: 8 }}>Date</th><th style={{ padding: 8 }}>Time</th><th style={{ padding: 8 }}>PO</th><th style={{ padding: 8 }}>Role</th><th style={{ padding: 8 }}>Filled</th><th style={{ padding: 8 }}>Open</th><th style={{ padding: 8 }}>Block</th></tr></thead>
                            <tbody>
                              {calls.map((call: SubCallRecord) => {
                                const day = dayById.get(call.labor_day_id);
                                const counts = coordinatorVisibleCounts(call, row.show, assignmentsByCall.get(call.id) || []);
                                return <tr key={call.id} style={{ borderBottom: "1px solid var(--line)" }}><td style={{ padding: 8 }}>{day?.labor_date || "—"}</td><td style={{ padding: 8, whiteSpace: "nowrap" }}>{formatTimeRange(call)}</td><td style={{ padding: 8 }}>{call.po_number || "—"}</td><td style={{ padding: 8 }}>{call.role_name || "General AV"}</td><td style={{ padding: 8 }}>{counts.filled}/{counts.needed}</td><td style={{ padding: 8 }}>{counts.open}</td><td style={{ padding: 8 }}>{coordinatorBlockLabel(call)}</td></tr>;
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                    {row.calls.length === 0 ? <div className="card compact" style={{ boxShadow: "none" }}><p className="muted" style={{ margin: 0 }}>No sub-calls created yet.</p></div> : null}
                  </div>
                )}
              </div>
            </section>
          );
        })}
        {rows.length === 0 ? <section className="card"><p className="muted">No upcoming coordinator shows found.</p></section> : null}
      </div>
    </div>
  );
}
