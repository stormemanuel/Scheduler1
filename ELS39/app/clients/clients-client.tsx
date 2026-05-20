"use client";

import { useMemo, useState } from "react";
import type { BusinessClientRecord, ClientContactRecord, TechRatingRecord } from "@/lib/client-types";
import type { CrewRecord } from "@/lib/crew-types";

type Props = {
  initialClients: BusinessClientRecord[];
  initialContacts: ClientContactRecord[];
  initialRatings: TechRatingRecord[];
  crewRecords: CrewRecord[];
};

type SaveState = { kind: "success" | "error"; text: string } | null;

type ClientDraft = {
  name: string;
  default_rate_city: string;
  notes: string;
};

type ContactDraft = {
  client_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
  is_primary: boolean;
};

const emptyClient: ClientDraft = { name: "", default_rate_city: "Default", notes: "" };
const emptyContact: ContactDraft = { client_id: "", name: "", title: "", email: "", phone: "", notes: "", is_primary: false };

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value;
}

function stars(value: number) {
  const rounded = Math.round(Number(value || 0));
  return "★".repeat(Math.max(0, Math.min(5, rounded))) + "☆".repeat(Math.max(0, 5 - Math.max(0, Math.min(5, rounded))));
}

export default function ClientsClient({ initialClients, initialContacts, initialRatings, crewRecords }: Props) {
  const [clients, setClients] = useState(initialClients);
  const [contacts, setContacts] = useState(initialContacts);
  const [ratings] = useState(initialRatings);
  const [selectedClientId, setSelectedClientId] = useState(initialClients[0]?.id || "");
  const [clientDraft, setClientDraft] = useState<ClientDraft>(emptyClient);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({ ...emptyContact, client_id: initialClients[0]?.id || "" });
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveState>(null);

  const selectedClient = clients.find((client) => client.id === selectedClientId) || clients[0] || null;
  const selectedContacts = contacts.filter((contact) => contact.client_id === selectedClient?.id);

  const filteredClients = useMemo(() => {
    const token = search.toLowerCase().trim();
    const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    if (!token) return sorted;
    return sorted.filter((client) => [client.name, client.default_rate_city, client.notes].join(" ").toLowerCase().includes(token));
  }, [clients, search]);

  const topTechs = useMemo(() => {
    if (!selectedClient) return [] as Array<{ crew: CrewRecord | undefined; average: number; count: number; last: string }>;
    const rows = ratings.filter((rating) => rating.client_id === selectedClient.id && rating.rating > 0);
    const byCrew = new Map<string, { total: number; count: number; last: string }>();
    for (const row of rows) {
      const existing = byCrew.get(row.crew_id) || { total: 0, count: 0, last: "" };
      existing.total += Number(row.rating || 0);
      existing.count += 1;
      existing.last = [existing.last, row.updated_at || row.created_at || ""].sort().pop() || "";
      byCrew.set(row.crew_id, existing);
    }
    return [...byCrew.entries()]
      .map(([crewId, row]) => ({ crew: crewRecords.find((crew) => crew.id === crewId), average: row.total / Math.max(1, row.count), count: row.count, last: row.last }))
      .sort((a, b) => b.average - a.average || b.count - a.count || (a.crew?.name || "").localeCompare(b.crew?.name || ""));
  }, [ratings, selectedClient, crewRecords]);

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

  function startAddClient() {
    setEditingClientId(null);
    setClientDraft(emptyClient);
  }

  function startEditClient(client: BusinessClientRecord) {
    setEditingClientId(client.id);
    setClientDraft({ name: client.name, default_rate_city: client.default_rate_city || "Default", notes: client.notes || "" });
  }

  function startAddContact(clientId = selectedClient?.id || "") {
    setEditingContactId(null);
    setContactDraft({ ...emptyContact, client_id: clientId });
  }

  function startEditContact(contact: ClientContactRecord) {
    setEditingContactId(contact.id);
    setContactDraft({
      client_id: contact.client_id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      notes: contact.notes,
      is_primary: contact.is_primary,
    });
  }

  async function saveClient() {
    const payload = {
      name: clientDraft.name.trim(),
      default_rate_city: clientDraft.default_rate_city.trim() || "Default",
      notes: clientDraft.notes.trim(),
    };
    if (!payload.name) {
      setMsg({ kind: "error", text: "Client name is required." });
      return;
    }
    const data = editingClientId
      ? await request(`/api/clients/${editingClientId}`, "PATCH", payload)
      : await request("/api/clients", "POST", payload);
    const next = data.client as BusinessClientRecord;
    if (!next?.id) return;
    setClients((current) => editingClientId ? current.map((client) => client.id === next.id ? next : client) : [...current.filter((client) => client.id !== next.id), next]);
    setSelectedClientId(next.id);
    setContactDraft((current) => ({ ...current, client_id: next.id }));
    setEditingClientId(null);
    setClientDraft(emptyClient);
  }

  async function deleteClient(id: string) {
    if (!confirm("Delete this client and its client contacts? Existing show text remains, but the saved client link will be cleared.")) return;
    await request(`/api/clients/${id}`, "DELETE");
    setClients((current) => current.filter((client) => client.id !== id));
    setContacts((current) => current.filter((contact) => contact.client_id !== id));
    if (selectedClientId === id) setSelectedClientId(clients.find((client) => client.id !== id)?.id || "");
  }

  async function saveContact() {
    const payload = {
      client_id: contactDraft.client_id || selectedClient?.id || "",
      name: contactDraft.name.trim(),
      title: contactDraft.title.trim(),
      email: contactDraft.email.trim(),
      phone: contactDraft.phone.trim(),
      notes: contactDraft.notes.trim(),
      is_primary: contactDraft.is_primary,
    };
    if (!payload.client_id) {
      setMsg({ kind: "error", text: "Choose a client before saving a contact." });
      return;
    }
    if (!payload.name) {
      setMsg({ kind: "error", text: "Contact name is required." });
      return;
    }
    const data = editingContactId
      ? await request(`/api/client-contacts/${editingContactId}`, "PATCH", payload)
      : await request("/api/client-contacts", "POST", payload);
    const next = data.contact as ClientContactRecord;
    if (!next?.id) return;
    setContacts((current) => {
      const normalized = next.is_primary ? current.map((contact) => contact.client_id === next.client_id ? { ...contact, is_primary: false } : contact) : current;
      return editingContactId ? normalized.map((contact) => contact.id === next.id ? next : contact) : [...normalized.filter((contact) => contact.id !== next.id), next];
    });
    setSelectedClientId(next.client_id);
    setEditingContactId(null);
    setContactDraft({ ...emptyContact, client_id: next.client_id });
  }

  async function deleteContact(id: string) {
    if (!confirm("Delete this client contact?")) return;
    await request(`/api/client-contacts/${id}`, "DELETE");
    setContacts((current) => current.filter((contact) => contact.id !== id));
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(280px, .9fr) minmax(0, 1.7fr)", gap: 16 }}>
      {msg ? <p className={msg.kind === "error" ? "error" : "success"} style={{ gridColumn: "1 / -1" }}>{msg.text}</p> : null}

      <aside className="card">
        <div className="row">
          <div>
            <h3 style={{ marginBottom: 6 }}>Business Clients</h3>
            <p className="small muted" style={{ marginTop: 0 }}>One saved client can have multiple client contacts.</p>
          </div>
          <button type="button" className="primary" onClick={startAddClient}>New Client</button>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>Search clients</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Client, city, notes..." />
        </label>
        <div className="list" style={{ marginTop: 12 }}>
          {filteredClients.length ? filteredClients.map((client) => (
            <button
              key={client.id}
              type="button"
              className="ghost"
              style={{ textAlign: "left", borderColor: selectedClient?.id === client.id ? "var(--brand)" : undefined }}
              onClick={() => { setSelectedClientId(client.id); setContactDraft((current) => ({ ...current, client_id: client.id })); }}
            >
              <strong>{client.name}</strong>
              <span className="small muted" style={{ display: "block" }}>Default rate city: {client.default_rate_city || "Default"}</span>
              <span className="small muted" style={{ display: "block" }}>{contacts.filter((contact) => contact.client_id === client.id).length} contact(s)</span>
            </button>
          )) : <p className="small muted">No clients yet. Add your first business client.</p>}
        </div>
      </aside>

      <section className="grid" style={{ gap: 16 }}>
        <div className="card">
          <div className="row">
            <div>
              <h3 style={{ marginBottom: 6 }}>{editingClientId ? "Edit Client" : "Add Client"}</h3>
              <p className="small muted" style={{ marginTop: 0 }}>Use this record when creating events so ratings can stay tied to that client.</p>
            </div>
            {selectedClient ? (
              <div className="toolbar">
                <button type="button" className="ghost" onClick={() => startEditClient(selectedClient)}>Edit selected</button>
                <button type="button" className="ghost danger" onClick={() => deleteClient(selectedClient.id)}>Delete selected</button>
              </div>
            ) : null}
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <label className="field"><span>Client name</span><input value={clientDraft.name} onChange={(event) => setClientDraft((current) => ({ ...current, name: event.target.value }))} placeholder="NMR Events, Encore, etc." /></label>
            <label className="field"><span>Default rate city</span><input value={clientDraft.default_rate_city} onChange={(event) => setClientDraft((current) => ({ ...current, default_rate_city: event.target.value }))} placeholder="Default, New Orleans, Dallas..." /></label>
          </div>
          <label className="field" style={{ marginTop: 12 }}><span>Client notes</span><textarea rows={3} value={clientDraft.notes} onChange={(event) => setClientDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button type="button" className="primary" disabled={saving} onClick={saveClient}>{saving ? "Saving..." : editingClientId ? "Save Client" : "Add Client"}</button>
            <button type="button" className="ghost" onClick={() => { setEditingClientId(null); setClientDraft(emptyClient); }}>Clear</button>
          </div>
        </div>

        {selectedClient ? (
          <div className="card">
            <div className="row">
              <div>
                <h3 style={{ marginBottom: 6 }}>{selectedClient.name}</h3>
                <p className="small muted" style={{ marginTop: 0 }}>Contacts and top techs for this client.</p>
              </div>
              <button type="button" className="primary" onClick={() => startAddContact(selectedClient.id)}>New Contact</button>
            </div>

            <div className="grid grid-2" style={{ marginTop: 14 }}>
              <div className="card compact" style={{ background: "#fbfcfd" }}>
                <h4 style={{ marginTop: 0 }}>{editingContactId ? "Edit Contact" : "Add Contact"}</h4>
                <div className="grid grid-2">
                  <label className="field"><span>Name</span><input value={contactDraft.name} onChange={(event) => setContactDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                  <label className="field"><span>Title / role</span><input value={contactDraft.title} onChange={(event) => setContactDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                </div>
                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  <label className="field"><span>Email</span><input value={contactDraft.email} onChange={(event) => setContactDraft((current) => ({ ...current, email: event.target.value }))} /></label>
                  <label className="field"><span>Phone</span><input value={contactDraft.phone} onChange={(event) => setContactDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
                </div>
                <label className="field" style={{ marginTop: 10 }}><span>Notes</span><textarea rows={3} value={contactDraft.notes} onChange={(event) => setContactDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
                <label className="row small" style={{ justifyContent: "flex-start", alignItems: "center", marginTop: 10 }}>
                  <input type="checkbox" checked={contactDraft.is_primary} onChange={(event) => setContactDraft((current) => ({ ...current, is_primary: event.target.checked }))} />
                  Primary contact for this client
                </label>
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button type="button" className="primary" disabled={saving} onClick={saveContact}>{saving ? "Saving..." : editingContactId ? "Save Contact" : "Add Contact"}</button>
                  <button type="button" className="ghost" onClick={() => startAddContact(selectedClient.id)}>Clear</button>
                </div>
              </div>

              <div className="list">
                <h4 style={{ margin: 0 }}>Client contacts</h4>
                {selectedContacts.length ? selectedContacts.map((contact) => (
                  <div key={contact.id} className="card compact">
                    <div className="row">
                      <div>
                        <strong>{contact.name}</strong>{contact.is_primary ? <span className="badge" style={{ marginLeft: 8 }}>Primary</span> : null}
                        <div className="small muted">{contact.title || "No title"}</div>
                        <div className="small muted">{[contact.email, contact.phone ? formatPhone(contact.phone) : ""].filter(Boolean).join(" • ") || "No contact details"}</div>
                      </div>
                      <div className="toolbar">
                        <button type="button" className="ghost" onClick={() => startEditContact(contact)}>Edit</button>
                        <button type="button" className="ghost danger" onClick={() => deleteContact(contact.id)}>Delete</button>
                      </div>
                    </div>
                    {contact.notes ? <p className="small muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{contact.notes}</p> : null}
                  </div>
                )) : <p className="small muted">No contacts saved for this client yet.</p>}
              </div>
            </div>

            <div className="card compact accent-card" style={{ marginTop: 14 }}>
              <h4 style={{ marginTop: 0 }}>Top Techs for this Client</h4>
              <p className="small muted">This list is calculated from 1–5 star show ratings that were saved on events linked to this client.</p>
              {topTechs.length ? (
                <div className="list">
                  {topTechs.map((item, index) => (
                    <div key={item.crew?.id || index} className="row card compact" style={{ alignItems: "center" }}>
                      <div>
                        <strong>#{index + 1} {item.crew?.name || "Unknown tech"}</strong>
                        <div className="small muted">{[item.crew?.phone ? formatPhone(item.crew.phone) : "", item.crew?.email || ""].filter(Boolean).join(" • ") || "No contact details"}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>{stars(item.average)} {item.average.toFixed(1)}</div>
                        <div className="small muted">{item.count} rating{item.count === 1 ? "" : "s"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="small muted">No ratings for this client yet.</p>}
            </div>
          </div>
        ) : (
          <div className="card compact">
            <strong>No client selected</strong>
            <p className="small muted">Add or choose a business client to manage contacts and top techs.</p>
          </div>
        )}
      </section>
    </div>
  );
}
