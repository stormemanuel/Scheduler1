"use client";
import { useEffect, useState } from "react";
import type { TechRatingRecord } from "@/lib/client-types";
import { summarizeCrewRatings } from "@/lib/crew-ratings";

type Named = { id: string; name: string };
type RatingsData = { ratings: TechRatingRecord[]; shows: Named[]; clients: Named[]; canRate: boolean };
const score = (summary: { average: number | null; count: number }) => summary.average === null ? "Not rated yet" : `${summary.average.toFixed(1)} / 5 · ${summary.count} rating${summary.count === 1 ? "" : "s"}`;

export default function CrewRatings({ crewId, onSaved }: { crewId: string; onSaved: (rating: TechRatingRecord) => void }) {
  const [data, setData] = useState<RatingsData | null>(null);
  const [showId, setShowId] = useState("");
  const [stars, setStars] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    fetch(`/api/crew/${encodeURIComponent(crewId)}/ratings`, { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to load ratings.");
      if (!controller.signal.aborted) setData(result);
    }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [crewId, reload]);
  function selectEvent(id: string) {
    setShowId(id); setMessage("");
    const existing = data?.ratings.find((row) => row.show_id === id && row.rating_source !== "client_feedback");
    setStars(existing ? String(existing.rating) : ""); setNotes(existing?.notes || "");
  }
  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/crew/${encodeURIComponent(crewId)}/ratings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ show_id: showId, rating: Number(stars), notes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to save rating.");
      setData((current) => current ? { ...current, ratings: [...current.ratings.filter((row) => !(row.show_id === showId && row.rating_source !== "client_feedback")), result.rating] } : current);
      onSaved(result.rating); setMessage("ELS rating saved."); setReload((value) => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save rating."); }
    finally { setSaving(false); }
  }
  const summary = summarizeCrewRatings(data?.ratings || []);
  return <section aria-label="Crew ratings" className="list">
    <h3>Ratings</h3>
    {error ? <div role="alert"><p className="error">{error}</p>{!data ? <button type="button" className="ghost" onClick={() => setReload((value) => value + 1)}>Retry</button> : null}</div> : null}
    {!data && !error ? <p role="status">Loading ratings…</p> : null}
    {data ? <>
      <div className="grid grid-2">
        <div className="card compact"><strong>Overall rating</strong><p>{score(summary.overall)}</p><span className="small muted">Average of all ELS ratings and approved client feedback. Each rating counts equally.</span></div>
        <div className="card compact"><strong>ELS rating</strong><p>{score(summary.els)}</p><span className="small muted">Internal ELS event ratings.</span></div>
      </div>
      <h4>Ratings by client</h4>
      {summary.clients.length ? summary.clients.map((client) => <div key={client.clientId || "unlinked"} className="card compact"><strong>{data.clients.find((row) => row.id === client.clientId)?.name || (client.clientId ? "Client no longer available" : "Client not linked")}</strong><p>{score(client)}</p></div>) : <p className="muted">No approved client ratings yet.</p>}
      {data.canRate ? <div className="card compact">
        <h4>Rate as ELS</h4><p className="small muted">Save one ELS rating per event. Selecting an already rated event lets you update its rating without adding another vote.</p>
        <label className="field">Event<select value={showId} disabled={saving} onChange={(event) => selectEvent(event.target.value)}><option value="">Choose an event</option>{data.shows.map((show) => <option key={show.id} value={show.id}>{show.name || "Unnamed event"}</option>)}</select></label>
        {!data.shows.length ? <p className="muted">Add an event before saving an ELS rating.</p> : null}
        <label className="field">ELS stars<select value={stars} disabled={saving} onChange={(event) => setStars(event.target.value)}><option value="">Choose a rating</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{"★".repeat(value)} · {value} / 5</option>)}</select></label>
        <label className="field">ELS notes<textarea value={notes} disabled={saving} maxLength={2000} onChange={(event) => setNotes(event.target.value)} /></label>
        <button type="button" className="primary" disabled={saving || !showId || !stars} onClick={() => void save()}>{saving ? "Saving…" : "Save ELS rating"}</button>
      </div> : null}
      {message ? <p role="status" className="success">{message}</p> : null}
      <h4>Rating history</h4>
      {data.ratings.length ? data.ratings.map((rating) => <div className="card compact" key={rating.id}>
        <strong>{rating.rating_source === "client_feedback" ? "Client feedback" : "ELS"} · {rating.rating} / 5</strong>
        <div className="small muted">{data.shows.find((show) => show.id === rating.show_id)?.name || "Event unavailable"}{rating.client_id ? ` · ${data.clients.find((client) => client.id === rating.client_id)?.name || "Client unavailable"}` : ""} · {(rating.updated_at || rating.created_at).slice(0, 10)}</div>
        {rating.notes ? <p style={{ whiteSpace: "pre-wrap" }}>{rating.notes}</p> : null}
      </div>) : <p className="muted">No ratings recorded.</p>}
    </> : null}
  </section>;
}
