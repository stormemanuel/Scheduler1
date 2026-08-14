"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { halfDayFromFullDay } from "@/lib/rates-types";

type BulkRatePayload = {
  upserts: Array<{
    id?: string;
    city_name: string;
    role_name: string;
    full_day: number | string;
    half_day: number | string | null;
    overtime_multiplier: number | string;
    doubletime_multiplier: number | string;
  }>;
  deletes: string[];
};

type NormalizedRateRow = {
  id?: string;
  city_name: string;
  role_name: string;
  full_day: number;
  half_day: number | null;
  overtime_multiplier: number;
  doubletime_multiplier: number;
};

type SavedRateRow = {
  id: string;
  city_name: string;
  role_name: string;
  full_day: number;
  half_day: number | null;
  overtime_multiplier: number;
  doubletime_multiplier: number;
};

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function bulkSaveRateTable(formData: FormData, tableName: "master_rates" | "client_rates", successMessage: string) {
  await requireRole(["owner", "admin"]);

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { ok: false, message: "SUPABASE_SERVICE_ROLE_KEY is missing." };
  }

  let payload: BulkRatePayload;
  try {
    payload = JSON.parse(String(formData.get("payload") || "{}")) as BulkRatePayload;
  } catch {
    return { ok: false, message: "Could not parse the rates payload." };
  }

  const deletes = Array.isArray(payload.deletes)
    ? payload.deletes.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const upserts: NormalizedRateRow[] = Array.isArray(payload.upserts)
    ? payload.upserts
        .map((row): NormalizedRateRow => ({
          id: row.id ? String(row.id).trim() : undefined,
          city_name: String(row.city_name || "").trim(),
          role_name: String(row.role_name || "").trim(),
          full_day: normalizeNumber(row.full_day, 0),
          half_day: halfDayFromFullDay(normalizeNumber(row.full_day, 0)),
          overtime_multiplier: normalizeNumber(row.overtime_multiplier, 1.5) || 1.5,
          doubletime_multiplier: normalizeNumber(row.doubletime_multiplier, 2.0) || 2.0,
        }))
        .filter((row) => Boolean(row.city_name) && Boolean(row.role_name) && row.full_day > 0)
    : [];

  if (!deletes.length && !upserts.length) {
    return { ok: false, message: "There are no changes to save." };
  }

  if (deletes.length) {
    const { error } = await admin.from(tableName).delete().in("id", deletes);
    if (error) return { ok: false, message: error.message };
  }

  const savedRows: SavedRateRow[] = [];

  if (upserts.length) {
    for (const row of upserts) {
      const saveRow = {
        city_name: row.city_name,
        role_name: row.role_name,
        full_day: row.full_day,
        half_day: row.half_day,
        overtime_multiplier: row.overtime_multiplier,
        doubletime_multiplier: row.doubletime_multiplier,
      };

      if (row.id) {
        const { data: updatedRow, error } = await admin
          .from(tableName)
          .update(saveRow)
          .eq("id", row.id)
          .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
          .maybeSingle();
        if (error) return { ok: false, message: error.message };
        if (updatedRow?.id) {
          savedRows.push(updatedRow as SavedRateRow);
          continue;
        }
      }

      const { data: existingRow, error: lookupError } = await admin
        .from(tableName)
        .select("id")
        .eq("city_name", row.city_name)
        .eq("role_name", row.role_name)
        .maybeSingle();

      if (lookupError) return { ok: false, message: lookupError.message };

      if (existingRow?.id) {
        const { data: updatedRow, error } = await admin
          .from(tableName)
          .update(saveRow)
          .eq("id", existingRow.id)
          .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
          .single();
        if (error) return { ok: false, message: error.message };
        savedRows.push(updatedRow as SavedRateRow);
      } else {
        const { data: insertedRow, error } = await admin
          .from(tableName)
          .insert({ ...saveRow, id: randomUUID() })
          .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
          .single();
        if (error) return { ok: false, message: error.message };
        savedRows.push(insertedRow as SavedRateRow);
      }
    }
  }

  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/events");
  revalidatePath("/payroll");

  return { ok: true, message: successMessage, rows: savedRows };
}

export async function bulkSaveMasterRatesAction(formData: FormData) {
  return bulkSaveRateTable(formData, "master_rates", "Crew pay master rates saved.");
}

export async function bulkSaveClientRatesAction(formData: FormData) {
  return bulkSaveRateTable(formData, "client_rates", "Client billing rates saved.");
}
