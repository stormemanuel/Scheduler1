"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type BulkRatePayload = {
  upserts: Array<{
    id?: string;
    city_name: string;
    role_name: string;
    full_day: number;
    half_day: number | null;
    overtime_multiplier: number;
    doubletime_multiplier: number;
  }>;
  deletes: string[];
};

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function bulkSaveMasterRatesAction(formData: FormData) {
  await requireRole(["owner", "admin"]);

  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };

  let payload: BulkRatePayload;
  try {
    payload = JSON.parse(String(formData.get("payload") || "{}")) as BulkRatePayload;
  } catch {
    return { ok: false, message: "Could not parse the rates payload." };
  }

  const deletes = Array.isArray(payload.deletes)
    ? payload.deletes.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const upserts = Array.isArray(payload.upserts)
    ? payload.upserts
       .map((row) => ({
  role_name: String(row.role_name || "").trim(),
  full_day: normalizeNumber(row.full_day, 0),
  half_day:
    row.half_day == null || String(row.half_day).trim() === ""
      ? null
      : normalizeNumber(row.half_day, 0),
  overtime_multiplier: normalizeNumber(row.overtime_multiplier, 1.5) || 1.5,
  doubletime_multiplier: normalizeNumber(row.doubletime_multiplier, 2.0) || 2.0,
}))
        .filter((row) => row.city_name && row.role_name && row.full_day > 0)
    : [];

  if (!deletes.length && !upserts.length) {
    return { ok: false, message: "There are no changes to save." };
  }

  if (deletes.length) {
    const { error } = await admin.from("master_rates").delete().in("id", deletes);
    if (error) return { ok: false, message: error.message };
  }

  if (upserts.length) {
    const { error } = await admin.from("master_rates").upsert(upserts, { onConflict: "city_name,role_name" });
    if (error) return { ok: false, message: error.message };
  }

  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/events");
  return { ok: true, message: "Master rates saved." };
}
