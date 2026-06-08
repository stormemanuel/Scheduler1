import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { PAYROLL_STATUS_ROLE } from "@/lib/payroll-calculations";

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

function isScheduledForSchemaError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
  const lower = message.toLowerCase();
  return lower.includes("scheduled_for") || lower.includes("schema cache") || lower.includes("could not find the 'scheduled_for' column");
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
  payout_override: number | null;
  notes: string | null;
  scheduled_for?: string | null;
};

function publicRow(row: Record<string, unknown>, scheduledForFallback: string | null) {
  return {
    id: row.id,
    show_id: row.show_id,
    crew_id: row.crew_id,
    role_name: row.role_name,
    paid: Boolean(row.paid),
    payout_override: row.payout_override ?? null,
    notes: row.notes ?? null,
    scheduled_for: (row.scheduled_for as string | null | undefined) ?? scheduledForFallback,
  };
}

async function upsertPayrollStatus(admin: ReturnType<typeof createSupabaseAdminClient>, payload: PayrollPayload, includeScheduledFor: boolean) {
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  const writePayload = includeScheduledFor ? payload : (() => {
    const { scheduled_for: _scheduledFor, ...rest } = payload;
    return rest;
  })();
  const selectColumns = includeScheduledFor
    ? "id,show_id,crew_id,role_name,paid,payout_override,notes,scheduled_for"
    : "id,show_id,crew_id,role_name,paid,payout_override,notes";

  const upsertResult = await admin
    .from("show_payroll")
    .upsert(writePayload, { onConflict: "show_id,crew_id,role_name" })
    .select(selectColumns)
    .single();

  if (!upsertResult.error) return upsertResult.data as unknown as Record<string, unknown>;

  if (!isConflictConstraintError(upsertResult.error)) throw upsertResult.error;

  const existing = await admin
    .from("show_payroll")
    .select("id")
    .eq("show_id", payload.show_id)
    .eq("crew_id", payload.crew_id)
    .eq("role_name", payload.role_name)
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const updated = await admin
      .from("show_payroll")
      .update(writePayload)
      .eq("id", existing.data.id)
      .select(selectColumns)
      .single();
    if (updated.error) throw updated.error;
    return updated.data as unknown as Record<string, unknown>;
  }

  const inserted = await admin
    .from("show_payroll")
    .insert(writePayload)
    .select(selectColumns)
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data as unknown as Record<string, unknown>;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = await request.json();
    const showId = String(body.show_id || "").trim();
    const crewId = String(body.crew_id || "").trim();
    if (!showId || !crewId) return NextResponse.json({ message: "Show and crew are required." }, { status: 400 });

    const scheduledFor = optionalDate(body.scheduled_for);
    const payload: PayrollPayload = {
      show_id: showId,
      crew_id: crewId,
      role_name: PAYROLL_STATUS_ROLE,
      pay_type: "Regular",
      paid: Boolean(body.paid),
      payout_override: optionalMoney(body.payout_override),
      notes: String(body.notes || "").trim() || null,
      scheduled_for: scheduledFor,
    };

    try {
      const data = await upsertPayrollStatus(admin, payload, true);
      return NextResponse.json({ ok: true, row: publicRow(data, scheduledFor), message: "Payroll status updated." });
    } catch (firstError) {
      if (!isScheduledForSchemaError(firstError)) throw firstError;
      const data = await upsertPayrollStatus(admin, payload, false);
      return NextResponse.json({
        ok: true,
        row: publicRow(data, null),
        message: "Payroll paid/unpaid updated. Run the latest ELS127 SQL to enable Scheduled For dates.",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payroll update failed.";
    if (message.includes('relation "show_payroll" does not exist')) {
      return NextResponse.json({ message: "Run supabase/ELS127_required_migrations.sql once to create payroll tracking." }, { status: 400 });
    }
    return NextResponse.json({ message }, { status: 400 });
  }
}
