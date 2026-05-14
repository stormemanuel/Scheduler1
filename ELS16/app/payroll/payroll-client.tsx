"use client";

import { useMemo, useState } from "react";
import type { PayrollCrewShowRow, PayrollEventSummary, PayrollYearTechSummary } from "@/lib/payroll-types";
import { formatPayrollDate, formatPayrollTime, money } from "@/lib/payroll-calculations";

type Props = {
  initialRows: PayrollCrewShowRow[];
  availableYears: number[];
  initialError: string | null;
};

type SavePayload = {
  show_id: string;
  crew_id: string;
  paid: boolean;
  payout_override: number | null;
  notes: string;
};

function payable(row: PayrollCrewShowRow) {
  return row.overrideAmount ?? row.estimatedTotal;
}

function buildEventSummaries(rows: PayrollCrewShowRow[]) {
  const events = new Map<string, PayrollEventSummary>();
  for (const row of rows) {
    if (!events.has(row.showId)) {
      events.set(row.showId, {
        showId: row.showId,
        showName: row.showName,
        showClient: row.showClient,
        showVenue: row.showVenue,
        showStart: row.showStart,
        showEnd: row.showEnd,
        showYear: row.showYear,
        rows: [],
        estimatedRevenue: 0,
        estimatedProfit: 0,
        consecratedHandsDonation: 0,
        taxReserve: 0,
        combinedReserve: 0,
        pureProfit: 0,
        expenses: row.showExpenses ?? 0,
        revenueOverride: row.showRevenueOverride ?? null,
        financialNotes: row.showFinancialNotes ?? "",
        estimatedTotal: 0,
        payableTotal: 0,
        paidTotal: 0,
        unpaidTotal: 0,
      });
    }
    const event = events.get(row.showId)!;
    const amount = payable(row);
    event.rows.push(row);
    event.estimatedTotal += row.estimatedTotal;
    event.estimatedRevenue += row.calls.reduce((sum, call) => sum + (call.clientRevenueAmount ?? 0), 0);
    event.payableTotal += amount;
    if (row.paid) event.paidTotal += amount;
    else event.unpaidTotal += amount;
  }

  return [...events.values()]
    .map((event) => ({
      ...event,
      rows: event.rows.sort((a, b) => a.crewName.localeCompare(b.crewName)),
      estimatedRevenue: Math.round(((event.revenueOverride ?? event.estimatedRevenue) || 0) * 100) / 100,
      estimatedProfit: Math.round((((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses) * 100) / 100,
      consecratedHandsDonation: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.10 * 100) / 100,
      taxReserve: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.25 * 100) / 100,
      combinedReserve: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.35 * 100) / 100,
      pureProfit: Math.round(Math.max(0, (((event.revenueOverride ?? event.estimatedRevenue) || 0) - event.payableTotal - event.expenses)) * 0.65 * 100) / 100,
      estimatedTotal: Math.round(event.estimatedTotal * 100) / 100,
      payableTotal: Math.round(event.payableTotal * 100) / 100,
      paidTotal: Math.round(event.paidTotal * 100) / 100,
      unpaidTotal: Math.round(event.unpaidTotal * 100) / 100,
    }))
    .sort((a, b) => `${b.showStart} ${b.showName}`.localeCompare(`${a.showStart} ${a.showName}`));
}

function buildYearSummary(rows: PayrollCrewShowRow[]) {
  const byCrew = new Map<string, PayrollYearTechSummary>();
  for (const row of rows) {
    if (!byCrew.has(row.crewId)) {
      byCrew.set(row.crewId, {
        crewId: row.crewId,
        crewName: row.crewName,
        crewEmail: row.crewEmail,
        crewPhone: row.crewPhone,
        paidTotal: 0,
        unpaidTotal: 0,
        eventCountPaid: 0,
        eventCountUnpaid: 0,
      });
    }
    const summary = byCrew.get(row.crewId)!;
    const amount = payable(row);
    if (row.paid) {
      summary.paidTotal += amount;
      summary.eventCountPaid += 1;
    } else {
      summary.unpaidTotal += amount;
      summary.eventCountUnpaid += 1;
    }
  }
  return [...byCrew.values()]
    .map((summary) => ({
      ...summary,
      paidTotal: Math.round(summary.paidTotal * 100) / 100,
      unpaidTotal: Math.round(summary.unpaidTotal * 100) / 100,
    }))
    .sort((a, b) => b.paidTotal - a.paidTotal || a.crewName.localeCompare(b.crewName));
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function plForEvents(events: PayrollEventSummary[]) {
  const totals = events.reduce((acc, event) => {
    acc.estimatedRevenue += event.estimatedRevenue;
    acc.contractLabor += event.payableTotal;
    acc.expenses += event.expenses;
    acc.estimatedProfit += event.estimatedProfit;
    acc.consecratedHandsDonation += event.consecratedHandsDonation;
    acc.taxReserve += event.taxReserve;
    acc.combinedReserve += event.combinedReserve;
    acc.pureProfit += event.pureProfit;
    return acc;
  }, { estimatedRevenue: 0, contractLabor: 0, expenses: 0, estimatedProfit: 0, consecratedHandsDonation: 0, taxReserve: 0, combinedReserve: 0, pureProfit: 0 });
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(Number(value) * 100) / 100])) as typeof totals;
}

export default function PayrollClient({ initialRows, availableYears, initialError }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [year, setYear] = useState(() => availableYears[0] ?? new Date().getFullYear());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingFinancialShowId, setSavingFinancialShowId] = useState<string | null>(null);
  const [message, setMessage] = useState(initialError || "");

  const yearRows = useMemo(() => rows.filter((row) => row.showYear === year), [rows, year]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return yearRows.filter((row) => {
      const statusOk = statusFilter === "all" || (statusFilter === "paid" ? row.paid : !row.paid);
      if (!statusOk) return false;
      if (!needle) return true;
      return [row.crewName, row.showName, row.showClient, row.showVenue, row.roles.join(" ")].join(" ").toLowerCase().includes(needle);
    });
  }, [yearRows, search, statusFilter]);

  const events = useMemo(() => buildEventSummaries(filteredRows), [filteredRows]);
  const yearSummary = useMemo(() => buildYearSummary(yearRows), [yearRows]);
  const plTotals = useMemo(() => plForEvents(events), [events]);
  const paidTotal = yearSummary.reduce((sum, row) => sum + row.paidTotal, 0);
  const unpaidTotal = yearSummary.reduce((sum, row) => sum + row.unpaidTotal, 0);
  const payableTotal = paidTotal + unpaidTotal;

  async function saveStatus(row: PayrollCrewShowRow, changes: Partial<SavePayload>) {
    const nextPayload: SavePayload = {
      show_id: row.showId,
      crew_id: row.crewId,
      paid: changes.paid ?? row.paid,
      payout_override: changes.payout_override === undefined ? row.overrideAmount : changes.payout_override,
      notes: changes.notes ?? row.notes,
    };

    setSavingKey(row.key);
    setMessage("");
    try {
      const response = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPayload),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; row?: { id?: string; paid?: boolean; payout_override?: number | null; notes?: string | null } };
      if (!response.ok || !result.ok) throw new Error(result.message || "Payroll update failed.");

      setRows((current) =>
        current.map((item) =>
          item.key === row.key
            ? {
                ...item,
                paid: Boolean(result.row?.paid),
                overrideAmount: result.row?.payout_override ?? null,
                notes: result.row?.notes ?? "",
                statusId: result.row?.id ?? item.statusId,
              }
            : item,
        ),
      );
      setMessage(`Updated ${row.crewName} on ${row.showName}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Payroll update failed.");
    } finally {
      setSavingKey(null);
    }
  }

  async function markEvent(event: PayrollEventSummary, paid: boolean) {
    for (const row of event.rows) {
      await saveStatus(row, { paid });
    }
  }

  function updateLocal(rowKey: string, patch: Partial<PayrollCrewShowRow>) {
    setRows((current) => current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  }

  function toggleDetails(rowKey: string) {
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }

  function updateEventFinancials(showId: string, patch: { revenueOverride?: number | null; expenses?: number; financialNotes?: string }) {
    setRows((current) => current.map((row) => row.showId === showId ? {
      ...row,
      showRevenueOverride: patch.revenueOverride === undefined ? row.showRevenueOverride : patch.revenueOverride,
      showExpenses: patch.expenses === undefined ? row.showExpenses : patch.expenses,
      showFinancialNotes: patch.financialNotes === undefined ? row.showFinancialNotes : patch.financialNotes,
    } : row));
  }

  async function saveEventFinancials(event: PayrollEventSummary) {
    setSavingFinancialShowId(event.showId);
    setMessage("");
    try {
      const response = await fetch("/api/show-financials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_id: event.showId,
          estimated_revenue_override: event.revenueOverride,
          expenses: event.expenses,
          notes: event.financialNotes,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Financial update failed.");
      setMessage(`${event.showName} financials saved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Financial update failed.");
    } finally {
      setSavingFinancialShowId(null);
    }
  }

  function exportOwnerPL() {
    downloadCsv(`ELS_${year}_company_PL.csv`, [
      ["Year", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit"],
      [year, plTotals.estimatedRevenue, plTotals.contractLabor, plTotals.expenses, plTotals.estimatedProfit],
      [],
      ["Show", "Client", "Venue", "Dates", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit", "Financial Notes"],
      ...events.map((event) => [event.showName, event.showClient, event.showVenue, `${event.showStart} to ${event.showEnd}`, event.estimatedRevenue, event.payableTotal, event.expenses, event.estimatedProfit, event.financialNotes]),
    ]);
  }

  function export1099Prep() {
    downloadCsv(`ELS_${year}_1099_NEC_contractors.csv`, [
      ["Tax Year", "Contractor Name", "Legal Name", "TIN", "Address Line 1", "Address Line 2", "City", "State", "ZIP", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "Paid Events", "Unpaid Events", "Notes"],
      ...yearSummary.map((row) => [
        year,
        row.crewName,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        row.crewEmail,
        row.crewPhone,
        row.paidTotal,
        row.unpaidTotal,
        row.paidTotal >= 600 ? "YES" : "NO",
        row.eventCountPaid,
        row.eventCountUnpaid,
        row.paidTotal >= 600 ? "Collect W-9 / verify TIN and address before filing" : "Below $600 paid threshold",
      ]),
    ]);
  }

  function exportYearSummary() {
    downloadCsv(`ELS_${year}_payroll_and_1099_summary.csv`, [
      ["Company P&L", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit"],
      [year, plTotals.estimatedRevenue, plTotals.contractLabor, plTotals.expenses, plTotals.estimatedProfit],
      [],
      ["Tax Year", "Contractor", "Email", "Phone", "Paid Total", "Unpaid/Open", "1099-NEC Needed", "Paid Events", "Unpaid Events"],
      ...yearSummary.map((row) => [year, row.crewName, row.crewEmail, row.crewPhone, row.paidTotal, row.unpaidTotal, row.paidTotal >= 600 ? "YES" : "NO", row.eventCountPaid, row.eventCountUnpaid]),
    ]);
  }

  function exportEvent(event: PayrollEventSummary) {
    downloadCsv(`${event.showName.replace(/[^a-z0-9]+/gi, "_")}_payroll.csv`, [
      ["Show P&L", "Estimated Revenue", "Contract Labor", "Expenses", "Net Profit"],
      [event.showName, event.estimatedRevenue, event.payableTotal, event.expenses, event.estimatedProfit],
      [],
      ["Show", "Crew", "Roles", "Estimated", "Override", "Payable", "Paid", "Phone", "Email", "Notes"],
      ...event.rows.map((row) => [row.showName, row.crewName, row.roles.join(" / "), row.estimatedTotal, row.overrideAmount ?? "", payable(row), row.paid ? "Paid" : "Unpaid", row.crewPhone, row.crewEmail, row.notes]),
    ]);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {message ? <p className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("run supabase") ? "error" : "success"}>{message}</p> : null}

      <section className="grid grid-3">
        <div className="card compact">
          <div className="muted small">Selected year payable</div>
          <div style={{ fontSize: 30, fontWeight: 850 }}>{money(payableTotal)}</div>
        </div>
        <div className="card compact">
          <div className="muted small">Marked paid</div>
          <div style={{ fontSize: 30, fontWeight: 850, color: "#067647" }}>{money(paidTotal)}</div>
        </div>
        <div className="card compact">
          <div className="muted small">Still unpaid</div>
          <div style={{ fontSize: 30, fontWeight: 850, color: "#b42318" }}>{money(unpaidTotal)}</div>
        </div>
      </section>

      <section className="card accent-card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{year} owner P&L</h2>
            <p className="muted" style={{ margin: 0 }}>Estimated revenue minus contract labor and expenses. This is a clean company P&L view for bookkeeping and tax season.</p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}><button className="ghost" type="button" onClick={exportOwnerPL}>Export Company P&L</button><button className="ghost" type="button" onClick={export1099Prep}>Export 1099-NEC Prep</button></div>
        </div>
        <div className="pl-grid" style={{ marginTop: 14 }}>
          <div className="card compact"><div className="muted small">Estimated revenue</div><strong>{money(plTotals.estimatedRevenue)}</strong></div>
          <div className="card compact"><div className="muted small">Contract labor</div><strong>{money(plTotals.contractLabor)}</strong></div>
          <div className="card compact"><div className="muted small">Expenses</div><strong>{money(plTotals.expenses)}</strong></div>
          <div className="card compact"><div className="muted small">Net profit</div><strong>{money(plTotals.estimatedProfit)}</strong></div>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Payroll by event</h2>
            <p className="muted" style={{ margin: 0 }}>Each event shows what every assigned tech is estimated to make. Mark each tech paid/unpaid and keep yearly paid totals for 1099 prep.</p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}><button className="ghost" type="button" onClick={exportYearSummary}>Export Payroll Summary</button><button className="ghost" type="button" onClick={export1099Prep}>Export 1099-NEC Prep</button></div>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <label className="field" style={{ minWidth: 150 }}>
            Year
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {availableYears.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="field" style={{ minWidth: 210, flex: 1 }}>
            Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Show, crew, role, client..." />
          </label>
          <label className="field" style={{ minWidth: 170 }}>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All payroll</option>
              <option value="unpaid">Unpaid only</option>
              <option value="paid">Paid only</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>{year} tech totals</h2>
            <p className="muted" style={{ margin: 0 }}>This is the year-to-date paid total per contractor. Anyone paid $600 or more is flagged for 1099-NEC preparation.</p>
          </div>
          <span className="badge">{yearSummary.length} techs</span>
        </div>
        <div className="mobile-table" style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                <th style={{ padding: "10px 8px" }}>Tech</th>
                <th style={{ padding: "10px 8px" }}>Phone</th>
                <th style={{ padding: "10px 8px" }}>Paid total</th>
                <th style={{ padding: "10px 8px" }}>Unpaid/open</th>
                <th style={{ padding: "10px 8px" }}>1099</th>
                <th style={{ padding: "10px 8px" }}>Events</th>
              </tr>
            </thead>
            <tbody>
              {yearSummary.map((summary) => (
                <tr key={summary.crewId} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 8px" }}><strong>{summary.crewName}</strong><div className="muted small">{summary.crewEmail}</div></td>
                  <td style={{ padding: "10px 8px" }}>{summary.crewPhone || "—"}</td>
                  <td style={{ padding: "10px 8px", fontWeight: 800 }}>{money(summary.paidTotal)}</td>
                  <td style={{ padding: "10px 8px" }}>{money(summary.unpaidTotal)}</td>
                  <td style={{ padding: "10px 8px" }}><span className={summary.paidTotal >= 600 ? "badge event-badge-current" : "badge"}>{summary.paidTotal >= 600 ? "Required" : "Below $600"}</span></td>
                  <td style={{ padding: "10px 8px" }}>{summary.eventCountPaid} paid / {summary.eventCountUnpaid} unpaid</td>
                </tr>
              ))}
              {yearSummary.length === 0 ? (
                <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No assigned crew found for {year}.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="list">
        {events.map((event) => (
          <section key={event.showId} className="card" style={{ borderTop: "4px solid var(--brand)" }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>{event.showName}</h2>
                <p className="muted" style={{ margin: 0 }}>{event.showClient || "No client"} • {event.showVenue || "No venue"} • {formatPayrollDate(event.showStart)} to {formatPayrollDate(event.showEnd)}</p>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <span className="badge">{event.rows.length} techs</span>
                  <span className="badge">Payable {money(event.payableTotal)}</span>
                  <span className="badge">Paid {money(event.paidTotal)}</span>
                  <span className="badge">Unpaid {money(event.unpaidTotal)}</span>
                </div>
                <div className="pl-grid" style={{ marginTop: 12 }}>
                  <span className="badge">Revenue {money(event.estimatedRevenue)}</span>
                  <span className="badge">Labor {money(event.payableTotal)}</span>
                  <span className="badge">Expenses {money(event.expenses)}</span>
                  <span className="badge">Net profit {money(event.estimatedProfit)}</span>
                </div>
              </div>
              <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                <button className="ghost" type="button" onClick={() => exportEvent(event)}>Export event CSV</button>
                <button className="ghost" type="button" onClick={() => void markEvent(event, true)}>Mark event paid</button>
                <button className="ghost" type="button" onClick={() => void markEvent(event, false)}>Mark event unpaid</button>
              </div>
            </div>

            <div className="card compact" style={{ marginTop: 14 }}>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <label className="field" style={{ minWidth: 180 }}>
                  Revenue override
                  <input
                    inputMode="decimal"
                    value={event.revenueOverride ?? ""}
                    placeholder={money(event.estimatedRevenue)}
                    onChange={(e) => updateEventFinancials(event.showId, { revenueOverride: e.target.value.trim() === "" ? null : Number(e.target.value) })}
                  />
                </label>
                <label className="field" style={{ minWidth: 160 }}>
                  Expenses
                  <input
                    inputMode="decimal"
                    value={event.expenses || ""}
                    placeholder="0"
                    onChange={(e) => updateEventFinancials(event.showId, { expenses: e.target.value.trim() === "" ? 0 : Number(e.target.value) })}
                  />
                </label>
                <label className="field" style={{ minWidth: 260, flex: 1 }}>
                  P&L notes
                  <input
                    value={event.financialNotes}
                    placeholder="Invoice number, reimbursables, expense notes..."
                    onChange={(e) => updateEventFinancials(event.showId, { financialNotes: e.target.value })}
                  />
                </label>
                <button className="ghost" type="button" disabled={savingFinancialShowId === event.showId} onClick={() => void saveEventFinancials(event)}>
                  {savingFinancialShowId === event.showId ? "Saving..." : "Save P&L"}
                </button>
              </div>
            </div>

            <div className="mobile-table" style={{ overflowX: "auto", marginTop: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--line)" }}>
                    <th style={{ padding: "10px 8px" }}>Tech</th>
                    <th style={{ padding: "10px 8px" }}>Roles</th>
                    <th style={{ padding: "10px 8px" }}>Calls</th>
                    <th style={{ padding: "10px 8px" }}>Estimated</th>
                    <th style={{ padding: "10px 8px" }}>Override</th>
                    <th style={{ padding: "10px 8px" }}>Payable</th>
                    <th style={{ padding: "10px 8px" }}>Status</th>
                    <th style={{ padding: "10px 8px" }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {event.rows.map((row) => {
                    const isSaving = savingKey === row.key;
                    const isOpen = openRows.has(row.key);
                    return (
                      <tr key={row.key} style={{ borderBottom: "1px solid var(--line)", verticalAlign: "top" }}>
                        <td style={{ padding: "12px 8px", minWidth: 190 }}>
                          <strong>{row.crewName}</strong>
                          <div className="muted small">{row.crewPhone || row.crewEmail || "No contact"}</div>
                        </td>
                        <td style={{ padding: "12px 8px", minWidth: 160 }}>{row.roles.join(" / ") || "—"}</td>
                        <td style={{ padding: "12px 8px" }}>{row.calls.length}</td>
                        <td style={{ padding: "12px 8px" }}>{money(row.estimatedTotal)}</td>
                        <td style={{ padding: "12px 8px", minWidth: 130 }}>
                          <input
                            value={row.overrideAmount ?? ""}
                            placeholder="auto"
                            inputMode="decimal"
                            onChange={(event) => {
                              const value = event.target.value.trim();
                              updateLocal(row.key, { overrideAmount: value === "" ? null : Number(value) });
                            }}
                            onBlur={() => void saveStatus(row, { payout_override: row.overrideAmount })}
                            style={{ width: 100, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 10 }}
                          />
                        </td>
                        <td style={{ padding: "12px 8px", fontWeight: 800 }}>{money(payable(row))}</td>
                        <td style={{ padding: "12px 8px", minWidth: 140 }}>
                          <button
                            className={row.paid ? "primary" : "ghost"}
                            type="button"
                            disabled={isSaving}
                            onClick={() => void saveStatus(row, { paid: !row.paid })}
                          >
                            {isSaving ? "Saving..." : row.paid ? "Paid" : "Unpaid"}
                          </button>
                        </td>
                        <td style={{ padding: "12px 8px" }}>
                          <button className="ghost" type="button" onClick={() => toggleDetails(row.key)}>{isOpen ? "Hide" : "View"}</button>
                          {isOpen ? (
                            <div className="card compact" style={{ marginTop: 10, minWidth: 360 }}>
                              <label className="field">
                                Payroll notes
                                <textarea
                                  value={row.notes}
                                  rows={2}
                                  onChange={(event) => updateLocal(row.key, { notes: event.target.value })}
                                  onBlur={() => void saveStatus(row, { notes: row.notes })}
                                  placeholder="Check number, Zelle confirmation, invoice note..."
                                />
                              </label>
                              <div className="list" style={{ marginTop: 12 }}>
                                {row.calls.map((call) => (
                                  <div key={call.assignmentId} className="small" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                                    <strong>{formatPayrollDate(call.laborDate)}</strong> • {formatPayrollTime(call.startTime)}–{formatPayrollTime(call.endTime)} • {call.roleName}
                                    <div className="muted">{call.area}</div>
                                    <div>{money(call.amount)} • {call.payLabel} • {call.rateSource}</div>
                                    <div className="muted">Client revenue: {money(call.clientRevenueAmount ?? 0)} • {call.clientRateSource || "Client rate sheet"}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {events.length === 0 ? <section className="card"><p className="muted">No event payroll rows match the current filters.</p></section> : null}
      </div>
    </div>
  );
}
