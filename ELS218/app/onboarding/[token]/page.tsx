"use client";

import { use, useEffect, useRef, useState, type PointerEvent } from "react";

type PageProps = {
  params: Promise<{ token: string }>;
};

type UploadKind = "profile_photo" | "work_photo" | "w9" | "contract";
type RequestType = "full_onboarding" | "w9_only";

type DigitalW9State = {
  tax_legal_name: string;
  business_name: string;
  federal_tax_classification: string;
  llc_tax_classification: string;
  other_classification: string;
  exempt_payee_code: string;
  fatca_code: string;
  tax_address_line_1: string;
  tax_city_state_zip: string;
  account_numbers: string;
  tin_type: "ssn" | "ein";
  tin: string;
  signer_name: string;
  signature_data_url: string;
  certification_confirmed: boolean;
};

type FormState = {
  legal_name: string;
  preferred_name: string;
  phone: string;
  email: string;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  city_state: string;
  positions: string;
  skills: string;
  equipment_experience: string;
  travel_availability: string;
  hotel_flight_willing: string;
  profile_photo_note: string;
  work_photo_note: string;
  w9_status_note: string;
  contract_acknowledged: boolean;
  profile_photo_url: string;
  work_photo_urls: string[];
  w9_document_url: string;
  contract_document_url: string;
  digital_w9: DigitalW9State;
};

type UploadStatus = Partial<Record<UploadKind, { loading: boolean; text: string; kind: "success" | "error" | "info" }>>;

const IRS_W9_FORM_URL = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";

const uploadLabels: Record<UploadKind, string> = {
  profile_photo: "Profile photo",
  work_photo: "Work photo",
  w9: "W-9 document",
  contract: "Contract document",
};

function blankDigitalW9(): DigitalW9State {
  return {
    tax_legal_name: "",
    business_name: "",
    federal_tax_classification: "individual",
    llc_tax_classification: "",
    other_classification: "",
    exempt_payee_code: "",
    fatca_code: "",
    tax_address_line_1: "",
    tax_city_state_zip: "",
    account_numbers: "",
    tin_type: "ssn",
    tin: "",
    signer_name: "",
    signature_data_url: "",
    certification_confirmed: false,
  };
}

function OfficialW9HelpCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className="card compact" style={{ background: "#fffdf2", borderColor: "#f4c542", marginTop: compact ? 0 : 16 }}>
      <h3 style={{ marginTop: 0 }}>Official IRS Form W-9</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        You can complete the W-9 directly in this secure ELS page, or open the current official IRS PDF, fill/sign it, then upload the completed copy.
      </p>
      <div className="toolbar">
        <a className="ghost" href={IRS_W9_FORM_URL} target="_blank" rel="noopener noreferrer">Open official IRS W-9 PDF</a>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Do not text or email your SSN, EIN, or tax information. Use this secure page only.
      </p>
    </div>
  );
}

function normalizeRequestType(value: unknown): RequestType {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/[ -]+/g, "_");
  if (["w9", "w_9", "w9_only", "tax", "tax_only", "tax_docs", "tax_docs_only"].includes(normalized)) return "w9_only";
  return "full_onboarding";
}

function fileBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "") || "photo";
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to compress image."));
    }, type, quality);
  });
}

async function compressImage(file: File, maxWidth: number, maxHeight: number, quality: number) {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/webp" && file.size < 600_000) return file;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to read image."));
      img.src = objectUrl;
    });

    const ratio = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    const targetWidth = Math.max(1, Math.round(image.width * ratio));
    const targetHeight = Math.max(1, Math.round(image.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to compress image.");
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToBlob(canvas, "image/webp", quality);
    return new File([blob], `${fileBaseName(file.name)}.webp`, { type: "image/webp", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function prepareUploadFile(kind: UploadKind, file: File) {
  if (kind === "profile_photo") return compressImage(file, 800, 800, 0.75);
  if (kind === "work_photo") return compressImage(file, 1600, 1600, 0.75);
  return file;
}

function cleanDigits(value: string) {
  return value.replace(/\D/g, "");
}

function digitalW9MissingFields(w9: DigitalW9State) {
  const missing: string[] = [];
  if (!w9.tax_legal_name.trim()) missing.push("legal tax name");
  if (!w9.tax_address_line_1.trim()) missing.push("tax mailing address");
  if (!w9.tax_city_state_zip.trim()) missing.push("city/state/ZIP");
  if (cleanDigits(w9.tin).length !== 9) missing.push("9-digit SSN/EIN");
  if (!w9.signer_name.trim()) missing.push("signature name");
  if (!w9.signature_data_url) missing.push("drawn signature");
  if (!w9.certification_confirmed) missing.push("certification checkbox");
  return missing;
}

function tinPlaceholder(type: "ssn" | "ein") {
  return type === "ein" ? "12-3456789" : "123-45-6789";
}

function SignaturePad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(Boolean(value));

  function context() {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    return ctx;
  }

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function saveCanvas() {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawnRef.current) return;
    onChange(canvas.toDataURL("image/png"));
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = context();
    if (!ctx) return;
    const { x, y } = point(event);
    drawingRef.current = true;
    hasDrawnRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignored */ }
    saveCanvas();
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    onChange("");
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={650}
        height={150}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ width: "100%", maxWidth: 650, height: 150, border: "1px solid var(--line)", borderRadius: 14, background: "white", touchAction: "none" }}
        aria-label="Draw your signature"
      />
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button className="ghost" type="button" onClick={clear}>Clear signature</button>
        {value ? <span className="success small">Signature captured.</span> : <span className="muted small">Draw with your finger, mouse, or trackpad.</span>}
      </div>
    </div>
  );
}

function DigitalW9Form({ value, onChange, compact = false }: { value: DigitalW9State; onChange: (value: DigitalW9State) => void; compact?: boolean }) {
  function setField<K extends keyof DigitalW9State>(key: K, nextValue: DigitalW9State[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <div className="card compact" style={{ background: "#fbfcfd", marginTop: compact ? 0 : 16 }}>
      <h3 style={{ marginTop: 0 }}>Complete W-9 in the ELS app</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        This substitute W-9 captures the information ELS needs for 1099 records. Your TIN is encrypted on the server before it is saved.
      </p>

      <div className="grid grid-2">
        <label className="field"><span>Name as shown on tax return</span><input value={value.tax_legal_name} onChange={(event) => setField("tax_legal_name", event.target.value)} autoComplete="name" /></label>
        <label className="field"><span>Business name / disregarded entity name, if different</span><input value={value.business_name} onChange={(event) => setField("business_name", event.target.value)} /></label>
        <label className="field">
          <span>Federal tax classification</span>
          <select value={value.federal_tax_classification} onChange={(event) => setField("federal_tax_classification", event.target.value)}>
            <option value="individual">Individual / sole proprietor / single-member LLC</option>
            <option value="c_corporation">C Corporation</option>
            <option value="s_corporation">S Corporation</option>
            <option value="partnership">Partnership</option>
            <option value="trust_estate">Trust / estate</option>
            <option value="llc">Limited liability company</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field"><span>LLC tax classification, if LLC</span><input value={value.llc_tax_classification} onChange={(event) => setField("llc_tax_classification", event.target.value)} placeholder="C, S, or P" /></label>
        <label className="field"><span>Other classification, if selected</span><input value={value.other_classification} onChange={(event) => setField("other_classification", event.target.value)} /></label>
        <label className="field"><span>Exempt payee code, if any</span><input value={value.exempt_payee_code} onChange={(event) => setField("exempt_payee_code", event.target.value)} /></label>
        <label className="field"><span>FATCA exemption code, if any</span><input value={value.fatca_code} onChange={(event) => setField("fatca_code", event.target.value)} /></label>
        <label className="field"><span>Account numbers, if any</span><input value={value.account_numbers} onChange={(event) => setField("account_numbers", event.target.value)} /></label>
      </div>

      <div className="grid" style={{ gap: 12, marginTop: 14 }}>
        <label className="field"><span>Tax mailing address</span><input value={value.tax_address_line_1} onChange={(event) => setField("tax_address_line_1", event.target.value)} autoComplete="street-address" /></label>
        <label className="field"><span>City, state, ZIP</span><input value={value.tax_city_state_zip} onChange={(event) => setField("tax_city_state_zip", event.target.value)} placeholder="New Orleans, LA 70130" /></label>
      </div>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <label className="field">
          <span>TIN type</span>
          <select value={value.tin_type} onChange={(event) => setField("tin_type", event.target.value as "ssn" | "ein")}>
            <option value="ssn">SSN</option>
            <option value="ein">EIN</option>
          </select>
        </label>
        <label className="field"><span>{value.tin_type.toUpperCase()}</span><input value={value.tin} onChange={(event) => setField("tin", event.target.value)} placeholder={tinPlaceholder(value.tin_type)} inputMode="numeric" autoComplete="off" /></label>
      </div>

      <div className="card compact" style={{ background: "#fff", marginTop: 14 }}>
        <h4 style={{ marginTop: 0 }}>Certification</h4>
        <p className="muted small">
          By signing, you certify under penalties of perjury that the taxpayer identification number entered is correct, that you are not subject to backup withholding unless you have been notified otherwise, that you are a U.S. citizen or other U.S. person, and that any FATCA exemption code entered is correct.
        </p>
        <label className="field checkboxField">
          <span>I certify the substitute Form W-9 information above is accurate, and I am authorized to sign this form for ELS tax reporting.</span>
          <input type="checkbox" checked={value.certification_confirmed} onChange={(event) => setField("certification_confirmed", event.target.checked)} />
        </label>
        <label className="field"><span>Signer name</span><input value={value.signer_name} onChange={(event) => setField("signer_name", event.target.value)} /></label>
        <label className="field"><span>Signature</span><SignaturePad value={value.signature_data_url} onChange={(nextValue) => setField("signature_data_url", nextValue)} /></label>
      </div>
    </div>
  );
}

export default function OnboardingPage({ params }: PageProps) {
  const { token: tokenFromParams } = use(params);
  const [token, setToken] = useState(tokenFromParams);
  const [form, setForm] = useState<FormState>({
    legal_name: "",
    preferred_name: "",
    phone: "",
    email: "",
    address: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    city_state: "",
    positions: "",
    skills: "",
    equipment_experience: "",
    travel_availability: "",
    hotel_flight_willing: "",
    profile_photo_note: "",
    work_photo_note: "",
    w9_status_note: "",
    contract_acknowledged: false,
    profile_photo_url: "",
    work_photo_urls: [],
    w9_document_url: "",
    contract_document_url: "",
    digital_w9: blankDigitalW9(),
  });
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({});
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [requestType, setRequestType] = useState<RequestType>("full_onboarding");
  const [useDigitalW9, setUseDigitalW9] = useState(false);

  useEffect(() => {
    const effectiveToken = token || tokenFromParams;
    const mode = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mode") : "";
    if (mode) {
      const normalized = normalizeRequestType(mode);
      setRequestType(normalized);
      if (normalized === "w9_only") setUseDigitalW9(true);
    }
    if (!effectiveToken) return;

    let active = true;
    void fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read_request", token: effectiveToken }),
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Unable to read onboarding request.");
        if (active && result.request_type) {
          const normalized = normalizeRequestType(result.request_type);
          setRequestType(normalized);
          if (normalized === "w9_only") setUseDigitalW9(true);
        }
      })
      .catch((error) => {
        if (active) setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to read onboarding request." });
      });

    return () => {
      active = false;
    };
  }, [token, tokenFromParams]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setDigitalW9(value: DigitalW9State) {
    setForm((current) => ({ ...current, digital_w9: value }));
  }

  function setUploadMessage(kind: UploadKind, text: string, messageKind: "success" | "error" | "info", loading = false) {
    setUploadStatus((current) => ({ ...current, [kind]: { text, kind: messageKind, loading } }));
  }

  async function uploadFiles(kind: UploadKind, list: FileList | null) {
    const effectiveToken = token || tokenFromParams;
    const files = Array.from(list || []);
    if (!files.length) return;
    if (!effectiveToken) {
      setUploadMessage(kind, "Missing onboarding token.", "error");
      return;
    }

    setUploadMessage(kind, kind === "work_photo" ? `Uploading ${files.length} work photo${files.length === 1 ? "" : "s"}...` : `Uploading ${uploadLabels[kind]}...`, "info", true);
    try {
      const uploadedPaths: string[] = [];
      for (const originalFile of files) {
        const file = await prepareUploadFile(kind, originalFile);
        const formData = new FormData();
        formData.append("action", "upload_public_document");
        formData.append("token", effectiveToken);
        formData.append("document_type", kind);
        formData.append("file", file, file.name);
        const response = await fetch("/api/onboarding", { method: "POST", body: formData });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || `Unable to upload ${uploadLabels[kind]}.`);
        const path = String(result.path || "").trim();
        if (path) uploadedPaths.push(path);
      }

      setForm((current) => {
        if (kind === "profile_photo") return { ...current, profile_photo_url: uploadedPaths[uploadedPaths.length - 1] || current.profile_photo_url };
        if (kind === "w9") return { ...current, w9_document_url: uploadedPaths[uploadedPaths.length - 1] || current.w9_document_url };
        if (kind === "contract") return { ...current, contract_document_url: uploadedPaths[uploadedPaths.length - 1] || current.contract_document_url };
        return { ...current, work_photo_urls: [...current.work_photo_urls, ...uploadedPaths] };
      });
      setUploadMessage(kind, kind === "work_photo" ? `${uploadedPaths.length} work photo${uploadedPaths.length === 1 ? "" : "s"} uploaded securely.` : `${uploadLabels[kind]} uploaded securely.`, "success");
    } catch (error) {
      setUploadMessage(kind, error instanceof Error ? error.message : `Unable to upload ${uploadLabels[kind]}.`, "error");
    }
  }

  async function submit() {
    const effectiveToken = token || tokenFromParams;
    if (!effectiveToken) {
      setMessage({ kind: "error", text: "Missing onboarding token." });
      return;
    }

    if (useDigitalW9) {
      const missing = digitalW9MissingFields(form.digital_w9);
      if (missing.length) {
        setMessage({ kind: "error", text: `Please complete the in-app W-9 before submitting. Missing: ${missing.join(", ")}.` });
        return;
      }
    }

    if (requestType === "w9_only") {
      if (!useDigitalW9 && !form.w9_document_url && !form.w9_status_note.trim()) {
        setMessage({ kind: "error", text: "Please complete the in-app W-9, upload your signed W-9, or add a note before submitting." });
        return;
      }
    } else {
      if (!form.legal_name.trim()) {
        setMessage({ kind: "error", text: "Legal name is required." });
        return;
      }
      if (!form.phone.trim() && !form.email.trim()) {
        setMessage({ kind: "error", text: "Please enter at least a phone number or email." });
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", token: effectiveToken, request_type: requestType, w9_use_digital: useDigitalW9, ...form }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Unable to submit onboarding.");
      setMessage({ kind: "success", text: result.message || "Onboarding submitted." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Unable to submit onboarding." });
    } finally {
      setSaving(false);
    }
  }

  const uploadDisabled = saving || Object.values(uploadStatus).some((status) => status?.loading);

  if (requestType === "w9_only") {
    return (
      <main style={{ maxWidth: 820, margin: "32px auto", padding: "0 16px" }}>
        <section className="card">
          <h1 style={{ marginBottom: 6 }}>Emanuel Labor Services W-9 Request</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Complete your W-9 through this secure link. This page is only for ELS tax/1099 records and does not show the admin app.
          </p>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          {message ? <p className={message.kind === "error" ? "error" : "success"}>{message.text}</p> : null}
          {!tokenFromParams ? (
            <label className="field">
              <span>Onboarding token</span>
              <input value={token} onChange={(event) => setToken(event.target.value)} />
            </label>
          ) : null}

          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button className={useDigitalW9 ? "primary" : "ghost"} type="button" onClick={() => setUseDigitalW9(true)}>Fill and sign W-9 in app</button>
            <button className={!useDigitalW9 ? "primary" : "ghost"} type="button" onClick={() => setUseDigitalW9(false)}>Upload completed IRS PDF</button>
          </div>

          {useDigitalW9 ? <DigitalW9Form value={form.digital_w9} onChange={setDigitalW9} compact /> : (
            <div className="card compact" style={{ background: "#fbfcfd" }}>
              <h3 style={{ marginTop: 0 }}>Upload W-9 tax document only</h3>
              <p className="muted small">Open the official IRS PDF, complete it, sign/date it, save the file, then upload it here.</p>
              <OfficialW9HelpCard compact />
              <div className="grid" style={{ gap: 12, marginTop: 14 }}>
                <label className="field">
                  <span>Legal name on W-9 (optional)</span>
                  <input value={form.legal_name} onChange={(event) => setField("legal_name", event.target.value)} placeholder="Only add this if helpful for review" />
                </label>
                <label className="field">
                  <span>Signed W-9</span>
                  <input type="file" accept="application/pdf,image/*" disabled={uploadDisabled} onChange={(event) => { void uploadFiles("w9", event.target.files); event.target.value = ""; }} />
                  <span className={uploadStatus.w9?.kind === "error" ? "error" : uploadStatus.w9?.kind === "success" ? "success" : "muted small"}>{uploadStatus.w9?.text || (form.w9_document_url ? "W-9 saved privately for ELS review." : "PDF preferred. Image is accepted if clear and readable.")}</span>
                </label>
                <label className="field">
                  <span>W-9 note</span>
                  <input value={form.w9_status_note} onChange={(event) => setField("w9_status_note", event.target.value)} placeholder="Uploaded above / need help / already sent through Zoho..." />
                </label>
              </div>
            </div>
          )}

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button className="primary" type="button" disabled={saving || uploadDisabled} onClick={submit}>{saving ? "Submitting..." : "Submit W-9"}</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 940, margin: "32px auto", padding: "0 16px" }}>
      <section className="card">
        <h1 style={{ marginBottom: 6 }}>Emanuel Labor Services Onboarding</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Please complete this secure onboarding packet. Do not send SSN, EIN, or tax information by regular text or email.
        </p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        {message ? <p className={message.kind === "error" ? "error" : "success"}>{message.text}</p> : null}
        {!tokenFromParams ? (
          <label className="field">
            <span>Onboarding token</span>
            <input value={token} onChange={(event) => setToken(event.target.value)} />
          </label>
        ) : null}

        <div className="grid grid-2">
          <label className="field"><span>Legal name</span><input value={form.legal_name} onChange={(event) => setField("legal_name", event.target.value)} /></label>
          <label className="field"><span>Preferred name</span><input value={form.preferred_name} onChange={(event) => setField("preferred_name", event.target.value)} /></label>
          <label className="field"><span>Phone</span><input value={form.phone} onChange={(event) => setField("phone", event.target.value)} /></label>
          <label className="field"><span>Email</span><input value={form.email} onChange={(event) => setField("email", event.target.value)} /></label>
          <label className="field"><span>Mailing address</span><input value={form.address} onChange={(event) => setField("address", event.target.value)} /></label>
          <label className="field"><span>City / State</span><input value={form.city_state} onChange={(event) => setField("city_state", event.target.value)} placeholder="New Orleans, LA" /></label>
          <label className="field"><span>Emergency contact name</span><input value={form.emergency_contact_name} onChange={(event) => setField("emergency_contact_name", event.target.value)} /></label>
          <label className="field"><span>Emergency contact phone</span><input value={form.emergency_contact_phone} onChange={(event) => setField("emergency_contact_phone", event.target.value)} /></label>
        </div>

        <div className="grid" style={{ gap: 12, marginTop: 14 }}>
          <label className="field"><span>Positions you can work</span><textarea rows={3} value={form.positions} onChange={(event) => setField("positions", event.target.value)} placeholder="GAV, LED Stagehand, Audio Assist, Video Assist..." /></label>
          <label className="field"><span>Skills / experience</span><textarea rows={4} value={form.skills} onChange={(event) => setField("skills", event.target.value)} placeholder="Tell us what you are comfortable doing on show site." /></label>
          <label className="field"><span>Equipment / software experience</span><textarea rows={3} value={form.equipment_experience} onChange={(event) => setField("equipment_experience", event.target.value)} placeholder="Audio consoles, video switchers, LED processors, lighting consoles, camera systems..." /></label>
        </div>

        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <label className="field">
            <span>Travel availability</span>
            <select value={form.travel_availability} onChange={(event) => setField("travel_availability", event.target.value)}>
              <option value="">Choose one</option>
              <option value="local_only">Local only</option>
              <option value="nearby_drive">Nearby drive markets</option>
              <option value="regional_travel">Regional travel</option>
              <option value="nationwide_travel">Nationwide travel</option>
            </select>
          </label>
          <label className="field">
            <span>Hotel / flight willingness</span>
            <select value={form.hotel_flight_willing} onChange={(event) => setField("hotel_flight_willing", event.target.value)}>
              <option value="">Choose one</option>
              <option value="yes">Yes, willing</option>
              <option value="case_by_case">Case by case</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <div className="card compact" style={{ background: "#fbfcfd", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Photos and documents</h3>
          <p className="muted small">
            Profile photos are compressed to WebP around 800×800. Work photos are compressed to about 1600px. W-9 and contract records are saved privately.
          </p>

          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button className={useDigitalW9 ? "primary" : "ghost"} type="button" onClick={() => setUseDigitalW9(true)}>Fill and sign W-9 in app</button>
            <button className={!useDigitalW9 ? "primary" : "ghost"} type="button" onClick={() => setUseDigitalW9(false)}>Upload completed W-9 PDF</button>
          </div>

          {useDigitalW9 ? <DigitalW9Form value={form.digital_w9} onChange={setDigitalW9} compact /> : <OfficialW9HelpCard compact />}

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <label className="field">
              <span>Professional profile photo</span>
              <input type="file" accept="image/*" disabled={uploadDisabled} onChange={(event) => { void uploadFiles("profile_photo", event.target.files); event.target.value = ""; }} />
              <span className={uploadStatus.profile_photo?.kind === "error" ? "error" : uploadStatus.profile_photo?.kind === "success" ? "success" : "muted small"}>{uploadStatus.profile_photo?.text || (form.profile_photo_url ? "Profile photo saved privately." : "Recommended: clean professional headshot.")}</span>
            </label>
            <label className="field">
              <span>Photos of work you have done</span>
              <input type="file" accept="image/*" multiple disabled={uploadDisabled} onChange={(event) => { void uploadFiles("work_photo", event.target.files); event.target.value = ""; }} />
              <span className={uploadStatus.work_photo?.kind === "error" ? "error" : uploadStatus.work_photo?.kind === "success" ? "success" : "muted small"}>{uploadStatus.work_photo?.text || (form.work_photo_urls.length ? `${form.work_photo_urls.length} work photo${form.work_photo_urls.length === 1 ? "" : "s"} saved privately.` : "Optional: AV setups, LED walls, cable work, breakout rooms, etc.")}</span>
            </label>
            {!useDigitalW9 ? (
              <label className="field">
                <span>Signed W-9</span>
                <input type="file" accept="application/pdf,image/*" disabled={uploadDisabled} onChange={(event) => { void uploadFiles("w9", event.target.files); event.target.value = ""; }} />
                <span className={uploadStatus.w9?.kind === "error" ? "error" : uploadStatus.w9?.kind === "success" ? "success" : "muted small"}>{uploadStatus.w9?.text || (form.w9_document_url ? "W-9 saved privately for ELS review." : "PDF preferred. Image is accepted if clear and readable.")}</span>
              </label>
            ) : null}
            <label className="field">
              <span>Signed contractor agreement</span>
              <input type="file" accept="application/pdf,image/*" disabled={uploadDisabled} onChange={(event) => { void uploadFiles("contract", event.target.files); event.target.value = ""; }} />
              <span className={uploadStatus.contract?.kind === "error" ? "error" : uploadStatus.contract?.kind === "success" ? "success" : "muted small"}>{uploadStatus.contract?.text || (form.contract_document_url ? "Contract saved privately for ELS review." : "Upload a signed copy if you already have one.")}</span>
            </label>
          </div>

          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            <label className="field"><span>Profile photo note</span><input value={form.profile_photo_note} onChange={(event) => setField("profile_photo_note", event.target.value)} placeholder="I uploaded one / need one taken..." /></label>
            <label className="field"><span>Work photo note</span><input value={form.work_photo_note} onChange={(event) => setField("work_photo_note", event.target.value)} placeholder="I uploaded examples / not available..." /></label>
            <label className="field"><span>W-9 note</span><input value={form.w9_status_note} onChange={(event) => setField("w9_status_note", event.target.value)} placeholder="Completed in app / uploaded above / need help..." /></label>
            <label className="field checkboxField">
              <span>I understand ELS will provide/collect the contractor agreement and W-9 through the secure onboarding process.</span>
              <input type="checkbox" checked={form.contract_acknowledged} onChange={(event) => setField("contract_acknowledged", event.target.checked)} />
            </label>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="primary" type="button" disabled={saving || uploadDisabled} onClick={submit}>{saving ? "Submitting..." : "Submit onboarding"}</button>
        </div>
      </section>
    </main>
  );
}
