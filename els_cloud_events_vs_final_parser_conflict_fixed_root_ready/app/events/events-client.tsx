"use client";

import { useMemo, useRef, useState } from "react";
import type { CrewRecord } from "@/lib/crew-types";
import type {
  AssignmentRecord,
  LaborDayRecord,
  ShowRecord,
  SubCallRecord,
} from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";

type Props = {
  initialShows: ShowRecord[];
  initialLaborDays: LaborDayRecord[];
  initialSubCalls: SubCallRecord[];
  initialAssignments: AssignmentRecord[];
  initialCrew: CrewRecord[];
  masterRates: MasterRateRecord[];
};

type SaveState = { kind: "success" | "error"; text: string } | null;
type ImportMode = "create" | "merge" | "preview";
type ViewMode = "overview" | "edit";
type EventDisplayMode = "day" | "booth";
type EditorMode = "show" | "day" | "call" | null;

type ImportPreviewState = {
  show: {
    name: string;
    client: string;
    venue: string;
    rate_city: string;
    show_start: string;
    show_end: string;
    notes: string;
  };
  laborDays: Array<{ labor_date: string; label: string; notes: string }>;
  subCallPreview: Array<{
    key: string;
    labor_date: string;
    area: string;
    role_name: string;
    start_time: string;
    end_time: string;
    crew_needed: number;
    matchedCrew: Array<{ name: string; crew_id: string }>;
    unmatchedCrew: string[];
  }>;
  matchedCrewCount: number;
  unmatchedCrewCount: number;
  sourceType: string;
};

const emptyShow = {
  name: "",
  client: "",
  venue: "",
  rate_city: "Default",
  show_start: "",
  show_end: "",
  notes: "",
};

const emptyDay = {
  labor_date: "",
  label: "",
  notes: "",
};

const emptyCall = {
  area: "",
  role_name: "",
  start_time: "",
  end_time: "",
  crew_needed: "1",
  notes: "",
};

const emptyImport = {
  show_name: "",
  client: "",
  venue: "",
  rate_city: "Default",
  show_start: "",
  show_end: "",
  notes: "",
};

const roleAliases: Record<string, string[]> = {
  "general av": ["gav", "avt", "av tech", "audio visual tech", "audio visual technician"],
  gav: ["general av"],
  avt: ["general av"],
  "led assist": ["led", "led stagehand", "led tech", "led technician"],
  "led stagehand": ["led assist"],
  led: ["led assist"],
  "client facing audio visual tech": ["cf avt", "client facing avt", "client facing av tech", "client facing audiovisual tech"],
  "cf avt": ["client facing audio visual tech"],
  "client facing avt": ["client facing audio visual tech"],
  "client facing av tech": ["client facing audio visual tech"],
  "breakout operator": ["bo"],
  bo: ["breakout operator"],
  "audio assist": ["a2"],
  a2: ["audio assist"],
  "video assist": ["v2"],
  v2: ["video assist"],
  "lighting assist": ["l2"],
  l2: ["lighting assist"],
  "crew lead": ["lead"],
};

const fallbackRoleRates: Record<string, { full_day: number; half_day: number | null }> = {
  "client facing audio visual tech": { full_day: 400, half_day: 200 },
};

const venueToPoolHints = [
  { pool: "New Orleans, LA", hints: ["mccno", "ernest morial", "new orleans"] },
  { pool: "Nashville, TN", hints: ["music city center", "nashville"] },
  { pool: "Atlanta, GA", hints: ["atlanta"] },
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(value: string | null | undefined) {
  return String(value || "").trim();
}

function showBucket(show: ShowRecord) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(`${show.show_start}T00:00:00`);
  const end = new Date(`${show.show_end}T00:00:00`);
  if (end < today) return "Past";
  if (start > today) return "Upcoming";
  return "Current";
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]) {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return value;
}

function formatClock(value: string | null | undefined) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value || "");
  let hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${suffix}`;
}

function formatTimeRange(call: SubCallRecord) {
  const start = formatClock(call.start_time);
  const end = call.end_time ? formatClock(call.end_time) : "";
  return end ? `${start} - ${end}` : start;
}

function boothLabel(area: string) {
  return safeText(area) || "Unassigned booth / area";
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function roleKeys(roleName: string) {
  const target = normalize(roleName);
  const keys = new Set([target, ...(roleAliases[target] ?? [])].filter(Boolean));

  for (const [canonical, aliases] of Object.entries(roleAliases)) {
    if (canonical === target || aliases.includes(target)) {
      keys.add(canonical);
      aliases.forEach((alias) => keys.add(alias));
    }
  }

  return keys;
}

function matchesRole(crew: CrewRecord, roleName: string) {
  const keys = roleKeys(roleName);
  const target = normalize(roleName);
  return crew.positions.some((position) => {
    const role = normalize(position.role_name);
    return keys.has(role) || role.includes(target) || target.includes(role);
  });
}

function minutesFromTime(value: string | null | undefined) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function callDurationHours(call: SubCallRecord) {
  const start = minutesFromTime(call.start_time);
  const end = minutesFromTime(call.end_time);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
}

function rateForCall(call: SubCallRecord, rateCity: string, masterRates: MasterRateRecord[]) {
  const keys = roleKeys(call.role_name);
  const isRateMatch = (rate: MasterRateRecord, city: string) =>
    normalize(rate.city_name) === normalize(city) && keys.has(normalize(rate.role_name));

  const override = masterRates.find((rate) => isRateMatch(rate, rateCity));
  const fallback = masterRates.find((rate) => isRateMatch(rate, "Default"));
  const databaseRate = override ?? fallback;
  const builtInRate = fallbackRoleRates[[...keys].find((key) => fallbackRoleRates[key]) || ""];

  const fullDay = databaseRate?.full_day ?? builtInRate?.full_day ?? 0;
  const halfDay = databaseRate?.half_day ?? builtInRate?.half_day ?? null;
  const duration = callDurationHours(call);
  const useHalfDay = duration !== null && duration <= 5 && halfDay !== null;

  return useHalfDay ? halfDay : fullDay;
}

function resolveEventPool(show: ShowRecord | null, crewRecords: CrewRecord[]) {
  if (!show) return null;

  const cities = [...new Set(crewRecords.map((crew) => crew.city_name).filter(Boolean))];
  const haystack = normalize([show.rate_city, show.venue, show.notes, show.name].join(" "));

  if (show.rate_city && normalize(show.rate_city) !== "default") {
    const exact = cities.find((city) => normalize(city) === normalize(show.rate_city));
    if (exact) return exact;

    const fuzzy = cities.find(
      (city) =>
        normalize(city).includes(normalize(show.rate_city)) ||
        normalize(show.rate_city).includes(normalize(city))
    );
    if (fuzzy) return fuzzy;
  }

  for (const hint of venueToPoolHints) {
    if (hint.hints.some((item) => haystack.includes(normalize(item)))) {
      const city = cities.find((name) => normalize(name) === normalize(hint.pool));
      return city ?? hint.pool;
    }
  }

  const venueMatch = cities.find((city) => haystack.includes(normalize(city)));
  return venueMatch ?? null;
}

export default function EventsClient({
  initialShows,
  initialLaborDays,
  initialSubCalls,
  initialAssignments,
  initialCrew,
  masterRates,
}: Props) {
  const [shows, setShows] = useState(initialShows);
  const [laborDays, setLaborDays] = useState(initialLaborDays);
  const [subCalls, setSubCalls] = useState(initialSubCalls);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [crewRecords] = useState(initialCrew);

  const [search, setSearch] = useState("");
  const [selectedShowId, setSelectedShowId] = useState<string | null>(initialShows[0]?.id ?? null);
  const [expandedDayIds, setExpandedDayIds] = useState<string[]>(initialLaborDays[0]?.id ? [initialLaborDays[0].id] : []);
  const [crewPickerCallId, setCrewPickerCallId] = useState<string | null>(null);
  const [crewSearch, setCrewSearch] = useState("");
  const [crewGroupFilter, setCrewGroupFilter] = useState("All groups");

  const [viewMode, setViewMode] = useState<ViewMode>("overview");
  const [eventDisplayMode, setEventDisplayMode] = useState<EventDisplayMode>("day");
  const [editorMode, setEditorMode] = useState<EditorMode>(null);

  const [showForm, setShowForm] = useState(emptyShow);
  const [dayForm, setDayForm] = useState(emptyDay);
  const [callForm, setCallForm] = useState(emptyCall);
  const [editingShowId, setEditingShowId] = useState<string | null>(null);
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [editingDayTargetId, setEditingDayTargetId] = useState<string | null>(null);

  const [msg, setMsg] = useState<SaveState>(null);
  const [saving, setSaving] = useState(false);

  const [importMode, setImportMode] = useState<ImportMode>("create");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importForm, setImportForm] = useState(emptyImport);
  const [importPreview, setImportPreview] = useState<ImportPreviewState | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredShows = useMemo(() => {
    const token = normalize(search);
    const sorted = [...shows].sort((a, b) => a.show_start.localeCompare(b.show_start));
    if (!token) return sorted;
    return sorted.filter((show) =>
      normalize([
        show.name,
        show.client,
        show.venue,
        show.rate_city,
        showBucket(show),
      ].join(" ")).includes(token)
    );
  }, [shows, search]);

  const showsByBucket = useMemo(
    () => ({
      Upcoming: filteredShows.filter((show) => showBucket(show) === "Upcoming"),
      Current: filteredShows.filter((show) => showBucket(show) === "Current"),
      Past: filteredShows.filter((show) => showBucket(show) === "Past"),
    }),
    [filteredShows]
  );

  const selectedShow = shows.find((show) => show.id === selectedShowId) ?? filteredShows[0] ?? null;

  const visibleLaborDays = useMemo(() => {
    if (!selectedShow) return [] as LaborDayRecord[];
    return laborDays
      .filter((day) => day.show_id === selectedShow.id)
      .sort((a, b) => a.labor_date.localeCompare(b.labor_date));
  }, [laborDays, selectedShow]);

  const estimate = useMemo(() => {
    if (!selectedShow) return 0;
    const rateCity = selectedShow.rate_city || "Default";
    const allDayIds = laborDays.filter((day) => day.show_id === selectedShow.id).map((day) => day.id);
    const allCalls = subCalls.filter((call) => allDayIds.includes(call.labor_day_id));
    return allCalls.reduce((sum, call) => {
      const rate = rateForCall(call, rateCity, masterRates);
      return sum + rate * Math.max(1, Number(call.crew_needed || 0));
    }, 0);
  }, [selectedShow, laborDays, subCalls, masterRates]);

  const activeCrewCall = subCalls.find((call) => call.id === crewPickerCallId) ?? null;
  const activeCrewDay = activeCrewCall
    ? laborDays.find((day) => day.id === activeCrewCall.labor_day_id) ?? null
    : null;
  const eventPool = resolveEventPool(selectedShow, crewRecords);

  const assignedCrew = useMemo(() => {
    if (!activeCrewCall) return [] as Array<{ assignment: AssignmentRecord; crew: CrewRecord | undefined }>;
    return assignments
      .filter((assignment) => assignment.sub_call_id === activeCrewCall.id)
      .map((assignment) => ({
        assignment,
        crew: crewRecords.find((crew) => crew.id === assignment.crew_id),
      }));
  }, [assignments, crewRecords, activeCrewCall]);

  const poolGroups = useMemo(() => {
    const poolCrew = crewRecords.filter((crew) => !eventPool || normalize(crew.city_name) === normalize(eventPool));
    const groups: string[] = [...new Set(poolCrew.map((crew) => crew.group_name || "Ungrouped"))].sort((a, b) => a.localeCompare(b));
    return ["All groups", ...groups];
  }, [crewRecords, eventPool]);

  const availableCrew = useMemo(() => {
    if (!activeCrewCall || !activeCrewDay) return [] as CrewRecord[];
    const token = normalize(crewSearch);
    const alreadyAssigned = new Set(assignedCrew.map((item) => item.assignment.crew_id));

    const poolCrew = crewRecords.filter((crew) => {
      if (alreadyAssigned.has(crew.id)) return false;
      if (eventPool && normalize(crew.city_name) !== normalize(eventPool)) return false;
      if (crewGroupFilter !== "All groups" && (crew.group_name || "Ungrouped") !== crewGroupFilter) return false;
      if (crew.unavailable_dates.includes(activeCrewDay.labor_date)) return false;
      if (!token) return true;
      return normalize([
        crew.name,
        crew.city_name,
        crew.group_name,
        crew.tier,
        crew.email,
        crew.phone,
        crew.notes,
        crew.positions.map((position) => position.role_name).join(" "),
      ].join(" ")).includes(token);
    });

    return poolCrew.sort((a, b) => {
      const aMatch = matchesRole(a, activeCrewCall.role_name) ? 1 : 0;
      const bMatch = matchesRole(b, activeCrewCall.role_name) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return a.name.localeCompare(b.name);
    });
  }, [activeCrewCall, activeCrewDay, assignedCrew, crewGroupFilter, crewRecords, crewSearch, eventPool]);

  const displayCalls = useMemo(() => {
    return visibleLaborDays
      .flatMap((day) =>
        subCalls
          .filter((call) => call.labor_day_id === day.id)
          .map((call) => ({
            day,
            call,
            callAssignments: assignments
              .filter((assignment) => assignment.sub_call_id === call.id)
              .map((assignment) => ({
                assignment,
                crew: crewRecords.find((crew) => crew.id === assignment.crew_id),
              })),
          }))
      )
      .sort((a, b) => {
        const dateCompare = a.day.labor_date.localeCompare(b.day.labor_date);
        if (dateCompare !== 0) return dateCompare;
        const areaCompare = boothLabel(a.call.area).localeCompare(boothLabel(b.call.area));
        if (areaCompare !== 0) return areaCompare;
        return a.call.start_time.localeCompare(b.call.start_time);
      });
  }, [visibleLaborDays, subCalls, assignments, crewRecords]);

  const boothSections = useMemo(() => {
    const map = new Map<string, typeof displayCalls>();
    for (const item of displayCalls) {
      const key = boothLabel(item.call.area);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()]
      .map(([booth, calls]) => ({
        booth,
        calls: calls.sort((a, b) => {
          const dateCompare = a.day.labor_date.localeCompare(b.day.labor_date);
          if (dateCompare !== 0) return dateCompare;
          return a.call.start_time.localeCompare(b.call.start_time);
        }),
      }))
      .sort((a, b) => a.booth.localeCompare(b.booth));
  }, [displayCalls]);

  function getCallAssignments(callId: string) {
    return assignments
      .filter((assignment) => assignment.sub_call_id === callId)
      .map((assignment) => ({
        assignment,
        crew: crewRecords.find((crew) => crew.id === assignment.crew_id),
      }));
  }

  function openCrewPickerForCall(callId: string) {
    setCrewPickerCallId(crewPickerCallId === callId ? null : callId);
    setCrewSearch("");
    setCrewGroupFilter("All groups");
  }

  function renderCrewPicker(call: SubCallRecord) {
    return (
      <div className="card compact" style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <strong>Add Crew</strong>
            <div className="small muted">{call.area} • {call.role_name}</div>
            <div className="small muted">Pool: {eventPool || "All crew"}</div>
          </div>
          <span className="small muted">Role matches are suggested first. Anyone in the pool can be assigned.</span>
        </div>
        <label className="field"><span>Search this pool</span><input value={crewSearch} onChange={(e) => setCrewSearch(e.target.value)} placeholder="Name, group, role, phone..." /></label>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          {poolGroups.map((group) => (
            <button
              key={group}
              type="button"
              className={crewGroupFilter === group ? "primary" : "ghost"}
              onClick={() => setCrewGroupFilter(group)}
            >
              {group}
            </button>
          ))}
        </div>
        <div className="list" style={{ maxHeight: 260, overflowY: "auto", marginTop: 12 }}>
          {availableCrew.length ? availableCrew.map((crew) => (
            <div key={crew.id} className="row small">
              <div>
                <strong>{crew.name}</strong>
                <div className="muted">{crew.city_name} • {crew.group_name || "Ungrouped"} • {crew.positions.map((position) => position.role_name).join(", ") || "No saved positions"}</div>
                {matchesRole(crew, call.role_name) ? <div className="small">Suggested role match</div> : <div className="small muted">Available in this pool</div>}
              </div>
              <button type="button" className="ghost" onClick={() => addCrewToCall(crew.id)}>Add</button>
            </div>
          )) : <div className="small muted">No available crew in this pool for this search.</div>}
        </div>
      </div>
    );
  }

  function renderCallCard(day: LaborDayRecord, call: SubCallRecord, showDate = false) {
    const callAssignments = getCallAssignments(call.id);
    const isCrewOpen = crewPickerCallId === call.id;
    return (
      <div key={call.id} className="card compact">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <strong>{showDate ? `${day.labor_date} • ` : ""}{formatTimeRange(call)}</strong>
            <div className="small muted">{call.area} • {call.role_name}</div>
            <div className="small muted">{callAssignments.length}/{call.crew_needed} assigned</div>
          </div>
          <div className="toolbar">
            <button type="button" className="ghost" onClick={() => startEditCall(day.id, call)}>Edit</button>
            <button type="button" className="ghost" onClick={() => openCrewPickerForCall(call.id)}>Add Crew</button>
            <button type="button" className="ghost danger" onClick={() => deleteCall(call.id)}>Delete</button>
          </div>
        </div>

        {editorMode === "call" && editingCallId === call.id ? renderEditorPanel() : null}

        {callAssignments.length ? (
          <div className="list" style={{ marginTop: 10 }}>
            {callAssignments.map(({ assignment, crew }) => (
              <div key={assignment.id} className="row small">
                <div>
                  <strong>{crew?.name || assignment.crew_id}</strong>
                  <span className="muted"> • {crew?.phone ? formatPhone(crew.phone) : "No phone"} • {assignment.status}</span>
                </div>
                <button type="button" className="ghost danger" onClick={() => removeCrewFromCall(assignment.id)}>Remove</button>
              </div>
            ))}
          </div>
        ) : <div className="small muted" style={{ marginTop: 10 }}>No crew assigned yet.</div>}

        {isCrewOpen ? renderCrewPicker(call) : null}
      </div>
    );
  }

  function toggleDay(dayId: string) {

    setExpandedDayIds((current) =>
      current.includes(dayId) ? current.filter((id) => id !== dayId) : [...current, dayId]
    );
  }

  function startAddEvent() {
    setViewMode("edit");
    setEditorMode("show");
    setEditingShowId(null);
    setShowForm(emptyShow);
  }

  function startEditEvent(show: ShowRecord) {
    setViewMode("edit");
    setEditorMode("show");
    setEditingShowId(show.id);
    setShowForm({
      name: show.name,
      client: show.client,
      venue: show.venue,
      rate_city: show.rate_city,
      show_start: show.show_start,
      show_end: show.show_end,
      notes: show.notes,
    });
  }

  function startAddDay() {
    setViewMode("edit");
    setEditorMode("day");
    setEditingDayId(null);
    setDayForm(emptyDay);
  }

  function startEditDay(day: LaborDayRecord) {
    setViewMode("edit");
    setEditorMode("day");
    setEditingDayId(day.id);
    setDayForm({ labor_date: day.labor_date, label: day.label, notes: day.notes });
  }

  function startAddCall(dayId: string) {
    setViewMode("edit");
    setEditorMode("call");
    setEditingCallId(null);
    setEditingDayTargetId(dayId);
    setCallForm(emptyCall);
  }

  function startEditCall(dayId: string, call: SubCallRecord) {
    setViewMode("edit");
    setEditorMode("call");
    setEditingCallId(call.id);
    setEditingDayTargetId(dayId);
    setCallForm({
      area: call.area,
      role_name: call.role_name,
      start_time: call.start_time,
      end_time: call.end_time || "",
      crew_needed: String(call.crew_needed),
      notes: call.notes,
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
      const text = error instanceof Error ? error.message : "Request failed.";
      setMsg({ kind: "error", text });
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function previewImportFile() {
    if (!importFile) {
      setMsg({ kind: "error", text: "Choose a CSV or PDF file to import." });
      return;
    }
    setImporting(true);
    setMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      Object.entries(importForm).forEach(([key, value]) => formData.append(key, String(value)));
      const res = await fetch("/api/events/import-preview", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Preview failed.");
      setImportPreview(data as ImportPreviewState);
      setMsg({ kind: "success", text: data.message || "Preview ready." });
    } catch (error) {
      setImportPreview(null);
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Preview failed." });
    } finally {
      setImporting(false);
    }
  }

  async function runImport() {
    if (!importFile) {
      setMsg({ kind: "error", text: "Choose a CSV or PDF file to import." });
      return;
    }
    if (importMode === "preview") {
      await previewImportFile();
      return;
    }
    setImporting(true);
    setMsg(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("mode", importMode);
      if (importMode === "merge" && selectedShowId) formData.append("target_show_id", selectedShowId);
      Object.entries(importForm).forEach(([key, value]) => formData.append(key, String(value)));
      const res = await fetch("/api/events/import", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Import failed.");

      const nextShow: ShowRecord = {
        id: String(data.show.id),
        name: safeText(data.show.name),
        client: safeText(data.show.client),
        venue: safeText(data.show.venue),
        rate_city: safeText(data.show.rate_city) || "Default",
        show_start: safeText(data.show.show_start),
        show_end: safeText(data.show.show_end),
        notes: safeText(data.show.notes),
      };
      const nextDays: LaborDayRecord[] = (data.laborDays ?? []).map((row: LaborDayRecord) => ({
        id: String(row.id),
        show_id: String(row.show_id),
        labor_date: safeText(row.labor_date),
        label: safeText(row.label),
        notes: safeText(row.notes),
      }));
      const nextCalls: SubCallRecord[] = (data.subCalls ?? []).map((row: SubCallRecord) => ({
        id: String(row.id),
        labor_day_id: String(row.labor_day_id),
        area: safeText(row.area),
        role_name: safeText(row.role_name),
        start_time: safeText(row.start_time),
        end_time: safeText(row.end_time),
        crew_needed: Number(row.crew_needed || 1),
        notes: safeText(row.notes),
      }));
      const nextAssignments: AssignmentRecord[] = (data.assignments ?? []).map((row: AssignmentRecord) => ({
        id: String(row.id),
        sub_call_id: String(row.sub_call_id),
        crew_id: String(row.crew_id),
        status: safeText(row.status) || "confirmed",
      }));

      setShows((current) => mergeById(current, [nextShow]).sort((a, b) => a.show_start.localeCompare(b.show_start)));
      setLaborDays((current) => mergeById(current, nextDays).sort((a, b) => a.labor_date.localeCompare(b.labor_date)));
      setSubCalls((current) => mergeById(current, nextCalls).sort((a, b) => a.start_time.localeCompare(b.start_time)));
      setAssignments((current) => mergeById(current, nextAssignments));
      setSelectedShowId(nextShow.id);
      setExpandedDayIds(nextDays.slice(0, 1).map((day) => day.id));
      setImportPreview(null);
      setImportFile(null);
      setImportForm(emptyImport);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMsg({ kind: "success", text: data.message || "Import complete." });
    } catch (error) {
      setMsg({ kind: "error", text: error instanceof Error ? error.message : "Import failed." });
    } finally {
      setImporting(false);
    }
  }

  function exportCrewList() {
    if (!selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }

    const buildRows = (call: SubCallRecord) => {
      const callAssignments = getCallAssignments(call.id);
      if (!callAssignments.length) {
        return `<tr><td colspan="5" class="empty">No crew assigned yet.</td></tr>`;
      }
      return callAssignments
        .map(({ assignment, crew }) => `<tr><td>${escapeHtml(crew?.name || assignment.crew_id)}</td><td>${escapeHtml(formatTimeRange(call))}</td><td>${escapeHtml(call.role_name)}</td><td>${escapeHtml(crew ? formatPhone(crew.phone) : "")}</td><td>${escapeHtml(assignment.status)}</td></tr>`)
        .join("");
    };

    const dayHtml = visibleLaborDays
      .map((day) => {
        const dayCalls = displayCalls.filter((item) => item.day.id === day.id);
        return `
          <div class="day-break">
            <h2>${escapeHtml(day.labor_date)}${day.label ? ` — ${escapeHtml(day.label)}` : ""}</h2>
          </div>
          ${dayCalls.length
            ? dayCalls
                .map(({ call }) => `
                  <div class="section">
                    <h3>${escapeHtml(boothLabel(call.area))}</h3>
                    <div class="muted">${escapeHtml(call.role_name)} • ${escapeHtml(formatTimeRange(call))} • ${escapeHtml(call.crew_needed)} needed</div>
                    <table>
                      <thead><tr><th>Name</th><th>Times</th><th>Position</th><th>Contact Number</th><th>Status</th></tr></thead>
                      <tbody>${buildRows(call)}</tbody>
                    </table>
                  </div>`)
                .join("")
            : `<p class="empty">No sub-calls for this day.</p>`}`;
      })
      .join("");

    const boothHtml = boothSections
      .map((section) => {
        const dates = [...new Set(section.calls.map((item) => item.day.labor_date))];
        return `
          <div class="booth-break">
            <h2>${escapeHtml(section.booth)}</h2>
          </div>
          ${dates
            .map((date) => {
              const callsForDate = section.calls.filter((item) => item.day.labor_date === date);
              return `
                <div class="date-group">
                  <h3>${escapeHtml(date)}</h3>
                  ${callsForDate
                    .map(({ call }) => `
                      <div class="section">
                        <div class="muted">${escapeHtml(call.role_name)} • ${escapeHtml(formatTimeRange(call))} • ${escapeHtml(call.crew_needed)} needed</div>
                        <table>
                          <thead><tr><th>Name</th><th>Times</th><th>Position</th><th>Contact Number</th><th>Status</th></tr></thead>
                          <tbody>${buildRows(call)}</tbody>
                        </table>
                      </div>`)
                    .join("")}
                </div>`;
            })
            .join("")}`;
      })
      .join("");

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(selectedShow.name)} Crew List</title>
<style>
body{font-family:Arial,sans-serif;margin:32px;color:#111827}h1,h2,h3{margin:0 0 8px 0}.muted{color:#6b7280}.section{margin:14px 0 22px 0}table{width:100%;border-collapse:collapse;margin-top:8px;break-inside:avoid}th,td{border:1px solid #d1d5db;padding:8px;font-size:13px;text-align:left;vertical-align:top}th{background:#f3f4f6}.empty{font-style:italic;color:#6b7280}.day-break,.booth-break{border-top:3px solid #111827;margin-top:28px;padding-top:14px;background:#f9fafb;padding-left:10px;padding-bottom:6px}.date-group{border-left:4px solid #d1d5db;margin:14px 0 24px 0;padding-left:12px}.header{border-bottom:2px solid #111827;margin-bottom:20px;padding-bottom:14px}.meta{display:grid;grid-template-columns:140px 1fr;gap:4px 12px;font-size:14px}.view-label{display:inline-block;border:1px solid #d1d5db;border-radius:999px;padding:4px 10px;font-size:12px;margin-top:10px}@media print{body{margin:18px}.day-break,.booth-break{break-before:auto}button{display:none}}
</style>
</head>
<body>
  <div class="header">
    <h1>Emanuel Labor Services Labor Call List</h1>
    <h2>${escapeHtml(selectedShow.name)}</h2>
    <div class="meta">
      <strong>Client:</strong><span>${escapeHtml(selectedShow.client || "")}</span>
      <strong>Venue:</strong><span>${escapeHtml(selectedShow.venue || "")}</span>
      <strong>Dates:</strong><span>${escapeHtml(selectedShow.show_start)} – ${escapeHtml(selectedShow.show_end)}</span>
      <strong>View:</strong><span>${eventDisplayMode === "booth" ? "Booth-separated" : "Day-separated"}</span>
    </div>
    <div class="view-label">${eventDisplayMode === "booth" ? "Grouped by booth / area" : "Grouped by labor day"}</div>
  </div>
  ${eventDisplayMode === "booth" ? boothHtml || `<p class="empty">No booth/sub-call information found.</p>` : dayHtml || `<p class="empty">No labor days found.</p>`}
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedShow.name.replace(/[^a-z0-9]+/gi, "_")}_${eventDisplayMode}_crew_list.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function addCrewToCall(crewId: string) {
    if (!activeCrewCall) return;
    const data = await request("/api/assignments", "POST", {
      sub_call_id: activeCrewCall.id,
      crew_id: crewId,
      status: "confirmed",
    });
    if (data?.row) {
      setAssignments((current) => {
        const next = current.filter(
          (assignment) => !(assignment.sub_call_id === data.row.sub_call_id && assignment.crew_id === data.row.crew_id)
        );
        return [...next, data.row];
      });
    }
  }

  async function removeCrewFromCall(assignmentId: string) {
    await request(`/api/assignments/${assignmentId}`, "DELETE");
    setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId));
  }

  async function saveShow() {
    const payload = {
      ...showForm,
      name: showForm.name.trim(),
      client: showForm.client.trim(),
      venue: showForm.venue.trim(),
      rate_city: showForm.rate_city.trim() || "Default",
      notes: showForm.notes.trim(),
    };
    if (!payload.name || !payload.show_start || !payload.show_end) {
      setMsg({ kind: "error", text: "Show name, start, and end are required." });
      return;
    }
    const data = editingShowId
      ? await request(`/api/shows/${editingShowId}`, "PATCH", payload)
      : await request("/api/shows", "POST", payload);
    const nextShow: ShowRecord = editingShowId ? { id: editingShowId, ...payload } : { id: data.id, ...payload };
    setShows((current) =>
      editingShowId
        ? current.map((show) => (show.id === editingShowId ? nextShow : show))
        : [...current, nextShow].sort((a, b) => a.show_start.localeCompare(b.show_start))
    );
    setSelectedShowId(nextShow.id);
    setEditingShowId(null);
    setShowForm(emptyShow);
    setEditorMode(null);
    setViewMode("overview");
  }

  async function deleteShow(id: string) {
    if (!confirm("Delete this show, its labor days, and its sub-calls?")) return;
    await request(`/api/shows/${id}`, "DELETE");
    const nextDayIds = laborDays.filter((day) => day.show_id === id).map((day) => day.id);
    const nextCallIds = subCalls.filter((call) => nextDayIds.includes(call.labor_day_id)).map((call) => call.id);
    setAssignments((current) => current.filter((assignment) => !nextCallIds.includes(assignment.sub_call_id)));
    setSubCalls((current) => current.filter((call) => !nextDayIds.includes(call.labor_day_id)));
    setLaborDays((current) => current.filter((day) => day.show_id !== id));
    setShows((current) => current.filter((show) => show.id !== id));
    if (selectedShowId === id) {
      setSelectedShowId(null);
      setExpandedDayIds([]);
      setCrewPickerCallId(null);
    }
  }

  async function saveDay() {
    if (!selectedShow) {
      setMsg({ kind: "error", text: "Select a show first." });
      return;
    }
    const payload = {
      show_id: selectedShow.id,
      labor_date: dayForm.labor_date,
      label: dayForm.label.trim(),
      notes: dayForm.notes.trim(),
    };
    if (!payload.labor_date) {
      setMsg({ kind: "error", text: "Labor day date is required." });
      return;
    }
    const data = editingDayId
      ? await request(`/api/labor-days/${editingDayId}`, "PATCH", payload)
      : await request("/api/labor-days", "POST", payload);
    const nextDay: LaborDayRecord = editingDayId ? { id: editingDayId, ...payload } : { id: data.id, ...payload };
    setLaborDays((current) =>
      editingDayId
        ? current.map((day) => (day.id === editingDayId ? nextDay : day))
        : [...current, nextDay].sort((a, b) => a.labor_date.localeCompare(b.labor_date))
    );
    setExpandedDayIds((current) => (current.includes(nextDay.id) ? current : [...current, nextDay.id]));
    setEditingDayId(null);
    setDayForm(emptyDay);
    setEditorMode(null);
    setViewMode("overview");
  }

  async function deleteDay(id: string) {
    if (!confirm("Delete this labor day and its sub-calls?")) return;
    await request(`/api/labor-days/${id}`, "DELETE");
    const callIds = subCalls.filter((call) => call.labor_day_id === id).map((call) => call.id);
    setAssignments((current) => current.filter((assignment) => !callIds.includes(assignment.sub_call_id)));
    setSubCalls((current) => current.filter((call) => call.labor_day_id !== id));
    setLaborDays((current) => current.filter((day) => day.id !== id));
    setExpandedDayIds((current) => current.filter((dayId) => dayId !== id));
  }

  async function saveCall() {
    const targetDayId = editingDayTargetId ?? visibleLaborDays[0]?.id ?? null;
    if (!targetDayId) {
      setMsg({ kind: "error", text: "Choose a labor day first." });
      return;
    }
    const payload = {
      labor_day_id: targetDayId,
      area: callForm.area.trim(),
      role_name: callForm.role_name.trim(),
      start_time: callForm.start_time,
      end_time: callForm.end_time,
      crew_needed: Number(callForm.crew_needed || 1),
      notes: callForm.notes.trim(),
    };
    if (!payload.area || !payload.role_name || !payload.start_time) {
      setMsg({ kind: "error", text: "Area, role, and start time are required." });
      return;
    }
    const data = editingCallId
      ? await request(`/api/sub-calls/${editingCallId}`, "PATCH", payload)
      : await request("/api/sub-calls", "POST", payload);
    const nextCall: SubCallRecord = editingCallId ? { id: editingCallId, ...payload } : { id: data.id, ...payload };
    setSubCalls((current) =>
      editingCallId
        ? current.map((call) => (call.id === editingCallId ? nextCall : call))
        : [...current, nextCall].sort((a, b) => a.start_time.localeCompare(b.start_time))
    );
    setEditingCallId(null);
    setEditingDayTargetId(null);
    setCallForm(emptyCall);
    setCrewPickerCallId(nextCall.id);
    setEditorMode(null);
    setViewMode("overview");
  }

  async function deleteCall(id: string) {
    if (!confirm("Delete this sub-call?")) return;
    await request(`/api/sub-calls/${id}`, "DELETE");
    setAssignments((current) => current.filter((assignment) => assignment.sub_call_id !== id));
    setSubCalls((current) => current.filter((call) => call.id !== id));
    if (crewPickerCallId === id) setCrewPickerCallId(null);
  }


  function renderEditorPanel() {
    if (!editorMode) return null;

    return (
      <div className="card compact" style={{ borderColor: "#111827", marginTop: 12 }}>
        <div className="row">
          <div style={{ fontWeight: 800 }}>
            {editorMode === "show" ? (editingShowId ? "Edit event" : "Add event") : null}
            {editorMode === "day" ? (editingDayId ? "Edit labor day" : "Add labor day") : null}
            {editorMode === "call" ? (editingCallId ? "Edit sub-call" : "Add sub-call") : null}
          </div>
          <button type="button" className="ghost" onClick={() => { setEditorMode(null); setViewMode("overview"); }}>
            Done editing
          </button>
        </div>

        {editorMode === "show" ? (
          <div className="grid" style={{ gap: 14, marginTop: 12 }}>
            <div className="grid grid-2">
              <label className="field"><span>Show name</span><input value={showForm.name} onChange={(e) => setShowForm((c) => ({ ...c, name: e.target.value }))} /></label>
              <label className="field"><span>Client</span><input value={showForm.client} onChange={(e) => setShowForm((c) => ({ ...c, client: e.target.value }))} /></label>
            </div>
            <label className="field"><span>Venue</span><input value={showForm.venue} onChange={(e) => setShowForm((c) => ({ ...c, venue: e.target.value }))} /></label>
            <div className="grid grid-2">
              <label className="field"><span>Rate city</span><input value={showForm.rate_city} onChange={(e) => setShowForm((c) => ({ ...c, rate_city: e.target.value }))} /></label>
              <div className="grid grid-2">
                <label className="field"><span>Show start</span><input type="date" value={showForm.show_start} onChange={(e) => setShowForm((c) => ({ ...c, show_start: e.target.value }))} /></label>
                <label className="field"><span>Show end</span><input type="date" value={showForm.show_end} onChange={(e) => setShowForm((c) => ({ ...c, show_end: e.target.value }))} /></label>
              </div>
            </div>
            <label className="field"><span>Notes</span><textarea rows={3} value={showForm.notes} onChange={(e) => setShowForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveShow}>{saving ? "Saving..." : editingShowId ? "Save Event" : "Add Event"}</button>
              <button type="button" className="ghost" onClick={() => { setEditingShowId(null); setShowForm(emptyShow); setEditorMode(null); setViewMode("overview"); }}>Cancel</button>
            </div>
          </div>
        ) : null}

        {editorMode === "day" ? (
          <div className="grid" style={{ gap: 14, marginTop: 12 }}>
            <div className="grid grid-2">
              <label className="field"><span>Date</span><input type="date" value={dayForm.labor_date} onChange={(e) => setDayForm((c) => ({ ...c, labor_date: e.target.value }))} /></label>
              <label className="field"><span>Label</span><input value={dayForm.label} onChange={(e) => setDayForm((c) => ({ ...c, label: e.target.value }))} placeholder="Load in, show day, strike..." /></label>
            </div>
            <label className="field"><span>Notes</span><textarea rows={3} value={dayForm.notes} onChange={(e) => setDayForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveDay}>{saving ? "Saving..." : editingDayId ? "Save Labor Day" : "Add Labor Day"}</button>
              <button type="button" className="ghost" onClick={() => { setEditingDayId(null); setDayForm(emptyDay); setEditorMode(null); setViewMode("overview"); }}>Cancel</button>
            </div>
          </div>
        ) : null}

        {editorMode === "call" ? (
          <div className="grid" style={{ gap: 14, marginTop: 12 }}>
            <div className="small muted">Labor day: {visibleLaborDays.find((day) => day.id === editingDayTargetId)?.labor_date || "None selected"}</div>
            <div className="grid grid-2">
              <label className="field"><span>Area</span><input value={callForm.area} onChange={(e) => setCallForm((c) => ({ ...c, area: e.target.value }))} placeholder="Booth, GS, breakouts..." /></label>
              <label className="field"><span>Role</span><input value={callForm.role_name} onChange={(e) => setCallForm((c) => ({ ...c, role_name: e.target.value }))} placeholder="General AV, LED Assist..." /></label>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
              <label className="field"><span>Start</span><input type="time" value={callForm.start_time} onChange={(e) => setCallForm((c) => ({ ...c, start_time: e.target.value }))} /></label>
              <label className="field"><span>End</span><input type="time" value={callForm.end_time} onChange={(e) => setCallForm((c) => ({ ...c, end_time: e.target.value }))} /></label>
              <label className="field"><span>Crew needed</span><input type="number" min="1" value={callForm.crew_needed} onChange={(e) => setCallForm((c) => ({ ...c, crew_needed: e.target.value }))} /></label>
            </div>
            <label className="field"><span>Notes</span><textarea rows={3} value={callForm.notes} onChange={(e) => setCallForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveCall}>{saving ? "Saving..." : editingCallId ? "Save Sub-Call" : "Add Sub-Call"}</button>
              <button type="button" className="ghost" onClick={() => { setEditingCallId(null); setEditingDayTargetId(null); setCallForm(emptyCall); setEditorMode(null); setViewMode("overview"); }}>Cancel</button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {msg ? <p className={msg.kind === "error" ? "error" : "success"}>{msg.text}</p> : null}

      <div className="grid" style={{ gridTemplateColumns: "320px minmax(0,1fr)", gap: 16 }}>
        <section className="card">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>Events</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                Clean overview first, edit tools second. Import and preview from the event list.
              </p>
            </div>
            <button type="button" className="primary" onClick={startAddEvent}>
              Add Event
            </button>
          </div>

          <label className="field">
            <span>Main search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Show, client, venue, city..." />
          </label>

          <div className="list" style={{ marginTop: 16 }}>
            <h4 style={{ margin: 0 }}>Import Event</h4>
            <div
              className="card compact"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dropped = event.dataTransfer.files?.[0] || null;
                if (dropped) setImportFile(dropped);
              }}
              style={{ borderStyle: "dashed" }}
            >
              <div className="small muted">
                Drag a CSV or PDF here, preview first, then create new or merge into the selected event.
              </div>
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button type="button" className="ghost" onClick={() => fileInputRef.current?.click()}>
                  Choose file
                </button>
                {importFile ? <span className="small">{importFile.name}</span> : <span className="small muted">No file selected</span>}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.pdf"
                style={{ display: "none" }}
                onChange={(event) => setImportFile(event.target.files?.[0] || null)}
              />
            </div>

            <label className="field">
              <span>Import mode</span>
              <select value={importMode} onChange={(e) => setImportMode(e.target.value as ImportMode)}>
                <option value="create">Create new event</option>
                <option value="merge">Merge into selected event</option>
                <option value="preview">Preview only</option>
              </select>
            </label>

            {importMode === "merge" ? (
              <p className="small muted">
                Selected event for merge: <strong>{selectedShow?.name || "Choose an event first"}</strong>
              </p>
            ) : null}

            <label className="field"><span>Show name override</span><input value={importForm.show_name} onChange={(e) => setImportForm((c) => ({ ...c, show_name: e.target.value }))} placeholder="Optional override" /></label>
            <label className="field"><span>Client override</span><input value={importForm.client} onChange={(e) => setImportForm((c) => ({ ...c, client: e.target.value }))} placeholder="Optional override" /></label>
            <label className="field"><span>Venue override</span><input value={importForm.venue} onChange={(e) => setImportForm((c) => ({ ...c, venue: e.target.value }))} placeholder="Optional override" /></label>
            <label className="field"><span>Rate city</span><input value={importForm.rate_city} onChange={(e) => setImportForm((c) => ({ ...c, rate_city: e.target.value }))} placeholder="Default or city name" /></label>

            <div className="toolbar">
              <button type="button" className="ghost" disabled={importing} onClick={previewImportFile}>
                {importing ? "Working..." : "Preview"}
              </button>
              <button type="button" className="primary" disabled={importing || importMode === "preview"} onClick={runImport}>
                {importing ? "Working..." : importMode === "merge" ? "Merge Import" : "Create Event"}
              </button>
            </div>

            {importPreview ? (
              <div className="card compact" style={{ marginTop: 12 }}>
                <div style={{ fontWeight: 700 }}>{importPreview.show.name}</div>
                <div className="small muted">{importPreview.show.client || "No client"} • {importPreview.show.venue || "No venue"}</div>
                <div className="small muted">{importPreview.show.show_start} to {importPreview.show.show_end} • {importPreview.sourceType.toUpperCase()}</div>
                <div className="small" style={{ marginTop: 8 }}>
                  {importPreview.laborDays.length} labor days • {importPreview.subCallPreview.length} sub-calls • {importPreview.matchedCrewCount} matched • {importPreview.unmatchedCrewCount} unmatched
                </div>
                <div className="list" style={{ marginTop: 10, maxHeight: 180, overflowY: "auto" }}>
                  {importPreview.subCallPreview.map((call) => (
                    <div key={call.key} className="card compact">
                      <div style={{ fontWeight: 700 }}>{call.labor_date} • {call.start_time}{call.end_time ? `-${call.end_time}` : ""}</div>
                      <div className="small muted">{call.area} • {call.role_name} • {call.crew_needed} needed</div>
                      {call.matchedCrew.length ? <div className="small">Matched: {call.matchedCrew.map((row) => row.name).join(", ")}</div> : null}
                      {call.unmatchedCrew.length ? <div className="small muted">Unmatched: {call.unmatchedCrew.join(", ")}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {(["Upcoming", "Current", "Past"] as const).map((bucket) => (
            <div key={bucket} className="list" style={{ marginTop: 14 }}>
              <h4 style={{ margin: 0 }}>{bucket}</h4>
              {(showsByBucket[bucket] ?? []).map((show) => (
                <button
                  key={show.id}
                  type="button"
                  className="ghost"
                  onClick={() => setSelectedShowId(show.id)}
                  style={{ textAlign: "left", borderColor: selectedShow?.id === show.id ? "#111827" : undefined }}
                >
                  <div style={{ fontWeight: 700 }}>{show.name}</div>
                  <div className="small muted">{show.client || "No client"} • {show.show_start} to {show.show_end}</div>
                  <div className="small muted">{show.venue || "No venue"}</div>
                </button>
              ))}
              {!showsByBucket[bucket].length ? <p className="small muted">No {bucket.toLowerCase()} shows.</p> : null}
            </div>
          ))}
        </section>

        <section className="card">
          <div>
            <h3 style={{ marginBottom: 6 }}>Event overview</h3>
            <p className="muted small" style={{ marginTop: 0 }}>
              Review the show first. Edit buttons open directly under the selected event, day, booth, or sub-call.
            </p>
          </div>

          {selectedShow ? (
            <div className="grid" style={{ gap: 16 }}>
              <div className="card compact">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 30, fontWeight: 800 }}>{selectedShow.name}</div>
                    <div className="muted">{selectedShow.client || "No client"} • {selectedShow.venue || "No venue"}</div>
                    <div className="muted">{selectedShow.show_start} to {selectedShow.show_end} • {showBucket(selectedShow)} • Rate city: {selectedShow.rate_city || "Default"}</div>
                    {eventPool ? <div className="small" style={{ marginTop: 8 }}><strong>Staffing pool:</strong> {eventPool}</div> : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>${estimate.toLocaleString()}</div>
                    <div className="muted">Estimated payout</div>
                  </div>
                </div>
                {selectedShow.notes ? <div className="small muted" style={{ marginTop: 10 }}>{selectedShow.notes}</div> : null}
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <label className="field" style={{ minWidth: 230 }}>
                    <span>Change view</span>
                    <select value={eventDisplayMode} onChange={(e) => setEventDisplayMode(e.target.value as EventDisplayMode)}>
                      <option value="day">Day / sub-call view</option>
                      <option value="booth">Booth / area view</option>
                    </select>
                  </label>
                  <button type="button" className="ghost" onClick={exportCrewList}>Export {eventDisplayMode === "booth" ? "Booth" : "Day"} Crew List</button>
                  <button type="button" className="ghost" onClick={() => startEditEvent(selectedShow)}>Edit Event</button>
                  <button type="button" className="ghost" onClick={startAddDay}>Add Labor Day</button>
                  <button type="button" className="ghost danger" onClick={() => deleteShow(selectedShow.id)}>Delete Event</button>
                </div>
              </div>

              {(editorMode === "show" || (editorMode === "day" && !editingDayId)) ? renderEditorPanel() : null}

              {eventDisplayMode === "day" ? (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>Labor days</h4>
                      <div className="small muted">Separated by date with clear day breaks.</div>
                    </div>
                  </div>
                  {visibleLaborDays.length ? visibleLaborDays.map((day) => {
                    const isOpen = expandedDayIds.includes(day.id);
                    const dayCalls = subCalls.filter((call) => call.labor_day_id === day.id).sort((a, b) => a.start_time.localeCompare(b.start_time));
                    return (
                      <div key={day.id} className="card compact" style={{ borderTop: "3px solid #111827" }}>
                        <div className="row">
                          <button type="button" className="ghost" style={{ flex: 1, textAlign: "left" }} onClick={() => toggleDay(day.id)}>
                            <strong>{day.labor_date}</strong>
                            <span className="small muted"> • {day.label || "No label"}</span>
                          </button>
                          <div className="toolbar">
                            <button type="button" className="ghost" onClick={() => startEditDay(day)}>Edit Day</button>
                            <button type="button" className="ghost" onClick={() => startAddCall(day.id)}>Add Sub-Call</button>
                            <button type="button" className="ghost danger" onClick={() => deleteDay(day.id)}>Delete Day</button>
                          </div>
                        </div>

                        {editorMode === "day" && editingDayId === day.id ? renderEditorPanel() : null}
                        {editorMode === "call" && !editingCallId && editingDayTargetId === day.id ? renderEditorPanel() : null}

                        {isOpen ? (
                          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
                            {day.notes ? <div className="small muted">{day.notes}</div> : null}
                            {dayCalls.length ? dayCalls.map((call) => renderCallCard(day, call)) : <div className="small muted">No sub-calls yet for this labor day.</div>}
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : <p className="small muted">No labor days yet for this event.</p>}
                </div>
              ) : (
                <div className="list">
                  <div className="row">
                    <div>
                      <h4 style={{ margin: 0 }}>Booth / area view</h4>
                      <div className="small muted">Same event data grouped like the imported crew lists: booth first, then dates and calls.</div>
                    </div>
                    <button type="button" className="ghost" onClick={startAddDay}>Add Labor Day</button>
                  </div>
                  {boothSections.length ? boothSections.map((section) => {
                    const dates = [...new Set(section.calls.map((item) => item.day.labor_date))];
                    return (
                      <div key={section.booth} className="card compact" style={{ borderTop: "3px solid #111827" }}>
                        <div className="row" style={{ alignItems: "flex-start" }}>
                          <div>
                            <h3 style={{ margin: 0 }}>{section.booth}</h3>
                            <div className="small muted">{section.calls.length} sub-call{section.calls.length === 1 ? "" : "s"}</div>
                          </div>
                        </div>
                        <div className="grid" style={{ gap: 12, marginTop: 12 }}>
                          {dates.map((date) => {
                            const callsForDate = section.calls.filter((item) => item.day.labor_date === date);
                            const day = callsForDate[0]?.day;
                            return (
                              <div key={`${section.booth}-${date}`} className="card compact" style={{ background: "#f9fafb" }}>
                                <div className="row">
                                  <div>
                                    <strong>{date}</strong>
                                    <span className="small muted"> • {day?.label || "No label"}</span>
                                  </div>
                                  {day ? (
                                    <div className="toolbar">
                                      <button type="button" className="ghost" onClick={() => startEditDay(day)}>Edit Day</button>
                                      <button type="button" className="ghost" onClick={() => startAddCall(day.id)}>Add Sub-Call</button>
                                    </div>
                                  ) : null}
                                </div>
                                {day && editorMode === "day" && editingDayId === day.id ? renderEditorPanel() : null}
                                {day && editorMode === "call" && !editingCallId && editingDayTargetId === day.id ? renderEditorPanel() : null}
                                <div className="grid" style={{ gap: 10, marginTop: 10 }}>
                                  {callsForDate.map(({ day: callDay, call }) => renderCallCard(callDay, call, true))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }) : <p className="small muted">No booth or sub-call information yet for this event.</p>}
                </div>
              )}
            </div>
          ) : (
            <div className="card compact">
              <strong>No event selected</strong>
              <div className="small muted" style={{ marginTop: 8 }}>Choose an event from the list on the left or add a new one.</div>
              {editorMode === "show" ? renderEditorPanel() : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
