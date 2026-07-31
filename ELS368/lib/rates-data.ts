import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CityPoolRecord } from "@/lib/crew-types";
import type { ClientRateRecord, MasterRateRecord } from "@/lib/rates-types";

function missingRelation(error: { message?: string } | null | undefined, table: string) {
  return Boolean(error?.message?.includes(`relation "${table}" does not exist`));
}

export async function getRatesPageData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      cityPools: [] as CityPoolRecord[],
      masterRates: [] as MasterRateRecord[],
      clientRates: [] as ClientRateRecord[],
      clientRatesMissing: false,
      setupMissing: true,
      error: null as string | null,
    };
  }

  const [cityPoolsRes, ratesRes, clientRatesRes] = await Promise.all([
    supabase.from("city_pools").select("id, name").order("name", { ascending: true }),
    supabase
      .from("master_rates")
      .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
      .order("city_name", { ascending: true })
      .order("role_name", { ascending: true }),
    supabase
      .from("client_rates")
      .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
      .order("city_name", { ascending: true })
      .order("role_name", { ascending: true }),
  ]);

  const clientRatesMissing = missingRelation(clientRatesRes.error, "client_rates");
  const error = cityPoolsRes.error || ratesRes.error || (clientRatesMissing ? null : clientRatesRes.error);
  if (error) {
    return {
      cityPools: [] as CityPoolRecord[],
      masterRates: [] as MasterRateRecord[],
      clientRates: [] as ClientRateRecord[],
      clientRatesMissing,
      setupMissing: false,
      error: error.message,
    };
  }

  return {
    cityPools: (cityPoolsRes.data ?? []) as CityPoolRecord[],
    masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
    clientRates: clientRatesMissing ? [] : ((clientRatesRes.data ?? []) as ClientRateRecord[]),
    clientRatesMissing,
    setupMissing: false,
    error: null as string | null,
  };
}
