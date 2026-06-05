import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });

  const { data, error } = await supabase
    .from("master_rates")
    .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
    .order("city_name", { ascending: true })
    .order("role_name", { ascending: true });

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, masterRates: data ?? [] }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
