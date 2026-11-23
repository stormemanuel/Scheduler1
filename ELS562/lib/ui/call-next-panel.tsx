"use client";
import { useState } from "react";
import type { CallNextEntry } from "@/lib/call-next";
type Crew = {id:string;name:string;phone?:string|null};
export function CallNextPanel({ entries, crew, busy, canManage, onAction, availabilitySelected, availabilityEligible, onAvailabilitySelect }: {
  entries:CallNextEntry[];crew:Crew[];busy:boolean;canManage:boolean;
  onAction:(action:string,id?:string,crewId?:string,note?:string)=>Promise<void>;
  availabilitySelected?:string[];availabilityEligible?:string[];onAvailabilitySelect?:(crewId:string,selected:boolean)=>void;
}) {
  const [search,setSearch]=useState("");const [note,setNote]=useState("");
  const query=search.trim().toLowerCase();
  const matches=query.length<2?[]:crew.filter(person=>!entries.some(entry=>entry.crew_id===person.id)&&`${person.name} ${person.phone || ""}`.toLowerCase().includes(query)).slice(0,15);
  const byId=new Map(crew.map(person=>[person.id,person]));
  return <section className="card compact" style={{marginTop:12,borderColor:"#60a5fa",background:"#eff6ff"}} aria-label="Call Next list">
    <div className="row"><div><h4 style={{margin:0}}>Call Next <span className="badge">{entries.length}</span></h4><p className="small muted" style={{margin:"4px 0"}}>Contact these techs in order if more positions are added to this event. This list does not reserve positions or send messages.</p></div><button type="button" className="ghost" disabled={busy} onClick={()=>void onAction("list")}>Refresh Call Next</button></div>
    <ol style={{paddingLeft:24,maxHeight:420,overflowY:"auto"}}>
      {entries.map((entry,index)=>{const person=byId.get(entry.crew_id);return <li key={entry.id} style={{padding:"8px 0"}}><div className="row"><div><strong>{person?.name || "Crew member unavailable"}</strong>{person?.phone?<div className="small">{person.phone}</div>:null}{entry.note?<div className="small">{entry.note}</div>:null}</div><div className="toolbar">
        {person?.phone?<a className="ghost" href={`tel:${person.phone.replace(/[^\d+]/g,"")}`}>Call</a>:null}
        {onAvailabilitySelect?<label className="small"><input type="checkbox" checked={Boolean(availabilitySelected?.includes(entry.crew_id))} disabled={busy||!availabilityEligible?.includes(entry.crew_id)} onChange={event=>onAvailabilitySelect(entry.crew_id,event.target.checked)}/> Select for availability</label>:null}
        {canManage?<><button type="button" className="ghost" disabled={busy||index===0} aria-label={`Move ${person?.name || "crew member"} up`} onClick={()=>void onAction("up",entry.id)}>↑</button><button type="button" className="ghost" disabled={busy||index===entries.length-1} aria-label={`Move ${person?.name || "crew member"} down`} onClick={()=>void onAction("down",entry.id)}>↓</button><button type="button" className="ghost" disabled={busy} onClick={()=>void onAction("remove",entry.id)}>Remove</button></>:null}
      </div></div></li>})}
    </ol>
    {!entries.length?<p className="small muted">No one on Call Next yet.</p>:null}
    {canManage?<><label className="field"><span>Find a tech for Call Next</span><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Type at least 2 letters of a name or phone number"/></label><label className="field"><span>Call Next note (optional)</span><input value={note} maxLength={200} onChange={event=>setNote(event.target.value)} placeholder="Position, dates, or availability notes"/></label>{matches.map(person=><div key={person.id} className="row small" style={{padding:6}}><span>{person.name} · {person.phone || "No phone"}</span><button type="button" className="ghost" disabled={busy} onClick={()=>void onAction("add","",person.id,note)}>Add to Call Next</button></div>)}{query.length>=2&&!matches.length?<p className="small muted">No additional matching crew. People already listed are excluded.</p>:null}</>:null}
    {onAvailabilitySelect?<p className="small muted">Availability selections use the dates, position, and filters below. Adjust those filters if a person cannot be selected; normal booking and conflict checks still apply.</p>:null}
  </section>;
}
