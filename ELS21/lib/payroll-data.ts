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

function safeText(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim() || fallback;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => safeText(value)).filter(Boolean))];
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
        payout_override: number | string | null;
        notes: string | null;
      };
      return {
        id: safeText(typed.id),
        show_id: safeText(typed.show_id),
        crew_id: safeText(typed.crew_id),
        role_name: safeText(typed.role_name, PAYROLL_STATUS_ROLE),
        paid: Boolean(typed.paid),
        payout_override: typed.payout_override === null || typed.payout_override === undefined ? null : toNumber(typed.payout_override),
        notes: safeText(typed.notes),
      } satisfies PayrollStatusRecord;
    })
    .filter((row) => row.show_id && row.crew_id);
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
}) {
  const { shows, laborDays, subCalls, assignments, crewRecords, masterRates, payrollStatuses } = options;
  const clientRates = options.clientRates ?? [];
  const financialByShow = new Map((options.financials ?? []).filter((row) => row?.show_id).map((row) => [row.show_id, row]));
  const showById = new Map(shows.filter((show) => show?.id).map((show) => [show.id, show]));
  const dayById = new Map(laborDays.filter((day) => day?.id).map((day) => [day.id, day]));
  const callById = new Map(subCalls.filter((call) => call?.id).map((call) => [call.id, call]));
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
      const cleanCall: SubCallRecord = {
        id: safeText(call.id, subCallId),
        labor_day_id: laborDayId,
        area: safeText(call.area, "Imported Call"),
        role_name: safeText(call.role_name, "General AV"),
        start_time: safeText(call.start_time),
        end_time: safeText(call.end_time),
        crew_needed: Number.isFinite(Number(call.crew_needed)) ? Number(call.crew_needed) : 1,
        notes: safeText(call.notes),
      };
      const estimate = estimateAssignmentPay({ call: cleanCall, crew, masterRates, rateCity: safeText(show.rate_city, "Default") });
      const revenueEstimate = estimateAssignmentRevenue({ call: cleanCall, clientRates, rateCity: safeText(show.rate_city, "Default") });
      const key = `${show.id}:${crewId}`;

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
          crewId,
          crewName: safeText(crew?.name, "Unknown crew"),
          crewEmail: safeText(crew?.email),
          crewPhone: safeText(crew?.phone),
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
    if (row.paid) event.paidTotal += payable;
    else event.unpaidTotal += payable;
  }

  return [...events.values()]
    .map((event) => {
      const revenue = Math.round(((event.revenueOverride ?? event.estimatedRevenue) || 0) * 100) / 100;
      const profit = Math.round((revenue - event.payableTotal - event.expenses) * 100) / 100;
      const positiveProfit = Math.max(0, profit);
      return {
        ...event,
        rows: event.rows.sort((a, b) => safeText(a.crewName).localeCompare(safeText(b.crewName))),
        estimatedRevenue: revenue,
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

    const [showsRes, laborDaysRes, subCallsRes, assignmentsRes, crewRes, positionsRes, cityPoolsRes, ratesRes, clientRatesRes, payrollRes, financialsRes] = await Promise.all([
      supabase.from("shows").select("id, name, client, venue, rate_city, show_start, show_end, notes").order("show_start", { ascending: false }).limit(5000),
      supabase.from("labor_days").select("id, show_id, labor_date, label, notes").order("labor_date", { ascending: true }).limit(10000),
      supabase.from("sub_calls").select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes").order("start_time", { ascending: true }).limit(20000),
      supabase.from("assignments").select("id, sub_call_id, crew_id, status").limit(20000),
      supabase.from("crew").select("id, name, description, city_pool_id, group_name, tier, email, phone, other_city, ob, notes, conflict_companies").order("name", { ascending: true }).limit(10000),
      supabase.from("crew_positions").select("id, crew_id, role_name, rate").order("role_name", { ascending: true }).limit(20000),
      supabase.from("city_pools").select("id, name").limit(1000),
      supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      supabase.from("client_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").limit(5000),
      supabase.from("show_payroll").select("id, show_id, crew_id, role_name, paid, payout_override, notes").limit(20000),
      supabase.from("show_financials").select("show_id, estimated_revenue_override, expenses, notes").limit(10000),
    ]);

    const assignmentsMissing = Boolean(assignmentsRes.error && assignmentsRes.error.message.includes('relation "assignments" does not exist'));
    const payrollMissing = Boolean(payrollRes.error && payrollRes.error.message.includes('relation "show_payroll" does not exist'));
    const financialsMissing = Boolean(financialsRes.error && financialsRes.error.message.includes('relation "show_financials" does not exist'));
    const clientRatesMissing = Boolean(clientRatesRes.error && clientRatesRes.error.message.includes('relation "client_rates" does not exist'));
    const error =
      showsRes.error ||
      laborDaysRes.error ||
      subCallsRes.error ||
      (assignmentsMissing ? null : assignmentsRes.error) ||
      crewRes.error ||
      positionsRes.error ||
      cityPoolsRes.error ||
      ratesRes.error ||
      (clientRatesMissing ? null : clientRatesRes.error) ||
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
      const typed = row as { id: string; name: string | null; client: string | null; venue: string | null; rate_city: string | null; show_start: string | null; show_end: string | null; notes: string | null };
      return {
        id: safeText(typed.id),
        name: safeText(typed.name, "Untitled show"),
        client: safeText(typed.client),
        venue: safeText(typed.venue),
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

    const subCalls = (subCallsRes.data ?? []).map((row) => {
      const typed = row as { id: string; labor_day_id: string; area: string | null; role_name: string | null; start_time: string | null; end_time: string | null; crew_needed: number | null; notes: string | null };
      return { id: safeText(typed.id), labor_day_id: safeText(typed.labor_day_id), area: safeText(typed.area, "Imported Call"), role_name: safeText(typed.role_name, "General AV"), start_time: safeText(typed.start_time), end_time: safeText(typed.end_time), crew_needed: Number.isFinite(Number(typed.crew_needed)) ? Number(typed.crew_needed) : 1, notes: safeText(typed.notes) } satisfies SubCallRecord;
    }).filter((call) => call.id && call.labor_day_id);

    const assignments = assignmentsMissing ? [] : (assignmentsRes.data ?? []).map((row) => {
      const typed = row as { id: string; sub_call_id: string; crew_id: string; status: string | null };
      return { id: safeText(typed.id), sub_call_id: safeText(typed.sub_call_id), crew_id: safeText(typed.crew_id), status: safeText(typed.status, "confirmed") } satisfies AssignmentRecord;
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

    const crewRecords = (crewRes.data ?? []).map((row) => {
      const typed = row as { id: string; name: string | null; description: string | null; city_pool_id: string | null; group_name: string | null; tier: string | null; email: string | null; phone: string | null; other_city: string | null; ob: boolean | null; notes: string | null; conflict_companies: string[] | null };
      const id = safeText(typed.id);
      return {
        id,
        name: safeText(typed.name, "Unknown crew"),
        description: safeText(typed.description),
        city_pool_id: safeText(typed.city_pool_id) || null,
        city_name: typed.city_pool_id ? cityMap.get(safeText(typed.city_pool_id)) ?? "Unassigned" : "Unassigned",
        group_name: safeText(typed.group_name, "Ungrouped"),
        tier: safeText(typed.tier),
        email: safeText(typed.email),
        phone: safeText(typed.phone),
        other_city: safeText(typed.other_city),
        ob: Boolean(typed.ob),
        notes: safeText(typed.notes),
        conflict_companies: Array.isArray(typed.conflict_companies) ? typed.conflict_companies : [],
        positions: positionsByCrew.get(id) ?? [],
        unavailable_dates: [],
      } satisfies CrewRecord;
    }).filter((crew) => crew.id);

    const payrollStatuses = payrollMissing ? [] : normalizePayrollStatusRows(payrollRes.data ?? []);
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
