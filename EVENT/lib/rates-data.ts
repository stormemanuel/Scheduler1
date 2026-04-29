import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { CityPoolRecord } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";

export async function getRatesPageData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      cityPools: [] as CityPoolRecord[],
      masterRates: [] as MasterRateRecord[],
      setupMissing: true,
      error: null as string | null,
    };
  }

  const [cityPoolsRes, ratesRes] = await Promise.all([
    supabase.from("city_pools").select("id, name").order("name", { ascending: true }),
    supabase
      .from("master_rates")
      .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
      .order("city_name", { ascending: true })
      .order("role_name", { ascending: true }),
  ]);

  const error = cityPoolsRes.error || ratesRes.error;
  if (error) {
    return {
      cityPools: [] as CityPoolRecord[],
      masterRates: [] as MasterRateRecord[],
      setupMissing: false,
      error: error.message,
    };
  }

  return {
    cityPools: (cityPoolsRes.data ?? []) as CityPoolRecord[],
    masterRates: (ratesRes.data ?? []) as MasterRateRecord[],
    setupMissing: false,
    error: null as string | null,
  };
}
