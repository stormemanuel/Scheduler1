"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { PayrollCrewShowRow, PayrollEventSummary, PayrollYearTechSummary, PayrollPaymentStatus, PayrollCoordinatorPaymentSummary } from "@/lib/payroll-types";
import type { ShowExpenseItemRecord } from "@/lib/financial-types";
import { formatPayrollDate, formatPayrollTime, money } from "@/lib/payroll-calculations";
import { exportDocumentDocx, exportDocumentPdf, type ExportDocument } from "@/lib/export-documents";

type Props = {
  initialRows: PayrollCrewShowRow[];
  availableYears: number[];
  initialError: string | null;
};

type SavePayload = {
  show_id: string;
  crew_id: string;
  paid: boolean;
  payment_status: PayrollPaymentStatus;
  payout_override: number | null;
  notes: string;
  scheduled_for: string | null;
};

type ReportView = "current" | "estimated";
type ExpenseDraft = {
  category: string;
  description: string;
  amount: string;
  tax_treatment: string;
  receipt_status: string;
  expense_date: string;
  notes: string;
};

const commonExpenseOptions = [
  { category: "Parking", tax: "Likely deductible if ordinary and necessary", help: "Garage, lot, valet, meter, or venue parking for show work." },
  { category: "Mileage / vehicle", tax: "Needs mileage log / CPA review", help: "Business miles, gas, tolls, rental vehicle, or vehicle costs tied to the show." },
  { category: "Rideshare / taxi", tax: "Likely deductible if ordinary and necessary", help: "Uber, Lyft, taxi, shuttle, or local transportation for the event." },
  { category: "Airfare / baggage", tax: "Likely deductible if ordinary and necessary", help: "Flights, baggage, seat fees, and business travel charges." },
  { category: "Lodging", tax: "Likely deductible if ordinary and necessary", help: "Hotel or short-term lodging for show travel." },
  { category: "Meals / per diem", tax: "Meals are generally limited to 50%", help: "Business meals, travel meals, or per diem amounts. Keep receipts/notes." },
  { category: "Supplies / consumables", tax: "Likely deductible if ordinary and necessary", help: "Tape, batteries, labels, zip ties, tools consumed, PPE, or show supplies." },
  { category: "Tools / equipment rental", tax: "Likely deductible if ordinary and necessary", help: "Small tools, rental equipment, carts, radios, scanners, or job-specific gear." },
  { category: "Printing / office", tax: "Likely deductible if ordinary and necessary", help: "Badges, show books, signage, paper, ink, binders, office supplies." },
  { category: "Shipping / postage", tax: "Likely deductible if ordinary and necessary", help: "Courier, FedEx/UPS, postage, or document delivery for the show." },
  { category: "Software / app fee", tax: "Likely deductible if ordinary and necessary", help: "Scheduling, communication, storage, e-signature, or show-management software." },
  { category: "Phone / internet", tax: "Business portion only", help: "Hotspot, temporary internet, business phone usage, or data tied to the event." },
  { category: "Insurance / COI", tax: "Likely deductible if ordinary and necessary", help: "Event-specific certificates, insurance fees, or compliance costs." },
  { category: "Client reimbursable", tax: "Track separately / reimbursable", help: "Expenses expected to be reimbursed by the client; keep receipts and invoice backup." },
  { category: "Other", tax: "Needs review", help: "Use for anything unusual and describe it clearly." },
];

function blankExpenseDraft(): ExpenseDraft {
  const first = commonExpenseOptions[0];
  return {
    category: first.category,
    description: "",
    amount: "",
    tax_treatment: first.tax,
    receipt_status: "Receipt needed",
    expense_date: todayKey(),
    notes: "",
  };
}

function expenseTotal(items: ShowExpenseItemRecord[]) {
  return Math.round(items.reduce((sum, item) => sum + Number(item.amount || 0), 0) * 100) / 100;
}


function paymentStatusFor(row: Pick<PayrollCrewShowRow, "paid" | "paymentStatus" | "scheduledFor">): PayrollPaymentStatus {
  if (row.paymentStatus === "paid" || row.paymentStatus === "scheduled" || row.paymentStatus === "unpaid") return row.paymentStatus;
  if (row.paid) return "paid";
  if (row.scheduledFor) return "scheduled";
  return "unpaid";
}

function paymentStatusLabel(status: PayrollPaymentStatus) {
  if (status === "paid") return "Paid";
  if (status === "scheduled") return "Scheduled";
  return "Unpaid";
}

function paymentStatusStyle(status: PayrollPaymentStatus): CSSProperties {
  if (status === "paid") {
    return {
      background: "#dcfce7",
      borderColor: "#86efac",
      color: "#166534",
      fontWeight: 900,
    };
  }
  if (status === "scheduled") {
    return {
      background: "#fef3c7",
      borderColor: "#facc15",
      color: "#854d0e",
      fontWeight: 900,
    };
  }
  return {
    background: "#fee2e2",
    borderColor: "#fca5a5",
    color: "#991b1b",
    fontWeight: 900,
  };
}

function paymentStatusBadge(status: PayrollPaymentStatus) {
  return <span className="badge" style={paymentStatusStyle(status)}>{paymentStatusLabel(status)}</span>;
}

function derivePaymentStatus(status: PayrollPaymentStatus, scheduledFor: string | null): PayrollPaymentStatus {
  if (status === "paid") return "paid";
  if (status === "scheduled") return "scheduled";
  return scheduledFor ? "scheduled" : "unpaid";
}

function payable(row: PayrollCrewShowRow) {
  return row.overrideAmount ?? row.estimatedTotal;
}

function marginalCoordinatorFee(count: number, tiers: Array<{ through: number | null; rate: number }>) {
  let remaining = Math.max(0, Math.floor(count));
  let previous = 0;
  let total = 0;
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

function coordinatorProjectedAmount(fullDayTechDays: number, halfDayTechs: number) {
  const fullDayFee = marginalCoordinatorFee(fullDayTechDays, [
    { through: 20, rate: 25 },
    { through: 35, rate: 22.5 },
    { through: 50, rate: 20 },
    { through: null, rate: 17.5 },
  ]);
  const halfDayFee = marginalCoordinatorFee(halfDayTechs, [
    { through: 49, rate: 15 },
    { through: null, rate: 10 },
  ]);
  return Math.round((fullDayFee + halfDayFee) * 100) / 100;
}

function coordinatorPaymentsForEvent(event: PayrollEventSummary): PayrollCoordinatorPaymentSummary[] {
  const grouped = new Map<string, PayrollCoordinatorPaymentSummary>();
  for (const row of event.rows) {
    for (const call of row.calls) {
      if (call.coordinationFeeWaived) continue;
      const coordinatorUserId = call.coordinationOwnerUserId || row.showAssignedCoordinatorUserId || null;
      if (!coordinatorUserId) continue;
      const key = coordinatorUserId;
      const label = String(call.payLabel || "").toLowerCase();
      const isHalf = label.includes("half") || (call.durationHours !== null && call.durationHours <= 5);
      const existing = grouped.get(key) ?? {
        showId: event.showId,
        coordinatorUserId,
        coordinatorName: call.coordinationOwnerName || row.showAssignedCoordinatorName || "Coordinator",
        fullDayTechDays: 0,
        halfDayTechs: 0,
        projectedAmount: 0,
        overrideAmount: call.coordinationOverrideAmount ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorOverrideAmount ?? null : null),
        payableAmount: 0,
        paymentStatus: (call.coordinationPaymentStatus === "paid" || call.coordinationPaymentStatus === "scheduled" ? call.coordinationPaymentStatus : coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorPaymentStatus ?? "unpaid" : "unpaid"),
        paid: Boolean(call.coordinationPaid || (coordinatorUserId === row.showAssignedCoordinatorUserId && row.coordinatorPaid)),
        scheduledFor: call.coordinationScheduledFor ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorScheduledFor ?? null : null),
        notes: call.coordinationNotes ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorNotes ?? "" : ""),
        statusId: call.coordinationPaymentStatusId ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorPaymentStatusId ?? null : null),
      };
      if (isHalf) existing.halfDayTechs += 1;
      else existing.fullDayTechDays += 1;
      const projectedAmount = coordinatorProjectedAmount(existing.fullDayTechDays, existing.halfDayTechs);
      existing.projectedAmount = projectedAmount;
      existing.payableAmount = existing.overrideAmount ?? projectedAmount;
      grouped.set(key, existing);
    }
  }
  const assignedCoordinatorId = event.rows.find((row) => row.showAssignedCoordinatorUserId)?.showAssignedCoordinatorUserId || "";
  return [...grouped.values()].sort((a, b) => {
    const aAssigned = a.coordinatorUserId === assignedCoordinatorId ? 0 : 1;
    const bAssigned = b.coordinatorUserId === assignedCoordinatorId ? 0 : 1;
    return aAssigned - bAssigned || a.coordinatorName.localeCompare(b.coordinatorName);
  });
}

function coordinatorPaymentForEvent(event: PayrollEventSummary): PayrollCoordinatorPaymentSummary | null {
  return coordinatorPaymentsForEvent(event)[0] ?? null;
}

function coordinatorCostForEvent(event: Pick<PayrollEventSummary, "coordinatorPayment" | "coordinatorPayments">) {
  const payments = event.coordinatorPayments?.length ? event.coordinatorPayments : event.coordinatorPayment ? [event.coordinatorPayment] : [];
  return Math.round(payments.reduce((sum, payment) => sum + Number(payment.payableAmount || 0), 0) * 100) / 100;
}

function buildEventSummaries(rows: PayrollCrewShowRow[]) {
  const events = new Map<string, PayrollEventSummary>();
  for (const row of rows) {
    if (!events.has(row.showId)) {
      events.set(row.showId, {
        showId: row.showId,
        showName: row.showName,
        showClient: row.showClient,
        showVenue: row.showVenue,
        showStart: row.showStart,
        showEnd: row.showEnd,
        showYear: row.showYear,
        rows: [],
        coordinatorPayment: null,
        coordinatorPayments: [],
        estimatedRevenue: 0,
        estimatedProfit: 0,
        consecratedHandsDonation: 0,
        taxReserve: 0,
        combinedReserve: 0,
        pureProfit: 0,
        expenses: row.showExpenses ?? 0,
        revenueOverride: row.showRevenueOverride ?? null,
        financialNotes: row.showFinancialNotes ?? "",
        expenseItems: row.showExpenseItems ?? [],
        taxReserveDone: Boolean(row.taxReserveDone),
        taxReserveDoneAt: row.taxReserveDoneAt ?? null,
        consecratedHandsDone: Boolean(row.consecratedHandsDone),
        consecratedHandsDoneAt: row.consecratedHandsDoneAt ?? null,
        estimatedTotal: 0,
        payableTotal: 0,
        paidTotal: 0,
        unpaidTotal: 0,
      });
    }
    const event = events.get(row.showId)!;
    const amount = payable(row);
    event.rows.push(row);
    event.estimatedTotal += row.estimatedTotal;
    event.estimatedRevenue += row.calls.reduce((sum, call) => sum + (call.clientRevenueAmount ?? 0), 0);
    event.payableTotal += amount;
    if (paymentStatusFor(row) === "paid") event.paidTotal += amount;
    else event.unpaidTotal += amount;
  }

  return [...events.values()]
    .map((event) => {
      const sortedEvent = { ...event, rows: event.rows.sort((a, b) => a.crewName.localeCompare(b.crewName)) };
      const coordinatorPayments = coordinatorPaymentsForEvent(sortedEvent);
      const coordinatorPayment = coordinatorPayments[0] ?? null;
      const coordinatorCost = coordinatorCostForEvent({ coordinatorPayment, coordinatorPayments });
      const expenses = event.expenseItems.length ? expenseTotal(event.expenseItems) : Math.round(Number(event.expenses || 0) * 100) / 100;
      const revenue = Math.round(((event.revenueOverride ?? event.estimatedRevenue) || 0) * 100) / 100;
      const profit = Math.round((revenue - event.payableTotal - coordinatorCost - expenses) * 100) / 100;
      const positiveProfit = Math.max(0, profit);
      return {
      ...sortedEvent,
      coordinatorPayment,
      coordinatorPayments,
      estimatedRevenue: revenue,
      expenses,
      estimatedProfit: profit,
      consecratedHandsDonation: Math.round(positiveProfit * 0.10 * 100) / 100,
      taxReserve: Math.round(positiveProfit * 0.25 * 100) / 100,
      combinedReserve: Math.round(positiveProfit * 0.35 * 100) / 100,
      pureProfit: Math.round(positiveProfit * 0.65 * 100) / 100,
      estimatedTotal: Math.round(event.estimatedTotal * 100) / 100,
      payableTotal: Math.round(event.payableTotal * 100) / 100,
      paidTotal: Math.round(event.paidTotal * 100) / 100,
      unpaidTotal: Math.round(event.unpaidTotal * 100) / 100,
      };
    })
    .sort((a, b) => `${b.showStart} ${b.showName}`.localeCompare(`${a.showStart} ${a.showName}`));
}

function buildYearSummary(rows: PayrollCrewShowRow[]) {
  const byCrew = new Map<string, PayrollYearTechSummary>();
  for (const row of rows) {
    if (!byCrew.has(row.crewId)) {
      byCrew.set(row.crewId, {
        crewId: row.crewId,
        crewName: row.crewName,
        crewEmail: row.crewEmail,
        crewPhone: row.crewPhone,
        paidTotal: 0,
        unpaidTotal: 0,
        eventCountPaid: 0,
        eventCountUnpaid: 0,
      });
    }
    const summary = byCrew.get(row.crewId)!;
    const amount = payable(row);
    if (paymentStatusFor(row) === "paid") {
      summary.paidTotal += amount;
      summary.eventCountPaid += 1;
    } else {
      summary.unpaidTotal += amount;
      summary.eventCountUnpaid += 1;
    }
  }
  return [...byCrew.values()]
    .map((summary) => ({
      ...summary,
      paidTotal: Math.round(summary.paidTotal * 100) / 100,
      unpaidTotal: Math.round(summary.unpaidTotal * 100) / 100,
    }))
    .sort((a, b) => b.paidTotal - a.paidTotal || a.crewName.localeCompare(b.crewName));
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isUpcomingShowDate(showStart: string, today = todayKey()) {
  return Boolean(showStart) && showStart > today;
}

function viewLabel(view: ReportView) {
  return view === "current" ? "Current view" : "Estimated view";
}

function eventDefaultScheduledFor(event: PayrollEventSummary) {
  const savedDates = [...new Set(event.rows.map((row) => row.scheduledFor || "").filter(Boolean))];
  if (savedDates.length === 1) return savedDates[0];
  return event.showEnd || event.showStart || todayKey();
}

function plForEvents(events: PayrollEventSummary[]) {
  const totals = events.reduce((acc, event) => {
    acc.estimatedRevenue += event.estimatedRevenue;
    acc.contractLabor += event.payableTotal + coordinatorCostForEvent(event);
    acc.expenses += event.expenses;
    acc.estimatedProfit += event.estimatedProfit;
    acc.consecratedHandsDonation += event.consecratedHandsDonation;
    acc.taxReserve += event.taxReserve;
    acc.combinedReserve += event.combinedReserve;
    acc.pureProfit += event.pureProfit;
    return acc;
  }, { estimatedRevenue: 0, contractLabor: 0, expenses: 0, estimatedProfit: 0, consecratedHandsDonation: 0, taxReserve: 0, combinedReserve: 0, pureProfit: 0 });
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(Number(value) * 100) / 100])) as typeof totals;
}

export default function PayrollClient({ initialRows, availableYears, initialError }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [year, setYear] = useState(() => availableYears[0] ?? new Date().getFullYear());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [reportView, setReportView] = useState<ReportView>("current");
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingScheduledShowId, setSavingScheduledShowId] = useState<string | null>(null);
  const [savingFinancialShowId, setSavingFinancialShowId] = useState<string | null>(null);
  const [showTechTotals, setShowTechTotals] = useState(false);
  const [openExpenseEvents, setOpenExpenseEvents] = useState<Set<string>>(new Set());
  const [expenseDrafts, setExpenseDrafts] = useState<Record<string, ExpenseDraft>>({});
  const [savingExpenseShowId, setSavingExpenseShowId] = useState<string | null>(null);
  const [message, setMessage] = useState(initialError || "");

  const yearRows = useMemo(() => rows.filter((row) => row.showYear === year), [rows, year]);
  const viewYearRows = useMemo(() => {
    const today = todayKey();
    return reportView === "current" ? yearRows.filter((row) => !isUpcomingShowDate(row.showStart, today)) : yearRows;
  }, [yearRows, reportView]);
  const excludedFutureShowCount = useMemo(() => new Set(yearRows.filter((row) => isUpcomingShowDate(row.showStart)).map((row) => row.showId)).size, [yearRows]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return viewYearRows.filter((row) => {
      const rowStatus = paymentStatusFor(row);
      const statusOk = statusFilter === "all" || rowStatus === statusFilter;
      if (!statusOk) return false;
      if (!needle) return true;
      return [row.crewName, row.showName, row.showClient, row.showVenue, row.roles.join(" ")].join(" ").toLowerCase().includes(needle);
    });
  }, [viewYearRows, search, statusFilter]);

  const summaryEvents = useMemo(() => buildEventSummaries(viewYearRows), [viewYearRows]);
  const events = useMemo(() => buildEventSummaries(filteredRows), [filteredRows]);
  const yearSummary = useMemo(() => buildYearSummary(viewYearRows), [viewYearRows]);
  const plTotals = useMemo(() => plForEvents(summaryEvents), [summaryEvents]);
  const paidTotal = yearSummary.reduce((sum, row) => sum + row.paidTotal, 0);
  const unpaidTotal = yearSummary.reduce((sum, row) => sum + row.unpaidTotal, 0);
  const payableTotal = paidTotal + unpaidTotal;

  async function saveStatus(row: PayrollCrewShowRow, changes: Partial<SavePayload>) {
    const nextPayload: SavePayload = {
      show_id: row.showId,
      crew_id: row.crewId,
      paid: changes.paid ?? row.paid,
      payment_status: changes.payment_status ?? paymentStatusFor(row),
      payout_override: changes.payout_override === undefined ? row.overrideAmount : changes.payout_override,
      notes: changes.notes ?? row.notes,
      scheduled_for: changes.scheduled_for === undefined ? row.scheduledFor : changes.scheduled_for,
    };

    setSavingKey(row.key);
    setMessage("");
    try {
      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPayload),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; row?: { id?: string; paid?: boolean; payment_status?: PayrollPaymentStatus; payout_override?: number | null; notes?: string | null; scheduled_for?: string | null } };
      if (!response.ok || !result.ok) throw new Error(result.message || "Payroll update failed.");

      setRows((current) =>
        current.map((item) =>
          item.key === row.key
            ? {
                ...item,
                paid: Boolean(result.row?.paid),
                paymentStatus: result.row?.payment_status ?? derivePaymentStatus(Boolean(result.row?.paid) ? "paid" : "unpaid", result.row?.scheduled_for ?? null),
                overrideAmount: result.row?.payout_override ?? null,
                notes: result.row?.notes ?? "",
                scheduledFor: result.row?.scheduled_for ?? null,
                statusId: result.row?.id ?? item.statusId,
              }
            : item,
        ),
      );
      setMessage(`Updated ${row.crewName} on ${row.showName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payroll update failed.");
    } finally {
      setSavingKey(null);
    }
  }

  async function markEvent(event: PayrollEventSummary, paymentStatus: PayrollPaymentStatus) {
    const cleanStatus = paymentStatus === "paid" ? "paid" : "unpaid";
    for (const row of event.rows) {
      await saveStatus(row, { payment_status: cleanStatus, paid: cleanStatus === "paid", scheduled_for: cleanStatus === "unpaid" ? null : row.scheduledFor });
    }
  }

  async function applyScheduledForToEvent(event: PayrollEventSummary, scheduledFor: string) {
    const cleanDate = scheduledFor.trim();
    if (!cleanDate) {
      setMessage("Choose a scheduled-for date first.");
      return;
    }
    setSavingScheduledShowId(event.showId);
    setMessage("");
    try {
      for (const row of event.rows) {
        const nextStatus = paymentStatusFor(row) === "paid" ? "paid" : "scheduled";
        await saveStatus(row, { scheduled_for: cleanDate, payment_status: nextStatus, paid: nextStatus === "paid" });
      }
      setMessage(`Scheduled-for date applied to ${event.rows.length} tech${event.rows.length === 1 ? "" : "s"} on ${event.showName}.`);
    } finally {
      setSavingScheduledShowId(null);
    }
  }

  function updateLocal(rowKey: string, patch: Partial<PayrollCrewShowRow>) {
    setRows((current) => current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  }

  function updateLocalCoordinator(showId: string, patch: Partial<PayrollCrewShowRow>) {
    setRows((current) => current.map((row) => (row.showId === showId ? { ...row, ...patch } : row)));
  }

  async function saveCoordinatorPayment(event: PayrollEventSummary, changes: Partial<{ payment_status: PayrollPaymentStatus; paid: boolean; scheduled_for: string | null; payout_override: number | null; notes: string }>) {
    const current = event.coordinatorPayment;
    if (!current?.coordinatorUserId) {
      setMessage("Assign a coordinator to this show before saving coordinator payroll.");
      return;
    }
    const scheduledFor = changes.scheduled_for === undefined ? current.scheduledFor : changes.scheduled_for;
    const status = changes.payment_status ?? current.paymentStatus;
    const paymentStatus = status === "paid" ? "paid" : status === "scheduled" ? "scheduled" : scheduledFor ? "scheduled" : "unpaid";
    setSavingKey(`coordinator:${event.showId}`);
    setMessage("");
    try {
      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          record_type: "coordinator",
          show_id: event.showId,
          coordinator_user_id: current.coordinatorUserId,
          paid: paymentStatus === "paid",
          payment_status: paymentStatus,
          payout_override: changes.payout_override === undefined ? current.overrideAmount : changes.payout_override,
          notes: changes.notes ?? current.notes,
          scheduled_for: scheduledFor,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; row?: { id?: string; paid?: boolean; payment_status?: PayrollPaymentStatus; payout_override?: number | null; notes?: string | null; scheduled_for?: string | null } };
      if (!response.ok || !result.ok) throw new Error(result.message || "Coordinator payroll update failed.");
      updateLocalCoordinator(event.showId, {
        coordinatorPaymentStatus: result.row?.payment_status ?? paymentStatus,
        coordinatorPaid: Boolean(result.row?.paid),
        coordinatorScheduledFor: result.row?.scheduled_for ?? null,
        coordinatorOverrideAmount: result.row?.payout_override ?? null,
        coordinatorNotes: result.row?.notes ?? "",
        coordinatorPaymentStatusId: result.row?.id ?? current.statusId,
      });
      setMessage(`Updated coordinator payment for ${event.showName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Coordinator payroll update failed.");
    } finally {
      setSavingKey(null);
    }
  }

  function coordinatorFeeWaived(payment: PayrollCoordinatorPaymentSummary | null | undefined) {
    return Boolean(payment && payment.projectedAmount > 0 && Number(payment.overrideAmount ?? payment.payableAmount) === 0);
  }

  function addWaiverNote(notes: string | null | undefined) {
    const clean = String(notes || "").trim();
    const waiverText = "Coordinator fee waived by admin.";
    if (clean.toLowerCase().includes("coordinator fee waived")) return clean;
    return clean ? `${clean} ${waiverText}` : waiverText;
  }

  function removeWaiverNote(notes: string | null | undefined) {
    return String(notes || "")
      .replace(/\s*Coordinator fee waived by admin\.?\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function waiveCoordinatorPayment(event: PayrollEventSummary) {
    if (!event.coordinatorPayment) return;
    const nextNotes = addWaiverNote(event.coordinatorPayment.notes);
    updateLocalCoordinator(event.showId, {
      coordinatorOverrideAmount: 0,
      coordinatorPaymentStatus: "paid",
      coordinatorPaid: true,
      coordinatorScheduledFor: null,
      coordinatorNotes: nextNotes,
    });
    await saveCoordinatorPayment(event, {
      payout_override: 0,
      payment_status: "paid",
      paid: true,
      scheduled_for: null,
      notes: nextNotes,
    });
  }

  async function unwaiveCoordinatorPayment(event: PayrollEventSummary) {
    if (!event.coordinatorPayment) return;
    const nextNotes = removeWaiverNote(event.coordinatorPayment.notes);
    updateLocalCoordinator(event.showId, {
      coordinatorOverrideAmount: null,
      coordinatorPaymentStatus: "unpaid",
      coordinatorPaid: false,
      coordinatorScheduledFor: null,
      coordinatorNotes: nextNotes,
    });
    await saveCoordinatorPayment(event, {
      payout_override: null,
      payment_status: "unpaid",
      paid: false,
      scheduled_for: null,
      notes: nextNotes,
    });
  }

  function toggleDetails(rowKey: string) {
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }

  function updateEventFinancials(showId: string, patch: { revenueOverride?: number | null; expenses?: number; financialNotes?: string; expenseItems?: ShowExpenseItemRecord[]; taxReserveDone?: boolean; consecratedHandsDone?: boolean }) {
    const now = new Date().toISOString();
    setRows((current) => current.map((row) => row.showId === showId ? {
      ...row,
      showRevenueOverride: patch.revenueOverride === undefined ? row.showRevenueOverride : patch.revenueOverride,
      showExpenses: patch.expenses === undefined ? row.showExpenses : patch.expenses,
      showFinancialNotes: patch.financialNotes === undefined ? row.showFinancialNotes : patch.financialNotes,
      showExpenseItems: patch.expenseItems === undefined ? row.showExpenseItems : patch.expenseItems,
      taxReserveDone: patch.taxReserveDone === undefined ? row.taxReserveDone : patch.taxReserveDone,
      taxReserveDoneAt: patch.taxReserveDone === undefined ? row.taxReserveDoneAt : (patch.taxReserveDone ? (row.taxReserveDoneAt ?? now) : null),
      consecratedHandsDone: patch.consecratedHandsDone === undefined ? row.consecratedHandsDone : patch.consecratedHandsDone,
      consecratedHandsDoneAt: patch.consecratedHandsDone === undefined ? row.consecratedHandsDoneAt : (patch.consecratedHandsDone ? (row.consecratedHandsDoneAt ?? now) : null),
    } : row));
  }

  function toggleExpenseDropdown(showId: string) {
    setOpenExpenseEvents((current) => {
      const next = new Set(current);
      if (next.has(showId)) next.delete(showId);
      else next.add(showId);
      return next;
    });
    setExpenseDrafts((current) => current[showId] ? current : { ...current, [showId]: blankExpenseDraft() });
  }

  function updateExpenseDraft(showId: string, patch: Partial<ExpenseDraft>) {
    setExpenseDrafts((current) => {
      const existing = current[showId] ?? blankExpenseDraft();
      const next = { ...existing, ...patch };
      if (patch.category) {
        const option = commonExpenseOptions.find((item) => item.category === patch.category);
        if (option && (!patch.tax_treatment || patch.tax_treatment === existing.tax_treatment)) next.tax_treatment = option.tax;
      }
      return { ...current, [showId]: next };
    });
  }

  async function saveExpenseItem(event: PayrollEventSummary) {
    const draft = expenseDrafts[event.showId] ?? blankExpenseDraft();
    setSavingExpenseShowId(event.showId);
    setMessage("");
    try {
      const response = await fetch("/api/show-expense-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_id: event.showId, ...draft }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; item?: ShowExpenseItemRecord; total_expenses?: number };
      if (!response.ok || !result.ok || !result.item) throw new Error(result.message || "Expense save failed.");
      const nextItems = [result.item, ...event.expenseItems];
      updateEventFinancials(event.showId, { expenseItems: nextItems, expenses: result.total_expenses ?? expenseTotal(nextItems) });
      setExpenseDrafts((current) => ({ ...current, [event.showId]: blankExpenseDraft() }));
      setMessage(result.message || "Expense added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Expense save failed.");
    } finally {
      setSavingExpenseShowId(null);
    }
  }

  async function deleteExpenseItem(event: PayrollEventSummary, item: ShowExpenseItemRecord) {
    setSavingExpenseShowId(event.showId);
    setMessage("");
    try {
      const response = await fetch("/api/show-expense-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, show_id: event.showId }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; total_expenses?: number };
      if (!response.ok || !result.ok) throw new Error(result.message || "Expense delete failed.");
      const nextItems = event.expenseItems.filter((expense) => expense.id !== item.id);
      updateEventFinancials(event.showId, { expenseItems: nextItems, expenses: result.total_expenses ?? expenseTotal(nextItems) });
      setMessage(result.message || "Expense removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Expense delete failed.");
    } finally {
      setSavingExpenseShowId(null);
    }
  }

  async function saveEventFinancials(event: PayrollEventSummary) {
    setSavingFinancialShowId(event.showId);
    setMessage("");
    try {
      const response = await fetch("/api/show-financials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_id: event.showId,
          estimated_revenue_override: event.revenueOverride,
          expenses: event.expenses,
          notes: event.financialNotes,
          tax_reserve_done: event.taxReserveDone,
          tax_reserve_done_at: event.taxReserveDoneAt,
          consecrated_hands_done: event.consecratedHandsDone,
          consecrated_hands_done_at: event.consecratedHandsDoneAt,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Financial update failed.");
      setMessage(`${event.showName} financials saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Financial update failed.");
    } finally {
      setSavingFinancialShowId(null);
    }
  }

  function openPdf(document: ExportDocument, filename: string) {
    exportDocumentPdf(document, filename);
    setMessage("PDF export opened. Choose Save as PDF in the print window.");
  }

  function companyPLRows(includeReserves: boolean): Array<Array<string | number | null | undefined>> {
    const header = includeReserves
      ? ["Show", "Client", "Venue", "Dates", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit", "Tax Reserve", "Tax Reserve Set Aside", "Consecrated Hands", "Consecrated Hands Done", "Tax + Consecrated Hands", "Pure Profit", "Financial Notes"]
      : ["Show", "Client", "Venue", "Dates", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit", "Tax Reserve Set Aside", "Consecrated Hands Done", "Financial Notes"];
    const rows = summaryEvents.map((event) => includeReserves ? [
      event.showName,
      event.showClient,
      event.showVenue,
      `${event.showStart} to ${event.showEnd}`,
      event.estimatedRevenue,
      event.payableTotal + coordinatorCostForEvent(event),
      event.expenses,
      event.estimatedProfit,
      event.taxReserve,
      event.taxReserveDone ? "YES" : "NO",
      event.consecratedHandsDonation,
      event.consecratedHandsDone ? "YES" : "NO",
      event.combinedReserve,
      event.pureProfit,
      event.financialNotes,
    ] : [
      event.showName,
      event.showClient,
      event.showVenue,
      `${event.showStart} to ${event.showEnd}`,
      event.estimatedRevenue,
      event.payableTotal + coordinatorCostForEvent(event),
      event.expenses,
      event.estimatedProfit,
      event.taxReserveDone ? "YES" : "NO",
      event.consecratedHandsDone ? "YES" : "NO",
      event.financialNotes,
    ]);
    return [header, ...rows];
  }

  function companyPLDocument(includeReserves: boolean): ExportDocument {
    return {
      title: includeReserves ? "Emanuel Labor Services Owner P&L with Optional Reserves" : "Emanuel Labor Services Company P&L",
      subtitle: `${year} • ${viewLabel(reportView)}`,
      meta: includeReserves ? [
        ["Estimated Revenue", money(plTotals.estimatedRevenue)],
        ["Contract Labor", money(plTotals.contractLabor)],
        ["Expenses", money(plTotals.expenses)],
        ["Net Profit", money(plTotals.estimatedProfit)],
        ["Tax Reserve", money(plTotals.taxReserve)],
        ["Consecrated Hands", money(plTotals.consecratedHandsDonation)],
        ["Pure Profit", money(plTotals.pureProfit)],
      ] : [
        ["Estimated Revenue", money(plTotals.estimatedRevenue)],
        ["Contract Labor", money(plTotals.contractLabor)],
        ["Expenses", money(plTotals.expenses)],
        ["Net Profit", money(plTotals.estimatedProfit)],
      ],
      sections: [{
        heading: "Show summary",
        columns: companyPLRows(includeReserves)[0].map(String),
        rows: companyPLRows(includeReserves).slice(1),
      }],
    };
  }

  function nec1099Rows(): Array<Array<string | number | null | undefined>> {
    return [
      ["Tax Year", "Contractor Name", "Legal Name", "TIN", "Address Line 1", "Address Line 2", "City", "State", "ZIP", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "Paid Events", "Unpaid Events", "Notes"],
      ...yearSummary.map((row) => [
        year,
        row.crewName,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        row.crewEmail,
        row.crewPhone,
        row.paidTotal,
        row.unpaidTotal,
        row.paidTotal >= 600 ? "YES" : "NO",
        row.eventCountPaid,
        row.eventCountUnpaid,
        row.paidTotal >= 600 ? "Collect W-9 / verify TIN and address before filing" : "Below $600 paid threshold",
      ]),
    ];
  }

  function nec1099Document(): ExportDocument {
    const rows = nec1099Rows();
    return {
      title: "Emanuel Labor Services 1099-NEC Prep",
      subtitle: `${year} • Contractors paid $600+ flagged`,
      meta: [["Tax Year", year], ["Report View", viewLabel(reportView)], ["Contractors", yearSummary.length]],
      sections: [{ heading: "1099-NEC contractor preparation", columns: rows[0].map(String), rows: rows.slice(1) }],
    };
  }

  function yearSummaryRows(): Array<Array<string | number | null | undefined>> {
    return [
      ["Tax Year", "Contractor", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "Paid Events", "Unpaid Events"],
      ...yearSummary.map((row) => [year, row.crewName, row.crewEmail, row.crewPhone, row.paidTotal, row.unpaidTotal, row.paidTotal >= 600 ? "YES" : "NO", row.eventCountPaid, row.eventCountUnpaid]),
    ];
  }

  function yearSummaryDocument(): ExportDocument {
    const rows = yearSummaryRows();
    return {
      title: "Emanuel Labor Services Payroll Summary",
      subtitle: `${year} • ${viewLabel(reportView)}`,
      meta: [["Estimated Revenue", money(plTotals.estimatedRevenue)], ["Contract Labor", money(plTotals.contractLabor)], ["Expenses", money(plTotals.expenses)], ["Net Profit", money(plTotals.estimatedProfit)]],
      sections: [{ heading: "Contractor summary", columns: rows[0].map(String), rows: rows.slice(1) }],
    };
  }

  function eventPayrollRows(event: PayrollEventSummary): Array<Array<string | number | null | undefined>> {
    const coordinator = event.coordinatorPayment;
    return [
      ["Show", "Crew", "Roles", "Estimated", "Override", "Payable", "Scheduled For", "Status", "Phone", "Email", "Notes"],
      ...event.rows.map((row) => [row.showName, row.crewName, row.roles.join(" / "), row.estimatedTotal, row.overrideAmount ?? "", payable(row), row.scheduledFor || "", paymentStatusLabel(paymentStatusFor(row)), row.crewPhone, row.crewEmail, row.notes]),
      ...(coordinator ? [[event.showName, coordinator.coordinatorName, "Labor Coordinator", coordinator.projectedAmount, coordinator.overrideAmount ?? "", coordinator.payableAmount, coordinator.scheduledFor || "", paymentStatusLabel(coordinator.paymentStatus), "", "", coordinator.notes]] : []),
    ];
  }

  function eventPayrollDocument(event: PayrollEventSummary): ExportDocument {
    const rows = eventPayrollRows(event);
    return {
      title: `${event.showName} Payroll`,
      subtitle: `${event.showClient || "No client"} • ${event.showVenue || "No venue"}`,
      meta: [
        ["Dates", `${formatPayrollDate(event.showStart)} to ${formatPayrollDate(event.showEnd)}`],
        ["Estimated Revenue", money(event.estimatedRevenue)],
        ["Contract Labor", money(event.payableTotal + coordinatorCostForEvent(event))],
        ["Expenses", money(event.expenses)],
        ["Net Profit", money(event.estimatedProfit)],
        ["Tax Reserve Set Aside", event.taxReserveDone ? "YES" : "NO"],
        ["Consecrated Hands Done", event.consecratedHandsDone ? "YES" : "NO"],
      ],
      sections: [{ heading: "Crew payout detail", columns: rows[0].map(String), rows: rows.slice(1) }],
    };
  }

  function exportOwnerPLCsv() {
    downloadCsv(`ELS_${year}_${reportView}_company_PL.csv`, [
      ["View", viewLabel(reportView)],
      ["Year", year],
      ["Estimated Revenue", "Contract Labor", "Expenses", "Net Profit"],
      [plTotals.estimatedRevenue, plTotals.contractLabor, plTotals.expenses, plTotals.estimatedProfit],
      [],
      ["Show", "Client", "Venue", "Dates", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit", "Tax Reserve Set Aside", "Consecrated Hands Done", "Financial Notes"],
      ...summaryEvents.map((event) => [event.showName, event.showClient, event.showVenue, `${event.showStart} to ${event.showEnd}`, event.estimatedRevenue, event.payableTotal + coordinatorCostForEvent(event), event.expenses, event.estimatedProfit, event.taxReserveDone ? "YES" : "NO", event.consecratedHandsDone ? "YES" : "NO", event.financialNotes]),
    ]);
  }

  function exportOwnerPLWithReservesCsv() {
    downloadCsv(`ELS_${year}_${reportView}_owner_PL_with_reserves.csv`, [
      ["View", viewLabel(reportView)],
      ["Year", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit", "Tax Reserve", "Consecrated Hands", "Tax + Consecrated Hands", "Pure Profit"],
      [year, plTotals.estimatedRevenue, plTotals.contractLabor, plTotals.expenses, plTotals.estimatedProfit, plTotals.taxReserve, plTotals.consecratedHandsDonation, plTotals.combinedReserve, plTotals.pureProfit],
      [],
      ["Show", "Client", "Venue", "Dates", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit", "Tax Reserve", "Tax Reserve Set Aside", "Consecrated Hands", "Consecrated Hands Done", "Tax + Consecrated Hands", "Pure Profit", "Financial Notes"],
      ...summaryEvents.map((event) => [
        event.showName,
        event.showClient,
        event.showVenue,
        `${event.showStart} to ${event.showEnd}`,
        event.estimatedRevenue,
        event.payableTotal + coordinatorCostForEvent(event),
        event.expenses,
        event.estimatedProfit,
        event.taxReserve,
        event.taxReserveDone ? "YES" : "NO",
        event.consecratedHandsDonation,
        event.consecratedHandsDone ? "YES" : "NO",
        event.combinedReserve,
        event.pureProfit,
        event.financialNotes,
      ]),
    ]);
  }

  function export1099PrepCsv() {
    downloadCsv(`ELS_${year}_1099_NEC_contractors.csv`, [
      ["Tax Year", "Contractor Name", "Legal Name", "TIN", "Address Line 1", "Address Line 2", "City", "State", "ZIP", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "Paid Events", "Unpaid Events", "Notes"],
      ...yearSummary.map((row) => [
        year,
        row.crewName,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        row.crewEmail,
        row.crewPhone,
        row.paidTotal,
        row.unpaidTotal,
        row.paidTotal >= 600 ? "YES" : "NO",
        row.eventCountPaid,
        row.eventCountUnpaid,
        row.paidTotal >= 600 ? "Collect W-9 / verify TIN and address before filing" : "Below $600 paid threshold",
      ]),
    ]);
  }

  function exportYearSummaryCsv() {
    downloadCsv(`ELS_${year}_${reportView}_payroll_and_1099_summary.csv`, [
      ["Company P&L", viewLabel(reportView)],
      ["Year", year],
      ["Estimated Revenue", "Contract Labor", "Expenses", "Net Profit"],
      [plTotals.estimatedRevenue, plTotals.contractLabor, plTotals.expenses, plTotals.estimatedProfit],
      [],
      ["Tax Year", "Contractor", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "Paid Events", "Unpaid Events"],
      ...yearSummary.map((row) => [year, row.crewName, row.crewEmail, row.crewPhone, row.paidTotal, row.unpaidTotal, row.paidTotal >= 600 ? "YES" : "NO", row.eventCountPaid, row.eventCountUnpaid]),
    ]);
  }

  function exportEventCsv(event: PayrollEventSummary) {
    downloadCsv(`${event.showName.replace(/[^a-z0-9]+/gi, "_")}_payroll.csv`, [
      ["Show P&L", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit", "Tax Reserve", "Tax Reserve Set Aside", "Consecrated Hands", "Consecrated Hands Done"],
      [event.showName, event.estimatedRevenue, event.payableTotal + coordinatorCostForEvent(event), event.expenses, event.estimatedProfit, event.taxReserve, event.taxReserveDone ? "YES" : "NO", event.consecratedHandsDonation, event.consecratedHandsDone ? "YES" : "NO"],
      [],
      ["Show", "Crew", "Roles", "Estimated", "Override", "Payable", "Scheduled For", "Status", "Phone", "Email", "Notes"],
      ...event.rows.map((row) => [row.showName, row.crewName, row.roles.join(" / "), row.estimatedTotal, row.overrideAmount ?? "", payable(row), row.scheduledFor || "", paymentStatusLabel(paymentStatusFor(row)), row.crewPhone, row.crewEmail, row.notes]),
      ...((event.coordinatorPayments?.length ? event.coordinatorPayments : event.coordinatorPayment ? [event.coordinatorPayment] : []).map((payment) => [event.showName, payment.coordinatorName, "Labor Coordinator", payment.projectedAmount, payment.overrideAmount ?? "", payment.payableAmount, payment.scheduledFor || "", paymentStatusLabel(payment.paymentStatus), "", "", payment.notes])),
    ]);
  }

  function exportOwnerPLPdf() { openPdf(companyPLDocument(false), `ELS_${year}_${reportView}_company_PL`); }
  function exportOwnerPLDocx() { exportDocumentDocx(companyPLDocument(false), `ELS_${year}_${reportView}_company_PL`); }
  function exportOwnerPLWithReservesPdf() { openPdf(companyPLDocument(true), `ELS_${year}_${reportView}_owner_PL_with_reserves`); }
  function exportOwnerPLWithReservesDocx() { exportDocumentDocx(companyPLDocument(true), `ELS_${year}_${reportView}_owner_PL_with_reserves`); }
  function export1099PrepPdf() { openPdf(nec1099Document(), `ELS_${year}_1099_NEC_contractors`); }
  function export1099PrepDocx() { exportDocumentDocx(nec1099Document(), `ELS_${year}_1099_NEC_contractors`); }
  function exportYearSummaryPdf() { openPdf(yearSummaryDocument(), `ELS_${year}_${reportView}_payroll_and_1099_summary`); }
  function exportYearSummaryDocx() { exportDocumentDocx(yearSummaryDocument(), `ELS_${year}_${reportView}_payroll_and_1099_summary`); }
  function exportEventPdf(event: PayrollEventSummary) { openPdf(eventPayrollDocument(event), `${event.showName.replace(/[^a-z0-9]+/gi, "_")}_payroll`); }
  function exportEventDocx(event: PayrollEventSummary) { exportDocumentDocx(eventPayrollDocument(event), `${event.showName.replace(/[^a-z0-9]+/gi, "_")}_payroll`); }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {message ? <p className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("run supabase") ? "error" : "success"}>{message}</p> : null}

      <section className="grid grid-3">
        <div className="card compact">
          <div className="muted small">{viewLabel(reportView)} payable</div>
          <div style={{ fontSize: 30, fontWeight: 850 }}>{money(payableTotal)}</div>
        </div>
        <div className="card compact">
          <div className="muted small">Marked paid</div>
          <div style={{ fontSize: 30, fontWeight: 850, color: "#067647" }}>{money(paidTotal)}</div>
        </div>
        <div className="card compact">
          <div className="muted small">Still unpaid</div>
          <div style={{ fontSize: 30, fontWeight: 850, color: "#b42318" }}>{money(unpaidTotal)}</div>
        </div>
      </section>

      <section className="card accent-card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{year} owner P&L</h2>
            <p className="muted" style={{ margin: 0 }}>{viewLabel(reportView)}. Current view excludes future shows from payable, unpaid, and P&L totals. Estimated view includes all scheduled shows for planning. Contract labor includes tech payouts plus non-waived coordinator pay.</p>
            {reportView === "current" && excludedFutureShowCount ? <p className="muted small" style={{ margin: "8px 0 0" }}>{excludedFutureShowCount} future show{excludedFutureShowCount === 1 ? "" : "s"} excluded from the current view.</p> : null}
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <label className="field" style={{ minWidth: 170 }}>
              P&L view
              <select value={reportView} onChange={(event) => setReportView(event.target.value as ReportView)}>
                <option value="current">Current: active/past only</option>
                <option value="estimated">Estimated: include future</option>
              </select>
            </label>
            <button className="ghost" type="button" onClick={exportOwnerPLPdf}>PDF Company P&L</button><button className="ghost" type="button" onClick={exportOwnerPLDocx}>DOCX</button><button className="ghost" type="button" onClick={exportOwnerPLCsv}>CSV</button><button className="ghost" type="button" onClick={exportOwnerPLWithReservesPdf}>PDF reserves</button><button className="ghost" type="button" onClick={exportOwnerPLWithReservesDocx}>Reserve DOCX</button><button className="ghost" type="button" onClick={export1099PrepPdf}>PDF 1099 Prep</button><button className="ghost" type="button" onClick={export1099PrepDocx}>1099 DOCX</button><button className="ghost" type="button" onClick={export1099PrepCsv}>1099 CSV</button></div>
        </div>
        <div className="pl-grid" style={{ marginTop: 14 }}>
          <div className="card compact"><div className="muted small">Estimated revenue</div><strong>{money(plTotals.estimatedRevenue)}</strong></div>
          <div className="card compact"><div className="muted small">Contract labor</div><strong>{money(plTotals.contractLabor)}</strong><div className="muted small">Tech payouts + non-waived coordinator pay</div></div>
          <div className="card compact"><div className="muted small">Expenses</div><strong>{money(plTotals.expenses)}</strong></div>
          <div className="card compact"><div className="muted small">Net profit</div><strong>{money(plTotals.estimatedProfit)}</strong></div>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Payroll by event</h2>
            <p className="muted" style={{ margin: 0 }}>Each event shows what every assigned tech is estimated to make. Set payroll status to Unpaid, Scheduled, or Paid and keep yearly paid totals for 1099 prep.</p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}><button className="ghost" type="button" onClick={exportYearSummaryPdf}>PDF Payroll Summary</button><button className="ghost" type="button" onClick={exportYearSummaryDocx}>DOCX</button><button className="ghost" type="button" onClick={exportYearSummaryCsv}>CSV</button><button className="ghost" type="button" onClick={export1099PrepPdf}>PDF 1099 Prep</button><button className="ghost" type="button" onClick={export1099PrepDocx}>1099 DOCX</button><button className="ghost" type="button" onClick={export1099PrepCsv}>1099 CSV</button></div>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <label className="field" style={{ minWidth: 150 }}>
            Year
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {availableYears.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field" style={{ minWidth: 210, flex: 1 }}>
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Show, crew, role, client..." />
          </label>
          <label className="field" style={{ minWidth: 170 }}>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All payroll</option>
              <option value="unpaid">Unpaid only</option>
              <option value="scheduled">Scheduled only</option>
              <option value="paid">Paid only</option>
            </select>
          </label>
          <label className="field" style={{ minWidth: 210 }}>
            View
            <select value={reportView} onChange={(event) => setReportView(event.target.value as ReportView)}>
              <option value="current">Current: active/past only</option>
              <option value="estimated">Estimated: include future</option>
            </select>
          </label>
          <button className="ghost" type="button" onClick={() => setShowTechTotals((value) => !value)}>
            {showTechTotals ? "Hide total techs" : "Show total techs"}
          </button>
        </div>
      </section>

      {showTechTotals ? (
      <section className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{year} tech totals</h2>
            <p className="muted" style={{ margin: 0 }}>This is the {viewLabel(reportView).toLowerCase()} paid total per contractor. Anyone paid $600 or more is flagged for 1099-NEC preparation.</p>
          </div>
          <span className="badge">{yearSummary.length} techs</span>
        </div>
        <div className="mobile-table" style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "10px 8px" }}>Tech</th>
                <th style={{ padding: "10px 8px" }}>Phone</th>
                <th style={{ padding: "10px 8px" }}>Paid total</th>
                <th style={{ padding: "10px 8px" }}>Unpaid/open</th>
                <th style={{ padding: "10px 8px" }}>1099</th>
                <th style={{ padding: "10px 8px" }}>Events</th>
              </tr>
            </thead>
            <tbody>
              {yearSummary.map((summary) => (
                <tr key={summary.crewId} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 8px" }}><strong>{summary.crewName}</strong><div className="muted small">{summary.crewEmail}</div></td>
                  <td style={{ padding: "10px 8px" }}>{summary.crewPhone || "—"}</td>
                  <td style={{ padding: "10px 8px", fontWeight: 800 }}>{money(summary.paidTotal)}</td>
                  <td style={{ padding: "10px 8px" }}>{money(summary.unpaidTotal)}</td>
                  <td style={{ padding: "10px 8px" }}><span className={summary.paidTotal >= 600 ? "badge event-badge-current" : "badge"}>{summary.paidTotal >= 600 ? "Required" : "Below $600"}</span></td>
                  <td style={{ padding: "10px 8px" }}>{summary.eventCountPaid} paid / {summary.eventCountUnpaid} unpaid</td>
                </tr>
              ))}
              {yearSummary.length === 0 ? (
                <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No assigned crew found for {year}.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      <div className="list">
        {events.map((event) => (
          <section key={event.showId} className="card" style={{ borderTop: "4px solid var(--brand)" }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>{event.showName}</h2>
                <p className="muted" style={{ margin: 0 }}>{event.showClient || "No client"} • {event.showVenue || "No venue"} • {formatPayrollDate(event.showStart)} to {formatPayrollDate(event.showEnd)}</p>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <span className="badge">{event.rows.length} techs</span>
                  <span className="badge">Tech payable {money(event.payableTotal)}</span>
                  <span className="badge">Paid {money(event.paidTotal)}</span>
                  <span className="badge">Unpaid {money(event.unpaidTotal)}</span>
                </div>
                <div className="pl-grid" style={{ marginTop: 12 }}>
                  <span className="badge">Revenue {money(event.estimatedRevenue)}</span>
                  <span className="badge">Labor {money(event.payableTotal + coordinatorCostForEvent(event))}</span>
                  <span className="badge">Expenses {money(event.expenses)}</span>
                  <span className="badge">Net profit {money(event.estimatedProfit)}</span>
                  <span className={event.taxReserveDone ? "badge event-badge-current" : "badge"}>Taxes {event.taxReserveDone ? "set aside" : "open"}</span>
                  <span className={event.consecratedHandsDone ? "badge event-badge-current" : "badge"}>Consecrated Hands {event.consecratedHandsDone ? "done" : "open"}</span>
                </div>
              </div>
              <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                <button className="ghost" type="button" onClick={() => exportEventPdf(event)}>PDF event</button>
                <button className="ghost" type="button" onClick={() => exportEventDocx(event)}>DOCX</button>
                <button className="ghost" type="button" onClick={() => exportEventCsv(event)}>CSV</button>
                <button className="ghost" type="button" onClick={() => void markEvent(event, "paid")}>Mark event paid</button>
                <button className="ghost" type="button" onClick={() => void markEvent(event, "unpaid")}>Mark event unpaid</button>
              </div>
            </div>

            {event.coordinatorPayment ? (
              <div className="card compact" style={{ marginTop: 14, background: "#fbfcfd", boxShadow: "none" }}>
                <div className="row" style={{ alignItems: "flex-end" }}>
                  <div>
                    <strong>Coordinator payment</strong>
                    <div className="small muted">
                      {event.coordinatorPayment.coordinatorName} · {event.coordinatorPayment.fullDayTechDays} full-day tech-days · {event.coordinatorPayment.halfDayTechs} half-day techs
                    </div>
                    {coordinatorFeeWaived(event.coordinatorPayment) ? (
                      <div className="small" style={{ marginTop: 4 }}>
                        <strong>Waived:</strong> this coordinator fee is not deducted from contract labor or P&amp;L expenses.
                      </div>
                    ) : null}
                    <div className="toolbar" style={{ marginTop: 8 }}>
                      <span className="badge">Projected {money(event.coordinatorPayment.projectedAmount)}</span>
                      <span className="badge">Payable {money(event.coordinatorPayment.payableAmount)}</span>
                      {coordinatorFeeWaived(event.coordinatorPayment) ? <span className="badge event-badge-current">Waived</span> : paymentStatusBadge(event.coordinatorPayment.paymentStatus)}
                    </div>
                  </div>
                  <div className="toolbar">
                    {coordinatorFeeWaived(event.coordinatorPayment) ? (
                      <button type="button" className="ghost" disabled={savingKey === `coordinator:${event.showId}`} onClick={() => void unwaiveCoordinatorPayment(event)}>
                        Unwaive fee
                      </button>
                    ) : (
                      <button type="button" className="ghost" disabled={savingKey === `coordinator:${event.showId}`} onClick={() => void waiveCoordinatorPayment(event)}>
                        Waive coordinator fee
                      </button>
                    )}
                  </div>
                  <label className="field" style={{ minWidth: 130 }}>
                    Override
                    <input
                      inputMode="decimal"
                      value={event.coordinatorPayment.overrideAmount ?? ""}
                      placeholder="auto"
                      onChange={(inputEvent) => updateLocalCoordinator(event.showId, { coordinatorOverrideAmount: inputEvent.target.value.trim() === "" ? null : Number(inputEvent.target.value) })}
                      onBlur={(inputEvent) => void saveCoordinatorPayment(event, { payout_override: inputEvent.currentTarget.value.trim() === "" ? null : Number(inputEvent.currentTarget.value) })}
                    />
                  </label>
                  <label className="field" style={{ minWidth: 160 }}>
                    Scheduled for
                    <input
                      type="date"
                      value={event.coordinatorPayment.scheduledFor || ""}
                      onChange={(inputEvent) => {
                        const nextDate = inputEvent.target.value || null;
                        const nextStatus: PayrollPaymentStatus = event.coordinatorPayment?.paymentStatus === "paid" ? "paid" : nextDate ? "scheduled" : "unpaid";
                        updateLocalCoordinator(event.showId, { coordinatorScheduledFor: nextDate, coordinatorPaymentStatus: nextStatus, coordinatorPaid: nextStatus === "paid" });
                        void saveCoordinatorPayment(event, { scheduled_for: nextDate, payment_status: nextStatus, paid: nextStatus === "paid" });
                      }}
                    />
                  </label>
                  <label className="field" style={{ minWidth: 150 }}>
                    Status
                    <select
                      value={event.coordinatorPayment.paymentStatus}
                      disabled={savingKey === `coordinator:${event.showId}`}
                      style={{ ...paymentStatusStyle(event.coordinatorPayment.paymentStatus), minWidth: 130, padding: "8px 10px", border: "1px solid", borderRadius: 10 }}
                      onChange={(selectEvent) => {
                        const nextStatus = selectEvent.target.value as PayrollPaymentStatus;
                        const nextScheduledFor = nextStatus === "scheduled" ? (event.coordinatorPayment?.scheduledFor || eventDefaultScheduledFor(event)) : nextStatus === "unpaid" ? null : event.coordinatorPayment?.scheduledFor || null;
                        updateLocalCoordinator(event.showId, { coordinatorPaymentStatus: nextStatus, coordinatorPaid: nextStatus === "paid", coordinatorScheduledFor: nextScheduledFor });
                        void saveCoordinatorPayment(event, { payment_status: nextStatus, paid: nextStatus === "paid", scheduled_for: nextScheduledFor });
                      }}
                    >
                      <option value="unpaid">Unpaid</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="paid">Paid</option>
                    </select>
                  </label>
                  <label className="field" style={{ minWidth: 220, flex: 1 }}>
                    Notes
                    <input
                      value={event.coordinatorPayment.notes}
                      placeholder="Invoice, confirmation, or payment note..."
                      onChange={(inputEvent) => updateLocalCoordinator(event.showId, { coordinatorNotes: inputEvent.target.value })}
                      onBlur={(inputEvent) => void saveCoordinatorPayment(event, { notes: inputEvent.currentTarget.value })}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {(event.coordinatorPayments ?? []).filter((payment) => payment.coordinatorUserId !== event.coordinatorPayment?.coordinatorUserId).length ? (
              <div className="card compact" style={{ marginTop: 14, background: "#fffdf2", boxShadow: "none", borderLeft: "4px solid #d4a62a" }}>
                <strong>Admin coordination credits</strong>
                <div className="small muted" style={{ marginTop: 4 }}>Admin-owned crew added outside the assigned coordinator payout.</div>
                <div className="toolbar" style={{ marginTop: 8 }}>
                  {(event.coordinatorPayments ?? []).filter((payment) => payment.coordinatorUserId !== event.coordinatorPayment?.coordinatorUserId).map((payment) => (
                    <span key={payment.coordinatorUserId || payment.coordinatorName} className="badge">
                      {payment.coordinatorName}: {payment.fullDayTechDays} full-day / {payment.halfDayTechs} half-day · {money(payment.payableAmount)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="card compact" style={{ marginTop: 14, background: "#fbfcfd", boxShadow: "none" }}>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <div>
                  <strong>Payment scheduled-for date</strong>
                  <div className="small muted">Set one default date for every tech on this show, then adjust individual techs below only if needed.</div>
                </div>
                <label className="field" style={{ minWidth: 220 }}>
                  Event default date
                  <input
                    type="date"
                    defaultValue={eventDefaultScheduledFor(event)}
                    id={`scheduled-for-${event.showId}`}
                  />
                </label>
                <button
                  className="primary"
                  type="button"
                  disabled={savingScheduledShowId === event.showId}
                  onClick={() => {
                    const input = document.getElementById(`scheduled-for-${event.showId}`) as HTMLInputElement | null;
                    void applyScheduledForToEvent(event, input?.value || "");
                  }}
                >
                  {savingScheduledShowId === event.showId ? "Saving..." : "Apply to everyone"}
                </button>
              </div>
            </div>

            <div className="card compact" style={{ marginTop: 14 }}>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label className="field" style={{ minWidth: 180 }}>
                  Revenue override
                  <input
                    inputMode="decimal"
                    value={event.revenueOverride ?? ""}
                    placeholder={money(event.estimatedRevenue)}
                    onChange={(e) => updateEventFinancials(event.showId, { revenueOverride: e.target.value.trim() === "" ? null : Number(e.target.value) })}
                  />
                </label>
                <label className="field" style={{ minWidth: 180 }}>
                  {event.expenseItems.length ? "Expense total" : "Manual expenses"}
                  <input
                    inputMode="decimal"
                    value={event.expenses || ""}
                    placeholder="0"
                    readOnly={Boolean(event.expenseItems.length)}
                    title={event.expenseItems.length ? "Detailed expense items are controlling this total." : "Use this for a simple total, or open the expense dropdown for itemized expenses."}
                    onChange={(e) => updateEventFinancials(event.showId, { expenses: e.target.value.trim() === "" ? 0 : Number(e.target.value) })}
                  />
                  <span className="small muted">{event.expenseItems.length ? "Controlled by itemized expenses below." : "Use dropdown below to itemize by category."}</span>
                </label>
                <label className="field" style={{ minWidth: 210 }}>
                  Reserve checkoff
                  <span className="small" style={{ display: "grid", gap: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={event.taxReserveDone} onChange={(e) => updateEventFinancials(event.showId, { taxReserveDone: e.target.checked })} /> Taxes set aside ({money(event.taxReserve)})</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={event.consecratedHandsDone} onChange={(e) => updateEventFinancials(event.showId, { consecratedHandsDone: e.target.checked })} /> Consecrated Hands ({money(event.consecratedHandsDonation)})</label>
                  </span>
                </label>
                <label className="field" style={{ minWidth: 260, flex: 1 }}>
                  P&L notes
                  <input
                    value={event.financialNotes}
                    placeholder="Invoice number, reimbursables, expense notes..."
                    onChange={(e) => updateEventFinancials(event.showId, { financialNotes: e.target.value })}
                  />
                </label>
                <button className="ghost" type="button" disabled={savingFinancialShowId === event.showId} onClick={() => void saveEventFinancials(event)}>
                  {savingFinancialShowId === event.showId ? "Saving..." : "Save P&L"}
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                <button className="ghost" type="button" onClick={() => toggleExpenseDropdown(event.showId)}>
                  {openExpenseEvents.has(event.showId) ? "Hide expense dropdown" : "Open expense dropdown"}
                </button>
                <span className="small muted" style={{ marginLeft: 10 }}>Add tax-category expense items only when you need them. Keep receipts and confirm tax treatment with your CPA.</span>
              </div>
              {openExpenseEvents.has(event.showId) ? (() => {
                const draft = expenseDrafts[event.showId] ?? blankExpenseDraft();
                const selectedExpenseOption = commonExpenseOptions.find((option) => option.category === draft.category) || commonExpenseOptions[0];
                return (
                  <div className="card compact" style={{ marginTop: 12, background: "#fbfcfd", boxShadow: "none" }}>
                    <div className="row" style={{ alignItems: "flex-start" }}>
                      <div>
                        <strong>Event expense details</strong>
                        <div className="small muted">Common show-related expense categories are preloaded. A business expense still has to be ordinary and necessary, and meals may be limited.</div>
                      </div>
                      <span className="badge">Itemized {money(expenseTotal(event.expenseItems))}</span>
                    </div>
                    <div className="grid grid-3" style={{ marginTop: 12 }}>
                      <label className="field">
                        Category
                        <select value={draft.category} onChange={(e) => updateExpenseDraft(event.showId, { category: e.target.value })}>
                          {commonExpenseOptions.map((option) => <option key={option.category} value={option.category}>{option.category}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        Amount
                        <input inputMode="decimal" value={draft.amount} placeholder="0.00" onChange={(e) => updateExpenseDraft(event.showId, { amount: e.target.value })} />
                      </label>
                      <label className="field">
                        Expense date
                        <input type="date" value={draft.expense_date} onChange={(e) => updateExpenseDraft(event.showId, { expense_date: e.target.value })} />
                      </label>
                      <label className="field">
                        What it was for
                        <input value={draft.description} placeholder={selectedExpenseOption.help} onChange={(e) => updateExpenseDraft(event.showId, { description: e.target.value })} />
                      </label>
                      <label className="field">
                        Tax treatment
                        <select value={draft.tax_treatment} onChange={(e) => updateExpenseDraft(event.showId, { tax_treatment: e.target.value })}>
                          <option>Likely deductible if ordinary and necessary</option>
                          <option>Meals are generally limited to 50%</option>
                          <option>Business portion only</option>
                          <option>Needs mileage log / CPA review</option>
                          <option>Track separately / reimbursable</option>
                          <option>Needs review</option>
                        </select>
                      </label>
                      <label className="field">
                        Receipt status
                        <select value={draft.receipt_status} onChange={(e) => updateExpenseDraft(event.showId, { receipt_status: e.target.value })}>
                          <option>Receipt needed</option>
                          <option>Receipt saved</option>
                          <option>Receipt attached to invoice</option>
                          <option>Client reimbursed</option>
                          <option>No receipt / explain in notes</option>
                        </select>
                      </label>
                    </div>
                    <label className="field" style={{ marginTop: 10 }}>
                      Notes
                      <input value={draft.notes} placeholder="Receipt location, client reimbursable note, mileage detail, or CPA note..." onChange={(e) => updateExpenseDraft(event.showId, { notes: e.target.value })} />
                    </label>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <button type="button" className="primary" disabled={savingExpenseShowId === event.showId || !draft.amount.trim()} onClick={() => void saveExpenseItem(event)}>{savingExpenseShowId === event.showId ? "Saving..." : "Add expense item"}</button>
                    </div>
                    <div className="list" style={{ marginTop: 12 }}>
                      {event.expenseItems.map((item) => (
                        <div key={item.id} className="card compact" style={{ boxShadow: "none" }}>
                          <div className="row" style={{ alignItems: "flex-start" }}>
                            <div>
                              <strong>{item.category} · {money(Number(item.amount || 0))}</strong>
                              <div className="muted small">{item.description || "No description"}</div>
                              <div className="small">{item.tax_treatment || "Needs review"} · {item.receipt_status || "Receipt needed"}{item.expense_date ? ` · ${item.expense_date}` : ""}</div>
                              {item.notes ? <div className="muted small">{item.notes}</div> : null}
                            </div>
                            <button type="button" className="ghost" disabled={savingExpenseShowId === event.showId} onClick={() => void deleteExpenseItem(event, item)}>Remove</button>
                          </div>
                        </div>
                      ))}
                      {event.expenseItems.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No itemized expenses saved yet. Manual expense total is still available above.</p> : null}
                    </div>
                  </div>
                );
              })() : null}
            </div>

            <div className="mobile-table" style={{ overflowX: "auto", marginTop: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: "10px 8px" }}>Tech</th>
                    <th style={{ padding: "10px 8px" }}>Roles</th>
                    <th style={{ padding: "10px 8px" }}>Calls</th>
                    <th style={{ padding: "10px 8px" }}>Estimated</th>
                    <th style={{ padding: "10px 8px" }}>Override</th>
                    <th style={{ padding: "10px 8px" }}>Payable</th>
                    <th style={{ padding: "10px 8px" }}>Scheduled for</th>
                    <th style={{ padding: "10px 8px" }}>Status</th>
                    <th style={{ padding: "10px 8px" }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {event.rows.map((row) => {
                    const isSaving = savingKey === row.key;
                    const isOpen = openRows.has(row.key);
                    return (
                      <tr key={row.key} style={{ borderBottom: "1px solid var(--line)", verticalAlign: "top" }}>
                        <td style={{ padding: "12px 8px", minWidth: 190 }}>
                          <strong>{row.crewName}</strong>
                          <div className="muted small">{row.crewPhone || row.crewEmail || "No contact"}</div>
                        </td>
                        <td style={{ padding: "12px 8px", minWidth: 160 }}>{row.roles.join(" / ") || "—"}</td>
                        <td style={{ padding: "12px 8px" }}>{row.calls.length}</td>
                        <td style={{ padding: "12px 8px" }}>{money(row.estimatedTotal)}</td>
                        <td style={{ padding: "12px 8px", minWidth: 130 }}>
                          <input
                            value={row.overrideAmount ?? ""}
                            placeholder="auto"
                            inputMode="decimal"
                            onChange={(event) => {
                              const value = event.target.value.trim();
                              updateLocal(row.key, { overrideAmount: value === "" ? null : Number(value) });
                            }}
                            onBlur={() => void saveStatus(row, { payout_override: row.overrideAmount })}
                            style={{ width: 100, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10 }}
                          />
                        </td>
                        <td style={{ padding: "12px 8px", fontWeight: 800 }}>{money(payable(row))}</td>
                        <td style={{ padding: "12px 8px", minWidth: 150 }}>
                          <input
                            type="date"
                            value={row.scheduledFor || ""}
                            onChange={(event) => {
                              const nextDate = event.target.value || null;
                              const nextStatus: PayrollPaymentStatus = paymentStatusFor(row) === "paid" ? "paid" : nextDate ? "scheduled" : "unpaid";
                              updateLocal(row.key, { scheduledFor: nextDate, paymentStatus: nextStatus, paid: nextStatus === "paid" });
                              void saveStatus(row, { scheduled_for: nextDate, payment_status: nextStatus, paid: nextStatus === "paid" });
                            }}
                            style={{ width: 135, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10 }}
                          />
                        </td>
                        <td style={{ padding: "12px 8px", minWidth: 140 }}>
                          <select
                            value={paymentStatusFor(row)}
                            disabled={isSaving}
                            style={{ ...paymentStatusStyle(paymentStatusFor(row)), minWidth: 130, padding: "8px 10px", border: "1px solid", borderRadius: 10 }}
                            onChange={(selectEvent) => {
                              const nextStatus = selectEvent.target.value as PayrollPaymentStatus;
                              const nextScheduledFor = nextStatus === "scheduled" ? (row.scheduledFor || eventDefaultScheduledFor(event)) : nextStatus === "unpaid" ? null : row.scheduledFor;
                              updateLocal(row.key, { paymentStatus: nextStatus, paid: nextStatus === "paid", scheduledFor: nextScheduledFor });
                              void saveStatus(row, { payment_status: nextStatus, paid: nextStatus === "paid", scheduled_for: nextScheduledFor });
                            }}
                          >
                            <option value="unpaid">Unpaid</option>
                            <option value="scheduled">Scheduled</option>
                            <option value="paid">Paid</option>
                          </select>
                          <div style={{ marginTop: 6 }}>{paymentStatusBadge(paymentStatusFor(row))}</div>
                          {isSaving ? <div className="small muted" style={{ marginTop: 4 }}>Saving...</div> : null}
                        </td>
                        <td style={{ padding: "12px 8px" }}>
                          <button className="ghost" type="button" onClick={() => toggleDetails(row.key)}>{isOpen ? "Hide" : "View"}</button>
                          {isOpen ? (
                            <div className="card compact" style={{ marginTop: 10, minWidth: 360 }}>
                              <label className="field">
                                Payroll notes
                                <textarea
                                  value={row.notes}
                                  rows={2}
                                  onChange={(event) => updateLocal(row.key, { notes: event.target.value })}
                                  onBlur={() => void saveStatus(row, { notes: row.notes })}
                                  placeholder="Check number, Zelle confirmation, invoice note..."
                                />
                              </label>
                              <div className="list" style={{ marginTop: 12 }}>
                                {row.calls.map((call) => (
                                  <div key={call.assignmentId} className="small" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                                    <strong>{formatPayrollDate(call.laborDate)}</strong> • {formatPayrollTime(call.startTime)}–{formatPayrollTime(call.endTime)} • {call.roleName}
                                    <div className="muted">{call.area}</div>
                                    <div>{money(call.amount)} • {call.payLabel} • {call.rateSource}</div>
                                    <div className="muted">Client revenue: {money(call.clientRevenueAmount ?? 0)} • {call.clientRateSource || "Client rate sheet"}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {events.length === 0 ? <section className="card"><p className="muted">No event payroll rows match the current filters.</p></section> : null}
      </div>
    </div>
  );
}
