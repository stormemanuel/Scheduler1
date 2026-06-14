"use client";

import { use, useState } from "react";

type PageProps = {
  params: Promise<{ token: string }>;
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
};

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
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
          <h3 style={{ marginTop: 0 }}>Photo / document notes</h3>
          <p className="muted small">Upload buttons are coming in the next build. For now, note whether you have a professional photo, work photos, signed W-9, or signed agreement ready.</p>
          <label className="field"><span>Profile photo note</span><input value={form.profile_photo_note} onChange={(event) => setField("profile_photo_note", event.target.value)} placeholder="I have one ready / need one taken..." /></label>
          <label className="field"><span>Work photo note</span><input value={form.work_photo_note} onChange={(event) => setField("work_photo_note", event.target.value)} placeholder="I have work photos / not available..." /></label>
          <label className="field"><span>W-9 note</span><input value={form.w9_status_note} onChange={(event) => setField("w9_status_note", event.target.value)} placeholder="Already signed / need new W-9 / will upload later..." /></label>
          <label className="field checkboxField">
            <span>I understand ELS will provide/collect the contractor agreement and W-9 through the secure onboarding process.</span>
            <input type="checkbox" checked={form.contract_acknowledged} onChange={(event) => setField("contract_acknowledged", event.target.checked)} />
          </label>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="primary" type="button" disabled={saving} onClick={submit}>{saving ? "Submitting..." : "Submit onboarding"}</button>
        </div>
      </section>
    </main>
  );
}
