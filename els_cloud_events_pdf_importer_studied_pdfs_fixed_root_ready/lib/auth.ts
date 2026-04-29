import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export type AppRole = "owner" | "admin" | "coordinator" | "viewer";

export async function getSessionUser() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { user: null, profile: null, setupMissing: true };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, setupMissing: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  return { user, profile, setupMissing: false };
}

export async function requireUser() {
  const session = await getSessionUser();
  if (session.setupMissing) return session;
  if (!session.user) redirect("/login");
  return session;
}

export async function requireRole(allowed: AppRole[]) {
  const session = await requireUser();
  const role = session.profile?.role as AppRole | undefined;
  if (!role || !allowed.includes(role)) redirect("/");
  return session;
}
