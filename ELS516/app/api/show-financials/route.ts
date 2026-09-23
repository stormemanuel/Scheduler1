import { NextResponse } from "next/server";
import { buildShowFinancialsPayload, extractPayrollSnapshotFromNotes, mergePayrollSnapshotIntoNotes, publicShowFinancialRecord } from "@/lib/financial-types";
import { savePayrollSnapshotForShow } from "@/lib/payroll-data";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

const financialSelectWithId = "id, show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at";
const financialSelectNoId = "show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at";
const financialSelectNoIdNoTimestamps = "show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at";

type FinancialRow = Record<string, unknown> & { id?: string | null; notes?: string | null; tax_reserve_done?: boolean | null; consecrated_hands_done?: boolean | null };

function financialSchemaMessage(message: string) {
  if (message.includes('relation "show_financials" does not exist')) return "Run the show_financials SQL migration once, then try again.";
  if (message.toLowerCase().includes("tax_reserve_done") || message.toLowerCase().includes("consecrated_hands_done") || message.toLowerCase().includes("column")) {
    return "Run the show financial reserve/checkoff SQL once, then try again.";
  }
  return message;
}

function idColumnUnavailable(message: string) {
  return /show_financials\.id|column show_financials\.id|schema cache/i.test(message || "");
}

function timestampColumnsUnavailable(message: string) {
  return /updated_at|created_at|schema cache/i.test(message || "");
}

async function readLatestShowFinancial(admin: ReturnType<typeof createSupabaseAdminClient>, showId: string, selectWithId: boolean, selectTimestamps: boolean) {
  if (!admin) return { data: null as FinancialRow | null, error: { message: "SUPABASE_SERVICE_ROLE_KEY is missing." } as { message: string }, idAvailable: selectWithId, timestampsAvailable: selectTimestamps };
  const select = selectWithId && selectTimestamps
    ? financialSelectWithId
    : selectTimestamps
      ? financialSelectNoId
      : financialSelectNoIdNoTimestamps;
  let query = admin
    .from("show_financials")
    .select(select)
    .eq("show_id", showId)
    .limit(1);
  if (selectTimestamps) query = query.order("updated_at", { ascending: false });
  let res = await query.maybeSingle();

  if (selectWithId && res.error && idColumnUnavailable(res.error.message || "")) {
    return readLatestShowFinancial(admin, showId, false, selectTimestamps);
  }
  if (selectTimestamps && res.error && timestampColumnsUnavailable(res.error.message || "")) {
    return readLatestShowFinancial(admin, showId, false, false);
  }

  return { data: (res.data as FinancialRow | null) ?? null, error: res.error, idAvailable: selectWithId, timestampsAvailable: selectTimestamps };
}

function omitUnavailableTimestampColumns(payload: Record<string, unknown>, timestampsAvailable: boolean) {
  if (timestampsAvailable) return payload;
  const next = { ...payload };
  delete next.updated_at;
  return next;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const now = new Date().toISOString();
    const {
      payload,
      taxReserveProvided,
      taxReserveDone,
      consecratedHandsProvided,
      consecratedHandsDone,
    } = buildShowFinancialsPayload(body, now);
    const showId = String(payload.show_id || "").trim();

    const existingRead = await readLatestShowFinancial(admin, showId, true, true);
    if (existingRead.error) {
      return NextResponse.json({ message: financialSchemaMessage(existingRead.error.message) }, { status: 400 });
    }

    const existingSnapshot = extractPayrollSnapshotFromNotes(existingRead.data?.notes);
    if (Object.prototype.hasOwnProperty.call(payload, "notes")) {
      payload.notes = mergePayrollSnapshotIntoNotes(payload.notes, existingSnapshot);
    }

    const writablePayload = omitUnavailableTimestampColumns(payload, existingRead.timestampsAvailable);
    const insertPayload = existingRead.timestampsAvailable ? { ...writablePayload, created_at: now } : writablePayload;
    const writeRes = existingRead.data
      ? await admin
        .from("show_financials")
        .update(writablePayload)
        .eq("show_id", showId)
      : await admin
        .from("show_financials")
        .insert(insertPayload);

    if (writeRes.error) {
      return NextResponse.json({ message: financialSchemaMessage(writeRes.error.message) }, { status: 400 });
    }

    const confirmRead = await readLatestShowFinancial(admin, showId, existingRead.idAvailable, existingRead.timestampsAvailable);
    if (confirmRead.error) {
      return NextResponse.json({ message: financialSchemaMessage(confirmRead.error.message) }, { status: 400 });
    }

    const data = confirmRead.data;
    if (!data) return NextResponse.json({ message: "Could not confirm saved show financials." }, { status: 400 });

    if (taxReserveProvided && Boolean(data.tax_reserve_done) !== taxReserveDone) {
      return NextResponse.json({ message: "Could not save tax reserve status." }, { status: 400 });
    }
    if (consecratedHandsProvided && Boolean(data.consecrated_hands_done) !== consecratedHandsDone) {
      return NextResponse.json({ message: "Could not save Charity payment status." }, { status: 400 });
    }

    const snapshotResult = await savePayrollSnapshotForShow(showId, { source: "show_financials_update" });
    const snapshotNote = snapshotResult.ok
      ? (snapshotResult.skipped ? "" : " Payroll snapshot refreshed.")
      : ` Payroll snapshot was not refreshed: ${snapshotResult.message}`;

    const message = consecratedHandsProvided
      ? (consecratedHandsDone ? "Charity marked paid." : "Charity marked unpaid.")
      : taxReserveProvided
        ? (taxReserveDone ? "Tax reserve marked set aside." : "Tax reserve marked open.")
        : "Show financials saved.";
    return NextResponse.json({ ok: true, row: publicShowFinancialRecord(data), message: `${message}${snapshotNote}` });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Financial update failed." }, { status: 400 });
  }
}
