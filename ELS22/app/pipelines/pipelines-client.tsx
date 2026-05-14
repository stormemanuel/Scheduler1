"use client";

import { useMemo, useState } from "react";
import type { PipelineRecord, PipelineStage } from "@/lib/pipeline-types";

type Props = {
  initialRows: PipelineRecord[];
  tableMissing: boolean;
};

type SaveState = { kind: "success" | "error"; text: string } | null;

const stages: PipelineStage[] = ["Inquiry", "Estimating", "Quote Sent", "Verbal Yes", "Confirmed", "Lost", "Archived"];
const activeStages: PipelineStage[] = ["Inquiry", "Estimating", "Quote Sent", "Verbal Yes", "Confirmed"];

const emptyForm = {
  event_name: "",
  client_name: "",
  contact_name: "",
  contact_phone: "",
  contact_email: "",
  venue: "",
  city: "",
  show_start: "",
  show_end: "",
  stage: "Inquiry" as PipelineStage,
  estimated_revenue: "",
  probability: "25",
  next_follow_up: "",
  notes: "",
};

function safeText(value: string | null | undefined) {
  return String(value || "").trim();
}

function formatMoney(value: number) {
  return `$${Math.round(Number(value || 0)).toLocaleString()}`;
}

function stageClass(stage: PipelineStage) {
  if (stage === "Confirmed") return "pipeline-stage-confirmed";
  if (stage === "Lost") return "pipeline-stage-lost";
  if (stage === "Archived") return "pipeline-stage-archived";
  if (stage === "Verbal Yes") return "pipeline-stage-warm";
  if (stage === "Quote Sent") return "pipeline-stage-quote";
  return "pipeline-stage-open";
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function rowFromApi(row: PipelineRecord): PipelineRecord {
  return {
    id: String(row.id),
    event_name: safeText(row.event_name),
    client_name: safeText(row.client_name),
    contact_name: safeText(row.contact_name),
    contact_phone: safeText(row.contact_phone),
    contact_email: safeText(row.contact_email),
    venue: safeText(row.venue),
    city: safeText(row.city),
    show_start: row.show_start ? safeText(row.show_start) : null,
    show_end: row.show_end ? safeText(row.show_end) : null,
    stage: stages.includes(row.stage) ? row.stage : "Inquiry",
    estimated_revenue: Number(row.estimated_revenue || 0),
    probability: Number(row.probability || 0),
    next_follow_up: row.next_follow_up ? safeText(row.next_follow_up) : null,
    notes: safeText(row.notes),
    created_at: safeText(row.created_at),
    updated_at: safeText(row.updated_at),
  };
}

export default function PipelinesClient({ initialRows, tableMissing }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<PipelineStage | "All active" | "All">("All active");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveState>(null);

  const filteredRows = useMemo(() => {
    const token = normalize(search);
    return rows
      .filter((row) => {
        if (stageFilter === "All active" && !activeStages.includes(row.stage)) return false;
        if (stageFilter !== "All" && stageFilter !== "All active" && row.stage !== stageFilter) return false;
        if (!token) return true;
        return normalize([
          row.event_name,
          row.client_name,
          row.contact_name,
          row.contact_phone,
          row.contact_email,
          row.venue,
          row.city,
          row.stage,
          row.notes,
        ].join(" ")).includes(token);
      })
      .sort((a, b) => {
        const aDate = a.next_follow_up || a.show_start || "9999-12-31";
        const bDate = b.next_follow_up || b.show_start || "9999-12-31";
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        return a.client_name.localeCompare(b.client_name);
      });
  }, [rows, search, stageFilter]);

  const totals = useMemo(() => {
    const active = rows.filter((row) => activeStages.includes(row.stage));
    const weighted = active.reduce((sum, row) => sum + Number(row.estimated_revenue || 0) * (Number(row.probability || 0) / 100), 0);
    return {
      activeCount: active.length,
      activeValue: active.reduce((sum, row) => sum + Number(row.estimated_revenue || 0), 0),
      weighted,
      confirmed: rows.filter((row) => row.stage === "Confirmed").length,
    };
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<PipelineStage, PipelineRecord[]>();
    for (const stage of stages) map.set(stage, []);
    for (const row of filteredRows) map.get(row.stage)?.push(row);
    return map;
  }, [filteredRows]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function startEdit(row: PipelineRecord) {
    setEditingId(row.id);
    setForm({
      event_name: row.event_name,
      client_name: row.client_name,
      contact_name: row.contact_name,
      contact_phone: row.contact_phone,
      contact_email: row.contact_email,
      venue: row.venue,
      city: row.city,
      show_start: row.show_start || "",
      show_end: row.show_end || "",
      stage: row.stage,
      estimated_revenue: row.estimated_revenue ? String(row.estimated_revenue) : "",
      probability: String(row.probability || 0),
      next_follow_up: row.next_follow_up || "",
      notes: row.notes,
    });
  }

  async function request(url: string, method: string, body?: unknown) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Request failed.");
      if (data.message) setMsg({ kind: "success", text: data.message });
      return data;
    } catch (error) {
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Request failed." });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function savePipelineItem() {
    const payload = {
      ...form,
      event_name: form.event_name.trim(),
      client_name: form.client_name.trim(),
      estimated_revenue: Number(form.estimated_revenue || 0),
      probability: Number(form.probability || 0),
    };
    if (!payload.event_name || !payload.client_name) {
      setMsg({ kind: "error", text: "Event/show name and client are required." });
      return;
    }
    const data = editingId
      ? await request(`/api/pipelines/${editingId}`, "PATCH", payload)
      : await request("/api/pipelines", "POST", payload);
    if (data?.row) {
      const nextRow = rowFromApi(data.row as PipelineRecord);
      setRows((current) => editingId ? current.map((row) => row.id === editingId ? nextRow : row) : [nextRow, ...current]);
      resetForm();
    }
  }

  async function deletePipelineItem(id: string) {
    if (!confirm("Delete this pipeline item?")) return;
    const data = await request(`/api/pipelines/${id}`, "DELETE");
    if (data?.ok) setRows((current) => current.filter((row) => row.id !== id));
  }

  async function updateStage(row: PipelineRecord, stage: PipelineStage) {
    const data = await request(`/api/pipelines/${row.id}`, "PATCH", { ...row, stage });
    if (data?.row) {
      const nextRow = rowFromApi(data.row as PipelineRecord);
      setRows((current) => current.map((item) => item.id === row.id ? nextRow : item));
    }
  }

  function exportCsv() {
    const header = ["Stage", "Client", "Event", "Venue", "City", "Show Start", "Show End", "Estimated Revenue", "Probability", "Next Follow Up", "Contact", "Phone", "Email", "Notes"];
    const lines = filteredRows.map((row) => [
      row.stage,
      row.client_name,
      row.event_name,
      row.venue,
      row.city,
      row.show_start || "",
      row.show_end || "",
      String(row.estimated_revenue || 0),
      String(row.probability || 0),
      row.next_follow_up || "",
      row.contact_name,
      row.contact_phone,
      row.contact_email,
      row.notes,
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ELS_pipeline_export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (tableMissing) {
    return (
      <section className="card">
        <h3>Pipeline setup required</h3>
        <p className="muted">Run the sales_pipeline SQL migration in Supabase SQL Editor first. After that, refresh this page.</p>
      </section>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {msg ? <p className={msg.kind === "error" ? "error" : "success"}>{msg.text}</p> : null}

      <section className="grid grid-3">
        <div className="card compact accent-card"><strong>{totals.activeCount}</strong><div className="small muted">Active pipeline items</div></div>
        <div className="card compact accent-card"><strong>{formatMoney(totals.activeValue)}</strong><div className="small muted">Active estimated revenue</div></div>
        <div className="card compact accent-card"><strong>{formatMoney(totals.weighted)}</strong><div className="small muted">Weighted pipeline value</div></div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <h3 style={{ marginBottom: 6 }}>{editingId ? "Edit pipeline item" : "Add pipeline item"}</h3>
            <p className="small muted" style={{ marginTop: 0 }}>Use this before a show is confirmed, then move it to Confirmed when the client gives the green light.</p>
          </div>
          {editingId ? <button type="button" className="ghost" onClick={resetForm}>Cancel edit</button> : null}
        </div>
        <div className="grid grid-3" style={{ marginTop: 12 }}>
          <label className="field"><span>Event / show name</span><input value={form.event_name} onChange={(e) => setForm((c) => ({ ...c, event_name: e.target.value }))} placeholder="Example: KIDNEY26" /></label>
          <label className="field"><span>Client</span><input value={form.client_name} onChange={(e) => setForm((c) => ({ ...c, client_name: e.target.value }))} placeholder="Client or company" /></label>
          <label className="field"><span>Stage</span><select value={form.stage} onChange={(e) => setForm((c) => ({ ...c, stage: e.target.value as PipelineStage }))}>{stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
          <label className="field"><span>Contact name</span><input value={form.contact_name} onChange={(e) => setForm((c) => ({ ...c, contact_name: e.target.value }))} /></label>
          <label className="field"><span>Contact phone</span><input value={form.contact_phone} onChange={(e) => setForm((c) => ({ ...c, contact_phone: e.target.value }))} /></label>
          <label className="field"><span>Contact email</span><input value={form.contact_email} onChange={(e) => setForm((c) => ({ ...c, contact_email: e.target.value }))} /></label>
          <label className="field"><span>Venue</span><input value={form.venue} onChange={(e) => setForm((c) => ({ ...c, venue: e.target.value }))} /></label>
          <label className="field"><span>City / market</span><input value={form.city} onChange={(e) => setForm((c) => ({ ...c, city: e.target.value }))} placeholder="New Orleans, LA" /></label>
          <label className="field"><span>Next follow-up</span><input type="date" value={form.next_follow_up} onChange={(e) => setForm((c) => ({ ...c, next_follow_up: e.target.value }))} /></label>
          <label className="field"><span>Show start</span><input type="date" value={form.show_start} onChange={(e) => setForm((c) => ({ ...c, show_start: e.target.value }))} /></label>
          <label className="field"><span>Show end</span><input type="date" value={form.show_end} onChange={(e) => setForm((c) => ({ ...c, show_end: e.target.value }))} /></label>
          <label className="field"><span>Estimated revenue</span><input type="number" min="0" value={form.estimated_revenue} onChange={(e) => setForm((c) => ({ ...c, estimated_revenue: e.target.value }))} placeholder="0" /></label>
          <label className="field"><span>Probability %</span><input type="number" min="0" max="100" value={form.probability} onChange={(e) => setForm((c) => ({ ...c, probability: e.target.value }))} /></label>
        </div>
        <label className="field" style={{ marginTop: 12 }}><span>Notes</span><textarea rows={3} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} placeholder="Next step, quote details, client notes..." /></label>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" className="primary" onClick={savePipelineItem} disabled={saving}>{saving ? "Saving..." : editingId ? "Save changes" : "Add to pipeline"}</button>
          <button type="button" className="ghost" onClick={exportCsv}>Export CSV</button>
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <h3 style={{ marginBottom: 6 }}>Pipeline board</h3>
            <p className="small muted" style={{ marginTop: 0 }}>Search and move opportunities through the stages.</p>
          </div>
          <div className="toolbar">
            <label className="field" style={{ minWidth: 220 }}><span>Search</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Client, show, venue..." /></label>
            <label className="field" style={{ minWidth: 180 }}><span>Stage filter</span><select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as PipelineStage | "All active" | "All")}><option value="All active">All active</option><option value="All">All stages</option>{stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select></label>
          </div>
        </div>
        <div className="pipeline-board" style={{ marginTop: 14 }}>
          {stages.map((stage) => {
            const stageRows = grouped.get(stage) ?? [];
            if (!stageRows.length && stageFilter !== "All" && stageFilter !== "All active" && stageFilter !== stage) return null;
            if (!stageRows.length && stageFilter === "All active" && !activeStages.includes(stage)) return null;
            return (
              <div key={stage} className={`pipeline-column ${stageClass(stage)}`}>
                <div className="row">
                  <strong>{stage}</strong>
                  <span className="badge">{stageRows.length}</span>
                </div>
                <div className="list" style={{ marginTop: 10 }}>
                  {stageRows.length ? stageRows.map((row) => (
                    <div key={row.id} className="card compact pipeline-item">
                      <div className="row" style={{ alignItems: "flex-start" }}>
                        <div>
                          <strong>{row.event_name}</strong>
                          <div className="small muted">{row.client_name}</div>
                        </div>
                        <span className="badge">{formatMoney(row.estimated_revenue)}</span>
                      </div>
                      <div className="small" style={{ marginTop: 8 }}>{row.venue || "No venue"}{row.city ? ` • ${row.city}` : ""}</div>
                      <div className="small muted">{row.show_start || "No start date"}{row.show_end ? ` to ${row.show_end}` : ""}</div>
                      {row.next_follow_up ? <div className="small"><strong>Follow up:</strong> {row.next_follow_up}</div> : null}
                      {row.contact_name || row.contact_phone || row.contact_email ? <div className="small muted">{[row.contact_name, row.contact_phone, row.contact_email].filter(Boolean).join(" • ")}</div> : null}
                      {row.notes ? <div className="small muted" style={{ marginTop: 6 }}>{row.notes}</div> : null}
                      <div className="toolbar" style={{ marginTop: 10 }}>
                        <select value={row.stage} onChange={(e) => void updateStage(row, e.target.value as PipelineStage)} disabled={saving}>
                          {stages.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <button type="button" className="ghost" onClick={() => startEdit(row)}>Edit</button>
                        <button type="button" className="ghost danger" onClick={() => void deletePipelineItem(row.id)}>Delete</button>
                      </div>
                    </div>
                  )) : <p className="small muted">No items in this stage.</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
