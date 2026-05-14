import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import { PAYROLL_STATUS_ROLE } from "@/lib/payroll-calculations";
import { getPayrollPageData } from "@/lib/payroll-data";

export const runtime = "nodejs";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function optionalMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Override amount must be a positive number or blank.");
  return Math.round(parsed * 100) / 100;
}


export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const yearParam = Number(url.searchParams.get("year") || "");
  const data = await getPayrollPageData(Number.isFinite(yearParam) ? yearParam : undefined);
  return NextResponse.json({ ok: true, ...data });
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

    const payload = {
      show_id: showId,
      crew_id: crewId,
      role_name: PAYROLL_STATUS_ROLE,
      pay_type: "Regular",
      paid: Boolean(body.paid),
      payout_override: optionalMoney(body.payout_override),
      notes: String(body.notes || "").trim() || null,
    };

    const { data, error } = await admin
      .from("show_payroll")
      .upsert(payload, { onConflict: "show_id,crew_id,role_name" })
      .select("id, show_id, crew_id, role_name, paid, payout_override, notes")
      .single();

    if (error) {
      if (error.message.includes('relation "show_payroll" does not exist')) {
        return NextResponse.json({ message: "Run supabase/payroll_status_migration.sql once, then try again." }, { status: 400 });
      }
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, row: data, message: "Payroll status updated." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Payroll update failed." }, { status: 400 });
  }
}
