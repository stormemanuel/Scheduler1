import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import type { CrewRecord } from "@/lib/crew-types";
import type { ClientCityRateOverrideRecord } from "@/lib/client-types";
import type { LaborDayRecord, ShowRecord, SubCallRecord, AssignmentRecord } from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { PayrollEventSummary, PayrollPageData, PayrollStatusRecord, PayrollCrewShowRow, PayrollPaymentStatus, PayrollTaxProfileSummary, PayrollPerformanceDiagnostics, PayrollPerformanceTiming, PayrollCoordinatorPaymentSummary } from "@/lib/payroll-types";
import type { ShowExpenseItemRecord, ShowFinancialRecord, StoredPayrollSnapshot } from "@/lib/financial-types";
import { extractPayrollSnapshotFromNotes, mergePayrollSnapshotIntoNotes, stripPayrollSnapshotFromNotes } from "@/lib/financial-types";
import {
  estimateCoordinatorCompensation,
  estimateAssignmentPay,
  estimateAssignmentRevenue,
  normalizeCoordinatorCompensationSchedule,
  PAYROLL_STATUS_ROLE,
  showYear,
  type CoordinatorCompensationSchedule,
} from "@/lib/payroll-calculations";

const COORDINATOR_PAYROLL_FALLBACK_ROLE = "__ELS_COORDINATOR_PAYROLL__";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeText(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function assignmentIsReplacementStandbyClosed(status: string | null | undefined) {
  return safeText(status).toLowerCase() === "called_in_replacement_used";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => safeText(value)).filter(Boolean))];
}

function createPayrollTimer(mode: PayrollPerformanceDiagnostics["mode"], loadedYear: number) {
  const started = Date.now();
  let previous = started;
  const timings: PayrollPerformanceTiming[] = [];
  return {
    mark(label: string) {
      const now = Date.now();
      timings.push({ label, ms: now - previous });
      previous = now;
    },
    done(showCount: number, rowCount: number): PayrollPerformanceDiagnostics {
      return {
        mode,
        loadedYear,
        showCount,
        rowCount,
        totalMs: Date.now() - started,
        generatedAt: new Date().toISOString(),
        timings,
      };
    },
  };
}

function supabaseErrorMessage(error: unknown) {
  return safeText((error as { message?: string } | null)?.message, error instanceof Error ? error.message : "");
}

function supabaseErrorCode(error: unknown) {
  return safeText((error as { code?: string } | null)?.code);
}

function supabaseErrorDetails(error: unknown) {
  return safeText((error as { details?: string } | null)?.details);
}

function supabaseErrorHint(error: unknown) {
  return safeText((error as { hint?: string } | null)?.hint);
}

function coordinatorCompensationIdColumnMissing(error: unknown, columnName: string) {
  const combined = `${supabaseErrorMessage(error)} ${supabaseErrorDetails(error)} ${supabaseErrorHint(error)}`.toLowerCase();
  return combined.includes(columnName.toLowerCase());
}

function coordinatorCompensationNotesColumnMissing(error: unknown) {
  const combined = `${supabaseErrorMessage(error)} ${supabaseErrorDetails(error)} ${supabaseErrorHint(error)}`.toLowerCase();
  return combined.includes("notes") || combined.includes("schema cache");
}

function coordinatorCompensationUserId(row: unknown) {
  const typed = row as { coordinator_user_id?: string | null; user_id?: string | null };
  return safeText(typed.coordinator_user_id || typed.user_id);
}

function payrollDiagnosticsWithRequest(
  diagnostics: PayrollPerformanceDiagnostics,
  request: PayrollPerformanceDiagnostics["summaryRequest"],
) {
  return { ...diagnostics, summaryRequest: request };
}

function payrollFailureDiagnostics(
  diagnostics: PayrollPerformanceDiagnostics,
  label: string,
  error: unknown,
  returnedRows: number | null,
) {
  const code = supabaseErrorCode(error);
  const message = supabaseErrorMessage(error) || "Unknown Supabase error";
  return payrollDiagnosticsWithRequest(diagnostics, {
    request: label,
    status: "failed",
    httpStatus: 500,
    reachedSupabase: true,
    returnedRows,
    responseShape: "PayrollPageData error",
    supabaseCode: code || undefined,
    supabaseMessage: message,
    supabaseDetails: supabaseErrorDetails(error) || undefined,
    supabaseHint: supabaseErrorHint(error) || undefined,
  });
}

function payrollSuccessDiagnostics(
  diagnostics: PayrollPerformanceDiagnostics,
  label: string,
  returnedRows: number,
  responseShape: string,
) {
  return payrollDiagnosticsWithRequest(diagnostics, {
    request: label,
    status: "ok",
    httpStatus: 200,
    reachedSupabase: true,
    returnedRows,
    responseShape,
  });
}

function normalizePaymentStatus(value: unknown, paid: boolean, scheduledFor?: string | null): PayrollPaymentStatus {
  const clean = safeText(value).toLowerCase();
  if (clean === "paid" || clean === "scheduled" || clean === "unpaid") return clean;
  if (paid) return "paid";
  if (safeText(scheduledFor)) return "scheduled";
  return "unpaid";
}

function normalizePayrollStatusRows(rows: unknown[]): PayrollStatusRecord[] {
  return rows
    .map((row) => {
      const typed = row as {
        id: string;
        show_id: string;
        crew_id: string;
        role_name: string | null;
        paid: boolean | null;
        payment_status?: string | null;
        payout_override: number | string | null;
        notes: string | null;
        scheduled_for?: string | null;
      };
      const scheduledFor = safeText(typed.scheduled_for) || null;
      const paymentStatus = normalizePaymentStatus(typed.payment_status, Boolean(typed.paid), scheduledFor);
      return {
        id: safeText(typed.id),
        show_id: safeText(typed.show_id),
        crew_id: safeText(typed.crew_id),
        role_name: safeText(typed.role_name, PAYROLL_STATUS_ROLE),
        paid: paymentStatus === "paid",
        payment_status: paymentStatus,
        payout_override: typed.payout_override === null || typed.payout_override === undefined ? null : toNumber(typed.payout_override),
        notes: safeText(typed.notes),
        scheduled_for: scheduledFor,
      } satisfies PayrollStatusRecord;
    })
    .filter((row) => row.show_id && row.crew_id);
}

type CoordinatorPayrollStatus = {
  id: string;
  show_id: string;
  coordinator_user_id: string;
  payment_status: PayrollPaymentStatus;
  paid: boolean;
  payout_override: number | null;
  notes: string;
  scheduled_for: string | null;
};

function normalizeCoordinatorPayrollRows(rows: unknown[]): CoordinatorPayrollStatus[] {
  return rows
    .map((row) => {
      const typed = row as { id: string; show_id: string; coordinator_user_id: string; paid?: boolean | null; payment_status?: string | null; payout_override?: number | string | null; notes?: string | null; scheduled_for?: string | null };
      const scheduledFor = safeText(typed.scheduled_for) || null;
      const paymentStatus = normalizePaymentStatus(typed.payment_status, Boolean(typed.paid), scheduledFor);
      return {
        id: safeText(typed.id),
        show_id: safeText(typed.show_id),
        coordinator_user_id: safeText(typed.coordinator_user_id),
        payment_status: paymentStatus,
        paid: paymentStatus === "paid",
        payout_override: typed.payout_override === null || typed.payout_override === undefined ? null : toNumber(typed.payout_override),
        notes: safeText(typed.notes),
        scheduled_for: scheduledFor,
      };
    })
    .filter((row) => row.show_id && row.coordinator_user_id);
}

function normalizeCoordinatorPayrollFallbackRows(rows: PayrollStatusRecord[]): CoordinatorPayrollStatus[] {
  return rows
    .filter((row) => safeText(row.role_name) === COORDINATOR_PAYROLL_FALLBACK_ROLE && row.show_id && row.crew_id)
    .map((row) => ({
      id: safeText(row.id),
      show_id: safeText(row.show_id),
      coordinator_user_id: safeText(row.crew_id),
      payment_status: normalizePaymentStatus(row.payment_status, Boolean(row.paid), row.scheduled_for),
      paid: normalizePaymentStatus(row.payment_status, Boolean(row.paid), row.scheduled_for) === "paid",
      payout_override: row.payout_override,
      notes: safeText(row.notes),
      scheduled_for: row.scheduled_for ?? null,
    }));
}

function normalizeTaxProfileRows(rows: unknown[]) {
  const map = new Map<string, PayrollTaxProfileSummary>();
  for (const row of rows) {
    const typed = row as {
      crew_id?: string | null;
      tax_legal_name?: string | null;
      business_name?: string | null;
      federal_tax_classification?: string | null;
      llc_tax_classification?: string | null;
      other_classification?: string | null;
      tax_address_line_1?: string | null;
      tax_city_state_zip?: string | null;
      tin_type?: string | null;
      tin_last4?: string | null;
      tin_encrypted?: string | null;
      signer_name?: string | null;
      signature_data_url?: string | null;
      certification_confirmed?: boolean | null;
      signed_at?: string | null;
      source?: string | null;
      updated_at?: string | null;
    };
    const crewId = safeText(typed.crew_id);
    if (!crewId) continue;
    map.set(crewId, {
      taxLegalName: safeText(typed.tax_legal_name),
      businessName: safeText(typed.business_name),
      federalTaxClassification: safeText(typed.federal_tax_classification),
      llcTaxClassification: safeText(typed.llc_tax_classification),
      otherClassification: safeText(typed.other_classification),
      taxAddressLine1: safeText(typed.tax_address_line_1),
      taxCityStateZip: safeText(typed.tax_city_state_zip),
      tinType: safeText(typed.tin_type),
      tinLast4: safeText(typed.tin_last4),
      signerName: safeText(typed.signer_name),
      certificationConfirmed: Boolean(typed.certification_confirmed),
      signedAt: safeText(typed.signed_at) || null,
      source: safeText(typed.source),
      updatedAt: safeText(typed.updated_at) || null,
      hasEncryptedTin: Boolean(safeText(typed.tin_encrypted)),
      signatureCaptured: Boolean(safeText(typed.signed_at) || safeText(typed.source)),
    });
  }
  return map;
}

export function buildPayrollRows(options: {
  shows: ShowRecord[];
  laborDays: LaborDayRecord[];
  subCalls: SubCallRecord[];
  assignments: AssignmentRecord[];
  crewRecords: CrewRecord[];
  masterRates: MasterRateRecord[];
  clientRates?: MasterRateRecord[];
  clientRateOverrides?: ClientCityRateOverrideRecord[];
  payrollStatuses: PayrollStatusRecord[];
  financials?: ShowFinancialRecord[];
  expenseItems?: ShowExpenseItemRecord[];
  coordinatorNameById?: Map<string, string>;
  coordinatorPayrollStatuses?: CoordinatorPayrollStatus[];
  taxProfilesByCrewId?: Map<string, PayrollTaxProfileSummary>;
  coordinatorCompensationByUser?: Map<string, CoordinatorCompensationSchedule>;
}) {
  const { shows, laborDays, subCalls, assignments, crewRecords, masterRates, payrollStatuses } = options;
  const clientRates = options.clientRates ?? [];
  const clientRateOverrides = options.clientRateOverrides ?? [];
  const coordinatorNameById = options.coordinatorNameById ?? new Map<string, string>();
  const taxProfilesByCrewId = options.taxProfilesByCrewId ?? new Map<string, PayrollTaxProfileSummary>();
  const coordinatorCompensationByUser = options.coordinatorCompensationByUser ?? new Map<string, CoordinatorCompensationSchedule>();
  const coordinatorPayrollByShowUser = new Map((options.coordinatorPayrollStatuses ?? []).map((status) => [`${status.show_id}:${status.coordinator_user_id}`, status]));
  const financialByShow = new Map<string, ShowFinancialRecord>();
  const financialRowsNewestFirst = [...(options.financials ?? [])]
    .filter((row) => row?.show_id)
    .sort((a, b) => `${safeText(b.updated_at)} ${safeText(b.created_at)}`.localeCompare(`${safeText(a.updated_at)} ${safeText(a.created_at)}`));
  for (const row of financialRowsNewestFirst) {
    if (!financialByShow.has(row.show_id)) financialByShow.set(row.show_id, row);
  }
  const expenseItemsByShow = new Map<string, ShowExpenseItemRecord[]>();
  for (const item of options.expenseItems ?? []) {
    const showId = safeText(item?.show_id);
    if (!showId) continue;
    const list = expenseItemsByShow.get(showId) ?? [];
    list.push(item);
    expenseItemsByShow.set(showId, list);
  }
  for (const [showId, list] of expenseItemsByShow.entries()) {
    expenseItemsByShow.set(showId, list.sort((a, b) => `${safeText(b.expense_date)} ${safeText(b.created_at)}`.localeCompare(`${safeText(a.expense_date)} ${safeText(a.created_at)}`)));
  }
  const showById = new Map(shows.filter((show) => show?.id).map((show) => [show.id, show]));
  const dayById = new Map(laborDays.filter((day) => day?.id).map((day) => [day.id, day]));
  const callById = new Map(subCalls.filter((call) => call?.id).map((call) => [call.id, call]));
  const masterRateById = new Map(masterRates.filter((rate) => rate?.id).map((rate) => [String(rate.id), rate]));
  const crewById = new Map(crewRecords.filter((crew) => crew?.id).map((crew) => [crew.id, crew]));
  const statusByShowCrew = new Map(
    payrollStatuses
      .filter((status) => status.role_name === PAYROLL_STATUS_ROLE && status.show_id && status.crew_id)
      .map((status) => [`${status.show_id}:${status.crew_id}`, status]),
  );

  const grouped = new Map<string, PayrollCrewShowRow>();

  for (const assignment of assignments) {
    try {
      const assignmentId = safeText(assignment?.id);
      const subCallId = safeText(assignment?.sub_call_id);
      const crewId = safeText(assignment?.crew_id);
      if (!subCallId || !crewId) continue;

      const call = callById.get(subCallId);
      if (!call) continue;
      const laborDayId = safeText(call.labor_day_id);
      const day = dayById.get(laborDayId);
      if (!day) continue;
      const show = showById.get(safeText(day.show_id));
      if (!show) continue;

      const crew = crewById.get(crewId);
      const status = statusByShowCrew.get(`${show.id}:${crewId}`) ?? null;
      const linkedMasterRate = safeText(call.master_rate_id) ? masterRateById.get(safeText(call.master_rate_id)) : null;
      const cleanCall: SubCallRecord = {
        id: safeText(call.id, subCallId),
        labor_day_id: laborDayId,
        area: safeText(call.area, "Imported Call"),
        po_number: safeText(call.po_number) || null,
        assigned_coordinator_user_id: safeText(call.assigned_coordinator_user_id) || null,
        role_name: safeText(linkedMasterRate?.role_name) || safeText(call.role_name, "General AV"),
        master_rate_id: safeText(call.master_rate_id) || null,
        start_time: safeText(assignment.start_time) || safeText(call.start_time),
        end_time: safeText(assignment.end_time) || safeText(call.end_time),
        crew_needed: Number.isFinite(Number(call.crew_needed)) ? Number(call.crew_needed) : 1,
        notes: safeText(call.notes),
        day_type: safeText(assignment.day_type) || safeText(call.day_type) || null,
        one_hour_walkaway: Boolean(call.one_hour_walkaway),
      };
      let estimate = estimateAssignmentPay({ call: cleanCall, crew, masterRates, rateCity: safeText(show.rate_city, "Default") });
      const revenueEstimate = estimateAssignmentRevenue({
        call: cleanCall,
        clientRates,
        clientRateOverrides,
        clientId: show.business_client_id,
        rateCity: safeText(show.rate_city, "Default"),
      });
      if (assignmentIsReplacementStandbyClosed(assignment.status)) {
        estimate = {
          ...estimate,
          amount: 0,
          payLabel: "Called in — paid through replacement role",
          rateSource: "Standby closed",
        };
      }
      const key = `${show.id}:${crewId}`;
      const paymentStatus = normalizePaymentStatus(status?.payment_status, Boolean(status?.paid), status?.scheduled_for);

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          showId: safeText(show.id),
          showName: safeText(show.name, "Untitled show"),
          showClient: safeText(show.client),
          showVenue: safeText(show.venue),
          showStart: safeText(show.show_start),
          showEnd: safeText(show.show_end),
          showYear: showYear(show.show_start),
          showAssignedCoordinatorUserId: show.assigned_coordinator_user_id ?? null,
          showAssignedCoordinatorName: show.assigned_coordinator_user_id ? (coordinatorNameById.get(show.assigned_coordinator_user_id) ?? "Assigned coordinator") : null,
          coordinatorPaymentStatus: show.assigned_coordinator_user_id ? (coordinatorPayrollByShowUser.get(`${show.id}:${show.assigned_coordinator_user_id}`)?.payment_status ?? "unpaid") : "unpaid",
          coordinatorPaid: show.assigned_coordinator_user_id ? Boolean(coordinatorPayrollByShowUser.get(`${show.id}:${show.assigned_coordinator_user_id}`)?.paid) : false,
          coordinatorScheduledFor: show.assigned_coordinator_user_id ? (coordinatorPayrollByShowUser.get(`${show.id}:${show.assigned_coordinator_user_id}`)?.scheduled_for ?? null) : null,
          coordinatorOverrideAmount: show.assigned_coordinator_user_id ? (coordinatorPayrollByShowUser.get(`${show.id}:${show.assigned_coordinator_user_id}`)?.payout_override ?? null) : null,
          coordinatorNotes: show.assigned_coordinator_user_id ? (coordinatorPayrollByShowUser.get(`${show.id}:${show.assigned_coordinator_user_id}`)?.notes ?? "") : "",
          coordinatorPaymentStatusId: show.assigned_coordinator_user_id ? (coordinatorPayrollByShowUser.get(`${show.id}:${show.assigned_coordinator_user_id}`)?.id ?? null) : null,
          coordinatorRateSchedule: show.assigned_coordinator_user_id ? (coordinatorCompensationByUser.get(show.assigned_coordinator_user_id) ?? null) : null,
          crewId,
          crewName: safeText(crew?.name, "Unknown crew"),
          crewEmail: safeText(crew?.email),
          crewPhone: safeText(crew?.phone),
          w9Status: safeText(crew?.w9_status, "missing"),
          taxProfileStatus: safeText(crew?.tax_profile_status, "missing"),
          w9DocumentUrl: safeText(crew?.w9_document_url),
          taxProfileNotes: safeText(crew?.tax_profile_notes),
          taxProfile: taxProfilesByCrewId.get(crewId) ?? null,
          roles: [],
          calls: [],
          estimatedTotal: 0,
          overrideAmount: status?.payout_override ?? null,
          paid: paymentStatus === "paid",
          paymentStatus,
          notes: status?.notes ?? "",
          scheduledFor: status?.scheduled_for ?? null,
          statusId: status?.id ?? null,
          showRevenueOverride: financialByShow.get(show.id)?.estimated_revenue_override ?? null,
          showExpenses: financialByShow.get(show.id)?.expenses ?? 0,
          showFinancialNotes: stripPayrollSnapshotFromNotes(financialByShow.get(show.id)?.notes),
          showExpenseItems: expenseItemsByShow.get(show.id) ?? [],
          taxReserveDone: Boolean(financialByShow.get(show.id)?.tax_reserve_done),
          taxReserveDoneAt: financialByShow.get(show.id)?.tax_reserve_done_at ?? null,
          consecratedHandsDone: Boolean(financialByShow.get(show.id)?.consecrated_hands_done),
          consecratedHandsDoneAt: financialByShow.get(show.id)?.consecrated_hands_done_at ?? null,
        });
      }

      const row = grouped.get(key)!;
      const callCoordinatorUserId = safeText(cleanCall.assigned_coordinator_user_id) || safeText(show.assigned_coordinator_user_id) || null;
      const effectiveCoordinationOwnerUserId = safeText(assignment.coordination_owner_user_id) || callCoordinatorUserId;
      const effectiveCoordinationOwnerName = safeText(assignment.coordination_owner_name) || (effectiveCoordinationOwnerUserId ? (coordinatorNameById.get(effectiveCoordinationOwnerUserId) ?? "Assigned coordinator") : null);
      const effectiveCoordinatorPayroll = effectiveCoordinationOwnerUserId ? coordinatorPayrollByShowUser.get(`${show.id}:${effectiveCoordinationOwnerUserId}`) : null;
      row.calls.push({
        assignmentId: assignmentId || `${subCallId}:${crewId}`,
        subCallId: cleanCall.id,
        laborDayId: laborDayId,
        laborDate: safeText(day.labor_date),
        area: cleanCall.area,
        roleName: cleanCall.role_name,
        startTime: cleanCall.start_time,
        endTime: cleanCall.end_time,
        status: safeText(assignment.status, "confirmed"),
        amount: estimate.amount,
        durationHours: estimate.durationHours,
        payLabel: estimate.payLabel,
        rateSource: estimate.rateSource,
        clientRevenueAmount: revenueEstimate.amount,
        clientRateSource: revenueEstimate.rateSource,
        coordinationOwnerUserId: effectiveCoordinationOwnerUserId,
        coordinationOwnerName: effectiveCoordinationOwnerName,
        coordinationFeeWaived: Boolean(assignment.coordination_fee_waived),
        coordinationPaymentStatus: effectiveCoordinatorPayroll?.payment_status ?? "unpaid",
        coordinationPaid: Boolean(effectiveCoordinatorPayroll?.paid),
        coordinationScheduledFor: effectiveCoordinatorPayroll?.scheduled_for ?? null,
        coordinationOverrideAmount: effectiveCoordinatorPayroll?.payout_override ?? null,
        coordinationNotes: effectiveCoordinatorPayroll?.notes ?? "",
        coordinationPaymentStatusId: effectiveCoordinatorPayroll?.id ?? null,
        coordinationRateSchedule: effectiveCoordinationOwnerUserId ? (coordinatorCompensationByUser.get(effectiveCoordinationOwnerUserId) ?? null) : null,
      });
      row.estimatedTotal = Math.round((row.estimatedTotal + estimate.amount) * 100) / 100;
      row.roles = uniqueStrings([...row.roles, cleanCall.role_name]);
    } catch {
      // One malformed imported row should never take down the entire payroll page.
      continue;
    }
  }

  return [...grouped.values()]
    .map((row) => ({
      ...row,
      calls: row.calls.sort((a, b) => `${safeText(a.laborDate)} ${safeText(a.startTime)}`.localeCompare(`${safeText(b.laborDate)} ${safeText(b.startTime)}`)),
      estimatedTotal: Math.round(row.estimatedTotal * 100) / 100,
    }))
    .sort((a, b) => `${safeText(a.showStart)} ${safeText(a.showName)} ${safeText(a.crewName)}`.localeCompare(`${safeText(b.showStart)} ${safeText(b.showName)} ${safeText(b.crewName)}`));
}

export function buildEventSummaries(rows: PayrollCrewShowRow[]): PayrollEventSummary[] {
  const events = new Map<string, PayrollEventSummary>();

  for (const row of rows) {
    const showId = safeText(row.showId);
    if (!showId) continue;
    if (!events.has(showId)) {
      events.set(showId, {
        showId,
        showName: safeText(row.showName, "Untitled show"),
        showClient: safeText(row.showClient),
        showVenue: safeText(row.showVenue),
        showStart: safeText(row.showStart),
        showEnd: safeText(row.showEnd),
        showYear: row.showYear,
        rows: [],
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

    const event = events.get(showId)!;
    const payable = payrollRowPayable(row);
    event.rows.push(row);
    event.estimatedTotal += row.estimatedTotal;
    event.estimatedRevenue += (row.calls ?? []).reduce((sum, call) => sum + (call.clientRevenueAmount ?? 0), 0);
    event.payableTotal += payable;
    if (row.paymentStatus === "paid") event.paidTotal += payable;
    else event.unpaidTotal += payable;
  }

  return [...events.values()]
    .map((event) => {
      const sortedEvent = {
        ...event,
        rows: event.rows.sort((a, b) => safeText(a.crewName).localeCompare(safeText(b.crewName))),
      };
      const coordinatorPayments = coordinatorPaymentsForPayrollEvent(sortedEvent);
      const coordinatorPayment = coordinatorPayments[0] ?? null;
      const coordinatorCost = coordinatorCostForPayrollEvent({ ...sortedEvent, coordinatorPayment, coordinatorPayments });
      const itemTotal = event.expenseItems.length ? event.expenseItems.reduce((sum, item) => sum + Number(item.amount || 0), 0) : event.expenses;
      const expenses = Math.round(itemTotal * 100) / 100;
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
    .sort((a, b) => `${safeText(b.showStart)} ${safeText(b.showName)}`.localeCompare(`${safeText(a.showStart)} ${safeText(a.showName)}`));
}

export async function getPayrollAvailableYears(): Promise<number[]> {
  const currentYear = new Date().getFullYear();
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return [currentYear];
    const readClient = createSupabaseAdminClient() ?? supabase;
    const result = await readClient.from("shows").select("show_start").order("show_start", { ascending: false }).limit(5000);
    return [...new Set([
      ...(result.data ?? []).map((row) => showYear((row as { show_start?: string | null }).show_start)),
      currentYear,
    ])].filter((year) => Number.isFinite(year) && year > 1900).sort((a, b) => b - a);
  } catch {
    return [currentYear];
  }
}

function payrollSummaryForShow(show: ShowRecord, financial?: ShowFinancialRecord | null): PayrollEventSummary {
  const expenses = toNumber(financial?.expenses);
  return {
    estimatedRevenue: 0,
    estimatedProfit: 0,
    consecratedHandsDonation: 0,
    taxReserve: 0,
    combinedReserve: 0,
    pureProfit: 0,
    expenses,
    revenueOverride: financial?.estimated_revenue_override ?? null,
    financialNotes: stripPayrollSnapshotFromNotes(financial?.notes),
    expenseItems: [],
    taxReserveDone: Boolean(financial?.tax_reserve_done),
    taxReserveDoneAt: financial?.tax_reserve_done_at ?? null,
    consecratedHandsDone: Boolean(financial?.consecrated_hands_done),
    consecratedHandsDoneAt: financial?.consecrated_hands_done_at ?? null,
    showId: show.id,
    showName: safeText(show.name, "Untitled show"),
    showClient: safeText(show.client),
    showVenue: safeText(show.venue),
    showStart: safeText(show.show_start),
    showEnd: safeText(show.show_end),
    showYear: showYear(show.show_start),
    rows: [],
    coordinatorPayment: null,
    coordinatorPayments: [],
    estimatedTotal: 0,
    payableTotal: 0,
    paidTotal: 0,
    unpaidTotal: 0,
    payrollSnapshotStatus: "missing",
    payrollSnapshotSavedAt: null,
    payrollSnapshotSource: null,
  };
}


function numberFromSnapshot(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function nullableNumberFromSnapshot(value: unknown) {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function snapshotCoordinatorPaymentsArePaid(eventRecord: Record<string, unknown>) {
  const paymentList = Array.isArray(eventRecord.coordinatorPayments)
    ? eventRecord.coordinatorPayments
    : eventRecord.coordinatorPayment && typeof eventRecord.coordinatorPayment === "object"
      ? [eventRecord.coordinatorPayment]
      : [];
  for (const item of paymentList) {
    if (!item || typeof item !== "object") continue;
    const payment = item as Record<string, unknown>;
    const amount = numberFromSnapshot(payment.payableAmount);
    if (amount > 0 && safeText(payment.paymentStatus).toLowerCase() !== "paid") return false;
  }
  return true;
}

function payrollSnapshotEventIsFullyPaid(eventRecord: Record<string, unknown>) {
  const payableTotal = numberFromSnapshot(eventRecord.payableTotal);
  const paidTotal = numberFromSnapshot(eventRecord.paidTotal);
  const unpaidTotal = numberFromSnapshot(eventRecord.unpaidTotal);
  if (unpaidTotal > 0.005) return false;
  if (payableTotal > 0 && paidTotal + 0.005 < payableTotal) return false;
  if (!snapshotCoordinatorPaymentsArePaid(eventRecord)) return false;
  return payableTotal > 0 || paidTotal > 0 || Boolean(eventRecord.coordinatorPayment) || (Array.isArray(eventRecord.coordinatorPayments) && eventRecord.coordinatorPayments.length > 0);
}

function payrollEventIsFullyPaidForSnapshot(event: PayrollEventSummary) {
  if (Number(event.unpaidTotal || 0) > 0.005) return false;
  if (Number(event.payableTotal || 0) > 0 && Number(event.paidTotal || 0) + 0.005 < Number(event.payableTotal || 0)) return false;
  const coordinatorPayments = event.coordinatorPayments?.length ? event.coordinatorPayments : event.coordinatorPayment ? [event.coordinatorPayment] : [];
  for (const payment of coordinatorPayments) {
    if (Number(payment.payableAmount || 0) > 0 && payment.paymentStatus !== "paid") return false;
  }
  return Number(event.payableTotal || 0) > 0 || Number(event.paidTotal || 0) > 0 || coordinatorPayments.some((payment) => Number(payment.payableAmount || 0) > 0);
}

function storedPayrollSnapshotEvent(show: ShowRecord, financial?: ShowFinancialRecord | null, latestChecklistCompleted?: boolean | null): PayrollEventSummary | null {
  const snapshot = extractPayrollSnapshotFromNotes(financial?.notes) as StoredPayrollSnapshot | null;
  const event = snapshot?.event;
  if (!snapshot || !event || typeof event !== "object") return null;
  if (safeText(snapshot.show_id) && safeText(snapshot.show_id) !== show.id) return null;
  const eventRecord = event as Record<string, unknown>;
  if (!payrollSnapshotEventIsFullyPaid(eventRecord)) return null;
  const base = payrollSummaryForShow(show, financial);
  const coordinatorPayment = eventRecord.coordinatorPayment && typeof eventRecord.coordinatorPayment === "object" ? eventRecord.coordinatorPayment as PayrollCoordinatorPaymentSummary : null;
  const coordinatorPayments = Array.isArray(eventRecord.coordinatorPayments) ? eventRecord.coordinatorPayments as PayrollCoordinatorPaymentSummary[] : coordinatorPayment ? [coordinatorPayment] : [];
  return {
    ...base,
    rows: [],
    estimatedRevenue: numberFromSnapshot(eventRecord.estimatedRevenue),
    estimatedProfit: numberFromSnapshot(eventRecord.estimatedProfit),
    consecratedHandsDonation: numberFromSnapshot(eventRecord.consecratedHandsDonation),
    taxReserve: numberFromSnapshot(eventRecord.taxReserve),
    combinedReserve: numberFromSnapshot(eventRecord.combinedReserve),
    pureProfit: numberFromSnapshot(eventRecord.pureProfit),
    expenses: numberFromSnapshot(eventRecord.expenses ?? base.expenses),
    revenueOverride: nullableNumberFromSnapshot(eventRecord.revenueOverride),
    coordinatorPayment,
    coordinatorPayments,
    estimatedTotal: numberFromSnapshot(eventRecord.estimatedTotal),
    payableTotal: numberFromSnapshot(eventRecord.payableTotal),
    paidTotal: numberFromSnapshot(eventRecord.paidTotal),
    unpaidTotal: numberFromSnapshot(eventRecord.unpaidTotal),
    payrollSnapshotStatus: "saved",
    payrollSnapshotSavedAt: safeText(snapshot.saved_at) || null,
    payrollSnapshotSource: safeText(snapshot.source) || null,
  };
}

function payrollSnapshotPayload(event: PayrollEventSummary, source: string, showProcessCycleId?: string | null): StoredPayrollSnapshot {
  return {
    snapshot_version: 1,
    show_id: event.showId,
    saved_at: new Date().toISOString(),
    source,
    show_process_cycle_id: showProcessCycleId ?? null,
    latest_show_process_completed: true,
    event: {
      showId: event.showId,
      showName: event.showName,
      showClient: event.showClient,
      showVenue: event.showVenue,
      showStart: event.showStart,
      showEnd: event.showEnd,
      showYear: event.showYear,
      estimatedRevenue: event.estimatedRevenue,
      estimatedProfit: event.estimatedProfit,
      consecratedHandsDonation: event.consecratedHandsDonation,
      taxReserve: event.taxReserve,
      combinedReserve: event.combinedReserve,
      pureProfit: event.pureProfit,
      expenses: event.expenses,
      revenueOverride: event.revenueOverride,
      taxReserveDone: event.taxReserveDone,
      taxReserveDoneAt: event.taxReserveDoneAt,
      consecratedHandsDone: event.consecratedHandsDone,
      consecratedHandsDoneAt: event.consecratedHandsDoneAt,
      coordinatorPayment: event.coordinatorPayment ?? null,
      coordinatorPayments: event.coordinatorPayments ?? [],
      estimatedTotal: event.estimatedTotal,
      payableTotal: event.payableTotal,
      paidTotal: event.paidTotal,
      unpaidTotal: event.unpaidTotal,
      crewRowCount: event.rows.length,
    },
  };
}


function payrollRowPayable(row: PayrollCrewShowRow) {
  return row.overrideAmount ?? row.estimatedTotal;
}

function coordinatorPaymentsForPayrollEvent(event: PayrollEventSummary): PayrollCoordinatorPaymentSummary[] {
  const grouped = new Map<string, PayrollCoordinatorPaymentSummary>();
  for (const row of event.rows) {
    for (const call of row.calls) {
      if (call.coordinationFeeWaived) continue;
      const coordinatorUserId = call.coordinationOwnerUserId || row.showAssignedCoordinatorUserId || null;
      if (!coordinatorUserId) continue;
      const label = safeText(call.payLabel).toLowerCase();
      const isHalf = label.includes("half") || (call.durationHours !== null && call.durationHours <= 5);
      const existing = grouped.get(coordinatorUserId) ?? {
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
        rateSchedule: call.coordinationRateSchedule ?? (coordinatorUserId === row.showAssignedCoordinatorUserId ? row.coordinatorRateSchedule ?? null : null),
      };
      if (isHalf) existing.halfDayTechs += 1;
      else existing.fullDayTechDays += 1;
      const projectedAmount = estimateCoordinatorCompensation(existing.fullDayTechDays, existing.halfDayTechs, existing.rateSchedule).total;
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

function coordinatorCostForPayrollEvent(event: PayrollEventSummary) {
  const payments = event.coordinatorPayments?.length ? event.coordinatorPayments : event.coordinatorPayment ? [event.coordinatorPayment] : [];
  return Math.round(payments.reduce((sum, payment) => sum + Number(payment.payableAmount || 0), 0) * 100) / 100;
}

function stripPayrollEventDetailRows(event: PayrollEventSummary): PayrollEventSummary {
  return { ...event, rows: [] };
}


export async function getPayrollIndexData(requestedYear?: number): Promise<PayrollPageData> {
  const currentYear = new Date().getFullYear();
  const requested = Number(requestedYear);
  const requestedIsValid = Number.isFinite(requested) && requested > 1900 && requested < 3000;
  const loadedYear = requestedIsValid ? Math.trunc(requested) : currentYear;
  const timer = createPayrollTimer("summary", loadedYear);

  try {
    const supabase = await createSupabaseServerClient();
    timer.mark("auth/setup");
    if (!supabase) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [currentYear],
        loadedYear,
        setupMissing: true,
        error: "Supabase is not configured.",
        diagnostics: payrollDiagnosticsWithRequest(timer.done(0, 0), {
          request: "GET /api/payroll?mode=index",
          status: "failed",
          httpStatus: 500,
          reachedSupabase: false,
          returnedRows: null,
          responseShape: "Supabase environment is not configured",
          supabaseMessage: "Supabase is not configured.",
        }),
      };
    }

    const readClient = createSupabaseAdminClient() ?? supabase;
    const yearStart = `${loadedYear}-01-01`;
    const nextYearStart = `${loadedYear + 1}-01-01`;
    const showsRes = await readClient
      .from("shows")
      .select("id, name, client, business_client_id, venue, rate_city, show_start, show_end, assigned_coordinator_user_id")
      .gte("show_start", yearStart)
      .lt("show_start", nextYearStart)
      .order("show_start", { ascending: false })
      .limit(1000);
    timer.mark("show index");

    if (showsRes.error) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [loadedYear],
        loadedYear,
        setupMissing: false,
        error: `Payroll show index failed${supabaseErrorCode(showsRes.error) ? ` (${supabaseErrorCode(showsRes.error)})` : ""}: ${supabaseErrorMessage(showsRes.error) || "Unknown Supabase error"}`,
        diagnostics: payrollFailureDiagnostics(timer.done(0, 0), "GET /api/payroll?mode=index -> shows lookup", showsRes.error, null),
      };
    }

    const shows = (showsRes.data ?? []).map((row) => {
      const typed = row as {
        id: string;
        name: string | null;
        client: string | null;
        business_client_id?: string | null;
        venue: string | null;
        rate_city: string | null;
        show_start: string | null;
        show_end: string | null;
        assigned_coordinator_user_id?: string | null;
      };
      return {
        id: safeText(typed.id),
        name: safeText(typed.name, "Untitled show"),
        client: safeText(typed.client),
        business_client_id: safeText(typed.business_client_id) || null,
        client_contact_id: null,
        coordinator_contact_id: null,
        assigned_coordinator_user_id: safeText(typed.assigned_coordinator_user_id) || null,
        venue: safeText(typed.venue),
        event_location: "",
        rate_city: safeText(typed.rate_city, "Default"),
        show_start: safeText(typed.show_start),
        show_end: safeText(typed.show_end),
        notes: "",
      } satisfies ShowRecord;
    }).filter((show) => show.id);

    const showIds = shows.map((show) => show.id).filter(Boolean);
    const [financialsRes, checklistRes] = await Promise.all([
      showIds.length
        ? readClient
          .from("show_financials")
          .select("show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at")
          .in("show_id", showIds)
          .limit(5000)
        : Promise.resolve({ data: [] as unknown[], error: null as any }),
      showIds.length
        ? readClient
          .from("show_process_checklists")
          .select("id, show_id, cycle_number, completed, completed_at, updated_at")
          .in("show_id", showIds)
          .order("cycle_number", { ascending: false })
          .limit(5000)
        : Promise.resolve({ data: [] as unknown[], error: null as any }),
    ]);
    timer.mark("snapshot lookup");

    const financialByShow = new Map<string, ShowFinancialRecord>();
    if (!financialsRes.error) {
      for (const row of (financialsRes.data ?? []) as ShowFinancialRecord[]) {
        const showId = safeText(row.show_id);
        if (!showId) continue;
        const existing = financialByShow.get(showId);
        const rowStamp = Date.parse(safeText((row as ShowFinancialRecord & { updated_at?: string | null; created_at?: string | null }).updated_at) || safeText((row as ShowFinancialRecord & { created_at?: string | null }).created_at) || "") || 0;
        const existingStamp = existing ? Date.parse(safeText((existing as ShowFinancialRecord & { updated_at?: string | null; created_at?: string | null }).updated_at) || safeText((existing as ShowFinancialRecord & { created_at?: string | null }).created_at) || "") || 0 : -1;
        if (!existing || rowStamp >= existingStamp) financialByShow.set(showId, row);
      }
    }

    const latestChecklistCompleteByShow = new Map<string, boolean>();
    if (!checklistRes.error) {
      for (const row of checklistRes.data ?? []) {
        const typed = row as { show_id?: string | null; cycle_number?: number | string | null; completed?: boolean | null };
        const showId = safeText(typed.show_id);
        if (!showId || latestChecklistCompleteByShow.has(showId)) continue;
        latestChecklistCompleteByShow.set(showId, Boolean(typed.completed));
      }
    }

    let snapshotCount = 0;
    const eventSummaries = shows.map((show) => {
      const financial = financialByShow.get(show.id) ?? null;
      const latestCompleted = latestChecklistCompleteByShow.has(show.id) ? latestChecklistCompleteByShow.get(show.id)! : null;
      const snapshotEvent = storedPayrollSnapshotEvent(show, financial, latestCompleted);
      if (snapshotEvent) {
        snapshotCount += 1;
        return snapshotEvent;
      }
      const placeholder = payrollSummaryForShow(show, financial);
      return { ...placeholder, payrollSnapshotStatus: "missing" as const };
    });


    return {
      eventSummaries,
      crewRows: [],
      availableYears: [loadedYear],
      loadedYear,
      setupMissing: false,
      error: null,
      diagnostics: payrollSuccessDiagnostics(
        timer.done(eventSummaries.length, 0),
        "GET /api/payroll?mode=index",
        eventSummaries.length,
        `PayrollPageData { eventSummaries: ${snapshotCount} saved payroll snapshots + show placeholders, crewRows: [] }`,
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load payroll show index.";
    return {
      eventSummaries: [],
      crewRows: [],
      availableYears: [currentYear],
      loadedYear,
      setupMissing: false,
      error: `Payroll show index safe mode: ${message}`,
      diagnostics: payrollDiagnosticsWithRequest(timer.done(0, 0), {
        request: "GET /api/payroll?mode=index",
        status: "failed",
        httpStatus: 500,
        reachedSupabase: false,
        returnedRows: null,
        responseShape: "Thrown server error before show index payload",
        supabaseMessage: message,
      }),
    };
  }
}

export async function getPayrollSummaryData(requestedYear?: number): Promise<PayrollPageData> {
  const currentYear = new Date().getFullYear();
  const requested = Number(requestedYear);
  const requestedIsValid = Number.isFinite(requested) && requested > 1900 && requested < 3000;
  const loadedYear = requestedIsValid ? Math.trunc(requested) : currentYear;
  const timer = createPayrollTimer("summary", loadedYear);

  try {
    const supabase = await createSupabaseServerClient();
    timer.mark("auth/setup");
    if (!supabase) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [currentYear],
        loadedYear,
        setupMissing: true,
        error: null,
        diagnostics: payrollDiagnosticsWithRequest(timer.done(0, 0), {
          request: "GET /api/payroll?mode=summary",
          status: "failed",
          httpStatus: 500,
          reachedSupabase: false,
          returnedRows: null,
          responseShape: "Supabase environment is not configured",
          supabaseMessage: "Supabase is not configured.",
        }),
      };
    }

    const admin = createSupabaseAdminClient();
    const readClient = admin ?? supabase;
    const emptyResult = { data: [] as unknown[], error: null };
    const yearStart = `${loadedYear}-01-01`;
    const nextYearStart = `${loadedYear + 1}-01-01`;

    const showsRes = await readClient
      .from("shows")
      .select("id, name, client, business_client_id, venue, rate_city, show_start, show_end, assigned_coordinator_user_id")
      .gte("show_start", yearStart)
      .lt("show_start", nextYearStart)
      .order("show_start", { ascending: false })
      .limit(500);
    timer.mark("event lookup");

    if (showsRes.error) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [loadedYear],
        loadedYear,
        setupMissing: false,
        error: `GET /api/payroll?mode=summary -> shows lookup failed${supabaseErrorCode(showsRes.error) ? ` (${supabaseErrorCode(showsRes.error)})` : ""}: ${supabaseErrorMessage(showsRes.error) || "Unknown Supabase error"}`,
        diagnostics: payrollFailureDiagnostics(timer.done(0, 0), "GET /api/payroll?mode=summary -> shows lookup", showsRes.error, null),
      };
    }

    const showIds = (showsRes.data ?? []).map((row) => safeText((row as { id?: string }).id)).filter(Boolean);
    const businessClientIds = [...new Set((showsRes.data ?? []).map((row) => safeText((row as { business_client_id?: string | null }).business_client_id)).filter(Boolean))];
    const shows = (showsRes.data ?? []).map((row) => {
      const typed = row as {
        id: string;
        name: string | null;
        client: string | null;
        business_client_id?: string | null;
        venue: string | null;
        rate_city: string | null;
        show_start: string | null;
        show_end: string | null;
        assigned_coordinator_user_id?: string | null;
      };
      return {
        id: safeText(typed.id),
        name: safeText(typed.name, "Untitled show"),
        client: safeText(typed.client),
        business_client_id: safeText(typed.business_client_id) || null,
        client_contact_id: null,
        coordinator_contact_id: null,
        assigned_coordinator_user_id: safeText(typed.assigned_coordinator_user_id) || null,
        venue: safeText(typed.venue),
        event_location: "",
        rate_city: safeText(typed.rate_city, "Default"),
        show_start: safeText(typed.show_start),
        show_end: safeText(typed.show_end),
        notes: "",
      } satisfies ShowRecord;
    }).filter((show) => show.id);

    type SummaryAssignmentRow = {
      id: string;
      sub_call_id: string;
      crew_id: string;
      status: string | null;
      start_time?: string | null;
      end_time?: string | null;
      day_type?: string | null;
      coordination_owner_user_id?: string | null;
      coordination_owner_name?: string | null;
      coordination_fee_waived?: boolean | null;
    };

    async function fetchChunked(table: string, select: string, column: string, ids: string[], chunkSize = 175) {
      if (!ids.length) return { data: [] as any[], error: null as any };
      const batches: string[][] = [];
      for (let index = 0; index < ids.length; index += chunkSize) batches.push(ids.slice(index, index + chunkSize));
      const rows: any[] = [];
      for (let index = 0; index < batches.length; index += 4) {
        const window = batches.slice(index, index + 4);
        const results = await Promise.all(window.map((batch) => readClient.from(table).select(select).in(column, batch).limit(10000)));
        const failed = results.find((result) => result.error);
        if (failed?.error) return { data: [] as any[], error: failed.error };
        rows.push(...results.flatMap((result) => result.data ?? []));
      }
      return { data: rows, error: null as any };
    }

    let [
      laborInitialRes,
      ratesRes,
      clientRatesRes,
      clientRateOverridesRes,
      payrollRes,
      financialsRes,
      coordinatorPayrollRes,
      coordinatorCompensationRes,
    ] = await Promise.all([
      showIds.length
        ? fetchChunked("labor_days", "id, show_id, labor_date", "show_id", showIds, 125)
        : Promise.resolve(emptyResult),
      readClient.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      readClient.from("client_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      businessClientIds.length
        ? fetchChunked("client_rate_overrides", "id, client_id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier", "client_id", businessClientIds, 100)
        : Promise.resolve(emptyResult),
      showIds.length
        ? fetchChunked("show_payroll", "id, show_id, crew_id, role_name, paid, payment_status, payout_override, notes, scheduled_for", "show_id", showIds, 100)
        : Promise.resolve(emptyResult),
      showIds.length
        ? fetchChunked("show_financials", "id, show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at", "show_id", showIds, 100)
        : Promise.resolve(emptyResult),
      showIds.length
        ? fetchChunked("coordinator_payroll", "id, show_id, coordinator_user_id, paid, payment_status, payout_override, notes, scheduled_for", "show_id", showIds, 100)
        : Promise.resolve(emptyResult),
      readClient.from("coordinator_compensation_settings").select("coordinator_user_id, full_day_rate_1_20, full_day_rate_21_35, full_day_rate_36_50, full_day_rate_51_plus, half_day_rate_1_49, half_day_rate_50_plus, notes").limit(1000),
    ]);
    let coordinatorCompensationIdColumn: "coordinator_user_id" | "user_id" = "coordinator_user_id";
    let normalizedCoordinatorCompensationRes: {
      data: unknown[] | null;
      error: { message?: string | null; details?: string | null; hint?: string | null } | null;
    } = coordinatorCompensationRes;
    if (normalizedCoordinatorCompensationRes.error && coordinatorCompensationIdColumnMissing(normalizedCoordinatorCompensationRes.error, "coordinator_user_id")) {
      normalizedCoordinatorCompensationRes = await readClient
        .from("coordinator_compensation_settings")
        .select("user_id, full_day_rate_1_20, full_day_rate_21_35, full_day_rate_36_50, full_day_rate_51_plus, half_day_rate_1_49, half_day_rate_50_plus, notes")
        .limit(1000);
      coordinatorCompensationIdColumn = "user_id";
    }
    if (normalizedCoordinatorCompensationRes.error && coordinatorCompensationNotesColumnMissing(normalizedCoordinatorCompensationRes.error)) {
      normalizedCoordinatorCompensationRes = await readClient
        .from("coordinator_compensation_settings")
        .select(`${coordinatorCompensationIdColumn}, full_day_rate_1_20, full_day_rate_21_35, full_day_rate_36_50, full_day_rate_51_plus, half_day_rate_1_49, half_day_rate_50_plus`)
        .limit(1000);
    }
    timer.mark("summary base/status/rates");

    const laborDayIds = (laborInitialRes.data ?? []).map((row) => safeText((row as { id?: string }).id)).filter(Boolean);
    let subCallsRes = await fetchChunked(
      "sub_calls",
      "id, labor_day_id, area, po_number, assigned_coordinator_user_id, role_name, master_rate_id, start_time, end_time, crew_needed, notes, day_type, one_hour_walkaway",
      "labor_day_id",
      laborDayIds,
    );
    const subCallErrorText = safeText((subCallsRes.error as { message?: string } | null)?.message).toLowerCase();
    if (subCallsRes.error && (subCallErrorText.includes("assigned_coordinator_user_id") || subCallErrorText.includes("schema cache"))) {
      subCallsRes = await fetchChunked(
        "sub_calls",
        "id, labor_day_id, area, po_number, role_name, master_rate_id, start_time, end_time, crew_needed, notes, day_type, one_hour_walkaway",
        "labor_day_id",
        laborDayIds,
      );
    }

    const subCallIds = (subCallsRes.data ?? []).map((row) => safeText((row as { id?: string }).id)).filter(Boolean);
    let assignmentsRes = await fetchChunked(
      "assignments",
      "id, sub_call_id, crew_id, status, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived",
      "sub_call_id",
      subCallIds,
    );
    const assignmentErrorText = safeText((assignmentsRes.error as { message?: string } | null)?.message).toLowerCase();
    if (assignmentsRes.error && (
      assignmentErrorText.includes("coordination_owner") ||
      assignmentErrorText.includes("coordination_fee_waived") ||
      assignmentErrorText.includes("schema cache")
    )) {
      assignmentsRes = await fetchChunked(
        "assignments",
        "id, sub_call_id, crew_id, status, start_time, end_time, day_type",
        "sub_call_id",
        subCallIds,
      );
    }
    timer.mark("summary labor graph");

    const payrollMissing = Boolean(payrollRes.error && safeText(payrollRes.error.message).includes('relation "show_payroll" does not exist'));
    const financialsMissing = Boolean(financialsRes.error && safeText(financialsRes.error.message).includes('relation "show_financials" does not exist'));
    const clientRatesMissing = Boolean(clientRatesRes.error && safeText(clientRatesRes.error.message).includes('relation "client_rates" does not exist'));
    const clientRateOverridesMissing = Boolean(clientRateOverridesRes.error && (/client_rate_overrides|schema cache|relation/i.test(clientRateOverridesRes.error.message || "")));
    const coordinatorPayrollMissing = Boolean(coordinatorPayrollRes.error && safeText(coordinatorPayrollRes.error.message).includes('relation "coordinator_payroll" does not exist'));
    const coordinatorCompensationMissing = Boolean(normalizedCoordinatorCompensationRes.error && (/coordinator_compensation_settings|schema cache|relation/i.test(normalizedCoordinatorCompensationRes.error.message || "")));

    const essentialChecks: Array<{ label: string; error: any; rows: number | null }> = [
      { label: "GET /api/payroll?mode=summary -> labor days lookup", error: laborInitialRes.error, rows: laborInitialRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> sub-calls lookup", error: subCallsRes.error, rows: subCallsRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> assignments lookup", error: assignmentsRes.error, rows: assignmentsRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> master rates lookup", error: ratesRes.error, rows: ratesRes.data?.length ?? null },
    ];
    const failure = essentialChecks.find((check) => check.error);
    if (failure?.error) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [loadedYear],
        loadedYear,
        setupMissing: false,
        error: `${failure.label} failed${supabaseErrorCode(failure.error) ? ` (${supabaseErrorCode(failure.error)})` : ""}: ${supabaseErrorMessage(failure.error) || "Unknown Supabase error"}`,
        diagnostics: payrollFailureDiagnostics(timer.done(shows.length, 0), failure.label, failure.error, failure.rows),
      };
    }

    const laborDays = (laborInitialRes.data ?? []).map((row: unknown) => {
      const typed = row as { id: string; show_id: string; labor_date: string | null; label?: string | null; notes?: string | null };
      return { id: safeText(typed.id), show_id: safeText(typed.show_id), labor_date: safeText(typed.labor_date), label: safeText(typed.label), notes: safeText(typed.notes) } satisfies LaborDayRecord;
    }).filter((day: LaborDayRecord) => day.id && day.show_id);

    const subCalls = (subCallsRes.data ?? []).map((row: unknown) => {
      const typed = row as { id: string; labor_day_id: string; area: string | null; po_number?: string | null; assigned_coordinator_user_id?: string | null; role_name: string | null; master_rate_id?: string | null; start_time: string | null; end_time: string | null; crew_needed: number | null; notes: string | null; day_type?: string | null; one_hour_walkaway?: boolean | null };
      return { id: safeText(typed.id), labor_day_id: safeText(typed.labor_day_id), area: safeText(typed.area, "Imported Call"), po_number: safeText(typed.po_number) || null, assigned_coordinator_user_id: safeText(typed.assigned_coordinator_user_id) || null, role_name: safeText(typed.role_name, "General AV"), master_rate_id: safeText(typed.master_rate_id) || null, start_time: safeText(typed.start_time), end_time: safeText(typed.end_time), crew_needed: Number.isFinite(Number(typed.crew_needed)) ? Number(typed.crew_needed) : 1, notes: safeText(typed.notes), day_type: safeText(typed.day_type) || null, one_hour_walkaway: Boolean(typed.one_hour_walkaway) } satisfies SubCallRecord;
    }).filter((call: SubCallRecord) => call.id && call.labor_day_id);

    const assignmentRows = (assignmentsRes.data ?? []) as SummaryAssignmentRow[];
    const assignments = assignmentRows.map((row, index) => {
      const typed = row as SummaryAssignmentRow;
      return { id: safeText(typed.id), sub_call_id: safeText(typed.sub_call_id), crew_id: safeText(typed.crew_id), status: safeText(typed.status, "confirmed"), sort_order: index + 1, start_time: safeText(typed.start_time) || null, end_time: safeText(typed.end_time) || null, day_type: safeText(typed.day_type) || null, coordination_owner_user_id: safeText(typed.coordination_owner_user_id) || null, coordination_owner_name: safeText(typed.coordination_owner_name) || null, coordination_fee_waived: Boolean(typed.coordination_fee_waived) } satisfies AssignmentRecord;
    }).filter((assignment) => assignment.sub_call_id && assignment.crew_id);

    const optionalWarnings: string[] = [];
    if (payrollRes.error && !payrollMissing) optionalWarnings.push(`payment statuses unavailable: ${supabaseErrorMessage(payrollRes.error)}`);
    if (financialsRes.error && !financialsMissing) optionalWarnings.push(`show financials unavailable: ${supabaseErrorMessage(financialsRes.error)}`);
    if (clientRatesRes.error && !clientRatesMissing) optionalWarnings.push(`client rates unavailable: ${supabaseErrorMessage(clientRatesRes.error)}`);
    if (clientRateOverridesRes.error && !clientRateOverridesMissing) optionalWarnings.push(`client rate overrides unavailable: ${supabaseErrorMessage(clientRateOverridesRes.error)}`);
    if (coordinatorPayrollRes.error && !coordinatorPayrollMissing) optionalWarnings.push(`coordinator payroll unavailable: ${supabaseErrorMessage(coordinatorPayrollRes.error)}`);
    if (normalizedCoordinatorCompensationRes.error && !coordinatorCompensationMissing) optionalWarnings.push(`coordinator compensation unavailable: ${supabaseErrorMessage(normalizedCoordinatorCompensationRes.error)}`);

    const allPayrollStatuses = payrollRes.error ? [] : normalizePayrollStatusRows(payrollRes.data ?? []);
    const payrollStatuses = allPayrollStatuses.filter((row) => safeText(row.role_name) !== COORDINATOR_PAYROLL_FALLBACK_ROLE);
    const coordinatorPayrollStatuses = [
      ...normalizeCoordinatorPayrollFallbackRows(allPayrollStatuses),
      ...(coordinatorPayrollRes.error ? [] : normalizeCoordinatorPayrollRows(coordinatorPayrollRes.data ?? [])),
    ];
    const coordinatorCompensationByUser = new Map<string, CoordinatorCompensationSchedule>();
    if (!normalizedCoordinatorCompensationRes.error) {
      for (const row of normalizedCoordinatorCompensationRes.data ?? []) {
        const typed = row as Partial<CoordinatorCompensationSchedule> & { coordinator_user_id?: string | null; user_id?: string | null };
        const coordinatorUserId = coordinatorCompensationUserId(row);
        if (coordinatorUserId) coordinatorCompensationByUser.set(coordinatorUserId, normalizeCoordinatorCompensationSchedule({ ...typed, coordinator_user_id: coordinatorUserId }));
      }
    }

    const crewRows = buildPayrollRows({
      shows,
      laborDays,
      subCalls,
      assignments,
      crewRecords: [],
      masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
      clientRates: clientRatesRes.error ? [] : ((clientRatesRes.data ?? []) as MasterRateRecord[]),
      clientRateOverrides: clientRateOverridesRes.error ? [] : ((clientRateOverridesRes.data ?? []) as ClientCityRateOverrideRecord[]),
      payrollStatuses,
      financials: financialsRes.error ? [] : ((financialsRes.data ?? []) as ShowFinancialRecord[]),
      expenseItems: [],
      coordinatorPayrollStatuses,
      coordinatorCompensationByUser,
    });
    timer.mark("summary calculation");

    const summariesByShow = new Map<string, PayrollEventSummary>();
    const financialByShow = new Map<string, ShowFinancialRecord>();
    if (!financialsRes.error) {
      // Chunked reads are not globally ordered, so choose the newest financial row per show
      // explicitly. This also keeps duplicate legacy rows from reverting persisted checkoffs.
      for (const row of (financialsRes.data ?? []) as ShowFinancialRecord[]) {
        const showId = safeText(row.show_id);
        if (!showId) continue;
        const existing = financialByShow.get(showId);
        const rowStamp = Date.parse(safeText((row as ShowFinancialRecord & { updated_at?: string | null; created_at?: string | null }).updated_at) || safeText((row as ShowFinancialRecord & { created_at?: string | null }).created_at) || "") || 0;
        const existingStamp = existing
          ? Date.parse(safeText((existing as ShowFinancialRecord & { updated_at?: string | null; created_at?: string | null }).updated_at) || safeText((existing as ShowFinancialRecord & { created_at?: string | null }).created_at) || "") || 0
          : -1;
        if (!existing || rowStamp >= existingStamp) financialByShow.set(showId, row);
      }
    }
    for (const show of shows) summariesByShow.set(show.id, payrollSummaryForShow(show, financialByShow.get(show.id) ?? null));
    for (const event of buildEventSummaries(crewRows)) summariesByShow.set(event.showId, stripPayrollEventDetailRows(event));

    return {
      eventSummaries: [...summariesByShow.values()].sort((a, b) => `${safeText(b.showStart)} ${safeText(b.showName)}`.localeCompare(`${safeText(a.showStart)} ${safeText(a.showName)}`)),
      crewRows: [],
      availableYears: [loadedYear],
      loadedYear,
      setupMissing: false,
      error: payrollMissing
        ? "Run the show_payroll migration once to enable paid/unpaid tracking."
        : optionalWarnings.length
          ? `Payroll totals loaded with limited optional data: ${optionalWarnings.join("; ")}`
          : null,
      diagnostics: payrollSuccessDiagnostics(
        timer.done(shows.length, 0),
        "GET /api/payroll?mode=summary",
        summariesByShow.size,
        "PayrollPageData { eventSummaries: lightweight summaries, crewRows: [] }",
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load payroll summary.";
    return {
      eventSummaries: [],
      crewRows: [],
      availableYears: [currentYear],
      loadedYear,
      setupMissing: false,
      error: `Payroll summary safe mode: ${message}`,
      diagnostics: payrollDiagnosticsWithRequest(timer.done(0, 0), {
        request: "GET /api/payroll?mode=summary",
        status: "failed",
        httpStatus: 500,
        reachedSupabase: false,
        returnedRows: null,
        responseShape: "Thrown server error before a usable PayrollPageData payload",
        supabaseMessage: message,
      }),
    };
  }
}

export async function getPayrollPageData(requestedYear?: number, options: { summaryOnly?: boolean; showId?: string } = {}): Promise<PayrollPageData> {
  const currentYear = new Date().getFullYear();
  const requested = Number(requestedYear);
  const requestedIsValid = Number.isFinite(requested) && requested > 1900 && requested < 3000;
  let loadedYear = requestedIsValid ? Math.trunc(requested) : currentYear;
  const mode: PayrollPerformanceDiagnostics["mode"] = options.showId ? "event" : options.summaryOnly ? "summary" : "full";
  const timer = createPayrollTimer(mode, loadedYear);

  try {
    const supabase = await createSupabaseServerClient();
    timer.mark("auth/setup");
    if (!supabase) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [currentYear],
        loadedYear,
        setupMissing: true,
        error: null,
        diagnostics: payrollDiagnosticsWithRequest(timer.done(0, 0), {
          request: "GET /api/payroll?mode=summary",
          status: "failed",
          httpStatus: 500,
          reachedSupabase: false,
          returnedRows: null,
          responseShape: "Supabase environment is not configured",
          supabaseMessage: "Supabase is not configured.",
        }),
      };
    }

    const admin = createSupabaseAdminClient();
    const coordinatorReadClient = admin ?? supabase;
    const financialReadClient = admin ?? supabase;
    const emptyResult = { data: [] as unknown[], error: null };

    // Open Payroll immediately and load one selected year in the background.
    // Discovering every historical year is handled by a separate non-blocking request.
    const availableYears = [loadedYear];
    const readClient = admin ?? supabase;

    const yearStart = `${loadedYear}-01-01`;
    const nextYearStart = `${loadedYear + 1}-01-01`;
    let showsQuery = readClient
      .from("shows")
      .select("id, name, client, business_client_id, venue, rate_city, show_start, show_end, notes, assigned_coordinator_user_id")
      .order("show_start", { ascending: false });
    if (options.showId) {
      showsQuery = showsQuery.eq("id", options.showId).limit(1);
    } else {
      showsQuery = showsQuery
        .gte("show_start", yearStart)
        .lt("show_start", nextYearStart)
        .limit(options.summaryOnly ? 500 : 5000);
    }
    const showsRes = await showsQuery;
    timer.mark("event lookup");

    const showIds = (showsRes.data ?? []).map((row) => safeText((row as { id?: string }).id)).filter(Boolean);
    const shows = (showsRes.data ?? []).map((row) => {
      const typed = row as { id: string; name: string | null; client: string | null; business_client_id?: string | null; venue: string | null; rate_city: string | null; show_start: string | null; show_end: string | null; notes: string | null; assigned_coordinator_user_id?: string | null };
      return {
        id: safeText(typed.id),
        name: safeText(typed.name, "Untitled show"),
        client: safeText(typed.client),
        business_client_id: safeText(typed.business_client_id) || null,
        client_contact_id: null,
        coordinator_contact_id: null,
        assigned_coordinator_user_id: safeText(typed.assigned_coordinator_user_id) || null,
        venue: safeText(typed.venue),
        event_location: "",
        rate_city: safeText(typed.rate_city, "Default"),
        show_start: safeText(typed.show_start),
        show_end: safeText(typed.show_end),
        notes: safeText(typed.notes),
      } satisfies ShowRecord;
    }).filter((show) => show.id);
    const businessClientIds = uniqueStrings(shows.map((show) => safeText(show.business_client_id)));

    type PayrollAssignmentRow = {
      id: string;
      sub_call_id: string;
      crew_id: string;
      status: string | null;
      sort_order?: number | null;
      start_time?: string | null;
      end_time?: string | null;
      day_type?: string | null;
      coordination_owner_user_id?: string | null;
      coordination_owner_name?: string | null;
      coordination_fee_waived?: boolean | null;
    };

    const graphSelect = `
      id, show_id, labor_date, label, notes,
      sub_calls (
        id, labor_day_id, area, po_number, assigned_coordinator_user_id, role_name, master_rate_id,
        start_time, end_time, crew_needed, notes, day_type, one_hour_walkaway,
        assignments (
          id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type,
          coordination_owner_user_id, coordination_owner_name, coordination_fee_waived
        )
      )
    `;

    const graphPromise = showIds.length
      ? readClient.from("labor_days").select(graphSelect).in("show_id", showIds).order("labor_date", { ascending: true }).limit(10000)
      : Promise.resolve(emptyResult);

    let [graphInitialRes, ratesRes, clientRatesRes, clientRateOverridesRes, payrollRes, financialsRes, profilesRes, coordinatorPayrollRes, coordinatorCompensationRes] = await Promise.all([
      graphPromise,
      readClient.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      readClient.from("client_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      businessClientIds.length
        ? readClient.from("client_rate_overrides").select("id, client_id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier, created_at, updated_at").in("client_id", businessClientIds).limit(10000)
        : Promise.resolve(emptyResult),
      showIds.length
        ? readClient.from("show_payroll").select("id, show_id, crew_id, paid, payment_status, payout_override, notes, scheduled_for").in("show_id", showIds).limit(10000)
        : Promise.resolve(emptyResult),
      showIds.length
        ? financialReadClient.from("show_financials").select("id, show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at").in("show_id", showIds).limit(5000)
        : Promise.resolve(emptyResult),
      options.summaryOnly
        ? Promise.resolve(emptyResult)
        : readClient.from("profiles").select("id, email, full_name").limit(1000),
      showIds.length
        ? coordinatorReadClient.from("coordinator_payroll").select("id, show_id, coordinator_user_id, paid, payment_status, payout_override, notes, scheduled_for").in("show_id", showIds).limit(10000)
        : Promise.resolve(emptyResult),
      coordinatorReadClient.from("coordinator_compensation_settings").select("coordinator_user_id, full_day_rate_1_20, full_day_rate_21_35, full_day_rate_36_50, full_day_rate_51_plus, half_day_rate_1_49, half_day_rate_50_plus, notes").limit(1000),
    ]);
    let coordinatorCompensationIdColumn: "coordinator_user_id" | "user_id" = "coordinator_user_id";
    let normalizedCoordinatorCompensationRes: {
      data: unknown[] | null;
      error: { message?: string | null; details?: string | null; hint?: string | null } | null;
    } = coordinatorCompensationRes;
    if (normalizedCoordinatorCompensationRes.error && coordinatorCompensationIdColumnMissing(normalizedCoordinatorCompensationRes.error, "coordinator_user_id")) {
      normalizedCoordinatorCompensationRes = await coordinatorReadClient
        .from("coordinator_compensation_settings")
        .select("user_id, full_day_rate_1_20, full_day_rate_21_35, full_day_rate_36_50, full_day_rate_51_plus, half_day_rate_1_49, half_day_rate_50_plus, notes")
        .limit(1000);
      coordinatorCompensationIdColumn = "user_id";
    }
    if (normalizedCoordinatorCompensationRes.error && coordinatorCompensationNotesColumnMissing(normalizedCoordinatorCompensationRes.error)) {
      normalizedCoordinatorCompensationRes = await coordinatorReadClient
        .from("coordinator_compensation_settings")
        .select(`${coordinatorCompensationIdColumn}, full_day_rate_1_20, full_day_rate_21_35, full_day_rate_36_50, full_day_rate_51_plus, half_day_rate_1_49, half_day_rate_50_plus`)
        .limit(1000);
    }
    timer.mark("payroll graph/status/rates");

    const financialsIdColumnMissing = Boolean(financialsRes.error && (
      safeText(financialsRes.error.message).includes("show_financials.id") ||
      safeText(financialsRes.error.message).includes("column show_financials.id does not exist") ||
      safeText(financialsRes.error.message).includes("schema cache")
    ));
    if (financialsIdColumnMissing && showIds.length) {
      financialsRes = await financialReadClient
        .from("show_financials")
        .select("show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at")
        .in("show_id", showIds)
        .limit(5000);
    }
    const financialsOptionalColumnsMissing = Boolean(financialsRes.error && (
      safeText(financialsRes.error.message).includes("tax_reserve_done") ||
      safeText(financialsRes.error.message).includes("consecrated_hands_done") ||
      safeText(financialsRes.error.message).includes("created_at") ||
      safeText(financialsRes.error.message).includes("updated_at") ||
      safeText(financialsRes.error.message).includes("schema cache")
    ));
    if (financialsOptionalColumnsMissing && showIds.length) {
      financialsRes = await financialReadClient
        .from("show_financials")
        .select("show_id, estimated_revenue_override, expenses, notes")
        .in("show_id", showIds)
        .limit(5000);
    }

    const payrollStatusColumnsMissing = Boolean(payrollRes.error && (
      safeText(payrollRes.error.message).includes("payment_status") ||
      safeText(payrollRes.error.message).includes("scheduled_for") ||
      safeText(payrollRes.error.message).includes("schema cache")
    ));
    if (payrollStatusColumnsMissing && showIds.length) {
      payrollRes = await readClient
        .from("show_payroll")
        .select("id, show_id, crew_id, paid, payout_override, notes")
        .in("show_id", showIds)
        .limit(10000);
    }

    const graphErrorText = safeText((graphInitialRes.error as { message?: string } | null)?.message).toLowerCase();
    const graphNeedsLegacyFallback = Boolean(graphInitialRes.error && (
      graphErrorText.includes("relationship") ||
      graphErrorText.includes("could not find") ||
      graphErrorText.includes("unexpected input") ||
      graphErrorText.includes("assigned_coordinator_user_id") ||
      graphErrorText.includes("coordination_owner") ||
      graphErrorText.includes("coordination_fee_waived") ||
      graphErrorText.includes("schema cache")
    ));

    let laborDaysRes: any = emptyResult;
    let payrollSubCallsRes: any = emptyResult;
    let assignmentRows: PayrollAssignmentRow[] = [];
    let assignmentsMissing = false;
    let assignmentsError: any = null;

    if (!graphInitialRes.error) {
      const laborRows: unknown[] = [];
      const callRows: unknown[] = [];
      const flattenedAssignments: PayrollAssignmentRow[] = [];
      for (const dayRow of graphInitialRes.data ?? []) {
        const typedDay = dayRow as Record<string, unknown> & { sub_calls?: unknown[] | null };
        const { sub_calls: nestedCalls, ...plainDay } = typedDay;
        laborRows.push(plainDay);
        for (const callRow of nestedCalls ?? []) {
          const typedCall = callRow as Record<string, unknown> & { assignments?: unknown[] | null };
          const { assignments: nestedAssignments, ...plainCall } = typedCall;
          callRows.push(plainCall);
          for (const assignment of nestedAssignments ?? []) flattenedAssignments.push(assignment as PayrollAssignmentRow);
        }
      }
      laborDaysRes = { data: laborRows, error: null };
      payrollSubCallsRes = { data: callRows, error: null };
      assignmentRows = flattenedAssignments;
    } else if (graphNeedsLegacyFallback || showIds.length) {
      // Older Supabase schemas may not expose nested relationships or the newest
      // coordinator columns. Keep a compatibility path, but use it only when the
      // three-query payroll graph is unavailable.
      laborDaysRes = showIds.length
        ? await readClient.from("labor_days").select("id, show_id, labor_date, label, notes").in("show_id", showIds).order("labor_date", { ascending: true }).limit(10000)
        : emptyResult;
      const laborDayIds = (laborDaysRes.data ?? []).map((row: unknown) => safeText((row as { id?: string }).id)).filter(Boolean);
      let subCallsRes: any = laborDayIds.length
        ? await readClient.from("sub_calls").select("id, labor_day_id, area, po_number, assigned_coordinator_user_id, role_name, master_rate_id, start_time, end_time, crew_needed, notes, day_type, one_hour_walkaway").in("labor_day_id", laborDayIds).order("start_time", { ascending: true }).limit(20000)
        : emptyResult;
      if (subCallsRes.error && safeText(subCallsRes.error.message).includes("assigned_coordinator_user_id") && laborDayIds.length) {
        subCallsRes = await readClient.from("sub_calls").select("id, labor_day_id, area, po_number, role_name, master_rate_id, start_time, end_time, crew_needed, notes, day_type, one_hour_walkaway").in("labor_day_id", laborDayIds).order("start_time", { ascending: true }).limit(20000);
      }
      payrollSubCallsRes = subCallsRes;
      const subCallIds = (payrollSubCallsRes.data ?? []).map((row: unknown) => safeText((row as { id?: string }).id)).filter(Boolean);
      let assignmentsRes: any = subCallIds.length
        ? await readClient.from("assignments").select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived").in("sub_call_id", subCallIds).order("sort_order", { ascending: true }).limit(20000)
        : emptyResult;
      assignmentsMissing = Boolean(assignmentsRes.error && safeText(assignmentsRes.error.message).includes('relation "assignments" does not exist'));
      const assignmentsCoordinationColumnsMissing = Boolean(assignmentsRes.error && (
        safeText(assignmentsRes.error.message).includes("coordination_owner") ||
        safeText(assignmentsRes.error.message).includes("coordination_fee_waived") ||
        safeText(assignmentsRes.error.message).includes("schema cache")
      ));
      assignmentRows = (assignmentsRes.data ?? []) as PayrollAssignmentRow[];
      assignmentsError = assignmentsRes.error;
      if (!assignmentsMissing && assignmentsCoordinationColumnsMissing && subCallIds.length) {
        const fallbackAssignmentsRes = await readClient
          .from("assignments")
          .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type")
          .in("sub_call_id", subCallIds)
          .order("sort_order", { ascending: true })
          .limit(20000);
        assignmentRows = (fallbackAssignmentsRes.data ?? []) as PayrollAssignmentRow[];
        assignmentsError = fallbackAssignmentsRes.error;
      }
    } else {
      assignmentsError = graphInitialRes.error;
    }

    const cityPoolsRes = emptyResult;
    const expenseItemsRes = emptyResult;
    const crewIds = [...new Set(assignmentRows.map((row) => safeText(row.crew_id)).filter(Boolean))];

    const crewColumns = options.summaryOnly
      ? "id, name, email, phone"
      : "id, name, email, phone, w9_status, tax_profile_status, w9_document_url, tax_profile_notes";
    const crewPromise = crewIds.length
      ? readClient.from("crew").select(crewColumns).in("id", crewIds).order("name", { ascending: true }).limit(10000)
      : Promise.resolve(emptyResult);
    const positionsPromise = crewIds.length
      ? readClient.from("crew_positions").select("id, crew_id, role_name, rate").in("crew_id", crewIds).order("role_name", { ascending: true }).limit(20000)
      : Promise.resolve(emptyResult);
    const taxProfilesPromise = !options.summaryOnly && crewIds.length
      ? readClient.from("crew_tax_profiles").select("crew_id, tax_legal_name, business_name, federal_tax_classification, llc_tax_classification, other_classification, tax_address_line_1, tax_city_state_zip, tin_type, tin_last4, tin_encrypted, signer_name, certification_confirmed, signed_at, source, updated_at").in("crew_id", crewIds).limit(10000)
      : Promise.resolve(emptyResult);

    let [crewRes, positionsRes, taxProfilesRes] = await Promise.all([crewPromise, positionsPromise, taxProfilesPromise]);
    timer.mark("crew/profile/tax lookup");
    const crewOnboardingColumnsMissing = Boolean(crewRes.error && (
      safeText(crewRes.error.message).includes("w9_status") ||
      safeText(crewRes.error.message).includes("tax_profile_status") ||
      safeText(crewRes.error.message).includes("w9_document_url") ||
      safeText(crewRes.error.message).includes("tax_profile_notes") ||
      safeText(crewRes.error.message).includes("schema cache")
    ));
    if (crewOnboardingColumnsMissing && crewIds.length) {
      crewRes = await readClient.from("crew").select("id, name, email, phone").in("id", crewIds).order("name", { ascending: true }).limit(10000);
    }
    const payrollCrewRes = crewRes;

    const payrollMissing = Boolean(payrollRes.error && payrollRes.error.message.includes('relation "show_payroll" does not exist'));
    const financialsMissing = Boolean(financialsRes.error && financialsRes.error.message.includes('relation "show_financials" does not exist'));
    const clientRatesMissing = Boolean(clientRatesRes.error && clientRatesRes.error.message.includes('relation "client_rates" does not exist'));
    const clientRateOverridesMissing = Boolean(clientRateOverridesRes.error && (/client_rate_overrides|schema cache|relation/i.test(clientRateOverridesRes.error.message || "")));
    const expenseItemsMissing = false;
    const taxProfilesMissing = Boolean(taxProfilesRes.error && (/crew_tax_profiles|schema cache|relation/i.test(taxProfilesRes.error.message || "")));
    let coordinatorPayrollRows: unknown[] = coordinatorPayrollRes.data ?? [];
    let coordinatorPayrollError = coordinatorPayrollRes.error;
    let coordinatorPayrollMissing = Boolean(coordinatorPayrollError && coordinatorPayrollError.message.includes('relation "coordinator_payroll" does not exist'));
    const coordinatorPayrollColumnsMissing = Boolean(coordinatorPayrollError && !coordinatorPayrollMissing && (
      coordinatorPayrollError.message.includes("payment_status") ||
      coordinatorPayrollError.message.includes("scheduled_for") ||
      coordinatorPayrollError.message.includes("schema cache")
    ));
    if (coordinatorPayrollColumnsMissing && showIds.length) {
      const fallbackCoordinatorPayrollRes = await coordinatorReadClient
        .from("coordinator_payroll")
        .select("id, show_id, coordinator_user_id, paid, payout_override, notes")
        .in("show_id", showIds)
        .limit(10000);
      coordinatorPayrollRows = fallbackCoordinatorPayrollRes.data ?? [];
      coordinatorPayrollError = fallbackCoordinatorPayrollRes.error;
      coordinatorPayrollMissing = Boolean(coordinatorPayrollError && coordinatorPayrollError.message.includes('relation "coordinator_payroll" does not exist'));
    }

    const errorChecks: Array<{ label: string; error: any; rows: number | null }> = [
      { label: "GET /api/payroll?mode=summary -> shows lookup", error: showsRes.error, rows: showsRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> labor days lookup", error: laborDaysRes.error, rows: laborDaysRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> sub-calls lookup", error: payrollSubCallsRes.error, rows: payrollSubCallsRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> assignments lookup", error: assignmentsMissing ? null : assignmentsError, rows: assignmentRows.length },
      { label: "GET /api/payroll?mode=summary -> crew lookup", error: payrollCrewRes.error, rows: payrollCrewRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> crew positions lookup", error: positionsRes.error, rows: positionsRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> master rates lookup", error: ratesRes.error, rows: ratesRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> client rates lookup", error: clientRatesMissing ? null : clientRatesRes.error, rows: clientRatesRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> client rate overrides lookup", error: clientRateOverridesMissing ? null : clientRateOverridesRes.error, rows: clientRateOverridesRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> show_payroll status lookup", error: payrollMissing ? null : payrollRes.error, rows: payrollRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> show_financials lookup", error: financialsMissing ? null : financialsRes.error, rows: financialsRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> show expense items lookup", error: expenseItemsMissing ? null : expenseItemsRes.error, rows: expenseItemsRes.data?.length ?? null },
      { label: "GET /api/payroll?mode=summary -> coordinator payroll lookup", error: coordinatorPayrollMissing ? null : coordinatorPayrollError, rows: coordinatorPayrollRows.length },
      { label: "GET /api/payroll?mode=summary -> tax profile lookup", error: taxProfilesMissing ? null : taxProfilesRes.error, rows: taxProfilesRes.data?.length ?? null },
    ];
    if (!options.summaryOnly) {
      errorChecks.push({ label: "GET /api/payroll?mode=event -> coordinator profile lookup", error: profilesRes.error, rows: profilesRes.data?.length ?? null });
    }
    const failure = errorChecks.find((check) => check.error);
    const error = failure?.error ?? null;

    if (error) {
      const message = `${failure?.label ?? "Payroll summary"} failed${supabaseErrorCode(error) ? ` (${supabaseErrorCode(error)})` : ""}: ${supabaseErrorMessage(error) || "Unknown Supabase error"}`;
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: availableYears.length ? availableYears : [currentYear],
        loadedYear,
        setupMissing: false,
        error: message,
        diagnostics: payrollFailureDiagnostics(timer.done(shows.length, 0), failure?.label ?? "GET /api/payroll?mode=summary", error, failure?.rows ?? null),
      };
    }

    const laborDays = (laborDaysRes.data ?? []).map((row: unknown) => {
      const typed = row as { id: string; show_id: string; labor_date: string | null; label: string | null; notes: string | null };
      return { id: safeText(typed.id), show_id: safeText(typed.show_id), labor_date: safeText(typed.labor_date), label: safeText(typed.label), notes: safeText(typed.notes) } satisfies LaborDayRecord;
    }).filter((day: LaborDayRecord) => day.id && day.show_id);

    const subCalls = (payrollSubCallsRes.data ?? []).map((row: unknown) => {
      const typed = row as { id: string; labor_day_id: string; area: string | null; po_number?: string | null; assigned_coordinator_user_id?: string | null; role_name: string | null; master_rate_id?: string | null; start_time: string | null; end_time: string | null; crew_needed: number | null; notes: string | null; day_type?: string | null; one_hour_walkaway?: boolean | null };
      return { id: safeText(typed.id), labor_day_id: safeText(typed.labor_day_id), area: safeText(typed.area, "Imported Call"), po_number: safeText(typed.po_number) || null, assigned_coordinator_user_id: safeText(typed.assigned_coordinator_user_id) || null, role_name: safeText(typed.role_name, "General AV"), master_rate_id: safeText(typed.master_rate_id) || null, start_time: safeText(typed.start_time), end_time: safeText(typed.end_time), crew_needed: Number.isFinite(Number(typed.crew_needed)) ? Number(typed.crew_needed) : 1, notes: safeText(typed.notes), day_type: safeText(typed.day_type) || null, one_hour_walkaway: Boolean(typed.one_hour_walkaway) } satisfies SubCallRecord;
    }).filter((call: SubCallRecord) => call.id && call.labor_day_id);

    const assignments = assignmentsMissing ? [] : assignmentRows.map((row, index) => {
      const typed = row as PayrollAssignmentRow;
      return { id: safeText(typed.id), sub_call_id: safeText(typed.sub_call_id), crew_id: safeText(typed.crew_id), status: safeText(typed.status, "confirmed"), sort_order: typed.sort_order ?? index + 1, start_time: safeText(typed.start_time) || null, end_time: safeText(typed.end_time) || null, day_type: safeText(typed.day_type) || null, coordination_owner_user_id: safeText(typed.coordination_owner_user_id) || null, coordination_owner_name: safeText(typed.coordination_owner_name) || null, coordination_fee_waived: Boolean(typed.coordination_fee_waived) } satisfies AssignmentRecord;
    }).filter((assignment) => assignment.sub_call_id && assignment.crew_id);

    const cityMapEntries: Array<[string, string]> = (cityPoolsRes.data ?? [])
      .map((pool): [string, string] => [safeText((pool as { id: string }).id), safeText((pool as { name: string }).name)])
      .filter(([id]) => Boolean(id));
    const cityMap = new Map<string, string>(cityMapEntries);
    const positionsByCrew = new Map<string, CrewRecord["positions"]>();
    for (const row of positionsRes.data ?? []) {
      const typed = row as { id: string; crew_id: string; role_name: string | null; rate: number | string | null };
      const crewId = safeText(typed.crew_id);
      if (!crewId) continue;
      const list = positionsByCrew.get(crewId) ?? [];
      list.push({ id: safeText(typed.id), role_name: safeText(typed.role_name), rate: toNumber(typed.rate) });
      positionsByCrew.set(crewId, list);
    }

    const crewRecords = (payrollCrewRes.data ?? []).map((row: unknown) => {
      const typed = row as { id: string; name: string | null; description: string | null; city_pool_id: string | null; group_name: string | null; tier: string | null; email: string | null; phone: string | null; address?: string | null; lead_from?: string | null; other_city: string | null; ob: boolean | null; onboarding_texted_called?: boolean | null; onboarding_response?: boolean | null; onboarding_paperwork_sent?: boolean | null; onboarding_successfully_onboarded?: boolean | null; onboarding_called_placed_tier?: boolean | null; w9_status?: string | null; tax_profile_status?: string | null; w9_document_url?: string | null; tax_profile_notes?: string | null; notes: string | null; conflict_companies: string[] | null };
      const id = safeText(typed.id);
      return {
        id,
        name: safeText(typed.name, "Unknown crew"),
        description: safeText(typed.description),
        city_pool_id: safeText(typed.city_pool_id) || null,
        city_name: typed.city_pool_id ? cityMap.get(safeText(typed.city_pool_id)) ?? "Unassigned" : "Unassigned",
        additional_city_pool_ids: [],
        additional_city_pool_names: [],
        group_name: safeText(typed.group_name, "Ungrouped"),
        tier: safeText(typed.tier),
        email: safeText(typed.email),
        phone: safeText(typed.phone),
        address: safeText(typed.address),
        lead_from: safeText(typed.lead_from),
        other_city: safeText(typed.other_city),
        ob: Boolean(typed.ob),
        onboarding_texted_called: Boolean(typed.onboarding_texted_called),
        onboarding_response: Boolean(typed.onboarding_response),
        onboarding_paperwork_sent: Boolean(typed.onboarding_paperwork_sent),
        onboarding_successfully_onboarded: Boolean(typed.onboarding_successfully_onboarded),
        onboarding_called_placed_tier: Boolean(typed.onboarding_called_placed_tier),
        w9_status: safeText(typed.w9_status, "missing"),
        tax_profile_status: safeText(typed.tax_profile_status, "missing"),
        w9_document_url: safeText(typed.w9_document_url),
        tax_profile_notes: safeText(typed.tax_profile_notes),
        blacklisted: false,
        blacklist_reason: "",
        notes: safeText(typed.notes),
        conflict_companies: Array.isArray(typed.conflict_companies) ? typed.conflict_companies : [],
        positions: positionsByCrew.get(id) ?? [],
        unavailable_dates: [],
      } satisfies CrewRecord;
    }).filter((crew: CrewRecord) => crew.id);

    const coordinatorNameById = new Map<string, string>((profilesRes.data ?? []).map((profile) => {
      const typed = profile as { id: string; email?: string | null; full_name?: string | null };
      return [safeText(typed.id), safeText(typed.full_name, safeText(typed.email, "Assigned coordinator"))] as const;
    }).filter(([id]) => Boolean(id)));

    const coordinatorCompensationByUser = new Map<string, CoordinatorCompensationSchedule>();
    if (!normalizedCoordinatorCompensationRes.error) {
      for (const row of normalizedCoordinatorCompensationRes.data ?? []) {
        const typed = row as Partial<CoordinatorCompensationSchedule> & { coordinator_user_id?: string | null; user_id?: string | null };
        const coordinatorUserId = coordinatorCompensationUserId(row);
        if (!coordinatorUserId) continue;
        coordinatorCompensationByUser.set(coordinatorUserId, normalizeCoordinatorCompensationSchedule({ ...typed, coordinator_user_id: coordinatorUserId }));
      }
    }

    const allPayrollStatuses = payrollMissing ? [] : normalizePayrollStatusRows(payrollRes.data ?? []);
    const payrollStatuses = allPayrollStatuses.filter((row) => safeText(row.role_name) !== COORDINATOR_PAYROLL_FALLBACK_ROLE);
    const coordinatorPayrollFallbackStatuses = normalizeCoordinatorPayrollFallbackRows(allPayrollStatuses);
    const taxProfilesByCrewId = taxProfilesMissing ? new Map<string, PayrollTaxProfileSummary>() : normalizeTaxProfileRows(taxProfilesRes.data ?? []);
    const coordinatorPayrollStatuses = [
      ...coordinatorPayrollFallbackStatuses,
      ...(coordinatorPayrollMissing ? [] : normalizeCoordinatorPayrollRows(coordinatorPayrollRows)),
    ];

    const crewRows = buildPayrollRows({
      shows,
      laborDays,
      subCalls,
      assignments,
      crewRecords,
      masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
      clientRates: clientRatesMissing ? [] : ((clientRatesRes.data ?? []) as MasterRateRecord[]),
      clientRateOverrides: clientRateOverridesMissing ? [] : ((clientRateOverridesRes.data ?? []) as ClientCityRateOverrideRecord[]),
      payrollStatuses,
      financials: financialsMissing ? [] : ((financialsRes.data ?? []) as ShowFinancialRecord[]),
      expenseItems: expenseItemsMissing ? [] : ((expenseItemsRes.data ?? []) as ShowExpenseItemRecord[]),
      coordinatorNameById,
      coordinatorPayrollStatuses,
      taxProfilesByCrewId,
      coordinatorCompensationByUser,
    });
    timer.mark("payroll calculation");

    const calculatedEventSummaries = buildEventSummaries(crewRows);
    const eventSummaryByShow = new Map<string, PayrollEventSummary>();
    for (const show of shows) {
      const financial = financialsMissing
        ? null
        : ((financialsRes.data ?? []) as ShowFinancialRecord[]).find((row) => safeText(row.show_id) === show.id) ?? null;
      eventSummaryByShow.set(show.id, payrollSummaryForShow(show, financial));
    }
    for (const event of calculatedEventSummaries) eventSummaryByShow.set(event.showId, event);
    const eventSummaries = [...eventSummaryByShow.values()].sort((a, b) => `${safeText(b.showStart)} ${safeText(b.showName)}`.localeCompare(`${safeText(a.showStart)} ${safeText(a.showName)}`));
    return {
      eventSummaries: options.summaryOnly ? eventSummaries.map(stripPayrollEventDetailRows) : eventSummaries,
      crewRows: options.summaryOnly ? [] : crewRows,
      availableYears: availableYears.length ? availableYears : [currentYear],
      loadedYear,
      setupMissing: false,
      error: payrollMissing ? "Run the show_payroll migration once to enable paid/unpaid tracking." : null,
      diagnostics: payrollSuccessDiagnostics(
        timer.done(shows.length, options.summaryOnly ? 0 : crewRows.length),
        options.showId ? "GET /api/payroll?mode=event" : "GET /api/payroll?mode=summary",
        eventSummaries.length,
        options.summaryOnly ? "PayrollPageData { eventSummaries: summary rows, crewRows: [] }" : "PayrollPageData { eventSummaries: detail rows, crewRows: detail rows }",
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load payroll data.";
    return {
      eventSummaries: [],
      crewRows: [],
      availableYears: [currentYear],
      loadedYear,
      setupMissing: false,
      error: `Payroll safe mode: ${message}`,
      diagnostics: payrollDiagnosticsWithRequest(timer.done(0, 0), {
        request: options.showId ? "GET /api/payroll?mode=event" : "GET /api/payroll?mode=summary",
        status: "failed",
        httpStatus: 500,
        reachedSupabase: false,
        returnedRows: null,
        responseShape: "Thrown server error before a usable PayrollPageData payload",
        supabaseMessage: message,
      }),
    };
  }
}

export async function savePayrollSnapshotForShow(showId: string, options: { source?: string; showProcessCycleId?: string | null; requireLatestCompleted?: boolean } = {}) {
  const cleanShowId = safeText(showId);
  if (!cleanShowId) return { ok: false as const, skipped: false, message: "Show is required for Payroll snapshot." };
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false as const, skipped: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing; Payroll snapshot was not saved." };

  const requireLatestCompleted = options.requireLatestCompleted === true;
  let latestCycleId = options.showProcessCycleId ?? null;
  if (requireLatestCompleted) {
    const latestRes = await admin
      .from("show_process_checklists")
      .select("id, completed")
      .eq("show_id", cleanShowId)
      .order("cycle_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestRes.error && !/show_process_checklists|schema cache|relation/i.test(latestRes.error.message || "")) {
      return { ok: false as const, skipped: false, message: `Could not verify completed show checklist before Payroll snapshot: ${latestRes.error.message}` };
    }
    if (!latestRes.error && latestRes.data) {
      latestCycleId = safeText((latestRes.data as { id?: string | null }).id) || latestCycleId;
      if (!Boolean((latestRes.data as { completed?: boolean | null }).completed)) {
        return { ok: true as const, skipped: true, message: "Payroll snapshot skipped because the latest show checklist is not complete yet." };
      }
    }
  }

  const showRes = await admin
    .from("shows")
    .select("id, show_start")
    .eq("id", cleanShowId)
    .maybeSingle();
  if (showRes.error) return { ok: false as const, skipped: false, message: `Could not find show for Payroll snapshot: ${showRes.error.message}` };
  const showStart = safeText((showRes.data as { show_start?: string | null } | null)?.show_start);
  const year = showYear(showStart);
  const payrollData = await getPayrollPageData(year, { showId: cleanShowId, summaryOnly: true });
  const event = payrollData.eventSummaries.find((item) => item.showId === cleanShowId) ?? null;
  if (!event) {
    return { ok: false as const, skipped: false, message: payrollData.error || "Could not calculate this show's Payroll totals for snapshot." };
  }

  const shouldSaveSnapshot = payrollEventIsFullyPaidForSnapshot(event);
  const snapshot = shouldSaveSnapshot ? payrollSnapshotPayload(event, options.source || "paid_show", latestCycleId) : null;
  const now = new Date().toISOString();
  const financialSelect = "id, show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at";
  let existingRes = await admin
    .from("show_financials")
    .select(financialSelect)
    .eq("show_id", cleanShowId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let idColumnAvailable = true;
  if (existingRes.error && (/show_financials\.id|column show_financials\.id|schema cache/i.test(existingRes.error.message || ""))) {
    idColumnAvailable = false;
    existingRes = await admin
      .from("show_financials")
      .select("show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at")
      .eq("show_id", cleanShowId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  if (existingRes.error) {
    const message = /show_financials|schema cache|relation/i.test(existingRes.error.message || "")
      ? "Run the show_financials SQL once so fully paid shows can save Payroll snapshots."
      : existingRes.error.message;
    return { ok: false as const, skipped: false, message };
  }

  const existing = existingRes.data as (ShowFinancialRecord & { id?: string | null }) | null;
  const mergedNotes = mergePayrollSnapshotIntoNotes(existing?.notes ?? "", snapshot);
  const existingId = safeText(existing?.id);
  const updatePayload: Record<string, unknown> = { notes: mergedNotes, updated_at: now };
  const writeRes = existing
    ? existingId && idColumnAvailable
      ? await admin.from("show_financials").update(updatePayload).eq("id", existingId)
      : await admin.from("show_financials").update(updatePayload).eq("show_id", cleanShowId)
    : await admin.from("show_financials").insert({
      show_id: cleanShowId,
      estimated_revenue_override: event.revenueOverride,
      expenses: event.expenses,
      notes: mergedNotes,
      created_at: now,
      updated_at: now,
    });

  if (writeRes.error) {
    const message = /show_financials|schema cache|relation|column/i.test(writeRes.error.message || "")
      ? `Payroll snapshot could not be saved because show_financials needs its SQL update: ${writeRes.error.message}`
      : writeRes.error.message;
    return { ok: false as const, skipped: false, message };
  }

  return shouldSaveSnapshot
    ? { ok: true as const, skipped: false, message: "Payroll totals snapshot saved for this fully paid show.", event }
    : { ok: true as const, skipped: true, message: "Payroll snapshot cleared/skipped because this show is not fully paid yet.", event };
}
