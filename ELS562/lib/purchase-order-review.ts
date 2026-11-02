import type { ContractorPurchaseOrder } from "@/lib/payroll-calculations";

const REVIEW_MS = 48 * 60 * 60 * 1000;
const validTime = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

export function advancePurchaseOrderReview(original: ContractorPurchaseOrder, now = new Date(), confirmedDelivery = false): ContractorPurchaseOrder {
  if (!["sent_awaiting_delivery", "delivered"].includes(original.status)) return original;
  let po = original;
  const at = now.toISOString();
  // A contractor opening their secure link is also proof of receipt. Preserve
  // the first recorded opening rather than restarting the clock on each read.
  const openings = po.audit.filter((event) => event.action === "contractor_opened").map((event) => validTime(event.at)).filter((value): value is number => value !== null && value <= now.getTime());
  const deliveredMs = validTime(po.deliveredAt) ?? (openings.length ? Math.min(...openings) : confirmedDelivery ? now.getTime() : null);
  if (po.status === "sent_awaiting_delivery" && deliveredMs !== null) {
    const deliveredAt = new Date(deliveredMs).toISOString();
    const due = new Date(deliveredMs + REVIEW_MS).toISOString();
    po = { ...po, status: "delivered", deliveredAt, approvalDueAt: due, updatedAt: at, audit: [...po.audit, { at, action: "delivery_confirmed", detail: `Response due ${due}` }].slice(-60) };
  }
  if (po.status !== "delivered") return po;
  const dueMs = validTime(po.approvalDueAt) ?? (deliveredMs !== null ? deliveredMs + REVIEW_MS : null);
  if (dueMs === null) return po;
  if (validTime(po.approvalDueAt) === null) po = { ...po, approvalDueAt: new Date(dueMs).toISOString(), updatedAt: at };
  if (now.getTime() >= dueMs) {
    po = { ...po, status: "auto_approved", approvedAt: at, updatedAt: at, audit: [...po.audit, { at, action: "auto_approved", detail: "No response within 48 hours of confirmed delivery" }].slice(-60) };
  }
  return po;
}

// Catch up elapsed reviews on Payroll reads even if a background run was missed.
// This never sends mail, marks payroll paid, or assumes an unconfirmed delivery.
export async function refreshOverduePurchaseOrders(admin: NonNullable<ReturnType<typeof import("@/lib/supabase-server").createSupabaseAdminClient>>) {
  const { extractPurchaseOrderFromNotes, mergePurchaseOrderIntoNotes } = await import("@/lib/payroll-calculations");
  let refreshed = 0;
  for (let page = 0; page < 100; page++) {
    const result = await admin.from("show_payroll").select("id, notes").ilike("notes", "%ELS_PURCHASE_ORDER_V1%").order("id").range(page * 100, page * 100 + 99);
    if (result.error) {
      if (result.error.code === "42P01") return refreshed;
      throw new Error(result.error.message);
    }
    const rows = (result.data || []) as Array<{ id: string; notes: string }>;
    for (const row of rows) {
      const po = extractPurchaseOrderFromNotes(row.notes);
      if (!po) continue;
      const next = advancePurchaseOrderReview(po);
      if (next === po) continue;
      const update = await admin.from("show_payroll").update({ notes: mergePurchaseOrderIntoNotes(row.notes, next) }).eq("id", row.id).eq("notes", row.notes).select("id");
      if (update.error) throw new Error(update.error.message);
      refreshed += update.data?.length || 0;
    }
    if (rows.length < 100) return refreshed;
  }
  throw new Error("Purchase Order review scan exceeded its safe limit.");
}
