"use client";

import { useEffect, useMemo, useState } from "react";

type ReviewRow = {
  id: string;
  crew_id: string;
  status: string;
  request_type: "full_onboarding" | "w9_only" | "contract_only";
  submitted_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
  crew: Record<string, unknown>;
  tax_profile: Record<string, unknown> | null;
};

type DocumentType = "profile_photo" | "work_photo" | "w9" | "contract";
type CityPoolOption = { id: string; name: string };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function fileLocationLabel(value: unknown) {
  const clean = text(value);
  if (!clean) return "Missing";
  if (/^gdrive:/i.test(clean) || /^google-drive:/i.test(clean)) return "Archived in secure Google Drive";
  return clean;
}

function statusBadge(value: unknown) {
  const label = text(value) || "missing";
  const good = ["approved", "complete", "uploaded"].includes(label);
  const warn = ["submitted", "needs_review", "requested", "request_sent"].includes(label);
  return <span className={good ? "badge success" : warn ? "badge warning" : "badge"}>{label.replace(/_/g, " ")}</span>;
}

function requestTypeLabel(value: ReviewRow["request_type"]) {
  if (value === "w9_only") return "W-9 only";
  if (value === "contract_only") return "Contract only";
  return "Full onboarding";
}

function InfoLine({ label, value }: { label: string; value: unknown }) {
  const clean = text(value);
  if (!clean) return null;
  return (
    <div className="row" style={{ borderBottom: "1px solid var(--line)", padding: "6px 0", gap: 12 }}>
      <span className="muted small">{label}</span>
      <strong className="small" style={{ textAlign: "right", overflowWrap: "anywhere" }}>{clean}</strong>
    </div>
  );
}

export default function OnboardingCenterPage() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"needs_review" | "all" | "approved">("needs_review");
  const [correctionNotes, setCorrectionNotes] = useState<Record<string, string>>({});
  const [cityPools, setCityPools] = useState<CityPoolOption[]>([]);
  const [positionOptions, setPositionOptions] = useState<string[]>([]);
  const [newInvite, setNewInvite] = useState({ name: "", phone: "", email: "" });
  const [newInviteBusy, setNewInviteBusy] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState("");
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; account_email?: string | null; message?: string }>({ connected: false });
  const [googleStatusLoading, setGoogleStatusLoading] = useState(true);

  async function loadRows() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_onboarding_review_queue" }),
      });
      const result = (await response.json()) as { ok?: boolean; rows?: ReviewRow[]; city_pools?: CityPoolOption[]; position_options?: string[]; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to load onboarding review queue.");
      setRows(result.rows || []);
      setCityPools(result.city_pools || []);
      setPositionOptions(result.position_options || []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load onboarding review queue.");
    } finally {
      setLoading(false);
    }
  }

  async function loadGoogleStatus() {
    setGoogleStatusLoading(true);
    try {
      const response = await fetch("/api/shows/google-calendar?action=status");
      const result = (await response.json()) as { connected?: boolean; account_email?: string | null; message?: string };
      setGoogleStatus({ connected: Boolean(result.connected), account_email: result.account_email || null, message: result.message });
    } catch {
      setGoogleStatus({ connected: false, message: "Unable to read Google connection status." });
    } finally {
      setGoogleStatusLoading(false);
    }
  }

  useEffect(() => {
    void loadRows();
    void loadGoogleStatus();
  }, []);

  const visibleRows = useMemo(() => rows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "approved") return row.status === "approved";
    return row.status !== "approved";
  }), [rows, filter]);

  async function openSecureDocument(row: ReviewRow, documentType: DocumentType, storagePath: string, download = false) {
    const cleanPath = text(storagePath);
    if (!cleanPath) {
      setMessage("No file is attached for that item.");
      return;
    }
    setBusyId(`${row.id}-${documentType}`);
    setMessage(download ? "Preparing secure download link..." : "Preparing secure file link...");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_signed_document_url",
          crew_id: row.crew_id,
          document_type: documentType,
          storage_path: cleanPath,
          download,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; signed_url?: string; message?: string };
      if (!response.ok || !result.ok || !result.signed_url) throw new Error(result.message || "Unable to create secure file link.");
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = result.signed_url;
        anchor.rel = "noopener noreferrer";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setMessage("Secure download started. The link expires in 10 minutes.");
        return;
      }
      const opened = window.open(result.signed_url, "_blank");
      if (!opened) {
        window.location.assign(result.signed_url);
        return;
      }
      setMessage("Secure file opened. The link expires in 10 minutes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open secure file.");
    } finally {
      setBusyId(null);
    }
  }

  async function approveRow(row: ReviewRow) {
    setBusyId(row.id);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve_onboarding_submission", request_id: row.id }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to approve onboarding submission.");
      setMessage(result.message || "Onboarding approved.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to approve onboarding submission.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeSecureDocument(row: ReviewRow, documentType: DocumentType, storagePath: string) {
    const cleanPath = text(storagePath);
    if (!cleanPath) return;
    const ok = window.confirm("Remove this file from the onboarding record? This does not delete the crew contact.");
    if (!ok) return;
    setBusyId(`${row.id}-${documentType}-remove`);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_onboarding_document",
          request_id: row.id,
          crew_id: row.crew_id,
          document_type: documentType,
          storage_path: cleanPath,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to remove file.");
      setMessage(result.message || "File removed.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove file.");
    } finally {
      setBusyId(null);
    }
  }

  async function sendBackForCorrection(row: ReviewRow) {
    const note = text(correctionNotes[row.id]);
    if (!note) {
      setMessage("Type what needs to be fixed before sending it back.");
      return;
    }
    setBusyId(`${row.id}-correction`);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_onboarding_correction",
          request_id: row.id,
          correction_note: note,
          queue_text: true,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to send correction request.");
      setMessage(result.message || "Correction request sent.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send correction request.");
    } finally {
      setBusyId(null);
    }
  }



  async function createNewOnboardingRequest() {
    if (!text(newInvite.name)) { setMessage("Enter the crew member's name."); return; }
    if (!text(newInvite.phone) && !text(newInvite.email)) { setMessage("Enter at least a phone number or email address."); return; }
    setNewInviteBusy(true);
    setMessage("");
    setLastInviteLink("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_new_crew_request", ...newInvite, queue_text: true }),
      });
      const result = (await response.json()) as { ok?: boolean; link?: string; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to create onboarding request.");
      setLastInviteLink(result.link || "");
      setMessage(result.message || "Onboarding request created.");
      setNewInvite({ name: "", phone: "", email: "" });
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create onboarding request.");
    } finally {
      setNewInviteBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!lastInviteLink) return;
    try {
      await navigator.clipboard.writeText(lastInviteLink);
      setMessage("Secure onboarding link copied.");
    } catch {
      setMessage(lastInviteLink);
    }
  }

  async function deleteSubmission(row: ReviewRow) {
    if (row.status === "approved") {
      setMessage("Approved onboarding submissions cannot be deleted from here.");
      return;
    }
    const ok = window.confirm(
      "Delete this onboarding submission? This removes the pending review packet and its uploaded files. An existing Crew contact is preserved; a hidden pending contact created only for this request may also be removed.",
    );
    if (!ok) return;
    setBusyId(`${row.id}-delete-submission`);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_onboarding_submission",
          request_id: row.id,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to delete onboarding submission.");
      setMessage(result.message || "Onboarding submission deleted.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete onboarding submission.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h2 style={{ marginBottom: 6 }}>Send New Crew Onboarding</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Send a full questionnaire even when the person is not in Crew yet. ELS keeps the pending record out of Crew until you approve the completed packet.
        </p>
        <div className="grid grid-3">
          <label className="field"><span>Name</span><input value={newInvite.name} onChange={(event) => setNewInvite((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field"><span>Phone</span><input value={newInvite.phone} onChange={(event) => setNewInvite((current) => ({ ...current, phone: event.target.value }))} placeholder="Used for the queued text" /></label>
          <label className="field"><span>Email</span><input type="email" value={newInvite.email} onChange={(event) => setNewInvite((current) => ({ ...current, email: event.target.value }))} /></label>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="primary" type="button" disabled={newInviteBusy} onClick={() => void createNewOnboardingRequest()}>
            {newInviteBusy ? "Creating..." : "Create + queue onboarding"}
          </button>
          {lastInviteLink ? <button className="ghost" type="button" onClick={() => void copyInviteLink()}>Copy secure link</button> : null}
          <span className="muted small">Matches an existing Crew contact by email/phone; otherwise creates a hidden pending contact.</span>
        </div>
        {lastInviteLink ? <p className="muted small" style={{ overflowWrap: "anywhere" }}>{lastInviteLink}</p> : null}
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Google Drive Onboarding Archive</h2>
            <p className="muted" style={{ margin: 0 }}>
              W-9 and signed contract PDFs are archived as: ELS Onboarding → Main City → Crew Name → Onboarding Documents.
            </p>
          </div>
          <div className="toolbar">
            <button className="primary" type="button" disabled={googleStatusLoading} onClick={() => { window.location.href = "/api/shows/google-calendar?action=connect"; }}>
              {googleStatus.connected ? "Reconnect Google" : "Connect Google Drive"}
            </button>
            <button className="ghost" type="button" disabled={googleStatusLoading} onClick={() => void loadGoogleStatus()}>Refresh status</button>
          </div>
        </div>
        <p className={googleStatus.connected ? "success" : "muted small"} style={{ marginBottom: 0 }}>
          {googleStatusLoading ? "Checking connection..." : googleStatus.connected ? `Connected to ${googleStatus.account_email || "Google"}.` : googleStatus.message || "Not connected yet. Documents will fall back to private app storage until Google is connected."}
        </p>
      </section>

      <section className="card">
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Onboarding Review Center</h2>
            <p className="muted" style={{ margin: 0 }}>
              Review submitted onboarding packets, open private files, compare saved W-9 tax data, then approve the submission to apply Crew and Tax records.
            </p>
          </div>
          <div className="toolbar">
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
              <option value="all">All submitted</option>
            </select>
            <button className="ghost" type="button" onClick={() => void loadRows()} disabled={loading}>Refresh</button>
          </div>
        </div>
        {message ? <p className={message.toLowerCase().includes("unable") || message.toLowerCase().includes("cannot") ? "error" : "success"}>{message}</p> : null}
      </section>

      {loading ? <section className="card"><p className="muted">Loading onboarding submissions...</p></section> : null}

      {!loading && !visibleRows.length ? (
        <section className="card"><p className="muted">No onboarding submissions match this view.</p></section>
      ) : null}

      {visibleRows.map((row) => {
        const payload = row.payload || {};
        const crew = row.crew || {};
        const tax = row.tax_profile || null;
        const profilePhoto = text(payload.profile_photo_url) || text(crew.profile_photo_url);
        const w9Doc = text(payload.w9_document_url) || text(crew.w9_document_url);
        const contractDoc = text(payload.contract_document_url) || text(crew.contract_document_url);
        const workPhotos = list(payload.work_photo_urls).length ? list(payload.work_photo_urls) : list(crew.work_photo_urls);
        const digitalW9 = (payload.digital_w9 && typeof payload.digital_w9 === "object" ? payload.digital_w9 : {}) as Record<string, unknown>;
        const contractSignature = (payload.contract_signature && typeof payload.contract_signature === "object" ? payload.contract_signature : {}) as Record<string, unknown>;
        const isApproved = row.status === "approved";
        return (
          <section key={row.id} className="card">
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>{text(payload.legal_name) || text(crew.name) || "Unnamed crew member"}</h3>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  {requestTypeLabel(row.request_type)} • Submitted {text(row.submitted_at) || "unknown"} • Request {statusBadge(row.status)}
                </p>
              </div>
              <div className="toolbar">
                <button className="primary" type="button" disabled={isApproved || !["submitted", "correction_requested"].includes(row.status) || busyId === row.id} onClick={() => void approveRow(row)}>
                  {isApproved ? "Approved" : !["submitted", "correction_requested"].includes(row.status) ? "Awaiting submission" : busyId === row.id ? "Approving..." : "Approve + create/update Crew/Tax"}
                </button>
                {!isApproved ? (
                  <button className="ghost danger" type="button" disabled={Boolean(busyId)} onClick={() => void deleteSubmission(row)}>
                    {busyId === `${row.id}-delete-submission` ? "Deleting..." : "Delete submission"}
                  </button>
                ) : null}
              </div>
            </div>

            {text(payload.correction_note) ? (
              <div className="notice" style={{ marginTop: 12 }}>
                <strong>Last correction note:</strong> {text(payload.correction_note)}
              </div>
            ) : null}

            {!isApproved && ["submitted", "correction_requested"].includes(row.status) ? (
              <div className="card compact" style={{ background: "#fffdf2", borderColor: "#f4c542", marginTop: 12 }}>
                <label className="field">
                  <span>Send back for correction</span>
                  <textarea
                    rows={3}
                    value={correctionNotes[row.id] || ""}
                    onChange={(event) => setCorrectionNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                    placeholder="Example: Please upload a clearer profile photo and fix the W-9 address."
                  />
                </label>
                <div className="toolbar">
                  <button className="ghost" type="button" disabled={Boolean(busyId)} onClick={() => void sendBackForCorrection(row)}>
                    Send back with note
                  </button>
                  <span className="muted small">Keeps their existing information prefilled when they reopen the link.</span>
                </div>
              </div>
            ) : null}

            <div className="grid grid-3" style={{ marginTop: 14 }}>
              <div className="card compact" style={{ background: "#fbfcfd" }}>
                <h3 style={{ marginTop: 0 }}>Submitted crew info</h3>
                <InfoLine label="Legal name" value={payload.legal_name || crew.name} />
                <InfoLine label="Preferred name" value={payload.preferred_name} />
                <InfoLine label="Phone" value={payload.phone || crew.phone} />
                <InfoLine label="Email" value={payload.email || crew.email} />
                <InfoLine label="Home address" value={payload.address || crew.address} />
                <InfoLine label="Main local city" value={cityPools.find((pool) => pool.id === text(payload.primary_city_pool_id))?.name || payload.city_state} />
                <InfoLine label="Other local pools" value={list(payload.local_city_pool_ids).map((id) => cityPools.find((pool) => pool.id === id)?.name || id).join(", ")} />
                <InfoLine label="Other local cities" value={payload.other_local_cities} />
                <InfoLine label="Emergency contact" value={[payload.emergency_contact_name, payload.emergency_contact_phone].map(text).filter(Boolean).join(" • ")} />
                <InfoLine label="Positions" value={list(payload.positions).join(", ")} />
                <InfoLine label="Years experience" value={payload.years_experience} />
                <InfoLine label="Transportation" value={payload.has_transportation} />
                <InfoLine label="Own tools" value={payload.has_tools} />
                <InfoLine label="Rate expectation" value={payload.rate_expectation} />
                <InfoLine label="Travel" value={payload.travel_availability} />
                <InfoLine label="Travel markets" value={payload.travel_markets} />
                <InfoLine label="Hotel/flight" value={payload.hotel_flight_willing} />
                <InfoLine label="Skills" value={payload.skills} />
                <InfoLine label="Equipment" value={payload.equipment_experience} />
              </div>

              <div className="card compact" style={{ background: "#fbfcfd" }}>
                <h3 style={{ marginTop: 0 }}>Files to review</h3>
                {[
                  ["Profile photo", "profile_photo", profilePhoto],
                  ["W-9 PDF/hard copy", "w9", w9Doc],
                  ["Signed contract PDF", "contract", contractDoc],
                ].map(([label, kind, path]) => (
                  <div key={String(kind)} className="card compact" style={{ background: "#fff", marginBottom: 8 }}>
                    <strong>{label}</strong>
                    <div className="muted small" style={{ overflowWrap: "anywhere" }}>{fileLocationLabel(path)}</div>
                    <div className="toolbar" style={{ marginTop: 8 }}>
                      <button className="ghost" type="button" disabled={!text(path) || Boolean(busyId)} onClick={() => void openSecureDocument(row, kind as DocumentType, text(path), false)}>Open</button>
                      <button className="ghost" type="button" disabled={!text(path) || Boolean(busyId)} onClick={() => void openSecureDocument(row, kind as DocumentType, text(path), true)}>Download</button>
                      <button className="ghost danger" type="button" disabled={!text(path) || Boolean(busyId)} onClick={() => void removeSecureDocument(row, kind as DocumentType, text(path))}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card compact" style={{ background: tax ? "#f0fdf4" : "#fff7ed" }}>
                <h3 style={{ marginTop: 0 }}>Tax data saved</h3>
                {tax ? (
                  <>
                    <InfoLine label="Legal tax name" value={tax.tax_legal_name} />
                    <InfoLine label="Business name" value={tax.business_name} />
                    <InfoLine label="Class" value={[tax.federal_tax_classification, tax.llc_tax_classification].map(text).filter(Boolean).join(" • ")} />
                    <InfoLine label="Address" value={[tax.tax_address_line_1, tax.tax_city_state_zip].map(text).filter(Boolean).join(", ")} />
                    <InfoLine label="TIN" value={`${text(tax.tin_type).toUpperCase()} ending ${text(tax.tin_last4)}`} />
                    <InfoLine label="Signer" value={tax.signer_name} />
                    <InfoLine label="Signed at" value={tax.signed_at} />
                    <InfoLine label="Source" value={tax.source} />
                  </>
                ) : (
                  <p className="muted small">No structured tax data is saved yet. Open the W-9 PDF and use the Tax Center to enter/confirm the tax data before approving for 1099 filing.</p>
                )}
                {Object.keys(digitalW9).length ? (
                  <div className="notice" style={{ marginTop: 10 }}>
                    <strong>Submitted digital W-9:</strong> {text(digitalW9.tax_legal_name)} • {text(digitalW9.tin_type).toUpperCase()} ending {text(digitalW9.tin_last4)} • cert {text(digitalW9.certification_confirmed) || "yes"}
                  </div>
                ) : null}
                {Object.keys(contractSignature).length ? (
                  <div className="notice" style={{ marginTop: 10 }}>
                    <strong>Contract signature:</strong> {text(contractSignature.contractor_name)} • effective {text(contractSignature.effective_date)}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
