import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type SupabaseAdmin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type OnboardingDocumentType = "profile_photo" | "work_photo" | "w9" | "contract" | "general";
type OnboardingRequestType = "full_onboarding" | "w9_only";

type DocumentConfig = {
  bucket: string;
  folder: string;
  maxBytes: number;
  allowedMimeTypes: string[];
  allowedMimePrefixes: string[];
};

const DOCUMENT_CONFIG: Record<OnboardingDocumentType, DocumentConfig> = {
  profile_photo: {
    bucket: "crew-profile-photos",
    folder: "profile-photos",
    maxBytes: 4 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    allowedMimePrefixes: ["image/"],
  },
  work_photo: {
    bucket: "crew-work-photos",
    folder: "work-photos",
    maxBytes: 8 * 1024 * 1024,
    allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    allowedMimePrefixes: ["image/"],
  },
  w9: {
    bucket: "crew-w9-documents",
    folder: "w9",
    maxBytes: 20 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    allowedMimePrefixes: ["image/"],
  },
  contract: {
    bucket: "crew-contracts",
    folder: "contracts",
    maxBytes: 20 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    allowedMimePrefixes: ["image/"],
  },
  general: {
    bucket: "crew-onboarding-documents",
    folder: "general",
    maxBytes: 20 * 1024 * 1024,
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    allowedMimePrefixes: ["image/"],
  },
};

function safeText(value: unknown) {
  return String(value ?? "").trim();
}


type DigitalW9Payload = {
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
  tin_digits: string;
  tin_last4: string;
  signer_name: string;
  signature_data_url: string;
  certification_confirmed: boolean;
};


function cleanDigits(value: unknown) {
  return safeText(value).replace(/\D/g, "");
}

function normalizeTinType(value: unknown): "ssn" | "ein" {
  return safeText(value).toLowerCase() === "ein" ? "ein" : "ssn";
}

function sanitizeDigitalW9(value: unknown): DigitalW9Payload {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const tinDigits = cleanDigits(source.tin);
  return {
    tax_legal_name: safeText(source.tax_legal_name),
    business_name: safeText(source.business_name),
    federal_tax_classification: safeText(source.federal_tax_classification) || "individual",
    llc_tax_classification: safeText(source.llc_tax_classification),
    other_classification: safeText(source.other_classification),
    exempt_payee_code: safeText(source.exempt_payee_code),
    fatca_code: safeText(source.fatca_code),
    tax_address_line_1: safeText(source.tax_address_line_1),
    tax_city_state_zip: safeText(source.tax_city_state_zip),
    account_numbers: safeText(source.account_numbers),
    tin_type: normalizeTinType(source.tin_type),
    tin_digits: tinDigits,
    tin_last4: tinDigits.slice(-4),
    signer_name: safeText(source.signer_name),
    signature_data_url: safeText(source.signature_data_url),
    certification_confirmed: Boolean(source.certification_confirmed),
  };
}

function digitalW9MissingFields(w9: DigitalW9Payload) {
  const missing: string[] = [];
  if (!w9.tax_legal_name) missing.push("legal tax name");
  if (!w9.tax_address_line_1) missing.push("tax mailing address");
  if (!w9.tax_city_state_zip) missing.push("city/state/ZIP");
  if (w9.tin_digits.length !== 9) missing.push("9-digit SSN/EIN");
  if (!w9.signer_name) missing.push("signer name");
  if (!w9.signature_data_url || !w9.signature_data_url.startsWith("data:image/")) missing.push("drawn signature");
  if (!w9.certification_confirmed) missing.push("certification checkbox");
  if (w9.signature_data_url.length > 750_000) missing.push("signature file is too large; clear and sign again");
  return missing;
}

function redactedDigitalW9(w9: DigitalW9Payload) {
  return {
    tax_legal_name: w9.tax_legal_name,
    business_name: w9.business_name,
    federal_tax_classification: w9.federal_tax_classification,
    llc_tax_classification: w9.llc_tax_classification,
    other_classification: w9.other_classification,
    exempt_payee_code: w9.exempt_payee_code,
    fatca_code: w9.fatca_code,
    tax_address_line_1: w9.tax_address_line_1,
    tax_city_state_zip: w9.tax_city_state_zip,
    account_numbers: w9.account_numbers,
    tin_type: w9.tin_type,
    tin_last4: w9.tin_last4,
    signer_name: w9.signer_name,
    certification_confirmed: w9.certification_confirmed,
    signature_captured: Boolean(w9.signature_data_url),
  };
}

function tinEncryptionKey() {
  const material = process.env.W9_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXTAUTH_SECRET || "";
  if (!material) throw new Error("W-9 encryption is not configured. Add W9_ENCRYPTION_KEY in Vercel, or make sure SUPABASE_SERVICE_ROLE_KEY is set.");
  return crypto.createHash("sha256").update(material).digest();
}

function encryptTin(tinDigits: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tinEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(tinDigits, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes-256-gcm:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function digitalW9Notes(w9: DigitalW9Payload, submittedAt: string) {
  return [
    `Digital substitute W-9 submitted in ELS on ${submittedAt.slice(0, 10)}.`,
    `Tax legal name: ${w9.tax_legal_name}`,
    w9.business_name ? `Business name: ${w9.business_name}` : "",
    `Tax classification: ${w9.federal_tax_classification}${w9.llc_tax_classification ? ` (${w9.llc_tax_classification})` : ""}`,
    `TIN type: ${w9.tin_type.toUpperCase()} ending ${w9.tin_last4}`,
    `Signed by: ${w9.signer_name}`,
    "Owner review required before approving for 1099 filing.",
  ].filter(Boolean).join("\n");
}

async function saveDigitalW9(admin: SupabaseAdmin, crewId: string, requestId: string, w9: DigitalW9Payload, submittedAt: string) {
  const row = {
    crew_id: crewId,
    request_id: requestId || null,
    tax_legal_name: w9.tax_legal_name,
    business_name: w9.business_name || null,
    federal_tax_classification: w9.federal_tax_classification,
    llc_tax_classification: w9.llc_tax_classification || null,
    other_classification: w9.other_classification || null,
    exempt_payee_code: w9.exempt_payee_code || null,
    fatca_code: w9.fatca_code || null,
    tax_address_line_1: w9.tax_address_line_1,
    tax_city_state_zip: w9.tax_city_state_zip,
    account_numbers: w9.account_numbers || null,
    tin_type: w9.tin_type,
    tin_last4: w9.tin_last4,
    tin_encrypted: encryptTin(w9.tin_digits),
    signer_name: w9.signer_name,
    signature_data_url: w9.signature_data_url,
    certification_confirmed: w9.certification_confirmed,
    signed_at: submittedAt,
    source: "public_onboarding",
    updated_at: submittedAt,
  };

  const result = await admin.from("crew_tax_profiles").upsert(row, { onConflict: "crew_id" }).select("id").single();
  if (result.error) {
    const message = result.error.message || "";
    if (/crew_tax_profiles|schema cache|column|relation/i.test(message)) {
      throw new Error("Digital W-9 storage is not ready. Run ELS218_required_sql.sql in Supabase, then try again.");
    }
    throw new Error(message);
  }
  return result.data;
}

function normalizeRole(role: string | null | undefined) {
  const value = String(role || "viewer").toLowerCase().trim();
  if (["owner", "admin", "coordinator", "salesman", "sales", "viewer"].includes(value)) return value === "sales" ? "salesman" : value;
  return "viewer";
}

function isOwnerAdmin(role: string) {
  return role === "owner" || role === "admin";
}

function cleanPhone(value: string | null | undefined) {
  const raw = String(value || "");
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return digits ? `+${digits}` : "";
}

function splitList(value: unknown) {
  return safeText(value).split(/\n|,|;/).map((item) => item.trim()).filter(Boolean);
}

function appBaseUrl(request: Request) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "";
  if (envUrl) return envUrl.startsWith("http") ? envUrl.replace(/\/+$/, "") : `https://${envUrl.replace(/\/+$/, "")}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function normalizeDocumentType(value: unknown): OnboardingDocumentType | null {
  const normalized = safeText(value).toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/[ -]+/g, "_");
  if (["profile_photo", "work_photo", "w9", "contract", "general"].includes(normalized)) return normalized as OnboardingDocumentType;
  return null;
}

function normalizeRequestType(value: unknown): OnboardingRequestType {
  const normalized = safeText(value).toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/[ -]+/g, "_");
  if (["w9", "w_9", "w9_only", "tax", "tax_only", "tax_docs", "tax_docs_only"].includes(normalized)) return "w9_only";
  return "full_onboarding";
}

function requestTypeFromRow(row: unknown): OnboardingRequestType {
  const payload = (row as { submission_payload?: unknown } | null)?.submission_payload;
  if (payload && typeof payload === "object") {
    return normalizeRequestType((payload as { request_type?: unknown }).request_type);
  }
  return "full_onboarding";
}

function cleanStorageSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "file";
}

function extensionForFile(file: File) {
  const original = safeText(file.name).split(".").pop()?.toLowerCase() || "";
  if (/^[a-z0-9]{2,8}$/.test(original)) return original === "jpeg" ? "jpg" : original;
  const mime = safeText(file.type).toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("png")) return "png";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "bin";
}

function allowedFileType(file: File, config: DocumentConfig) {
  const mime = safeText(file.type).toLowerCase();
  if (!mime) return false;
  if (config.allowedMimeTypes.includes(mime)) return true;
  return config.allowedMimePrefixes.some((prefix) => mime.startsWith(prefix));
}

function buildStoragePath(crewId: string, documentType: OnboardingDocumentType, file: File) {
  const config = DOCUMENT_CONFIG[documentType];
  const ext = extensionForFile(file);
  const originalBase = cleanStorageSegment(safeText(file.name).replace(/\.[^.]+$/, ""));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.randomBytes(6).toString("hex");
  return `${cleanStorageSegment(crewId)}/${config.folder}/${stamp}-${nonce}-${originalBase}.${ext}`;
}

function storageSetupMessage(errorMessage: string) {
  if (/bucket|storage|not found|does not exist|schema cache/i.test(errorMessage)) {
    return "Upload storage is not ready. Run ELS211_required_sql.sql once in Supabase, then try again.";
  }
  return errorMessage;
}

async function requireOwnerAdmin() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = normalizeRole((profile as { role?: string | null } | null)?.role);
  if (!isOwnerAdmin(role)) return { ok: false as const, response: NextResponse.json({ message: "Only owner/admin can create onboarding links or upload private onboarding documents." }, { status: 403 }) };
  return { ok: true as const, user };
}

async function readValidOnboardingRequest(admin: SupabaseAdmin, token: string) {
  if (!token) return { ok: false as const, response: NextResponse.json({ message: "Missing onboarding token." }, { status: 400 }) };
  const { data: requestRow, error } = await admin.from("crew_onboarding_requests").select("id, crew_id, status, expires_at, submission_payload").eq("token", token).maybeSingle();
  if (error) {
    if ((error.message || "").includes("crew_onboarding_requests")) return { ok: false as const, response: NextResponse.json({ message: "Onboarding requests table is missing. Run ELS210_required_sql.sql." }, { status: 400 }) };
    throw new Error(error.message);
  }
  if (!requestRow) return { ok: false as const, response: NextResponse.json({ message: "This onboarding link is invalid." }, { status: 404 }) };
  const status = safeText((requestRow as { status?: string | null }).status);
  if (status === "cancelled") return { ok: false as const, response: NextResponse.json({ message: "This onboarding link was cancelled. Please ask ELS for a new link." }, { status: 410 }) };
  if (status === "expired") return { ok: false as const, response: NextResponse.json({ message: "This onboarding link has expired. Please ask ELS for a new link." }, { status: 410 }) };
  const expiresAt = safeText((requestRow as { expires_at?: string | null }).expires_at);
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return { ok: false as const, response: NextResponse.json({ message: "This onboarding link has expired. Please ask ELS for a new link." }, { status: 410 }) };
  return { ok: true as const, requestRow };
}

async function insertIntroQueue(admin: SupabaseAdmin, row: Record<string, unknown>) {
  const withSender = await admin.from("crew_intro_text_queue").insert(row).select("id, crew_id, crew_name, phone, body, status, scheduled_for, created_at").single();
  if (!withSender.error) return withSender.data;
  const message = withSender.error.message || "";
  if (!(message.includes("queued_by_user_id") || message.includes("queued_by_email") || message.includes("queued_by_name") || message.includes("schema cache"))) throw new Error(message);
  const { queued_by_user_id, queued_by_email, queued_by_name, ...legacyRow } = row;
  const legacy = await admin.from("crew_intro_text_queue").insert(legacyRow).select("id, crew_id, crew_name, phone, body, status, scheduled_for, created_at").single();
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data;
}

async function recordOnboardingDocument(admin: SupabaseAdmin, row: Record<string, unknown>) {
  const result = await admin.from("crew_onboarding_documents").insert(row).select("id, document_type, bucket_id, storage_path, created_at").single();
  if (!result.error) return { document: result.data, warning: null as string | null };
  const message = result.error.message || "";
  if (/crew_onboarding_documents|schema cache|column/i.test(message)) {
    return { document: null, warning: "File uploaded and saved to the crew profile, but document history is not fully set up. Run ELS211_required_sql.sql to enable crew_onboarding_documents tracking." };
  }
  throw new Error(message);
}

function mergePathLists(existing: unknown, incoming: string[]) {
  const current = Array.isArray(existing) ? existing.map(safeText).filter(Boolean) : [];
  const seen = new Set(current);
  const merged = [...current];
  for (const path of incoming.map(safeText).filter(Boolean)) {
    if (seen.has(path)) continue;
    seen.add(path);
    merged.push(path);
  }
  return merged;
}

function normalizeStoredPath(value: unknown, bucket: string) {
  let path = safeText(value);
  if (!path) return "";
  try {
    if (/^https?:\/\//i.test(path)) {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
    }
  } catch {
    // Keep the original value when it is not a URL.
  }
  path = path.replace(/^\/+/, "");
  const objectMarker = `storage/v1/object/`;
  const objectIndex = path.indexOf(objectMarker);
  if (objectIndex >= 0) path = path.slice(objectIndex + objectMarker.length);
  path = path.replace(/^public\//, "").replace(/^sign\//, "");
  if (path.startsWith(`${bucket}/`)) path = path.slice(bucket.length + 1);
  return path.replace(/^\/+/, "");
}

function pathInList(list: unknown, path: string) {
  return Array.isArray(list) && list.map(safeText).some((item) => item === path);
}

async function storagePathBelongsToCrew(admin: SupabaseAdmin, crewId: string, documentType: OnboardingDocumentType, storagePath: string) {
  const { data: crew, error: crewError } = await admin
    .from("crew")
    .select("profile_photo_url, work_photo_urls, w9_document_url, contract_document_url")
    .eq("id", crewId)
    .maybeSingle();
  if (crewError) throw new Error(crewError.message);
  if (!crew) return false;

  const typed = crew as { profile_photo_url?: string | null; work_photo_urls?: string[] | null; w9_document_url?: string | null; contract_document_url?: string | null };
  if (documentType === "profile_photo" && safeText(typed.profile_photo_url) === storagePath) return true;
  if (documentType === "work_photo" && pathInList(typed.work_photo_urls, storagePath)) return true;
  if (documentType === "w9" && safeText(typed.w9_document_url) === storagePath) return true;
  if (documentType === "contract" && safeText(typed.contract_document_url) === storagePath) return true;

  const documentRes = await admin
    .from("crew_onboarding_documents")
    .select("id")
    .eq("crew_id", crewId)
    .eq("document_type", documentType)
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (!documentRes.error && documentRes.data) return true;
  const message = documentRes.error?.message || "";
  if (/crew_onboarding_documents|schema cache|relation/i.test(message)) return false;
  if (documentRes.error) throw new Error(message);
  return false;
}

async function createSignedDocumentUrl(request: Request, admin: SupabaseAdmin, body: Record<string, unknown>) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const crewId = safeText(body.crew_id);
  const documentType = normalizeDocumentType(body.document_type);
  if (!crewId) return NextResponse.json({ message: "crew_id is required." }, { status: 400 });
  if (!documentType) return NextResponse.json({ message: "Valid document_type is required." }, { status: 400 });

  const config = DOCUMENT_CONFIG[documentType];
  const storagePath = normalizeStoredPath(body.storage_path, config.bucket);
  if (!storagePath) return NextResponse.json({ message: "storage_path is required." }, { status: 400 });

  const belongs = await storagePathBelongsToCrew(admin, crewId, documentType, storagePath);
  if (!belongs) {
    return NextResponse.json({ message: "That private file is not attached to this crew profile." }, { status: 403 });
  }

  const signed = await admin.storage.from(config.bucket).createSignedUrl(storagePath, 60 * 10, {
    download: Boolean(body.download),
  });
  if (signed.error) throw new Error(storageSetupMessage(signed.error.message || "Unable to create secure file link."));

  return NextResponse.json({
    ok: true,
    document_type: documentType,
    bucket: config.bucket,
    path: storagePath,
    signed_url: signed.data.signedUrl,
    expires_in_seconds: 600,
    message: "Secure link created. It expires in 10 minutes.",
  });
}

async function updateTaxDocumentReview(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const crewId = safeText(body.crew_id);
  const reviewAction = safeText(body.review_action).toLowerCase();
  const incomingNotes = safeText(body.notes);
  if (!crewId) return NextResponse.json({ message: "crew_id is required." }, { status: 400 });

  const { data: existingCrew, error: existingError } = await admin
    .from("crew")
    .select("id, name, tax_profile_notes")
    .eq("id", crewId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existingCrew) return NextResponse.json({ message: "Crew contact not found." }, { status: 404 });

  const currentNotes = safeText((existingCrew as { tax_profile_notes?: string | null }).tax_profile_notes);
  const crewName = safeText((existingCrew as { name?: string | null }).name) || "crew member";
  const stamp = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago" });
  const notePrefix = reviewAction === "approve_w9" ? "W-9 approved" : reviewAction === "request_correction" ? "W-9 correction requested" : "W-9 marked for review";
  const reviewNote = incomingNotes ? `${stamp}: ${notePrefix} — ${incomingNotes}` : `${stamp}: ${notePrefix}`;
  const nextNotes = [reviewNote, currentNotes].filter(Boolean).join("\n");

  let patch: Record<string, unknown> = {
    tax_profile_notes: nextNotes,
    updated_at: new Date().toISOString(),
  };

  if (reviewAction === "approve_w9") {
    patch = { ...patch, w9_status: "approved", tax_profile_status: "approved" };
  } else if (reviewAction === "request_correction") {
    patch = { ...patch, w9_status: "rejected", tax_profile_status: "rejected" };
  } else if (reviewAction === "mark_needs_review") {
    patch = { ...patch, w9_status: "needs_review", tax_profile_status: "needs_review" };
  } else {
    return NextResponse.json({ message: "review_action must be approve_w9, request_correction, or mark_needs_review." }, { status: 400 });
  }

  const { error } = await admin.from("crew").update(patch).eq("id", crewId);
  if (error) throw new Error(error.message);

  return NextResponse.json({
    ok: true,
    crew_id: crewId,
    crew_name: crewName,
    crew_patch: patch,
    message: reviewAction === "approve_w9" ? `${crewName} is marked W-9 ready.` : reviewAction === "request_correction" ? `${crewName} is marked as needing a W-9 correction.` : `${crewName} is marked for W-9 review.`,
  });
}

async function updateCrewDocumentFields(admin: SupabaseAdmin, crewId: string, documentType: OnboardingDocumentType, storagePath: string) {
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { updated_at: nowIso };

  if (documentType === "profile_photo") updatePayload.profile_photo_url = storagePath;
  if (documentType === "w9") {
    updatePayload.w9_document_url = storagePath;
    updatePayload.w9_status = "uploaded";
    updatePayload.tax_profile_status = "needs_review";
  }
  if (documentType === "contract") {
    updatePayload.contract_document_url = storagePath;
    updatePayload.contract_status = "uploaded";
  }
  if (documentType === "work_photo") {
    const { data: currentCrew, error: currentError } = await admin.from("crew").select("work_photo_urls").eq("id", crewId).maybeSingle();
    if (currentError) throw new Error(currentError.message);
    updatePayload.work_photo_urls = mergePathLists((currentCrew as { work_photo_urls?: string[] | null } | null)?.work_photo_urls, [storagePath]);
  }

  if (documentType !== "general") {
    const { error } = await admin.from("crew").update(updatePayload).eq("id", crewId);
    if (error) throw new Error(error.message);
  }

  return updatePayload;
}

async function handleMultipartUpload(request: Request, admin: SupabaseAdmin) {
  const form = await request.formData();
  const action = safeText(form.get("action"));
  const documentType = normalizeDocumentType(form.get("document_type"));
  const fileValue = form.get("file");

  if (!documentType) return NextResponse.json({ message: "Valid document_type is required." }, { status: 400 });
  if (!(fileValue instanceof File) || fileValue.size <= 0) return NextResponse.json({ message: "Please choose a file to upload." }, { status: 400 });

  const config = DOCUMENT_CONFIG[documentType];
  if (fileValue.size > config.maxBytes) return NextResponse.json({ message: `File is too large. Maximum size is ${Math.round(config.maxBytes / 1024 / 1024)} MB.` }, { status: 400 });
  if (!allowedFileType(fileValue, config)) return NextResponse.json({ message: "File type is not allowed for this upload." }, { status: 400 });

  let crewId = "";
  let requestId: string | null = null;
  let source = "admin_profile";
  let uploadedBy: string | null = null;

  if (action === "upload_public_document") {
    const token = safeText(form.get("token"));
    const onboardingRequest = await readValidOnboardingRequest(admin, token);
    if (!onboardingRequest.ok) return onboardingRequest.response;
    crewId = safeText((onboardingRequest.requestRow as { crew_id?: string | null }).crew_id);
    requestId = safeText((onboardingRequest.requestRow as { id?: string | null }).id) || null;
    source = "public_onboarding";

    const status = safeText((onboardingRequest.requestRow as { status?: string | null }).status);
    if (status === "sent") {
      await admin.from("crew_onboarding_requests").update({ status: "opened", opened_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", requestId);
    }
  } else if (action === "admin_upload_document") {
    const auth = await requireOwnerAdmin();
    if (!auth.ok) return auth.response;
    crewId = safeText(form.get("crew_id"));
    uploadedBy = auth.user.id;
    if (!crewId) return NextResponse.json({ message: "crew_id is required." }, { status: 400 });
  } else {
    return NextResponse.json({ message: "Unsupported upload action." }, { status: 400 });
  }

  const storagePath = buildStoragePath(crewId, documentType, fileValue);
  const bytes = Buffer.from(await fileValue.arrayBuffer());

  const upload = await admin.storage.from(config.bucket).upload(storagePath, bytes, {
    contentType: fileValue.type || "application/octet-stream",
    upsert: false,
  });

  if (upload.error) throw new Error(storageSetupMessage(upload.error.message || "Unable to upload file."));

  const crewPatch = await updateCrewDocumentFields(admin, crewId, documentType, storagePath);
  const nowIso = new Date().toISOString();
  const { document, warning } = await recordOnboardingDocument(admin, {
    crew_id: crewId,
    request_id: requestId,
    document_type: documentType,
    bucket_id: config.bucket,
    storage_path: storagePath,
    file_name: safeText(fileValue.name) || null,
    mime_type: safeText(fileValue.type) || null,
    size_bytes: fileValue.size,
    source,
    uploaded_by: uploadedBy,
    created_at: nowIso,
  });

  return NextResponse.json({
    ok: true,
    document_type: documentType,
    bucket: config.bucket,
    path: storagePath,
    crew_patch: crewPatch,
    document,
    warning,
    message: warning || "File uploaded securely.",
  });
}

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("multipart/form-data")) return await handleMultipartUpload(request, admin);

    const body = await request.json();
    const action = safeText(body.action);

    if (action === "create_signed_document_url") {
      return await createSignedDocumentUrl(request, admin, body as Record<string, unknown>);
    }


    if (action === "update_tax_document_review") {
      return await updateTaxDocumentReview(admin, body as Record<string, unknown>);
    }

    if (action === "read_request") {
      const token = safeText(body.token);
      const onboardingRequest = await readValidOnboardingRequest(admin, token);
      if (!onboardingRequest.ok) return onboardingRequest.response;
      const requestRow = onboardingRequest.requestRow;
      const requestType = requestTypeFromRow(requestRow);
      const requestId = safeText((requestRow as { id?: string | null }).id);
      const status = safeText((requestRow as { status?: string | null }).status);
      if (status === "sent" && requestId) {
        await admin.from("crew_onboarding_requests").update({ status: "opened", opened_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", requestId);
      }
      return NextResponse.json({
        ok: true,
        request_type: requestType,
        status: status === "sent" ? "opened" : status,
        expires_at: safeText((requestRow as { expires_at?: string | null }).expires_at) || null,
      });
    }

    if (action === "create_request") {
      const auth = await requireOwnerAdmin();
      if (!auth.ok) return auth.response;

      const crewId = safeText(body.crew_id);
      const requestType = normalizeRequestType(body.request_type ?? body.mode);
      if (!crewId) return NextResponse.json({ message: "crew_id is required." }, { status: 400 });

      const { data: crew, error: crewError } = await admin.from("crew").select("id, name, phone, email").eq("id", crewId).maybeSingle();
      if (crewError) throw new Error(crewError.message);
      if (!crew) return NextResponse.json({ message: "Crew contact not found." }, { status: 404 });

      const token = crypto.randomBytes(32).toString("base64url");
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

      const { data: requestRow, error: requestError } = await admin
        .from("crew_onboarding_requests")
        .insert({ crew_id: crewId, token, status: "sent", sent_by: auth.user.id, sent_at: nowIso, expires_at: expiresAt, submission_payload: { request_type: requestType }, created_at: nowIso, updated_at: nowIso })
        .select("id, crew_id, token, status, sent_at, expires_at")
        .single();

      if (requestError) {
        if ((requestError.message || "").includes("crew_onboarding_requests")) {
          return NextResponse.json({ message: "Run ELS210_required_sql.sql once in Supabase to create crew_onboarding_requests." }, { status: 400 });
        }
        throw new Error(requestError.message);
      }

      const crewStatusPatch = requestType === "w9_only" ? {
        w9_status: "requested",
        tax_profile_status: "requested",
        onboarding_request_sent_at: nowIso,
        updated_at: nowIso,
      } : {
        onboarding_status: "request_sent",
        questionnaire_status: "requested",
        w9_status: "requested",
        contract_status: "requested",
        onboarding_request_sent_at: nowIso,
        updated_at: nowIso,
      };
      await admin.from("crew").update(crewStatusPatch).eq("id", crewId);

      const link = `${appBaseUrl(request)}/onboarding/${token}${requestType === "w9_only" ? "?mode=w9" : ""}`;
      const crewName = safeText((crew as { name?: string | null }).name) || "there";
      const firstName = crewName.split(/\s+/)[0] || "there";
      const phone = cleanPhone((crew as { phone?: string | null }).phone);
      const messageBody = requestType === "w9_only" ? [
        `Hi ${firstName}, this is Storm with Emanuel Labor Services.`,
        "I only need your W-9 for ELS tax/1099 records. Please upload it through this secure link:",
        link,
        "Please do not send your SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
      ].join("\n\n") : [
        `Hi ${firstName}, this is Storm with Emanuel Labor Services.`,
        "Please complete your secure onboarding packet using this link:",
        link,
        "Please do not send your SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
      ].join("\n\n");

      let queued = null as unknown;
      if (phone && body.queue_text !== false) {
        queued = await insertIntroQueue(admin, {
          queued_by_user_id: auth.user.id,
          queued_by_email: auth.user.email || null,
          queued_by_name: auth.user.email || null,
          crew_id: crewId,
          crew_name: crewName,
          phone,
          body: messageBody,
          status: "scheduled",
          scheduled_for: new Date(Date.now() + 30_000).toISOString(),
          created_at: nowIso,
          error: null,
        });
      }

      return NextResponse.json({ ok: true, link, request_type: requestType, request: requestRow, queued, message: queued ? (requestType === "w9_only" ? "W-9 request link created and queued for the iPhone Shortcut." : "Onboarding request link created and queued for the iPhone Shortcut.") : (requestType === "w9_only" ? "W-9 request link created. No text was queued because this contact has no valid phone number." : "Onboarding request link created. No text was queued because this contact has no valid phone number.") });
    }

    if (action === "submit") {
      const token = safeText(body.token);
      const onboardingRequest = await readValidOnboardingRequest(admin, token);
      if (!onboardingRequest.ok) return onboardingRequest.response;
      const requestRow = onboardingRequest.requestRow;
      const requestType = safeText(body.request_type) ? normalizeRequestType(body.request_type) : requestTypeFromRow(requestRow);
      const crewId = safeText((requestRow as { crew_id?: string | null }).crew_id);
      const currentCrewRes = await admin.from("crew").select("notes, work_photo_urls").eq("id", crewId).maybeSingle();
      if (currentCrewRes.error) throw new Error(currentCrewRes.error.message);

      const submittedAt = new Date().toISOString();
      const requestId = safeText((requestRow as { id?: string | null }).id);
      const workPhotoUrls = Array.isArray(body.work_photo_urls) ? body.work_photo_urls.map(safeText).filter(Boolean) : splitList(body.work_photo_urls);
      const w9UseDigital = Boolean(body.w9_use_digital);
      const digitalW9 = sanitizeDigitalW9(body.digital_w9);
      const digitalW9Redacted = w9UseDigital ? redactedDigitalW9(digitalW9) : null;

      if (w9UseDigital) {
        const missing = digitalW9MissingFields(digitalW9);
        if (missing.length) {
          return NextResponse.json({ message: `Please complete the in-app W-9 before submitting. Missing: ${missing.join(", ")}.` }, { status: 400 });
        }
      }

      const payload = {
        request_type: requestType,
        legal_name: safeText(body.legal_name),
        preferred_name: safeText(body.preferred_name),
        phone: safeText(body.phone),
        email: safeText(body.email),
        address: safeText(body.address),
        emergency_contact_name: safeText(body.emergency_contact_name),
        emergency_contact_phone: safeText(body.emergency_contact_phone),
        city_state: safeText(body.city_state),
        positions: splitList(body.positions),
        skills: safeText(body.skills),
        equipment_experience: safeText(body.equipment_experience),
        travel_availability: safeText(body.travel_availability),
        hotel_flight_willing: safeText(body.hotel_flight_willing),
        profile_photo_note: safeText(body.profile_photo_note),
        work_photo_note: safeText(body.work_photo_note),
        w9_status_note: safeText(body.w9_status_note),
        contract_acknowledged: Boolean(body.contract_acknowledged),
        profile_photo_url: safeText(body.profile_photo_url),
        work_photo_urls: workPhotoUrls,
        w9_document_url: safeText(body.w9_document_url),
        contract_document_url: safeText(body.contract_document_url),
        w9_use_digital: w9UseDigital,
        digital_w9: digitalW9Redacted,
        submitted_at: submittedAt,
      };

      const existingNotes = safeText((currentCrewRes.data as { notes?: string | null } | null)?.notes);

      if (requestType === "w9_only") {
        if (!w9UseDigital && !payload.w9_document_url && !payload.w9_status_note) {
          return NextResponse.json({ message: "Please complete the in-app W-9, upload your signed W-9, or add a note before submitting." }, { status: 400 });
        }

        if (w9UseDigital) await saveDigitalW9(admin, crewId, requestId, digitalW9, submittedAt);

        const w9Note = [
          "[[ELS_W9_ONLY_SUBMISSION]]",
          `Submitted: ${payload.submitted_at}`,
          payload.legal_name ? `Legal name: ${payload.legal_name}` : "",
          w9UseDigital ? "Digital substitute W-9 completed in app: yes" : "",
          w9UseDigital ? `TIN: ${digitalW9.tin_type.toUpperCase()} ending ${digitalW9.tin_last4}` : "",
          payload.w9_document_url ? "W-9 uploaded: yes" : "",
          payload.w9_status_note ? `W-9 note: ${payload.w9_status_note}` : "",
          "[[/ELS_W9_ONLY_SUBMISSION]]",
        ].filter(Boolean).join("\n");

        const digitalNotes = w9UseDigital ? digitalW9Notes(digitalW9, submittedAt) : "";
        const updatePayload: Record<string, unknown> = {
          tax_profile_status: "needs_review",
          w9_status: w9UseDigital || payload.w9_document_url ? "uploaded" : "needs_review",
          notes: [existingNotes, w9Note].filter(Boolean).join("\n\n"),
          updated_at: payload.submitted_at,
        };
        if (digitalNotes || payload.legal_name) updatePayload.tax_profile_notes = digitalNotes || `W-9-only request submitted by ${payload.legal_name} on ${payload.submitted_at.slice(0, 10)}.`;
        if (payload.w9_document_url) updatePayload.w9_document_url = payload.w9_document_url;

        const { error: updateError } = await admin.from("crew").update(updatePayload).eq("id", crewId);
        if (updateError) throw new Error(updateError.message);

        const { error: requestUpdateError } = await admin.from("crew_onboarding_requests").update({ status: "submitted", submitted_at: payload.submitted_at, submission_payload: payload, updated_at: payload.submitted_at }).eq("id", requestId);
        if (requestUpdateError) throw new Error(requestUpdateError.message);

        const audit = await admin.from("crew_onboarding_audit_log").insert({ crew_id: crewId, action: "w9_only_submitted", details: payload, created_at: payload.submitted_at });
        if (audit.error && !(audit.error.message || "").includes("crew_onboarding_audit_log")) throw new Error(audit.error.message);

        return NextResponse.json({ ok: true, message: "W-9 submitted securely. Emanuel Labor Services will review it for tax records." });
      }

      if (w9UseDigital) await saveDigitalW9(admin, crewId, requestId, digitalW9, submittedAt);

      const onboardingNote = [
        "[[ELS_ONBOARDING_SUBMISSION]]",
        `Submitted: ${payload.submitted_at}`,
        payload.legal_name ? `Legal name: ${payload.legal_name}` : "",
        payload.preferred_name ? `Preferred name: ${payload.preferred_name}` : "",
        payload.city_state ? `City/State: ${payload.city_state}` : "",
        payload.emergency_contact_name || payload.emergency_contact_phone ? `Emergency contact: ${[payload.emergency_contact_name, payload.emergency_contact_phone].filter(Boolean).join(" - ")}` : "",
        payload.positions.length ? `Requested positions: ${payload.positions.join(", ")}` : "",
        payload.travel_availability ? `Travel availability: ${payload.travel_availability}` : "",
        payload.hotel_flight_willing ? `Hotel/flight willingness: ${payload.hotel_flight_willing}` : "",
        payload.skills ? `Skills: ${payload.skills}` : "",
        payload.equipment_experience ? `Equipment: ${payload.equipment_experience}` : "",
        payload.profile_photo_url ? "Profile photo uploaded: yes" : "",
        payload.work_photo_urls.length ? `Work photos uploaded: ${payload.work_photo_urls.length}` : "",
        w9UseDigital ? "Digital substitute W-9 completed in app: yes" : "",
        w9UseDigital ? `TIN: ${digitalW9.tin_type.toUpperCase()} ending ${digitalW9.tin_last4}` : "",
        payload.w9_document_url ? "W-9 uploaded: yes" : "",
        payload.contract_document_url ? "Contract uploaded: yes" : "",
        payload.profile_photo_note ? `Profile photo note: ${payload.profile_photo_note}` : "",
        payload.work_photo_note ? `Work photo note: ${payload.work_photo_note}` : "",
        payload.w9_status_note ? `W-9 note: ${payload.w9_status_note}` : "",
        payload.contract_acknowledged ? "Contract acknowledgement: checked" : "",
        "[[/ELS_ONBOARDING_SUBMISSION]]",
      ].filter(Boolean).join("\n");

      const existingWorkPhotos = (currentCrewRes.data as { work_photo_urls?: string[] | null } | null)?.work_photo_urls;
      const updatePayload: Record<string, unknown> = {
        onboarding_status: "submitted",
        questionnaire_status: "uploaded",
        tax_profile_status: w9UseDigital || payload.w9_document_url || payload.w9_status_note ? "needs_review" : "missing",
        onboarding_completed_at: payload.submitted_at,
        notes: [existingNotes, onboardingNote].filter(Boolean).join("\n\n"),
        updated_at: payload.submitted_at,
      };
      if (payload.phone) updatePayload.phone = payload.phone;
      if (payload.email) updatePayload.email = payload.email;
      if (payload.address) updatePayload.address = payload.address;
      if (payload.profile_photo_url) updatePayload.profile_photo_url = payload.profile_photo_url;
      if (payload.work_photo_urls.length) updatePayload.work_photo_urls = mergePathLists(existingWorkPhotos, payload.work_photo_urls);
      if (w9UseDigital) {
        updatePayload.w9_status = "uploaded";
        updatePayload.tax_profile_notes = digitalW9Notes(digitalW9, submittedAt);
      }
      if (payload.w9_document_url) {
        updatePayload.w9_document_url = payload.w9_document_url;
        updatePayload.w9_status = "uploaded";
      } else if (payload.w9_status_note && !w9UseDigital) {
        updatePayload.w9_status = "needs_review";
      }
      if (payload.contract_document_url) {
        updatePayload.contract_document_url = payload.contract_document_url;
        updatePayload.contract_status = "uploaded";
      } else if (payload.contract_acknowledged) {
        updatePayload.contract_status = "needs_review";
      }

      const { error: updateError } = await admin.from("crew").update(updatePayload).eq("id", crewId);
      if (updateError) throw new Error(updateError.message);

      const { error: requestUpdateError } = await admin.from("crew_onboarding_requests").update({ status: "submitted", submitted_at: payload.submitted_at, submission_payload: payload, updated_at: payload.submitted_at }).eq("id", safeText((requestRow as { id?: string | null }).id));
      if (requestUpdateError) throw new Error(requestUpdateError.message);

      const audit = await admin.from("crew_onboarding_audit_log").insert({ crew_id: crewId, action: "onboarding_submitted", details: payload, created_at: payload.submitted_at });
      if (audit.error && !(audit.error.message || "").includes("crew_onboarding_audit_log")) throw new Error(audit.error.message);

      return NextResponse.json({ ok: true, message: "Onboarding submitted. Emanuel Labor Services will review your information." });
    }

    return NextResponse.json({ message: "Unsupported onboarding action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to process onboarding request." }, { status: 400 });
  }
}
