import type { ContractorPurchaseOrder } from "@/lib/payroll-calculations";
import type { PayrollEventSummary } from "@/lib/payroll-types";
import { isOwnerDrawPayee } from "@/lib/owner-draws";
export type CoordinatorOrderLine = { showId: string; showName: string; showStart: string; showEnd: string; amount: number; fullDays: number; halfDays: number; alternateDays: number };
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
    return { showId, showName: event.showName, showStart: event.showStart, showEnd: event.showEnd, amount: Math.round(payment.payableAmount * 100) / 100, fullDays: payment.fullDayTechDays, halfDays: payment.halfDayTechs, alternateDays: payment.alternateUnusedDays || 0 };
  }).sort((a, b) => a.showStart.localeCompare(b.showStart) || a.showId.localeCompare(b.showId));
  return { coordinatorUserId: coordinatorId, coordinatorName, lines, total: Math.round(lines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100 };
}
