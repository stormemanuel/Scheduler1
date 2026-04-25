"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CityPoolRecord, CrewGroupRecord, CrewRecord, PositionInput } from "@/lib/crew-types";

type CrewClientProps = {
  cityPools: CityPoolRecord[];
  crewGroups: CrewGroupRecord[];
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

type GroupSummary = {
  name: string;
  count: number;
};

const ALL_GROUPS = "__all_groups__";

function blankDraft(cityPools: CityPoolRecord[], cityId?: string, groupName?: string): CrewDraft {
  const chosenCity = cityPools.find((pool) => pool.id === cityId) || cityPools[0];
  return {
    name: "",
    description: "",
    city_pool_id: chosenCity?.id || "",
    city_name: chosenCity?.name || "",
    group_name: groupName && groupName !== ALL_GROUPS ? groupName : "Ungrouped",
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
    unavailable_dates: draft.unavailable_dates_text.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
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
    positions: draft.positions.filter((item) => item.role_name.trim()).map((item) => ({ role_name: item.role_name.trim(), rate: Number(item.rate || 0) })),
  };
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandRoleAliases(value: string) {
  const normalized = normalizeText(value);
  const aliases = new Set<string>([normalized]);
  const add = (...terms: string[]) => terms.forEach((term) => aliases.add(normalizeText(term)));

  if (normalized.includes("general av") || normalized === "gav") add("general av", "gav");
  if (normalized.includes("breakout") || normalized === "bo") add("breakout", "breakout operator", "bo", "bo op");
  if (normalized.includes("crew lead")) add("crew lead", "lead");
  if (normalized.includes("speaker ready")) add("speaker ready", "sr");
  if (normalized.includes("camera operator")) add("camera operator", "camera");
  if (normalized.includes("video") || normalized === "v2") add("video", "v2", "video assist");
  if (normalized.includes("audio") || normalized === "a2") add("audio", "a2", "audio assist");
  if (normalized.includes("lighting") || normalized === "l2") add("lighting", "l2", "lighting assist");
  if (normalized.includes("led")) add("led", "led assist");
  return Array.from(aliases);
}

function buildSearchText(record: CrewRecord) {
  const parts = [
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
    ...record.positions.flatMap((position) => [position.role_name, ...expandRoleAliases(position.role_name)]),
    ...record.conflict_companies,
  ];
  return normalizeText(parts.filter(Boolean).join(" "));
}

function matchesSearch(record: CrewRecord, query: string) {
  const trimmed = normalizeText(query);
  if (!trimmed) return true;
  const haystack = buildSearchText(record);
  return trimmed.split(" ").every((token) => haystack.includes(token));
}

function groupSummaries(records: CrewRecord[], crewGroups: CrewGroupRecord[], selectedCityId: string) {
  const counts = new Map<string, number>();
  records.forEach((record) => counts.set(record.group_name || "Ungrouped", (counts.get(record.group_name || "Ungrouped") || 0) + 1));
  crewGroups
    .filter((group) => group.city_pool_id === selectedCityId)
    .forEach((group) => counts.set(group.name, counts.get(group.name) || 0));
  if (counts.size === 0) counts.set("Ungrouped", 0);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function CrewClient({ cityPools: initialCityPools, crewGroups: initialGroups, initialCrew }: CrewClientProps) {
  const router = useRouter();
  const [cityPools, setCityPools] = useState(initialCityPools);
  const [crewGroups, setCrewGroups] = useState(initialGroups);
  const [crewRecords, setCrewRecords] = useState(initialCrew);
  const [selectedCityId, setSelectedCityId] = useState<string>(initialCityPools[0]?.id || "");
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_GROUPS);
  const [globalSearch, setGlobalSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
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

  useEffect(() => {
    if (!selectedCityId && cityPools[0]?.id) setSelectedCityId(cityPools[0].id);
  }, [cityPools, selectedCityId]);

  useEffect(() => {
    if (selectedCityId) setBulkCityId((current) => current || selectedCityId);
  }, [selectedCityId]);

  const globallyMatchedCrew = useMemo(() => crewRecords.filter((record) => matchesSearch(record, globalSearch)), [crewRecords, globalSearch]);

  const cityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    cityPools.forEach((pool) => counts.set(pool.id, 0));
    globallyMatchedCrew.forEach((record) => {
      if (record.city_pool_id) counts.set(record.city_pool_id, (counts.get(record.city_pool_id) || 0) + 1);
    });
    return counts;
  }, [cityPools, globallyMatchedCrew]);

  const selectedCity = cityPools.find((pool) => pool.id === selectedCityId) || null;

  const cityScopedCrew = useMemo(() => {
    return globallyMatchedCrew.filter((record) => {
      const cityMatch = !selectedCityId ? true : record.city_pool_id === selectedCityId;
      const cityQueryMatch = matchesSearch(record, citySearch);
      return cityMatch && cityQueryMatch;
    });
  }, [globallyMatchedCrew, selectedCityId, citySearch]);

  const availableGroups = useMemo(() => groupSummaries(cityScopedCrew, crewGroups, selectedCityId), [cityScopedCrew, crewGroups, selectedCityId]);

  useEffect(() => {
    if (selectedGroup !== ALL_GROUPS && !availableGroups.some((group) => group.name === selectedGroup)) {
      setSelectedGroup(ALL_GROUPS);
    }
  }, [availableGroups, selectedGroup]);

  const visibleCrew = useMemo(() => {
    return cityScopedCrew.filter((record) => {
      const groupMatch = selectedGroup === ALL_GROUPS || record.group_name === selectedGroup;
      const groupQueryMatch = matchesSearch(record, groupSearch);
      return groupMatch && groupQueryMatch;
    });
  }, [cityScopedCrew, selectedGroup, groupSearch]);

  const targetGroupsForBulkCity = useMemo(() => {
    const cityId = bulkCityId || selectedCityId;
    const names = new Set<string>(["Ungrouped"]);
    crewRecords.filter((record) => record.city_pool_id === cityId).forEach((record) => names.add(record.group_name || "Ungrouped"));
    crewGroups.filter((group) => group.city_pool_id === cityId).forEach((group) => names.add(group.name));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [bulkCityId, crewGroups, crewRecords, selectedCityId]);

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

  function beginAdd() {
    setAdding(true);
    setEditingId(null);
    setDraft(blankDraft(cityPools, selectedCityId, selectedGroup));
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
      if (nextRecord.city_pool_id) {
        const exists = crewGroups.some((group) => group.city_pool_id === nextRecord.city_pool_id && group.name === nextRecord.group_name);
        if (!exists) setCrewGroups((current) => [...current, { id: `temp-${nextRecord.id}`, city_pool_id: nextRecord.city_pool_id!, name: nextRecord.group_name }]);
      }
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
      setCityPools((current) => [...current.filter((item) => item.id !== city.id), city].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCityId(city.id);
      setBulkCityId(city.id);
      setNewCityName("");
      setSelectedGroup(ALL_GROUPS);
      setMessageKind("success");
      setMessage(`City pool created: ${city.name}`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to add city pool.");
    } finally {
      setSaving(false);
    }
  }

  async function createGroup() {
    if (!selectedCityId || !newGroupName.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/crew-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_pool_id: selectedCityId, name: newGroupName.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to create group.");
      const nextGroup = result.group as CrewGroupRecord;
      setCrewGroups((current) => {
        if (current.some((group) => group.city_pool_id === nextGroup.city_pool_id && group.name === nextGroup.name)) return current;
        return [...current, nextGroup];
      });
      setSelectedGroup(nextGroup.name);
      setBulkGroupName(nextGroup.name);
      setNewGroupName("");
      setMessageKind("success");
      setMessage(`Group created: ${nextGroup.name}`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to create group.");
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function selectVisible() {
    setSelectedIds((current) => Array.from(new Set([...current, ...visibleCrew.map((record) => record.id)])));
  }

  function clearSelected() {
    setSelectedIds([]);
  }

  async function moveSelected() {
    if (!selectedIds.length) return;
    const targetCityId = bulkCityId || selectedCityId;
    const targetGroup = bulkGroupName.trim() || "Ungrouped";
    if (!targetCityId) {
      setMessageKind("error");
      setMessage("Choose a destination city pool.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/crew-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_pool_id: targetCityId, name: targetGroup }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to create destination group.");
      if (result.group) {
        const group = result.group as CrewGroupRecord;
        setCrewGroups((current) => {
          if (current.some((item) => item.city_pool_id === group.city_pool_id && item.name === group.name)) return current;
          return [...current, group];
        });
      }

      const targetCity = cityPools.find((pool) => pool.id === targetCityId);
      for (const record of crewRecords.filter((record) => selectedIds.includes(record.id))) {
        const payload = {
          name: record.name,
          description: record.description,
          city_pool_id: targetCityId,
          city_name: targetCity?.name || record.city_name,
          group_name: targetGroup,
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
        const moveResponse = await fetch(`/api/crew/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const moveResult = await moveResponse.json();
        if (!moveResponse.ok) throw new Error(moveResult.message || `Move failed for ${record.name}.`);
      }

      setCrewRecords((current) =>
        current.map((record) =>
          selectedIds.includes(record.id)
            ? { ...record, city_pool_id: targetCityId, city_name: targetCity?.name || record.city_name, group_name: targetGroup }
            : record
        )
      );
      setSelectedIds([]);
      setMessageKind("success");
      setMessage(`Moved ${selectedIds.length} crew member${selectedIds.length === 1 ? "" : "s"} to ${targetCity?.name || "selected city"} • ${targetGroup}.`);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to move selected crew.");
    } finally {
      setSaving(false);
    }
  }

  const selectedCityCount = cityCounts.get(selectedCityId) || 0;
  const selectedGroupCount = visibleCrew.length;

  return (
    <div className="grid" style={{ gap: 16 }}>
      {message ? (
        <section className="card">
          <p className={messageKind === "error" ? "error" : "success"}>{message}</p>
        </section>
      ) : null}

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

      <section className="grid" style={{ gap: 16, gridTemplateColumns: "280px 280px minmax(0, 1fr)" }}>
        <aside className="card" style={{ alignSelf: "start" }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>City pools</h3>
              <div className="muted small">Main search across all contacts</div>
            </div>
          </div>
          <label className="field" style={{ marginBottom: 12 }}>
            <span>Main search</span>
            <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="New Orleans GAV, camera, Tier 1…" />
          </label>
          <div className="list">
            {cityPools.map((pool) => {
              const active = pool.id === selectedCityId;
              return (
                <button
                  key={pool.id}
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setSelectedCityId(pool.id);
                    setSelectedGroup(ALL_GROUPS);
                    setCitySearch("");
                    setGroupSearch("");
                  }}
                  style={{ textAlign: "left", borderColor: active ? "var(--brand)" : undefined, background: active ? "#f8fafc" : undefined }}
                >
                  <div className="row" style={{ alignItems: "center" }}>
                    <strong>{pool.name}</strong>
                    <span className="badge" style={{ margin: 0 }}>{cityCounts.get(pool.id) || 0}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field">
              <span>Add city pool</span>
              <input value={newCityName} onChange={(event) => setNewCityName(event.target.value)} placeholder="Example: Birmingham, AL" />
            </label>
            <button className="ghost" type="button" onClick={addCityPool} disabled={saving} style={{ marginTop: 10 }}>
              Create city pool
            </button>
          </div>
        </aside>

        <aside className="card" style={{ alignSelf: "start" }}>
          <div style={{ marginBottom: 10 }}>
            <h3 style={{ marginBottom: 6 }}>Groups</h3>
            <div className="muted small">{selectedCity?.name || "Choose a city"} • {selectedCityCount} match{selectedCityCount === 1 ? "" : "es"}</div>
          </div>
          <label className="field" style={{ marginBottom: 12 }}>
            <span>Search in this city</span>
            <input value={citySearch} onChange={(event) => setCitySearch(event.target.value)} placeholder="General AV, owner, phone, notes…" />
          </label>
          <div className="list">
            <button
              type="button"
              className="ghost"
              onClick={() => setSelectedGroup(ALL_GROUPS)}
              style={{ textAlign: "left", borderColor: selectedGroup === ALL_GROUPS ? "var(--brand)" : undefined, background: selectedGroup === ALL_GROUPS ? "#f8fafc" : undefined }}
            >
              <div className="row" style={{ alignItems: "center" }}>
                <strong>All groups</strong>
                <span className="badge" style={{ margin: 0 }}>{cityScopedCrew.length}</span>
              </div>
            </button>
            {availableGroups.map((group) => {
              const active = selectedGroup === group.name;
              return (
                <button
                  key={group.name}
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setSelectedGroup(group.name);
                    setGroupSearch("");
                  }}
                  style={{ textAlign: "left", borderColor: active ? "var(--brand)" : undefined, background: active ? "#f8fafc" : undefined }}
                >
                  <div className="row" style={{ alignItems: "center" }}>
                    <strong>{group.name}</strong>
                    <span className="badge" style={{ margin: 0 }}>{group.count}</span>
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field">
              <span>Create group in {selectedCity?.name || "this city"}</span>
              <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Example: Tier 1 New Orleans" />
            </label>
            <button className="ghost" type="button" onClick={createGroup} disabled={saving || !selectedCityId} style={{ marginTop: 10 }}>
              Create group
            </button>
          </div>
        </aside>

        <section className="card">
          <div className="row" style={{ alignItems: "flex-start", marginBottom: 14 }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>Crew</h3>
              <div className="muted small">
                {selectedCity?.name || "No city selected"} • {selectedGroup === ALL_GROUPS ? "All groups" : selectedGroup} • {selectedGroupCount} visible
              </div>
            </div>
            <div className="toolbar">
              <button className="primary" type="button" onClick={beginAdd}>Add crew member</button>
              <button className="ghost" type="button" onClick={selectVisible}>Select visible</button>
              <button className="ghost" type="button" onClick={clearSelected}>Clear selection</button>
            </div>
          </div>

          <label className="field" style={{ marginBottom: 14 }}>
            <span>Search in this group</span>
            <input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search this group by name, position, tier, OB, conflicts…" />
          </label>

          <div className="grid grid-3" style={{ marginBottom: 14 }}>
            <label className="field">
              <span>Move selected to city</span>
              <select value={bulkCityId} onChange={(event) => setBulkCityId(event.target.value)}>
                {cityPools.map((pool) => (
                  <option key={pool.id} value={pool.id}>{pool.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Move selected to group</span>
              <select value={bulkGroupName} onChange={(event) => setBulkGroupName(event.target.value)}>
                {targetGroupsForBulkCity.map((group) => (
                  <option key={group} value={group}>{group}</option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>{selectedIds.length} selected</span>
              <button className="primary" type="button" onClick={moveSelected} disabled={saving || !selectedIds.length}>Move selected</button>
            </div>
          </div>

          <div className="list">
            {visibleCrew.length === 0 ? (
              <div className="card compact">
                <h3>No crew found</h3>
                <p className="muted">Try a different search, city, or group filter.</p>
              </div>
            ) : visibleCrew.map((record) => {
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
                      <div className="muted small">{record.city_name} • {record.group_name} • {record.tier ? `Tier ${record.tier}` : "No tier"}</div>
                      <div className="muted small">{record.email || "No email"}{record.phone ? ` • ${record.phone}` : ""}{record.ob ? " • OB" : ""}</div>
                    </div>
                    <div className="toolbar" style={{ gap: 8 }}>
                      <button className="ghost" type="button" onClick={() => beginEdit(record)}>{isEditing ? "Editing" : "Edit"}</button>
                      <button className="ghost danger" type="button" onClick={() => deleteRecord(record.id)} disabled={saving}>Delete</button>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    {record.positions.map((position) => (
                      <span key={`${record.id}-${position.role_name}-${position.rate}`} className="badge">
                        {position.role_name}: ${Number(position.rate || 0).toFixed(2)}
                      </span>
                    ))}
                  </div>
                  {record.conflict_companies.length ? <p className="muted small" style={{ marginTop: 10 }}><strong>Conflicts:</strong> {record.conflict_companies.join(", ")}</p> : null}
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
        </section>
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
          <span>Group</span>
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
