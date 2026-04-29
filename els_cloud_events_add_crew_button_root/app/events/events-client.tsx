"use client";

import { useMemo, useState } from "react";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { CrewRecord } from "@/lib/crew-types";
import type { AssignmentRecord, ShowRecord, LaborDayRecord, SubCallRecord } from "@/lib/events-types";

type Props = {
  initialShows: ShowRecord[];
  initialLaborDays: LaborDayRecord[];
  initialSubCalls: SubCallRecord[];
  initialAssignments: AssignmentRecord[];
  initialCrew: CrewRecord[];
  masterRates: MasterRateRecord[];
};

type SaveState = { kind: "success" | "error"; text: string } | null;

const emptyShow = { name: "", client: "", venue: "", rate_city: "Default", show_start: "", show_end: "", notes: "" };
const emptyDay = { labor_date: "", label: "", notes: "" };
const emptyCall = { area: "", role_name: "", start_time: "", end_time: "", crew_needed: "1", notes: "" };

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function showBucket(show: ShowRecord) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const start = new Date(show.show_start + 'T00:00:00');
  const end = new Date(show.show_end + 'T00:00:00');
  if (end < today) return 'Past';
  if (start > today) return 'Upcoming';
  return 'Current';
}

const roleAliases: Record<string, string[]> = {
  'general av': ['gav'],
  'gav': ['general av'],
  'breakout operator': ['bo'],
  'bo': ['breakout operator'],
  'audio assist': ['a2'],
  'a2': ['audio assist'],
  'video assist': ['v2'],
  'v2': ['video assist'],
  'lighting assist': ['l2'],
  'l2': ['lighting assist'],
  'crew lead': ['lead'],
};

function matchesRole(crew: CrewRecord, roleName: string) {
  const target = normalize(roleName);
  const aliases = new Set([target, ...(roleAliases[target] ?? [])]);
  return crew.positions.some((position) => aliases.has(normalize(position.role_name)) || normalize(position.role_name).includes(target));
}

export default function EventsClient({ initialShows, initialLaborDays, initialSubCalls, initialAssignments, initialCrew, masterRates }: Props) {
  const [shows, setShows] = useState(initialShows);
  const [laborDays, setLaborDays] = useState(initialLaborDays);
  const [subCalls, setSubCalls] = useState(initialSubCalls);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [crewRecords] = useState(initialCrew);
  const [search, setSearch] = useState("");
  const [selectedShowId, setSelectedShowId] = useState<string | null>(initialShows[0]?.id ?? null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(initialLaborDays[0]?.id ?? null);
  const [showForm, setShowForm] = useState(emptyShow);
  const [dayForm, setDayForm] = useState(emptyDay);
  const [callForm, setCallForm] = useState(emptyCall);
  const [editingShowId, setEditingShowId] = useState<string | null>(null);
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [editingCallId, setEditingCallId] = useState<string | null>(null);
  const [crewPickerCallId, setCrewPickerCallId] = useState<string | null>(null);
  const [crewSearch, setCrewSearch] = useState("");
  const [msg, setMsg] = useState<SaveState>(null);
  const [saving, setSaving] = useState(false);

  const filteredShows = useMemo(() => {
    const token = normalize(search);
    const sorted = [...shows].sort((a,b) => a.show_start.localeCompare(b.show_start));
    if (!token) return sorted;
    return sorted.filter((show) => normalize([show.name, show.client, show.venue, show.rate_city, showBucket(show)].join(' ')).includes(token));
  }, [shows, search]);

  const showsByBucket = useMemo(() => ({
    Upcoming: filteredShows.filter((show) => showBucket(show) === 'Upcoming'),
    Current: filteredShows.filter((show) => showBucket(show) === 'Current'),
    Past: filteredShows.filter((show) => showBucket(show) === 'Past'),
  }), [filteredShows]);

  const selectedShow = shows.find((show) => show.id === selectedShowId) ?? filteredShows[0] ?? null;
  const visibleLaborDays = useMemo(() => laborDays.filter((day) => day.show_id === selectedShow?.id).sort((a,b) => a.labor_date.localeCompare(b.labor_date)), [laborDays, selectedShow]);
  const selectedDay = visibleLaborDays.find((day) => day.id === selectedDayId) ?? visibleLaborDays[0] ?? null;
  const visibleSubCalls = useMemo(() => subCalls.filter((call) => call.labor_day_id === selectedDay?.id).sort((a,b) => a.start_time.localeCompare(b.start_time)), [subCalls, selectedDay]);
  const activeCrewCall = visibleSubCalls.find((call) => call.id === crewPickerCallId) ?? null;

  const estimate = useMemo(() => {
    if (!selectedShow) return 0;
    const rateCity = selectedShow.rate_city || 'Default';
    const allDayIds = laborDays.filter((day) => day.show_id === selectedShow.id).map((day) => day.id);
    const allCalls = subCalls.filter((call) => allDayIds.includes(call.labor_day_id));
    return allCalls.reduce((sum, call) => {
      const key = normalize(call.role_name);
      const override = masterRates.find((rate) => normalize(rate.city_name) === normalize(rateCity) && normalize(rate.role_name) === key);
      const fallback = masterRates.find((rate) => normalize(rate.city_name) === 'default' && normalize(rate.role_name) === key);
      const rate = override?.full_day ?? fallback?.full_day ?? 0;
      return sum + rate * Math.max(1, Number(call.crew_needed || 0));
    }, 0);
  }, [selectedShow, laborDays, subCalls, masterRates]);

  const assignedCrew = useMemo(() => {
    if (!activeCrewCall) return [] as Array<{ assignment: AssignmentRecord; crew: CrewRecord | undefined }>;
    return assignments.filter((assignment) => assignment.sub_call_id === activeCrewCall.id).map((assignment) => ({ assignment, crew: crewRecords.find((crew) => crew.id === assignment.crew_id) }));
  }, [assignments, crewRecords, activeCrewCall]);

  const suggestedCrew = useMemo(() => {
    if (!activeCrewCall || !selectedDay) return [] as CrewRecord[];
    const token = normalize(crewSearch);
    const alreadyAssigned = new Set(assignedCrew.map((item) => item.assignment.crew_id));
    return crewRecords
      .filter((crew) => !alreadyAssigned.has(crew.id))
      .filter((crew) => matchesRole(crew, activeCrewCall.role_name) || normalize(activeCrewCall.role_name).includes(normalize(crew.group_name)) === false)
      .filter((crew) => !crew.unavailable_dates.includes(selectedDay.labor_date))
      .filter((crew) => !token || normalize([
        crew.name,
        crew.city_name,
        crew.group_name,
        crew.tier,
        crew.email,
        crew.phone,
        crew.notes,
        crew.positions.map((position) => position.role_name).join(' ')
      ].join(' ')).includes(token))
      .sort((a,b) => a.name.localeCompare(b.name));
  }, [activeCrewCall, selectedDay, crewRecords, assignedCrew, crewSearch]);

  async function request(url: string, method: string, body?: unknown) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Request failed.');
      setMsg({ kind: 'success', text: data.message || 'Saved.' });
      return data;
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Request failed.';
      setMsg({ kind: 'error', text });
      throw error;
    } finally {
      setSaving(false);
    }
  }

  async function addCrewToCall(crewId: string) {
    if (!activeCrewCall) return;
    const data = await request('/api/assignments', 'POST', { sub_call_id: activeCrewCall.id, crew_id: crewId, status: 'confirmed' });
    if (data?.row) {
      setAssignments((current) => {
        const next = current.filter((assignment) => !(assignment.sub_call_id === data.row.sub_call_id && assignment.crew_id === data.row.crew_id));
        return [...next, data.row];
      });
    }
  }

  async function removeCrewFromCall(assignmentId: string) {
    await request(`/api/assignments/${assignmentId}`, 'DELETE');
    setAssignments((current) => current.filter((assignment) => assignment.id !== assignmentId));
  }

  async function saveShow() {
    const payload = { ...showForm, name: showForm.name.trim(), client: showForm.client.trim(), venue: showForm.venue.trim(), rate_city: showForm.rate_city.trim() || 'Default', notes: showForm.notes.trim() };
    if (!payload.name || !payload.show_start || !payload.show_end) { setMsg({ kind: 'error', text: 'Show name, start, and end are required.' }); return; }
    const data = editingShowId ? await request(`/api/shows/${editingShowId}`, 'PATCH', payload) : await request('/api/shows', 'POST', payload);
    const nextShow: ShowRecord = editingShowId ? { id: editingShowId, ...payload } : { id: data.id, ...payload };
    setShows((current) => editingShowId ? current.map((show) => show.id === editingShowId ? nextShow : show) : [...current, nextShow].sort((a,b) => a.show_start.localeCompare(b.show_start)));
    setSelectedShowId(nextShow.id);
    setEditingShowId(null);
    setShowForm(emptyShow);
  }

  async function deleteShow(id: string) {
    if (!confirm('Delete this show, its labor days, and its sub-calls?')) return;
    await request(`/api/shows/${id}`, 'DELETE');
    const nextDayIds = laborDays.filter((day) => day.show_id === id).map((day) => day.id);
    const nextCallIds = subCalls.filter((call) => nextDayIds.includes(call.labor_day_id)).map((call) => call.id);
    setAssignments((current) => current.filter((assignment) => !nextCallIds.includes(assignment.sub_call_id)));
    setSubCalls((current) => current.filter((call) => !nextDayIds.includes(call.labor_day_id)));
    setLaborDays((current) => current.filter((day) => day.show_id !== id));
    setShows((current) => current.filter((show) => show.id !== id));
    if (selectedShowId === id) setSelectedShowId(null);
    if (crewPickerCallId && nextCallIds.includes(crewPickerCallId)) setCrewPickerCallId(null);
  }

  async function saveDay() {
    if (!selectedShow) { setMsg({ kind: 'error', text: 'Select a show first.' }); return; }
    const payload = { show_id: selectedShow.id, labor_date: dayForm.labor_date, label: dayForm.label.trim(), notes: dayForm.notes.trim() };
    if (!payload.labor_date) { setMsg({ kind: 'error', text: 'Labor day date is required.' }); return; }
    const data = editingDayId ? await request(`/api/labor-days/${editingDayId}`, 'PATCH', payload) : await request('/api/labor-days', 'POST', payload);
    const nextDay: LaborDayRecord = editingDayId ? { id: editingDayId, ...payload } : { id: data.id, ...payload };
    setLaborDays((current) => editingDayId ? current.map((day) => day.id === editingDayId ? nextDay : day) : [...current, nextDay].sort((a,b) => a.labor_date.localeCompare(b.labor_date)));
    setSelectedDayId(nextDay.id);
    setEditingDayId(null);
    setDayForm(emptyDay);
  }

  async function deleteDay(id: string) {
    if (!confirm('Delete this labor day and its sub-calls?')) return;
    await request(`/api/labor-days/${id}`, 'DELETE');
    const nextCallIds = subCalls.filter((call) => call.labor_day_id === id).map((call) => call.id);
    setAssignments((current) => current.filter((assignment) => !nextCallIds.includes(assignment.sub_call_id)));
    setSubCalls((current) => current.filter((call) => call.labor_day_id !== id));
    setLaborDays((current) => current.filter((day) => day.id !== id));
    if (selectedDayId === id) setSelectedDayId(null);
    if (crewPickerCallId && nextCallIds.includes(crewPickerCallId)) setCrewPickerCallId(null);
  }

  async function saveCall() {
    if (!selectedDay) { setMsg({ kind: 'error', text: 'Select a labor day first.' }); return; }
    const payload = { labor_day_id: selectedDay.id, area: callForm.area.trim(), role_name: callForm.role_name.trim(), start_time: callForm.start_time, end_time: callForm.end_time, crew_needed: Number(callForm.crew_needed || 1), notes: callForm.notes.trim() };
    if (!payload.area || !payload.role_name || !payload.start_time) { setMsg({ kind: 'error', text: 'Area, role, and start time are required.' }); return; }
    const data = editingCallId ? await request(`/api/sub-calls/${editingCallId}`, 'PATCH', payload) : await request('/api/sub-calls', 'POST', payload);
    const nextCall: SubCallRecord = editingCallId ? { id: editingCallId, ...payload } : { id: data.id, ...payload };
    setSubCalls((current) => editingCallId ? current.map((call) => call.id === editingCallId ? nextCall : call) : [...current, nextCall].sort((a,b) => a.start_time.localeCompare(b.start_time)));
    setEditingCallId(null);
    setCallForm(emptyCall);
  }

  async function deleteCall(id: string) {
    if (!confirm('Delete this sub-call?')) return;
    await request(`/api/sub-calls/${id}`, 'DELETE');
    setAssignments((current) => current.filter((assignment) => assignment.sub_call_id !== id));
    setSubCalls((current) => current.filter((call) => call.id !== id));
    if (crewPickerCallId === id) setCrewPickerCallId(null);
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {msg ? <p className={msg.kind === 'error' ? 'error' : 'success'}>{msg.text}</p> : null}
      <div className="grid" style={{ gridTemplateColumns: '280px 340px minmax(0,1fr)', gap: 16 }}>
        <section className="card">
          <h3 style={{ marginBottom: 6 }}>Shows</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Upcoming, current, and past shows based on the full show span.</p>
          <label className="field">
            <span>Main search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Show, client, venue, city..." />
          </label>
          {(['Upcoming','Current','Past'] as const).map((bucket) => (
            <div key={bucket} className="list" style={{ marginTop: 14 }}>
              <h4 style={{ margin: 0 }}>{bucket}</h4>
              {(showsByBucket[bucket] ?? []).map((show) => (
                <button key={show.id} type="button" className="ghost" onClick={() => { setSelectedShowId(show.id); setSelectedDayId(null); }} style={{ textAlign: 'left', borderColor: selectedShow?.id === show.id ? '#111827' : undefined }}>
                  <div style={{ fontWeight: 700 }}>{show.name}</div>
                  <div className="small muted">{show.client || 'No client'} • {show.show_start} to {show.show_end}</div>
                  <div className="small muted">Rate city: {show.rate_city || 'Default'}</div>
                </button>
              ))}
            </div>
          ))}
        </section>

        <section className="card">
          <h3 style={{ marginBottom: 6 }}>Selected event</h3>
          {selectedShow ? (
            <div className="list">
              <div className="card compact">
                <div className="row">
                  <div>
                    <strong>{selectedShow.name}</strong>
                    <div className="small muted">{selectedShow.client || 'No client'} • {selectedShow.venue || 'No venue'}</div>
                    <div className="small muted">{selectedShow.show_start} to {selectedShow.show_end} • {showBucket(selectedShow)}</div>
                  </div>
                  <div className="small"><strong>${estimate.toLocaleString()}</strong><div className="muted small">Estimated payout</div></div>
                </div>
                {selectedShow.notes ? <div className="small muted" style={{ marginTop: 8 }}>{selectedShow.notes}</div> : null}
              </div>
            </div>
          ) : <p className="muted small">Select a show first.</p>}

          <div className="list" style={{ marginTop: 16, maxHeight: 240, overflowY: 'auto' }}>
            <h4 style={{ margin: 0 }}>Labor days</h4>
            {visibleLaborDays.map((day) => (
              <button key={day.id} type="button" className="ghost" onClick={() => setSelectedDayId(day.id)} style={{ textAlign: 'left', borderColor: selectedDay?.id === day.id ? '#111827' : undefined }}>
                <div style={{ fontWeight: 700 }}>{day.labor_date}</div>
                <div className="small muted">{day.label || 'No label'}</div>
              </button>
            ))}
          </div>

          <div className="list" style={{ marginTop: 16 }}>
            <h4 style={{ margin: 0 }}>{editingShowId ? 'Edit show' : 'Add show'}</h4>
            <label className="field"><span>Show name</span><input value={showForm.name} onChange={(e) => setShowForm((c) => ({ ...c, name: e.target.value }))} /></label>
            <label className="field"><span>Client</span><input value={showForm.client} onChange={(e) => setShowForm((c) => ({ ...c, client: e.target.value }))} /></label>
            <label className="field"><span>Venue</span><input value={showForm.venue} onChange={(e) => setShowForm((c) => ({ ...c, venue: e.target.value }))} /></label>
            <label className="field"><span>Rate city</span><input value={showForm.rate_city} onChange={(e) => setShowForm((c) => ({ ...c, rate_city: e.target.value }))} placeholder="Default, New Orleans, Nashville..." /></label>
            <div className="grid grid-2">
              <label className="field"><span>Show start</span><input type="date" value={showForm.show_start} onChange={(e) => setShowForm((c) => ({ ...c, show_start: e.target.value }))} /></label>
              <label className="field"><span>Show end</span><input type="date" value={showForm.show_end} onChange={(e) => setShowForm((c) => ({ ...c, show_end: e.target.value }))} /></label>
            </div>
            <label className="field"><span>Notes</span><textarea rows={3} value={showForm.notes} onChange={(e) => setShowForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving} onClick={saveShow}>{saving ? 'Saving...' : editingShowId ? 'Save show' : 'Add show'}</button>
              {selectedShow ? <button type="button" className="ghost" onClick={() => { setEditingShowId(selectedShow.id); setShowForm({ name: selectedShow.name, client: selectedShow.client, venue: selectedShow.venue, rate_city: selectedShow.rate_city, show_start: selectedShow.show_start, show_end: selectedShow.show_end, notes: selectedShow.notes }); }}>Edit selected</button> : null}
              {editingShowId ? <button type="button" className="ghost" onClick={() => { setEditingShowId(null); setShowForm(emptyShow); }}>Cancel</button> : null}
              {selectedShow ? <button type="button" className="ghost danger" onClick={() => deleteShow(selectedShow.id)}>Delete selected</button> : null}
            </div>
          </div>
        </section>

        <section className="card">
          <h3 style={{ marginBottom: 6 }}>Sub-calls</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Select a labor day, build sub-calls, and add crew directly from the call.</p>
          {selectedDay ? <p className="small"><strong>{selectedDay.labor_date}</strong> • {selectedDay.label || 'No label'}</p> : <p className="muted small">Select a labor day first.</p>}
          <div className="list" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {visibleSubCalls.map((call) => {
              const assignedCount = assignments.filter((assignment) => assignment.sub_call_id === call.id).length;
              return (
                <div key={call.id} className="card compact">
                  <div className="row">
                    <div>
                      <strong>{call.start_time}{call.end_time ? `–${call.end_time}` : ''}</strong>
                      <div className="small muted">{call.area} • {call.role_name} • {call.crew_needed} needed</div>
                      <div className="small muted">{assignedCount} assigned</div>
                    </div>
                    <div className="toolbar">
                      <button type="button" className="ghost" onClick={() => setCrewPickerCallId(call.id)}>Add Crew</button>
                      <button type="button" className="ghost" onClick={() => { setEditingCallId(call.id); setCallForm({ area: call.area, role_name: call.role_name, start_time: call.start_time, end_time: call.end_time || '', crew_needed: String(call.crew_needed), notes: call.notes || '' }); }}>Edit</button>
                      <button type="button" className="ghost danger" onClick={() => deleteCall(call.id)}>Delete</button>
                    </div>
                  </div>
                  {call.notes ? <div className="small muted" style={{ marginTop: 8 }}>{call.notes}</div> : null}
                </div>
              );
            })}
          </div>
          <div className="list" style={{ marginTop: 16 }}>
            <h4 style={{ margin: 0 }}>{editingDayId ? 'Edit labor day' : 'Add labor day'}</h4>
            <label className="field"><span>Date</span><input type="date" value={dayForm.labor_date} onChange={(e) => setDayForm((c) => ({ ...c, labor_date: e.target.value }))} /></label>
            <label className="field"><span>Label</span><input value={dayForm.label} onChange={(e) => setDayForm((c) => ({ ...c, label: e.target.value }))} placeholder="Load in, Show day, Strike..." /></label>
            <label className="field"><span>Notes</span><textarea rows={3} value={dayForm.notes} onChange={(e) => setDayForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving || !selectedShow} onClick={saveDay}>{saving ? 'Saving...' : editingDayId ? 'Save day' : 'Add day'}</button>
              {editingDayId ? <button type="button" className="ghost" onClick={() => { setEditingDayId(null); setDayForm(emptyDay); }}>Cancel</button> : null}
              {selectedDay ? <button type="button" className="ghost" onClick={() => { setEditingDayId(selectedDay.id); setDayForm({ labor_date: selectedDay.labor_date, label: selectedDay.label, notes: selectedDay.notes }); }}>Edit selected</button> : null}
              {selectedDay ? <button type="button" className="ghost danger" onClick={() => deleteDay(selectedDay.id)}>Delete selected</button> : null}
            </div>
          </div>
          <div className="list" style={{ marginTop: 16 }}>
            <h4 style={{ margin: 0 }}>{editingCallId ? 'Edit sub-call' : 'Add sub-call'}</h4>
            <div className="grid grid-2">
              <label className="field"><span>Area</span><input value={callForm.area} onChange={(e) => setCallForm((c) => ({ ...c, area: e.target.value }))} placeholder="General Session, Breakouts..." /></label>
              <label className="field"><span>Role</span><input value={callForm.role_name} onChange={(e) => setCallForm((c) => ({ ...c, role_name: e.target.value }))} placeholder="General AV, Crew Lead..." /></label>
            </div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
              <label className="field"><span>Start</span><input type="time" value={callForm.start_time} onChange={(e) => setCallForm((c) => ({ ...c, start_time: e.target.value }))} /></label>
              <label className="field"><span>End</span><input type="time" value={callForm.end_time} onChange={(e) => setCallForm((c) => ({ ...c, end_time: e.target.value }))} /></label>
              <label className="field"><span>Crew needed</span><input type="number" min="1" value={callForm.crew_needed} onChange={(e) => setCallForm((c) => ({ ...c, crew_needed: e.target.value }))} /></label>
            </div>
            <label className="field"><span>Notes</span><textarea rows={3} value={callForm.notes} onChange={(e) => setCallForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            <div className="toolbar">
              <button type="button" className="primary" disabled={saving || !selectedDay} onClick={saveCall}>{saving ? 'Saving...' : editingCallId ? 'Save sub-call' : 'Add sub-call'}</button>
              {editingCallId ? <button type="button" className="ghost" onClick={() => { setEditingCallId(null); setCallForm(emptyCall); }}>Cancel</button> : null}
            </div>
          </div>
        </section>
      </div>

      {activeCrewCall ? (
        <section className="card">
          <div className="row">
            <div>
              <h3 style={{ marginBottom: 6 }}>Add crew</h3>
              <p className="muted small" style={{ marginTop: 0 }}>
                {activeCrewCall.area} • {activeCrewCall.role_name} • {activeCrewCall.start_time}{activeCrewCall.end_time ? `–${activeCrewCall.end_time}` : ''}
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => { setCrewPickerCallId(null); setCrewSearch(''); }}>Close</button>
          </div>
          <label className="field">
            <span>Search crew</span>
            <input value={crewSearch} onChange={(e) => setCrewSearch(e.target.value)} placeholder="Name, city, role, tier..." />
          </label>
          <div className="grid grid-2" style={{ alignItems: 'start', marginTop: 16 }}>
            <div className="list">
              <h4 style={{ margin: 0 }}>Assigned crew</h4>
              {assignedCrew.length ? assignedCrew.map(({ assignment, crew }) => (
                <div key={assignment.id} className="card compact">
                  <div className="row">
                    <div>
                      <strong>{crew?.name || 'Unknown crew'}</strong>
                      <div className="small muted">{crew?.city_name || 'No city'} • {crew?.positions.map((position) => position.role_name).join(', ') || 'No roles'}</div>
                    </div>
                    <button type="button" className="ghost danger" onClick={() => removeCrewFromCall(assignment.id)}>Remove</button>
                  </div>
                </div>
              )) : <p className="muted small">No crew assigned yet.</p>}
            </div>
            <div className="list">
              <h4 style={{ margin: 0 }}>Available crew</h4>
              {suggestedCrew.slice(0, 40).map((crew) => (
                <div key={crew.id} className="card compact">
                  <div className="row">
                    <div>
                      <strong>{crew.name}</strong>
                      <div className="small muted">{crew.city_name} • {crew.group_name}</div>
                      <div className="small muted">{crew.positions.map((position) => position.role_name).join(', ') || 'No roles'}</div>
                    </div>
                    <button type="button" className="ghost" onClick={() => addCrewToCall(crew.id)}>Add</button>
                  </div>
                </div>
              ))}
              {!suggestedCrew.length ? <p className="muted small">No matching crew found for this sub-call.</p> : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
