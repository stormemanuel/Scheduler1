"use client";

import { use, useState } from "react";

type PageProps = {
  params: Promise<{ token: string }>;
};

type UploadKind = "profile_photo" | "work_photo" | "w9" | "contract";

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
};

type UploadStatus = Partial<Record<UploadKind, { loading: boolean; text: string; kind: "success" | "error" | "info" }>>;

const uploadLabels: Record<UploadKind, string> = {
  profile_photo: "Profile photo",
  work_photo: "Work photo",
  w9: "W-9 document",
  contract: "Contract document",
};

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
  });
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({});
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
    if (!form.legal_name.trim()) {
      setMessage({ kind: "error", text: "Legal name is required." });
      return;
    }
    if (!form.phone.trim() && !form.email.trim()) {
      setMessage({ kind: "error", text: "Please enter at least a phone number or email." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", token: effectiveToken, ...form }),
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

  return (
    <main style={{ maxWidth: 900, margin: "32px auto", padding: "0 16px" }}>
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
            Profile photos are compressed to WebP around 800×800. Work photos are compressed to about 1600px. W-9 and contract uploads are saved privately and kept readable.
          </p>

          <div className="grid grid-2">
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
            <label className="field">
              <span>Signed W-9</span>
              <input type="file" accept="application/pdf,image/*" disabled={uploadDisabled} onChange={(event) => { void uploadFiles("w9", event.target.files); event.target.value = ""; }} />
              <span className={uploadStatus.w9?.kind === "error" ? "error" : uploadStatus.w9?.kind === "success" ? "success" : "muted small"}>{uploadStatus.w9?.text || (form.w9_document_url ? "W-9 saved privately for ELS review." : "PDF preferred. Image is accepted if clear and readable.")}</span>
            </label>
            <label className="field">
              <span>Signed contractor agreement</span>
              <input type="file" accept="application/pdf,image/*" disabled={uploadDisabled} onChange={(event) => { void uploadFiles("contract", event.target.files); event.target.value = ""; }} />
              <span className={uploadStatus.contract?.kind === "error" ? "error" : uploadStatus.contract?.kind === "success" ? "success" : "muted small"}>{uploadStatus.contract?.text || (form.contract_document_url ? "Contract saved privately for ELS review." : "Upload a signed copy if you already have one.")}</span>
            </label>
          </div>

          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            <label className="field"><span>Profile photo note</span><input value={form.profile_photo_note} onChange={(event) => setField("profile_photo_note", event.target.value)} placeholder="I uploaded one / need one taken..." /></label>
            <label className="field"><span>Work photo note</span><input value={form.work_photo_note} onChange={(event) => setField("work_photo_note", event.target.value)} placeholder="I uploaded examples / not available..." /></label>
            <label className="field"><span>W-9 note</span><input value={form.w9_status_note} onChange={(event) => setField("w9_status_note", event.target.value)} placeholder="Already signed / need new W-9 / uploaded above..." /></label>
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
