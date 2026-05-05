import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { ShowRecord, LaborDayRecord, SubCallRecord, AssignmentRecord } from "@/lib/events-types";

export async function getEventsPageData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      shows: [] as ShowRecord[],
      laborDays: [] as LaborDayRecord[],
      subCalls: [] as SubCallRecord[],
      assignments: [] as AssignmentRecord[],
      masterRates: [] as MasterRateRecord[],
      setupMissing: true,
      error: null as string | null,
    };
  }

  const [showsRes, laborDaysRes, subCallsRes, assignmentsRes, ratesRes] = await Promise.all([
    supabase.from("shows").select("id, name, client, venue, rate_city, show_start, show_end, notes").order("show_start", { ascending: true }),
    supabase.from("labor_days").select("id, show_id, labor_date, label, notes").order("labor_date", { ascending: true }),
    supabase.from("sub_calls").select("id, labor_day_id, area, role_name, start_time, end_time, crew_needed, notes").order("start_time", { ascending: true }),
    supabase.from("assignments").select("id, sub_call_id, crew_id, status"),
    supabase.from("master_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").order("city_name", { ascending: true }).order("role_name", { ascending: true }),
  ]);

  const assignmentsMissing = Boolean(assignmentsRes.error && assignmentsRes.error.message.includes('relation "assignments" does not exist'));
  const error = showsRes.error || laborDaysRes.error || subCallsRes.error || (assignmentsMissing ? null : assignmentsRes.error) || ratesRes.error;
  if (error) {
    return {
      shows: [] as ShowRecord[],
      laborDays: [] as LaborDayRecord[],
      subCalls: [] as SubCallRecord[],
      assignments: [] as AssignmentRecord[],
      masterRates: [] as MasterRateRecord[],
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
    } as ShowRecord;
  });

  const laborDays = (laborDaysRes.data ?? []).map((row) => {
    const typed = row as { id: string; show_id: string; labor_date: string; label: string | null; notes: string | null };
    return { id: typed.id, show_id: typed.show_id, labor_date: typed.labor_date, label: typed.label ?? "", notes: typed.notes ?? "" } as LaborDayRecord;
  });

  const subCalls = (subCallsRes.data ?? []).map((row) => {
    const typed = row as { id: string; labor_day_id: string; area: string | null; role_name: string | null; start_time: string; end_time: string | null; crew_needed: number | null; notes: string | null };
    return { id: typed.id, labor_day_id: typed.labor_day_id, area: typed.area ?? "", role_name: typed.role_name ?? "", start_time: typed.start_time, end_time: typed.end_time ?? "", crew_needed: typed.crew_needed ?? 1, notes: typed.notes ?? "" } as SubCallRecord;
  });

  const assignments = assignmentsMissing ? [] : ((assignmentsRes.data ?? []).map((row) => {
    const typed = row as { id: string; sub_call_id: string; crew_id: string; status: string | null };
    return { id: typed.id, sub_call_id: typed.sub_call_id, crew_id: typed.crew_id, status: typed.status ?? 'confirmed' } as AssignmentRecord;
  }));

  return {
    shows,
    laborDays,
    subCalls,
    assignments,
    masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
    setupMissing: false,
    error: null as string | null,
  };
}
