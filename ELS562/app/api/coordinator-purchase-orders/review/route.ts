import { getSessionUser, normalizeRole, canUsePage } from "@/lib/auth";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { CoordinatorOrderError, coordinatorOrderFailure, publicCoordinatorOrder, reconcileCoordinatorOrder, saveCoordinatorOrder } from "@/lib/coordinator-purchase-orders";
import type { CoordinatorOrderRow } from "@/lib/coordinator-purchase-order-types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function fail(error: unknown) { return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to open this Purchase Order." }, { status: error instanceof CoordinatorOrderError ? error.status : 400, headers: { "Cache-Control": "no-store" } }); }
async function lookup(token: string) {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) throw new CoordinatorOrderError("This Purchase Order link is invalid.", 404);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new CoordinatorOrderError("Purchase Order service is unavailable.", 503);
  const result = await admin.from("coordinator_purchase_orders").select("*").eq("token", token).maybeSingle();
  if (result.error) throw coordinatorOrderFailure(result.error);
  if (!result.data) throw new CoordinatorOrderError("This Purchase Order link is invalid or was discarded.", 404);
  return { admin, row: result.data as CoordinatorOrderRow };
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const preview = params.get("preview") === "1";
    if (preview) {
      const session = await getSessionUser();
      const role = normalizeRole(session.profile?.role);
      if (!session.user || !["owner", "admin"].includes(role) || !canUsePage(role, session.access, "payroll")) throw new CoordinatorOrderError("Sign in as an owner/admin to preview this document.", 403);
    }
    const { admin, row } = await lookup(params.get("token") || "");
    const current = await reconcileCoordinatorOrder(admin, row, !preview);
    return NextResponse.json({ order: publicCoordinatorOrder(current) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { admin, row } = await lookup(String(body.token || ""));
    const current = await reconcileCoordinatorOrder(admin, row);
    if (body.revision !== current.document.revision || body.version !== current.updated_at) throw new CoordinatorOrderError("The Purchase Order changed or its review deadline passed. Refresh before responding.", 409);
    if (!["sent_awaiting_delivery", "delivered"].includes(current.document.status)) throw new CoordinatorOrderError("This Purchase Order is no longer awaiting a response.", 409);
    if (!["approve", "request_changes"].includes(body.action)) throw new CoordinatorOrderError("Choose approve or request changes.");
    const changeRequest = String(body.change_request || "").trim();
    if (body.action === "request_changes" && (!changeRequest || changeRequest.length > 2000)) throw new CoordinatorOrderError("Describe the requested changes using 1 to 2,000 characters.");
    const at = new Date().toISOString();
    const document = { ...current.document, updatedAt: at, ...(body.action === "approve" ? { status: "approved" as const, approvedAt: at } : { status: "changes_requested" as const, changeRequest, changeRequestedAt: at }), audit: [...current.document.audit, { at, action: body.action === "approve" ? "contractor_approved" : "changes_requested", detail: body.action === "approve" ? `Revision ${current.document.revision}` : changeRequest }].slice(-60) };
    const saved = await saveCoordinatorOrder(admin, current, document);
    return NextResponse.json({ order: publicCoordinatorOrder(saved), message: body.action === "approve" ? "Combined Purchase Order approved. Thank you." : "Your change request was sent to ELS." });
  } catch (error) { return fail(error); }
}
