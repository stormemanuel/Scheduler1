import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

type EventAccessRow = {
  id?: string;
  show_id?: string;
  user_id?: string | null;
  user_profile_id?: string | null;
  access_role?: string | null;
  created_at?: string | null;
};

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function normalizeAccessRows(rows: EventAccessRow[] | null | undefined) {
  return (rows ?? []).map((row) => {
    const userId = row.user_id || row.user_profile_id || "";
    return {
      id: row.id,
      show_id: row.show_id,
      user_id: userId,
      user_profile_id: row.user_profile_id || userId,
      access_role: row.access_role,
      created_at: row.created_at,
    };
  });
}

function isMissingUserProfileColumn(error: { message?: string } | null | undefined) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("user_profile_id") && (msg.includes("schema cache") || msg.includes("column") || msg.includes("could not find"));
}

async function selectEventAccess(admin: ReturnType<typeof createSupabaseAdminClient>, showId: string) {
  if (!admin) return [];
  const withProfile = await admin
    .from("event_user_access")
    .select("id, show_id, user_id, user_profile_id, access_role, created_at")
    .eq("show_id", showId);
  if (!withProfile.error) return normalizeAccessRows(withProfile.data as EventAccessRow[]);

  const fallback = await admin
    .from("event_user_access")
    .select("id, show_id, user_id, access_role, created_at")
    .eq("show_id", showId);
  if (fallback.error) throw fallback.error;
  return normalizeAccessRows(fallback.data as EventAccessRow[]);
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
    const rowsWithProfile = userIds.map((user_id) => ({
      show_id: showId,
      user_id,
      user_profile_id: user_id,
      access_role: "coordinator",
      granted_by: auth.user.id,
    }));
    const withProfile = await admin.from("event_user_access").insert(rowsWithProfile);

    if (withProfile.error) {
      if (!isMissingUserProfileColumn(withProfile.error)) {
        return NextResponse.json({ message: withProfile.error.message }, { status: 400 });
      }
      const fallbackRows = userIds.map((user_id) => ({ show_id: showId, user_id, access_role: "coordinator", granted_by: auth.user.id }));
      const fallback = await admin.from("event_user_access").insert(fallbackRows);
      if (fallback.error) return NextResponse.json({ message: fallback.error.message }, { status: 400 });
    }
  }

  try {
    const access = await selectEventAccess(admin, showId);
    return NextResponse.json({ ok: true, access, message: "Event user access saved." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Event user access saved, but the access list could not be refreshed.";
    return NextResponse.json({ ok: true, access: [], message });
  }
}
