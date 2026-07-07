"use client";

import { use, useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type PageProps = {
  params: Promise<{ token: string }>;
};

type UploadKind = "profile_photo" | "work_photo" | "w9" | "contract";
type RequestType = "full_onboarding" | "w9_only" | "contract_only" | "profile_photo_only";
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
  tin_last4: string;
  tin_retained: boolean;
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

type ProfileCropState = {
  file: File;
  previewUrl: string;
  imageWidth: number;
  imageHeight: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

const PROFILE_CROP_PREVIEW_SIZE = 240;
const PROFILE_CROP_OUTPUT_SIZE = 800;

const IRS_W9_FORM_URL = "https://www.irs.gov/pub/irs-pdf/fw9.pdf";
const ELS_CONTRACT_PDF_URL = "/Emanuel_Labor_Services_Independent_Contractor_Agreement_Final.pdf";
const RETAINED_W9_SIGNATURE = "els-retained-w9-signature";
const RETAINED_CONTRACT_SIGNATURE = "els-retained-contract-signature";

function isRetainedSignature(value: string) {
  return value === RETAINED_W9_SIGNATURE || value === RETAINED_CONTRACT_SIGNATURE;
}

function isSignatureImage(value: string) {
  return /^data:image\/(?:jpeg|jpg);base64,/i.test(value);
}

function hasSignatureValue(value: string) {
  return isRetainedSignature(value) || isSignatureImage(value);
}

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
    tin_last4: "",
    tin_retained: false,
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
  if (["profile_photo", "profile_photo_only", "photo", "photo_only", "picture", "picture_only"].includes(normalized))
    return "profile_photo_only";
  return "full_onboarding";
}

function textValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeCityText(value: unknown) {
  return textValue(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cityPoolLocationParts(poolName: string) {
  const raw = textValue(poolName);
  const commaParts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    return {
      city: commaParts[0],
      state: commaParts[1].split(/\s+/)[0] || "",
    };
  }

  const words = raw.split(/\s+/).filter(Boolean);
  const finalWord = words[words.length - 1] || "";
  if (/^[A-Za-z]{2}$/.test(finalWord) && words.length > 1) {
    return {
      city: words.slice(0, -1).join(" "),
      state: finalWord,
    };
  }

  return { city: raw, state: "" };
}

function matchingCityPool(
  options: CityPoolOption[],
  homeCity: string,
  homeState: string,
) {
  const normalizedCity = normalizeCityText(homeCity);
  const normalizedState = normalizeCityText(homeState);
  if (!normalizedCity) return null;

  const cityMatches = options.filter((pool) => {
    const location = cityPoolLocationParts(pool.name);
    return normalizeCityText(location.city) === normalizedCity;
  });
  if (!cityMatches.length) return null;

  if (normalizedState) {
    const stateMatch = cityMatches.find((pool) => {
      const location = cityPoolLocationParts(pool.name);
      return normalizeCityText(location.state) === normalizedState;
    });
    if (stateMatch) return stateMatch;

    const poolsWithoutState = cityMatches.filter(
      (pool) => !normalizeCityText(cityPoolLocationParts(pool.name).state),
    );
    if (poolsWithoutState.length === 1) return poolsWithoutState[0];
    return null;
  }

  return cityMatches.length === 1 ? cityMatches[0] : null;
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
      tin_last4: textValue(digital.tin_last4) || current.digital_w9.tin_last4,
      tin_retained: Boolean(textValue(digital.tin_last4)) || current.digital_w9.tin_retained,
      signer_name: textValue(digital.signer_name) || current.digital_w9.signer_name,
      signature_data_url:
        textValue(digital.signature_data_url) ||
        (Boolean(digital.signature_captured)
          ? RETAINED_W9_SIGNATURE
          : current.digital_w9.signature_data_url),
      certification_confirmed: Boolean(digital.certification_confirmed) || current.digital_w9.certification_confirmed,
    },
    contract_signature: {
      ...current.contract_signature,
      contractor_name: textValue(contract.contractor_name) || textValue(payload.legal_name) || textValue(crew.name) || current.contract_signature.contractor_name,
      effective_date: textValue(contract.effective_date) || current.contract_signature.effective_date,
      certifications: Array.isArray(contract.certifications) ? contractCertifications(contract.certifications) : current.contract_signature.certifications,
      agreement_confirmed: Boolean(contract.agreement_confirmed) || current.contract_signature.agreement_confirmed,
      signature_data_url:
        textValue(contract.signature_data_url) ||
        (Boolean(contract.signature_captured)
          ? RETAINED_CONTRACT_SIGNATURE
          : current.contract_signature.signature_data_url),
    },
  };
}

function draftForStorage(form: FormState) {
  return {
    ...form,
    digital_w9: {
      ...form.digital_w9,
      tin: "",
      signature_data_url: isRetainedSignature(form.digital_w9.signature_data_url)
        ? form.digital_w9.signature_data_url
        : "",
    },
    contract_signature: {
      ...form.contract_signature,
      signature_data_url: isRetainedSignature(form.contract_signature.signature_data_url)
        ? form.contract_signature.signature_data_url
        : "",
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

function profileCropLimits(crop: ProfileCropState) {
  const baseScale = Math.max(
    PROFILE_CROP_PREVIEW_SIZE / crop.imageWidth,
    PROFILE_CROP_PREVIEW_SIZE / crop.imageHeight,
  );
  const displayWidth = crop.imageWidth * baseScale * crop.zoom;
  const displayHeight = crop.imageHeight * baseScale * crop.zoom;
  return {
    displayWidth,
    displayHeight,
    maxOffsetX: Math.max(0, (displayWidth - PROFILE_CROP_PREVIEW_SIZE) / 2),
    maxOffsetY: Math.max(0, (displayHeight - PROFILE_CROP_PREVIEW_SIZE) / 2),
  };
}

function clampProfileCropOffset(crop: ProfileCropState, offsetX: number, offsetY: number) {
  const limits = profileCropLimits(crop);
  return {
    offsetX: Math.max(-limits.maxOffsetX, Math.min(limits.maxOffsetX, offsetX)),
    offsetY: Math.max(-limits.maxOffsetY, Math.min(limits.maxOffsetY, offsetY)),
  };
}

async function createCroppedProfileFile(crop: ProfileCropState) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unable to read the selected profile photo."));
    img.src = crop.previewUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = PROFILE_CROP_OUTPUT_SIZE;
  canvas.height = PROFILE_CROP_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to crop the profile photo.");

  const scale =
    Math.max(
      PROFILE_CROP_OUTPUT_SIZE / image.naturalWidth,
      PROFILE_CROP_OUTPUT_SIZE / image.naturalHeight,
    ) * crop.zoom;
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const previewToOutput = PROFILE_CROP_OUTPUT_SIZE / PROFILE_CROP_PREVIEW_SIZE;
  const drawX =
    (PROFILE_CROP_OUTPUT_SIZE - renderedWidth) / 2 +
    crop.offsetX * previewToOutput;
  const drawY =
    (PROFILE_CROP_OUTPUT_SIZE - renderedHeight) / 2 +
    crop.offsetY * previewToOutput;

  context.drawImage(image, drawX, drawY, renderedWidth, renderedHeight);
  const blob = await canvasToBlob(canvas, "image/webp", 0.82);
  return new File([blob], `${fileBaseName(crop.file.name)}-profile.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
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
  if (cleanDigits(w9.tin).length !== 9 && !w9.tin_retained)
    missing.push("9-digit SSN/EIN");
  if (!w9.signer_name.trim()) missing.push("signature name");
  if (!hasSignatureValue(w9.signature_data_url)) missing.push("electronic signature");
  if (!w9.certification_confirmed) missing.push("certification checkbox");
  return missing;
}

function contractMissingFields(contract: ContractSignatureState) {
  const missing: string[] = [];
  if (!contract.contractor_name.trim()) missing.push("contractor legal name");
  if (!contract.effective_date.trim()) missing.push("contract effective date");
  if (!hasSignatureValue(contract.signature_data_url))
    missing.push("contract signature");
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

function signatureFont() {
  return "'Snell Roundhand', 'Apple Chancery', 'Brush Script MT', 'Segoe Script', 'Lucida Handwriting', cursive";
}

function canvasToJpegDataUrl(source: HTMLCanvasElement) {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const ctx = output.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(source, 0, 0);
  return output.toDataURL("image/jpeg", 0.94);
}

async function generatedSignatureDataUrl(name: string) {
  if ("fonts" in document) {
    try {
      await document.fonts.load("118px 'Snell Roundhand'");
      await document.fonts.ready;
    } catch {
      // Use the next available handwritten font in the stack.
    }
  }

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
  let baseSize = 118;
  const family = signatureFont();
  ctx.font = `italic ${baseSize}px ${family}`;

  const targetWidth = 980;
  let measured = ctx.measureText(name).width;
  while (measured > targetWidth && baseSize > 58) {
    baseSize -= 4;
    ctx.font = `italic ${baseSize}px ${family}`;
    measured = ctx.measureText(name).width;
  }

  const centerY = 136 + Math.sin(seed) * 3;
  const startX = Math.max(42, (canvas.width - measured) / 2 - 10);

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

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(50, 220);
  ctx.bezierCurveTo(300, 216, 590, 225, 1050, 220);
  ctx.stroke();
  return canvasToJpegDataUrl(canvas);
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
    onChange(canvasToJpegDataUrl(canvas));
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
  const nameForSignature = signerName.trim();
  const retained = isRetainedSignature(value);
  const signatureImage = isSignatureImage(value);

  async function useTypedSignature() {
    if (!nameForSignature) return;
    const signature = await generatedSignatureDataUrl(nameForSignature);
    if (signature) onChange(signature);
  }

  return (
    <div>
      {retained ? (
        <div className="success" role="status" style={{ marginBottom: 10, fontWeight: 800 }}>
          ✓ Signature retained from your previous submission. You do not need to sign again unless you want to replace it.
        </div>
      ) : null}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button
          className={mode === "typed" ? "primary" : "ghost"}
          type="button"
          onClick={() => setMode("typed")}
        >
          Cursive signature — recommended
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
          <div className="success small" style={{ fontWeight: 800 }}>
            ELS handwritten script
          </div>
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
                fontFamily: signatureFont(),
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
            style={{
              background: "#15803d",
              borderColor: "#166534",
              color: "#ffffff",
              fontWeight: 800,
              boxShadow: "0 8px 18px rgba(21, 128, 61, 0.24)",
              opacity: nameForSignature ? 1 : 0.55,
            }}
          >
            Use this typed signature
          </button>
          {hasSignatureValue(value) ? (
            <div
              className="success"
              role="status"
              aria-live="polite"
              style={{ fontWeight: 800 }}
            >
              {retained ? "✓ Signature retained" : "✓ Signature added"}
            </div>
          ) : null}
        </div>
      ) : (
        <SignaturePad value={signatureImage ? value : ""} onChange={onChange} />
      )}

      {signatureImage ? (
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
                    tin_last4: nextType === value.tin_type ? value.tin_last4 : "",
                    tin_retained: nextType === value.tin_type ? value.tin_retained : false,
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
                  onChange({
                    ...value,
                    tin: formatTinForDisplay(event.target.value, value.tin_type),
                    tin_last4: "",
                    tin_retained: false,
                  })
                }
                placeholder={
                  value.tin_retained && value.tin_last4
                    ? `Previously saved ending ${value.tin_last4}`
                    : tinPlaceholder(value.tin_type)
                }
                inputMode="numeric"
                autoComplete="off"
              />
            </label>
          </div>
          {value.tin_retained && value.tin_last4 ? (
            <p className="success small" style={{ fontWeight: 800 }}>
              ✓ Your securely saved TIN ending in {value.tin_last4} will be reused.
              Enter a new number only when you need to replace it.
            </p>
          ) : null}
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
  const [submitted, setSubmitted] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({});
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [requestType, setRequestType] =
    useState<RequestType>("full_onboarding");
  const [cityPoolOptions, setCityPoolOptions] = useState<CityPoolOption[]>([]);
  const [positionOptions, setPositionOptions] = useState<string[]>([]);
  const primaryCityPoolManuallyChanged = useRef(false);
  const autoSelectedPrimaryCityPoolId = useRef("");
  const [profileCrop, setProfileCrop] = useState<ProfileCropState | null>(null);
  const [profileCropSaving, setProfileCropSaving] = useState(false);
  const profileCropDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (profileCrop?.previewUrl) URL.revokeObjectURL(profileCrop.previewUrl);
    };
  }, [profileCrop?.previewUrl]);

  useEffect(() => {
    const effectiveToken = token || tokenFromParams;
    const mode =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("mode")
        : "";
    if (mode) {
      const normalized = normalizeRequestType(mode);
      setRequestType(normalized);
    }
    if (!effectiveToken) return;

    primaryCityPoolManuallyChanged.current = false;
    autoSelectedPrimaryCityPoolId.current = "";
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
          const draftKey = `els-onboarding-draft-${effectiveToken}`;
          if (result.locked || result.status === "submitted" || result.status === "approved") {
            window.localStorage.removeItem(draftKey);
            setSubmitted(true);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
          let storedDraft: unknown = null;
          try {
            storedDraft = JSON.parse(window.localStorage.getItem(draftKey) || "null");
          } catch {
            storedDraft = null;
          }
          setForm((current) => {
            const next = mergeSavedForm(
              mergeSavedForm(current, storedDraft, null),
              result.payload,
              result.crew,
            );
            primaryCityPoolManuallyChanged.current = Boolean(
              next.primary_city_pool_id,
            );
            return next;
          });
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
    if (requestType !== "full_onboarding") return;
    if (primaryCityPoolManuallyChanged.current) return;

    const match = matchingCityPool(
      cityPoolOptions,
      form.home_city,
      form.home_state,
    );
    setForm((current) => {
      if (match) {
        autoSelectedPrimaryCityPoolId.current = match.id;
        if (current.primary_city_pool_id === match.id) return current;
        return {
          ...current,
          primary_city_pool_id: match.id,
          local_city_pool_ids: current.local_city_pool_ids.filter(
            (id) => id !== match.id,
          ),
        };
      }

      if (
        autoSelectedPrimaryCityPoolId.current &&
        current.primary_city_pool_id === autoSelectedPrimaryCityPoolId.current
      ) {
        autoSelectedPrimaryCityPoolId.current = "";
        return { ...current, primary_city_pool_id: "" };
      }
      return current;
    });
  }, [cityPoolOptions, form.home_city, form.home_state, requestType]);

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

  async function beginProfilePhotoCrop(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadMessage("profile_photo", "Please choose an image file.", "error");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () =>
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("Unable to read the selected profile photo."));
        image.src = previewUrl;
      });
      if (!dimensions.width || !dimensions.height)
        throw new Error("Unable to read the selected profile photo.");
      setProfileCrop({
        file,
        previewUrl,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
      });
      setUploadMessage(
        "profile_photo",
        "Move and zoom the photo to center your face, then save it.",
        "info",
      );
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setUploadMessage(
        "profile_photo",
        error instanceof Error ? error.message : "Unable to read the selected profile photo.",
        "error",
      );
    }
  }

  function updateProfileCropZoom(zoom: number) {
    setProfileCrop((current) => {
      if (!current) return current;
      const next = { ...current, zoom };
      return { ...next, ...clampProfileCropOffset(next, next.offsetX, next.offsetY) };
    });
  }

  function handleProfileCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!profileCrop) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    profileCropDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: profileCrop.offsetX,
      offsetY: profileCrop.offsetY,
    };
  }

  function handleProfileCropPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = profileCropDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setProfileCrop((current) => {
      if (!current) return current;
      const offsets = clampProfileCropOffset(
        current,
        drag.offsetX + event.clientX - drag.startX,
        drag.offsetY + event.clientY - drag.startY,
      );
      return { ...current, ...offsets };
    });
  }

  function endProfileCropDrag(event: PointerEvent<HTMLDivElement>) {
    if (profileCropDrag.current?.pointerId === event.pointerId) {
      profileCropDrag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function uploadFiles(kind: UploadKind, list: FileList | File[] | null) {
    const effectiveToken = token || tokenFromParams;
    const files = Array.from(list || []);
    if (!files.length) return false;
    if (!effectiveToken) {
      setUploadMessage(kind, "Missing onboarding token.", "error");
      return false;
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
      return true;
    } catch (error) {
      setUploadMessage(
        kind,
        error instanceof Error
          ? error.message
          : `Unable to upload ${uploadLabels[kind]}.`,
        "error",
      );
      return false;
    }
  }

  async function saveCroppedProfilePhoto() {
    if (!profileCrop) return;
    setProfileCropSaving(true);
    setUploadMessage(
      "profile_photo",
      "Preparing and uploading your cropped profile picture...",
      "info",
      true,
    );
    try {
      const croppedFile = await createCroppedProfileFile(profileCrop);
      const uploaded = await uploadFiles("profile_photo", [croppedFile]);
      if (uploaded) setProfileCrop(null);
    } catch (error) {
      setUploadMessage(
        "profile_photo",
        error instanceof Error ? error.message : "Unable to crop the profile picture.",
        "error",
      );
    } finally {
      setProfileCropSaving(false);
    }
  }

  async function submit() {
    const effectiveToken = token || tokenFromParams;
    if (!effectiveToken) {
      setMessage({ kind: "error", text: "Missing onboarding token." });
      return;
    }

    if (requestType === "profile_photo_only") {
      if (!form.profile_photo_url) {
        setMessage({
          kind: "error",
          text: "Please upload a current profile photo before submitting.",
        });
        return;
      }
    } else if (requestType !== "contract_only") {
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
      if (contractMissing.length) {
        setMessage({
          kind: "error",
          text: `Please sign the Independent Contractor Agreement before submitting. Missing: ${contractMissing.join(", ")}.`,
        });
        return;
      }
    } else if (requestType === "full_onboarding") {
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
      const contractMissing = contractMissingFields({
        ...form.contract_signature,
        contractor_name:
          form.contract_signature.contractor_name || form.legal_name,
      });
      if (contractMissing.length) {
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
          w9_use_digital: requestType !== "contract_only" && requestType !== "profile_photo_only",
          ...form,
          w9_document_url: "",
          contract_document_url: "",
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
        text:
          requestType === "w9_only"
            ? "Submitted successfully. Your W-9 was sent securely to Emanuel Labor Services."
            : requestType === "contract_only"
              ? "Submitted successfully. Your signed contractor agreement was sent securely."
              : requestType === "profile_photo_only"
                ? "Submitted successfully. Your profile photo was sent securely to Emanuel Labor Services."
                : "Submitted successfully. Emanuel Labor Services will review your onboarding packet.",
      });
      setSubmitted(true);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
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

  if (submitted) {
    const completion =
      requestType === "w9_only"
        ? {
            title: "Thank you for submitting your W-9!",
            detail: "Your completed W-9 was sent securely to Emanuel Labor Services.",
          }
        : requestType === "contract_only"
          ? {
              title: "Thank you for submitting your signed contractor agreement!",
              detail: "Your signed agreement was sent securely to Emanuel Labor Services.",
            }
          : requestType === "profile_photo_only"
            ? {
                title: "Thank you for submitting your profile photo!",
                detail: "Your profile photo was sent securely to Emanuel Labor Services.",
              }
          : {
              title: "Thank you for filling out your onboarding paperwork!",
              detail: "Your completed onboarding packet has been received by Emanuel Labor Services.",
            };

    return (
      <main style={{ maxWidth: 760, margin: "48px auto", padding: "0 16px" }}>
        <section
          className="card"
          aria-live="polite"
          style={{ textAlign: "center", padding: "42px 28px" }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 14px",
              borderRadius: "999px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#16843f",
              color: "#ffffff",
              fontSize: 36,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            ✓
          </div>
          <p
            className="success"
            style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 900 }}
          >
            Submitted successfully
          </p>
          <h1 style={{ margin: "0 0 12px" }}>{completion.title}</h1>
          <p style={{ margin: "0 auto", maxWidth: 580 }}>{completion.detail}</p>
          <p className="muted" style={{ margin: "12px 0 0" }}>
            You can close this page now.
          </p>
        </section>
      </main>
    );
  }

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
          {message ? (
            <p
              className={message.kind === "error" ? "error" : "success"}
              role={message.kind === "error" ? "alert" : "status"}
              aria-live="polite"
              style={{ marginBottom: 0, fontWeight: 800 }}
            >
              {message.text}
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  if (requestType === "profile_photo_only") {
    const profilePhotoReady = Boolean(form.profile_photo_url);
    const limits = profileCrop ? profileCropLimits(profileCrop) : null;
    const imageLeft = profileCrop && limits
      ? (PROFILE_CROP_PREVIEW_SIZE - limits.displayWidth) / 2 + profileCrop.offsetX
      : 0;
    const imageTop = profileCrop && limits
      ? (PROFILE_CROP_PREVIEW_SIZE - limits.displayHeight) / 2 + profileCrop.offsetY
      : 0;

    return (
      <main style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px" }}>
        <section className="card">
          <h1 style={{ marginBottom: 6 }}>Emanuel Labor Services Profile Photo Request</h1>
          <p className="muted" style={{ marginTop: 0 }}>
            Upload or replace only your crew profile photo through this secure link.
          </p>
        </section>

        <section className="card" style={{ marginTop: 16 }}>
          {message ? (
            <p className={message.kind === "error" ? "error" : "success"} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          ) : null}
          <div className="grid" style={{ gap: 14 }}>
            <label className="field">
              <span>Profile photo</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploadDisabled || profileCropSaving}
                onChange={(event) => {
                  void beginProfilePhotoCrop(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <span className={uploadStatus.profile_photo?.kind === "error" ? "error" : uploadStatus.profile_photo?.kind === "success" ? "success" : "muted small"}>
                {uploadStatus.profile_photo?.text ||
                  (profilePhotoReady
                    ? "Profile picture uploaded successfully."
                    : "Choose a current headshot or clear crew profile photo.")}
              </span>
            </label>
            {profileCrop ? (
              <div className="card compact" style={{ background: "#f0fdf4", borderColor: "#16843f" }}>
                <div
                  role="application"
                  aria-label="Drag profile photo to reposition it"
                  onPointerDown={handleProfileCropPointerDown}
                  onPointerMove={handleProfileCropPointerMove}
                  onPointerUp={endProfileCropDrag}
                  onPointerCancel={endProfileCropDrag}
                  style={{
                    position: "relative",
                    width: PROFILE_CROP_PREVIEW_SIZE,
                    height: PROFILE_CROP_PREVIEW_SIZE,
                    margin: "0 auto",
                    overflow: "hidden",
                    borderRadius: "50%",
                    border: "4px solid #16843f",
                    background: "#e5e7eb",
                    cursor: "grab",
                    touchAction: "none",
                    userSelect: "none",
                  }}
                >
                  <img
                    src={profileCrop.previewUrl}
                    alt="Profile crop preview"
                    draggable={false}
                    style={{
                      position: "absolute",
                      left: imageLeft,
                      top: imageTop,
                      width: limits?.displayWidth,
                      height: limits?.displayHeight,
                      maxWidth: "none",
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  />
                </div>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>Zoom</span>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.01"
                    value={profileCrop.zoom}
                    onChange={(event) => updateProfileCropZoom(Number(event.target.value))}
                  />
                </label>
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button className="primary" type="button" disabled={profileCropSaving} onClick={() => void saveCroppedProfilePhoto()}>
                    {profileCropSaving ? "Saving photo..." : "Save profile photo"}
                  </button>
                  <button className="ghost" type="button" disabled={profileCropSaving} onClick={() => setProfileCrop(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}>
            <button
              className="primary"
              type="button"
              disabled={saving || uploadDisabled || !profilePhotoReady}
              onClick={submit}
            >
              {saving ? "Submitting..." : "Submit profile photo"}
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
            Complete and electronically sign your W-9 through this secure link.
            ELS saves the tax fields directly for tax/1099 records and generates
            the completed W-9 PDF automatically.
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

          <div className="notice" style={{ marginBottom: 14 }}>
            Complete and sign the W-9 below so ELS can securely save the tax fields in the system and generate the W-9 PDF automatically.
          </div>
          <DigitalW9Form
            value={form.digital_w9}
            onChange={setDigitalW9}
            compact
          />

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
          {message ? (
            <p
              className={message.kind === "error" ? "error" : "success"}
              role={message.kind === "error" ? "alert" : "status"}
              aria-live="polite"
              style={{ marginBottom: 0, fontWeight: 800 }}
            >
              {message.text}
            </p>
          ) : null}
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

        <div
          className="card compact"
          style={{
            background: "#f3fbf6",
            border: "2px solid #16843f",
            marginTop: 14,
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>
            Professional profile photo (required)
          </h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Upload a clear, current head-and-shoulders photo. ELS compresses it
            to WebP around 800×800 for your Crew profile.
          </p>
          <label className="field">
            <span>Choose profile picture</span>
            <input
              type="file"
              accept="image/*"
              disabled={uploadDisabled || profileCropSaving}
              onChange={(event) => {
                void beginProfilePhotoCrop(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {profileCrop ? (() => {
              const limits = profileCropLimits(profileCrop);
              const imageLeft =
                (PROFILE_CROP_PREVIEW_SIZE - limits.displayWidth) / 2 +
                profileCrop.offsetX;
              const imageTop =
                (PROFILE_CROP_PREVIEW_SIZE - limits.displayHeight) / 2 +
                profileCrop.offsetY;
              return (
                <div
                  style={{
                    marginTop: 12,
                    padding: 14,
                    border: "1px solid #9bc7aa",
                    borderRadius: 12,
                    background: "#ffffff",
                  }}
                >
                  <p style={{ margin: "0 0 10px", fontWeight: 800 }}>
                    Position your profile picture
                  </p>
                  <p className="muted small" style={{ margin: "0 0 12px" }}>
                    Drag the photo to center your face. Use the zoom control so
                    your head and shoulders fit inside the circle.
                  </p>
                  <div
                    role="application"
                    aria-label="Drag profile photo to reposition it"
                    onPointerDown={handleProfileCropPointerDown}
                    onPointerMove={handleProfileCropPointerMove}
                    onPointerUp={endProfileCropDrag}
                    onPointerCancel={endProfileCropDrag}
                    style={{
                      position: "relative",
                      width: PROFILE_CROP_PREVIEW_SIZE,
                      height: PROFILE_CROP_PREVIEW_SIZE,
                      maxWidth: "100%",
                      margin: "0 auto",
                      overflow: "hidden",
                      borderRadius: "50%",
                      border: "4px solid #16843f",
                      background: "#e5e7eb",
                      cursor: "grab",
                      touchAction: "none",
                      userSelect: "none",
                    }}
                  >
                    <img
                      src={profileCrop.previewUrl}
                      alt="Profile crop preview"
                      draggable={false}
                      style={{
                        position: "absolute",
                        left: imageLeft,
                        top: imageTop,
                        width: limits.displayWidth,
                        height: limits.displayHeight,
                        maxWidth: "none",
                        pointerEvents: "none",
                        userSelect: "none",
                      }}
                    />
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: "50% auto auto 50%",
                        width: 18,
                        height: 18,
                        borderLeft: "1px solid rgba(255,255,255,.8)",
                        borderTop: "1px solid rgba(255,255,255,.8)",
                        transform: "translate(-9px, -9px)",
                        pointerEvents: "none",
                      }}
                    />
                  </div>
                  <label className="field" style={{ marginTop: 12 }}>
                    <span>Zoom</span>
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.01"
                      value={profileCrop.zoom}
                      onChange={(event) =>
                        updateProfileCropZoom(Number(event.target.value))
                      }
                    />
                  </label>
                  <div className="toolbar" style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={profileCropSaving}
                      onClick={() => void saveCroppedProfilePhoto()}
                      style={{ background: "#16843f", borderColor: "#16843f" }}
                    >
                      {profileCropSaving
                        ? "Saving profile picture..."
                        : "Save cropped profile picture"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={profileCropSaving}
                      onClick={() => setProfileCrop(null)}
                    >
                      Choose a different picture
                    </button>
                  </div>
                </div>
              );
            })() : null}
            <span
              className={
                uploadStatus.profile_photo?.kind === "error"
                  ? "error"
                  : uploadStatus.profile_photo?.kind === "success"
                    ? "success"
                    : "muted small"
              }
              style={{ fontWeight: form.profile_photo_url ? 800 : undefined }}
            >
              {uploadStatus.profile_photo?.text ||
                (form.profile_photo_url
                  ? "✓ Profile picture uploaded successfully."
                  : "No profile picture uploaded yet.")}
            </span>
          </label>
        </div>

        <div className="card compact" style={{ background: "#fbfcfd", marginTop: 14 }}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Home address</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            When your city matches an existing ELS labor pool, that pool will be
            selected automatically as your main local city. You can change it below.
          </p>
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
            <select
              value={form.primary_city_pool_id}
              onChange={(event) => {
                primaryCityPoolManuallyChanged.current = true;
                autoSelectedPrimaryCityPoolId.current = "";
                setField("primary_city_pool_id", event.target.value);
              }}
            >
              <option value="">Choose your main city</option>
              {cityPoolOptions.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}
            </select>
          </label>
          {autoSelectedPrimaryCityPoolId.current && form.primary_city_pool_id === autoSelectedPrimaryCityPoolId.current ? (
            <p className="success small" style={{ marginTop: -4 }}>
              Selected automatically from your home city. You can change it.
            </p>
          ) : null}
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
          <label className="field" style={{ marginTop: 10 }}>
            <span>Years of live-event / AV experience</span>
            <input value={form.years_experience} inputMode="decimal" onChange={(event) => setField("years_experience", event.target.value)} />
          </label>
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
          <h3 style={{ marginTop: 0 }}>Required tax and contract documents</h3>
          <p className="muted small">
            The in-app W-9 and contract are generated as private PDF records.
            After Emanuel Labor Services approves the onboarding packet, the
            PDFs are archived to secure Google Drive storage when connected.
          </p>

          <div className="notice" style={{ marginBottom: 14 }}>
            The W-9 must be completed and signed in this secure form. ELS saves the tax fields directly in the system and generates the W-9 PDF automatically.
          </div>
          <DigitalW9Form
            value={form.digital_w9}
            onChange={setDigitalW9}
            compact
          />

          <div className="notice" style={{ marginTop: 14, marginBottom: 14 }}>
            Complete and sign the Independent Contractor Agreement below. ELS will generate the signed PDF automatically.
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
                placeholder="Completed in app / need help..."
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
        {message ? (
          <p
            className={message.kind === "error" ? "error" : "success"}
            role={message.kind === "error" ? "alert" : "status"}
            aria-live="polite"
            style={{ marginBottom: 0, fontWeight: 800 }}
          >
            {message.text}
          </p>
        ) : null}
      </section>
    </main>
  );
}
