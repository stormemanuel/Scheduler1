import type { ShowFinancialRecord } from "@/lib/financial-types";
type DataClient = NonNullable<ReturnType<typeof import("@/lib/supabase-server").createSupabaseAdminClient>>;
const required = ["show_id", "estimated_revenue_override", "expenses", "notes"];
const optional = ["tax_reserve_done", "tax_reserve_done_at", "consecrated_hands_done", "consecrated_hands_done_at", "created_at", "updated_at"];

export async function readPayrollFinancials(client: DataClient, showIds: string[]) {
  const ids = [...new Set(showIds.filter(Boolean))];
  let columns = [...required, ...optional];
  const rows: ShowFinancialRecord[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    while (true) {
      // show_id identifies these records. Older installations have no id column.
      const result = await client.from("show_financials").select(columns.join(", ")).in("show_id", batch).limit(5000);
      if (!result.error) { rows.push(...(result.data || []) as unknown as ShowFinancialRecord[]); break; }
      const message = result.error.message || "";
      const missing = optional.find((column) => columns.includes(column) && new RegExp(`(^|[^A-Za-z0-9_])${column}([^A-Za-z0-9_]|$)`).test(message));
      if (!missing || !(result.error.code === "42703" || result.error.code === "PGRST204" || /does not exist|schema cache/i.test(message))) return { data: [] as ShowFinancialRecord[], error: result.error };
      // Retain all supported reserve flags and timestamps rather than dropping
      // every optional column when just one is unavailable.
      columns = columns.filter((column) => column !== missing);
    }
  }
  return { data: rows, error: null };
}
