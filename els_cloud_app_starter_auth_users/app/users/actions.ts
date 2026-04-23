"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase";

export async function inviteUserAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const email = String(formData.get("email") || "").trim();
  const fullName = String(formData.get("fullName") || "").trim();
  const role = String(formData.get("role") || "viewer").trim();

  if (!email) return { ok: false, message: "Email is required." };

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName, role },
  });

  if (error) return { ok: false, message: error.message };

  const userId = data.user?.id;
  if (!userId) return { ok: false, message: "Invite succeeded but no user id was returned." };

  const { error: upsertError } = await admin.from("profiles").upsert({
    id: userId,
    email,
    full_name: fullName || null,
    role,
    is_active: true,
  });

  if (upsertError) return { ok: false, message: upsertError.message };

  revalidatePath("/users");
  return { ok: true, message: `Invite sent to ${email}.` };
}
