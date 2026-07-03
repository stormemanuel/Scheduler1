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

type EventFinancialPatch = {
  revenueOverride?: number | null;
  expenses?: number;
  financialNotes?: string;
  expenseItems?: ShowExpenseItemRecord[];
  taxReserveDone?: boolean;
  taxReserveDoneAt?: string | null;
  consecratedHandsDone?: boolean;
  consecratedHandsDoneAt?: string | null;
};

const FEDERAL_1099_NEC_THRESHOLD_2026 = 2000;

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

function cleanText(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function taxStatusLabel(value: string | null | undefined) {
  const normalized = cleanText(value, "missing").toLowerCase();
  if (normalized === "requested") return "Requested";
  if (normalized === "uploaded") return "Uploaded";
  if (normalized === "needs_review") return "Needs review";
  if (normalized === "approved") return "Approved";
  if (normalized === "rejected") return "Correction needed";
  return "Missing";
}

function w9Ready(summary: Pick<PayrollYearTechSummary, "w9Status" | "taxProfileStatus" | "w9DocumentUrl">) {
  const w9 = cleanText(summary.w9Status, "missing").toLowerCase();
  const tax = cleanText(summary.taxProfileStatus, "missing").toLowerCase();
  return w9 === "approved" || tax === "approved";
}

function w9NeedsReview(summary: Pick<PayrollYearTechSummary, "w9Status" | "taxProfileStatus" | "w9DocumentUrl">) {
  if (w9Ready(summary)) return false;
  const w9 = cleanText(summary.w9Status, "missing").toLowerCase();
  const tax = cleanText(summary.taxProfileStatus, "missing").toLowerCase();
  return Boolean(summary.w9DocumentUrl) || w9 === "uploaded" || w9 === "needs_review" || tax === "needs_review";
}

function w9RequestAlreadyOpen(summary: Pick<PayrollYearTechSummary, "w9Status" | "taxProfileStatus">) {
  const w9 = cleanText(summary.w9Status, "missing").toLowerCase();
  const tax = cleanText(summary.taxProfileStatus, "missing").toLowerCase();
  return w9 === "requested" || tax === "requested";
}

function shouldQueueW9Request(summary: PayrollYearTechSummary) {
  return summary.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 && !w9Ready(summary) && !w9NeedsReview(summary) && !w9RequestAlreadyOpen(summary);
}

function w9PrepLabel(summary: PayrollYearTechSummary) {
  if (summary.paidTotal < FEDERAL_1099_NEC_THRESHOLD_2026) return "Below $2,000";
  if (w9Ready(summary)) return "Ready";
  if (w9NeedsReview(summary)) return "Review W-9";
  if (w9RequestAlreadyOpen(summary)) return "Requested";
  return "Need W-9";
}

function taxProfileDataReady(summary: PayrollYearTechSummary) {
  const profile = summary.taxProfile;
  return Boolean(
    profile &&
    cleanText(profile.taxLegalName) &&
    cleanText(profile.taxAddressLine1) &&
    cleanText(profile.taxCityStateZip) &&
    cleanText(profile.tinLast4).length === 4 &&
    profile.hasEncryptedTin &&
    cleanText(profile.signerName) &&
    profile.certificationConfirmed
  );
}

function taxProfileSourceLabel(source: string | null | undefined) {
  const value = cleanText(source).toLowerCase();
  if (value.includes("owner_tax_center")) return "Owner entered from uploaded W-9";
  if (value.includes("public_onboarding")) return "Crew completed in app";
  return value || "Not saved";
}

function taxClassificationLabel(summary: PayrollYearTechSummary) {
  const profile = summary.taxProfile;
  if (!profile) return "";
  return [profile.federalTaxClassification, profile.llcTaxClassification || profile.otherClassification].map((value) => cleanText(value)).filter(Boolean).join(" / ");
}

function taxAddressParts(summary: PayrollYearTechSummary) {
  const profile = summary.taxProfile;
  if (!profile) return { line1: "", line2: "", city: "", state: "", zip: "" };
  const cityStateZip = cleanText(profile.taxCityStateZip);
  const zipMatch = cityStateZip.match(/(\d{5}(?:-\d{4})?)\s*$/);
  const zip = zipMatch?.[1] ?? "";
  const beforeZip = zip ? cityStateZip.slice(0, cityStateZip.lastIndexOf(zip)).trim().replace(/,$/, "") : cityStateZip;
  const parts = beforeZip.split(",").map((part) => part.trim()).filter(Boolean);
  const city = parts.length > 1 ? parts.slice(0, -1).join(", ") : beforeZip;
  const state = parts.length > 1 ? parts[parts.length - 1] : "";
  return { line1: cleanText(profile.taxAddressLine1), line2: "", city, state, zip };
}

function TaxProfilePreview({ summary }: { summary: PayrollYearTechSummary }) {
  const profile = summary.taxProfile;
  if (!profile) {
    return (
      <div className="card compact" style={{ minWidth: 260, borderColor: "#f2c94c" }}>
        <strong>No saved tax data yet</strong>
        <div className="muted small">The PDF may be saved, but an IRS export needs typed tax fields. Use “Enter/confirm tax data” after opening the W-9.</div>
      </div>
    );
  }
  return (
    <div className="card compact" style={{ minWidth: 280 }}>
      <div className="muted small">Saved tax data for IRS/IRIS export</div>
      <strong>{profile.taxLegalName || "Missing legal name"}</strong>
      {profile.businessName ? <div className="small">Business: {profile.businessName}</div> : null}
      <div className="small">Class: {taxClassificationLabel(summary) || "Missing"}</div>
      <div className="small">Address: {[profile.taxAddressLine1, profile.taxCityStateZip].filter(Boolean).join(", ") || "Missing"}</div>
      <div className="small">TIN: {profile.tinType ? profile.tinType.toUpperCase() : "TIN"} ending {profile.tinLast4 || "----"}</div>
      <div className="small">Signed by: {profile.signerName || "Missing"}</div>
      <div className="muted small">Source: {taxProfileSourceLabel(profile.source)} · Cert: {profile.certificationConfirmed ? "yes" : "missing"}</div>
      {!taxProfileDataReady(summary) ? <div className="muted small" style={{ color: "#b42318", marginTop: 4 }}>Missing data — do not approve for 1099 export yet.</div> : null}
    </div>
  );
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
  const assignedCoordinatorRow = event.rows.find((row) => row.showAssignedCoordinatorUserId);
  const assignedCoordinatorId = assignedCoordinatorRow?.showAssignedCoordinatorUserId || "";
  if (assignedCoordinatorId && !grouped.has(assignedCoordinatorId)) {
    const projectedAmount = coordinatorProjectedAmount(0, 0);
    const overrideAmount = assignedCoordinatorRow?.coordinatorOverrideAmount ?? null;
    grouped.set(assignedCoordinatorId, {
      showId: event.showId,
      coordinatorUserId: assignedCoordinatorId,
      coordinatorName: assignedCoordinatorRow?.showAssignedCoordinatorName || "Assigned coordinator",
      fullDayTechDays: 0,
      halfDayTechs: 0,
      projectedAmount,
      overrideAmount,
      payableAmount: overrideAmount ?? projectedAmount,
      paymentStatus: assignedCoordinatorRow?.coordinatorPaymentStatus ?? "unpaid",
      paid: Boolean(assignedCoordinatorRow?.coordinatorPaid),
      scheduledFor: assignedCoordinatorRow?.coordinatorScheduledFor ?? null,
      notes: assignedCoordinatorRow?.coordinatorNotes ?? "",
      statusId: assignedCoordinatorRow?.coordinatorPaymentStatusId ?? null,
    });
  }
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
        w9Status: cleanText(row.w9Status, "missing"),
        taxProfileStatus: cleanText(row.taxProfileStatus, "missing"),
        w9DocumentUrl: cleanText(row.w9DocumentUrl),
        taxProfileNotes: cleanText(row.taxProfileNotes),
        taxProfile: row.taxProfile ?? null,
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

function eventPayrollIsFullyPaid(event: PayrollEventSummary) {
  if (!event.rows.length || !event.rows.every((row) => paymentStatusFor(row) === "paid")) return false;
  const coordinator = event.coordinatorPayment;
  if (!coordinator || Number(coordinator.payableAmount || 0) <= 0) return true;
  return coordinator.paymentStatus === "paid";
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
  const [expandedPaidEventIds, setExpandedPaidEventIds] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingScheduledShowId, setSavingScheduledShowId] = useState<string | null>(null);
  const [savingFinancialShowId, setSavingFinancialShowId] = useState<string | null>(null);
  const [showTechTotals, setShowTechTotals] = useState(false);
  const [taxCenterOpen, setTaxCenterOpen] = useState(false);
  const [openExpenseEvents, setOpenExpenseEvents] = useState<Set<string>>(new Set());
  const [expenseDrafts, setExpenseDrafts] = useState<Record<string, ExpenseDraft>>({});
  const [savingExpenseShowId, setSavingExpenseShowId] = useState<string | null>(null);
  const [queueingW9CrewId, setQueueingW9CrewId] = useState<string | null>(null);
  const [queueingBulkW9, setQueueingBulkW9] = useState(false);
  const [reviewingW9CrewId, setReviewingW9CrewId] = useState<string | null>(null);
  const [uploadingW9CrewId, setUploadingW9CrewId] = useState<string | null>(null);
  const [savingTaxProfileCrewId, setSavingTaxProfileCrewId] = useState<string | null>(null);
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
  const fullyPaidEventIds = useMemo(() => new Set(summaryEvents.filter(eventPayrollIsFullyPaid).map((event) => event.showId)), [summaryEvents]);
  const detailedEvents = useMemo(() => events.filter((event) => !fullyPaidEventIds.has(event.showId) || expandedPaidEventIds.has(event.showId)), [events, fullyPaidEventIds, expandedPaidEventIds]);
  const collapsedPaidEvents = useMemo(() => events.filter((event) => fullyPaidEventIds.has(event.showId) && !expandedPaidEventIds.has(event.showId)), [events, fullyPaidEventIds, expandedPaidEventIds]);
  const yearSummary = useMemo(() => buildYearSummary(viewYearRows), [viewYearRows]);
  const plTotals = useMemo(() => plForEvents(summaryEvents), [summaryEvents]);
  const paidTotal = yearSummary.reduce((sum, row) => sum + row.paidTotal, 0);
  const unpaidTotal = yearSummary.reduce((sum, row) => sum + row.unpaidTotal, 0);
  const payableTotal = paidTotal + unpaidTotal;
  const required1099Summaries = yearSummary.filter((row) => row.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026);
  const ready1099Summaries = required1099Summaries.filter((row) => w9Ready(row));
  const review1099Summaries = required1099Summaries.filter((row) => w9NeedsReview(row));
  const requested1099Summaries = required1099Summaries.filter((row) => !w9Ready(row) && !w9NeedsReview(row) && w9RequestAlreadyOpen(row));
  const missing1099Summaries = required1099Summaries.filter((row) => shouldQueueW9Request(row));
  const taxCenterRows = useMemo(() => [...required1099Summaries].sort((a, b) => {
    const rank = (row: PayrollYearTechSummary) => w9NeedsReview(row) ? 0 : shouldQueueW9Request(row) ? 1 : w9RequestAlreadyOpen(row) ? 2 : w9Ready(row) ? 3 : 4;
    return rank(a) - rank(b) || b.paidTotal - a.paidTotal || a.crewName.localeCompare(b.crewName);
  }), [required1099Summaries]);

  async function openSecureW9Document(summary: PayrollYearTechSummary, download = false) {
    if (!summary.w9DocumentUrl) {
      setMessage(`No W-9 file is attached to ${summary.crewName}.`);
      return;
    }
    setReviewingW9CrewId(summary.crewId);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_signed_document_url", crew_id: summary.crewId, document_type: "w9", storage_path: summary.w9DocumentUrl, download }),
      });
      const result = (await response.json()) as { ok?: boolean; signed_url?: string; message?: string };
      if (!response.ok || !result.ok || !result.signed_url) throw new Error(result.message || "Unable to create a secure W-9 link.");
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = result.signed_url;
        anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setMessage(`Secure W-9 download started for ${summary.crewName}. Link expires in 10 minutes.`);
      } else {
        const opened = window.open(result.signed_url, "_blank");
        if (!opened) {
          window.location.assign(result.signed_url);
          return;
        }
        setMessage(`Secure W-9 opened for ${summary.crewName}. Link expires in 10 minutes.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open W-9.");
    } finally {
      setReviewingW9CrewId(null);
    }
  }

  async function uploadW9ForSummary(summary: PayrollYearTechSummary, fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setUploadingW9CrewId(summary.crewId);
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("action", "admin_upload_document");
      formData.append("crew_id", summary.crewId);
      formData.append("document_type", "w9");
      formData.append("file", file, file.name);

      const response = await fetch("/api/onboarding", { method: "POST", body: formData });
      const result = (await response.json()) as { ok?: boolean; message?: string; path?: string; crew_patch?: { w9_document_url?: string; w9_status?: string; tax_profile_status?: string } };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to upload W-9.");

      const uploadedPath = result.path || result.crew_patch?.w9_document_url || "";
      setRows((current) => current.map((row) => row.crewId === summary.crewId ? {
        ...row,
        w9DocumentUrl: uploadedPath || row.w9DocumentUrl,
        w9Status: result.crew_patch?.w9_status || "uploaded",
        taxProfileStatus: result.crew_patch?.tax_profile_status || "needs_review",
      } : row));
      setMessage(`W-9 uploaded for ${summary.crewName}. It is now attached to their Crew profile and queued for review.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to upload W-9.");
    } finally {
      setUploadingW9CrewId(null);
    }
  }

  async function confirmTaxProfileFromW9(summary: PayrollYearTechSummary) {
    const current = summary.taxProfile;
    const legalName = window.prompt("Legal name exactly as shown on the W-9:", current?.taxLegalName || summary.crewName);
    if (legalName === null) return;
    const businessName = window.prompt("Business name/disregarded entity name, if any:", current?.businessName || "");
    if (businessName === null) return;
    const classification = window.prompt("Federal tax classification from W-9 (individual, c-corp, s-corp, partnership, trust/estate, llc, other):", current?.federalTaxClassification || "individual");
    if (classification === null) return;
    const llcClass = window.prompt("LLC tax classification, if applicable (C, S, or P). Leave blank if not LLC:", current?.llcTaxClassification || "");
    if (llcClass === null) return;
    const address1 = window.prompt("Tax mailing address line 1 from the W-9:", current?.taxAddressLine1 || "");
    if (address1 === null) return;
    const cityStateZip = window.prompt("City, state, and ZIP from the W-9:", current?.taxCityStateZip || "");
    if (cityStateZip === null) return;
    const tinTypeRaw = window.prompt("TIN type: SSN or EIN", current?.tinType?.toUpperCase() || "SSN");
    if (tinTypeRaw === null) return;
    const tin = window.prompt("Enter the full 9-digit SSN/EIN from the W-9. This is encrypted before storage and only the last 4 show in the app:", "");
    if (tin === null) return;
    const signerName = window.prompt("Signer name shown on the W-9:", current?.signerName || legalName);
    if (signerName === null) return;
    const verified = window.confirm("Confirm you opened/reviewed the W-9 file and verified the signature/certification matches the tax data you are saving.");
    if (!verified) return;

    setSavingTaxProfileCrewId(summary.crewId);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_owner_tax_profile",
          crew_id: summary.crewId,
          tax_profile: {
            tax_legal_name: legalName,
            business_name: businessName,
            federal_tax_classification: classification,
            llc_tax_classification: llcClass,
            other_classification: "",
            exempt_payee_code: "",
            fatca_code: "",
            tax_address_line_1: address1,
            tax_city_state_zip: cityStateZip,
            account_numbers: "",
            tin_type: tinTypeRaw.toLowerCase().includes("ein") ? "ein" : "ssn",
            tin,
            signer_name: signerName,
            signature_verified_from_w9: true,
            certification_verified_from_w9: true,
          },
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; crew_patch?: { w9_status?: string; tax_profile_status?: string; tax_profile_notes?: string }; tax_profile?: PayrollYearTechSummary["taxProfile"] };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to save tax profile.");
      setRows((currentRows) => currentRows.map((row) => row.crewId === summary.crewId ? {
        ...row,
        w9Status: result.crew_patch?.w9_status ?? row.w9Status,
        taxProfileStatus: result.crew_patch?.tax_profile_status ?? row.taxProfileStatus,
        taxProfileNotes: result.crew_patch?.tax_profile_notes ?? row.taxProfileNotes,
        taxProfile: result.tax_profile ?? row.taxProfile,
      } : row));
      setMessage(result.message || `Tax profile saved for ${summary.crewName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save tax profile.");
    } finally {
      setSavingTaxProfileCrewId(null);
    }
  }

  async function updateW9Review(summary: PayrollYearTechSummary, reviewAction: "approve_w9" | "request_correction" | "mark_needs_review") {
    if (reviewAction === "approve_w9" && !taxProfileDataReady(summary)) {
      setMessage(`Save/confirm the typed tax data for ${summary.crewName} before approving. The IRS export uses the saved text fields, not the PDF by itself.`);
      return;
    }
    const defaultNote = reviewAction === "approve_w9" ? "Reviewed the W-9 file and confirmed the saved tax data is ready for 2026 1099 prep." : reviewAction === "request_correction" ? "Please upload a corrected signed W-9." : "Needs owner review.";
    const note = window.prompt("Add a W-9 review note:", defaultNote);
    if (note === null) return;
    setReviewingW9CrewId(summary.crewId);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_tax_document_review", crew_id: summary.crewId, review_action: reviewAction, notes: note }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; crew_patch?: { w9_status?: string; tax_profile_status?: string; tax_profile_notes?: string } };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to update W-9 review status.");
      setRows((current) => current.map((row) => row.crewId === summary.crewId ? {
        ...row,
        w9Status: result.crew_patch?.w9_status ?? row.w9Status,
        taxProfileStatus: result.crew_patch?.tax_profile_status ?? row.taxProfileStatus,
        taxProfileNotes: result.crew_patch?.tax_profile_notes ?? row.taxProfileNotes,
      } : row));
      setMessage(result.message || `Updated W-9 status for ${summary.crewName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update W-9 review status.");
    } finally {
      setReviewingW9CrewId(null);
    }
  }

  async function queueW9RequestForSummary(summary: PayrollYearTechSummary, options?: { silent?: boolean }) {
    setQueueingW9CrewId(summary.crewId);
    if (!options?.silent) setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_request", crew_id: summary.crewId, request_type: "w9_only", queue_text: true }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "W-9 request failed.");
      setRows((current) => current.map((row) => row.crewId === summary.crewId ? { ...row, w9Status: "requested", taxProfileStatus: "requested" } : row));
      if (!options?.silent) setMessage(result.message || `W-9 request queued for ${summary.crewName}.`);
      return true;
    } catch (error) {
      if (!options?.silent) setMessage(error instanceof Error ? error.message : "W-9 request failed.");
      return false;
    } finally {
      setQueueingW9CrewId(null);
    }
  }

  async function queueMissingW9Requests() {
    if (!missing1099Summaries.length) {
      setMessage("No missing W-9 requests to queue for the selected year/view.");
      return;
    }
    setQueueingBulkW9(true);
    setMessage("");
    let queued = 0;
    let failed = 0;
    for (const summary of missing1099Summaries) {
      const ok = await queueW9RequestForSummary(summary, { silent: true });
      if (ok) queued += 1;
      else failed += 1;
    }
    setQueueingBulkW9(false);
    setMessage(failed ? `Queued ${queued} W-9 request${queued === 1 ? "" : "s"}; ${failed} failed.` : `Queued ${queued} W-9 request${queued === 1 ? "" : "s"} for 1099 contractors missing tax docs.`);
  }

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
      const rawText = await response.text();
      let result: { ok?: boolean; message?: string; row?: { id?: string; paid?: boolean; payment_status?: PayrollPaymentStatus; payout_override?: number | null; notes?: string | null; scheduled_for?: string | null } } = {};
      try { result = rawText ? JSON.parse(rawText) : {}; } catch { result = { message: rawText || "Coordinator payroll update failed." }; }
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

  function setPaidEventExpanded(showId: string, expanded: boolean) {
    setExpandedPaidEventIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(showId);
      else next.delete(showId);
      return next;
    });
  }

  function updateEventFinancials(showId: string, patch: EventFinancialPatch) {
    const now = new Date().toISOString();
    setRows((current) => current.map((row) => row.showId === showId ? {
      ...row,
      showRevenueOverride: patch.revenueOverride === undefined ? row.showRevenueOverride : patch.revenueOverride,
      showExpenses: patch.expenses === undefined ? row.showExpenses : patch.expenses,
      showFinancialNotes: patch.financialNotes === undefined ? row.showFinancialNotes : patch.financialNotes,
      showExpenseItems: patch.expenseItems === undefined ? row.showExpenseItems : patch.expenseItems,
      taxReserveDone: patch.taxReserveDone === undefined ? row.taxReserveDone : patch.taxReserveDone,
      taxReserveDoneAt: patch.taxReserveDoneAt !== undefined ? patch.taxReserveDoneAt : patch.taxReserveDone === undefined ? row.taxReserveDoneAt : (patch.taxReserveDone ? (row.taxReserveDoneAt ?? now) : null),
      consecratedHandsDone: patch.consecratedHandsDone === undefined ? row.consecratedHandsDone : patch.consecratedHandsDone,
      consecratedHandsDoneAt: patch.consecratedHandsDoneAt !== undefined ? patch.consecratedHandsDoneAt : patch.consecratedHandsDone === undefined ? row.consecratedHandsDoneAt : (patch.consecratedHandsDone ? (row.consecratedHandsDoneAt ?? now) : null),
    } : row));
  }

  function financialSnapshot(event: PayrollEventSummary, patch: EventFinancialPatch = {}) {
    const now = new Date().toISOString();
    const taxReserveDone = patch.taxReserveDone === undefined ? event.taxReserveDone : patch.taxReserveDone;
    const consecratedHandsDone = patch.consecratedHandsDone === undefined ? event.consecratedHandsDone : patch.consecratedHandsDone;
    return {
      revenueOverride: patch.revenueOverride === undefined ? event.revenueOverride : patch.revenueOverride,
      expenses: patch.expenses === undefined ? event.expenses : patch.expenses,
      financialNotes: patch.financialNotes === undefined ? event.financialNotes : patch.financialNotes,
      taxReserveDone,
      taxReserveDoneAt: patch.taxReserveDoneAt !== undefined ? patch.taxReserveDoneAt : patch.taxReserveDone === undefined ? event.taxReserveDoneAt : (taxReserveDone ? (event.taxReserveDoneAt ?? now) : null),
      consecratedHandsDone,
      consecratedHandsDoneAt: patch.consecratedHandsDoneAt !== undefined ? patch.consecratedHandsDoneAt : patch.consecratedHandsDone === undefined ? event.consecratedHandsDoneAt : (consecratedHandsDone ? (event.consecratedHandsDoneAt ?? now) : null),
    };
  }

  function updateAndSaveEventFinancials(event: PayrollEventSummary, patch: EventFinancialPatch) {
    const next = financialSnapshot(event, patch);
    updateEventFinancials(event.showId, next);
    void saveEventFinancials(event, next);
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

  async function saveEventFinancials(event: PayrollEventSummary, patch: EventFinancialPatch = {}) {
    const next = financialSnapshot(event, patch);
    setSavingFinancialShowId(event.showId);
    setMessage("Saving P&L...");
    try {
      const response = await fetch("/api/show-financials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_id: event.showId,
          estimated_revenue_override: next.revenueOverride,
          expenses: next.expenses,
          notes: next.financialNotes,
          tax_reserve_done: next.taxReserveDone,
          tax_reserve_done_at: next.taxReserveDoneAt,
          consecrated_hands_done: next.consecratedHandsDone,
          consecrated_hands_done_at: next.consecratedHandsDoneAt,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; row?: { estimated_revenue_override?: number | null; expenses?: number | null; notes?: string | null; tax_reserve_done?: boolean | null; tax_reserve_done_at?: string | null; consecrated_hands_done?: boolean | null; consecrated_hands_done_at?: string | null } };
      if (!response.ok || !result.ok) throw new Error(result.message || "Financial update failed.");
      if (result.row) {
        updateEventFinancials(event.showId, {
          revenueOverride: result.row.estimated_revenue_override ?? null,
          expenses: Number(result.row.expenses ?? 0),
          financialNotes: result.row.notes ?? "",
          taxReserveDone: Boolean(result.row.tax_reserve_done),
          taxReserveDoneAt: result.row.tax_reserve_done_at ?? null,
          consecratedHandsDone: Boolean(result.row.consecrated_hands_done),
          consecratedHandsDoneAt: result.row.consecrated_hands_done_at ?? null,
        });
      }
      setMessage(`${event.showName} P&L saved.`);
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
      ["Tax Year", "Contractor Name", "Legal Name", "TIN", "Address Line 1", "Address Line 2", "City", "State", "ZIP", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "W-9 Status", "Tax Profile Status", "W-9 File", "Paid Events", "Unpaid Events", "Notes"],
      ...yearSummary.map((row) => [
        year,
        row.crewName,
        row.taxProfile?.taxLegalName || "",
        row.taxProfile?.tinLast4 ? `${String(row.taxProfile.tinType || "TIN").toUpperCase()} ending ${row.taxProfile.tinLast4}` : "",
        taxAddressParts(row).line1,
        taxAddressParts(row).line2,
        taxAddressParts(row).city,
        taxAddressParts(row).state,
        taxAddressParts(row).zip,
        row.crewEmail,
        row.crewPhone,
        row.paidTotal,
        row.unpaidTotal,
        row.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? "YES" : "NO",
        taxStatusLabel(row.w9Status),
        taxStatusLabel(row.taxProfileStatus),
        row.w9DocumentUrl ? "Saved" : "Missing",
        row.eventCountPaid,
        row.eventCountUnpaid,
        row.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? w9PrepLabel(row) : "Below $2,000 paid threshold",
      ]),
    ];
  }

  function nec1099Document(): ExportDocument {
    const rows = nec1099Rows();
    return {
      title: "Emanuel Labor Services 1099-NEC Prep",
      subtitle: `${year} • Contractors paid $2,000+ flagged`,
      meta: [["Tax Year", year], ["Report View", viewLabel(reportView)], ["Contractors", yearSummary.length]],
      sections: [{ heading: "1099-NEC contractor preparation", columns: rows[0].map(String), rows: rows.slice(1) }],
    };
  }

  function yearSummaryRows(): Array<Array<string | number | null | undefined>> {
    return [
      ["Tax Year", "Contractor", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "W-9 Status", "Tax Profile Status", "W-9 Readiness", "Paid Events", "Unpaid Events"],
      ...yearSummary.map((row) => [year, row.crewName, row.crewEmail, row.crewPhone, row.paidTotal, row.unpaidTotal, row.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? "YES" : "NO", taxStatusLabel(row.w9Status), taxStatusLabel(row.taxProfileStatus), w9PrepLabel(row), row.eventCountPaid, row.eventCountUnpaid]),
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
      ["Tax Year", "Contractor Name", "Legal Name", "TIN", "Address Line 1", "Address Line 2", "City", "State", "ZIP", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "W-9 Status", "Tax Profile Status", "W-9 File", "Paid Events", "Unpaid Events", "Notes"],
      ...yearSummary.map((row) => [
        year,
        row.crewName,
        row.taxProfile?.taxLegalName || "",
        row.taxProfile?.tinLast4 ? `${String(row.taxProfile.tinType || "TIN").toUpperCase()} ending ${row.taxProfile.tinLast4}` : "",
        taxAddressParts(row).line1,
        taxAddressParts(row).line2,
        taxAddressParts(row).city,
        taxAddressParts(row).state,
        taxAddressParts(row).zip,
        row.crewEmail,
        row.crewPhone,
        row.paidTotal,
        row.unpaidTotal,
        row.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? "YES" : "NO",
        taxStatusLabel(row.w9Status),
        taxStatusLabel(row.taxProfileStatus),
        row.w9DocumentUrl ? "Saved" : "Missing",
        row.eventCountPaid,
        row.eventCountUnpaid,
        row.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? w9PrepLabel(row) : "Below $2,000 paid threshold",
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
      ["Tax Year", "Contractor", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "W-9 Status", "Tax Profile Status", "W-9 Readiness", "Paid Events", "Unpaid Events"],
      ...yearSummary.map((row) => [year, row.crewName, row.crewEmail, row.crewPhone, row.paidTotal, row.unpaidTotal, row.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? "YES" : "NO", taxStatusLabel(row.w9Status), taxStatusLabel(row.taxProfileStatus), w9PrepLabel(row), row.eventCountPaid, row.eventCountUnpaid]),
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

      {taxCenterOpen ? (
        <>
          <section className="card">
            <div className="row" style={{ alignItems: "center" }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>{year} Tax Center / 1099 readiness</h2>
                <p className="muted" style={{ margin: 0 }}>Contractors marked paid at $2,000+ are flagged for 1099 prep. Review uploaded W-9s, approve clean tax files, or request corrections without reopening the full onboarding packet.</p>
              </div>
              <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                <button className="ghost" type="button" disabled={queueingBulkW9 || missing1099Summaries.length === 0} onClick={() => void queueMissingW9Requests()}>
                  {queueingBulkW9 ? "Queueing..." : `Queue missing W-9s (${missing1099Summaries.length})`}
                </button>
                <button className="ghost" type="button" onClick={() => setShowTechTotals(true)}>Open tech totals</button>
                <button className="ghost" type="button" onClick={() => setTaxCenterOpen(false)}>Close Tax Center</button>
              </div>
            </div>
            <div className="pl-grid" style={{ marginTop: 14 }}>
              <div className="card compact"><div className="muted small">1099 threshold</div><strong>{required1099Summaries.length}</strong><div className="muted small">Paid $2,000+</div></div>
              <div className="card compact"><div className="muted small">W-9 approved</div><strong>{ready1099Summaries.length}</strong><div className="muted small">Ready for filing prep</div></div>
              <div className="card compact"><div className="muted small">Needs owner review</div><strong>{review1099Summaries.length}</strong><div className="muted small">Uploaded or notes submitted</div></div>
              <div className="card compact"><div className="muted small">Request open</div><strong>{requested1099Summaries.length}</strong><div className="muted small">Already queued/requested</div></div>
              <div className="card compact"><div className="muted small">Missing W-9</div><strong>{missing1099Summaries.length}</strong><div className="muted small">Ready to queue</div></div>
            </div>
          </section>

          <section className="card">
            <div className="row" style={{ alignItems: "center" }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>Tax Center review queue</h2>
                <p className="muted" style={{ margin: 0 }}>Owner workflow for everyone paid $2,000+ in {year}. Open private W-9 files, approve ready records, request corrections, or queue a W-9-only link.</p>
              </div>
              <span className="badge">{taxCenterRows.length} required</span>
            </div>
            <div className="mobile-table" style={{ overflowX: "auto", marginTop: 14 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: "10px 8px" }}>Contractor</th>
                    <th style={{ padding: "10px 8px" }}>Paid</th>
                    <th style={{ padding: "10px 8px" }}>Readiness</th>
                    <th style={{ padding: "10px 8px" }}>Tax data saved</th>
                    <th style={{ padding: "10px 8px" }}>W-9 file</th>
                    <th style={{ padding: "10px 8px" }}>Review actions</th>
                  </tr>
                </thead>
                <tbody>
                  {taxCenterRows.map((summary) => (
                    <tr key={summary.crewId} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "10px 8px" }}>
                        <strong>{summary.crewName}</strong>
                        <div className="muted small">{summary.crewEmail || "No email"} · {summary.crewPhone || "No phone"}</div>
                        {summary.taxProfileNotes ? <div className="muted small" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{summary.taxProfileNotes}</div> : null}
                      </td>
                      <td style={{ padding: "10px 8px", fontWeight: 850 }}>{money(summary.paidTotal)}<div className="muted small">Open: {money(summary.unpaidTotal)}</div></td>
                      <td style={{ padding: "10px 8px" }}>
                        <span className={w9Ready(summary) ? "badge event-badge-current" : w9NeedsReview(summary) ? "badge event-badge-upcoming" : "badge"}>{w9PrepLabel(summary)}</span>
                        <div className="muted small">W-9: {taxStatusLabel(summary.w9Status)} · Tax: {taxStatusLabel(summary.taxProfileStatus)}</div>
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <TaxProfilePreview summary={summary} />
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        {summary.w9DocumentUrl ? (
                          <div className="toolbar" style={{ gap: 8 }}>
                            <button className="ghost" type="button" disabled={reviewingW9CrewId === summary.crewId} onClick={() => void openSecureW9Document(summary, false)}>Open</button>
                            <button className="ghost" type="button" disabled={reviewingW9CrewId === summary.crewId} onClick={() => void openSecureW9Document(summary, true)}>Download</button>
                          </div>
                        ) : <span className="muted small">No W-9 uploaded</span>}
                        <label className="field" style={{ marginTop: 8, maxWidth: 220 }}>
                          <span>{summary.w9DocumentUrl ? "Replace / add W-9" : "Add W-9 now"}</span>
                          <input type="file" accept="application/pdf,image/*" disabled={uploadingW9CrewId === summary.crewId} onChange={(event) => { void uploadW9ForSummary(summary, event.target.files); event.currentTarget.value = ""; }} />
                          <span className="muted small">{uploadingW9CrewId === summary.crewId ? "Uploading..." : "Saves to this crew profile."}</span>
                        </label>
                      </td>
                      <td style={{ padding: "10px 8px" }}>
                        <div className="toolbar" style={{ gap: 8 }}>
                          <button className="ghost" type="button" disabled={savingTaxProfileCrewId === summary.crewId} onClick={() => void confirmTaxProfileFromW9(summary)}>{savingTaxProfileCrewId === summary.crewId ? "Saving tax data..." : summary.taxProfile ? "Edit tax data" : "Enter/confirm tax data"}</button>
                          {summary.w9DocumentUrl && !w9Ready(summary) ? <button className="primary" type="button" disabled={reviewingW9CrewId === summary.crewId || !taxProfileDataReady(summary)} onClick={() => void updateW9Review(summary, "approve_w9")}>Approve W-9 + tax data</button> : null}
                          {summary.w9DocumentUrl && !w9Ready(summary) ? <button className="ghost" type="button" disabled={reviewingW9CrewId === summary.crewId} onClick={() => void updateW9Review(summary, "request_correction")}>Needs correction</button> : null}
                          {summary.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 && !w9Ready(summary) && !w9NeedsReview(summary) ? (
                            <button className="ghost" type="button" disabled={queueingW9CrewId === summary.crewId} onClick={() => void queueW9RequestForSummary(summary)}>{queueingW9CrewId === summary.crewId ? "Queueing..." : w9RequestAlreadyOpen(summary) ? "Send again" : "Queue W-9"}</button>
                          ) : null}
                          {w9Ready(summary) ? <span className="muted small">Ready</span> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {taxCenterRows.length === 0 ? <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No contractors have reached the 2026 $2,000 paid threshold in this view.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="card">
          <div className="row" style={{ alignItems: "center" }}>
            <div>
              <h2 style={{ marginBottom: 4 }}>{year} Tax Center / 1099 readiness</h2>
              <p className="muted" style={{ margin: 0 }}>Closed by default so Payroll loads clean. Open it only when you are reviewing W-9s, tax data, or 1099 readiness.</p>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
              <span className="badge">{required1099Summaries.length} paid $2,000+</span>
              {review1099Summaries.length ? <span className="badge event-badge-upcoming">{review1099Summaries.length} need review</span> : null}
              {missing1099Summaries.length ? <span className="badge">{missing1099Summaries.length} missing W-9</span> : null}
              <button className="primary" type="button" onClick={() => setTaxCenterOpen(true)}>Open Tax Center</button>
            </div>
          </div>
        </section>
      )}

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
            <p className="muted" style={{ margin: 0 }}>This is the {viewLabel(reportView).toLowerCase()} paid total per contractor. Anyone paid $2,000 or more is flagged, with W-9 readiness pulled from the crew Onboarding tab.</p>
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
                <th style={{ padding: "10px 8px" }}>W-9 / tax</th>
                <th style={{ padding: "10px 8px" }}>Events</th>
                <th style={{ padding: "10px 8px" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {yearSummary.map((summary) => (
                <tr key={summary.crewId} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 8px" }}><strong>{summary.crewName}</strong><div className="muted small">{summary.crewEmail}</div></td>
                  <td style={{ padding: "10px 8px" }}>{summary.crewPhone || "—"}</td>
                  <td style={{ padding: "10px 8px", fontWeight: 800 }}>{money(summary.paidTotal)}</td>
                  <td style={{ padding: "10px 8px" }}>{money(summary.unpaidTotal)}</td>
                  <td style={{ padding: "10px 8px" }}><span className={summary.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? "badge event-badge-current" : "badge"}>{summary.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 ? "Required" : "Below $2,000"}</span></td>
                  <td style={{ padding: "10px 8px" }}>
                    <span className={w9Ready(summary) ? "badge event-badge-current" : "badge"}>{w9PrepLabel(summary)}</span>
                    <div className="muted small">W-9: {taxStatusLabel(summary.w9Status)} · Tax: {taxStatusLabel(summary.taxProfileStatus)}</div>
                  </td>
                  <td style={{ padding: "10px 8px" }}>{summary.eventCountPaid} paid / {summary.eventCountUnpaid} unpaid</td>
                  <td style={{ padding: "10px 8px" }}>
                    {summary.paidTotal >= FEDERAL_1099_NEC_THRESHOLD_2026 && !w9Ready(summary) ? (
                      <button className="ghost" type="button" disabled={queueingW9CrewId === summary.crewId || w9NeedsReview(summary)} onClick={() => void queueW9RequestForSummary(summary)}>
                        {queueingW9CrewId === summary.crewId ? "Queueing..." : w9NeedsReview(summary) ? "Review uploaded" : w9RequestAlreadyOpen(summary) ? "Send again" : "Queue W-9"}
                      </button>
                    ) : <span className="muted small">—</span>}
                  </td>
                </tr>
              ))}
              {yearSummary.length === 0 ? (
                <tr><td colSpan={8} className="muted" style={{ padding: 16 }}>No assigned crew found for {year}.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

      <div className="list">
        {detailedEvents.map((event) => (
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
                {fullyPaidEventIds.has(event.showId) ? <button className="ghost" type="button" onClick={() => setPaidEventExpanded(event.showId, false)}>Collapse paid show</button> : null}
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
                    onBlur={(e) => updateAndSaveEventFinancials(event, { revenueOverride: e.currentTarget.value.trim() === "" ? null : Number(e.currentTarget.value) })}
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
                    onBlur={(e) => {
                      if (!event.expenseItems.length) updateAndSaveEventFinancials(event, { expenses: e.currentTarget.value.trim() === "" ? 0 : Number(e.currentTarget.value) });
                    }}
                  />
                  <span className="small muted">{event.expenseItems.length ? "Controlled by itemized expenses below." : "Use dropdown below to itemize by category."}</span>
                </label>
                <label className="field" style={{ minWidth: 210 }}>
                  Reserve checkoff
                  <span className="small" style={{ display: "grid", gap: 8 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={event.taxReserveDone} onChange={(e) => updateAndSaveEventFinancials(event, { taxReserveDone: e.target.checked })} /> Taxes set aside ({money(event.taxReserve)})</label>
                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={event.consecratedHandsDone} onChange={(e) => updateAndSaveEventFinancials(event, { consecratedHandsDone: e.target.checked })} /> Consecrated Hands ({money(event.consecratedHandsDonation)})</label>
                  </span>
                </label>
                <label className="field" style={{ minWidth: 260, flex: 1 }}>
                  P&L notes
                  <input
                    value={event.financialNotes}
                    placeholder="Invoice number, reimbursables, expense notes..."
                    onChange={(e) => updateEventFinancials(event.showId, { financialNotes: e.target.value })}
                    onBlur={(e) => updateAndSaveEventFinancials(event, { financialNotes: e.currentTarget.value })}
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
        {collapsedPaidEvents.length ? (
          <section className="card" style={{ borderTop: "4px solid #16a34a" }}>
            <div className="row" style={{ alignItems: "center" }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>Paid shows</h2>
                <p className="muted" style={{ margin: 0 }}>Shows collapse automatically after every crew payment and the assigned coordinator payment are marked Paid. Expand one only when you need the names, payment controls, or P&amp;L details.</p>
              </div>
              <span className="badge event-badge-current">{collapsedPaidEvents.length} collapsed</span>
            </div>
            <div className="list" style={{ marginTop: 14 }}>
              {collapsedPaidEvents.map((event) => (
                <div key={event.showId} className="card compact" style={{ boxShadow: "none", background: "#f7fff9" }}>
                  <div className="row" style={{ alignItems: "center" }}>
                    <div>
                      <strong>{event.showName}</strong>
                      <div className="muted small">{event.showClient || "No client"} • {event.showVenue || "No venue"} • {formatPayrollDate(event.showStart)} to {formatPayrollDate(event.showEnd)}</div>
                      <div className="toolbar" style={{ marginTop: 8 }}>
                        <span className="badge event-badge-current">Paid complete</span>
                        <span className="badge">{event.rows.length} techs</span>
                        <span className="badge">Crew paid {money(event.paidTotal)}</span>
                        {event.coordinatorPayment ? <span className="badge">Coordinator {money(event.coordinatorPayment.payableAmount)}</span> : null}
                      </div>
                    </div>
                    <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                      <button className="ghost" type="button" onClick={() => exportEventPdf(event)}>PDF</button>
                      <button className="ghost" type="button" onClick={() => exportEventCsv(event)}>CSV</button>
                      <button className="primary" type="button" onClick={() => setPaidEventExpanded(event.showId, true)}>Expand payroll</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {events.length === 0 ? <section className="card"><p className="muted">No event payroll rows match the current filters.</p></section> : null}
      </div>
    </div>
  );
}
