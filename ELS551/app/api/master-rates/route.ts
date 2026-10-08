import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const [masterRatesResult, crewPositionsResult] = await Promise.all([
    admin
      .from("master_rates")
      .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
      .order("city_name", { ascending: true })
      .order("role_name", { ascending: true }),
    admin.from("crew_positions").select("role_name").order("role_name", { ascending: true }).limit(10000),
  ]);

  if (masterRatesResult.error) return NextResponse.json({ message: masterRatesResult.error.message }, { status: 400 });

  const normalizeRole = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  const canonicalLedRole = (value: unknown) => {
    const original = String(value || "").replace(/\s+/g, " ").trim();
    const normalized = normalizeRole(original);
    if (/\bled\b/.test(normalized) && !/engineer/.test(normalized)) return "LED Stagehand";
    if (/^(?:lighting assist|lighting assistant|lighting stagehand)$/.test(normalized)) return "Lighting Stagehand";
    return original;
  };
  const canonicalRatesByCityRole = new Map<string, Record<string, unknown>>();
  for (const rawRow of masterRatesResult.data ?? []) {
    const row = rawRow as Record<string, unknown>;
    const rawRoleName = String(row.role_name || "").trim();
    const roleName = canonicalLedRole(rawRoleName);
    const legacyLed = roleName === "LED Stagehand" && normalizeRole(rawRoleName) !== "led stagehand";
    const canonicalRow = { ...row, role_name: roleName, ...(["LED Stagehand", "Lighting Stagehand"].includes(roleName) ? { full_day: 350, half_day: 175 } : {}) };
    const key = `${normalizeRole(row.city_name || "Default")}:${normalizeRole(roleName)}`;
    const existing = canonicalRatesByCityRole.get(key);
    if (!existing || !legacyLed) canonicalRatesByCityRole.set(key, canonicalRow);
  }
  const canonicalRates = [...canonicalRatesByCityRole.values()];
  const positionRoleMap = new Map<string, string>();
  for (const row of canonicalRates) {
    const roleName = String((row as { role_name?: string | null }).role_name || "").trim();
    if (roleName) positionRoleMap.set(normalizeRole(roleName), roleName);
  }
  // A role added on an individual crew profile is still a valid operational
  // position. Expose its name to Events without fabricating a master pay rate.
  if (!crewPositionsResult.error) {
    for (const row of crewPositionsResult.data ?? []) {
      const roleName = canonicalLedRole((row as { role_name?: string | null }).role_name);
      const key = normalizeRole(roleName);
      if (key && !positionRoleMap.has(key)) positionRoleMap.set(key, roleName);
    }
  }

  return NextResponse.json({ ok: true, masterRates: canonicalRates, positionRoles: Array.from(positionRoleMap.values()).sort((a, b) => a.localeCompare(b)) }, {
    headers: {
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}
