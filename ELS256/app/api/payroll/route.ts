import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { PAYROLL_STATUS_ROLE } from "@/lib/payroll-calculations";
import type { PayrollPaymentStatus } from "@/lib/payroll-types";

const COORDINATOR_PAYROLL_FALLBACK_ROLE = "__ELS_COORDINATOR_PAYROLL__";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function optionalDate(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const clean = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) throw new Error("Scheduled-for date must use YYYY-MM-DD format or be blank.");
  return clean;
}

function optionalMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Override amount must be a positive number or blank.");
  return Math.round(parsed * 100) / 100;
}

function normalizePaymentStatus(value: unknown, paid: boolean, scheduledFor: string | null): PayrollPaymentStatus {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "paid" || clean === "scheduled" || clean === "unpaid") return clean;
  if (paid) return "paid";
  if (scheduledFor) return "scheduled";
  return "unpaid";
}

function isMissingColumnError(error: unknown, columnName: string) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
  const lower = message.toLowerCase();
  return lower.includes(columnName.toLowerCase()) || lower.includes("schema cache") || lower.includes("unexpected input");
}

function isConflictConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
  const lower = message.toLowerCase();
  return lower.includes("no unique") || lower.includes("on conflict") || lower.includes("42p10");
}

type PayrollPayload = {
  show_id: string;
  crew_id: string;
  role_name: string;
  pay_type: string;
  paid: boolean;
  payment_status: PayrollPaymentStatus;
  payout_override: number | null;
  notes: string | null;
  scheduled_for?: string | null;
};

type CoordinatorPayload = {
  show_id: string;
  coordinator_user_id: string;
  paid: boolean;
  payment_status: PayrollPaymentStatus;
  payout_override: number | null;
  notes: string | null;
  scheduled_for?: string | null;
};

type ColumnOptions = {
  includeScheduledFor: boolean;
  includePaymentStatus: boolean;
};

function payloadForColumns(payload: PayrollPayload, options: ColumnOptions) {
  const writePayload: Record<string, unknown> = {
    show_id: payload.show_id,
    crew_id: payload.crew_id,
    role_name: payload.role_name,
    pay_type: payload.pay_type,
    paid: payload.payment_status === "paid",
    payout_override: payload.payout_override,
    notes: payload.notes,
  };
  if (options.includePaymentStatus) writePayload.payment_status = payload.payment_status;
  if (options.includeScheduledFor) writePayload.scheduled_for = payload.scheduled_for ?? null;
  return writePayload;
}

function selectColumns(options: ColumnOptions) {
  const columns = ["id", "show_id", "crew_id", "role_name", "paid", "payout_override", "notes"];
  if (options.includePaymentStatus) columns.push("payment_status");
  if (options.includeScheduledFor) columns.push("scheduled_for");
  return columns.join(",");
}

function publicRow(row: Record<string, unknown>, payload: PayrollPayload) {
  const scheduledFor = (row.scheduled_for as string | null | undefined) ?? payload.scheduled_for ?? null;
  const paymentStatus = normalizePaymentStatus(row.payment_status ?? payload.payment_status, Boolean(row.paid), scheduledFor);
  return {
    id: row.id,
    show_id: row.show_id,
    crew_id: row.crew_id,
    role_name: row.role_name,
    paid: paymentStatus === "paid",
    payment_status: paymentStatus,
    payout_override: row.payout_override ?? null,
    notes: row.notes ?? null,
    scheduled_for: scheduledFor,
  };
}

async function upsertPayrollStatus(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, payload: PayrollPayload, options: ColumnOptions) {
  const table = admin.from("show_payroll") as any;
  const writePayload = payloadForColumns(payload, options);
  const columns = selectColumns(options);

  const upsertResult = await table
    .upsert(writePayload, { onConflict: "show_id,crew_id,role_name" })
    .select(columns)
    .single();

  if (!upsertResult.error) return upsertResult.data as Record<string, unknown>;

  if (!isConflictConstraintError(upsertResult.error)) throw upsertResult.error;

  const existing = await table
    .select("id")
    .eq("show_id", payload.show_id)
    .eq("crew_id", payload.crew_id)
    .eq("role_name", payload.role_name)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const updated = await table
      .update(writePayload)
      .eq("id", existing.data.id)
      .select(columns)
      .single();
    if (updated.error) throw updated.error;
    return updated.data as Record<string, unknown>;
  }

  const inserted = await table
    .insert(writePayload)
    .select(columns)
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data as Record<string, unknown>;
}

async function upsertWithSchemaFallback(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, payload: PayrollPayload) {
  const attempts: ColumnOptions[] = [
    { includeScheduledFor: true, includePaymentStatus: true },
    { includeScheduledFor: true, includePaymentStatus: false },
    { includeScheduledFor: false, includePaymentStatus: true },
    { includeScheduledFor: false, includePaymentStatus: false },
  ];

  let lastError: unknown = null;
  for (const options of attempts) {
    try {
      const data = await upsertPayrollStatus(admin, payload, options);
      const missing: string[] = [];
      if (!options.includePaymentStatus) missing.push("payment_status");
      if (!options.includeScheduledFor) missing.push("scheduled_for");
      return { data, missing };
    } catch (error) {
      lastError = error;
      if (!isMissingColumnError(error, "payment_status") && !isMissingColumnError(error, "scheduled_for")) throw error;
    }
  }
  throw lastError;
}

function coordinatorPayloadForColumns(payload: CoordinatorPayload, options: ColumnOptions) {
  const writePayload: Record<string, unknown> = {
    show_id: payload.show_id,
    coordinator_user_id: payload.coordinator_user_id,
    paid: payload.payment_status === "paid",
    payout_override: payload.payout_override,
    notes: payload.notes,
  };
  if (options.includePaymentStatus) writePayload.payment_status = payload.payment_status;
  if (options.includeScheduledFor) writePayload.scheduled_for = payload.scheduled_for ?? null;
  return writePayload;
}

function publicCoordinatorRow(row: Record<string, unknown>, payload: CoordinatorPayload) {
  const scheduledFor = (row.scheduled_for as string | null | undefined) ?? payload.scheduled_for ?? null;
  const paymentStatus = normalizePaymentStatus(row.payment_status ?? payload.payment_status, Boolean(row.paid), scheduledFor);
  return {
    id: row.id,
    show_id: row.show_id,
    coordinator_user_id: row.coordinator_user_id,
    paid: paymentStatus === "paid",
    payment_status: paymentStatus,
    payout_override: row.payout_override ?? null,
    notes: row.notes ?? null,
    scheduled_for: scheduledFor,
  };
}

function publicCoordinatorFallbackRow(row: Record<string, unknown>, payload: CoordinatorPayload) {
  const scheduledFor = (row.scheduled_for as string | null | undefined) ?? payload.scheduled_for ?? null;
  const paymentStatus = normalizePaymentStatus(row.payment_status ?? payload.payment_status, Boolean(row.paid), scheduledFor);
  return {
    id: row.id,
    show_id: row.show_id,
    coordinator_user_id: row.crew_id ?? payload.coordinator_user_id,
    paid: paymentStatus === "paid",
    payment_status: paymentStatus,
    payout_override: row.payout_override ?? null,
    notes: row.notes ?? null,
    scheduled_for: scheduledFor,
  };
}

function coordinatorFallbackPayloadForColumns(payload: CoordinatorPayload, options: ColumnOptions) {
  const writePayload: Record<string, unknown> = {
    show_id: payload.show_id,
    crew_id: payload.coordinator_user_id,
    role_name: COORDINATOR_PAYROLL_FALLBACK_ROLE,
    pay_type: "Coordinator",
    paid: payload.payment_status === "paid",
    payout_override: payload.payout_override,
    notes: payload.notes,
  };
  if (options.includePaymentStatus) writePayload.payment_status = payload.payment_status;
  if (options.includeScheduledFor) writePayload.scheduled_for = payload.scheduled_for ?? null;
  return writePayload;
}

async function upsertCoordinatorPayrollFallbackStatus(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, payload: CoordinatorPayload, options: ColumnOptions) {
  const table = admin.from("show_payroll") as any;
  const writePayload = coordinatorFallbackPayloadForColumns(payload, options);
  const columns = selectColumns(options);

  const upsertResult = await table
    .upsert(writePayload, { onConflict: "show_id,crew_id,role_name" })
    .select(columns)
    .single();
  if (!upsertResult.error) return publicCoordinatorFallbackRow(upsertResult.data as Record<string, unknown>, payload);

  if (!isConflictConstraintError(upsertResult.error)) throw upsertResult.error;

  const existing = await table
    .select("id")
    .eq("show_id", payload.show_id)
    .eq("crew_id", payload.coordinator_user_id)
    .eq("role_name", COORDINATOR_PAYROLL_FALLBACK_ROLE)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    const updated = await table.update(writePayload).eq("id", existing.data.id).select(columns).single();
    if (updated.error) throw updated.error;
    return publicCoordinatorFallbackRow(updated.data as Record<string, unknown>, payload);
  }
  const inserted = await table.insert(writePayload).select(columns).single();
  if (inserted.error) throw inserted.error;
  return publicCoordinatorFallbackRow(inserted.data as Record<string, unknown>, payload);
}

async function upsertCoordinatorFallbackWithSchemaFallback(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, payload: CoordinatorPayload) {
  const attempts: ColumnOptions[] = [
    { includeScheduledFor: true, includePaymentStatus: true },
    { includeScheduledFor: true, includePaymentStatus: false },
    { includeScheduledFor: false, includePaymentStatus: true },
    { includeScheduledFor: false, includePaymentStatus: false },
  ];
  let lastError: unknown = null;
  for (const options of attempts) {
    try {
      const data = await upsertCoordinatorPayrollFallbackStatus(admin, payload, options);
      return data;
    } catch (error) {
      lastError = error;
      if (!isMissingColumnError(error, "payment_status") && !isMissingColumnError(error, "scheduled_for")) throw error;
    }
  }
  throw lastError;
}

async function upsertCoordinatorPayrollStatus(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, payload: CoordinatorPayload, options: ColumnOptions) {
  const table = admin.from("coordinator_payroll") as any;
  const writePayload = coordinatorPayloadForColumns(payload, options);
  const columns = ["id", "show_id", "coordinator_user_id", "paid", "payout_override", "notes", options.includePaymentStatus ? "payment_status" : "", options.includeScheduledFor ? "scheduled_for" : ""].filter(Boolean).join(",");

  const upsertResult = await table
    .upsert(writePayload, { onConflict: "show_id,coordinator_user_id" })
    .select(columns)
    .single();
  if (!upsertResult.error) return upsertResult.data as Record<string, unknown>;
  if (!isConflictConstraintError(upsertResult.error)) throw upsertResult.error;

  const existing = await table
    .select("id")
    .eq("show_id", payload.show_id)
    .eq("coordinator_user_id", payload.coordinator_user_id)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    const updated = await table.update(writePayload).eq("id", existing.data.id).select(columns).single();
    if (updated.error) throw updated.error;
    return updated.data as Record<string, unknown>;
  }
  const inserted = await table.insert(writePayload).select(columns).single();
  if (inserted.error) throw inserted.error;
  return inserted.data as Record<string, unknown>;
}

async function upsertCoordinatorWithSchemaFallback(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, payload: CoordinatorPayload) {
  const attempts: ColumnOptions[] = [
    { includeScheduledFor: true, includePaymentStatus: true },
    { includeScheduledFor: true, includePaymentStatus: false },
    { includeScheduledFor: false, includePaymentStatus: true },
    { includeScheduledFor: false, includePaymentStatus: false },
  ];
  let lastError: unknown = null;
  for (const options of attempts) {
    try {
      const data = await upsertCoordinatorPayrollStatus(admin, payload, options);
      return { data, missing: [] as string[] };
    } catch (error) {
      lastError = error;
      if (!isMissingColumnError(error, "payment_status") && !isMissingColumnError(error, "scheduled_for")) throw error;
    }
  }
  throw lastError;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = await request.json();
    const showId = String(body.show_id || "").trim();
    if (String(body.record_type || "").trim() === "coordinator") {
      const coordinatorUserId = String(body.coordinator_user_id || "").trim();
      if (!showId || !coordinatorUserId) return NextResponse.json({ message: "Show and coordinator are required." }, { status: 400 });
      const scheduledFor = optionalDate(body.scheduled_for);
      const paymentStatus = normalizePaymentStatus(body.payment_status, Boolean(body.paid), scheduledFor);
      const payload: CoordinatorPayload = {
        show_id: showId,
        coordinator_user_id: coordinatorUserId,
        paid: paymentStatus === "paid",
        payment_status: paymentStatus,
        payout_override: optionalMoney(body.payout_override),
        notes: String(body.notes || "").trim() || null,
        scheduled_for: scheduledFor,
      };
      try {
        const { data } = await upsertCoordinatorWithSchemaFallback(admin, payload);
        try {
          await upsertCoordinatorFallbackWithSchemaFallback(admin, payload);
        } catch {
          // The dedicated coordinator_payroll row saved successfully.
          // Ignore fallback write failures so existing installs with coordinator_payroll keep working.
        }
        return NextResponse.json({ ok: true, row: publicCoordinatorRow(data, payload), message: "Coordinator payroll status updated." });
      } catch (error) {
        const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
        if (message.includes('relation "coordinator_payroll" does not exist')) {
          const fallbackRow = await upsertCoordinatorFallbackWithSchemaFallback(admin, payload);
          return NextResponse.json({ ok: true, row: fallbackRow, message: "Coordinator payroll status updated." });
        }
        throw error;
      }
    }

    const crewId = String(body.crew_id || "").trim();
    if (!showId || !crewId) return NextResponse.json({ message: "Show and crew are required." }, { status: 400 });

    const scheduledFor = optionalDate(body.scheduled_for);
    const paymentStatus = normalizePaymentStatus(body.payment_status, Boolean(body.paid), scheduledFor);
    const payload: PayrollPayload = {
      show_id: showId,
      crew_id: crewId,
      role_name: PAYROLL_STATUS_ROLE,
      pay_type: "Regular",
      paid: paymentStatus === "paid",
      payment_status: paymentStatus,
      payout_override: optionalMoney(body.payout_override),
      notes: String(body.notes || "").trim() || null,
      scheduled_for: scheduledFor,
    };

    const { data, missing } = await upsertWithSchemaFallback(admin, payload);
    const message = missing.length
      ? `Payroll updated. Run the latest ELS127 SQL to fully enable: ${missing.join(", ")}.`
      : "Payroll status updated.";
    return NextResponse.json({ ok: true, row: publicRow(data, payload), message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payroll update failed.";
    if (message.includes('relation "coordinator_payroll" does not exist')) {
      return NextResponse.json({ message: "Run ELS200_required_sql.sql once in Supabase to create coordinator_payroll before saving or waiving coordinator fees." }, { status: 400 });
    }
    if (message.includes('relation "show_payroll" does not exist')) {
      return NextResponse.json({ message: "Run supabase/ELS127_required_migrations.sql once to create payroll tracking." }, { status: 400 });
    }
    return NextResponse.json({ message }, { status: 400 });
  }
}
