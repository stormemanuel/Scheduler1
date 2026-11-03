import type { PayrollEventSummary, PayrollCoordinatorPaymentSummary } from "@/lib/payroll-types";
import { estimateCoordinatorCompensation } from "@/lib/payroll-calculations";
const safeText = (value: unknown) => String(value ?? "").trim();

export function calculateCoordinatorPayments(event: PayrollEventSummary): PayrollCoordinatorPaymentSummary[] {
  const grouped = new Map<string, PayrollCoordinatorPaymentSummary>();
  for (const row of event.rows) {
    for (const call of row.calls) {
      if (call.coordinationFeeWaived) continue;
      const status = safeText(call.status).toLowerCase();
      // A replaced worker did not work, and the closed standby row is paid
      // through its new replacement assignment. Neither row earns a second
      // coordinator booking credit.
      if (status === "no_show_replaced" || status === "called_in_replacement_used") continue;
      const coordinatorUserId = call.coordinationOwnerUserId || row.showAssignedCoordinatorUserId || null;
      if (!coordinatorUserId) continue;
      const label = safeText(call.payLabel).toLowerCase();
      const isHalf = label.includes("half") || (call.durationHours !== null && call.durationHours <= 5);
      const role = safeText(call.roleName).toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
      const unusedOnSiteAlternate = status !== "replacement_confirmed" && ["on site replacement", "onsite replacement", "on site standby", "onsite standby"].includes(role);
      const existing = grouped.get(coordinatorUserId) ?? {
        showId: event.showId,
        coordinatorUserId,
        coordinatorName: call.coordinationOwnerName || row.showAssignedCoordinatorName || "Coordinator",
        fullDayTechDays: 0,
        halfDayTechs: 0,
        alternateUnusedDays: 0,
        alternateUnusedFee: 0,
        projectedAmount: 0,
        overrideAmount: call.coordinationOverrideAmount ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorOverrideAmount ?? null : null),
        payableAmount: 0,
        paymentStatus: (call.coordinationPaymentStatus === "paid" || call.coordinationPaymentStatus === "scheduled" ? call.coordinationPaymentStatus : coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorPaymentStatus ?? "unpaid" : "unpaid"),
        paid: Boolean(call.coordinationPaid || (coordinatorUserId === row.showAssignedCoordinatorUserId && row.coordinatorPaid)),
        scheduledFor: call.coordinationScheduledFor ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorScheduledFor ?? null : null),
        notes: call.coordinationNotes ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorNotes ?? "" : ""),
        statusId: call.coordinationPaymentStatusId ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorPaymentStatusId ?? null : null),
        rateSchedule: call.coordinationRateSchedule ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorRateSchedule ?? null : null),
      };
      if (unusedOnSiteAlternate) {
        existing.alternateUnusedDays = Number(existing.alternateUnusedDays || 0) + 1;
        existing.alternateUnusedFee = Math.round(Number(existing.alternateUnusedDays || 0) * 10 * 100) / 100;
      } else if (isHalf) existing.halfDayTechs += 1;
      else existing.fullDayTechDays += 1;
      const projectedAmount = Math.round((estimateCoordinatorCompensation(existing.fullDayTechDays, existing.halfDayTechs, existing.rateSchedule).total + Number(existing.alternateUnusedFee || 0)) * 100) / 100;
      existing.projectedAmount = projectedAmount;
      existing.payableAmount = existing.overrideAmount ?? projectedAmount;
      grouped.set(coordinatorUserId, existing);
    }
  }

  const assignedCoordinatorRow = event.rows.find((row) => row.showAssignedCoordinatorUserId);
  const assignedCoordinatorId = assignedCoordinatorRow?.showAssignedCoordinatorUserId || "";
  if (assignedCoordinatorId && !grouped.has(assignedCoordinatorId)) {
    const projectedAmount = estimateCoordinatorCompensation(0, 0, assignedCoordinatorRow?.coordinatorRateSchedule).total;
    const overrideAmount = assignedCoordinatorRow?.coordinatorOverrideAmount ?? null;
    grouped.set(assignedCoordinatorId, {
      showId: event.showId,
      coordinatorUserId: assignedCoordinatorId,
      coordinatorName: assignedCoordinatorRow?.showAssignedCoordinatorName || "Assigned coordinator",
      fullDayTechDays: 0,
      halfDayTechs: 0,
      alternateUnusedDays: 0,
      alternateUnusedFee: 0,
      projectedAmount,
      overrideAmount,
      payableAmount: overrideAmount ?? projectedAmount,
      paymentStatus: assignedCoordinatorRow?.coordinatorPaymentStatus ?? "unpaid",
      paid: Boolean(assignedCoordinatorRow?.coordinatorPaid),
      scheduledFor: assignedCoordinatorRow?.coordinatorScheduledFor ?? null,
      notes: assignedCoordinatorRow?.coordinatorNotes ?? "",
      statusId: assignedCoordinatorRow?.coordinatorPaymentStatusId ?? null,
      rateSchedule: assignedCoordinatorRow?.coordinatorRateSchedule ?? null,
    });
  }

  return [...grouped.values()].sort((a, b) => {
    const aAssigned = a.coordinatorUserId === assignedCoordinatorId ? 0 : 1;
    const bAssigned = b.coordinatorUserId === assignedCoordinatorId ? 0 : 1;
    return aAssigned - bAssigned || a.coordinatorName.localeCompare(b.coordinatorName);
  });
}
