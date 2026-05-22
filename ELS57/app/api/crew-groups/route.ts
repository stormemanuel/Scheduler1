import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function crewGroupsMissingMessage(errorMessage: string) {
  return errorMessage.includes('relation "crew_groups" does not exist')
    ? "Run the crew groups migration once to enable saved subgroups."
    : errorMessage;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

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
      return NextResponse.json({ message: crewGroupsMissingMessage(error.message) }, { status: 400 });
    }
    return NextResponse.json({ message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, group: data });
}

export async function PATCH(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const body = await request.json();
  const cityPoolId = String(body.city_pool_id || "").trim();
  const oldName = String(body.old_name || "").trim() || "Ungrouped";
  const nextName = String(body.name || "").trim() || "Ungrouped";

  if (!cityPoolId) return NextResponse.json({ message: "City pool is required." }, { status: 400 });
  if (!oldName) return NextResponse.json({ message: "Current group name is required." }, { status: 400 });
  if (!nextName) return NextResponse.json({ message: "New group name is required." }, { status: 400 });

  if (oldName === nextName) {
    return NextResponse.json({ ok: true, group: { id: "same-name", city_pool_id: cityPoolId, name: nextName }, moved: 0 });
  }

  const { data: targetGroup, error: upsertError } = await admin
    .from("crew_groups")
    .upsert({ city_pool_id: cityPoolId, name: nextName }, { onConflict: "city_pool_id,name" })
    .select("id, city_pool_id, name")
    .single();

  if (upsertError) {
    return NextResponse.json({ message: crewGroupsMissingMessage(upsertError.message) }, { status: 400 });
  }

  const { error: crewError } = await admin
    .from("crew")
    .update({ group_name: nextName, updated_at: new Date().toISOString() })
    .eq("city_pool_id", cityPoolId)
    .eq("group_name", oldName);

  if (crewError) return NextResponse.json({ message: crewError.message }, { status: 400 });

  const { error: deleteError } = await admin
    .from("crew_groups")
    .delete()
    .eq("city_pool_id", cityPoolId)
    .eq("name", oldName);

  if (deleteError) return NextResponse.json({ message: deleteError.message }, { status: 400 });

  return NextResponse.json({ ok: true, group: targetGroup });
}
