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

const financialSelect = "id, show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at";

function financialSchemaMessage(message: string) {
  if (message.includes('relation "show_financials" does not exist')) return "Run the show_financials SQL migration once, then try again.";
  if (message.toLowerCase().includes("tax_reserve_done") || message.toLowerCase().includes("consecrated_hands_done") || message.toLowerCase().includes("column")) {
    return "Run the show financial reserve/checkoff SQL once, then try again.";
  }
  return message;
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

    const existingRes = await admin
      .from("show_financials")
      .select(financialSelect)
      .eq("show_id", showId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRes.error) {
      return NextResponse.json({ message: financialSchemaMessage(existingRes.error.message) }, { status: 400 });
    }

    const existingSnapshot = extractPayrollSnapshotFromNotes((existingRes.data as { notes?: string | null } | null)?.notes);
    if (Object.prototype.hasOwnProperty.call(payload, "notes")) {
      payload.notes = mergePayrollSnapshotIntoNotes(payload.notes, existingSnapshot);
    }

    const existingId = String((existingRes.data as { id?: string } | null)?.id || "").trim();
    const writeRes = existingId
      ? await admin
        .from("show_financials")
        .update(payload)
        .eq("id", existingId)
        .select(financialSelect)
        .single()
      : await admin
        .from("show_financials")
        .insert({ ...payload, created_at: now })
        .select(financialSelect)
        .single();

    if (writeRes.error) {
      return NextResponse.json({ message: financialSchemaMessage(writeRes.error.message) }, { status: 400 });
    }

    const confirmRes = await admin
      .from("show_financials")
      .select(financialSelect)
      .eq("show_id", showId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (confirmRes.error) {
      return NextResponse.json({ message: financialSchemaMessage(confirmRes.error.message) }, { status: 400 });
    }

    const data = confirmRes.data ?? writeRes.data;
    if (!data) return NextResponse.json({ message: "Could not confirm saved show financials." }, { status: 400 });

    if (taxReserveProvided && Boolean(data.tax_reserve_done) !== taxReserveDone) {
      return NextResponse.json({ message: "Could not save tax reserve status." }, { status: 400 });
    }
    if (consecratedHandsProvided && Boolean(data.consecrated_hands_done) !== consecratedHandsDone) {
      return NextResponse.json({ message: "Could not save Consecrated Hands payment status." }, { status: 400 });
    }

    const snapshotResult = await savePayrollSnapshotForShow(showId, { source: "show_financials_update" });
    const snapshotNote = snapshotResult.ok
      ? (snapshotResult.skipped ? "" : " Payroll snapshot refreshed.")
      : ` Payroll snapshot was not refreshed: ${snapshotResult.message}`;

    const message = consecratedHandsProvided
      ? (consecratedHandsDone ? "Consecrated Hands marked paid." : "Consecrated Hands marked unpaid.")
      : taxReserveProvided
        ? (taxReserveDone ? "Tax reserve marked set aside." : "Tax reserve marked open.")
        : "Show financials saved.";
    return NextResponse.json({ ok: true, row: publicShowFinancialRecord(data), message: `${message}${snapshotNote}` });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Financial update failed." }, { status: 400 });
  }
}
