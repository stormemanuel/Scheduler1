import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import type { CrewRecord } from "@/lib/crew-types";
import type { LaborDayRecord, ShowRecord, SubCallRecord, AssignmentRecord } from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { PayrollEventSummary, PayrollPageData, PayrollStatusRecord, PayrollCrewShowRow, PayrollPaymentStatus, PayrollTaxProfileSummary } from "@/lib/payroll-types";
import type { ShowExpenseItemRecord, ShowFinancialRecord } from "@/lib/financial-types";
import { estimateAssignmentPay, estimateAssignmentRevenue, PAYROLL_STATUS_ROLE, showYear } from "@/lib/payroll-calculations";

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
  payrollStatuses: PayrollStatusRecord[];
  financials?: ShowFinancialRecord[];
  expenseItems?: ShowExpenseItemRecord[];
  coordinatorNameById?: Map<string, string>;
  coordinatorPayrollStatuses?: CoordinatorPayrollStatus[];
  taxProfilesByCrewId?: Map<string, PayrollTaxProfileSummary>;
}) {
  const { shows, laborDays, subCalls, assignments, crewRecords, masterRates, payrollStatuses } = options;
  const clientRates = options.clientRates ?? [];
  const coordinatorNameById = options.coordinatorNameById ?? new Map<string, string>();
  const taxProfilesByCrewId = options.taxProfilesByCrewId ?? new Map<string, PayrollTaxProfileSummary>();
  const coordinatorPayrollByShowUser = new Map((options.coordinatorPayrollStatuses ?? []).map((status) => [`${status.show_id}:${status.coordinator_user_id}`, status]));
  const financialByShow = new Map((options.financials ?? []).filter((row) => row?.show_id).map((row) => [row.show_id, row]));
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
      const revenueEstimate = estimateAssignmentRevenue({ call: cleanCall, clientRates, rateCity: safeText(show.rate_city, "Default") });
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
          showFinancialNotes: financialByShow.get(show.id)?.notes ?? "",
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
    const payable = row.overrideAmount ?? row.estimatedTotal;
    event.rows.push(row);
    event.estimatedTotal += row.estimatedTotal;
    event.estimatedRevenue += (row.calls ?? []).reduce((sum, call) => sum + (call.clientRevenueAmount ?? 0), 0);
    event.payableTotal += payable;
    if (row.paymentStatus === "paid") event.paidTotal += payable;
    else event.unpaidTotal += payable;
  }

  return [...events.values()]
    .map((event) => {
      const itemTotal = event.expenseItems.length ? event.expenseItems.reduce((sum, item) => sum + Number(item.amount || 0), 0) : event.expenses;
      const expenses = Math.round(itemTotal * 100) / 100;
      const revenue = Math.round(((event.revenueOverride ?? event.estimatedRevenue) || 0) * 100) / 100;
      const profit = Math.round((revenue - event.payableTotal - expenses) * 100) / 100;
      const positiveProfit = Math.max(0, profit);
      return {
        ...event,
        rows: event.rows.sort((a, b) => safeText(a.crewName).localeCompare(safeText(b.crewName))),
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

export async function getPayrollPageData(): Promise<PayrollPageData> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [new Date().getFullYear()],
        setupMissing: true,
        error: null,
      };
    }

    const admin = createSupabaseAdminClient();
    const coordinatorReadClient = admin ?? supabase;
    const financialReadClient = admin ?? supabase;

    const [showsRes, laborDaysRes, subCallsRes, assignmentsRes, crewRes, positionsRes, cityPoolsRes, ratesRes, clientRatesRes, payrollRes, financialsRes, expenseItemsRes, profilesRes, coordinatorPayrollRes, taxProfilesRes] = await Promise.all([
      supabase.from("shows").select("id, name, client, venue, rate_city, show_start, show_end, notes, assigned_coordinator_user_id").order("show_start", { ascending: false }).limit(5000),
      supabase.from("labor_days").select("id, show_id, labor_date, label, notes").order("labor_date", { ascending: true }).limit(10000),
      supabase.from("sub_calls").select("id, labor_day_id, area, po_number, assigned_coordinator_user_id, role_name, master_rate_id, start_time, end_time, crew_needed, notes, day_type, one_hour_walkaway").order("start_time", { ascending: true }).limit(20000),
      supabase.from("assignments").select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type, coordination_owner_user_id, coordination_owner_name, coordination_fee_waived").order("sort_order", { ascending: true }).limit(20000),
      supabase.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, w9_status, tax_profile_status, w9_document_url, tax_profile_notes, notes, conflict_companies").order("name", { ascending: true }).limit(10000),
      supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }).limit(20000),
      supabase.from("city_pools").select("id, name").limit(1000),
      supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      supabase.from("client_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      supabase.from("show_payroll").select("*").limit(20000),
      financialReadClient.from("show_financials").select("*").limit(10000),
      financialReadClient.from("show_expense_items").select("id, show_id, category, description, amount, tax_treatment, receipt_status, expense_date, notes, created_by, created_at, updated_at").order("created_at", { ascending: false }).limit(20000),
      supabase.from("profiles").select("id, email, full_name, role, is_active").limit(1000),
      coordinatorReadClient.from("coordinator_payroll").select("id, show_id, coordinator_user_id, paid, payment_status, payout_override, notes, scheduled_for").limit(10000),
      (admin ?? supabase).from("crew_tax_profiles").select("crew_id, tax_legal_name, business_name, federal_tax_classification, llc_tax_classification, other_classification, tax_address_line_1, tax_city_state_zip, tin_type, tin_last4, tin_encrypted, signer_name, certification_confirmed, signed_at, source, updated_at").limit(10000),
    ]);

    const subCallCoordinatorColumnMissing = Boolean(subCallsRes.error && subCallsRes.error.message.includes("assigned_coordinator_user_id"));
    const payrollSubCallsRes = subCallCoordinatorColumnMissing
      ? await supabase.from("sub_calls").select("id, labor_day_id, area, po_number, role_name, master_rate_id, start_time, end_time, crew_needed, notes, day_type, one_hour_walkaway").order("start_time", { ascending: true }).limit(20000)
      : subCallsRes;

    const assignmentsMissing = Boolean(assignmentsRes.error && assignmentsRes.error.message.includes('relation "assignments" does not exist'));
    const assignmentsCoordinationColumnsMissing = Boolean(assignmentsRes.error && (
      assignmentsRes.error.message.includes("coordination_owner") ||
      assignmentsRes.error.message.includes("coordination_fee_waived") ||
      assignmentsRes.error.message.includes("schema cache")
    ));
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
    let assignmentRows: PayrollAssignmentRow[] = (assignmentsRes.data ?? []) as PayrollAssignmentRow[];
    let assignmentsError = assignmentsRes.error;
    if (!assignmentsMissing && assignmentsCoordinationColumnsMissing) {
      const fallbackAssignmentsRes = await supabase
        .from("assignments")
        .select("id, sub_call_id, crew_id, status, sort_order, start_time, end_time, day_type")
        .order("sort_order", { ascending: true })
        .limit(20000);
      assignmentRows = (fallbackAssignmentsRes.data ?? []) as PayrollAssignmentRow[];
      assignmentsError = fallbackAssignmentsRes.error;
    }
    const payrollMissing = Boolean(payrollRes.error && payrollRes.error.message.includes('relation "show_payroll" does not exist'));
    const financialsMissing = Boolean(financialsRes.error && financialsRes.error.message.includes('relation "show_financials" does not exist'));
    const clientRatesMissing = Boolean(clientRatesRes.error && clientRatesRes.error.message.includes('relation "client_rates" does not exist'));
    const expenseItemsMissing = Boolean(expenseItemsRes.error && expenseItemsRes.error.message.includes('relation "show_expense_items" does not exist'));
    const taxProfilesMissing = Boolean(taxProfilesRes.error && (/crew_tax_profiles|schema cache|relation/i.test(taxProfilesRes.error.message || "")));
    let coordinatorPayrollRows: unknown[] = coordinatorPayrollRes.data ?? [];
    let coordinatorPayrollError = coordinatorPayrollRes.error;
    let coordinatorPayrollMissing = Boolean(coordinatorPayrollError && coordinatorPayrollError.message.includes('relation "coordinator_payroll" does not exist'));
    const coordinatorPayrollColumnsMissing = Boolean(coordinatorPayrollError && !coordinatorPayrollMissing && (
      coordinatorPayrollError.message.includes("payment_status") ||
      coordinatorPayrollError.message.includes("scheduled_for") ||
      coordinatorPayrollError.message.includes("schema cache")
    ));
    if (coordinatorPayrollColumnsMissing) {
      const fallbackCoordinatorPayrollRes = await coordinatorReadClient
        .from("coordinator_payroll")
        .select("id, show_id, coordinator_user_id, paid, payout_override, notes")
        .limit(10000);
      coordinatorPayrollRows = fallbackCoordinatorPayrollRes.data ?? [];
      coordinatorPayrollError = fallbackCoordinatorPayrollRes.error;
      coordinatorPayrollMissing = Boolean(coordinatorPayrollError && coordinatorPayrollError.message.includes('relation "coordinator_payroll" does not exist'));
    }
    const crewOnboardingColumnsMissing = Boolean(crewRes.error && (
      crewRes.error.message.includes("w9_status") ||
      crewRes.error.message.includes("tax_profile_status") ||
      crewRes.error.message.includes("w9_document_url") ||
      crewRes.error.message.includes("tax_profile_notes") ||
      crewRes.error.message.includes("schema cache")
    ));
    const payrollCrewRes = crewOnboardingColumnsMissing
      ? await supabase.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, address, lead_from, other_city, ob, onboarding_texted_called, onboarding_response, onboarding_paperwork_sent, onboarding_successfully_onboarded, onboarding_called_placed_tier, notes, conflict_companies").order("name", { ascending: true }).limit(10000)
      : crewRes;
    const error =
      showsRes.error ||
      laborDaysRes.error ||
      payrollSubCallsRes.error ||
      (assignmentsMissing ? null : assignmentsError) ||
      payrollCrewRes.error ||
      positionsRes.error ||
      cityPoolsRes.error ||
      ratesRes.error ||
      (clientRatesMissing ? null : clientRatesRes.error) ||
      (payrollMissing ? null : payrollRes.error) ||
      (financialsMissing ? null : financialsRes.error) ||
      (expenseItemsMissing ? null : expenseItemsRes.error) ||
      profilesRes.error ||
      (coordinatorPayrollMissing ? null : coordinatorPayrollError) ||
      (taxProfilesMissing ? null : taxProfilesRes.error);

    if (error) {
      return {
        eventSummaries: [],
        crewRows: [],
        availableYears: [new Date().getFullYear()],
        setupMissing: false,
        error: error.message,
      };
    }

    const shows = (showsRes.data ?? []).map((row) => {
      const typed = row as { id: string; name: string | null; client: string | null; venue: string | null; rate_city: string | null; show_start: string | null; show_end: string | null; notes: string | null; assigned_coordinator_user_id?: string | null };
      return {
        id: safeText(typed.id),
        name: safeText(typed.name, "Untitled show"),
        client: safeText(typed.client),
        business_client_id: null,
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

    const laborDays = (laborDaysRes.data ?? []).map((row) => {
      const typed = row as { id: string; show_id: string; labor_date: string | null; label: string | null; notes: string | null };
      return { id: safeText(typed.id), show_id: safeText(typed.show_id), labor_date: safeText(typed.labor_date), label: safeText(typed.label), notes: safeText(typed.notes) } satisfies LaborDayRecord;
    }).filter((day) => day.id && day.show_id);

    const subCalls = (payrollSubCallsRes.data ?? []).map((row) => {
      const typed = row as { id: string; labor_day_id: string; area: string | null; po_number?: string | null; assigned_coordinator_user_id?: string | null; role_name: string | null; master_rate_id?: string | null; start_time: string | null; end_time: string | null; crew_needed: number | null; notes: string | null; day_type?: string | null; one_hour_walkaway?: boolean | null };
      return { id: safeText(typed.id), labor_day_id: safeText(typed.labor_day_id), area: safeText(typed.area, "Imported Call"), po_number: safeText(typed.po_number) || null, assigned_coordinator_user_id: safeText(typed.assigned_coordinator_user_id) || null, role_name: safeText(typed.role_name, "General AV"), master_rate_id: safeText(typed.master_rate_id) || null, start_time: safeText(typed.start_time), end_time: safeText(typed.end_time), crew_needed: Number.isFinite(Number(typed.crew_needed)) ? Number(typed.crew_needed) : 1, notes: safeText(typed.notes), day_type: safeText(typed.day_type) || null, one_hour_walkaway: Boolean(typed.one_hour_walkaway) } satisfies SubCallRecord;
    }).filter((call) => call.id && call.labor_day_id);

    const assignments = assignmentsMissing ? [] : (assignmentRows ?? []).map((row, index) => {
      const typed = row as { id: string; sub_call_id: string; crew_id: string; status: string | null; sort_order?: number | null; start_time?: string | null; end_time?: string | null; day_type?: string | null; coordination_owner_user_id?: string | null; coordination_owner_name?: string | null; coordination_fee_waived?: boolean | null };
      return { id: safeText(typed.id), sub_call_id: safeText(typed.sub_call_id), crew_id: safeText(typed.crew_id), status: safeText(typed.status, "confirmed"), sort_order: typed.sort_order ?? index + 1, start_time: safeText(typed.start_time) || null, end_time: safeText(typed.end_time) || null, day_type: safeText(typed.day_type) || null, coordination_owner_user_id: safeText(typed.coordination_owner_user_id) || null, coordination_owner_name: safeText(typed.coordination_owner_name) || null, coordination_fee_waived: Boolean(typed.coordination_fee_waived) } satisfies AssignmentRecord;
    }).filter((assignment) => assignment.sub_call_id && assignment.crew_id);

    const cityMapEntries: Array<[string, string]> = (cityPoolsRes.data ?? [])
      .map((pool): [string, string] => [
        safeText((pool as { id: string }).id),
        safeText((pool as { name: string }).name),
      ])
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

    const crewRecords = (payrollCrewRes.data ?? []).map((row) => {
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
    }).filter((crew) => crew.id);

    const coordinatorNameById = new Map<string, string>((profilesRes.data ?? []).map((profile) => {
      const typed = profile as { id: string; email?: string | null; full_name?: string | null };
      return [safeText(typed.id), safeText(typed.full_name, safeText(typed.email, "Assigned coordinator"))] as const;
    }).filter(([id]) => Boolean(id)));
    const allPayrollStatuses = payrollMissing ? [] : normalizePayrollStatusRows(payrollRes.data ?? []);
    const payrollStatuses = allPayrollStatuses.filter((row) => safeText(row.role_name) !== COORDINATOR_PAYROLL_FALLBACK_ROLE);
    const coordinatorPayrollFallbackStatuses = normalizeCoordinatorPayrollFallbackRows(allPayrollStatuses);
    const taxProfilesByCrewId = taxProfilesMissing ? new Map<string, PayrollTaxProfileSummary>() : normalizeTaxProfileRows(taxProfilesRes.data ?? []);
    const coordinatorPayrollStatuses = [
      // Load fallback rows first and dedicated coordinator_payroll rows second.
      // buildPayrollRows stores these in a Map by show/coordinator; later entries win.
      // This keeps stale fallback rows from overriding the real coordinator_payroll save after refresh.
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
      payrollStatuses,
      financials: financialsMissing ? [] : ((financialsRes.data ?? []) as ShowFinancialRecord[]),
      expenseItems: expenseItemsMissing ? [] : ((expenseItemsRes.data ?? []) as ShowExpenseItemRecord[]),
      coordinatorNameById,
      coordinatorPayrollStatuses,
      taxProfilesByCrewId,
    });

    const years = [...new Set([...shows.map((show) => showYear(show.show_start)), new Date().getFullYear()])]
      .filter((year) => Number.isFinite(year) && year > 1900)
      .sort((a, b) => b - a);

    return {
      eventSummaries: buildEventSummaries(crewRows),
      crewRows,
      availableYears: years.length ? years : [new Date().getFullYear()],
      setupMissing: false,
      error: payrollMissing ? "Run the show_payroll migration once to enable paid/unpaid tracking." : null,
    };
  } catch (error) {
    return {
      eventSummaries: [],
      crewRows: [],
      availableYears: [new Date().getFullYear()],
      setupMissing: false,
      error: error instanceof Error ? `Payroll safe mode: ${error.message}` : "Payroll safe mode: Could not load payroll data.",
    };
  }
}
