"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CityPoolRecord, CrewRecord, PositionInput } from "@/lib/crew-types";

type CrewClientProps = {
  cityPools: CityPoolRecord[];
  initialCrew: CrewRecord[];
};

type CrewDraft = {
  id?: string;
  name: string;
  description: string;
  city_pool_id: string;
  city_name: string;
  group_name: string;
  tier: string;
  email: string;
  phone: string;
  other_city: string;
  ob: boolean;
  notes: string;
  conflict_companies_text: string;
  unavailable_dates_text: string;
  positions: PositionInput[];
};

function blankDraft(cityPools: CityPoolRecord[], cityId?: string, groupName?: string): CrewDraft {
  const chosenCity = cityPools.find((pool) => pool.id === cityId) || cityPools[0];
  return {
    name: "",
    description: "",
    city_pool_id: chosenCity?.id || "",
    city_name: chosenCity?.name || "",
    group_name: groupName || "Ungrouped",
    tier: "",
    email: "",
    phone: "",
    other_city: "",
    ob: false,
    notes: "",
    conflict_companies_text: "",
    unavailable_dates_text: "",
    positions: [{ role_name: "", rate: 0 }],
  };
}

function draftFromRecord(record: CrewRecord): CrewDraft {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    city_pool_id: record.city_pool_id || "",
    city_name: record.city_name,
    group_name: record.group_name,
    tier: record.tier,
    email: record.email,
    phone: record.phone,
    other_city: record.other_city,
    ob: record.ob,
    notes: record.notes,
    conflict_companies_text: record.conflict_companies.join(", "),
    unavailable_dates_text: record.unavailable_dates.join("\n"),
    positions: record.positions.length ? record.positions.map((item) => ({ ...item })) : [{ role_name: "", rate: 0 }],
  };
}

function recordFromDraft(draft: CrewDraft, cityPools: CityPoolRecord[]): CrewRecord {
  const city = cityPools.find((pool) => pool.id === draft.city_pool_id);
  return {
    id: draft.id || `temp-${Math.random().toString(36).slice(2)}`,
    name: draft.name,
    description: draft.description,
    city_pool_id: draft.city_pool_id || null,
    city_name: city?.name || draft.city_name || "Unassigned",
    group_name: draft.group_name || "Ungrouped",
    tier: draft.tier,
    email: draft.email,
    phone: draft.phone,
    other_city: draft.other_city,
    ob: draft.ob,
    notes: draft.notes,
    conflict_companies: draft.conflict_companies_text.split(",").map((item) => item.trim()).filter(Boolean),
    positions: draft.positions.filter((item) => item.role_name.trim()).map((item) => ({ id: item.id, role_name: item.role_name.trim(), rate: Number(item.rate || 0) })),
    unavailable_dates: draft.unavailable_dates_text
      .split(/\n|,/) 
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function normalizePayload(draft: CrewDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    city_pool_id: draft.city_pool_id || null,
    city_name: draft.city_name || null,
    group_name: draft.group_name.trim() || "Ungrouped",
    tier: draft.tier.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    other_city: draft.other_city.trim(),
    ob: draft.ob,
    notes: draft.notes.trim(),
    conflict_companies: draft.conflict_companies_text.split(",").map((item) => item.trim()).filter(Boolean),
    unavailable_dates: draft.unavailable_dates_text.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    positions: draft.positions
      .filter((item) => item.role_name.trim())
      .map((item) => ({ role_name: item.role_name.trim(), rate: Number(item.rate || 0) })),
  };
}

function searchHaystack(record: CrewRecord) {
  return [
    record.name,
    record.city_name,
    record.group_name,
    record.tier,
    record.email,
    record.phone,
    record.other_city,
    record.description,
    record.notes,
    record.ob ? "ob" : "",
    ...record.positions.map((position) => position.role_name),
    ...record.conflict_companies,
  ]
    .join(" ")
    .toLowerCase();
}

export default function CrewClient({ cityPools: initialCityPools, initialCrew }: CrewClientProps) {
  const router = useRouter();
  const [cityPools, setCityPools] = useState(initialCityPools);
  const [crewRecords, setCrewRecords] = useState(initialCrew);
  const [selectedCityId, setSelectedCityId] = useState<string>(initialCityPools[0]?.id || "all");
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CrewDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCityName, setNewCityName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [bulkCityId, setBulkCityId] = useState("");
  const [bulkGroupName, setBulkGroupName] = useState("Ungrouped");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"error" | "success">("success");

  const visibleCrew = useMemo(() => {
    return crewRecords.filter((record) => {
      const cityMatch = selectedCityId === "all" || record.city_pool_id === selectedCityId;
      const groupMatch = selectedGroup === "all" || record.group_name === selectedGroup;
      const searchMatch = !search.trim() || searchHaystack(record).includes(search.trim().toLowerCase());
      return cityMatch && groupMatch && searchMatch;
    });
  }, [crewRecords, search, selectedCityId, selectedGroup]);

  const groupsForSelectedCity = useMemo(() => {
    const base = new Set<string>();
    const source = selectedCityId === "all" ? crewRecords : crewRecords.filter((record) => record.city_pool_id === selectedCityId);
    source.forEach((record) => base.add(record.group_name || "Ungrouped"));
    if (newGroupName.trim()) base.add(newGroupName.trim());
    return ["all", ...Array.from(base).sort((a, b) => a.localeCompare(b))];
  }, [crewRecords, newGroupName, selectedCityId]);

  const groupedVisibleCrew = useMemo(() => {
    const groups = new Map<string, CrewRecord[]>();
    for (const record of visibleCrew) {
      const key = record.group_name || "Ungrouped";
      const list = groups.get(key) ?? [];
      list.push(record);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleCrew]);

  function beginAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft(blankDraft(cityPools, selectedCityId === "all" ? cityPools[0]?.id : selectedCityId, selectedGroup !== "all" ? selectedGroup : undefined));
    setMessage(null);
  }

  function beginEdit(record: CrewRecord) {
    setEditingId(record.id);
    setAdding(false);
    setDraft(draftFromRecord(record));
    setMessage(null);
  }

  function closeEditor() {
    setEditingId(null);
    setAdding(false);
    setDraft(null);
  }

  function setDraftField(key: keyof CrewDraft, value: CrewDraft[keyof CrewDraft]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function setPosition(index: number, patch: Partial<PositionInput>) {
    setDraft((current) => {
      if (!current) return current;
      const positions = [...current.positions];
      positions[index] = { ...positions[index], ...patch };
      return { ...current, positions };
    });
  }

  function addPosition() {
    setDraft((current) => (current ? { ...current, positions: [...current.positions, { role_name: "", rate: 0 }] } : current));
  }

  function removePosition(index: number) {
    setDraft((current) => {
      if (!current) return current;
      const positions = current.positions.filter((_, idx) => idx !== index);
      return { ...current, positions: positions.length ? positions : [{ role_name: "", rate: 0 }] };
    });
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setMessageKind("error");
      setMessage("Crew name is required.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = normalizePayload(draft);
      const response = await fetch(draft.id ? `/api/crew/${draft.id}` : "/api/crew", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Save failed.");

      const nextRecord = recordFromDraft({ ...draft, id: draft.id || result.id }, cityPools);
      setCrewRecords((current) => {
        if (draft.id) return current.map((record) => (record.id === draft.id ? nextRecord : record));
        return [nextRecord, ...current];
      });
      setMessageKind("success");
      setMessage(draft.id ? "Crew member updated." : "Crew member added.");
      closeEditor();
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to save crew member.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(id: string) {
    if (!window.confirm("Delete this crew member?")) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/crew/${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Delete failed.");
      setCrewRecords((current) => current.filter((record) => record.id !== id));
      setSelectedIds((current) => current.filter((value) => value !== id));
      if (editingId === id) closeEditor();
      setMessageKind("success");
      setMessage("Crew member deleted.");
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete crew member.");
    } finally {
      setSaving(false);
    }
  }

  async function addCityPool() {
    if (!newCityName.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/city-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCityName.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to add city pool.");
      const city = result.cityPool as CityPoolRecord;
      setCityPools((current) => {
        if (current.some((item) => item.id === city.id)) return current;
        return [...current, city].sort((a, b) => a.name.localeCompare(b.name));
      });
      setSelectedCityId(city.id);
      setBulkCityId(city.id);
      setNewCityName("");
      setMessageKind("success");
      setMessage(`City pool created: ${city.name}`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to add city pool.");
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function selectVisible() {
    setSelectedIds(Array.from(new Set([...selectedIds, ...visibleCrew.map((record) => record.id)])));
  }

  function clearSelected() {
    setSelectedIds([]);
  }

  async function moveSelected() {
    if (!selectedIds.length) return;
    if (!bulkCityId && !bulkGroupName.trim()) {
      setMessageKind("error");
      setMessage("Choose a city pool or group for the move.");
      return;
    }
    setSaving(true);
    try {
      const updates = crewRecords.filter((record) => selectedIds.includes(record.id));
      for (const record of updates) {
        const targetCityId = bulkCityId || record.city_pool_id || "";
        const targetCity = cityPools.find((pool) => pool.id === targetCityId);
        const payload = {
          name: record.name,
          description: record.description,
          city_pool_id: targetCityId || null,
          city_name: targetCity?.name || record.city_name,
          group_name: bulkGroupName.trim() || record.group_name || "Ungrouped",
          tier: record.tier,
          email: record.email,
          phone: record.phone,
          other_city: record.other_city,
          ob: record.ob,
          notes: record.notes,
          conflict_companies: record.conflict_companies,
          unavailable_dates: record.unavailable_dates,
          positions: record.positions,
        };
        const response = await fetch(`/api/crew/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || `Move failed for ${record.name}.`);
      }
      setCrewRecords((current) =>
        current.map((record) => {
          if (!selectedIds.includes(record.id)) return record;
          const targetCityId = bulkCityId || record.city_pool_id;
          const targetCity = cityPools.find((pool) => pool.id === targetCityId);
          return {
            ...record,
            city_pool_id: targetCityId,
            city_name: targetCity?.name || record.city_name,
            group_name: bulkGroupName.trim() || record.group_name || "Ungrouped",
          };
        })
      );
      setMessageKind("success");
      setMessage("Selected crew moved.");
      setSelectedIds([]);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to move selected crew.");
    } finally {
      setSaving(false);
    }
  }

  const currentCityName = selectedCityId === "all" ? "All city pools" : cityPools.find((pool) => pool.id === selectedCityId)?.name || "Selected city";

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <label className="field" style={{ minWidth: 220, flex: 1 }}>
            <span>Search crew</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, position, tier, email, notes, conflicts…" />
          </label>
          <label className="field" style={{ minWidth: 200 }}>
            <span>City pool</span>
            <select value={selectedCityId} onChange={(event) => { setSelectedCityId(event.target.value); setSelectedGroup("all"); }}>
              <option value="all">All city pools</option>
              {cityPools.map((pool) => (
                <option key={pool.id} value={pool.id}>{pool.name}</option>
              ))}
            </select>
          </label>
          <label className="field" style={{ minWidth: 200 }}>
            <span>Group</span>
            <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
              {groupsForSelectedCity.map((group) => (
                <option key={group} value={group}>{group === "all" ? "All groups" : group}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="toolbar" style={{ marginTop: 14 }}>
          <button className="primary" type="button" onClick={beginAdd}>Add crew member</button>
          <button className="ghost" type="button" onClick={selectVisible}>Select visible</button>
          <button className="ghost" type="button" onClick={clearSelected}>Clear selected</button>
        </div>

        <div className="toolbar" style={{ marginTop: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label className="field" style={{ minWidth: 220 }}>
            <span>Add city pool</span>
            <input value={newCityName} onChange={(event) => setNewCityName(event.target.value)} placeholder="Example: Birmingham, AL" />
          </label>
          <button className="ghost" type="button" onClick={addCityPool} disabled={saving}>Create city pool</button>
          <label className="field" style={{ minWidth: 220 }}>
            <span>Create subgroup for {currentCityName}</span>
            <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Example: Tier 1 New Orleans" />
          </label>
        </div>

        <div className="toolbar" style={{ marginTop: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label className="field" style={{ minWidth: 220 }}>
            <span>Move selected to city pool</span>
            <select value={bulkCityId} onChange={(event) => setBulkCityId(event.target.value)}>
              <option value="">Keep current city</option>
              {cityPools.map((pool) => (
                <option key={pool.id} value={pool.id}>{pool.name}</option>
              ))}
            </select>
          </label>
          <label className="field" style={{ minWidth: 220 }}>
            <span>Move selected to group</span>
            <input value={bulkGroupName} onChange={(event) => setBulkGroupName(event.target.value)} placeholder="Ungrouped or custom subgroup" />
          </label>
          <button className="primary" type="button" onClick={moveSelected} disabled={saving || !selectedIds.length}>Move selected</button>
        </div>

        {message ? <p className={messageKind === "error" ? "error" : "success"} style={{ marginTop: 12 }}>{message}</p> : null}
      </section>

      {adding && draft ? (
        <section className="card">
          <h3 style={{ marginBottom: 12 }}>New crew member</h3>
          <CrewEditor
            cityPools={cityPools}
            draft={draft}
            onChange={setDraftField}
            onPositionChange={setPosition}
            onAddPosition={addPosition}
            onRemovePosition={removePosition}
            onSave={saveDraft}
            onClose={closeEditor}
            saving={saving}
          />
        </section>
      ) : null}

      <section className="grid" style={{ gap: 16 }}>
        {groupedVisibleCrew.length === 0 ? (
          <div className="card">
            <h3>No crew found</h3>
            <p className="muted">Try a different search, city, or group filter.</p>
          </div>
        ) : groupedVisibleCrew.map(([group, records]) => (
          <div key={group} className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0 }}>{group}</h3>
                <div className="muted small">{records.length} crew member{records.length === 1 ? "" : "s"}</div>
              </div>
            </div>
            <div className="list">
              {records.map((record) => {
                const isEditing = editingId === record.id;
                const isSelected = selectedIds.includes(record.id);
                return (
                  <div key={record.id} className="card compact">
                    <div className="row" style={{ gap: 10, alignItems: "center" }}>
                      <label className="checkboxWrap">
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(record.id)} />
                        <span />
                      </label>
                      <div style={{ flex: 1 }}>
                        <strong>{record.name}</strong>
                        <div className="muted small">
                          {record.city_name} • {record.group_name} • {record.tier ? `Tier ${record.tier}` : "No tier"}
                        </div>
                        <div className="muted small">
                          {record.email || "No email"}{record.phone ? ` • ${record.phone}` : ""}{record.ob ? " • OB" : ""}
                        </div>
                      </div>
                      <div className="toolbar" style={{ gap: 8 }}>
                        <button className="ghost" type="button" onClick={() => beginEdit(record)}>{isEditing ? "Editing" : "Edit"}</button>
                        <button className="ghost danger" type="button" onClick={() => deleteRecord(record.id)} disabled={saving}>Delete</button>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {record.positions.map((position) => (
                        <span key={`${record.id}-${position.role_name}-${position.rate}`} className="badge">
                          {position.role_name}: ${Number(position.rate || 0).toFixed(2)}
                        </span>
                      ))}
                    </div>
                    {record.conflict_companies.length ? <p className="muted small" style={{ marginTop: 12 }}><strong>Conflicts:</strong> {record.conflict_companies.join(", ")}</p> : null}
                    {record.unavailable_dates.length ? <p className="muted small"><strong>Unavailable:</strong> {record.unavailable_dates.join(", ")}</p> : null}
                    {record.notes ? <p className="muted small">{record.notes}</p> : null}

                    {isEditing && draft ? (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                        <CrewEditor
                          cityPools={cityPools}
                          draft={draft}
                          onChange={setDraftField}
                          onPositionChange={setPosition}
                          onAddPosition={addPosition}
                          onRemovePosition={removePosition}
                          onSave={saveDraft}
                          onClose={closeEditor}
                          saving={saving}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

type CrewEditorProps = {
  cityPools: CityPoolRecord[];
  draft: CrewDraft;
  onChange: (key: keyof CrewDraft, value: CrewDraft[keyof CrewDraft]) => void;
  onPositionChange: (index: number, patch: Partial<PositionInput>) => void;
  onAddPosition: () => void;
  onRemovePosition: (index: number) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
};

function CrewEditor({ cityPools, draft, onChange, onPositionChange, onAddPosition, onRemovePosition, onSave, onClose, saving }: CrewEditorProps) {
  return (
    <div className="list">
      <div className="grid grid-3">
        <label className="field">
          <span>Name</span>
          <input value={draft.name} onChange={(event) => onChange("name", event.target.value)} />
        </label>
        <label className="field">
          <span>City pool</span>
          <select value={draft.city_pool_id} onChange={(event) => {
            const city = cityPools.find((pool) => pool.id === event.target.value);
            onChange("city_pool_id", event.target.value);
            onChange("city_name", city?.name || "");
          }}>
            <option value="">No city pool</option>
            {cityPools.map((pool) => (
              <option key={pool.id} value={pool.id}>{pool.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Group / subgroup</span>
          <input value={draft.group_name} onChange={(event) => onChange("group_name", event.target.value)} />
        </label>
      </div>

      <div className="grid grid-3">
        <label className="field"><span>Tier</span><input value={draft.tier} onChange={(event) => onChange("tier", event.target.value)} /></label>
        <label className="field"><span>Email</span><input value={draft.email} onChange={(event) => onChange("email", event.target.value)} /></label>
        <label className="field"><span>Phone</span><input value={draft.phone} onChange={(event) => onChange("phone", event.target.value)} /></label>
      </div>

      <div className="grid grid-3">
        <label className="field"><span>Other city</span><input value={draft.other_city} onChange={(event) => onChange("other_city", event.target.value)} /></label>
        <label className="field"><span>Description</span><input value={draft.description} onChange={(event) => onChange("description", event.target.value)} /></label>
        <label className="field checkboxField">
          <span>OB</span>
          <input type="checkbox" checked={draft.ob} onChange={(event) => onChange("ob", event.target.checked)} />
        </label>
      </div>

      <label className="field">
        <span>Conflict companies (comma separated)</span>
        <input value={draft.conflict_companies_text} onChange={(event) => onChange("conflict_companies_text", event.target.value)} />
      </label>

      <label className="field">
        <span>Unavailable dates (one per line or comma separated)</span>
        <textarea value={draft.unavailable_dates_text} onChange={(event) => onChange("unavailable_dates_text", event.target.value)} rows={4} placeholder="2026-05-01" />
      </label>

      <label className="field">
        <span>Notes</span>
        <textarea value={draft.notes} onChange={(event) => onChange("notes", event.target.value)} rows={4} />
      </label>

      <div className="field">
        <span>Positions and rates</span>
        <div className="list">
          {draft.positions.map((position, index) => (
            <div key={`position-${index}`} className="row" style={{ gap: 10, alignItems: "end" }}>
              <label className="field" style={{ flex: 1 }}>
                <span>Role</span>
                <input value={position.role_name} onChange={(event) => onPositionChange(index, { role_name: event.target.value })} />
              </label>
              <label className="field" style={{ width: 160 }}>
                <span>Rate</span>
                <input type="number" value={position.rate} onChange={(event) => onPositionChange(index, { rate: Number(event.target.value || 0) })} />
              </label>
              <button className="ghost" type="button" onClick={() => onRemovePosition(index)}>Remove</button>
            </div>
          ))}
          <button className="ghost" type="button" onClick={onAddPosition}>Add position</button>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 6 }}>
        <button className="primary" type="button" onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        <button className="ghost" type="button" onClick={onClose} disabled={saving}>Close</button>
      </div>
    </div>
  );
}
