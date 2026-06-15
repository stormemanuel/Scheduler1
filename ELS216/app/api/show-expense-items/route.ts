import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

type ExpensePayload = {
  id?: string;
  show_id?: string;
  category?: string;
  description?: string;
  amount?: unknown;
  tax_treatment?: string;
  receipt_status?: string;
  expense_date?: string | null;
  notes?: string;
};

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function money(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("Expense amount must be greater than 0.");
  return Math.round(parsed * 100) / 100;
}

function cleanDate(value: unknown) {
  const text = safeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

async function syncShowExpenseTotal(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string) {
  const { data, error } = await admin
    .from("show_expense_items")
    .select("amount")
    .eq("show_id", showId);
  if (error) throw new Error(error.message);
  const total = Math.round((data || []).reduce((sum, row) => sum + Number((row as { amount?: number | string | null }).amount || 0), 0) * 100) / 100;
  const now = new Date().toISOString();
  const upsert = await admin
    .from("show_financials")
    .upsert({ show_id: showId, expenses: total, updated_at: now }, { onConflict: "show_id" });
  if (upsert.error && !upsert.error.message.includes('relation "show_financials" does not exist')) throw new Error(upsert.error.message);
  return total;
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = (await request.json()) as ExpensePayload;
    const showId = safeText(body.show_id);
    const category = safeText(body.category);
    if (!showId) return NextResponse.json({ message: "Show is required." }, { status: 400 });
    if (!category) return NextResponse.json({ message: "Expense category is required." }, { status: 400 });

    const payload = {
      show_id: showId,
      category,
      description: safeText(body.description) || null,
      amount: money(body.amount),
      tax_treatment: safeText(body.tax_treatment) || "Likely deductible if ordinary and necessary",
      receipt_status: safeText(body.receipt_status) || "Receipt needed",
      expense_date: cleanDate(body.expense_date),
      notes: safeText(body.notes) || null,
      created_by: auth.user.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from("show_expense_items")
      .insert(payload)
      .select("id, show_id, category, description, amount, tax_treatment, receipt_status, expense_date, notes, created_by, created_at, updated_at")
      .single();
    if (error) {
      if (error.message.includes('relation "show_expense_items" does not exist')) {
        return NextResponse.json({ message: "Run supabase/show_expense_items_migration.sql once, then add expenses again." }, { status: 400 });
      }
      throw new Error(error.message);
    }
    const total_expenses = await syncShowExpenseTotal(admin, showId);
    return NextResponse.json({ ok: true, item: data, total_expenses, message: "Expense added and P&L total updated." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to save expense." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = (await request.json()) as ExpensePayload;
    const id = safeText(body.id);
    const showId = safeText(body.show_id);
    if (!id || !showId) return NextResponse.json({ message: "Expense id and show id are required." }, { status: 400 });

    const { error } = await admin.from("show_expense_items").delete().eq("id", id).eq("show_id", showId);
    if (error) {
      if (error.message.includes('relation "show_expense_items" does not exist')) {
        return NextResponse.json({ message: "Run supabase/show_expense_items_migration.sql once, then try again." }, { status: 400 });
      }
      throw new Error(error.message);
    }
    const total_expenses = await syncShowExpenseTotal(admin, showId);
    return NextResponse.json({ ok: true, total_expenses, message: "Expense removed and P&L total updated." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to remove expense." }, { status: 400 });
  }
}
