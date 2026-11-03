import type { ContractorPurchaseOrder } from "@/lib/payroll-calculations";
import type { PayrollEventSummary } from "@/lib/payroll-types";
import { isOwnerDrawPayee } from "@/lib/owner-draws";
export type CoordinatorBooking = { crewId: string; crewName: string; dates: string[] };
export type CoordinatorOrderLine = { showId: string; showName: string; showStart: string; showEnd: string; amount: number; fullDays: number; halfDays: number; alternateDays: number; technicians?: CoordinatorBooking[] };
export type CoordinatorOrderQuote = { coordinatorUserId: string; coordinatorName: string; lines: CoordinatorOrderLine[]; total: number };
export type CoordinatorOrder = ContractorPurchaseOrder & { kind: "coordinator"; coordinatorUserId: string; coordinatorName: string; coordinatorEmail: string; showLines: CoordinatorOrderLine[]; quoteHash: string; year: number };
export type CoordinatorOrderRow = { id: string; coordinator_user_id: string; token: string; document: CoordinatorOrder; created_by: string; created_at: string; updated_at: string };
export function coordinatorOrderQuote(events: PayrollEventSummary[], coordinatorId: string, showIds: string[]): CoordinatorOrderQuote {
  if (!coordinatorId || !showIds.length || showIds.length > 25 || new Set(showIds).size !== showIds.length) throw new Error("Select a coordinator and between 1 and 25 distinct shows.");
  let coordinatorName = "";
  const lines = showIds.map((showId) => {
    const event = events.find((event) => event.showId === showId);
    const payments = event?.coordinatorPayments?.length ? event.coordinatorPayments : event?.coordinatorPayment ? [event.coordinatorPayment] : [];
    const payment = payments.find((payment) => payment.coordinatorUserId === coordinatorId);
    if (!event || !payment) throw new Error("A selected show no longer has pay for this coordinator. Refresh Payroll.");
    if (isOwnerDrawPayee(payment.coordinatorName)) throw new Error("Storm Leigh is paid through owner draws, not coordinator Purchase Orders.");
    if (payment.paid || payment.paymentStatus === "paid" || !Number.isFinite(payment.payableAmount) || payment.payableAmount <= 0) throw new Error("Selected shows must have unpaid, non-waived coordinator balances.");
    coordinatorName = payment.coordinatorName;
    const bookings = new Map<string, CoordinatorBooking>();
    for (const row of event.rows || []) for (const call of row.calls) {
      const status = String(call.status || "").toLowerCase();
      if (call.coordinationFeeWaived || ["no_show_replaced", "called_in_replacement_used"].includes(status)) continue;
      if ((call.coordinationOwnerUserId || row.showAssignedCoordinatorUserId) !== coordinatorId) continue;
      const role = String(call.roleName || "").toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      const alternate = status !== "replacement_confirmed" && ["on site replacement", "onsite replacement", "on site standby", "onsite standby"].includes(role);
      const half = String(call.payLabel || "").toLowerCase().includes("half") || (call.durationHours !== null && call.durationHours <= 5);
      const booking = bookings.get(row.crewId) || { crewId: row.crewId, crewName: row.crewName, dates: [] };
      booking.dates.push(`${call.laborDate} · ${alternate ? "Unused alternate" : half ? "Half-day" : "Full-day"}${call.roleName ? ` · ${call.roleName}` : ""}`);
      bookings.set(row.crewId, booking);
    }
    const technicians = [...bookings.values()].map((booking) => ({ ...booking, dates: booking.dates.sort() })).sort((a, b) => a.crewName.localeCompare(b.crewName) || a.crewId.localeCompare(b.crewId));
    return { technicians, showId, showName: event.showName, showStart: event.showStart, showEnd: event.showEnd, amount: Math.round(payment.payableAmount * 100) / 100, fullDays: payment.fullDayTechDays, halfDays: payment.halfDayTechs, alternateDays: payment.alternateUnusedDays || 0 };
  }).sort((a, b) => a.showStart.localeCompare(b.showStart) || a.showId.localeCompare(b.showId));
  return { coordinatorUserId: coordinatorId, coordinatorName, lines, total: Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100 };
}
