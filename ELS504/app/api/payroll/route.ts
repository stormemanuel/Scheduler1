import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import {
  PAYROLL_STATUS_ROLE,
  extractPurchaseOrderFromNotes,
  formatPayrollDate,
  mergePurchaseOrderIntoNotes,
  normalizePurchaseOrderAdjustments,
  normalizePurchaseOrderDays,
  purchaseOrderAdjustmentAmounts,
  purchaseOrderDayAmounts,
  purchaseOrderDisplayNumber,
  purchaseOrderTotal,
  stripPurchaseOrderFromNotes,
  type ContractorPurchaseOrder,
} from "@/lib/payroll-calculations";
import { getPayrollAvailableYears, getPayrollIndexData, getPayrollPageData, savePayrollSnapshotForShow } from "@/lib/payroll-data";
import type { PayrollPaymentStatus } from "@/lib/payroll-types";
import { canUsePage, getSessionUser, normalizeRole } from "@/lib/auth";

const COORDINATOR_PAYROLL_FALLBACK_ROLE = "__ELS_COORDINATOR_PAYROLL__";

// Payroll summary reads can span a large year. Give the route enough server time to
// finish instead of relying on a short platform/default execution window.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function resendApiKey() {
  return safeText(process.env.ELS_RESEND_API_KEY || process.env.RESEND_API_KEY);
}

function resendDomain() {
  return safeText(process.env.RESEND_EMAIL_DOMAIN || "emanuel-labor-services.com").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

function money(value: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}

async function createPurchaseOrderReference(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, yearValue: unknown) {
  const year = /^20\d{2}$/.test(String(yearValue || "")) ? String(yearValue) : String(new Date().getFullYear());
  const prefix = `ELS-PO-${year}-`;
  const result = await admin.from("show_payroll").select("notes").ilike("notes", "%ELS_PURCHASE_ORDER_V1%").limit(5000);
  if (result.error) throw result.error;
  const used = new Set(((result.data || []) as Array<{ notes?: string | null }>).map((row) => extractPurchaseOrderFromNotes(row.notes)?.referenceNumber || "").filter(Boolean));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${prefix}${crypto.randomInt(100000, 1000000)}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique Purchase Order number. Please try again.");
}

function purchaseOrderLines(po: ContractorPurchaseOrder) {
  const amounts = purchaseOrderAdjustmentAmounts(po.adjustments);
  const dayLines = po.days.flatMap((day) => {
    const dayAmounts = purchaseOrderDayAmounts(day);
    const date = formatPayrollDate(day.laborDate) || "Scheduled day";
    return [
      { label: `${date} — Default day pay`, detail: [day.description, day.note ? `Day note: ${day.note}` : ""].filter(Boolean).join(" · "), amount: dayAmounts.defaultAmount },
      dayAmounts.overtime > 0 ? { label: `${date} — Overtime`, detail: `${day.overtimeHours} hr × ${money(day.overtimeRate)}`, amount: dayAmounts.overtime } : null,
      dayAmounts.doubleTime > 0 ? { label: `${date} — Double time`, detail: `${day.doubleTimeHours} hr × ${money(day.doubleTimeRate)}`, amount: dayAmounts.doubleTime } : null,
    ];
  });
  return [
    ...(po.days.length ? dayLines : [{ label: "Base show pay", detail: "", amount: po.baseAmount }]),
    !po.days.length && amounts.overtime > 0 ? { label: "Overtime", detail: `${po.adjustments.overtimeHours} hr × ${money(po.adjustments.overtimeRate)}`, amount: amounts.overtime } : null,
    !po.days.length && amounts.doubleTime > 0 ? { label: "Double time", detail: `${po.adjustments.doubleTimeHours} hr × ${money(po.adjustments.doubleTimeRate)}`, amount: amounts.doubleTime } : null,
    amounts.mealPenalty > 0 ? { label: "Meal penalty", detail: `${po.adjustments.mealPenaltyCount} occurrence${po.adjustments.mealPenaltyCount === 1 ? "" : "s"} × ${money(po.adjustments.mealPenaltyRate)}`, amount: amounts.mealPenalty } : null,
    amounts.shortTurn > 0 ? { label: "Under-8-hour turnaround", detail: `${po.adjustments.shortTurnHours} hr × ${money(po.adjustments.shortTurnRate)}`, amount: amounts.shortTurn } : null,
    amounts.other > 0 ? { label: po.adjustments.otherDescription || "Other adjustment", detail: "", amount: amounts.other } : null,
    amounts.lateDeduction > 0 ? { label: "Late arrival deduction", detail: `${po.adjustments.lateHours} hr × ${money(po.adjustments.lateHourlyRate)}`, amount: -amounts.lateDeduction } : null,
    amounts.negativeAdjustment > 0 ? { label: po.adjustments.negativeDescription || "Negative adjustment", detail: "Deduction", amount: -amounts.negativeAdjustment } : null,
  ].filter((line): line is { label: string; detail: string; amount: number } => Boolean(line));
}

async function sendPurchaseOrderEmail(args: { to: string; crewName: string; showName: string; showClient: string; showVenue: string; showDates: string; link: string; po: ContractorPurchaseOrder }) {
  const apiKey = resendApiKey();
  const domain = resendDomain();
  if (!apiKey) throw new Error("ELS_RESEND_API_KEY is not configured in Vercel.");
  if (!domain) throw new Error("RESEND_EMAIL_DOMAIN is not configured in Vercel.");
  if (!/^\S+@\S+\.\S+$/.test(args.to)) throw new Error("Contractor does not have a valid email address.");
  const displayNumber = purchaseOrderDisplayNumber(args.po);
  const lines = purchaseOrderLines(args.po);
  const rows = lines.map((line) => `<tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>${escapeHtml(line.label)}</strong>${line.detail ? `<br><span style="color:#64748b">${escapeHtml(line.detail)}</span>` : ""}</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right${line.amount < 0 ? ";color:#b42318;font-weight:bold" : ""}">${escapeHtml(money(line.amount))}</td></tr>`).join("");
  const textLines = lines.map((line) => `${line.label}${line.detail ? ` (${line.detail})` : ""}: ${money(line.amount)}`).join("\n");
  const notice = "Please review this purchase order and either approve it or request changes within 48 hours. If no response is received within 48 hours of delivery, the purchase order will be recorded as approved and payment will be processed for the stated amount.";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `Emanuel Labor Services <payroll@${domain}>`,
      reply_to: `info@${domain}`,
      to: [args.to],
      subject: `${displayNumber} — ${args.showName} — ${money(args.po.total)}`,
      text: `Hello ${args.crewName},\n\nPurchase Order ${displayNumber} for ${args.showName}.\n${args.showClient}${args.showVenue ? ` · ${args.showVenue}` : ""}\n${args.showDates}\n\n${textLines}\nTotal: ${money(args.po.total)}\n\n${notice}\n\nReview: ${args.link}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#172033"><h2>Emanuel Labor Services Purchase Order</h2><p style="font-weight:bold;color:#0f5f3d">${escapeHtml(displayNumber)}</p><p>Hello ${escapeHtml(args.crewName)},</p><p><strong>${escapeHtml(args.showName)}</strong><br>${escapeHtml(args.showClient)}${args.showVenue ? ` · ${escapeHtml(args.showVenue)}` : ""}<br>${escapeHtml(args.showDates)}</p><table style="width:100%;border-collapse:collapse">${rows}<tr><td style="padding:12px 8px;font-size:18px"><strong>Total</strong></td><td style="padding:12px 8px;text-align:right;font-size:18px"><strong>${escapeHtml(money(args.po.total))}</strong></td></tr></table><p style="background:#fff7d6;border-left:4px solid #d4a62a;padding:12px">${escapeHtml(notice)}</p><p><a href="${escapeHtml(args.link)}" style="display:inline-block;background:#0f5f3d;color:white;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Review Purchase Order</a></p></div>`,
    }),
  });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok || !result.id) throw new Error(result.message || `Resend returned HTTP ${response.status}.`);
  return result.id;
}

async function existingPayrollRow(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, showId: string, crewId: string) {
  const result = await (admin.from("show_payroll") as any).select("id,show_id,crew_id,role_name,paid,payment_status,payout_override,notes,scheduled_for").eq("show_id", showId).eq("crew_id", crewId).eq("role_name", PAYROLL_STATUS_ROLE).limit(1).maybeSingle();
  if (result.error) throw result.error;
  return result.data as Record<string, unknown> | null;
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

async function payrollSnapshotMessage(showId: string, source: string) {
  try {
    const snapshot = await savePayrollSnapshotForShow(showId, { source });
    if (!snapshot.ok) return ` Payroll snapshot was not refreshed: ${snapshot.message}`;
    return snapshot.skipped ? "" : " Payroll snapshot refreshed.";
  } catch (error) {
    return ` Payroll snapshot was not refreshed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session.user) return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  const role = normalizeRole(session.profile?.role);
  if (!canUsePage(role, session.access, "payroll")) {
    return NextResponse.json({ message: "Payroll access is not enabled for this user." }, { status: 403 });
  }

  const url = new URL(request.url);
  const rawYear = Number(url.searchParams.get("year"));
  const fallbackYear = Number.isFinite(rawYear) && rawYear > 1900 && rawYear < 3000 ? Math.trunc(rawYear) : new Date().getFullYear();

  if (url.searchParams.get("mode") === "years") {
    let availableYears = [fallbackYear];
    try {
      availableYears = await getPayrollAvailableYears();
    } catch {
      availableYears = [fallbackYear];
    }
    return NextResponse.json({ availableYears }, { headers: { "Cache-Control": "private, max-age=60" } });
  }

  const mode = String(url.searchParams.get("mode") || "summary");
  const showId = String(url.searchParams.get("show_id") || "").trim();
  try {
    const data = mode === "event"
      ? await getPayrollPageData(fallbackYear, { showId })
      : mode === "event-summary"
        ? await getPayrollPageData(fallbackYear, { showId, summaryOnly: true })
        : mode === "index"
          ? await getPayrollIndexData(fallbackYear)
          : mode === "tax"
            ? await getPayrollPageData(fallbackYear)
            : await getPayrollIndexData(fallbackYear);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load payroll data.";
    return NextResponse.json({
      eventSummaries: [],
      crewRows: [],
      availableYears: [fallbackYear],
      loadedYear: fallbackYear,
      setupMissing: false,
      error: `Payroll data could not be loaded: ${message}`,
    }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = await request.json();
    const showId = String(body.show_id || "").trim();
    const action = safeText(body.action);

    if (action === "save_purchase_order" || action === "send_purchase_orders") {
      const session = await getSessionUser();
      const role = normalizeRole(session.profile?.role);
      if (!session.user || (role !== "owner" && role !== "admin")) {
        return NextResponse.json({ message: "Only owner/admin can prepare or send contractor purchase orders." }, { status: 403 });
      }
      if (!showId) return NextResponse.json({ message: "Show is required." }, { status: 400 });

      if (action === "save_purchase_order") {
        const crewId = safeText(body.crew_id);
        if (!crewId) return NextResponse.json({ message: "Crew member is required." }, { status: 400 });
        const currentRow = await existingPayrollRow(admin, showId, crewId);
        const currentNotes = safeText(currentRow?.notes);
        const existing = extractPurchaseOrderFromNotes(currentNotes);
        const adjustments = normalizePurchaseOrderAdjustments(body.adjustments);
        const days = normalizePurchaseOrderDays(body.days);
        if (adjustments.negativeAmount > 0 && !adjustments.negativeDescription) {
          return NextResponse.json({ message: "Enter a reason for the negative adjustment." }, { status: 400 });
        }
        const requestedBaseAmount = optionalMoney(body.base_amount) ?? existing?.baseAmount ?? optionalMoney(currentRow?.payout_override) ?? 0;
        const baseAmount = days.length ? Math.round(days.reduce((sum, day) => sum + day.defaultAmount, 0) * 100) / 100 : requestedBaseAmount;
        const total = purchaseOrderTotal(baseAmount, adjustments, days);
        const now = new Date().toISOString();
        const contentChanged = !existing || existing.baseAmount !== baseAmount || JSON.stringify(existing.days) !== JSON.stringify(days) || JSON.stringify(existing.adjustments) !== JSON.stringify(adjustments);
        const lockedStatus = existing && !["draft", "ready", "revised", "delivery_failed"].includes(existing.status);
        const revision = existing ? (contentChanged && lockedStatus ? existing.revision + 1 : existing.revision) : 1;
        const token = existing && !(contentChanged && lockedStatus) ? existing.token : crypto.randomBytes(24).toString("base64url");
        const referenceNumber = existing?.referenceNumber || await createPurchaseOrderReference(admin, days[0]?.laborDate.slice(0, 4));
        const nextStatus = contentChanged && existing && lockedStatus ? "revised" : existing && lockedStatus ? existing.status : "ready";
        const preserveDelivery = Boolean(existing && lockedStatus && !contentChanged);
        const purchaseOrder: ContractorPurchaseOrder = {
          version: 1,
          token,
          referenceNumber,
          revision,
          status: nextStatus,
          baseAmount,
          days,
          adjustments,
          total,
          createdAt: existing && revision === existing.revision ? existing.createdAt : now,
          updatedAt: now,
          sentAt: preserveDelivery ? existing?.sentAt ?? null : null,
          deliveredAt: preserveDelivery ? existing?.deliveredAt ?? null : null,
          approvalDueAt: preserveDelivery ? existing?.approvalDueAt ?? null : null,
          reminderSentAt: preserveDelivery ? existing?.reminderSentAt ?? null : null,
          approvedAt: preserveDelivery ? existing?.approvedAt ?? null : null,
          changeRequestedAt: existing?.changeRequestedAt ?? null,
          changeRequest: existing?.changeRequest ?? "",
          resendEmailId: preserveDelivery ? existing?.resendEmailId ?? null : null,
          lastDeliveryEvent: preserveDelivery ? existing?.lastDeliveryEvent ?? null : null,
          audit: [...(existing?.audit ?? []), { at: now, action: existing ? (revision > existing.revision ? "revision_created" : "draft_updated") : "draft_created", detail: `${referenceNumber}-R${revision} total ${money(total)}` }].slice(-60),
        };
        const paymentStatus = normalizePaymentStatus(currentRow?.payment_status, Boolean(currentRow?.paid), safeText(currentRow?.scheduled_for) || null);
        const payload: PayrollPayload = {
          show_id: showId,
          crew_id: crewId,
          role_name: PAYROLL_STATUS_ROLE,
          pay_type: "Regular",
          paid: paymentStatus === "paid",
          payment_status: paymentStatus,
          payout_override: total,
          notes: mergePurchaseOrderIntoNotes(currentNotes, purchaseOrder),
          scheduled_for: safeText(currentRow?.scheduled_for) || null,
        };
        const { data } = await upsertWithSchemaFallback(admin, payload);
        return NextResponse.json({ ok: true, purchase_order: purchaseOrder, row: { ...publicRow(data, payload), notes: stripPurchaseOrderFromNotes(data.notes) }, message: `${purchaseOrderDisplayNumber(purchaseOrder)} saved and ready to send.` });
      }

      const crewIds: string[] = Array.isArray(body.crew_ids) ? [...new Set<string>(body.crew_ids.map((value: unknown) => safeText(value)).filter(Boolean))] : [];
      if (!crewIds.length) return NextResponse.json({ message: "Select at least one contractor." }, { status: 400 });
      const [showResult, crewResult] = await Promise.all([
        admin.from("shows").select("id,name,client,venue,show_start,show_end").eq("id", showId).maybeSingle(),
        admin.from("crew").select("id,name,email").in("id", crewIds),
      ]);
      if (showResult.error) throw showResult.error;
      if (!showResult.data) return NextResponse.json({ message: "Show not found." }, { status: 404 });
      if (crewResult.error) throw crewResult.error;
      const show = showResult.data as { name?: string | null; client?: string | null; venue?: string | null; show_start?: string | null; show_end?: string | null };
      const crewById = new Map(((crewResult.data || []) as Array<{ id: string; name?: string | null; email?: string | null }>).map((crew) => [crew.id, crew]));
      const origin = new URL(request.url).origin;
      const results: Array<{ crew_id: string; ok: boolean; message: string; purchase_order?: ContractorPurchaseOrder }> = [];
      for (const crewId of crewIds) {
        const crew = crewById.get(crewId);
        const currentRow = await existingPayrollRow(admin, showId, crewId);
        const currentNotes = safeText(currentRow?.notes);
        const existing = extractPurchaseOrderFromNotes(currentNotes);
        if (!existing) {
          results.push({ crew_id: crewId, ok: false, message: "Save this contractor's Purchase Order before sending." });
          continue;
        }
        if (!["draft", "ready", "revised", "delivery_failed"].includes(existing.status)) {
          results.push({ crew_id: crewId, ok: false, message: existing.status === "changes_requested" ? "The contractor requested changes. Update the Purchase Order to create a new revision before sending again." : `Revision ${existing.revision} is already ${existing.status.replace(/_/g, " ")}. Edit it to create a new revision before sending again.` });
          continue;
        }
        const now = new Date().toISOString();
        const prepared: ContractorPurchaseOrder = existing.referenceNumber ? existing : {
          ...existing,
          referenceNumber: await createPurchaseOrderReference(admin, existing.days[0]?.laborDate.slice(0, 4)),
          audit: [...existing.audit, { at: now, action: "reference_assigned" }].slice(-60),
        };
        let next: ContractorPurchaseOrder = { ...prepared };
        try {
          const emailId = await sendPurchaseOrderEmail({
            to: safeText(crew?.email),
            crewName: safeText(crew?.name) || "Contractor",
            showName: safeText(show.name) || "Event",
            showClient: safeText(show.client),
            showVenue: safeText(show.venue),
            showDates: [safeText(show.show_start), safeText(show.show_end)].filter(Boolean).join(" to "),
            link: `${origin}/onboarding/${encodeURIComponent(prepared.token)}`,
            po: prepared,
          });
          next = { ...prepared, status: "sent_awaiting_delivery", updatedAt: now, sentAt: now, deliveredAt: null, approvalDueAt: null, reminderSentAt: null, approvedAt: null, resendEmailId: emailId, lastDeliveryEvent: "sent", audit: [...prepared.audit, { at: now, action: "email_sent", detail: `Resend email ${emailId}; delivery confirmation pending` }].slice(-60) };
          results.push({ crew_id: crewId, ok: true, message: "Sent; waiting for confirmed delivery before the 48-hour clock begins.", purchase_order: next });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Email delivery failed.";
          next = { ...prepared, status: "delivery_failed", updatedAt: now, sentAt: null, deliveredAt: null, approvalDueAt: null, resendEmailId: null, lastDeliveryEvent: "failed", audit: [...prepared.audit, { at: now, action: "delivery_failed", detail: errorMessage }].slice(-60) };
          results.push({ crew_id: crewId, ok: false, message: errorMessage, purchase_order: next });
        }
        const paymentStatus = normalizePaymentStatus(currentRow?.payment_status, Boolean(currentRow?.paid), safeText(currentRow?.scheduled_for) || null);
        await upsertWithSchemaFallback(admin, {
          show_id: showId, crew_id: crewId, role_name: PAYROLL_STATUS_ROLE, pay_type: "Regular",
          paid: paymentStatus === "paid", payment_status: paymentStatus, payout_override: prepared.total,
          notes: mergePurchaseOrderIntoNotes(currentNotes, next), scheduled_for: safeText(currentRow?.scheduled_for) || null,
        });
      }
      const sent = results.filter((result) => result.ok).length;
      return NextResponse.json({ ok: sent > 0, sent, failed: results.length - sent, results, message: `${sent} Purchase Order${sent === 1 ? "" : "s"} sent; ${results.length - sent} not sent.` }, { status: sent > 0 ? 200 : 400 });
    }

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
        return NextResponse.json({ ok: true, row: publicCoordinatorRow(data, payload), message: `Coordinator payroll status updated.${await payrollSnapshotMessage(showId, "coordinator_payroll_update")}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
        if (message.includes('relation "coordinator_payroll" does not exist')) {
          const fallbackRow = await upsertCoordinatorFallbackWithSchemaFallback(admin, payload);
          return NextResponse.json({ ok: true, row: fallbackRow, message: `Coordinator payroll status updated.${await payrollSnapshotMessage(showId, "coordinator_payroll_update")}` });
        }
        throw error;
      }
    }

    const crewId = String(body.crew_id || "").trim();
    if (!showId || !crewId) return NextResponse.json({ message: "Show and crew are required." }, { status: 400 });

    const scheduledFor = optionalDate(body.scheduled_for);
    const paymentStatus = normalizePaymentStatus(body.payment_status, Boolean(body.paid), scheduledFor);
    const currentRow = await existingPayrollRow(admin, showId, crewId);
    const payload: PayrollPayload = {
      show_id: showId,
      crew_id: crewId,
      role_name: PAYROLL_STATUS_ROLE,
      pay_type: "Regular",
      paid: paymentStatus === "paid",
      payment_status: paymentStatus,
      payout_override: optionalMoney(body.payout_override),
      notes: mergePurchaseOrderIntoNotes(String(body.notes || "").trim(), extractPurchaseOrderFromNotes(currentRow?.notes)) || null,
      scheduled_for: scheduledFor,
    };

    const { data, missing } = await upsertWithSchemaFallback(admin, payload);
    const message = missing.length
      ? `Payroll updated. Run the latest ELS127 SQL to fully enable: ${missing.join(", ")}.`
      : "Payroll status updated.";
    return NextResponse.json({ ok: true, row: { ...publicRow(data, payload), notes: stripPurchaseOrderFromNotes(data.notes) }, message: `${message}${await payrollSnapshotMessage(showId, "crew_payroll_update")}` });
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
