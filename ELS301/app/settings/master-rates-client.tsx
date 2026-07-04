"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { bulkSaveClientRatesAction, bulkSaveMasterRatesAction } from "./actions";
import type { CityPoolRecord } from "@/lib/crew-types";
import { halfDayFromFullDay, type ClientRateRecord, type MasterRateRecord } from "@/lib/rates-types";

type Props = {
  cityPools: CityPoolRecord[];
  initialRates: MasterRateRecord[];
  initialClientRates: ClientRateRecord[];
  canManage: boolean;
  clientRatesMissing?: boolean;
};

type RateMode = "crew" | "client";

type RateRow = {
  key: string;
  id?: string;
  role_name: string;
  full_day: string;
  half_day: string;
  overtime_multiplier: string;
  doubletime_multiplier: string;
  base_full_day?: number | null;
  base_half_day?: number | null;
  base_ot?: number | null;
  base_dt?: number | null;
  hasBase: boolean;
  isNew?: boolean;
};

const DEFAULT_GROUP = "Default";

const RATE_MODE_META: Record<RateMode, {
  title: string;
  shortTitle: string;
  groupCopy: string;
  defaultCopy: string;
  overrideCopy: string;
  saveLabel: string;
}> = {
  crew: {
    title: "Crew pay rates",
    shortTitle: "Crew pay",
    groupCopy: "Default is your main crew pay card. City groups use the same table layout and override only what changes in that market.",
    defaultCopy: "Edit every role in one place. Half Day is calculated automatically as 50% of Full Day.",
    overrideCopy: "Edit this city’s crew pay overrides in one place. Half Day stays at 50% of Full Day; leave Full Day blank to inherit the Default card.",
    saveLabel: "Master rates saved.",
  },
  client: {
    title: "Client billing rates",
    shortTitle: "Client billing",
    groupCopy: "Default is your main client billing card. City groups use the same table layout and override only what you bill differently in that market.",
    defaultCopy: "Positions mirror Crew pay exactly. New crew positions start at $0 here until you enter the correct client billing rate. Half Day is calculated automatically as 50% of Full Day.",
    overrideCopy: "Positions mirror Crew pay exactly. Enter only this city’s client billing overrides; blank rows inherit the Default billing card.",
    saveLabel: "Client billing rates saved.",
  },
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function toRateString(value: number | null | undefined, showZero = false) {
  if (value == null) return "";
  if (Number(value) === 0) return showZero ? "0" : "";
  return String(value);
}

function toMultiplierString(value: number | null | undefined, fallback: number) {
  return value == null ? String(fallback) : String(value);
}

function makeUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const next = char === "x" ? value : (value & 0x3) | 0x8;
    return next.toString(16);
  });
}

function byRoleName<T extends { role_name: string }>(rates: T[]) {
  return new Map(rates.map((rate) => [normalize(rate.role_name), rate]));
}

function buildRows<T extends { id: string; city_name: string; role_name: string; full_day: number; half_day: number | null; overtime_multiplier: number; doubletime_multiplier: number }>(selectedGroup: string, rates: T[]): RateRow[] {
  const defaults = rates.filter((rate) => rate.city_name === DEFAULT_GROUP);
  const defaultMap = byRoleName(defaults);

  if (selectedGroup === DEFAULT_GROUP) {
    return defaults
      .slice()
      .sort((a, b) => a.role_name.localeCompare(b.role_name))
      .map((rate) => ({
        key: rate.id,
        id: rate.id,
        role_name: rate.role_name,
        full_day: toRateString(rate.full_day),
        half_day: toRateString(halfDayFromFullDay(rate.full_day)),
        overtime_multiplier: toMultiplierString(rate.overtime_multiplier, 1.5),
        doubletime_multiplier: toMultiplierString(rate.doubletime_multiplier, 2.0),
        hasBase: false,
      }));
  }

  const overrides = rates.filter((rate) => rate.city_name === selectedGroup);
  const overrideMap = byRoleName(overrides);
  const roleNames = Array.from(new Set([...defaults.map((rate) => rate.role_name), ...overrides.map((rate) => rate.role_name)])).sort((a, b) => a.localeCompare(b));

  return roleNames.map((roleName) => {
    const base = defaultMap.get(normalize(roleName)) ?? null;
    const override = overrideMap.get(normalize(roleName)) ?? null;
    return {
      key: override?.id ?? `${selectedGroup}-${roleName}`,
      id: override?.id,
      role_name: override?.role_name ?? base?.role_name ?? roleName,
      full_day: toRateString(override?.full_day),
      half_day: toRateString(halfDayFromFullDay(override?.full_day)),
      overtime_multiplier: override ? toMultiplierString(override.overtime_multiplier, base?.overtime_multiplier ?? 1.5) : "",
      doubletime_multiplier: override ? toMultiplierString(override.doubletime_multiplier, base?.doubletime_multiplier ?? 2.0) : "",
      base_full_day: base?.full_day ?? null,
      base_half_day: halfDayFromFullDay(base?.full_day),
      base_ot: base?.overtime_multiplier ?? 1.5,
      base_dt: base?.doubletime_multiplier ?? 2.0,
      hasBase: Boolean(base),
    };
  });
}

function buildClientRows(selectedGroup: string, clientRates: ClientRateRecord[], crewRates: MasterRateRecord[]): RateRow[] {
  const canonicalCrewRoles = new Map<string, string>();
  for (const rate of crewRates.slice().sort((a, b) => {
    if (a.city_name === DEFAULT_GROUP && b.city_name !== DEFAULT_GROUP) return -1;
    if (b.city_name === DEFAULT_GROUP && a.city_name !== DEFAULT_GROUP) return 1;
    return a.role_name.localeCompare(b.role_name);
  })) {
    const key = normalize(rate.role_name);
    if (key && !canonicalCrewRoles.has(key)) canonicalCrewRoles.set(key, rate.role_name.trim());
  }

  const defaults = clientRates.filter((rate) => rate.city_name === DEFAULT_GROUP);
  const defaultMap = byRoleName(defaults);
  const overrides = clientRates.filter((rate) => rate.city_name === selectedGroup);
  const overrideMap = byRoleName(overrides);
  const roleNames = Array.from(canonicalCrewRoles.values()).sort((a, b) => a.localeCompare(b));

  return roleNames.map((roleName) => {
    const base = defaultMap.get(normalize(roleName)) ?? null;
    const override = selectedGroup === DEFAULT_GROUP ? base : (overrideMap.get(normalize(roleName)) ?? null);
    const active = selectedGroup === DEFAULT_GROUP ? base : override;
    const activeFullDay = active?.full_day ?? (selectedGroup === DEFAULT_GROUP ? 0 : null);
    return {
      key: active?.id ?? `client-${selectedGroup}-${normalize(roleName)}`,
      id: active?.id,
      role_name: roleName,
      full_day: toRateString(activeFullDay, selectedGroup === DEFAULT_GROUP || Boolean(active)),
      half_day: toRateString(halfDayFromFullDay(activeFullDay), selectedGroup === DEFAULT_GROUP || Boolean(active)),
      overtime_multiplier: active ? toMultiplierString(active.overtime_multiplier, base?.overtime_multiplier ?? 1.5) : "",
      doubletime_multiplier: active ? toMultiplierString(active.doubletime_multiplier, base?.doubletime_multiplier ?? 2) : "",
      base_full_day: base?.full_day ?? 0,
      base_half_day: halfDayFromFullDay(base?.full_day ?? 0),
      base_ot: base?.overtime_multiplier ?? 1.5,
      base_dt: base?.doubletime_multiplier ?? 2,
      hasBase: true,
    };
  });
}

function hasOverride(row: RateRow) {
  return Boolean(row.full_day || row.overtime_multiplier || row.doubletime_multiplier);
}

export default function MasterRatesClient({ cityPools, initialRates, initialClientRates, canManage, clientRatesMissing }: Props) {
  const [rateMode, setRateMode] = useState<RateMode>("crew");
  const [crewRates, setCrewRates] = useState<MasterRateRecord[]>(initialRates);
  const [clientRates, setClientRates] = useState<ClientRateRecord[]>(initialClientRates);
  const [selectedGroup, setSelectedGroup] = useState<string>(DEFAULT_GROUP);
  const [groupSearch, setGroupSearch] = useState("");
  const [rowSearch, setRowSearch] = useState("");
  const [bulkAdjustAmount, setBulkAdjustAmount] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [rows, setRows] = useState<RateRow[]>(() => buildRows(DEFAULT_GROUP, initialRates));
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [pending, startTransition] = useTransition();

  const activeRates = rateMode === "crew" ? crewRates : clientRates;
  const meta = RATE_MODE_META[rateMode];

  useEffect(() => {
    setRows(rateMode === "crew" ? buildRows(selectedGroup, crewRates) : buildClientRows(selectedGroup, clientRates, crewRates));
    setPendingDeletes([]);
  }, [selectedGroup, crewRates, clientRates, rateMode]);

  const allGroups = useMemo(() => {
    const values = new Set<string>([
      DEFAULT_GROUP,
      ...cityPools.map((pool) => pool.name),
      ...activeRates.map((rate) => rate.city_name),
      ...(rateMode === "client" ? crewRates.map((rate) => rate.city_name) : []),
    ]);
    return Array.from(values).sort((a, b) => (a === DEFAULT_GROUP ? -1 : b === DEFAULT_GROUP ? 1 : a.localeCompare(b)));
  }, [cityPools, activeRates, crewRates, rateMode]);

  const filteredGroups = useMemo(() => {
    const token = normalize(groupSearch);
    if (!token) return allGroups;
    return allGroups.filter((group) => normalize(group).includes(token));
  }, [allGroups, groupSearch]);

  const visibleRows = useMemo(() => {
    const token = normalize(rowSearch);
    if (!token) return rows;
    return rows.filter((row) => {
      const haystack = normalize([
        row.role_name,
        row.full_day,
        row.half_day,
        row.overtime_multiplier,
        row.doubletime_multiplier,
        row.base_full_day == null ? "" : String(row.base_full_day),
        row.base_half_day == null ? "" : String(row.base_half_day),
      ].join(" "));
      return token.split(" ").every((part) => haystack.includes(part));
    });
  }, [rows, rowSearch]);

  const selectedCityPool = cityPools.find((pool) => pool.name === selectedGroup);

  function setActiveRates(nextRates: Array<MasterRateRecord | ClientRateRecord>) {
    if (rateMode === "crew") setCrewRates(nextRates as MasterRateRecord[]);
    else setClientRates(nextRates as ClientRateRecord[]);
  }

  function switchMode(nextMode: RateMode) {
    setRateMode(nextMode);
    setSelectedGroup(DEFAULT_GROUP);
    setRowSearch("");
    setGroupSearch("");
    setPendingDeletes([]);
    setMessage(null);
  }

  function showMessage(kind: "success" | "error", text: string) {
    setMessageKind(kind);
    setMessage(text);
  }

  function updateRow(key: string, patch: Partial<RateRow>) {
    setRows((current) => current.map((row) => {
      if (row.key !== key) return row;
      if (Object.prototype.hasOwnProperty.call(patch, "full_day")) {
        const fullDay = String(patch.full_day ?? "");
        return { ...row, ...patch, full_day: fullDay, half_day: toRateString(halfDayFromFullDay(fullDay), rateMode === "client") };
      }
      return { ...row, ...patch };
    }));
  }

  function addCurrencyDelta(value: string, delta: number, fallback?: number | null) {
    const current = value.trim() ? Number(value) : Number(fallback ?? 0);
    const next = Number.isFinite(current) ? current + delta : delta;
    if (!Number.isFinite(next) || next <= 0) return "";
    return String(Math.round(next * 100) / 100);
  }

  function applyBulkAdjust() {
    const delta = Number(bulkAdjustAmount);
    if (!Number.isFinite(delta) || delta === 0) {
      showMessage("error", "Enter a dollar amount to add or subtract.");
      return;
    }

    setRows((current) => current.map((row) => {
      const fullDay = addCurrencyDelta(row.full_day, delta, row.base_full_day);
      return {
        ...row,
        full_day: fullDay,
        half_day: toRateString(halfDayFromFullDay(fullDay), rateMode === "client"),
        overtime_multiplier: selectedGroup === DEFAULT_GROUP ? (row.overtime_multiplier || "1.5") : row.overtime_multiplier,
        doubletime_multiplier: selectedGroup === DEFAULT_GROUP ? (row.doubletime_multiplier || "2.0") : row.doubletime_multiplier,
      };
    }));
    setBulkAdjustAmount("");
    showMessage("success", `${selectedGroup} rates adjusted by ${delta > 0 ? "+" : ""}$${Math.abs(delta)}.`);
  }

  function addRoleRow() {
    if (rateMode === "client") {
      showMessage("error", "Add or rename positions under Crew pay rates. Client billing positions mirror that list automatically.");
      return;
    }
    const roleName = newRoleName.trim();
    if (!roleName) return;
    const duplicate = rows.some((row) => normalize(row.role_name) === normalize(roleName));
    if (duplicate) {
      showMessage("error", `${roleName} is already in this rate group.`);
      return;
    }

    const defaults = activeRates.filter((rate) => rate.city_name === DEFAULT_GROUP);
    const defaultMatch = defaults.find((rate) => normalize(rate.role_name) === normalize(roleName));

    setRows((current) => [
      ...current,
      {
        key: `new-${selectedGroup}-${roleName}-${Date.now()}`,
        role_name: roleName,
        full_day: "",
        half_day: "",
        overtime_multiplier: selectedGroup === DEFAULT_GROUP ? "1.5" : "",
        doubletime_multiplier: selectedGroup === DEFAULT_GROUP ? "2.0" : "",
        base_full_day: defaultMatch?.full_day ?? null,
        base_half_day: halfDayFromFullDay(defaultMatch?.full_day),
        base_ot: defaultMatch?.overtime_multiplier ?? 1.5,
        base_dt: defaultMatch?.doubletime_multiplier ?? 2.0,
        hasBase: Boolean(defaultMatch),
        isNew: true,
      },
    ]);
    setNewRoleName("");
  }

  function removeRow(row: RateRow) {
    if (rateMode === "client") return;
    if (selectedGroup === DEFAULT_GROUP) {
      if (row.id) setPendingDeletes((current) => Array.from(new Set([...current, row.id!])));
      setRows((current) => current.filter((item) => item.key !== row.key));
      return;
    }

    if (row.id) {
      setPendingDeletes((current) => Array.from(new Set([...current, row.id!])));
    }

    if (row.hasBase) {
      updateRow(row.key, {
        id: undefined,
        full_day: "",
        half_day: "",
        overtime_multiplier: "",
        doubletime_multiplier: "",
      });
    } else {
      setRows((current) => current.filter((item) => item.key !== row.key));
    }
  }

  function submitSave() {
    if (rateMode === "client" && clientRatesMissing) {
      showMessage("error", "Client rates table is missing. Run the client rates SQL in Supabase first, then refresh this page.");
      return;
    }

    const upserts = rows.flatMap((row) => {
      const roleName = row.role_name.trim();
      if (!roleName) return [];

      if (selectedGroup === DEFAULT_GROUP) {
        const fullDay = Number(row.full_day || 0);
        if (rateMode === "crew" && !fullDay) return [];
        return [{
          id: row.id,
          city_name: DEFAULT_GROUP,
          role_name: roleName,
          full_day: fullDay,
          half_day: halfDayFromFullDay(fullDay),
          overtime_multiplier: Number(row.overtime_multiplier || 1.5),
          doubletime_multiplier: Number(row.doubletime_multiplier || 2.0),
        }];
      }

      if (!hasOverride(row) && !(rateMode === "client" && row.id)) return [];

      const fullDay = Number(row.full_day || 0);
      if (rateMode === "crew" && !fullDay) return [];

      return [{
        id: row.id,
        city_name: selectedGroup,
        role_name: roleName,
        full_day: fullDay,
        half_day: halfDayFromFullDay(fullDay),
        overtime_multiplier: Number(row.overtime_multiplier || row.base_ot || 1.5),
        doubletime_multiplier: Number(row.doubletime_multiplier || row.base_dt || 2.0),
      }];
    });

    const form = new FormData();
    form.set("payload", JSON.stringify({ upserts, deletes: pendingDeletes }));

    startTransition(async () => {
      const action = rateMode === "crew" ? bulkSaveMasterRatesAction : bulkSaveClientRatesAction;
      const result = await action(form);
      if (!result.ok) {
        showMessage("error", result.message);
        return;
      }

      const nextRates = activeRates
        .filter((rate) => !pendingDeletes.includes(rate.id))
        .filter((rate) => !upserts.some((row) => normalize(row.city_name) === normalize(rate.city_name) && normalize(row.role_name) === normalize(rate.role_name)));

      const savedRates = (("rows" in result ? result.rows : []) ?? []).map((row) => ({
        id: row.id,
        city_name: row.city_name,
        role_name: row.role_name,
        full_day: row.full_day,
        half_day: row.half_day,
        overtime_multiplier: row.overtime_multiplier,
        doubletime_multiplier: row.doubletime_multiplier,
      }));

      setActiveRates([...nextRates, ...savedRates].sort((a, b) => (a.city_name === b.city_name ? a.role_name.localeCompare(b.role_name) : a.city_name.localeCompare(b.city_name))));
      if (rateMode === "crew" && "clientRows" in result && Array.isArray(result.clientRows)) {
        setClientRates(result.clientRows as ClientRateRecord[]);
      }
      setPendingDeletes([]);
      showMessage("success", result.message || meta.saveLabel);
    });
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card compact">
        <div className="row" style={{ alignItems: "center" }}>
          <div>
            <h3 style={{ marginBottom: 6 }}>Rate settings</h3>
            <p className="muted small" style={{ margin: 0 }}>Keep crew pay and client billing rates separate. Both support a Default card and city-specific overrides.</p>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <button type="button" className={rateMode === "crew" ? "primary" : "ghost"} onClick={() => switchMode("crew")}>Crew pay rates</button>
            <button type="button" className={rateMode === "client" ? "primary" : "ghost"} onClick={() => switchMode("client")}>Client billing rates</button>
          </div>
        </div>
        {rateMode === "client" && clientRatesMissing ? (
          <p className="error" style={{ marginTop: 12 }}>Client rates storage is not set up yet. Run the client rates SQL in Supabase, then refresh the app.</p>
        ) : null}
      </section>

      <div className="grid grid-3 settings-rates-layout">
        <section className="card">
          <h3 style={{ marginBottom: 6 }}>{meta.shortTitle} groups</h3>
          <p className="muted small" style={{ marginTop: 0 }}>{meta.groupCopy}</p>
          <label className="field">
            <span>Search rate groups</span>
            <input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="Default, New Orleans, Nashville..." />
          </label>
          <div className="list" style={{ marginTop: 14 }}>
            {filteredGroups.map((group) => (
              <button
                key={group}
                type="button"
                className="ghost"
                onClick={() => {
                  setSelectedGroup(group);
                  setRowSearch("");
                  setMessage(null);
                }}
                style={{ textAlign: "left", borderColor: selectedGroup === group ? "#111827" : undefined, fontWeight: selectedGroup === group ? 700 : 500 }}
              >
                {group}
              </button>
            ))}
          </div>
          {canManage ? (
            <div className="list" style={{ marginTop: 16 }}>
              <label className="field">
                <span>Create city override group</span>
                <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="Example: Charlotte, NC" />
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  const value = newGroupName.trim();
                  if (!value) return;
                  setSelectedGroup(value);
                  setNewGroupName("");
                }}
              >
                Use this rate group
              </button>
            </div>
          ) : null}
          {selectedCityPool ? <p className="small muted" style={{ marginTop: 16 }}>Linked city pool: <strong>{selectedCityPool.name}</strong></p> : null}
        </section>

        <section className="card settings-rates-card" style={{ gridColumn: "span 2" }}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>{selectedGroup} {meta.title}</h3>
              <p className="muted small" style={{ margin: 0 }}>{selectedGroup === DEFAULT_GROUP ? meta.defaultCopy : meta.overrideCopy}</p>
            </div>
            <label className="field" style={{ minWidth: 280 }}>
              <span>Search positions in this rate group</span>
              <input value={rowSearch} onChange={(e) => setRowSearch(e.target.value)} placeholder="General AV, camera, crew lead..." />
            </label>
          </div>
          {message ? <p className={messageKind === "error" ? "error" : "success"} style={{ marginTop: 14 }}>{message}</p> : null}

          <div className="toolbar" style={{ marginTop: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
            {canManage ? (
              <>
                {rateMode === "crew" ? (
                  <>
                    <label className="field" style={{ minWidth: 260 }}>
                      <span>Add position to this rate group</span>
                      <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Example: General AV" />
                    </label>
                    <button type="button" className="ghost" onClick={addRoleRow}>Add position</button>
                  </>
                ) : (
                  <p className="small muted" style={{ margin: 0, maxWidth: 360 }}>
                    Position names are controlled by Crew pay rates. Add, rename, or remove a position there and this list updates automatically.
                  </p>
                )}
                <label className="field" style={{ minWidth: 200 }}>
                  <span>{selectedGroup === DEFAULT_GROUP ? "Raise/lower all default rates" : `Raise/lower all ${selectedGroup} rates`}</span>
                  <input type="number" step="0.01" value={bulkAdjustAmount} onChange={(e) => setBulkAdjustAmount(e.target.value)} placeholder="Example: 25 or -10" />
                </label>
                <button type="button" className="ghost" onClick={applyBulkAdjust}>Apply amount to all</button>
                <button type="button" className="primary" disabled={pending} onClick={submitSave}>{pending ? "Saving..." : "Save all changes"}</button>
              </>
            ) : null}
          </div>

          <div className="mobile-table settings-rates-table" style={{ overflowX: "auto", marginTop: 16 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Position</th>
                  {selectedGroup !== DEFAULT_GROUP ? (
                    <>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Default Full</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Default Half</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Default OT</th>
                      <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Default DT</th>
                    </>
                  ) : null}
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{selectedGroup === DEFAULT_GROUP ? "Full Day" : "Override Full"}</th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{selectedGroup === DEFAULT_GROUP ? "Half Day (50%)" : "Override Half (50%)"}</th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{selectedGroup === DEFAULT_GROUP ? "OT" : "Override OT"}</th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{selectedGroup === DEFAULT_GROUP ? "DT" : "Override DT"}</th>
                  {canManage && rateMode === "crew" ? <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.key}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)", minWidth: 220 }}>
                      <input
                        value={row.role_name}
                        disabled={!canManage || rateMode === "client"}
                        readOnly={rateMode === "client"}
                        title={rateMode === "client" ? "Client billing position names mirror Crew pay rates." : undefined}
                        onChange={(e) => updateRow(row.key, { role_name: e.target.value })}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }}
                      />
                    </td>
                    {selectedGroup !== DEFAULT_GROUP ? (
                      <>
                        <td className="small muted" style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{row.base_full_day ?? "—"}</td>
                        <td className="small muted" style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{row.base_half_day ?? "—"}</td>
                        <td className="small muted" style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{row.base_ot ?? "—"}</td>
                        <td className="small muted" style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{row.base_dt ?? "—"}</td>
                      </>
                    ) : null}
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                      <input type="number" step="0.01" min="0" value={rateMode === "client" ? row.full_day : (row.full_day === "0" ? "" : row.full_day)} disabled={!canManage} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateRow(row.key, { full_day: e.target.value })} style={{ width: 110, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }} placeholder={selectedGroup === DEFAULT_GROUP ? (rateMode === "client" ? "0" : "450") : "use default"} />
                      {rateMode === "client" && selectedGroup === DEFAULT_GROUP && Number(row.full_day || 0) === 0 ? <div className="small" style={{ color: "#92400e", marginTop: 4 }}>Rate needed</div> : null}
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                      <input type="number" step="0.01" value={row.half_day === "0" ? "0" : row.half_day} readOnly aria-readonly="true" tabIndex={-1} style={{ width: 110, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface-muted, #f3f4f6)", color: "var(--muted)" }} placeholder={selectedGroup === DEFAULT_GROUP ? "Auto" : "inherits 50%"} title="Half Day is always calculated as 50% of Full Day." />
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                      <input type="number" step="0.01" value={row.overtime_multiplier === "0" ? "" : row.overtime_multiplier} disabled={!canManage} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateRow(row.key, { overtime_multiplier: e.target.value })} style={{ width: 90, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }} placeholder="1.5" />
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                      <input type="number" step="0.01" value={row.doubletime_multiplier === "0" ? "" : row.doubletime_multiplier} disabled={!canManage} onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateRow(row.key, { doubletime_multiplier: e.target.value })} style={{ width: 90, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }} placeholder="2" />
                    </td>
                    {canManage && rateMode === "crew" ? (
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                        <button type="button" className="danger ghost" onClick={() => removeRow(row)}>{selectedGroup === DEFAULT_GROUP ? "Delete" : row.id ? "Remove override" : "Clear"}</button>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={selectedGroup === DEFAULT_GROUP ? (canManage && rateMode === "crew" ? 6 : 5) : (canManage && rateMode === "crew" ? 10 : 9)} className="muted" style={{ padding: 16 }}>No rates match this search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
