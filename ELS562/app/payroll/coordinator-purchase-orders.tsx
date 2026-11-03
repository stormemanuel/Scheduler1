"use client";
import { CoordinatorBookingDetails } from "./coordinator-booking-details";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PayrollEventSummary } from "@/lib/payroll-types";
import type { CoordinatorOrderRow, CoordinatorOrderQuote } from "@/lib/coordinator-purchase-order-types";
import { isOwnerDrawPayee } from "@/lib/owner-draws";
import { coordinatorOrderRequest, CoordinatorOrderHttpError } from "@/lib/coordinator-order-request";
import { money } from "@/lib/payroll-calculations";
type Preview = { quote: CoordinatorOrderQuote; hash: string };
export default function CoordinatorPurchaseOrders({ events, year }: { events: PayrollEventSummary[]; year: number }) {
  const [open, setOpen] = useState(false), [coordinatorId, setCoordinatorId] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [netDays, setNetDays] = useState<15 | 30>(30);
  const [orders, setOrders] = useState<CoordinatorOrderRow[]>([]), [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [activeOrderId, setActiveOrderId] = useState("");
  const activeOrder = orders.find((row) => row.id === activeOrderId);
  const actionLock = useRef(false);
  const listRevision = useRef(0);
  const [workingAction, setWorkingAction] = useState("");
  const highlightedOrder = useRef<HTMLDivElement>(null);
  useEffect(() => { if (activeOrderId) highlightedOrder.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [activeOrderId]);
  const eligible = useMemo(() => events.flatMap((event) => (event.coordinatorPayments?.length ? event.coordinatorPayments : event.coordinatorPayment ? [event.coordinatorPayment] : []).filter((payment) => !isOwnerDrawPayee(payment.coordinatorName)).map((payment) => ({ event, payment }))), [events]);
  const coordinators = [...new Map([...eligible.map(({ payment }) => [payment.coordinatorUserId || "", payment.coordinatorName] as const), ...orders.map((row) => [row.coordinator_user_id, row.document.coordinatorName] as const)].filter(([id]) => Boolean(id))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const choices = eligible.filter(({ payment }) => payment.coordinatorUserId === coordinatorId && payment.paymentStatus !== "paid" && !payment.paid && payment.payableAmount > 0);
  const claimed = new Set(orders.filter((row) => row.coordinator_user_id === coordinatorId).flatMap((row) => row.document.showLines.map((line) => line.showId)));
  const selectionKey = selected.slice().sort().join(",");
  const amountsKey = choices.filter(({ event }) => selected.includes(event.showId)).map(({ event, payment }) => `${event.showId}:${payment.payableAmount}:${payment.paymentStatus}`).sort().join(",");
  useEffect(() => { setPreview(null); }, [coordinatorId, netDays, selectionKey, amountsKey]);
  async function list(signal?: AbortSignal) {
    const revision = ++listRevision.current;
    let data: { orders?: CoordinatorOrderRow[] };
    try { data = await coordinatorOrderRequest(`/api/coordinator-purchase-orders?year=${year}`, { cache: "no-store", signal }, 20_000); }
    catch (error) {
      if (revision !== listRevision.current) return;
      if (error instanceof CoordinatorOrderHttpError && error.status === 403) { setAllowed(false); return; }
      throw error;
    }
    if (revision === listRevision.current) setOrders(data.orders || []);
  }
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setError("");
    void list(controller.signal).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
    // Each Payroll year mounts its own panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, year]);
  async function request(body: Record<string, unknown>) {
    const data = await coordinatorOrderRequest<{ quote: CoordinatorOrderQuote; hash: string; order?: CoordinatorOrderRow; message?: string }>("/api/coordinator-purchase-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, body.action === "preview" ? 40_000 : 65_000, body.action !== "preview");
    if (body.action === "preview" && (!data.quote?.lines || !data.hash)) throw new Error("Preview was not returned correctly. Please retry Preview.");
    if (body.action !== "preview" && body.action !== "discard" && !data.order?.id) throw new Error("The server did not confirm the saved order. Refresh saved orders before trying again.");
    return data;
  }

  async function act(action: string, order?: CoordinatorOrderRow) {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorkingAction(action);
    setBusy(true); setError(""); setMessage("");
    try {
      const data = await request(order ? { action, id: order.id, version: order.updated_at } : { action, year, coordinator_id: coordinatorId, show_ids: selected, net_days: netDays, quote_hash: preview?.hash });
      if (action === "preview") setPreview(data);
      else {
        listRevision.current += 1;
        setMessage(action === "create" ? "Purchase Order created. Click Send purchase order by email on the highlighted order below." : data.message || "Purchase Order saved.");
        setPreview(null);
        if (action === "create") setSelected([]);
        if (data.order) {
          const updated = data.order;
          setOrders((current) => [updated, ...current.filter((row) => row.id !== updated.id)]);
          setActiveOrderId(updated.id);
        } else if (action === "discard" && order) {
          setOrders((current) => current.filter((row) => row.id !== order.id));
          setActiveOrderId("");
        }
      }
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to update the order."); }
    finally { actionLock.current = false; setBusy(false); setWorkingAction(""); }
  }
  if (!allowed) return null;
  return <details className="card" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><strong>Combined coordinator Purchase Orders</strong></summary>
    {open ? <div style={{ marginTop: 14 }}>
      <p><strong>1. Select shows → 2. Preview and create → 3. Send purchase order by email</strong></p>
      <p className="muted">Choose one coordinator and up to 25 unpaid shows. The server checks current agreements and amounts before creating or sending one Purchase Order. Approval does not mark the shows paid.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}{message ? <p className="success" role="status">{message}</p> : null}
      <div className="grid grid-2">
        <label className="field">Coordinator<select disabled={busy} value={coordinatorId} onChange={(event) => { setCoordinatorId(event.target.value); setSelected([]); }}><option value="">Choose a coordinator</option>{coordinators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="field">Payment terms<select disabled={busy} value={netDays} onChange={(event) => setNetDays(Number(event.target.value) as 15 | 30)}><option value={30}>Net 30</option><option value={15}>Net 15</option></select></label>
      </div>
      {coordinatorId ? <>
        <div className="list" style={{ marginTop: 12 }}>{choices.map(({ event, payment }) => <label key={event.showId} className="card compact" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input type="checkbox" disabled={busy || claimed.has(event.showId) || (!selected.includes(event.showId) && selected.length >= 25)} checked={selected.includes(event.showId)} onChange={(input) => setSelected((current) => input.target.checked ? [...current, event.showId] : current.filter((id) => id !== event.showId))} />
          <span><strong>{event.showName}</strong><span className="small muted" style={{ display: "block" }}>{event.showStart} to {event.showEnd} · {payment.fullDayTechDays} full-day / {payment.halfDayTechs} half-day · {money(payment.payableAmount)}{claimed.has(event.showId) ? " · Already on a Purchase Order" : ""}</span></span>
        </label>)}</div>
        {!choices.length ? <p className="muted">No unpaid coordinator balances loaded for this year. Load the show's Payroll details to include it.</p> : null}
        <button type="button" className="ghost" style={{ marginTop: 12 }} disabled={busy || !selected.length} onClick={() => void act("preview")}>Preview {selected.length || "selected"} shows</button>
      </> : <p className="muted">Storm Leigh's owner draws are handled separately.</p>}
      {preview ? <div className="card compact" style={{ marginTop: 14 }}><h3>{preview.quote.coordinatorName} — combined Purchase Order</h3>{preview.quote.lines.map((line) => <div className="row" key={line.showId}><div><strong>{line.showName}</strong><CoordinatorBookingDetails line={line} /></div><strong>{money(line.amount)}</strong></div>)}<div className="row" style={{ marginTop: 12 }}><strong>Total · Net {netDays}</strong><strong>{money(preview.quote.total)}</strong></div><button type="button" className="primary" disabled={busy} onClick={() => void act("create")}>Create combined Purchase Order</button></div> : null}
      {activeOrder && ["ready", "revised", "delivery_failed"].includes(activeOrder.document.status) ? <div className="card compact" style={{ marginTop: 14, border: "2px solid #0f5f3d" }}>
        <strong>{activeOrder.document.referenceNumber}-R{activeOrder.document.revision} is ready to send</strong>
        <p>Email {activeOrder.document.coordinatorName} at {activeOrder.document.coordinatorEmail} with the combined {money(activeOrder.document.total)} Purchase Order and approval link.</p>
        <button type="button" className="primary" disabled={busy} onClick={() => void act("send", activeOrder)}>Send purchase order by email</button>
      </div> : null}
      <h3 style={{ marginTop: 20 }}>Saved coordinator Purchase Orders</h3>
      <p className="small muted">Most recent 200 orders for {year}. A show stays linked to its order so it cannot be billed twice.</p>
      <button type="button" className="ghost" disabled={busy} onClick={() => { setError(""); void list().catch((error) => setError(error.message)); }}>Refresh orders</button>
      <div className="list" style={{ marginTop: 12 }}>{orders.filter((row) => !coordinatorId || row.coordinator_user_id === coordinatorId).map((row) => <div className="card compact" key={row.id} ref={row.id === activeOrderId ? highlightedOrder : undefined} style={row.id === activeOrderId ? { border: "2px solid #0f5f3d" } : undefined}>
        <div className="row"><strong>{row.document.referenceNumber}-R{row.document.revision} · {row.document.coordinatorName}</strong><span className="badge">{row.document.status.replaceAll("_", " ")} · {money(row.document.total)}</span></div>
        <div className="small muted">{row.document.showLines.map((line) => line.showName).join(" · ")}</div>
        {row.document.changeRequest ? <p>Requested changes: {row.document.changeRequest}</p> : null}
        <div className="toolbar" style={{ marginTop: 8 }}>
          <a href={`/coordinator-purchase-order/${encodeURIComponent(row.token)}?preview=1`} target="_blank" rel="noreferrer">Review document</a>
          {["ready", "revised", "delivery_failed"].includes(row.document.status) ? <button type="button" className="primary" disabled={busy} onClick={() => void act("send", row)}>Send purchase order by email</button> : null}
          {!["approved", "auto_approved"].includes(row.document.status) ? <button type="button" className="ghost" disabled={busy} onClick={() => void act("revise", row)}>Refresh amounts / revise</button> : null}
          {!row.document.sentAt && ["ready", "revised", "delivery_failed"].includes(row.document.status) ? <button type="button" className="ghost" disabled={busy} onClick={() => void act("discard", row)}>Discard unsent draft</button> : null}
        </div>
      </div>)}</div>
      {busy ? <p role="status">{workingAction === "send" ? "Emailing the combined Purchase Order…" : workingAction === "preview" ? "Checking the selected shows…" : "Saving your Purchase Order…"} This will finish or show a timeout message; please do not click again.</p> : null}
    </div> : null}
  </details>;
}
