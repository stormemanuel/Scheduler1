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

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = await request.json();
    const showId = String(body.show_id || "").trim();
    if (!showId) return NextResponse.json({ message: "Show is required." }, { status: 400 });
    const now = new Date().toISOString();
    const taxReserveDone = booleanValue(body.tax_reserve_done);
    const consecratedHandsDone = booleanValue(body.consecrated_hands_done);
    const payload = {
      show_id: showId,
      estimated_revenue_override: moneyOrNull(body.estimated_revenue_override),
      expenses: moneyOrNull(body.expenses) ?? 0,
      notes: String(body.notes || "").trim() || null,
      tax_reserve_done: taxReserveDone,
      tax_reserve_done_at: taxReserveDone ? (body.tax_reserve_done_at || now) : null,
      consecrated_hands_done: consecratedHandsDone,
      consecrated_hands_done_at: consecratedHandsDone ? (body.consecrated_hands_done_at || now) : null,
      updated_at: now,
    };
    const { data, error } = await admin
      .from("show_financials")
      .upsert(payload, { onConflict: "show_id" })
      .select("*")
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

    return NextResponse.json({ ok: true, row: data, message: "Show financials saved." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Financial update failed." }, { status: 400 });
  }
}
