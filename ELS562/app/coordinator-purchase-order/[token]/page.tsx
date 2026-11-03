"use client";
import { use, useEffect, useState } from "react";
import type { PublicCoordinatorOrder } from "@/lib/coordinator-purchase-orders";
const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
export default function CoordinatorOrderReview({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [order, setOrder] = useState<PublicCoordinatorOrder | null>(null), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [isPreview, setIsPreview] = useState(false);
  const [changes, setChanges] = useState(""), [saving, setSaving] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();setError("");setOrder(null);
    const preview = new URL(window.location.href).searchParams.get("preview") === "1"; setIsPreview(preview);
    fetch(`/api/coordinator-purchase-orders/review?token=${encodeURIComponent(token)}${preview ? "&preview=1" : ""}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to open the Purchase Order.");
      if (!controller.signal.aborted) setOrder(result.order);
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [token, reload]);
  async function respond(action: "approve" | "request_changes") {
    if (!order) return;
    setSaving(true);setError("");setMessage("");
    try {
      const response = await fetch("/api/coordinator-purchase-orders/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, revision: order.revision, version: order.version, action, change_request: changes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to save your response.");
      setOrder(result.order);setMessage(result.message);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save your response."); }
    finally { setSaving(false); }
  }
  const awaiting = order && ["sent_awaiting_delivery", "delivered"].includes(order.status);
  return <section className="card" style={{ maxWidth: 780, margin: "20px auto" }}>
    <h1>Coordinator Purchase Order</h1>
    {error ? <p className="error" role="alert">{error} <button type="button" className="ghost" disabled={saving} onClick={() => setReload((value) => value + 1)}>Refresh</button></p> : null}
    {message ? <p className="success" role="status">{message}</p> : null}
    {!order && !error ? <p>Loading your Purchase Order…</p> : null}
    {order ? <>
      <strong>{order.referenceNumber}-R{order.revision}</strong><p>Hello {order.coordinatorName}, please review the coordinator pay for these shows.</p>
      <div className="mobile-table" style={{ overflowX: "auto" }}><table style={{ width: "100%" }}><thead><tr><th style={{ textAlign: "left" }}>Show</th><th>Coordinator pay</th></tr></thead><tbody>{order.showLines.map((line) => <tr key={line.showId}><td style={{ padding: "12px 0" }}><strong>{line.showName}</strong><div className="small muted">{line.showStart} to {line.showEnd} · {line.fullDays} full-day / {line.halfDays} half-day{line.alternateDays ? ` · ${line.alternateDays} unused alternate days` : ""}</div></td><td style={{ textAlign: "right" }}>{money(line.amount)}</td></tr>)}</tbody></table></div>
      <div className="row" style={{ marginTop: 12 }}><strong>Total</strong><strong>{money(order.total)}</strong></div>
      <p className="badge">{order.status.replaceAll("_", " ")}</p>
      <p>Please approve this Purchase Order or request changes within 48 hours of delivery. If no response is received, it will be recorded as approved. Payment terms are Net {order.paymentTermsDays}. The approved amount will be scheduled for payment within {order.paymentTermsDays} days.</p>
      {order.approvalDueAt ? <p className="small muted">Response due: {new Date(order.approvalDueAt).toLocaleString()}</p> : null}
      {order.approvedAt ? <p>Approved: {new Date(order.approvedAt).toLocaleString()}</p> : null}
      {order.changeRequest ? <p>Your requested changes: {order.changeRequest}</p> : null}
      {isPreview ? <p className="muted">Admin preview only. The coordinator can respond using the link in their email.</p> : null}
      {awaiting && !isPreview ? <><button type="button" className="primary" disabled={saving} onClick={() => void respond("approve")}>{saving ? "Saving…" : "Approve combined Purchase Order"}</button><label className="field" style={{ marginTop: 16 }}>Request changes<textarea maxLength={2000} value={changes} disabled={saving} onChange={(event) => setChanges(event.target.value)} /></label><button type="button" className="ghost" disabled={saving || !changes.trim()} onClick={() => void respond("request_changes")}>Submit change request</button></> : null}
    </> : null}
  </section>;
}
