import { createHash, randomBytes, randomUUID } from "crypto";
import type { CoordinatorOrder, CoordinatorOrderQuote, CoordinatorOrderRow } from "@/lib/coordinator-purchase-order-types";
import { normalizePurchaseOrderAdjustments } from "@/lib/payroll-calculations";
import { advancePurchaseOrderReview } from "@/lib/purchase-order-review";
type Admin = NonNullable<ReturnType<typeof import("@/lib/supabase-server").createSupabaseAdminClient>>;
export class CoordinatorOrderError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function coordinatorOrderFailure(error: { code?: string; message?: string }) {
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(error.code || "")) return new CoordinatorOrderError("Run supabase/coordinator_purchase_orders.sql in Supabase to enable combined coordinator Purchase Orders.", 503);
  if (error.code === "23505") return new CoordinatorOrderError("One of these shows is already on a Purchase Order for this coordinator. Open the existing order or discard its unsent draft first.", 409);
  return new CoordinatorOrderError(error.message || "Coordinator Purchase Order could not be saved.");
}
export function coordinatorQuoteHash(quote: CoordinatorOrderQuote, netDays: 15 | 30) { return createHash("sha256").update(JSON.stringify({ ...quote, netDays })).digest("hex"); }
export function newCoordinatorOrder(quote: CoordinatorOrderQuote, email: string, netDays: 15 | 30, year: number): CoordinatorOrder {
  const at = new Date().toISOString();
  return { kind: "coordinator", version: 1, token: randomBytes(32).toString("base64url"), referenceNumber: `ELS-CPO-${year}-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`, revision: 1, status: "ready", coordinatorUserId: quote.coordinatorUserId, coordinatorName: quote.coordinatorName, coordinatorEmail: email, showLines: quote.lines, quoteHash: coordinatorQuoteHash(quote, netDays), year, paymentTermsDays: netDays, baseAmount: quote.total, total: quote.total, days: [], adjustments: normalizePurchaseOrderAdjustments({}), createdAt: at, updatedAt: at, sentAt: null, deliveredAt: null, approvalDueAt: null, approvedAt: null, reminderSentAt: null, resendEmailId: null, changeRequest: "", audit: [{ at, action: "draft_created", detail: `${quote.lines.length} shows` }] };
}
export async function saveCoordinatorOrder(admin: Admin, row: CoordinatorOrderRow, document: CoordinatorOrder) {
  const result = await admin.from("coordinator_purchase_orders").update({ document, updated_at: new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString() }).eq("id", row.id).eq("updated_at", row.updated_at).select("*").maybeSingle();
  if (result.error) throw coordinatorOrderFailure(result.error);
  if (!result.data) throw new CoordinatorOrderError("This Purchase Order changed. Refresh before continuing.", 409);
  return result.data as CoordinatorOrderRow;
}
export function publicCoordinatorOrder(row: CoordinatorOrderRow) {
  const po = row.document;
  return { id: row.id, version: row.updated_at, referenceNumber: po.referenceNumber, revision: po.revision, coordinatorName: po.coordinatorName, status: po.status, showLines: po.showLines, total: po.total, paymentTermsDays: po.paymentTermsDays || 30, sentAt: po.sentAt || null, deliveredAt: po.deliveredAt || null, approvalDueAt: po.approvalDueAt || null, approvedAt: po.approvedAt || null, changeRequest: po.changeRequest || "" };
}
export type PublicCoordinatorOrder = ReturnType<typeof publicCoordinatorOrder>;
export async function reconcileCoordinatorOrder(admin: Admin, row: CoordinatorOrderRow, opened = false) {
  let document = row.document;
  if (opened && ["sent_awaiting_delivery", "delivered"].includes(document.status) && !document.audit.some((event) => event.action === "contractor_opened")) {
    const at = new Date().toISOString();
    document = { ...document, updatedAt: at, audit: [...document.audit, { at, action: "contractor_opened" }].slice(-60) };
  }
  document = advancePurchaseOrderReview(document) as CoordinatorOrder;
  return document === row.document ? row : saveCoordinatorOrder(admin, row, document);
}
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
export function coordinatorOrderEmail(row: CoordinatorOrderRow, origin: string, reminder = false) {
  const po = row.document, net = po.paymentTermsDays || 30;
  const link = `${origin}/coordinator-purchase-order/${encodeURIComponent(row.token)}`;
  const notice = `Please approve this coordinator Purchase Order or request changes within 48 hours of delivery. If no response is received, it will be recorded as approved. Payment terms are Net ${net}. The approved amount will be scheduled for payment within ${net} days.`;
  const lines = po.showLines.map((line) => `${line.showName} (${line.showStart} to ${line.showEnd}): ${money(line.amount)}`).join("\n");
  return { subject: `${reminder ? "Reminder: " : ""}Coordinator Purchase Order ${po.referenceNumber}-R${po.revision}`, text: `Hello ${po.coordinatorName},\n\n${reminder ? "Your approval is still needed.\n\n" : ""}${lines}\n\nTotal: ${money(po.total)}\n\n${notice}\n\nReview: ${link}`, html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto"><h2>Coordinator Purchase Order</h2><p>${escape(po.referenceNumber)}-R${po.revision}</p><p>Hello ${escape(po.coordinatorName)},</p>${reminder ? "<p>Your approval is still needed.</p>" : ""}<table style="width:100%">${po.showLines.map((line) => `<tr><td>${escape(line.showName)}<br>${escape(line.showStart)} to ${escape(line.showEnd)}</td><td style="text-align:right">${escape(money(line.amount))}</td></tr>`).join("")}<tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${escape(money(po.total))}</strong></td></tr></table><p>${escape(notice)}</p><p><a href="${escape(link)}">Review Purchase Order</a></p></div>` };
}
function providerConfig() {
  const key = process.env.ELS_RESEND_API_KEY || process.env.RESEND_API_KEY;
  const domain = String(process.env.RESEND_EMAIL_DOMAIN || "emanuel-labor-services.com").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!key) throw new CoordinatorOrderError("Configure the Resend email key before sending coordinator Purchase Orders.", 503);
  return { key, domain };
}
export function validateCoordinatorOrderEmail(row: CoordinatorOrderRow) {
  providerConfig();
  if (!/^\S+@\S+\.\S+$/.test(row.document.coordinatorEmail)) throw new CoordinatorOrderError("The coordinator needs a valid saved email address.");
}
export async function emailCoordinatorOrder(row: CoordinatorOrderRow, origin: string, reminder = false) {
  validateCoordinatorOrderEmail(row);
  const { key, domain } = providerConfig();
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `coordinator-po:${row.id}:r${row.document.revision}${reminder ? ":reminder24" : ""}` }, body: JSON.stringify({ from: `Emanuel Labor Services <payroll@${domain}>`, reply_to: `info@${domain}`, to: [row.document.coordinatorEmail], ...coordinatorOrderEmail(row, origin, reminder) }) });
  const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok || !result.id) throw new CoordinatorOrderError(result.message || "Coordinator Purchase Order email could not be sent.");
  return result.id;
}
export async function processCoordinatorPurchaseOrders(admin: Admin, origin: string) {
  const rows: CoordinatorOrderRow[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    let query = admin.from("coordinator_purchase_orders").select("*").in("document->>status", ["sent_awaiting_delivery", "delivered"]).order("id").limit(100);
    if (cursor) query = query.gt("id", cursor);
    const result = await query;
    if (result.error) {
      // Preserve the existing cron while new environments await migration.
      if (["42P01", "PGRST205"].includes(result.error.code || "")) return { checked: 0, approved: 0, failed: 0, setupMissing: true };
      throw coordinatorOrderFailure(result.error);
    }
    const batch = (result.data || []) as CoordinatorOrderRow[];
    rows.push(...batch);
    if (batch.length < 100) break;
    cursor = batch[batch.length - 1].id;
    if (page === 99) throw new CoordinatorOrderError("Coordinator review scan exceeded its safe limit.", 503);
  }
  let approved = 0, failed = 0;
  for (const original of rows) {
    try {
      let row = original, document = row.document;
      if (document.status === "sent_awaiting_delivery" && document.resendEmailId) {
        const { key } = providerConfig();
        const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(document.resendEmailId)}`, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
        if (!response.ok) throw new Error("Delivery status is unavailable.");
        const result = await response.json() as { last_event?: string };
        const event = String(result.last_event || "").toLowerCase();
        if (["delivered", "opened", "clicked"].includes(event)) document = { ...advancePurchaseOrderReview(document, new Date(), true), lastDeliveryEvent: event } as CoordinatorOrder;
        else if (["failed", "bounced", "complained", "canceled"].includes(event)) document = { ...document, status: "delivery_failed", lastDeliveryEvent: event, approvalDueAt: null, updatedAt: new Date().toISOString() };
        if (document !== row.document) row = await saveCoordinatorOrder(admin, row, document);
      }
      row = await reconcileCoordinatorOrder(admin, row);
      if (row.document.status === "auto_approved") approved++;
      const delivered = Date.parse(row.document.deliveredAt || "");
      if (row.document.status === "delivered" && Number.isFinite(delivered) && Date.now() >= delivered + 24 * 60 * 60 * 1000 && !row.document.reminderSentAt) {
        await emailCoordinatorOrder(row, origin, true);
        const at = new Date().toISOString();
        await saveCoordinatorOrder(admin, row, { ...row.document, reminderSentAt: at, updatedAt: at, audit: [...row.document.audit, { at, action: "24_hour_reminder_sent" }].slice(-60) });
      }
    } catch { failed++; }
  }
  return { checked: rows.length, approved, failed };
}
