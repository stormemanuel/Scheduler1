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

function isUserProfileConstraintError(error: { message?: string } | null | undefined) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("event_user_access_user_profile_id_fkey") ||
    (msg.includes("violates foreign key constraint") && msg.includes("user_profile_id")) ||
    (msg.includes("null value in column") && msg.includes("user_profile_id"))
  );
}

async function ensureProfileRows(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, userIds: string[]) {
  if (!userIds.length) return;

  const { data: existingRows, error: existingError } = await admin
    .from("profiles")
    .select("id")
    .in("id", userIds);

  if (existingError) return;

  const existingIds = new Set((existingRows ?? []).map((row) => String((row as { id?: string }).id || "")).filter(Boolean));
  const missingIds = userIds.filter((id) => !existingIds.has(id));
  if (!missingIds.length) return;

  const profileRows: Array<Record<string, unknown>> = [];
  for (const userId of missingIds) {
    const authUser = await admin.auth.admin.getUserById(userId).catch(() => null);
    const user = authUser && !authUser.error ? authUser.data.user : null;
    const metadata = (user?.user_metadata || {}) as { full_name?: string; name?: string; role?: string };
    profileRows.push({
      id: userId,
      email: user?.email || null,
      full_name: metadata.full_name || metadata.name || user?.email || null,
      role: metadata.role || "coordinator",
      is_active: true,
    });
  }

  if (!profileRows.length) return;
  const upsert = await admin.from("profiles").upsert(profileRows, { onConflict: "id" });
  if (!upsert.error) return;

  const saferRows = profileRows.map(({ id, email, full_name }) => ({ id, email, full_name }));
  await admin.from("profiles").upsert(saferRows, { onConflict: "id" });
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
  const userIds: string[] = Array.isArray(body.user_ids)
    ? Array.from(new Set(body.user_ids.map((id: unknown) => String(id || "").trim()).filter(Boolean))) as string[]
    : [];
  if (!showId) return NextResponse.json({ message: "Show is required." }, { status: 400 });

  await ensureProfileRows(admin, userIds);

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
      if (!isMissingUserProfileColumn(withProfile.error) && !isUserProfileConstraintError(withProfile.error)) {
        return NextResponse.json({ message: withProfile.error.message }, { status: 400 });
      }
      const fallbackRows = userIds.map((user_id) => ({ show_id: showId, user_id, access_role: "coordinator", granted_by: auth.user.id }));
      const fallback = await admin.from("event_user_access").insert(fallbackRows);
      if (fallback.error) {
        const help = isUserProfileConstraintError(fallback.error)
          ? " Run the ELS133 event access SQL to remove the old user_profile_id constraint, then try again."
          : "";
        return NextResponse.json({ message: `${fallback.error.message}${help}` }, { status: 400 });
      }
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
