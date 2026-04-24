"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

function cleanNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function upsertMasterRateAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const id = String(formData.get("id") || "").trim();
  const cityName = String(formData.get("city_name") || "").trim();
  const roleName = String(formData.get("role_name") || "").trim();
  const fullDay = cleanNumber(formData.get("full_day"));
  const halfDayRaw = String(formData.get("half_day") || "").trim();
  const overtimeMultiplier = cleanNumber(formData.get("overtime_multiplier"), 1.5);
  const doubletimeMultiplier = cleanNumber(formData.get("doubletime_multiplier"), 2.0);

  if (!cityName) return { ok: false, message: "City rate group is required." };
  if (!roleName) return { ok: false, message: "Role name is required." };
  if (!fullDay) return { ok: false, message: "Full day rate is required." };

  const payload = {
    ...(id ? { id } : {}),
    city_name: cityName,
    role_name: roleName,
    full_day: fullDay,
    half_day: halfDayRaw ? Number(halfDayRaw) : null,
    overtime_multiplier: overtimeMultiplier || 1.5,
    doubletime_multiplier: doubletimeMultiplier || 2.0,
  };

  const { error } = await admin.from("master_rates").upsert(payload, { onConflict: "city_name,role_name" });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true, message: `${roleName} saved for ${cityName}.` };
}

export async function deleteMasterRateAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  const id = String(formData.get("id") || "").trim();
  if (!id) return { ok: false, message: "Missing rate id." };

  const { error } = await admin.from("master_rates").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };

  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true, message: "Rate deleted." };
}
