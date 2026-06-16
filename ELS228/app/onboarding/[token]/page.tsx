"use client";

import { use, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

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
  return "full_onboarding";
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
  return "Brush Script MT, Segoe Script, cursive";
}

function generatedSignatureDataUrl(name: string, style: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";

  const seed = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0);
  const baseSize = style === "simple" ? 58 : 74;
  const letters = name.split("");
  const estimatedWidth = Math.min(780, Math.max(420, letters.length * baseSize * 0.46));
  let x = 52;
  const centerY = 108;
  const scale = estimatedWidth / Math.max(1, letters.length * baseSize * 0.48);
  ctx.font = `${baseSize}px ${signatureFont(style)}`;

  letters.forEach((letter, index) => {
    const wobble = Math.sin(seed + index * 1.77);
    const lift = Math.cos(seed * 0.5 + index * 1.31) * 3.5;
    const rotate = (Math.sin(seed * 0.1 + index) * 2.2 * Math.PI) / 180;
    ctx.save();
    ctx.translate(x, centerY + lift);
    ctx.rotate(rotate);
    ctx.globalAlpha = 0.93 + Math.abs(wobble) * 0.07;
    ctx.fillText(letter, 0, 0);
    ctx.restore();
    const width = ctx.measureText(letter === " " ? "m" : letter).width;
    x += Math.max(12, width * scale * (letter === " " ? 0.72 : 0.84 + wobble * 0.025));
  });

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(36, 178);
  ctx.bezierCurveTo(240, 176, 420, 181, 864, 178);
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
              <option value="script">Script</option>
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

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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

    if (useDigitalW9) {
      const missing = digitalW9MissingFields(form.digital_w9);
      if (missing.length) {
        setMessage({
          kind: "error",
          text: `Please complete the in-app W-9 before submitting. Missing: ${missing.join(", ")}.`,
        });
        return;
      }
    }

    if (requestType === "w9_only") {
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
            <input
              value={form.legal_name}
              onChange={(event) => setField("legal_name", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Preferred name</span>
            <input
              value={form.preferred_name}
              onChange={(event) =>
                setField("preferred_name", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              value={form.phone}
              onChange={(event) => setField("phone", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
            />
          </label>
          <label className="field">
            <span>Mailing address</span>
            <input
              value={form.address}
              onChange={(event) => setField("address", event.target.value)}
            />
          </label>
          <label className="field">
            <span>City / State</span>
            <input
              value={form.city_state}
              onChange={(event) => setField("city_state", event.target.value)}
              placeholder="New Orleans, LA"
            />
          </label>
          <label className="field">
            <span>Emergency contact name</span>
            <input
              value={form.emergency_contact_name}
              onChange={(event) =>
                setField("emergency_contact_name", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Emergency contact phone</span>
            <input
              value={form.emergency_contact_phone}
              onChange={(event) =>
                setField("emergency_contact_phone", event.target.value)
              }
            />
          </label>
        </div>

        <div className="grid" style={{ gap: 12, marginTop: 14 }}>
          <label className="field">
            <span>Positions you can work</span>
            <textarea
              rows={3}
              value={form.positions}
              onChange={(event) => setField("positions", event.target.value)}
              placeholder="GAV, LED Stagehand, Audio Assist, Video Assist..."
            />
          </label>
          <label className="field">
            <span>Skills / experience</span>
            <textarea
              rows={4}
              value={form.skills}
              onChange={(event) => setField("skills", event.target.value)}
              placeholder="Tell us what you are comfortable doing on show site."
            />
          </label>
          <label className="field">
            <span>Equipment / software experience</span>
            <textarea
              rows={3}
              value={form.equipment_experience}
              onChange={(event) =>
                setField("equipment_experience", event.target.value)
              }
              placeholder="Audio consoles, video switchers, LED processors, lighting consoles, camera systems..."
            />
          </label>
        </div>

        <div className="grid grid-2" style={{ marginTop: 14 }}>
          <label className="field">
            <span>Travel availability</span>
            <select
              value={form.travel_availability}
              onChange={(event) =>
                setField("travel_availability", event.target.value)
              }
            >
              <option value="">Choose one</option>
              <option value="local_only">Local only</option>
              <option value="nearby_drive">Nearby drive markets</option>
              <option value="regional_travel">Regional travel</option>
              <option value="nationwide_travel">Nationwide travel</option>
            </select>
          </label>
          <label className="field">
            <span>Hotel / flight willingness</span>
            <select
              value={form.hotel_flight_willing}
              onChange={(event) =>
                setField("hotel_flight_willing", event.target.value)
              }
            >
              <option value="">Choose one</option>
              <option value="yes">Yes, willing</option>
              <option value="case_by_case">Case by case</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>

        <div
          className="card compact"
          style={{ background: "#fbfcfd", marginTop: 14 }}
        >
          <h3 style={{ marginTop: 0 }}>Photos and documents</h3>
          <p className="muted small">
            Profile photos are compressed to WebP around 800×800. Work photos
            are compressed to about 1600px. W-9 and contract records are saved
            privately.
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
            <label className="field">
              <span>Photos of work you have done</span>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={uploadDisabled}
                onChange={(event) => {
                  void uploadFiles("work_photo", event.target.files);
                  event.target.value = "";
                }}
              />
              <span
                className={
                  uploadStatus.work_photo?.kind === "error"
                    ? "error"
                    : uploadStatus.work_photo?.kind === "success"
                      ? "success"
                      : "muted small"
                }
              >
                {uploadStatus.work_photo?.text ||
                  (form.work_photo_urls.length
                    ? `${form.work_photo_urls.length} work photo${form.work_photo_urls.length === 1 ? "" : "s"} saved privately.`
                    : "Optional: AV setups, LED walls, cable work, breakout rooms, etc.")}
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
              <span>Work photo note</span>
              <input
                value={form.work_photo_note}
                onChange={(event) =>
                  setField("work_photo_note", event.target.value)
                }
                placeholder="I uploaded examples / not available..."
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
