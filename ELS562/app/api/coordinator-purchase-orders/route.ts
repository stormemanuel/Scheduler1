import { withCoordinatorOrderDeadline, CoordinatorOrderRequestTimeout } from "@/lib/coordinator-order-request";
import { NextResponse } from "next/server";
import { getSessionUser, normalizeRole, canUsePage } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { getPayrollSummaryData } from "@/lib/payroll-data";
import { coordinatorOrderQuote, type CoordinatorOrderRow } from "@/lib/coordinator-purchase-order-types";
import { CoordinatorOrderError, coordinatorOrderFailure, coordinatorQuoteHash, newCoordinatorOrder, saveCoordinatorOrder, emailCoordinatorOrder, validateCoordinatorOrderEmail, reconcileCoordinatorOrder } from "@/lib/coordinator-purchase-orders";
export const runtime = "nodejs";
export const maxDuration = 300;
async function authorize() {
  const session = await getSessionUser();
  if (!session.user) throw new CoordinatorOrderError("Sign in to manage coordinator Purchase Orders.", 401);
  const role = normalizeRole(session.profile?.role);
  if (!["owner", "admin"].includes(role) || !canUsePage(role, session.access, "payroll")) throw new CoordinatorOrderError("Only owners and admins with Payroll access can manage coordinator Purchase Orders.", 403);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new CoordinatorOrderError("Supabase is not configured.", 503);
  return { admin, user: session.user };
}
function fail(error: unknown) { return NextResponse.json({ message: error instanceof Error ? error.message : "Coordinator Purchase Order request failed." }, { status: error instanceof CoordinatorOrderError ? error.status : 400 }); }
function yearValue(value: unknown) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2199) throw new CoordinatorOrderError("Select a valid Payroll year.");
  return year;
}
async function quoteFor(year: number, coordinatorId: string, showIds: string[]) {
  if (!coordinatorId || showIds.length < 1 || showIds.length > 25 || showIds.some((id) => !id.trim()) || new Set(showIds).size !== showIds.length) throw new CoordinatorOrderError("Select a coordinator and between 1 and 25 distinct shows.");
  let data;
  try {
    data = await withCoordinatorOrderDeadline(() => getPayrollSummaryData(year, { showIds, includeCoordinatorBookings: true }), 30_000, "The selected shows could not be verified within 30 seconds. Please retry Preview; no Purchase Order was created or sent.");
  } catch (error) {
    if (error instanceof CoordinatorOrderRequestTimeout) throw new CoordinatorOrderError(error.message, 504);
    throw error;
  }
  if (data.setupMissing || data.error) throw new CoordinatorOrderError(data.error || "Payroll could not be verified.", 503);
  return coordinatorOrderQuote(data.eventSummaries, coordinatorId, showIds);
}
export async function GET(request: Request) {
  try {
    const { admin } = await authorize();
    const year = yearValue(new URL(request.url).searchParams.get("year"));
    const result = await admin.from("coordinator_purchase_orders").select("*").eq("document->>year", String(year)).order("created_at", { ascending: false }).limit(200);
    if (result.error) throw coordinatorOrderFailure(result.error);
    const orders: CoordinatorOrderRow[] = [];
    for (const row of (result.data || []) as CoordinatorOrderRow[]) orders.push(await reconcileCoordinatorOrder(admin, row));
    return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const { admin, user } = await authorize();
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");
    const origin = String(process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
    if (action === "preview" || action === "create") {
      const year = yearValue(body.year), coordinatorId = String(body.coordinator_id || "").trim();
      const showIds = Array.isArray(body.show_ids) ? body.show_ids.map((id: unknown) => String(id)) : [];
      const net = Number(body.net_days || 30);
      if (net !== 15 && net !== 30) throw new CoordinatorOrderError("Choose Net 15 or Net 30.");
      const quote = await quoteFor(year, coordinatorId, showIds);
      const hash = coordinatorQuoteHash(quote, net);
      if (action === "preview") return NextResponse.json({ quote, hash });
      if (body.quote_hash !== hash) throw new CoordinatorOrderError("Amounts changed since preview. Preview the current amounts before creating the order.", 409);
      const profile = await admin.from("profiles").select("email").eq("id", coordinatorId).maybeSingle();
      if (profile.error) throw coordinatorOrderFailure(profile.error);
      let email = String(profile.data?.email || "").trim();
      if (!email) {
        const account = await admin.auth.admin.getUserById(coordinatorId);
        if (!account.error) email = account.data.user?.email || "";
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new CoordinatorOrderError("Save a valid email on this coordinator's user account first.");
      const document = newCoordinatorOrder(quote, email, net, year);
      const created = await admin.rpc("create_coordinator_purchase_order", { p_coordinator: coordinatorId, p_token: document.token, p_document: document, p_created_by: user.id, p_show_ids: showIds });
      if (created.error) throw coordinatorOrderFailure(created.error);
      const order = (Array.isArray(created.data) ? created.data[0] : created.data) as CoordinatorOrderRow;
      if (!order?.id) throw new CoordinatorOrderError("Purchase Order save was not confirmed. Reload the order list before retrying.", 503);
      return NextResponse.json({ order, message: "Combined coordinator Purchase Order created. Review it, then send for approval." });
    }
    if (!["send", "revise", "discard"].includes(action)) throw new CoordinatorOrderError("Unknown coordinator Purchase Order action.");
    const result = await admin.from("coordinator_purchase_orders").select("*").eq("id", String(body.id || "")).maybeSingle();
    if (result.error) throw coordinatorOrderFailure(result.error);
    let row = result.data as CoordinatorOrderRow | null;
    if (!row) throw new CoordinatorOrderError("Purchase Order not found.", 404);
    row = await reconcileCoordinatorOrder(admin, row);
    if (row.updated_at !== body.version) throw new CoordinatorOrderError("This Purchase Order changed. Refresh before continuing.", 409);
    if (action === "discard") {
      if (row.document.sentAt || !["ready", "revised", "delivery_failed"].includes(row.document.status)) throw new CoordinatorOrderError("Only a never-sent draft can be discarded.", 409);
      const removed = await admin.from("coordinator_purchase_orders").delete().eq("id", row.id).eq("updated_at", row.updated_at).select("id");
      if (removed.error) throw coordinatorOrderFailure(removed.error);
      if (!removed.data?.length) throw new CoordinatorOrderError("The order changed before it could be discarded.", 409);
      return NextResponse.json({ message: "Unsent draft discarded; its shows can be selected again." });
    }
    if (["approved", "auto_approved"].includes(row.document.status)) throw new CoordinatorOrderError("An approved Purchase Order cannot be revised or resent.", 409);
    const live = await quoteFor(row.document.year, row.coordinator_user_id, row.document.showLines.map((line) => line.showId));
    const hash = coordinatorQuoteHash(live, row.document.paymentTermsDays || 30);
    if (action === "revise") {
      const at = new Date().toISOString();
      const changed = hash !== row.document.quoteHash || row.document.status === "changes_requested";
      const document = { ...row.document, showLines: live.lines, quoteHash: hash, baseAmount: live.total, total: live.total, revision: row.document.revision + (row.document.sentAt || changed ? 1 : 0), status: "revised" as const, updatedAt: at, sentAt: null, deliveredAt: null, approvalDueAt: null, approvedAt: null, resendEmailId: null, reminderSentAt: null, audit: [...row.document.audit, { at, action: "revision_created", detail: "Refreshed from current coordinator pay for the same shows" }].slice(-60) };
      const order = await saveCoordinatorOrder(admin, row, document);
      return NextResponse.json({ order, message: "Current show amounts saved. Send the revision for approval." });
    }
    if (!["ready", "revised", "delivery_failed"].includes(row.document.status)) throw new CoordinatorOrderError("This revision is already awaiting approval. Refresh or revise it instead of sending a duplicate.", 409);
    if (hash !== row.document.quoteHash) throw new CoordinatorOrderError("A show's amount or payment status changed. Refresh the amounts before sending.", 409);
    const at = new Date().toISOString();
    validateCoordinatorOrderEmail(row);
    const claimed = await saveCoordinatorOrder(admin, row, { ...row.document, status: "sent_awaiting_delivery", sentAt: at, updatedAt: at, audit: [...row.document.audit, { at, action: "email_send_started" }].slice(-60) });
    try {
      const emailId = await emailCoordinatorOrder(claimed, origin);
      const order = await saveCoordinatorOrder(admin, claimed, { ...claimed.document, resendEmailId: emailId, lastDeliveryEvent: "sent", audit: [...claimed.document.audit, { at: new Date().toISOString(), action: "email_sent" }].slice(-60) });
      return NextResponse.json({ order, message: "One combined Purchase Order sent for approval. The 48-hour review begins on confirmed delivery." });
    } catch (error) {
      await saveCoordinatorOrder(admin, claimed, { ...claimed.document, status: "delivery_failed", lastDeliveryEvent: "failed", updatedAt: new Date().toISOString(), audit: [...claimed.document.audit, { at: new Date().toISOString(), action: "email_failed", detail: error instanceof Error ? error.message : "Email failed" }].slice(-60) }).catch(() => null);
      throw error;
    }
  } catch (error) { return fail(error); }
}
