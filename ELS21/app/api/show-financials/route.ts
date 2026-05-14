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

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = await request.json();
    const showId = String(body.show_id || "").trim();
    if (!showId) return NextResponse.json({ message: "Show is required." }, { status: 400 });
    const payload = {
      show_id: showId,
      estimated_revenue_override: moneyOrNull(body.estimated_revenue_override),
      expenses: moneyOrNull(body.expenses) ?? 0,
      notes: String(body.notes || "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await admin
      .from("show_financials")
      .upsert(payload, { onConflict: "show_id" })
      .select("show_id, estimated_revenue_override, expenses, notes")
      .single();

    if (error) {
      if (error.message.includes('relation "show_financials" does not exist')) {
        return NextResponse.json({ message: "Run supabase/show_financials_migration.sql once, then try again." }, { status: 400 });
      }
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, row: data, message: "Show financials saved." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Financial update failed." }, { status: 400 });
  }
}
