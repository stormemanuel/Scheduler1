import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function moneyOrNull(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Amount must be a positive number or blank.");
  return Math.round(parsed * 100) / 100;
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function buildShowFinancialsPayload(body: Record<string, unknown>, now: string) {
  const showId = String(body.show_id || "").trim();
  if (!showId) throw new Error("Show is required.");
  const taxReserveProvided = hasOwn(body, "tax_reserve_done");
  const consecratedHandsProvided = hasOwn(body, "consecrated_hands_done");
  const taxReserveDone = taxReserveProvided ? booleanValue(body.tax_reserve_done) : null;
  const consecratedHandsDone = consecratedHandsProvided ? booleanValue(body.consecrated_hands_done) : null;
  const payload: Record<string, unknown> = {
    show_id: showId,
    updated_at: now,
  };
  if (hasOwn(body, "estimated_revenue_override")) payload.estimated_revenue_override = moneyOrNull(body.estimated_revenue_override);
  if (hasOwn(body, "expenses")) payload.expenses = moneyOrNull(body.expenses) ?? 0;
  if (hasOwn(body, "notes")) payload.notes = String(body.notes || "").trim() || null;
  if (taxReserveProvided) {
    payload.tax_reserve_done = taxReserveDone;
    payload.tax_reserve_done_at = taxReserveDone ? (body.tax_reserve_done_at || now) : null;
  }
  if (consecratedHandsProvided) {
    payload.consecrated_hands_done = consecratedHandsDone;
    payload.consecrated_hands_done_at = consecratedHandsDone ? (body.consecrated_hands_done_at || now) : null;
  }

  return {
    payload,
    taxReserveProvided,
    taxReserveDone,
    consecratedHandsProvided,
    consecratedHandsDone,
  };
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

    const { data, error } = await admin
      .from("show_financials")
      .upsert(payload, { onConflict: "show_id" })
      .select("id, show_id, estimated_revenue_override, expenses, notes, tax_reserve_done, tax_reserve_done_at, consecrated_hands_done, consecrated_hands_done_at, created_at, updated_at")
      .single();

    if (error) {
      if (error.message.includes('relation "show_financials" does not exist')) {
        return NextResponse.json({ message: "Run the show_financials SQL migration once, then try again." }, { status: 400 });
      }
      if (error.message.toLowerCase().includes("tax_reserve_done") || error.message.toLowerCase().includes("consecrated_hands_done") || error.message.toLowerCase().includes("column")) {
        return NextResponse.json({ message: "Run the show financial reserve/checkoff SQL once, then try again." }, { status: 400 });
      }
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    if (taxReserveProvided && Boolean(data.tax_reserve_done) !== taxReserveDone) {
      return NextResponse.json({ message: "Could not save tax reserve status." }, { status: 400 });
    }
    if (consecratedHandsProvided && Boolean(data.consecrated_hands_done) !== consecratedHandsDone) {
      return NextResponse.json({ message: "Could not save Consecrated Hands payment status." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, row: data, message: "Show financials saved." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Financial update failed." }, { status: 400 });
  }
}
