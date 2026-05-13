import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CrewRecord } from "@/lib/crew-types";
import type { LaborDayRecord, ShowRecord, SubCallRecord, AssignmentRecord } from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { PayrollEventSummary, PayrollPageData, PayrollStatusRecord, PayrollCrewShowRow } from "@/lib/payroll-types";
import type { ShowFinancialRecord } from "@/lib/financial-types";
import { estimateAssignmentPay, estimateAssignmentRevenue, PAYROLL_STATUS_ROLE, showYear } from "@/lib/payroll-calculations";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePayrollStatusRows(rows: unknown[]): PayrollStatusRecord[] {
  return rows.map((row) => {
    const typed = row as {
      id: string;
      show_id: string;
      crew_id: string;
      role_name: string | null;
      paid: boolean | null;
      payout_override: number | string | null;
      notes: string | null;
    };
    return {
      id: typed.id,
      show_id: typed.show_id,
      crew_id: typed.crew_id,
      role_name: typed.role_name ?? PAYROLL_STATUS_ROLE,
      paid: Boolean(typed.paid),
      payout_override: typed.payout_override === null || typed.payout_override === undefined ? null : toNumber(typed.payout_override),
      notes: typed.notes ?? "",
    };
  });
}

export function buildPayrollRows(options: {
  shows: ShowRecord[];
  laborDays: LaborDayRecord[];
  subCalls: SubCallRecord[];
  assignments: AssignmentRecord[];
  crewRecords: CrewRecord[];
  masterRates: MasterRateRecord[];
  payrollStatuses: PayrollStatusRecord[];
  financials?: ShowFinancialRecord[];
}) {
  const { shows, laborDays, subCalls, assignments, crewRecords, masterRates, payrollStatuses } = options;
  const financialByShow = new Map((options.financials ?? []).map((row) => [row.show_id, row]));
  const showById = new Map(shows.map((show) => [show.id, show]));
  const dayById = new Map(laborDays.map((day) => [day.id, day]));
  const callById = new Map(subCalls.map((call) => [call.id, call]));
  const crewById = new Map(crewRecords.map((crew) => [crew.id, crew]));
  const statusByShowCrew = new Map(
    payrollStatuses
      .filter((status) => status.role_name === PAYROLL_STATUS_ROLE)
      .map((status) => [`${status.show_id}:${status.crew_id}`, status]),
  );

  const grouped = new Map<string, PayrollCrewShowRow>();

  for (const assignment of assignments) {
    const call = callById.get(assignment.sub_call_id);
    if (!call) continue;
    const day = dayById.get(call.labor_day_id);
    if (!day) continue;
    const show = showById.get(day.show_id);
    if (!show) continue;
    const crew = crewById.get(assignment.crew_id);
    const status = statusByShowCrew.get(`${show.id}:${assignment.crew_id}`) ?? null;
    const estimate = estimateAssignmentPay({ call, crew, masterRates, rateCity: show.rate_city || "Default" });
    const revenueEstimate = estimateAssignmentRevenue(call);
    const key = `${show.id}:${assignment.crew_id}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        showId: show.id,
        showName: show.name,
        showClient: show.client,
        showVenue: show.venue,
        showStart: show.show_start,
        showEnd: show.show_end,
        showYear: showYear(show.show_start),
        crewId: assignment.crew_id,
        crewName: crew?.name || "Unknown crew",
        crewEmail: crew?.email || "",
        crewPhone: crew?.phone || "",
        roles: [],
        calls: [],
        estimatedTotal: 0,
        overrideAmount: status?.payout_override ?? null,
        paid: Boolean(status?.paid),
        notes: status?.notes ?? "",
        statusId: status?.id ?? null,
        showRevenueOverride: financialByShow.get(show.id)?.estimated_revenue_override ?? null,
        showExpenses: financialByShow.get(show.id)?.expenses ?? 0,
        showFinancialNotes: financialByShow.get(show.id)?.notes ?? "",
      });
    }

    const row = grouped.get(key)!;
    row.calls.push({
      assignmentId: assignment.id,
      subCallId: call.id,
      laborDayId: day.id,
      laborDate: day.labor_date,
      area: call.area,
      roleName: call.role_name,
      startTime: call.start_time,
      endTime: call.end_time,
      status: assignment.status,
      amount: estimate.amount,
      durationHours: estimate.durationHours,
      payLabel: estimate.payLabel,
      rateSource: estimate.rateSource,
      clientRevenueAmount: revenueEstimate.amount,
      clientRateSource: revenueEstimate.rateSource,
    });
    row.estimatedTotal = Math.round((row.estimatedTotal + estimate.amount) * 100) / 100;
    row.roles = uniqueStrings([...row.roles, call.role_name]);
  }

  return [...grouped.values()].map((row) => ({
    ...row,
    calls: row.calls.sort((a, b) => `${a.laborDate} ${a.startTime}`.localeCompare(`${b.laborDate} ${b.startTime}`)),
    estimatedTotal: Math.round(row.estimatedTotal * 100) / 100,
  })).sort((a, b) => `${a.showStart} ${a.showName} ${a.crewName}`.localeCompare(`${b.showStart} ${b.showName} ${b.crewName}`));
}

export function buildEventSummaries(rows: PayrollCrewShowRow[]): PayrollEventSummary[] {
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
        estimatedRevenue: 0,
        estimatedProfit: 0,
        consecratedHandsDonation: 0,
        taxReserve: 0,
        combinedReserve: 0,
        pureProfit: 0,
        expenses: row.showExpenses ?? 0,
        revenueOverride: row.showRevenueOverride ?? null,
        financialNotes: row.showFinancialNotes ?? "",
        estimatedTotal: 0,
        payableTotal: 0,
        paidTotal: 0,
        unpaidTotal: 0,
      });
    }

    const event = events.get(row.showId)!;
    const payable = row.overrideAmount ?? row.estimatedTotal;
    event.rows.push(row);
    event.estimatedTotal += row.estimatedTotal;
    event.estimatedRevenue += row.calls.reduce((sum, call) => sum + (call.clientRevenueAmount ?? 0), 0);
    event.payableTotal += payable;
    if (row.paid) event.paidTotal += payable;
    else event.unpaidTotal += payable;
  }

  return [...events.values()]
    .map((event) => ({
      ...event,
      rows: event.rows.sort((a, b) => a.crewName.localeCompare(b.crewName)),
      estimatedRevenue: Math.round(((event.revenueOverride ?? event.estimatedRevenue) || 0) * 100) / 100,
      estimatedProfit: Math.round((((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses) * 100) / 100,
      consecratedHandsDonation: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.10 * 100) / 100,
      taxReserve: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.25 * 100) / 100,
      combinedReserve: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.35 * 100) / 100,
      pureProfit: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.65 * 100) / 100,
      estimatedTotal: Math.round(event.estimatedTotal * 100) / 100,
      payableTotal: Math.round(event.payableTotal * 100) / 100,
      paidTotal: Math.round(event.paidTotal * 100) / 100,
      unpaidTotal: Math.round(event.unpaidTotal * 100) / 100,
    }))
    .sort((a, b) => `${b.showStart} ${a.showName}`.localeCompare(`${a.showStart} ${b.showName}`));
}

export async function getPayrollPageData(): Promise<PayrollPageData> {
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

  const [showsRes, laborDaysRes, subCallsRes, assignmentsRes, crewRes, positionsRes, cityPoolsRes, ratesRes, payrollRes, financialsRes] = await Promise.all([
    supabase.from("shows").select("id, name, client, venue, rate_city, show_start, show_end, notes").order("show_start", { ascending: false }),
    supabase.from("labor_days").select("id, show_id, labor_date, label, notes").order("labor_date", { ascending: true }),
    supabase.from("sub_calls").select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes").order("start_time", { ascending: true }),
    supabase.from("assignments").select("id, sub_call_id, crew_id, status"),
    supabase.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, other_city, ob, notes, conflict_companies").order("name", { ascending: true }),
    supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }),
    supabase.from("city_pools").select("id, name"),
    supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier"),
    supabase.from("show_payroll").select("id, show_id, crew_id, role_name, paid, payout_override, notes"),
    supabase.from("show_financials").select("show_id, estimated_revenue_override, expenses, notes"),
  ]);

  const assignmentsMissing = Boolean(assignmentsRes.error && assignmentsRes.error.message.includes('relation "assignments" does not exist'));
  const payrollMissing = Boolean(payrollRes.error && payrollRes.error.message.includes('relation "show_payroll" does not exist'));
  const financialsMissing = Boolean(financialsRes.error && financialsRes.error.message.includes('relation "show_financials" does not exist'));
  const error =
    showsRes.error ||
    laborDaysRes.error ||
    subCallsRes.error ||
    (assignmentsMissing ? null : assignmentsRes.error) ||
    crewRes.error ||
    positionsRes.error ||
    cityPoolsRes.error ||
    ratesRes.error ||
    (payrollMissing ? null : payrollRes.error) ||
    (financialsMissing ? null : financialsRes.error);

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
    const typed = row as { id: string; name: string | null; client: string | null; venue: string | null; rate_city: string | null; show_start: string; show_end: string; notes: string | null };
    return {
      id: typed.id,
      name: typed.name ?? "",
      client: typed.client ?? "",
      venue: typed.venue ?? "",
      rate_city: typed.rate_city ?? "Default",
      show_start: typed.show_start,
      show_end: typed.show_end,
      notes: typed.notes ?? "",
    } satisfies ShowRecord;
  });

  const laborDays = (laborDaysRes.data ?? []).map((row) => {
    const typed = row as { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null };
    return { id: typed.id, show_id: typed.show_id, labor_date: typed.labor_date, label: typed.label ?? "", notes: typed.notes ?? "" } satisfies LaborDayRecord;
  });

  const subCalls = (subCallsRes.data ?? []).map((row) => {
    const typed = row as { id: string; labor_day_id: string; area: string | null; role_name: string | null; start_time: string; end_time: string | null; crew_needed: number | null; notes: string | null };
    return { id: typed.id, labor_day_id: typed.labor_day_id, area: typed.area ?? "", role_name: typed.role_name ?? "", start_time: typed.start_time, end_time: typed.end_time ?? "", crew_needed: typed.crew_needed ?? 1, notes: typed.notes ?? "" } satisfies SubCallRecord;
  });

  const assignments = assignmentsMissing ? [] : (assignmentsRes.data ?? []).map((row) => {
    const typed = row as { id: string; sub_call_id: string; crew_id: string; status: string | null };
    return { id: typed.id, sub_call_id: typed.sub_call_id, crew_id: typed.crew_id, status: typed.status ?? "confirmed" } satisfies AssignmentRecord;
  });

  const cityMap = new Map<string, string>((cityPoolsRes.data ?? []).map((pool) => [String((pool as { id: string }).id), String((pool as { name: string }).name)]));
  const positionsByCrew = new Map<string, CrewRecord["positions"]>();
  for (const row of positionsRes.data ?? []) {
    const typed = row as { id: string; crew_id: string; role_name: string | null; rate: number | string | null };
    const list = positionsByCrew.get(typed.crew_id) ?? [];
    list.push({ id: typed.id, role_name: typed.role_name ?? "", rate: toNumber(typed.rate) });
    positionsByCrew.set(typed.crew_id, list);
  }

  const crewRecords = (crewRes.data ?? []).map((row) => {
    const typed = row as { id: string; name: string | null; description: string | null; city_pool_id: string | null; group_name: string | null; tier: string | null; email: string | null; phone: string | null; other_city: string | null; ob: boolean | null; notes: string | null; conflict_companies: string[] | null };
    return {
      id: typed.id,
      name: typed.name ?? "",
      description: typed.description ?? "",
      city_pool_id: typed.city_pool_id,
      city_name: typed.city_pool_id ? cityMap.get(typed.city_pool_id) ?? "Unassigned" : "Unassigned",
      group_name: typed.group_name ?? "Ungrouped",
      tier: typed.tier ?? "",
      email: typed.email ?? "",
      phone: typed.phone ?? "",
      other_city: typed.other_city ?? "",
      ob: Boolean(typed.ob),
      notes: typed.notes ?? "",
      conflict_companies: typed.conflict_companies ?? [],
      positions: positionsByCrew.get(typed.id) ?? [],
      unavailable_dates: [],
    } satisfies CrewRecord;
  });

  const payrollStatuses = payrollMissing ? [] : normalizePayrollStatusRows(payrollRes.data ?? []);
  const crewRows = buildPayrollRows({
    shows,
    laborDays,
    subCalls,
    assignments,
    crewRecords,
    masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
    payrollStatuses,
  });
  const eventSummaries = buildEventSummaries(crewRows);
  const availableYears = [...new Set([...shows.map((show) => showYear(show.show_start)), new Date().getFullYear()])].sort((a, b) => b - a);

  return {
    eventSummaries,
    crewRows,
    availableYears,
    setupMissing: false,
    error: payrollMissing ? "Run supabase/payroll_status_migration.sql once to enable paid/unpaid tracking." : null,
  };
}
