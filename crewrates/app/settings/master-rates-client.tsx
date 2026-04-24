"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteMasterRateAction, upsertMasterRateAction } from "./actions";
import type { CityPoolRecord } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";

type Props = {
  cityPools: CityPoolRecord[];
  initialRates: MasterRateRecord[];
  canManage: boolean;
};

type RateDraft = {
  id?: string;
  city_name: string;
  role_name: string;
  full_day: string;
  half_day: string;
  overtime_multiplier: string;
  doubletime_multiplier: string;
};

const DEFAULT_CITY = "Default";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function blankDraft(selectedCity: string): RateDraft {
  return {
    city_name: selectedCity,
    role_name: "",
    full_day: "",
    half_day: "",
    overtime_multiplier: "1.5",
    doubletime_multiplier: "2.0",
  };
}

function draftFromRate(rate: MasterRateRecord): RateDraft {
  return {
    id: rate.id,
    city_name: rate.city_name,
    role_name: rate.role_name,
    full_day: String(rate.full_day),
    half_day: rate.half_day == null ? "" : String(rate.half_day),
    overtime_multiplier: String(rate.overtime_multiplier),
    doubletime_multiplier: String(rate.doubletime_multiplier),
  };
}

export default function MasterRatesClient({ cityPools, initialRates, canManage }: Props) {
  const [selectedCity, setSelectedCity] = useState<string>(DEFAULT_CITY);
  const [search, setSearch] = useState("");
  const [newRate, setNewRate] = useState<RateDraft>(blankDraft(DEFAULT_CITY));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<RateDraft | null>(null);
  const [customRateGroup, setCustomRateGroup] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [pending, startTransition] = useTransition();

  const rateGroups = useMemo(() => {
    const groups = new Set<string>([DEFAULT_CITY, ...cityPools.map((pool) => pool.name), ...initialRates.map((rate) => rate.city_name)]);
    return Array.from(groups).sort((a, b) => (a === DEFAULT_CITY ? -1 : b === DEFAULT_CITY ? 1 : a.localeCompare(b)));
  }, [cityPools, initialRates]);

  const selectedRates = useMemo(() => {
    const token = normalize(search);
    return initialRates.filter((rate) => {
      if (rate.city_name !== selectedCity) return false;
      if (!token) return true;
      const haystack = normalize(`${rate.role_name} ${rate.city_name} ${rate.full_day} ${rate.half_day ?? ""}`);
      return token.split(" ").every((part) => haystack.includes(part));
    });
  }, [initialRates, search, selectedCity]);

  const defaultRates = useMemo(() => {
    return new Map(
      initialRates.filter((rate) => rate.city_name === DEFAULT_CITY).map((rate) => [normalize(rate.role_name), rate])
    );
  }, [initialRates]);

  const currentCityPool = cityPools.find((pool) => pool.name === selectedCity);

  function showMessage(kind: "success" | "error", text: string) {
    setMessageKind(kind);
    setMessage(text);
  }

  function submitUpsert(draft: RateDraft, reset?: boolean) {
    const form = new FormData();
    if (draft.id) form.set("id", draft.id);
    form.set("city_name", draft.city_name);
    form.set("role_name", draft.role_name);
    form.set("full_day", draft.full_day);
    form.set("half_day", draft.half_day);
    form.set("overtime_multiplier", draft.overtime_multiplier);
    form.set("doubletime_multiplier", draft.doubletime_multiplier);

    startTransition(async () => {
      const result = await upsertMasterRateAction(form);
      if (result.ok) {
        showMessage("success", result.message);
        if (reset) setNewRate(blankDraft(selectedCity));
        setEditingId(null);
        setEditingDraft(null);
      } else {
        showMessage("error", result.message);
      }
    });
  }

  function submitDelete(id: string) {
    const form = new FormData();
    form.set("id", id);
    startTransition(async () => {
      const result = await deleteMasterRateAction(form);
      if (result.ok) showMessage("success", result.message);
      else showMessage("error", result.message);
    });
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Master Rates</h2>
            <p className="muted" style={{ margin: 0 }}>Manage base role pricing and city-specific overrides for the ELS labor pool.</p>
          </div>
          <div className="small muted">{canManage ? "Owner/Admin can edit" : "Read-only"}</div>
        </div>
        {message ? <p className={messageKind === "error" ? "error" : "success"} style={{ marginTop: 12 }}>{message}</p> : null}
      </section>

      <div className="grid grid-3">
        <section className="card">
          <h3>Rate groups</h3>
          <p className="muted small">Default is your base card. City groups override only what changes in that market.</p>
          <div className="list">
            {rateGroups.map((group) => (
              <button
                key={group}
                type="button"
                className="ghost"
                onClick={() => {
                  setSelectedCity(group);
                  setNewRate(blankDraft(group));
                  setEditingId(null);
                  setEditingDraft(null);
                }}
                style={{ textAlign: "left", borderColor: selectedCity === group ? "#111827" : undefined, fontWeight: selectedCity === group ? 700 : 500 }}
              >
                {group}
              </button>
            ))}
          </div>
          {canManage ? (
            <div className="list" style={{ marginTop: 16 }}>
              <label className="field">
                <span>Create custom rate group</span>
                <input value={customRateGroup} onChange={(e) => setCustomRateGroup(e.target.value)} placeholder="Example: Chicago, IL" />
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const value = customRateGroup.trim();
                  if (!value) return;
                  setSelectedCity(value);
                  setNewRate(blankDraft(value));
                  setCustomRateGroup("");
                }}
              >
                Use custom rate group
              </button>
            </div>
          ) : null}
          {currentCityPool ? <p className="small muted" style={{ marginTop: 16 }}>Connected to city pool: <strong>{currentCityPool.name}</strong></p> : null}
        </section>

        <section className="card" style={{ gridColumn: "span 2" }}>
          <div className="row" style={{ alignItems: "center" }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>{selectedCity} rates</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {selectedCity === DEFAULT_CITY ? "These are the base defaults for all cities unless a city override exists." : "These rows override the Default rate card for this city."}
              </p>
            </div>
            <label className="field" style={{ minWidth: 240 }}>
              <span>Search rates</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="General AV, camera, crew lead..." />
            </label>
          </div>

          <div className="list" style={{ marginTop: 16 }}>
            {selectedRates.map((rate) => {
              const baseRate = selectedCity === DEFAULT_CITY ? null : defaultRates.get(normalize(rate.role_name));
              const isEditing = editingId === rate.id && editingDraft;
              return (
                <div key={rate.id} className="card compact">
                  {isEditing ? (
                    <div className="list small">
                      <label className="field"><span>Role</span><input value={editingDraft.role_name} onChange={(e) => setEditingDraft({ ...editingDraft, role_name: e.target.value })} /></label>
                      <div className="grid grid-2">
                        <label className="field"><span>Full day</span><input type="number" step="0.01" value={editingDraft.full_day} onChange={(e) => setEditingDraft({ ...editingDraft, full_day: e.target.value })} /></label>
                        <label className="field"><span>Half day</span><input type="number" step="0.01" value={editingDraft.half_day} onChange={(e) => setEditingDraft({ ...editingDraft, half_day: e.target.value })} /></label>
                      </div>
                      <div className="grid grid-2">
                        <label className="field"><span>OT multiplier</span><input type="number" step="0.01" value={editingDraft.overtime_multiplier} onChange={(e) => setEditingDraft({ ...editingDraft, overtime_multiplier: e.target.value })} /></label>
                        <label className="field"><span>DT multiplier</span><input type="number" step="0.01" value={editingDraft.doubletime_multiplier} onChange={(e) => setEditingDraft({ ...editingDraft, doubletime_multiplier: e.target.value })} /></label>
                      </div>
                      <div className="toolbar">
                        <button type="button" className="primary" disabled={pending} onClick={() => submitUpsert(editingDraft)}>{pending ? "Saving..." : "Save"}</button>
                        <button type="button" className="ghost" onClick={() => { setEditingId(null); setEditingDraft(null); }}>Close</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="row">
                        <div>
                          <strong>{rate.role_name}</strong>
                          <div className="small muted">{rate.city_name}</div>
                        </div>
                        <div className="small" style={{ textAlign: "right" }}>
                          <div><strong>${rate.full_day.toFixed(2)}</strong> full day</div>
                          <div className="muted">{rate.half_day == null ? "—" : `$${rate.half_day.toFixed(2)} half day`} • OT {rate.overtime_multiplier.toFixed(2)}x • DT {rate.doubletime_multiplier.toFixed(2)}x</div>
                        </div>
                      </div>
                      {baseRate ? (
                        <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                          Default comparison: ${baseRate.full_day.toFixed(2)} full day{baseRate.half_day == null ? "" : ` • $${baseRate.half_day.toFixed(2)} half day`}
                        </p>
                      ) : null}
                      {canManage ? (
                        <div className="toolbar" style={{ marginTop: 12 }}>
                          <button type="button" className="ghost" onClick={() => { setEditingId(rate.id); setEditingDraft(draftFromRate(rate)); }}>Edit</button>
                          <button type="button" className="ghost danger" disabled={pending} onClick={() => submitDelete(rate.id)}>Delete</button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}
            {!selectedRates.length ? <p className="muted small">No rates found for this group yet.</p> : null}
          </div>
        </section>
      </div>

      {canManage ? (
        <section className="card">
          <h3>Add rate</h3>
          <div className="grid grid-2">
            <label className="field">
              <span>Rate group</span>
              <select value={newRate.city_name} onChange={(e) => setNewRate({ ...newRate, city_name: e.target.value })}>
                {rateGroups.map((group) => <option key={group} value={group}>{group}</option>)}
                {customRateGroup.trim() ? <option value={customRateGroup.trim()}>{customRateGroup.trim()}</option> : null}
              </select>
            </label>
            <label className="field">
              <span>Role name</span>
              <input value={newRate.role_name} onChange={(e) => setNewRate({ ...newRate, role_name: e.target.value })} placeholder="General AV" />
            </label>
            <label className="field">
              <span>Full day</span>
              <input type="number" step="0.01" value={newRate.full_day} onChange={(e) => setNewRate({ ...newRate, full_day: e.target.value })} placeholder="450" />
            </label>
            <label className="field">
              <span>Half day</span>
              <input type="number" step="0.01" value={newRate.half_day} onChange={(e) => setNewRate({ ...newRate, half_day: e.target.value })} placeholder="225" />
            </label>
            <label className="field">
              <span>OT multiplier</span>
              <input type="number" step="0.01" value={newRate.overtime_multiplier} onChange={(e) => setNewRate({ ...newRate, overtime_multiplier: e.target.value })} />
            </label>
            <label className="field">
              <span>DT multiplier</span>
              <input type="number" step="0.01" value={newRate.doubletime_multiplier} onChange={(e) => setNewRate({ ...newRate, doubletime_multiplier: e.target.value })} />
            </label>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button type="button" className="primary" disabled={pending} onClick={() => submitUpsert(newRate, true)}>{pending ? "Saving..." : "Save rate"}</button>
            <button type="button" className="ghost" onClick={() => setNewRate(blankDraft(selectedCity))}>Clear</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
