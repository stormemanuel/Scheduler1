import type { PayrollCrewShowRow, PayrollEventSummary } from "@/lib/payroll-types";
const OWNER_TECH = "[[ELS_OWNER_TECH_PASS_THROUGH_V1]]";
export function isOwnerDrawPayee(name: string | null | undefined) { return String(name || "").trim().replace(/\s+/g, " ").toLowerCase() === "storm leigh"; }
export function isOwnerTechEvent(notes: string | null | undefined) { return String(notes || "").includes(OWNER_TECH); }
export function ownerNotesText(notes: string | null | undefined) { return String(notes || "").replaceAll(OWNER_TECH, "").trim(); }
export function withOwnerTechEvent(notes: string | null | undefined, enabled: boolean) { return [ownerNotesText(notes), enabled ? OWNER_TECH : ""].filter(Boolean).join("\n\n"); }
export function applyOwnerPassThrough(rows: PayrollCrewShowRow[]): PayrollCrewShowRow[] {
  const groups = new Map<string, PayrollCrewShowRow[]>();
  for (const row of rows) groups.set(row.showId, [...(groups.get(row.showId) || []), row]);
  const revenue = new Map<string, number>();
  for (const [showId, group] of groups) {
    if (!group.some((row) => isOwnerTechEvent(row.showFinancialNotes))) continue;
    // Never allocate the same event's revenue twice to duplicate owner contacts.
    if (group.filter((row) => isOwnerDrawPayee(row.crewName)).length !== 1) continue;
    const total = group[0].showRevenueOverride ?? group.reduce((sum, row) => sum + row.calls.reduce((sum, call) => sum + (call.clientRevenueAmount || 0), 0), 0);
    revenue.set(showId, Math.round(total * 100) / 100);
  }
  return rows.map((row) => ({ ...row, ownerPassThroughAmount: isOwnerDrawPayee(row.crewName) ? revenue.get(row.showId) : undefined }));
}
export function ownerDrawTotalForEvent(event: PayrollEventSummary, amount: (row: PayrollCrewShowRow) => number) {
  const coordinator = event.coordinatorPayments?.length ? event.coordinatorPayments : event.coordinatorPayment ? [event.coordinatorPayment] : [];
  return Math.round((event.rows.filter((row) => isOwnerDrawPayee(row.crewName)).reduce((sum, row) => sum + amount(row), 0) + coordinator.filter((payment) => isOwnerDrawPayee(payment.coordinatorName)).reduce((sum, payment) => sum + payment.payableAmount, 0)) * 100) / 100;
}
export function paidOwnerDrawsForEvent(event: PayrollEventSummary, amount: (row: PayrollCrewShowRow) => number) {
  const payments = event.coordinatorPayments?.length ? event.coordinatorPayments : event.coordinatorPayment ? [event.coordinatorPayment] : [];
  const coordinators = payments.filter((payment) => isOwnerDrawPayee(payment.coordinatorName));
  const coordinatorTotal = coordinators.reduce((sum, payment) => sum + payment.payableAmount, 0);
  const techPaid = event.rows.length ? event.rows.filter((row) => isOwnerDrawPayee(row.crewName) && row.paymentStatus === "paid").reduce((sum, row) => sum + amount(row), 0) : event.paidTotal >= event.payableTotal ? Math.max(0, (event.ownerDrawTotal || 0) - coordinatorTotal) : 0;
  return Math.round((techPaid + coordinators.filter((payment) => payment.paymentStatus === "paid").reduce((sum, payment) => sum + payment.payableAmount, 0)) * 100) / 100;
}
