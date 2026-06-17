"use client";

import { use, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type PageProps = {
  params: Promise<{ token: string }>;
};

type UploadKind = "profile_photo" | "work_photo" | "w9" | "contract";
type RequestType = "full_onboarding" | "w9_only" | "contract_only";
type CityPoolOption = { id: string; name: string };

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
  line_3b_checked: boolean;
  tin_type: "ssn" | "ein";
  tin: string;
  signer_name: string;
  signature_data_url: string;
  certification_confirmed: boolean;
};

type ContractSignatureState = {
  contractor_name: string;
  effective_date: string;
  signature_data_url: string;
  certifications: boolean[];
  agreement_confirmed: boolean;
};

type FormState = {
  legal_name: string;
  preferred_name: string;
  phone: string;
  email: string;
  address: string;
  home_address_line1: string;
  home_city: string;
  home_state: string;
  home_zip: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  city_state: string;
  primary_city_pool_id: string;
  local_city_pool_ids: string[];
  other_local_cities: string;
  positions: string;
  years_experience: string;
  skills: string;
  equipment_experience: string;
  has_transportation: string;
  has_tools: string;
  rate_expectation: string;
  travel_availability: string;
  travel_markets: string;
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
  contract_signature: ContractSignatureState;
};

type UploadStatus = Partial<
  Record<
    UploadKind,
    { loading: boolean; text: string; kind: "success" | "error" | "info" }
  >
>;

const IRS_W9_FORM_URL = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";
const ELS_CONTRACT_PDF_URL = "/Emanuel_Labor_Services_Independent_Contractor_Agreement_Final.pdf";


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
    line_3b_checked: false,
    tin_type: "ssn",
    tin: "",
    signer_name: "",
    signature_data_url: "",
    certification_confirmed: false,
  };
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

const CONTRACT_CERTIFICATIONS = [
  "Contractor is an independent contractor and not an employee of the Company.",
  "Contractor maintains their own business and works with multiple companies.",
  "Contractor provides their own tools, equipment, and materials.",
  "Contractor determines how services are performed and is not under direct Company control.",
  "Contractor is responsible for their own insurance, taxes, and business expenses.",
  "Contractor acknowledges that they do not receive employee benefits from the Company.",
  "Contractor understands that failure to comply with client requirements may result in removal from a project.",
  "Contractor agrees to indemnify the Company against liabilities arising from their work.",
  "Contractor agrees to adhere to professional standards, including punctuality, attire, and conduct.",
];

function blankContractSignature(): ContractSignatureState {
  return {
    contractor_name: "",
    effective_date: todayIsoDate(),
    signature_data_url: "",
    certifications: CONTRACT_CERTIFICATIONS.map(() => false),
    agreement_confirmed: false,
  };
}

function OfficialW9HelpCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="card compact"
      style={{
        background: "#fffdf2",
        borderColor: "#f4c542",
        marginTop: compact ? 0 : 16,
      }}
    >
      <h3 style={{ marginTop: 0 }}>Official IRS Form W-9</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        You can complete the W-9 directly in this secure ELS page, or open the
        current official IRS PDF, fill/sign it, then upload the completed copy.
      </p>
      <div className="toolbar">
        <a
          className="ghost"
          href={IRS_W9_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open official IRS W-9 PDF
        </a>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>
        Do not text or email your SSN, EIN, or tax information. Use this secure
        page only.
      </p>
    </div>
  );
}

function normalizeRequestType(value: unknown): RequestType {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, "")
    .replace(/[ -]+/g, "_");
  if (
    [
      "w9",
      "w_9",
      "w9_only",
      "tax",
      "tax_only",
      "tax_docs",
      "tax_docs_only",
    ].includes(normalized)
  )
    return "w9_only";
  if (["contract", "contract_only", "agreement", "agreement_only"].includes(normalized))
    return "contract_only";
  return "full_onboarding";
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function payloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pathList(value: unknown) {
  return Array.isArray(value) ? value.map(textValue).filter(Boolean) : [];
}

function splitDraftList(value: unknown) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  return textValue(value).split(/\n|,|;/).map((item) => item.trim()).filter(Boolean);
}

function contractCertifications(value: unknown) {
  const raw = Array.isArray(value) ? value : [];
  return CONTRACT_CERTIFICATIONS.map((_, index) => Boolean(raw[index]));
}

function mergeSavedForm(current: FormState, payloadRaw: unknown, crewRaw: unknown): FormState {
  const payload = payloadObject(payloadRaw);
  const crew = payloadObject(crewRaw);
  const digital = payloadObject(payload.digital_w9);
  const contract = payloadObject(payload.contract_signature);
  const workPhotos = pathList(payload.work_photo_urls).length ? pathList(payload.work_photo_urls) : pathList(crew.work_photo_urls);
  return {
    ...current,
    legal_name: textValue(payload.legal_name) || textValue(crew.name) || current.legal_name,
    preferred_name: textValue(payload.preferred_name) || current.preferred_name,
    phone: textValue(payload.phone) || textValue(crew.phone) || current.phone,
    email: textValue(payload.email) || textValue(crew.email) || current.email,
    address: textValue(payload.address) || textValue(crew.address) || current.address,
    home_address_line1: textValue(payload.home_address_line1) || textValue(payload.address) || textValue(crew.address) || current.home_address_line1,
    home_city: textValue(payload.home_city) || current.home_city,
    home_state: textValue(payload.home_state) || current.home_state,
    home_zip: textValue(payload.home_zip) || current.home_zip,
    emergency_contact_name: textValue(payload.emergency_contact_name) || current.emergency_contact_name,
    emergency_contact_phone: textValue(payload.emergency_contact_phone) || current.emergency_contact_phone,
    city_state: textValue(payload.city_state) || current.city_state,
    primary_city_pool_id: textValue(payload.primary_city_pool_id) || textValue(crew.city_pool_id) || current.primary_city_pool_id,
    local_city_pool_ids: pathList(payload.local_city_pool_ids).length ? pathList(payload.local_city_pool_ids) : pathList(crew.additional_city_pool_ids).length ? pathList(crew.additional_city_pool_ids) : current.local_city_pool_ids,
    other_local_cities: textValue(payload.other_local_cities) || textValue(crew.other_city) || current.other_local_cities,
    positions: splitDraftList(payload.positions).join(", ") || current.positions,
    years_experience: textValue(payload.years_experience) || current.years_experience,
    skills: textValue(payload.skills) || current.skills,
    equipment_experience: textValue(payload.equipment_experience) || current.equipment_experience,
    has_transportation: textValue(payload.has_transportation) || current.has_transportation,
    has_tools: textValue(payload.has_tools) || current.has_tools,
    rate_expectation: textValue(payload.rate_expectation) || current.rate_expectation,
    travel_availability: textValue(payload.travel_availability) || current.travel_availability,
    travel_markets: textValue(payload.travel_markets) || current.travel_markets,
    hotel_flight_willing: textValue(payload.hotel_flight_willing) || current.hotel_flight_willing,
    profile_photo_note: textValue(payload.profile_photo_note) || current.profile_photo_note,
    work_photo_note: textValue(payload.work_photo_note) || current.work_photo_note,
    w9_status_note: textValue(payload.w9_status_note) || current.w9_status_note,
    contract_acknowledged: Boolean(payload.contract_acknowledged) || current.contract_acknowledged,
    profile_photo_url: textValue(payload.profile_photo_url) || textValue(crew.profile_photo_url) || current.profile_photo_url,
    work_photo_urls: workPhotos.length ? workPhotos : current.work_photo_urls,
    w9_document_url: textValue(payload.w9_document_url) || textValue(crew.w9_document_url) || current.w9_document_url,
    contract_document_url: textValue(payload.contract_document_url) || textValue(crew.contract_document_url) || current.contract_document_url,
    digital_w9: {
      ...current.digital_w9,
      tax_legal_name: textValue(digital.tax_legal_name) || current.digital_w9.tax_legal_name,
      business_name: textValue(digital.business_name) || current.digital_w9.business_name,
      federal_tax_classification: textValue(digital.federal_tax_classification) || current.digital_w9.federal_tax_classification,
      llc_tax_classification: textValue(digital.llc_tax_classification) || current.digital_w9.llc_tax_classification,
      other_classification: textValue(digital.other_classification) || current.digital_w9.other_classification,
      exempt_payee_code: textValue(digital.exempt_payee_code) || current.digital_w9.exempt_payee_code,
      fatca_code: textValue(digital.fatca_code) || current.digital_w9.fatca_code,
      tax_address_line_1: textValue(digital.tax_address_line_1) || current.digital_w9.tax_address_line_1,
      tax_city_state_zip: textValue(digital.tax_city_state_zip) || current.digital_w9.tax_city_state_zip,
      account_numbers: textValue(digital.account_numbers) || current.digital_w9.account_numbers,
      line_3b_checked: Boolean(digital.line_3b_checked) || current.digital_w9.line_3b_checked,
      tin_type: textValue(digital.tin_type) === "ein" ? "ein" : current.digital_w9.tin_type,
      signer_name: textValue(digital.signer_name) || current.digital_w9.signer_name,
      certification_confirmed: Boolean(digital.certification_confirmed) || current.digital_w9.certification_confirmed,
    },
    contract_signature: {
      ...current.contract_signature,
      contractor_name: textValue(contract.contractor_name) || textValue(payload.legal_name) || textValue(crew.name) || current.contract_signature.contractor_name,
      effective_date: textValue(contract.effective_date) || current.contract_signature.effective_date,
      certifications: Array.isArray(contract.certifications) ? contractCertifications(contract.certifications) : current.contract_signature.certifications,
      agreement_confirmed: Boolean(contract.agreement_confirmed) || current.contract_signature.agreement_confirmed,
    },
  };
}

function draftForStorage(form: FormState) {
  return {
    ...form,
    digital_w9: {
      ...form.digital_w9,
      tin: "",
      signature_data_url: "",
    },
  };
}

function fileBaseName(name: string) {
  return name.replace(/\.[^.]+$/, "") || "photo";
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Unable to compress image."));
      },
      type,
      quality,
    );
  });
}

async function compressImage(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality: number,
) {
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
    return new File([blob], `${fileBaseName(file.name)}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
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
  if (!w9.signature_data_url) missing.push("electronic signature");
  if (!w9.certification_confirmed) missing.push("certification checkbox");
  return missing;
}

function contractMissingFields(contract: ContractSignatureState) {
  const missing: string[] = [];
  if (!contract.contractor_name.trim()) missing.push("contractor legal name");
  if (!contract.effective_date.trim()) missing.push("contract effective date");
  if (!contract.signature_data_url) missing.push("contract signature");
  if (!contract.agreement_confirmed) missing.push("contract agreement checkbox");
  if (contract.certifications.some((checked) => !checked))
    missing.push("all Appendix A certification checkboxes");
  return missing;
}

function tinPlaceholder(type: "ssn" | "ein") {
  return type === "ein" ? "12-3456789" : "123-45-6789";
}

function formatTinForDisplay(value: string, type: "ssn" | "ein") {
  const digits = cleanDigits(value).slice(0, 9);
  if (type === "ein") {
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

const taxClassOptions: { value: string; label: string }[] = [
  { value: "individual", label: "Individual / sole proprietor" },
  { value: "c_corporation", label: "C Corporation" },
  { value: "s_corporation", label: "S Corporation" },
  { value: "partnership", label: "Partnership" },
  { value: "trust_estate", label: "Trust / estate" },
  { value: "llc", label: "Limited liability company" },
  { value: "other", label: "Other" },
];

function signatureFont(style: string) {
  if (style === "formal") return "Georgia, 'Times New Roman', serif";
  if (style === "simple") return "Arial, Helvetica, sans-serif";
  return "'Brush Script MT', 'Apple Chancery', 'Snell Roundhand', 'Segoe Script', 'Lucida Handwriting', cursive";
}

function generatedSignatureDataUrl(name: string, style: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1100;
  canvas.height = 280;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";

  const seed = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0);
  let baseSize = style === "simple" ? 64 : style === "formal" ? 78 : 118;
  const family = signatureFont(style);
  ctx.font = `${style === "script" ? "italic " : ""}${baseSize}px ${family}`;

  const targetWidth = 980;
  let measured = ctx.measureText(name).width;
  while (measured > targetWidth && baseSize > 58) {
    baseSize -= 4;
    ctx.font = `${style === "script" ? "italic " : ""}${baseSize}px ${family}`;
    measured = ctx.measureText(name).width;
  }

  const centerY = 136 + Math.sin(seed) * 3;
  const startX = Math.max(42, (canvas.width - measured) / 2 - 10);

  if (style === "script") {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillText(name, startX + 3, centerY + 4);
    ctx.restore();

    ctx.save();
    ctx.translate(startX, centerY);
    ctx.rotate((Math.sin(seed * 0.07) * 1.2 * Math.PI) / 180);
    ctx.globalAlpha = 0.96;
    ctx.fillText(name, 0, 0);
    ctx.restore();

    ctx.strokeStyle = "#111827";
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(startX + measured * 0.03, centerY + 44);
    ctx.bezierCurveTo(
      startX + measured * 0.28,
      centerY + 56 + Math.sin(seed) * 2,
      startX + measured * 0.68,
      centerY + 50 + Math.cos(seed) * 2,
      startX + measured * 0.98,
      centerY + 42,
    );
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    ctx.fillText(name, startX, centerY);
  }

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(50, 220);
  ctx.bezierCurveTo(300, 216, 590, 225, 1050, 220);
  ctx.stroke();
  return canvas.toDataURL("image/png");
}

function SignaturePad({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(Boolean(value));
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(rect.width || 720));
    const cssHeight = Math.max(220, Math.round(rect.height || 240));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const nextWidth = Math.round(cssWidth * dpr);
    const nextHeight = Math.round(cssHeight * dpr);

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    return { ctx, cssWidth, cssHeight };
  }, []);

  useEffect(() => {
    prepareCanvas();
    const resize = () => prepareCanvas();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [prepareCanvas]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }

  function saveCanvas() {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawnRef.current) return;
    onChange(canvas.toDataURL("image/png"));
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    const prepared = prepareCanvas();
    if (!prepared) return;
    const { ctx } = prepared;
    const next = point(event);
    drawingRef.current = true;
    hasDrawnRef.current = true;
    lastPointRef.current = next;
    event.currentTarget.setPointerCapture(event.pointerId);
    ctx.beginPath();
    ctx.moveTo(next.x, next.y);
    ctx.lineTo(next.x + 0.01, next.y + 0.01);
    ctx.stroke();
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    const prepared = prepareCanvas();
    if (!prepared) return;
    const { ctx } = prepared;
    const previous = lastPointRef.current;
    const next = point(event);
    if (!previous) {
      lastPointRef.current = next;
      return;
    }
    const midX = (previous.x + next.x) / 2;
    const midY = (previous.y + next.y) / 2;
    ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
    ctx.stroke();
    lastPointRef.current = next;
  }

  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignored */
    }
    saveCanvas();
  }

  function clear() {
    const canvas = canvasRef.current;
    const prepared = prepareCanvas();
    if (canvas && prepared) {
      prepared.ctx.clearRect(0, 0, prepared.cssWidth, prepared.cssHeight);
    }
    hasDrawnRef.current = false;
    lastPointRef.current = null;
    onChange("");
  }

  return (
    <div>
      <div className="notice" style={{ marginBottom: 10 }}>
        <strong>Phone signing tip:</strong> turn your phone sideways if needed and
        sign across the full box. The box will not scroll while signing.
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        style={{
          display: "block",
          width: "100%",
          maxWidth: 760,
          height: 240,
          border: "2px solid var(--line)",
          borderRadius: 14,
          background: "#fff",
          touchAction: "none",
          userSelect: "none",
        }}
        aria-label="Draw your signature"
      />
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button className="ghost" type="button" onClick={clear}>
          Clear drawn signature
        </button>
        {value ? (
          <span className="success small">Signature captured.</span>
        ) : (
          <span className="muted small">
            Draw slowly with your finger, stylus, mouse, or trackpad.
          </span>
        )}
      </div>
    </div>
  );
}

function SignatureSection({
  value,
  onChange,
  signerName,
}: {
  value: string;
  onChange: (value: string) => void;
  signerName: string;
}) {
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [style, setStyle] = useState("script");
  const nameForSignature = signerName.trim();

  function useTypedSignature() {
    if (!nameForSignature) return;
    onChange(generatedSignatureDataUrl(nameForSignature, style));
  }

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button
          className={mode === "typed" ? "primary" : "ghost"}
          type="button"
          onClick={() => setMode("typed")}
        >
          Type signature — recommended
        </button>
        <button
          className={mode === "drawn" ? "primary" : "ghost"}
          type="button"
          onClick={() => setMode("drawn")}
        >
          Draw instead
        </button>
      </div>

      {mode === "typed" ? (
        <div className="grid" style={{ gap: 10 }}>
          <label className="field">
            <span>Signature style</span>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value)}
            >
              <option value="script">ELS handwritten script</option>
              <option value="formal">Formal</option>
              <option value="simple">Simple</option>
            </select>
          </label>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 10,
              background: "#fff",
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                fontFamily: signatureFont(style),
                fontSize: 42,
                minHeight: 54,
                color: nameForSignature ? "#111827" : "#9ca3af",
              }}
            >
              {nameForSignature || "Enter signer name above"}
            </div>
            <div className="muted small">
              Generated from the signer name. This is the recommended mobile option. The signer must certify and submit it as their electronic signature.
            </div>
          </div>
          <button
            className="ghost"
            type="button"
            disabled={!nameForSignature}
            onClick={useTypedSignature}
          >
            Use this typed signature
          </button>
        </div>
      ) : (
        <SignaturePad value={value} onChange={onChange} />
      )}

      {value ? (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 10,
            background: "#fff",
            marginTop: 12,
            padding: 12,
          }}
        >
          <div className="muted small" style={{ marginBottom: 6 }}>
            Captured signature preview
          </div>
          <img
            alt="Captured electronic signature"
            src={value}
            style={{ display: "block", maxWidth: "100%", maxHeight: 120 }}
          />
        </div>
      ) : null}
    </div>
  );
}

function W9Line({
  number,
  label,
  children,
}: {
  number: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={{ borderTop: "1px solid #111827", padding: "8px 10px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <strong style={{ minWidth: 20 }}>{number}</strong>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: "#111827",
              marginBottom: 5,
            }}
          >
            {label}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}


function ContractAgreementSection({
  value,
  onChange,
  legalName,
}: {
  value: ContractSignatureState;
  onChange: (value: ContractSignatureState) => void;
  legalName: string;
}) {
  function setField<K extends keyof ContractSignatureState>(
    key: K,
    nextValue: ContractSignatureState[K],
  ) {
    onChange({ ...value, [key]: nextValue });
  }

  function setCertification(index: number, checked: boolean) {
    const next = value.certifications.map((item, itemIndex) =>
      itemIndex === index ? checked : item,
    );
    onChange({ ...value, certifications: next });
  }

  const contractorName = value.contractor_name || legalName;

  return (
    <div className="card compact" style={{ background: "#fbfcfd", marginTop: 14 }}>
      <div className="toolbar" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>
            Independent Contractor Agreement - required
          </h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Review and sign the Emanuel Labor Services Independent Contractor Agreement. The signed acceptance saves to your secure onboarding record.
          </p>
        </div>
        <a className="ghost" href={ELS_CONTRACT_PDF_URL} target="_blank" rel="noopener noreferrer">
          Open agreement PDF
        </a>
      </div>

      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 12,
          background: "white",
          maxHeight: 420,
          overflow: "auto",
          padding: 16,
          lineHeight: 1.45,
        }}
      >
        <h2 style={{ marginTop: 0 }}>INDEPENDENT CONTRACTOR AGREEMENT</h2>
        <p>
          This Independent Contractor Agreement ("Agreement") is made and entered into on the effective date signed below, by and between Emanuel Labor Services LLC, a Louisiana limited liability company (the "Company"), and the Contractor identified below.
        </p>
        <p>
          WHEREAS, the Company desires to contract with the Contractor for the performance of certain labor and staffing services; and WHEREAS, the Contractor represents that they operate an independent business, have complied with all federal, state, and local laws regarding business permits and licenses, and certify to the statements listed in Appendix A; NOW, THEREFORE, in consideration of the mutual promises contained herein, the Parties agree as follows:
        </p>
        <h4>1. Services to Be Performed</h4>
        <p>Contractor shall provide temporary labor or staffing services on a per-job basis. Contractor retains full control over how services are performed, subject to Company’s right to inspect work and ensure compliance with client requirements and industry standards.</p>
        <h4>2. Payment</h4>
        <p>Company shall compensate Contractor for all hours worked at agreed-upon rates. Contractor shall submit an invoice detailing services rendered. Payment shall be made within thirty (30) days of receipt of an approved invoice. If payments are scheduled beyond thirty days, Contractor shall be notified and must agree to payment terms before accepting the contract.</p>
        <h4>3. Term & Termination</h4>
        <p>This Agreement shall commence on the Effective Date and shall continue until terminated by either Party. Either Party may terminate this Agreement with five (5) days’ prior written notice, except in cases of immediate termination due to breach, safety violations, or conflicts of interest. This Agreement terminates immediately upon the death of the Contractor.</p>
        <h4>4. Instrumentalities/Tools/Supplies</h4>
        <p>Contractor shall provide their own tools, equipment, and materials unless otherwise agreed upon in writing. If the Company agrees in writing to reimburse certain expenses, Contractor must submit appropriate documentation with the invoice.</p>
        <h4>5. Compliance with Client Requirements</h4>
        <p>Contractor shall comply with any specific project requirements set forth by the Company’s clients, including but not limited to background checks, security clearances, drug testing, or other venue policies.</p>
        <h4>6. Conflicts of Interest and Immediate Notification</h4>
        <p>Contractor shall not engage in any activity that conflicts with the Company’s interests and must immediately disclose any potential conflicts, safety concerns, or security issues.</p>
        <h4>7. Independent Contractor Status & Insurance</h4>
        <p>Contractor is an independent contractor and not an employee of the Company. Contractor shall obtain and maintain all necessary workers’ compensation, general liability, and other required insurance at their own expense. Contractor must provide proof of insurance upon request.</p>
        <h4>8. Taxes & Benefits</h4>
        <p>Contractor is responsible for all federal, state, and local taxes, including but not limited to income tax, Social Security, Medicare, and unemployment taxes. Company shall not provide any employment benefits, including health insurance, retirement, or workers’ compensation.</p>
        <h4>9. Confidential Information</h4>
        <p>Contractor shall not disclose, use, or exploit the Company’s proprietary information, trade secrets, client lists, or operational methods. Any breach of confidentiality may result in legal action, including injunctive relief.</p>
        <h4>10. Work Quality and Professionalism</h4>
        <p>Contractor agrees to maintain a high standard of professionalism, including punctuality, appropriate attire, and respectful conduct toward clients and colleagues. Contractor must complete assignments professionally and in accordance with industry standards.</p>
        <h4>11. Dispute Resolution & Arbitration</h4>
        <p>Any disputes arising under this Agreement shall be resolved through binding arbitration in New Orleans, Louisiana, in accordance with the Federal Arbitration Act. No class-action or collective arbitration shall be permitted. The prevailing party shall be entitled to recover reasonable attorney’s fees and costs.</p>
        <h4>12. Indemnification</h4>
        <p>Contractor shall fully indemnify and hold harmless the Company, its agents, and employees from any claims, demands, liabilities, or damages arising from Contractor’s services, including but not limited to injury claims, contract breaches with clients or tax obligations. This indemnification applies even after termination of the Agreement and is not limited by insurance coverage.</p>
        <h4>13. Non-Solicitation</h4>
        <p>Contractor agrees that for a period of one (1) year after termination of this Agreement, they shall not solicit or work directly for the Company’s clients in a manner that bypasses the Company’s involvement.</p>
        <h4>14. Notices</h4>
        <p>All notices must be in writing and delivered personally, via certified mail, or by electronic means that provide proof of delivery.</p>
        <h4>15. Governing Law</h4>
        <p>This Agreement shall be governed by and construed in accordance with the laws of the State of Louisiana.</p>
        <h4>16. Entire Agreement & Severability</h4>
        <p>This Agreement represents the entire understanding between the Parties and supersedes any prior agreements. If any provision is found invalid, the remainder shall remain in full force and effect.</p>
        <h3>Appendix A: Certification of Independent Contractor Status</h3>
        <p>Each Appendix A certification must be checked before submitting onboarding.</p>
      </div>

      <div className="grid grid-2" style={{ marginTop: 14 }}>
        <label className="field">
          <span>Contractor legal name</span>
          <input
            value={value.contractor_name}
            onChange={(event) => setField("contractor_name", event.target.value)}
            placeholder={legalName || "Legal name"}
          />
        </label>
        <label className="field">
          <span>Effective date</span>
          <input
            type="date"
            value={value.effective_date}
            onChange={(event) => setField("effective_date", event.target.value)}
          />
        </label>
      </div>

      <div className="card compact" style={{ background: "#fff", marginTop: 12 }}>
        <h4 style={{ marginTop: 0 }}>Appendix A certifications</h4>
        <div className="grid" style={{ gap: 8 }}>
          {CONTRACT_CERTIFICATIONS.map((item, index) => (
            <label key={item} className="field checkboxField">
              <span>{item}</span>
              <input
                type="checkbox"
                checked={Boolean(value.certifications[index])}
                onChange={(event) => setCertification(index, event.target.checked)}
              />
            </label>
          ))}
        </div>
      </div>

      <label className="field checkboxField" style={{ marginTop: 12 }}>
        <span>
          I have reviewed the Independent Contractor Agreement, agree to be bound by its terms, and understand my electronic signature is my contractor signature for this Agreement.
        </span>
        <input
          type="checkbox"
          checked={value.agreement_confirmed}
          onChange={(event) => setField("agreement_confirmed", event.target.checked)}
        />
      </label>

      <SignatureSection
        value={value.signature_data_url}
        onChange={(nextValue) => setField("signature_data_url", nextValue)}
        signerName={contractorName}
      />

      <p className="muted small" style={{ marginBottom: 0 }}>
        Company representative signature/countersignature is handled internally by ELS after review.
      </p>
    </div>
  );
}

function DigitalW9Form({
  value,
  onChange,
  compact = false,
}: {
  value: DigitalW9State;
  onChange: (value: DigitalW9State) => void;
  compact?: boolean;
}) {
  function setField<K extends keyof DigitalW9State>(
    key: K,
    nextValue: DigitalW9State[K],
  ) {
    onChange({ ...value, [key]: nextValue });
  }

  const today = new Date().toLocaleDateString("en-US");
  const requester =
    "Emanuel Labor Services LLC, Storm Leigh, Storm@emanuel-labor-services.com, (504) 657-6618";

  return (
    <div
      className="card compact"
      style={{ background: "#f8fafc", marginTop: compact ? 0 : 16 }}
    >
      <div
        className="toolbar"
        style={{ justifyContent: "space-between", alignItems: "flex-start" }}
      >
        <div>
          <h3 style={{ marginTop: 0, marginBottom: 4 }}>
            ELS Substitute Form W-9
          </h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Fill this out like a DocuSign W-9. ELS saves the signed W-9 record
            and the structured tax fields for 1099 preparation.
          </p>
        </div>
        <a
          className="ghost"
          href={IRS_W9_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open IRS W-9 PDF
        </a>
      </div>

      <div
        style={{
          border: "2px solid #111827",
          borderRadius: 12,
          background: "#fff",
          overflow: "hidden",
          boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "150px 1fr 150px",
            borderBottom: "2px solid #111827",
            minHeight: 92,
          }}
        >
          <div style={{ borderRight: "1px solid #111827", padding: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700 }}>Form</div>
            <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
              W-9
            </div>
            <div style={{ fontSize: 10 }}>Rev. March 2024</div>
          </div>
          <div style={{ padding: "10px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>
              Request for Taxpayer Identification Number and Certification
            </div>
            <div style={{ fontSize: 12, marginTop: 5 }}>
              Substitute electronic Form W-9 for Emanuel Labor Services LLC
              records
            </div>
          </div>
          <div
            style={{
              borderLeft: "1px solid #111827",
              padding: 10,
              fontSize: 11,
            }}
          >
            <strong>Give form to requester.</strong>
            <br />
            Do not send to IRS.
            <br />
            <br />
            Requester: ELS
          </div>
        </div>

        <div
          style={{
            padding: "8px 10px",
            fontSize: 12,
            background: "#f9fafb",
            borderBottom: "1px solid #111827",
          }}
        >
          Requester&apos;s name and address: <strong>{requester}</strong>
        </div>

        <W9Line
          number="1"
          label="Name as shown on your income tax return. Name is required on this line; do not leave this line blank."
        >
          <input
            value={value.tax_legal_name}
            onChange={(event) => setField("tax_legal_name", event.target.value)}
            autoComplete="name"
            placeholder="Legal tax name"
          />
        </W9Line>

        <W9Line
          number="2"
          label="Business name / disregarded entity name, if different from above."
        >
          <input
            value={value.business_name}
            onChange={(event) => setField("business_name", event.target.value)}
            placeholder="Optional"
          />
        </W9Line>

        <W9Line
          number="3a"
          label="Federal tax classification. Check the appropriate box for the tax classification of the person whose name is entered on line 1."
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: 8,
            }}
          >
            {taxClassOptions.map((option) => (
              <label
                key={option.value}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 13,
                }}
              >
                <input
                  type="radio"
                  name="w9-tax-class"
                  checked={value.federal_tax_classification === option.value}
                  onChange={() =>
                    setField("federal_tax_classification", option.value)
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {value.federal_tax_classification === "llc" ? (
            <label className="field" style={{ marginTop: 10 }}>
              <span>LLC tax classification: C, S, or P</span>
              <input
                value={value.llc_tax_classification}
                onChange={(event) =>
                  setField(
                    "llc_tax_classification",
                    event.target.value.toUpperCase().slice(0, 1),
                  )
                }
                placeholder="C / S / P"
              />
            </label>
          ) : null}
          {value.federal_tax_classification === "other" ? (
            <label className="field" style={{ marginTop: 10 }}>
              <span>Other classification</span>
              <input
                value={value.other_classification}
                onChange={(event) =>
                  setField("other_classification", event.target.value)
                }
              />
            </label>
          ) : null}
        </W9Line>

        <W9Line
          number="3b"
          label="If on line 3a you checked Partnership, Trust/estate, or LLC taxed as Partnership and you are providing this form to a partnership, trust, or estate in which you have an ownership interest, check this box if you have any foreign partners, owners, or beneficiaries."
        >
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={value.line_3b_checked}
              onChange={(event) =>
                setField("line_3b_checked", event.target.checked)
              }
            />
            <span>Line 3b checked</span>
          </label>
        </W9Line>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            borderTop: "1px solid #111827",
          }}
        >
          <div style={{ borderRight: "1px solid #111827" }}>
            <W9Line number="4" label="Exemptions, if applicable.">
              <div className="grid grid-2">
                <label className="field">
                  <span>Exempt payee code</span>
                  <input
                    value={value.exempt_payee_code}
                    onChange={(event) =>
                      setField("exempt_payee_code", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span>FATCA exemption code</span>
                  <input
                    value={value.fatca_code}
                    onChange={(event) =>
                      setField("fatca_code", event.target.value)
                    }
                  />
                </label>
              </div>
            </W9Line>
            <W9Line
              number="5"
              label="Address: number, street, and apt. or suite no."
            >
              <input
                value={value.tax_address_line_1}
                onChange={(event) =>
                  setField("tax_address_line_1", event.target.value)
                }
                autoComplete="street-address"
                placeholder="Street address"
              />
            </W9Line>
            <W9Line number="6" label="City, state, and ZIP code.">
              <input
                value={value.tax_city_state_zip}
                onChange={(event) =>
                  setField("tax_city_state_zip", event.target.value)
                }
                placeholder="New Orleans, LA 70130"
              />
            </W9Line>
          </div>
          <div>
            <W9Line number="" label="Requester information">
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{requester}</div>
            </W9Line>
            <W9Line
              number="7"
              label="List account number(s) here, if applicable."
            >
              <input
                value={value.account_numbers}
                onChange={(event) =>
                  setField("account_numbers", event.target.value)
                }
                placeholder="Optional"
              />
            </W9Line>
          </div>
        </div>

        <div
          style={{
            borderTop: "2px solid #111827",
            background: "#111827",
            color: "#fff",
            padding: "7px 10px",
            fontWeight: 800,
          }}
        >
          Part I — Taxpayer Identification Number (TIN)
        </div>
        <div style={{ padding: 10 }}>
          <p style={{ fontSize: 12, marginTop: 0 }}>
            Enter your TIN in the appropriate box. For individuals, this is
            generally your SSN. For businesses, this is generally your EIN.
          </p>
          <div className="grid grid-2">
            <label className="field">
              <span>TIN type</span>
              <select
                value={value.tin_type}
                onChange={(event) => {
                  const nextType = event.target.value as "ssn" | "ein";
                  onChange({
                    ...value,
                    tin_type: nextType,
                    tin: formatTinForDisplay(value.tin, nextType),
                  });
                }}
              >
                <option value="ssn">Social security number</option>
                <option value="ein">Employer identification number</option>
              </select>
            </label>
            <label className="field">
              <span>
                {value.tin_type === "ein"
                  ? "Employer identification number"
                  : "Social security number"}
              </span>
              <input
                value={value.tin}
                onChange={(event) =>
                  setField("tin", formatTinForDisplay(event.target.value, value.tin_type))
                }
                placeholder={tinPlaceholder(value.tin_type)}
                inputMode="numeric"
                autoComplete="off"
              />
            </label>
          </div>
          <p className="muted small">
            ELS encrypts the full TIN before it is saved. Owner review screens
            only show the last 4 digits.
          </p>
        </div>

        <div
          style={{
            borderTop: "2px solid #111827",
            background: "#111827",
            color: "#fff",
            padding: "7px 10px",
            fontWeight: 800,
          }}
        >
          Part II — Certification
        </div>
        <div style={{ padding: 10 }}>
          <div
            style={{
              border: "2px solid #111827",
              borderRadius: 10,
              padding: 12,
              background: "#fffef2",
            }}
          >
            <p style={{ marginTop: 0, fontSize: 13 }}>
              <strong>Under penalties of perjury, I certify that:</strong>
            </p>
            <ol style={{ fontSize: 13, lineHeight: 1.45, paddingLeft: 22 }}>
              <li>
                The number shown on this form is my correct taxpayer
                identification number.
              </li>
              <li>
                I am not subject to backup withholding because I am exempt, I
                have not been notified by the IRS that I am subject to backup
                withholding, or the IRS has notified me that I am no longer
                subject to backup withholding.
              </li>
              <li>I am a U.S. citizen or other U.S. person.</li>
              <li>
                The FATCA code entered on this form, if any, indicating that I
                am exempt from FATCA reporting is correct.
              </li>
            </ol>
            <p style={{ fontSize: 12, fontWeight: 800, marginBottom: 0 }}>
              The IRS does not require your consent to any provision of this
              document other than the certifications required to avoid backup
              withholding.
            </p>
          </div>

          <label className="field checkboxField" style={{ marginTop: 12 }}>
            <span>
              I certify under penalties of perjury that the W-9 information
              above is accurate and that my electronic signature authenticates
              and verifies this submission.
            </span>
            <input
              type="checkbox"
              checked={value.certification_confirmed}
              onChange={(event) =>
                setField("certification_confirmed", event.target.checked)
              }
            />
          </label>

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Signature of U.S. person</span>
              <input
                value={value.signer_name}
                onChange={(event) =>
                  setField("signer_name", event.target.value)
                }
                placeholder="Type signer name exactly as signing"
              />
            </label>
            <label className="field">
              <span>Date</span>
              <input value={today} disabled readOnly />
            </label>
          </div>
          <SignatureSection
            value={value.signature_data_url}
            onChange={(nextValue) => setField("signature_data_url", nextValue)}
            signerName={value.signer_name || value.tax_legal_name}
          />
        </div>
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
    home_address_line1: "",
    home_city: "",
    home_state: "",
    home_zip: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    city_state: "",
    primary_city_pool_id: "",
    local_city_pool_ids: [],
    other_local_cities: "",
    positions: "",
    years_experience: "",
    skills: "",
    equipment_experience: "",
    has_transportation: "",
    has_tools: "",
    rate_expectation: "",
    travel_availability: "",
    travel_markets: "",
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
    contract_signature: blankContractSignature(),
  });
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({});
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [requestType, setRequestType] =
    useState<RequestType>("full_onboarding");
  const [useDigitalW9, setUseDigitalW9] = useState(false);
  const [cityPoolOptions, setCityPoolOptions] = useState<CityPoolOption[]>([]);
  const [positionOptions, setPositionOptions] = useState<string[]>([]);

  useEffect(() => {
    const effectiveToken = token || tokenFromParams;
    const mode =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("mode")
        : "";
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
        if (!response.ok)
          throw new Error(
            result.message || "Unable to read onboarding request.",
          );
        if (active && result.request_type) {
          const normalized = normalizeRequestType(result.request_type);
          setRequestType(normalized);
          if (normalized === "w9_only") setUseDigitalW9(true);
          const draftKey = `els-onboarding-draft-${effectiveToken}`;
          let storedDraft: unknown = null;
          try {
            storedDraft = JSON.parse(window.localStorage.getItem(draftKey) || "null");
          } catch {
            storedDraft = null;
          }
          setForm((current) => mergeSavedForm(mergeSavedForm(current, storedDraft, null), result.payload, result.crew));
          setCityPoolOptions(Array.isArray(result.city_pools) ? result.city_pools : []);
          setPositionOptions(Array.isArray(result.position_options) ? result.position_options.map(textValue).filter(Boolean) : []);
          if (result.correction_note) {
            setMessage({
              kind: "success",
              text: `ELS requested a correction: ${result.correction_note}`,
            });
          }
        }
      })
      .catch((error) => {
        if (active)
          setMessage({
            kind: "error",
            text:
              error instanceof Error
                ? error.message
                : "Unable to read onboarding request.",
          });
      });

    return () => {
      active = false;
    };
  }, [token, tokenFromParams]);

  useEffect(() => {
    const effectiveToken = token || tokenFromParams;
    if (!effectiveToken || typeof window === "undefined") return;
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          `els-onboarding-draft-${effectiveToken}`,
          JSON.stringify(draftForStorage(form)),
        );
      } catch {
        // Draft saving is best-effort only.
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [form, token, tokenFromParams]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleListField(key: "local_city_pool_ids", value: string, checked: boolean) {
    setForm((current) => {
      const existing = current[key];
      return {
        ...current,
        [key]: checked ? Array.from(new Set([...existing, value])) : existing.filter((item) => item !== value),
      };
    });
  }

  function togglePosition(role: string, checked: boolean) {
    setForm((current) => {
      const currentRoles = splitDraftList(current.positions);
      const next = checked ? Array.from(new Set([...currentRoles, role])) : currentRoles.filter((item) => item !== role);
      return { ...current, positions: next.join(", ") };
    });
  }

  function setDigitalW9(value: DigitalW9State) {
    setForm((current) => ({ ...current, digital_w9: value }));
  }

  function setContractSignature(value: ContractSignatureState) {
    setForm((current) => ({ ...current, contract_signature: value }));
  }

  function setUploadMessage(
    kind: UploadKind,
    text: string,
    messageKind: "success" | "error" | "info",
    loading = false,
  ) {
    setUploadStatus((current) => ({
      ...current,
      [kind]: { text, kind: messageKind, loading },
    }));
  }

  async function uploadFiles(kind: UploadKind, list: FileList | null) {
    const effectiveToken = token || tokenFromParams;
    const files = Array.from(list || []);
    if (!files.length) return;
    if (!effectiveToken) {
      setUploadMessage(kind, "Missing onboarding token.", "error");
      return;
    }

    setUploadMessage(
      kind,
      kind === "work_photo"
        ? `Uploading ${files.length} work photo${files.length === 1 ? "" : "s"}...`
        : `Uploading ${uploadLabels[kind]}...`,
      "info",
      true,
    );
    try {
      const uploadedPaths: string[] = [];
      for (const originalFile of files) {
        const file = await prepareUploadFile(kind, originalFile);
        const formData = new FormData();
        formData.append("action", "upload_public_document");
        formData.append("token", effectiveToken);
        formData.append("document_type", kind);
        formData.append("crew_name", form.legal_name || form.preferred_name);
        formData.append("primary_city_pool_id", form.primary_city_pool_id);
        formData.append("file", file, file.name);
        const response = await fetch("/api/onboarding", {
          method: "POST",
          body: formData,
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            result.message || `Unable to upload ${uploadLabels[kind]}.`,
          );
        const path = String(result.path || "").trim();
        if (path) uploadedPaths.push(path);
      }

      setForm((current) => {
        if (kind === "profile_photo")
          return {
            ...current,
            profile_photo_url:
              uploadedPaths[uploadedPaths.length - 1] ||
              current.profile_photo_url,
          };
        if (kind === "w9")
          return {
            ...current,
            w9_document_url:
              uploadedPaths[uploadedPaths.length - 1] ||
              current.w9_document_url,
          };
        if (kind === "contract")
          return {
            ...current,
            contract_document_url:
              uploadedPaths[uploadedPaths.length - 1] ||
              current.contract_document_url,
          };
        return {
          ...current,
          work_photo_urls: [...current.work_photo_urls, ...uploadedPaths],
        };
      });
      setUploadMessage(
        kind,
        kind === "work_photo"
          ? `${uploadedPaths.length} work photo${uploadedPaths.length === 1 ? "" : "s"} uploaded securely.`
          : `${uploadLabels[kind]} uploaded securely.`,
        "success",
      );
    } catch (error) {
      setUploadMessage(
        kind,
        error instanceof Error
          ? error.message
          : `Unable to upload ${uploadLabels[kind]}.`,
        "error",
      );
    }
  }

  async function submit() {
    const effectiveToken = token || tokenFromParams;
    if (!effectiveToken) {
      setMessage({ kind: "error", text: "Missing onboarding token." });
      return;
    }

    if (useDigitalW9 && requestType !== "contract_only") {
      const missing = digitalW9MissingFields(form.digital_w9);
      if (missing.length) {
        setMessage({
          kind: "error",
          text: `Please complete the in-app W-9 before submitting. Missing: ${missing.join(", ")}.`,
        });
        return;
      }
    }

    if (requestType === "contract_only") {
      if (!form.legal_name.trim() && !form.contract_signature.contractor_name.trim()) {
        setMessage({ kind: "error", text: "Legal name is required." });
        return;
      }
      const contractMissing = contractMissingFields({
        ...form.contract_signature,
        contractor_name:
          form.contract_signature.contractor_name || form.legal_name,
      });
      if (contractMissing.length && !form.contract_document_url) {
        setMessage({
          kind: "error",
          text: `Please sign the Independent Contractor Agreement before submitting. Missing: ${contractMissing.join(", ")}.`,
        });
        return;
      }
    } else if (requestType === "w9_only") {
      if (
        !useDigitalW9 &&
        !form.w9_document_url &&
        !form.w9_status_note.trim()
      ) {
        setMessage({
          kind: "error",
          text: "Please complete the in-app W-9, upload your signed W-9, or add a note before submitting.",
        });
        return;
      }
    } else {
      if (!form.legal_name.trim()) {
        setMessage({ kind: "error", text: "Legal name is required." });
        return;
      }
      if (!form.phone.trim() && !form.email.trim()) {
        setMessage({
          kind: "error",
          text: "Please enter at least a phone number or email.",
        });
        return;
      }
      if (!form.home_address_line1.trim() || !form.home_city.trim() || !form.home_state.trim() || !form.home_zip.trim()) {
        setMessage({ kind: "error", text: "Please complete your home address, city, state, and ZIP." });
        return;
      }
      if (!form.primary_city_pool_id) {
        setMessage({ kind: "error", text: "Please choose the main city where you can work locally." });
        return;
      }
      if (!splitDraftList(form.positions).length) {
        setMessage({ kind: "error", text: "Please select at least one position you can work." });
        return;
      }
      if (!form.profile_photo_url) {
        setMessage({
          kind: "error",
          text: "Please upload a professional profile photo before submitting onboarding.",
        });
        return;
      }
      if (!useDigitalW9 && !form.w9_document_url) {
        setMessage({
          kind: "error",
          text: "Please complete the in-app W-9 or upload a signed W-9 before submitting onboarding.",
        });
        return;
      }
      const contractMissing = contractMissingFields({
        ...form.contract_signature,
        contractor_name:
          form.contract_signature.contractor_name || form.legal_name,
      });
      if (contractMissing.length && !form.contract_document_url) {
        setMessage({
          kind: "error",
          text: `Please sign the Independent Contractor Agreement before submitting. Missing: ${contractMissing.join(", ")}.`,
        });
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          token: effectiveToken,
          request_type: requestType,
          w9_use_digital: useDigitalW9,
          ...form,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.message || "Unable to submit onboarding.");
      try {
        window.localStorage.removeItem(`els-onboarding-draft-${effectiveToken}`);
      } catch {
        // ignore
      }
      setMessage({
        kind: "success",
        text: result.message || "Onboarding submitted.",
      });
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to submit onboarding.",
      });
    } finally {
      setSaving(false);
    }
  }

  const uploadDisabled =
    saving || Object.values(uploadStatus).some((status) => status?.loading);

  if (requestType === "contract_only") {
    return (
      <main style={{ maxWidth: 860, margin: "32px auto", padding: "0 16px" }}>
        <section className="card">
          <h1 style={{ marginBottom: 6 }}>
            Emanuel Labor Services Contractor Agreement
          </h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Complete only the Independent Contractor Agreement through this secure link.
          </p>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          {message ? (
            <p className={message.kind === "error" ? "error" : "success"}>
              {message.text}
            </p>
          ) : null}
          <label className="field">
            <span>Legal name</span>
            <input
              value={form.legal_name}
              onChange={(event) => setField("legal_name", event.target.value)}
            />
          </label>
          <ContractAgreementSection
            value={{
              ...form.contract_signature,
              contractor_name:
                form.contract_signature.contractor_name || form.legal_name,
            }}
            onChange={setContractSignature}
            legalName={form.legal_name}
          />
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              className="primary"
              type="button"
              disabled={saving || uploadDisabled}
              onClick={submit}
            >
              {saving ? "Submitting..." : "Submit signed contract"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (requestType === "w9_only") {
    return (
      <main style={{ maxWidth: 820, margin: "32px auto", padding: "0 16px" }}>
        <section className="card">
          <h1 style={{ marginBottom: 6 }}>
            Emanuel Labor Services W-9 Request
          </h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Complete your W-9 through this secure link. This page is only for
            ELS tax/1099 records and does not show the admin app.
          </p>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          {message ? (
            <p className={message.kind === "error" ? "error" : "success"}>
              {message.text}
            </p>
          ) : null}
          {!tokenFromParams ? (
            <label className="field">
              <span>Onboarding token</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
          ) : null}

          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button
              className={useDigitalW9 ? "primary" : "ghost"}
              type="button"
              onClick={() => setUseDigitalW9(true)}
            >
              Fill and sign W-9 in app
            </button>
            <button
              className={!useDigitalW9 ? "primary" : "ghost"}
              type="button"
              onClick={() => setUseDigitalW9(false)}
            >
              Upload completed IRS PDF
            </button>
          </div>

          {useDigitalW9 ? (
            <DigitalW9Form
              value={form.digital_w9}
              onChange={setDigitalW9}
              compact
            />
          ) : (
            <div className="card compact" style={{ background: "#fbfcfd" }}>
              <h3 style={{ marginTop: 0 }}>Upload W-9 tax document only</h3>
              <p className="muted small">
                Open the official IRS PDF, complete it, sign/date it, save the
                file, then upload it here.
              </p>
              <OfficialW9HelpCard compact />
              <div className="grid" style={{ gap: 12, marginTop: 14 }}>
                <label className="field">
                  <span>Legal name on W-9 (optional)</span>
                  <input
                    value={form.legal_name}
                    onChange={(event) =>
                      setField("legal_name", event.target.value)
                    }
                    placeholder="Only add this if helpful for review"
                  />
                </label>
                <label className="field">
                  <span>Signed W-9</span>
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={uploadDisabled}
                    onChange={(event) => {
                      void uploadFiles("w9", event.target.files);
                      event.target.value = "";
                    }}
                  />
                  <span
                    className={
                      uploadStatus.w9?.kind === "error"
                        ? "error"
                        : uploadStatus.w9?.kind === "success"
                          ? "success"
                          : "muted small"
                    }
                  >
                    {uploadStatus.w9?.text ||
                      (form.w9_document_url
                        ? "W-9 saved privately for ELS review."
                        : "PDF preferred. Image is accepted if clear and readable.")}
                  </span>
                </label>
                <label className="field">
                  <span>W-9 note</span>
                  <input
                    value={form.w9_status_note}
                    onChange={(event) =>
                      setField("w9_status_note", event.target.value)
                    }
                    placeholder="Uploaded above / need help / already sent through Zoho..."
                  />
                </label>
              </div>
            </div>
          )}

          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              className="primary"
              type="button"
              disabled={saving || uploadDisabled}
              onClick={submit}
            >
              {saving ? "Submitting..." : "Submit W-9"}
            </button>
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
          Please complete this secure onboarding packet. Do not send SSN, EIN,
          or tax information by regular text or email.
        </p>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        {message ? (
          <p className={message.kind === "error" ? "error" : "success"}>
            {message.text}
          </p>
        ) : null}
        {!tokenFromParams ? (
          <label className="field">
            <span>Onboarding token</span>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
        ) : null}

        <div className="grid grid-2">
          <label className="field">
            <span>Legal name</span>
            <input value={form.legal_name} onChange={(event) => setField("legal_name", event.target.value)} />
          </label>
          <label className="field">
            <span>Preferred name</span>
            <input value={form.preferred_name} onChange={(event) => setField("preferred_name", event.target.value)} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={form.phone} onChange={(event) => setField("phone", event.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={form.email} onChange={(event) => setField("email", event.target.value)} />
          </label>
        </div>

        <div className="card compact" style={{ background: "#fbfcfd", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Home address</h3>
          <div className="grid grid-2">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Street address</span>
              <input value={form.home_address_line1} onChange={(event) => setField("home_address_line1", event.target.value)} />
            </label>
            <label className="field">
              <span>City</span>
              <input value={form.home_city} onChange={(event) => setField("home_city", event.target.value)} />
            </label>
            <label className="field">
              <span>State</span>
              <input value={form.home_state} maxLength={2} onChange={(event) => setField("home_state", event.target.value.toUpperCase())} placeholder="LA" />
            </label>
            <label className="field">
              <span>ZIP code</span>
              <input value={form.home_zip} inputMode="numeric" onChange={(event) => setField("home_zip", event.target.value)} />
            </label>
          </div>
        </div>

        <div className="card compact" style={{ background: "#fbfcfd", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Local work cities</h3>
          <label className="field">
            <span>Main city where you can work as a local</span>
            <select value={form.primary_city_pool_id} onChange={(event) => setField("primary_city_pool_id", event.target.value)}>
              <option value="">Choose your main city</option>
              {cityPoolOptions.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}
            </select>
          </label>
          <div className="grid grid-3" style={{ marginTop: 10 }}>
            {cityPoolOptions.filter((pool) => pool.id !== form.primary_city_pool_id).map((pool) => (
              <label key={pool.id} className="field checkboxField">
                <span>{pool.name}</span>
                <input type="checkbox" checked={form.local_city_pool_ids.includes(pool.id)} onChange={(event) => toggleListField("local_city_pool_ids", pool.id, event.target.checked)} />
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Other cities where you can work locally</span>
            <input value={form.other_local_cities} onChange={(event) => setField("other_local_cities", event.target.value)} placeholder="City, State; City, State" />
          </label>
        </div>

        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <label className="field">
            <span>Emergency contact name (optional)</span>
            <input value={form.emergency_contact_name} onChange={(event) => setField("emergency_contact_name", event.target.value)} />
          </label>
          <label className="field">
            <span>Emergency contact phone (optional)</span>
            <input value={form.emergency_contact_phone} onChange={(event) => setField("emergency_contact_phone", event.target.value)} />
          </label>
        </div>

        <div className="card compact" style={{ background: "#fbfcfd", marginTop: 14 }}>
          <h3 style={{ marginTop: 0 }}>Positions and experience</h3>
          <p className="muted small">Select every position you can confidently perform on show site.</p>
          <div className="grid grid-3">
            {positionOptions.map((role) => (
              <label key={role} className="field checkboxField">
                <span>{role}</span>
                <input type="checkbox" checked={splitDraftList(form.positions).includes(role)} onChange={(event) => togglePosition(role, event.target.checked)} />
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 10 }}>
            <span>Other positions</span>
            <input value={form.positions} onChange={(event) => setField("positions", event.target.value)} placeholder="You may also type or edit the full position list" />
          </label>
          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <label className="field">
              <span>Years of live-event / AV experience</span>
              <input value={form.years_experience} inputMode="decimal" onChange={(event) => setField("years_experience", event.target.value)} />
            </label>
            <label className="field">
              <span>Rate expectation (optional)</span>
              <input value={form.rate_expectation} onChange={(event) => setField("rate_expectation", event.target.value)} placeholder="$ / hour or day rate" />
            </label>
          </div>
          <label className="field">
            <span>Skills / experience</span>
            <textarea rows={4} value={form.skills} onChange={(event) => setField("skills", event.target.value)} placeholder="Tell us what you are comfortable doing on show site." />
          </label>
          <label className="field">
            <span>Equipment / software experience</span>
            <textarea rows={3} value={form.equipment_experience} onChange={(event) => setField("equipment_experience", event.target.value)} placeholder="Audio consoles, video switchers, LED processors, lighting consoles, camera systems..." />
          </label>
        </div>

        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <label className="field">
            <span>Reliable transportation</span>
            <select value={form.has_transportation} onChange={(event) => setField("has_transportation", event.target.value)}>
              <option value="">Choose one</option><option value="yes">Yes</option><option value="sometimes">Sometimes / case by case</option><option value="no">No</option>
            </select>
          </label>
          <label className="field">
            <span>Own basic work tools</span>
            <select value={form.has_tools} onChange={(event) => setField("has_tools", event.target.value)}>
              <option value="">Choose one</option><option value="yes">Yes</option><option value="some">Some tools</option><option value="no">No</option>
            </select>
          </label>
          <label className="field">
            <span>Travel availability</span>
            <select value={form.travel_availability} onChange={(event) => setField("travel_availability", event.target.value)}>
              <option value="">Choose one</option><option value="local_only">Local only</option><option value="nearby_drive">Nearby drive markets</option><option value="regional_travel">Regional travel</option><option value="nationwide_travel">Nationwide travel</option>
            </select>
          </label>
          <label className="field">
            <span>Hotel / flight willingness</span>
            <select value={form.hotel_flight_willing} onChange={(event) => setField("hotel_flight_willing", event.target.value)}>
              <option value="">Choose one</option><option value="yes">Yes, willing</option><option value="case_by_case">Case by case</option><option value="no">No</option>
            </select>
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Travel markets / states you are willing to work</span>
            <input value={form.travel_markets} onChange={(event) => setField("travel_markets", event.target.value)} placeholder="Texas, Southeast, nationwide..." />
          </label>
        </div>

        <div
          className="card compact"
          style={{ background: "#fbfcfd", marginTop: 14 }}
        >
          <h3 style={{ marginTop: 0 }}>Required photo and documents</h3>
          <p className="muted small">
            Profile photos are compressed to WebP around 800×800. W-9 and
            contract PDF records are saved privately and can be archived to
            secure Google Drive storage when connected.
          </p>

          <div className="toolbar" style={{ marginBottom: 14 }}>
            <button
              className={useDigitalW9 ? "primary" : "ghost"}
              type="button"
              onClick={() => setUseDigitalW9(true)}
            >
              Fill and sign W-9 in app
            </button>
            <button
              className={!useDigitalW9 ? "primary" : "ghost"}
              type="button"
              onClick={() => setUseDigitalW9(false)}
            >
              Upload completed W-9 PDF
            </button>
          </div>

          {useDigitalW9 ? (
            <DigitalW9Form
              value={form.digital_w9}
              onChange={setDigitalW9}
              compact
            />
          ) : (
            <OfficialW9HelpCard compact />
          )}

          <div className="grid grid-2" style={{ marginTop: 14 }}>
            <label className="field">
              <span>Professional profile photo</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploadDisabled}
                onChange={(event) => {
                  void uploadFiles("profile_photo", event.target.files);
                  event.target.value = "";
                }}
              />
              <span
                className={
                  uploadStatus.profile_photo?.kind === "error"
                    ? "error"
                    : uploadStatus.profile_photo?.kind === "success"
                      ? "success"
                      : "muted small"
                }
              >
                {uploadStatus.profile_photo?.text ||
                  (form.profile_photo_url
                    ? "Profile photo saved privately."
                    : "Recommended: clean professional headshot.")}
              </span>
            </label>
            {!useDigitalW9 ? (
              <label className="field">
                <span>Signed W-9</span>
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  disabled={uploadDisabled}
                  onChange={(event) => {
                    void uploadFiles("w9", event.target.files);
                    event.target.value = "";
                  }}
                />
                <span
                  className={
                    uploadStatus.w9?.kind === "error"
                      ? "error"
                      : uploadStatus.w9?.kind === "success"
                        ? "success"
                        : "muted small"
                  }
                >
                  {uploadStatus.w9?.text ||
                    (form.w9_document_url
                      ? "W-9 saved privately for ELS review."
                      : "PDF preferred. Image is accepted if clear and readable.")}
                </span>
              </label>
            ) : null}
            <label className="field">
              <span>Signed contractor agreement upload backup</span>
              <input
                type="file"
                accept="application/pdf,image/*"
                disabled={uploadDisabled}
                onChange={(event) => {
                  void uploadFiles("contract", event.target.files);
                  event.target.value = "";
                }}
              />
              <span
                className={
                  uploadStatus.contract?.kind === "error"
                    ? "error"
                    : uploadStatus.contract?.kind === "success"
                      ? "success"
                      : "muted small"
                }
              >
                {uploadStatus.contract?.text ||
                  (form.contract_document_url
                    ? "Uploaded contract saved privately for ELS review."
                    : "Optional backup only. You can sign the agreement below instead.")}
              </span>
            </label>
          </div>

          <ContractAgreementSection
            value={{
              ...form.contract_signature,
              contractor_name:
                form.contract_signature.contractor_name || form.legal_name,
            }}
            onChange={setContractSignature}
            legalName={form.legal_name}
          />

          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            <label className="field">
              <span>Profile photo note</span>
              <input
                value={form.profile_photo_note}
                onChange={(event) =>
                  setField("profile_photo_note", event.target.value)
                }
                placeholder="I uploaded one / need one taken..."
              />
            </label>
            <label className="field">
              <span>W-9 note</span>
              <input
                value={form.w9_status_note}
                onChange={(event) =>
                  setField("w9_status_note", event.target.value)
                }
                placeholder="Completed in app / uploaded above / need help..."
              />
            </label>
            <label className="field checkboxField">
              <span>
                I understand this onboarding packet requires my profile photo, W-9, and signed Independent Contractor Agreement before ELS can mark me ready.
              </span>
              <input
                type="checkbox"
                checked={form.contract_acknowledged}
                onChange={(event) =>
                  setField("contract_acknowledged", event.target.checked)
                }
              />
            </label>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <button
            className="primary"
            type="button"
            disabled={saving || uploadDisabled}
            onClick={submit}
          >
            {saving ? "Submitting..." : "Submit onboarding"}
          </button>
        </div>
      </section>
    </main>
  );
}
