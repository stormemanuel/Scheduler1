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

function normalizeRateKey(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMissingClientRatesTable(error: { message?: string } | null | undefined) {
  return Boolean(error?.message && /client_rates|schema cache|relation/i.test(error.message));
}

type RateCatalogRow = SavedRateRow;

async function synchronizeClientRatePositionCatalog(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  previousMasterRows: RateCatalogRow[],
  savedMasterRows: SavedRateRow[],
) {
  const masterRes = await admin
    .from("master_rates")
    .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
    .order("city_name", { ascending: true })
    .order("role_name", { ascending: true });
  if (masterRes.error) throw new Error(masterRes.error.message);

  const currentMasterRows = (masterRes.data ?? []) as RateCatalogRow[];
  const currentRoleCatalog = new Map<string, string>();
  for (const row of currentMasterRows) {
    const key = normalizeRateKey(row.role_name);
    if (!key) continue;
    const existing = currentRoleCatalog.get(key);
    if (!existing || row.city_name === "Default") currentRoleCatalog.set(key, row.role_name.trim());
  }

  const clientRes = await admin
    .from("client_rates")
    .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
    .order("city_name", { ascending: true })
    .order("role_name", { ascending: true });
  if (clientRes.error) {
    if (isMissingClientRatesTable(clientRes.error)) return [] as SavedRateRow[];
    throw new Error(clientRes.error.message);
  }

  let clientRows = (clientRes.data ?? []) as SavedRateRow[];
  const savedById = new Map(savedMasterRows.map((row) => [row.id, row]));

  // Preserve billing amounts when a crew position is renamed. A rename is
  // applied to every client rate group only when the old role no longer exists
  // anywhere in the crew catalog.
  for (const previous of previousMasterRows) {
    const next = savedById.get(previous.id);
    if (!next) continue;
    const oldKey = normalizeRateKey(previous.role_name);
    const newKey = normalizeRateKey(next.role_name);
    if (!oldKey || !newKey || oldKey === newKey || currentRoleCatalog.has(oldKey)) continue;

    const canonicalNewName = currentRoleCatalog.get(newKey) || next.role_name.trim();
    const oldClientRows = clientRows.filter((row) => normalizeRateKey(row.role_name) === oldKey);
    for (const oldClient of oldClientRows) {
      const destination = clientRows.find((row) => row.city_name === oldClient.city_name && normalizeRateKey(row.role_name) === newKey);
      if (destination && destination.id !== oldClient.id) {
        const destinationAmount = Number(destination.full_day || 0);
        const oldAmount = Number(oldClient.full_day || 0);
        if (destinationAmount <= 0 && oldAmount > 0) {
          const { error } = await admin.from("client_rates").update({
            full_day: oldClient.full_day,
            half_day: oldClient.half_day,
            overtime_multiplier: oldClient.overtime_multiplier,
            doubletime_multiplier: oldClient.doubletime_multiplier,
          }).eq("id", destination.id);
          if (error) throw new Error(error.message);
        }
        const { error } = await admin.from("client_rates").delete().eq("id", oldClient.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await admin.from("client_rates").update({ role_name: canonicalNewName }).eq("id", oldClient.id);
        if (error) throw new Error(error.message);
      }
    }
  }

  const refreshedRes = await admin
    .from("client_rates")
    .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
    .order("city_name", { ascending: true })
    .order("role_name", { ascending: true });
  if (refreshedRes.error) throw new Error(refreshedRes.error.message);
  clientRows = (refreshedRes.data ?? []) as SavedRateRow[];

  // Client positions are controlled by the crew position catalog. Remove only
  // roles that no longer exist anywhere in Crew Pay; city-specific billing
  // overrides for valid roles are preserved.
  const orphanIds = clientRows
    .filter((row) => !currentRoleCatalog.has(normalizeRateKey(row.role_name)))
    .map((row) => row.id);
  if (orphanIds.length) {
    const { error } = await admin.from("client_rates").delete().in("id", orphanIds);
    if (error) throw new Error(error.message);
    clientRows = clientRows.filter((row) => !orphanIds.includes(row.id));
  }

  // Normalize every stored client position to the exact crew position name.
  for (const row of clientRows) {
    const canonicalName = currentRoleCatalog.get(normalizeRateKey(row.role_name));
    if (!canonicalName || canonicalName === row.role_name) continue;
    const { error } = await admin.from("client_rates").update({ role_name: canonicalName }).eq("id", row.id);
    if (error) throw new Error(error.message);
    row.role_name = canonicalName;
  }

  // Every crew position gets a Default client billing row. A newly-created
  // position starts at $0 until the Owner/Admin enters the billing rate.
  const defaultClientKeys = new Set(
    clientRows.filter((row) => row.city_name === "Default").map((row) => normalizeRateKey(row.role_name)),
  );
  const missingDefaultRows = Array.from(currentRoleCatalog.entries())
    .filter(([key]) => !defaultClientKeys.has(key))
    .map(([, roleName]) => ({
      id: randomUUID(),
      city_name: "Default",
      role_name: roleName,
      full_day: 0,
      half_day: 0,
      overtime_multiplier: 1.5,
      doubletime_multiplier: 2,
    }));

  if (missingDefaultRows.length) {
    const { error } = await admin.from("client_rates").insert(missingDefaultRows);
    if (error) throw new Error(error.message);
  }

  const finalRes = await admin
    .from("client_rates")
    .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
    .order("city_name", { ascending: true })
    .order("role_name", { ascending: true });
  if (finalRes.error) throw new Error(finalRes.error.message);
  return (finalRes.data ?? []) as SavedRateRow[];
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

  const sourceIds = Array.from(new Set([
    ...deletes,
    ...(Array.isArray(payload.upserts) ? payload.upserts.map((row) => String(row.id || "").trim()).filter(Boolean) : []),
  ]));
  let previousMasterRows: RateCatalogRow[] = [];
  if (tableName === "master_rates" && sourceIds.length) {
    const previousRes = await admin
      .from("master_rates")
      .select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier")
      .in("id", sourceIds);
    if (previousRes.error) return { ok: false, message: previousRes.error.message };
    previousMasterRows = (previousRes.data ?? []) as RateCatalogRow[];
  }

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
        .filter((row) => Boolean(row.city_name) && Boolean(row.role_name) && (tableName === "client_rates" ? row.full_day >= 0 : row.full_day > 0))
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

  let clientRows: SavedRateRow[] | undefined;
  if (tableName === "master_rates") {
    try {
      clientRows = await synchronizeClientRatePositionCatalog(admin, previousMasterRows, savedRows);
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Crew rates saved, but client positions could not be synchronized." };
    }
  }

  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/events");
  revalidatePath("/payroll");

  return { ok: true, message: successMessage, rows: savedRows, clientRows };
}

export async function bulkSaveMasterRatesAction(formData: FormData) {
  return bulkSaveRateTable(formData, "master_rates", "Crew pay master rates saved.");
}

export async function bulkSaveClientRatesAction(formData: FormData) {
  return bulkSaveRateTable(formData, "client_rates", "Client billing rates saved.");
}
