"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { bulkSaveMasterRatesAction } from "./actions";
import type { CityPoolRecord } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";

type Props = {
  cityPools: CityPoolRecord[];
  initialRates: MasterRateRecord[];
  canManage: boolean;
};

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

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function toStringValue(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function byRoleName(rates: MasterRateRecord[]) {
  return new Map(rates.map((rate) => [normalize(rate.role_name), rate]));
}

function buildRows(selectedGroup: string, rates: MasterRateRecord[]): RateRow[] {
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
        full_day: toStringValue(rate.full_day),
        half_day: toStringValue(rate.half_day),
        overtime_multiplier: toStringValue(rate.overtime_multiplier),
        doubletime_multiplier: toStringValue(rate.doubletime_multiplier),
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
      full_day: toStringValue(override?.full_day),
      half_day: toStringValue(override?.half_day),
      overtime_multiplier: toStringValue(override?.overtime_multiplier),
      doubletime_multiplier: toStringValue(override?.doubletime_multiplier),
      base_full_day: base?.full_day ?? null,
      base_half_day: base?.half_day ?? null,
      base_ot: base?.overtime_multiplier ?? 1.5,
      base_dt: base?.doubletime_multiplier ?? 2.0,
      hasBase: Boolean(base),
    };
  });
}

function hasOverride(row: RateRow) {
  return Boolean(row.full_day || row.half_day || row.overtime_multiplier || row.doubletime_multiplier);
}

export default function MasterRatesClient({ cityPools, initialRates, canManage }: Props) {
  const [rates, setRates] = useState<MasterRateRecord[]>(initialRates);
  const [selectedGroup, setSelectedGroup] = useState<string>(DEFAULT_GROUP);
  const [groupSearch, setGroupSearch] = useState("");
  const [rowSearch, setRowSearch] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [rows, setRows] = useState<RateRow[]>(() => buildRows(DEFAULT_GROUP, initialRates));
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRows(buildRows(selectedGroup, rates));
    setPendingDeletes([]);
  }, [selectedGroup, rates]);

  const allGroups = useMemo(() => {
    const values = new Set<string>([DEFAULT_GROUP, ...cityPools.map((pool) => pool.name), ...rates.map((rate) => rate.city_name)]);
    return Array.from(values).sort((a, b) => (a === DEFAULT_GROUP ? -1 : b === DEFAULT_GROUP ? 1 : a.localeCompare(b)));
  }, [cityPools, rates]);

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

  function showMessage(kind: "success" | "error", text: string) {
    setMessageKind(kind);
    setMessage(text);
  }

  function updateRow(key: string, patch: Partial<RateRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRoleRow() {
    const roleName = newRoleName.trim();
    if (!roleName) return;
    const duplicate = rows.some((row) => normalize(row.role_name) === normalize(roleName));
    if (duplicate) {
      showMessage("error", `${roleName} is already in this rate group.`);
      return;
    }

    const defaults = rates.filter((rate) => rate.city_name === DEFAULT_GROUP);
    const defaultMatch = defaults.find((rate) => normalize(rate.role_name) === normalize(roleName));

    setRows((current) => [
      ...current,
      {
        key: `new-${selectedGroup}-${roleName}-${Date.now()}`,
        role_name: roleName,
        full_day: selectedGroup === DEFAULT_GROUP ? "" : "",
        half_day: "",
        overtime_multiplier: selectedGroup === DEFAULT_GROUP ? "1.5" : "",
        doubletime_multiplier: selectedGroup === DEFAULT_GROUP ? "2.0" : "",
        base_full_day: defaultMatch?.full_day ?? null,
        base_half_day: defaultMatch?.half_day ?? null,
        base_ot: defaultMatch?.overtime_multiplier ?? 1.5,
        base_dt: defaultMatch?.doubletime_multiplier ?? 2.0,
        hasBase: Boolean(defaultMatch),
        isNew: true,
      },
    ]);
    setNewRoleName("");
  }

  function removeRow(row: RateRow) {
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
    const upserts = rows.flatMap((row) => {
      const roleName = row.role_name.trim();
      if (!roleName) return [];

      if (selectedGroup === DEFAULT_GROUP) {
        const fullDay = Number(row.full_day || 0);
        if (!fullDay) return [];
        return [{
          id: row.id,
          city_name: DEFAULT_GROUP,
          role_name: roleName,
          full_day: fullDay,
          half_day: row.half_day ? Number(row.half_day) : null,
          overtime_multiplier: Number(row.overtime_multiplier || 1.5),
          doubletime_multiplier: Number(row.doubletime_multiplier || 2.0),
        }];
      }

      if (!hasOverride(row)) return [];

      const fullDay = Number(row.full_day || 0);
      if (!fullDay) return [];

      return [{
        id: row.id,
        city_name: selectedGroup,
        role_name: roleName,
        full_day: fullDay,
        half_day: row.half_day ? Number(row.half_day) : null,
        overtime_multiplier: Number(row.overtime_multiplier || row.base_ot || 1.5),
        doubletime_multiplier: Number(row.doubletime_multiplier || row.base_dt || 2.0),
      }];
    });

    const form = new FormData();
    form.set("payload", JSON.stringify({ upserts, deletes: pendingDeletes }));

    startTransition(async () => {
      const result = await bulkSaveMasterRatesAction(form);
      if (!result.ok) {
        showMessage("error", result.message);
        return;
      }

      const nextRates = rates
        .filter((rate) => !pendingDeletes.includes(rate.id))
        .filter((rate) => !upserts.some((row) => normalize(row.city_name) === normalize(rate.city_name) && normalize(row.role_name) === normalize(rate.role_name)));

      const insertedRates: MasterRateRecord[] = upserts.map((row) => ({
        id: row.id || `${row.city_name}-${row.role_name}`,
        city_name: row.city_name,
        role_name: row.role_name,
        full_day: row.full_day,
        half_day: row.half_day,
        overtime_multiplier: row.overtime_multiplier,
        doubletime_multiplier: row.doubletime_multiplier,
      }));

      setRates([...nextRates, ...insertedRates].sort((a, b) => (a.city_name === b.city_name ? a.role_name.localeCompare(b.role_name) : a.city_name.localeCompare(b.city_name))));
      setPendingDeletes([]);
      showMessage("success", result.message);
    });
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-3">
        <section className="card">
          <h3 style={{ marginBottom: 6 }}>Rate groups</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Default is your main crew pay card. City groups use the same table layout and override only what changes in that market.
          </p>
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

        <section className="card" style={{ gridColumn: "span 2" }}>
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>{selectedGroup} rates</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {selectedGroup === DEFAULT_GROUP
                  ? "Edit every role in one place. These are your default crew pay rates."
                  : "Edit this city’s overrides in one place. Leave a row blank to fall back to the Default rate card."}
              </p>
            </div>
            <label className="field" style={{ minWidth: 280 }}>
              <span>Search positions in this rate group</span>
              <input value={rowSearch} onChange={(e) => setRowSearch(e.target.value)} placeholder="General AV, camera, crew lead..." />
            </label>
          </div>
          {message ? <p className={messageKind === "error" ? "error" : "success"} style={{ marginTop: 14 }}>{message}</p> : null}

          <div className="toolbar" style={{ marginTop: 16 }}>
            {canManage ? (
              <>
                <label className="field" style={{ minWidth: 260 }}>
                  <span>Add position to this rate group</span>
                  <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="Example: General AV" />
                </label>
                <button type="button" className="ghost" onClick={addRoleRow}>Add position</button>
                <button type="button" className="primary" disabled={pending} onClick={submitSave}>{pending ? "Saving..." : "Save all changes"}</button>
              </>
            ) : null}
          </div>

          <div style={{ overflowX: "auto", marginTop: 16 }}>
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
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{selectedGroup === DEFAULT_GROUP ? "Half Day" : "Override Half"}</th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{selectedGroup === DEFAULT_GROUP ? "OT" : "Override OT"}</th>
                  <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>{selectedGroup === DEFAULT_GROUP ? "DT" : "Override DT"}</th>
                  {canManage ? <th style={{ textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.key}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)", minWidth: 220 }}>
                      <input
                        value={row.role_name}
                        disabled={!canManage}
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
                      <input
                        type="number"
                        step="0.01"
                        value={row.full_day}
                        disabled={!canManage}
                        onChange={(e) => updateRow(row.key, { full_day: e.target.value })}
                        style={{ width: 110, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }}
                        placeholder={selectedGroup === DEFAULT_GROUP ? "450" : "use default"}
                      />
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.half_day}
                        disabled={!canManage}
                        onChange={(e) => updateRow(row.key, { half_day: e.target.value })}
                        style={{ width: 110, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }}
                        placeholder={selectedGroup === DEFAULT_GROUP ? "225" : "use default"}
                      />
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.overtime_multiplier}
                        disabled={!canManage}
                        onChange={(e) => updateRow(row.key, { overtime_multiplier: e.target.value })}
                        style={{ width: 90, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }}
                        placeholder={selectedGroup === DEFAULT_GROUP ? "1.5" : "use default"}
                      />
                    </td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                      <input
                        type="number"
                        step="0.01"
                        value={row.doubletime_multiplier}
                        disabled={!canManage}
                        onChange={(e) => updateRow(row.key, { doubletime_multiplier: e.target.value })}
                        style={{ width: 90, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--line)" }}
                        placeholder={selectedGroup === DEFAULT_GROUP ? "2.0" : "use default"}
                      />
                    </td>
                    {canManage ? (
                      <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--line)" }}>
                        <button type="button" className="ghost danger" onClick={() => removeRow(row)}>
                          {selectedGroup === DEFAULT_GROUP ? "Delete" : row.id ? "Clear override" : "Remove"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visibleRows.length ? <p className="muted small" style={{ marginTop: 16 }}>No positions found in this rate group.</p> : null}
        </section>
      </div>
    </div>
  );
}
