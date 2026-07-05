"use client";

import { useEffect, useMemo, useState } from "react";
import { openDocumentInApp } from "@/lib/export-documents";

type ReviewRow = {
  id: string;
  crew_id: string;
  status: string;
  request_type: "full_onboarding" | "w9_only" | "contract_only";
  sent_by_user_id: string;
  sent_by_name: string;
  sent_by_email: string;
  send_history_count: number;
  sent_at: string;
  opened_at: string;
  submitted_at: string;
  expires_at: string;
  updated_at: string;
  link: string;
  payload: Record<string, unknown>;
  crew: Record<string, unknown>;
  tax_profile: Record<string, unknown> | null;
};

type OnboardingAccess = {
  viewer_role: string;
  can_review: boolean;
  current_user_id: string;
  current_user_name: string;
};

type CoordinatorOnboardingRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  city_name: string;
  group_name: string;
  onboarding_complete: boolean;
  progress_status: "complete" | "submitted_for_admin_review" | "in_progress" | "not_started";
  onboarding_request_sent_at: string | null;
  onboarding_completed_at: string | null;
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

function dateTimeLabel(value: unknown) {
  const clean = text(value);
  if (!clean) return "—";
  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime()) ? clean : parsed.toLocaleString();
}

function requestTypeLabel(value: ReviewRow["request_type"]) {
  if (value === "w9_only") return "W-9 only";
  if (value === "contract_only") return "Contract only";
  return "Full onboarding";
}

function onboardingInvitationMessage(name: unknown, link: unknown, senderName: unknown, requestType: ReviewRow["request_type"] = "full_onboarding") {
  const crewName = text(name) || "there";
  const firstName = crewName.split(/\s+/)[0] || "there";
  const sender = text(senderName) || "ELS Coordinator";
  const secureLink = text(link);
  const requestLine = requestType === "w9_only"
    ? "Please complete and sign your W-9 through this secure link:"
    : requestType === "contract_only"
      ? "Please complete and sign your Independent Contractor Agreement through this secure link:"
      : "Please complete your secure ELS onboarding questionnaire, profile photo, W-9, and contractor agreement using this link:";
  return [
    `Hi ${firstName}, ${sender} with Emanuel Labor Services has sent you an onboarding request.`,
    requestLine,
    secureLink,
    "Please do not send SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
    `Coordinator: ${sender}\nEmanuel Labor Services`,
  ].filter(Boolean).join("\n\n");
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
  const [lastInviteMessage, setLastInviteMessage] = useState("");
  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; account_email?: string | null; message?: string }>({ connected: false });
  const [googleStatusLoading, setGoogleStatusLoading] = useState(true);
  const [access, setAccess] = useState<OnboardingAccess>({ viewer_role: "viewer", can_review: false, current_user_id: "", current_user_name: "" });
  const [coordinatorMode, setCoordinatorMode] = useState(false);
  const [coordinatorRows, setCoordinatorRows] = useState<CoordinatorOnboardingRow[]>([]);
  const [coordinatorReadOnly, setCoordinatorReadOnly] = useState(false);
  const [coordinatorBusyId, setCoordinatorBusyId] = useState<string | null>(null);

  async function loadCoordinatorDashboard() {
    const response = await fetch("/api/onboarding?action=coordinator_dashboard", { method: "GET", cache: "no-store" });
    const result = (await response.json()) as {
      ok?: boolean;
      mode?: "admin" | "coordinator";
      read_only?: boolean;
      rows?: CoordinatorOnboardingRow[];
      message?: string;
    };
    if (!response.ok || !result.ok) throw new Error(result.message || "Unable to load coordinator onboarding status.");
    const isCoordinator = result.mode === "coordinator";
    setCoordinatorMode(isCoordinator);
    setCoordinatorReadOnly(Boolean(result.read_only));
    setCoordinatorRows(isCoordinator ? result.rows || [] : []);
    return { isCoordinator, readOnly: Boolean(result.read_only) };
  }

  async function loadRows() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_onboarding_review_queue" }),
      });
      const result = (await response.json()) as { ok?: boolean; rows?: ReviewRow[]; city_pools?: CityPoolOption[]; position_options?: string[]; viewer_role?: string; can_review?: boolean; current_user_id?: string; current_user_name?: string; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to load onboarding review queue.");
      const nextRows = result.rows || [];
      setRows(nextRows);
      window.dispatchEvent(new CustomEvent("els:onboarding-review-count", {
        detail: nextRows.filter((row) => row.status === "submitted").length,
      }));
      setCityPools(result.city_pools || []);
      setPositionOptions(result.position_options || []);
      setAccess({
        viewer_role: result.viewer_role || "viewer",
        can_review: Boolean(result.can_review),
        current_user_id: result.current_user_id || "",
        current_user_name: result.current_user_name || "",
      });
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
    let cancelled = false;
    async function initializePage() {
      setLoading(true);
      try {
        const dashboard = await loadCoordinatorDashboard();
        if (cancelled) return;
        if (dashboard.isCoordinator && dashboard.readOnly) {
          setLoading(false);
          return;
        }
        await loadRows();
      } catch (error) {
        if (cancelled) return;
        setMessage(error instanceof Error ? error.message : "Unable to load onboarding.");
        setLoading(false);
      }
    }
    void initializePage();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (access.can_review) void loadGoogleStatus();
  }, [access.can_review]);

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
      const crewName = text(row.crew?.name) || "Crew member";
      const documentLabel = `${crewName} ${documentType.replace(/_/g, " ")}`;
      const returnPath = `${window.location.pathname}${window.location.search}`;
      openDocumentInApp(result.signed_url, documentLabel, returnPath);
      return;
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
    if (coordinatorReadOnly) { setMessage("View as user mode is read-only. Exit the preview to send onboarding."); return; }
    if (!text(newInvite.name)) { setMessage("Enter the crew member's name."); return; }
    if (!text(newInvite.phone) && !text(newInvite.email)) { setMessage("Enter at least a phone number or email address."); return; }
    setNewInviteBusy(true);
    setMessage("");
    setLastInviteLink("");
    setLastInviteMessage("");
    try {
      const inviteName = newInvite.name;
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_new_crew_request", ...newInvite, queue_text: true }),
      });
      const result = (await response.json()) as { ok?: boolean; link?: string; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to create onboarding request.");
      setLastInviteLink(result.link || "");
      setLastInviteMessage(onboardingInvitationMessage(inviteName, result.link || "", access.current_user_name));
      setMessage(result.message || "Onboarding request created.");
      setNewInvite({ name: "", phone: "", email: "" });
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create onboarding request.");
    } finally {
      setNewInviteBusy(false);
    }
  }

  async function sendCoordinatorOnboarding(row: CoordinatorOnboardingRow) {
    if (coordinatorReadOnly) {
      setMessage("View as user mode is read-only. Exit the preview to send onboarding.");
      return;
    }
    if (!row.phone) {
      setMessage(`${row.name || "This crew member"} needs a phone number before the onboarding text can be queued.`);
      return;
    }
    const confirmed = window.confirm(`Create or reuse the secure full-onboarding link for ${row.name} and queue the text?`);
    if (!confirmed) return;
    setCoordinatorBusyId(row.id);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_request", crew_id: row.id, request_type: "full_onboarding", queue_text: true }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to send onboarding.");
      await Promise.all([loadCoordinatorDashboard(), loadRows()]);
      setMessage(result.message || "Onboarding request queued.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send onboarding.");
    } finally {
      setCoordinatorBusyId(null);
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

  async function copyInviteMessage() {
    if (!lastInviteMessage) return;
    try {
      await navigator.clipboard.writeText(lastInviteMessage);
      setMessage("Onboarding invitation message copied with your coordinator name.");
    } catch {
      setMessage(lastInviteMessage);
    }
  }

  async function copyRowLink(row: ReviewRow) {
    if (!row.link) return;
    try {
      await navigator.clipboard.writeText(row.link);
      setMessage(`Secure onboarding link copied for ${text(row.crew.name) || text(row.payload.invite_name) || "crew member"}.`);
    } catch {
      setMessage(row.link);
    }
  }

  async function copyRowInvitationMessage(row: ReviewRow) {
    const displayName = text(row.crew.name) || text(row.payload.invite_name) || "there";
    const invitation = onboardingInvitationMessage(displayName, row.link, access.current_user_name, row.request_type);
    try {
      await navigator.clipboard.writeText(invitation);
      setMessage(`Onboarding invitation message copied for ${displayName} with your coordinator name.`);
    } catch {
      setMessage(invitation);
    }
  }

  async function resendRequest(row: ReviewRow) {
    setBusyId(`${row.id}-resend`);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend_request", request_id: row.id }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) throw new Error(result.message || "Unable to queue onboarding reminder.");
      setMessage(result.message || "Onboarding reminder queued.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to queue onboarding reminder.");
    } finally {
      setBusyId(null);
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
      {coordinatorMode ? (
        <section className="card">
          <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
            <div>
              <h2 style={{ marginBottom: 6 }}>Crew Onboarding Status</h2>
              <p className="muted" style={{ margin: 0 }}>
                See whether onboarding is complete for crew in your own pool. Private W-9, tax-number, contract-document, and approval details remain visible only to Owner/Admin.
              </p>
            </div>
            <span className="badge success">{coordinatorRows.filter((row) => row.onboarding_complete).length} complete / {coordinatorRows.length} crew</span>
          </div>
          {coordinatorReadOnly ? <div className="notice" style={{ marginTop: 12 }}>View as user mode is read-only. This is exactly the completion information the coordinator can see.</div> : null}
          <div className="list" style={{ marginTop: 14 }}>
            {coordinatorRows.map((row) => (
              <article key={row.id} className="card compact" style={{ boxShadow: "none" }}>
                <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <div className="toolbar" style={{ gap: 7 }}>
                      <strong>{row.name || "Unnamed crew member"}</strong>
                      {statusBadge(row.progress_status)}
                    </div>
                    <div className="muted small">{[row.city_name, row.group_name].filter(Boolean).join(" • ")}</div>
                    <div className="muted small">Request sent: {dateTimeLabel(row.onboarding_request_sent_at)} • Completed: {dateTimeLabel(row.onboarding_completed_at)}</div>
                  </div>
                  <button
                    className={row.onboarding_complete ? "ghost" : "primary"}
                    type="button"
                    disabled={coordinatorReadOnly || coordinatorBusyId === row.id || !row.phone}
                    onClick={() => void sendCoordinatorOnboarding(row)}
                  >
                    {coordinatorBusyId === row.id ? "Queueing..." : row.onboarding_complete ? "Send again" : row.onboarding_request_sent_at ? "Resend / reuse link" : "Send onboarding"}
                  </button>
                </div>
              </article>
            ))}
            {!coordinatorRows.length && !loading ? <p className="muted small" style={{ margin: 0 }}>No crew members are available in your assigned pool yet.</p> : null}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="row" style={{ alignItems: "center", gap: 14 }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Crew Invoice Template</h2>
            <p className="muted" style={{ margin: 0 }}>
              Download the reusable, no-logo Word invoice template for crew members who need help preparing an invoice. It can also be edited for work completed for another company.
            </p>
          </div>
          <a className="primary" href="/Crew_Invoice_Template_Generic.docx" download="Crew_Invoice_Template_Generic.docx">
            Download invoice template
          </a>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 6 }}>Send New Crew Onboarding</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Send a full onboarding packet even when the person is not in Crew yet. Matching email or phone records reuse the same active secure link, so an admin and coordinator will not create competing packets for the same person.
        </p>
        <div className="grid grid-3">
          <label className="field"><span>Name</span><input value={newInvite.name} onChange={(event) => setNewInvite((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="field"><span>Phone</span><input value={newInvite.phone} onChange={(event) => setNewInvite((current) => ({ ...current, phone: event.target.value }))} placeholder="Used for the queued text" /></label>
          <label className="field"><span>Email</span><input type="email" value={newInvite.email} onChange={(event) => setNewInvite((current) => ({ ...current, email: event.target.value }))} /></label>
        </div>
        <div className="toolbar" style={{ marginTop: 12 }}>
          <button className="primary" type="button" disabled={newInviteBusy || coordinatorReadOnly} onClick={() => void createNewOnboardingRequest()}>
            {newInviteBusy ? "Creating..." : "Create/reuse + queue onboarding"}
          </button>
          {lastInviteLink ? <button className="ghost" type="button" onClick={() => void copyInviteLink()}>Copy secure link</button> : null}
          {lastInviteMessage ? <button className="ghost" type="button" onClick={() => void copyInviteMessage()}>Copy invitation message</button> : null}
          <span className="muted small">Matches by email/phone, reuses an active link when available, and otherwise creates a hidden pending contact.</span>
        </div>
        {lastInviteLink ? <p className="muted small" style={{ overflowWrap: "anywhere" }}>{lastInviteLink}</p> : null}
      </section>

      {access.can_review ? (
        <section className="card">
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>Google Drive Onboarding Archive</h2>
            <p className="muted" style={{ margin: 0 }}>
              After owner approval, W-9 and signed contract PDFs are archived as: ELS Onboarding → Main City → Crew Name → Onboarding Documents.
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
      ) : null}

      <section className="card">
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <div>
            <h2 style={{ marginBottom: 6 }}>{access.can_review ? "Onboarding Review Center" : "Coordinator Onboarding Tracker"}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {access.can_review
                ? "Review every onboarding packet sent by an admin or coordinator, inspect private documents, and approve completed records."
                : "Track the onboarding links you sent, see when each person opens or submits the packet, and queue a reminder using the same secure link."}
            </p>
          </div>
          <div className="toolbar">
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="needs_review">{access.can_review ? "Needs review" : "Active / awaiting completion"}</option>
              <option value="approved">{access.can_review ? "Approved" : "Approved / complete"}</option>
              <option value="all">All requests</option>
            </select>
            <button className="ghost" type="button" onClick={() => void loadRows()} disabled={loading}>Refresh</button>
          </div>
        </div>
        {message ? <p className={message.toLowerCase().includes("unable") || message.toLowerCase().includes("cannot") ? "error" : "success"}>{message}</p> : null}
      </section>

      {loading ? <section className="card"><p className="muted">Loading onboarding submissions...</p></section> : null}

      {!loading && !visibleRows.length ? (
        <section className="card"><p className="muted">No onboarding requests match this view.</p></section>
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
        if (!access.can_review) {
          const displayName = text(crew.name) || text(payload.invite_name) || "Unnamed crew member";
          const canRemind = !["submitted", "approved"].includes(row.status);
          return (
            <section key={row.id} className="card">
              <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
                <div>
                  <h3 style={{ margin: 0 }}>{displayName}</h3>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>
                    {requestTypeLabel(row.request_type)} • {statusBadge(row.status)}
                  </p>
                </div>
                <div className="toolbar">
                  <button className="ghost" type="button" onClick={() => void copyRowLink(row)} disabled={!row.link}>Copy same link</button>
                  <button className="ghost" type="button" onClick={() => void copyRowInvitationMessage(row)} disabled={!row.link}>Copy invitation message</button>
                  <button className="primary" type="button" onClick={() => void resendRequest(row)} disabled={!canRemind || Boolean(busyId)}>
                    {busyId === `${row.id}-resend` ? "Queueing..." : row.status === "submitted" ? "Submitted" : row.status === "approved" ? "Approved" : "Queue reminder"}
                  </button>
                </div>
              </div>
              <div className="grid grid-3" style={{ marginTop: 12 }}>
                <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Sent</div><strong>{dateTimeLabel(row.sent_at)}</strong></div>
                <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Opened</div><strong>{dateTimeLabel(row.opened_at)}</strong></div>
                <div className="card compact" style={{ boxShadow: "none" }}><div className="muted small">Submitted</div><strong>{dateTimeLabel(row.submitted_at)}</strong></div>
              </div>
              <div className="grid grid-3" style={{ marginTop: 12 }}>
                <InfoLine label="Phone" value={crew.phone || payload.invite_phone} />
                <InfoLine label="Email" value={crew.email || payload.invite_email} />
                <InfoLine label="Last sent by" value={[row.sent_by_name, row.sent_by_email].map(text).filter(Boolean).join(" • ")} />
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>
                This secure link has been used {row.send_history_count || 1} time{(row.send_history_count || 1) === 1 ? "" : "s"}. Admin can see this request and will review private W-9, contract, and tax information after submission.
              </p>
            </section>
          );
        }
        return (
          <section key={row.id} className="card">
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>{text(payload.legal_name) || text(crew.name) || "Unnamed crew member"}</h3>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  {requestTypeLabel(row.request_type)} • Sent by {row.sent_by_name || row.sent_by_email || "ELS user"} • Submitted {dateTimeLabel(row.submitted_at)} • Request {statusBadge(row.status)}
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
