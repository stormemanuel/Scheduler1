import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: "Supabase is not configured." }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json();
  const cityPoolId = String(body.city_pool_id || "").trim();
  const name = String(body.name || "").trim() || "Ungrouped";

  if (!cityPoolId) return NextResponse.json({ message: "City pool is required." }, { status: 400 });

  const { data, error } = await admin
    .from("crew_groups")
    .upsert({ city_pool_id: cityPoolId, name }, { onConflict: "city_pool_id,name" })
    .select("id, city_pool_id, name")
    .single();

  if (error) {
    if (error.message.includes("relation \"crew_groups\" does not exist")) {
      return NextResponse.json({ message: "Run supabase/crew_groups_migration.sql once to enable saved empty subgroups." }, { status: 400 });
    }
    return NextResponse.json({ message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, group: data });
}
