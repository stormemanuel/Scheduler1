import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  const role = String((profile as { role?: string | null } | null)?.role || "viewer").toLowerCase();
  if (profileError || !["owner", "admin"].includes(role)) {
    return NextResponse.json({ message: "Only owner/admin users can assign app users to events." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const showId = String(body.show_id || "").trim();
  const userIds = Array.isArray(body.user_ids) ? Array.from(new Set(body.user_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean))) : [];
  if (!showId) return NextResponse.json({ message: "Show is required." }, { status: 400 });

  const { error: deleteError } = await admin.from("event_user_access").delete().eq("show_id", showId);
  if (deleteError) return NextResponse.json({ message: deleteError.message }, { status: 400 });

  if (userIds.length) {
    const rows = userIds.map((user_id) => ({ show_id: showId, user_id, access_role: "coordinator", granted_by: auth.user.id }));
    const { error } = await admin.from("event_user_access").insert(rows);
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const { data, error } = await admin
    .from("event_user_access")
    .select("id, show_id, user_id, access_role, created_at")
    .eq("show_id", showId);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, access: data ?? [], message: "Event user access saved." });
}
