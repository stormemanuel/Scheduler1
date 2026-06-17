import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase-server";

export const runtime = "nodejs";

type SupabaseAdmin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type OnboardingDocumentType =
  | "profile_photo"
  | "work_photo"
  | "w9"
  | "contract"
  | "general";
type OnboardingRequestType = "full_onboarding" | "w9_only" | "contract_only";

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
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    allowedMimePrefixes: ["image/"],
  },
  work_photo: {
    bucket: "crew-work-photos",
    folder: "work-photos",
    maxBytes: 8 * 1024 * 1024,
    allowedMimeTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    allowedMimePrefixes: ["image/"],
  },
  w9: {
    bucket: "crew-w9-documents",
    folder: "w9",
    maxBytes: 20 * 1024 * 1024,
    allowedMimeTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    allowedMimePrefixes: ["image/"],
  },
  contract: {
    bucket: "crew-contracts",
    folder: "contracts",
    maxBytes: 20 * 1024 * 1024,
    allowedMimeTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
    allowedMimePrefixes: ["image/"],
  },
  general: {
    bucket: "crew-onboarding-documents",
    folder: "general",
    maxBytes: 20 * 1024 * 1024,
    allowedMimeTypes: [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ],
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
  line_3b_checked: boolean;
  tin_type: "ssn" | "ein";
  tin_digits: string;
  tin_last4: string;
  signer_name: string;
  signature_data_url: string;
  certification_confirmed: boolean;
};

type OwnerTaxProfilePayload = Omit<
  DigitalW9Payload,
  "signature_data_url" | "certification_confirmed"
> & {
  signature_verified_from_w9: boolean;
  certification_verified_from_w9: boolean;
};

type ContractSignaturePayload = {
  contractor_name: string;
  effective_date: string;
  signature_data_url: string;
  certifications: boolean[];
  agreement_confirmed: boolean;
};

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

function cleanDigits(value: unknown) {
  return safeText(value).replace(/\D/g, "");
}

function normalizeTinType(value: unknown): "ssn" | "ein" {
  return safeText(value).toLowerCase() === "ein" ? "ein" : "ssn";
}

function sanitizeDigitalW9(value: unknown): DigitalW9Payload {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const tinDigits = cleanDigits(source.tin);
  return {
    tax_legal_name: safeText(source.tax_legal_name),
    business_name: safeText(source.business_name),
    federal_tax_classification:
      safeText(source.federal_tax_classification) || "individual",
    llc_tax_classification: safeText(source.llc_tax_classification),
    other_classification: safeText(source.other_classification),
    exempt_payee_code: safeText(source.exempt_payee_code),
    fatca_code: safeText(source.fatca_code),
    tax_address_line_1: safeText(source.tax_address_line_1),
    tax_city_state_zip: safeText(source.tax_city_state_zip),
    account_numbers: safeText(source.account_numbers),
    line_3b_checked: Boolean(source.line_3b_checked),
    tin_type: normalizeTinType(source.tin_type),
    tin_digits: tinDigits,
    tin_last4: tinDigits.slice(-4),
    signer_name: safeText(source.signer_name),
    signature_data_url: safeText(source.signature_data_url),
    certification_confirmed: Boolean(source.certification_confirmed),
  };
}

function sanitizeOwnerTaxProfile(value: unknown): OwnerTaxProfilePayload {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const tinDigits = cleanDigits(source.tin);
  return {
    tax_legal_name: safeText(source.tax_legal_name),
    business_name: safeText(source.business_name),
    federal_tax_classification:
      safeText(source.federal_tax_classification) || "individual",
    llc_tax_classification: safeText(source.llc_tax_classification),
    other_classification: safeText(source.other_classification),
    exempt_payee_code: safeText(source.exempt_payee_code),
    fatca_code: safeText(source.fatca_code),
    tax_address_line_1: safeText(source.tax_address_line_1),
    tax_city_state_zip: safeText(source.tax_city_state_zip),
    account_numbers: safeText(source.account_numbers),
    line_3b_checked: Boolean(source.line_3b_checked),
    tin_type: normalizeTinType(source.tin_type),
    tin_digits: tinDigits,
    tin_last4: tinDigits.slice(-4),
    signer_name: safeText(source.signer_name),
    signature_verified_from_w9: Boolean(source.signature_verified_from_w9),
    certification_verified_from_w9: Boolean(
      source.certification_verified_from_w9,
    ),
  };
}

function sanitizeContractSignature(
  value: unknown,
  fallbackName: string,
): ContractSignaturePayload {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawCertifications = Array.isArray(source.certifications)
    ? source.certifications
    : [];
  const certifications = CONTRACT_CERTIFICATIONS.map((_, index) =>
    Boolean(rawCertifications[index]),
  );
  return {
    contractor_name:
      safeText(source.contractor_name) || safeText(fallbackName),
    effective_date: safeText(source.effective_date) || new Date().toISOString().slice(0, 10),
    signature_data_url: safeText(source.signature_data_url),
    certifications,
    agreement_confirmed: Boolean(source.agreement_confirmed),
  };
}

function contractMissingFields(contract: ContractSignaturePayload) {
  const missing: string[] = [];
  if (!contract.contractor_name) missing.push("contractor legal name");
  if (!contract.effective_date) missing.push("contract effective date");
  if (
    !contract.signature_data_url ||
    !contract.signature_data_url.startsWith("data:image/")
  )
    missing.push("contract electronic signature");
  if (contract.signature_data_url.length > 750_000)
    missing.push("contract signature is too large; clear and sign again");
  if (!contract.agreement_confirmed) missing.push("agreement confirmation");
  if (contract.certifications.some((checked) => !checked))
    missing.push("all Appendix A certifications");
  return missing;
}

function redactedContractSignature(contract: ContractSignaturePayload) {
  return {
    contractor_name: contract.contractor_name,
    effective_date: contract.effective_date,
    certifications: contract.certifications,
    agreement_confirmed: contract.agreement_confirmed,
    signature_captured: Boolean(contract.signature_data_url),
  };
}

function contractSignatureNotes(
  contract: ContractSignaturePayload,
  submittedAt: string,
) {
  return [
    `Independent Contractor Agreement digitally signed in ELS on ${submittedAt.slice(0, 10)}.`,
    `Contractor name: ${contract.contractor_name}`,
    `Effective date: ${contract.effective_date}`,
    `Appendix A certifications checked: ${contract.certifications.filter(Boolean).length}/${CONTRACT_CERTIFICATIONS.length}`,
    "Owner review/countersignature may still be required before final approval.",
  ].join("\n");
}


function pdfEscape(value: string) {
  return safeText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ");
}

function wrapPdfText(text: string, maxChars: number) {
  const words = pdfEscape(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function initialsFromName(name: string) {
  const parts = name
    .replace(/[^a-zA-Z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const initials = parts
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "IC";
}

const ELS_COMPANY_REPRESENTATIVE = "Storm Leigh";

function buildSignedContractPdf(
  contract: ContractSignaturePayload,
  submittedAt: string,
  fallbackName: string,
  fallbackMainCity = "",
) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const bottom = 54;
  let y = pageHeight - margin;
  let content = "";
  const pages: string[] = [];

  function textLine(text: string, x: number, lineY: number, size = 10, font = "F1") {
    content += `BT /${font} ${size} Tf ${x} ${lineY} Td (${pdfEscape(text)}) Tj ET\n`;
  }

  function newPage() {
    if (content.trim()) pages.push(content);
    content = "";
    y = pageHeight - margin;
  }

  function ensure(space = 18) {
    if (y - space < bottom) newPage();
  }

  function line(text: string, size = 10, font = "F1", gap = 13) {
    ensure(gap + 4);
    textLine(text, margin, y, size, font);
    y -= gap;
  }

  function heading(text: string) {
    ensure(28);
    y -= 4;
    textLine(text, margin, y, 12, "F2");
    y -= 16;
  }

  function paragraph(text: string) {
    for (const wrapped of wrapPdfText(text, 96)) line(wrapped, 9.3, "F1", 12);
    y -= 4;
  }

  const contractorDisplayName = contract.contractor_name || fallbackName;
  const contractorInitials = initialsFromName(contractorDisplayName);
  const companySignedDate = submittedAt.slice(0, 10) || contract.effective_date;

  function checkbox(checked: boolean, text: string) {
    line(`${checked ? `[${contractorInitials}]` : "[   ]"} ${text}`, 9.4, "F1", 13);
  }

  line("INDEPENDENT CONTRACTOR AGREEMENT", 16, "F2", 22);
  paragraph(
    `This Independent Contractor Agreement (Agreement) is made and entered into on ${contract.effective_date}, by and between Emanuel Labor Services LLC, a Louisiana limited liability company (the Company), and ${contractorDisplayName} (the Contractor).`,
  );
  paragraph(
    "WHEREAS, the Company desires to contract with the Contractor for the performance of certain labor and staffing services; and WHEREAS, the Contractor represents that they operate an independent business, have complied with all federal, state, and local laws regarding business permits and licenses, and certify to the statements listed in Appendix A; NOW, THEREFORE, in consideration of the mutual promises contained herein, the Parties agree as follows:",
  );
  heading("1. Services to Be Performed");
  paragraph("Contractor shall provide temporary labor or staffing services on a per-job basis. Contractor retains full control over how services are performed, subject to Company's right to inspect work and ensure compliance with client requirements and industry standards.");
  heading("2. Payment");
  paragraph("Company shall compensate Contractor for all hours worked at agreed-upon rates. Contractor shall submit an invoice detailing services rendered. Payment shall be made within thirty (30) days of receipt of an approved invoice. If payments are scheduled beyond thirty days, Contractor shall be notified and must agree to payment terms before accepting the contract.");
  heading("3. Term & Termination");
  paragraph("This Agreement shall commence on the Effective Date and shall continue until terminated by either Party. Either Party may terminate this Agreement with five (5) days' prior written notice, except in cases of immediate termination due to breach, safety violations, or conflicts of interest. This Agreement terminates immediately upon the death of the Contractor.");
  heading("4. Instrumentalities/Tools/Supplies");
  paragraph("Contractor shall provide their own tools, equipment, and materials unless otherwise agreed upon in writing. If the Company agrees in writing to reimburse certain expenses, Contractor must submit appropriate documentation with the invoice.");
  heading("5. Compliance with Client Requirements");
  paragraph("Contractor shall comply with any specific project requirements set forth by the Company's clients, including but not limited to background checks, security clearances, drug testing, or other venue policies.");
  heading("6. Conflicts of Interest and Immediate Notification");
  paragraph("Contractor shall not engage in any activity that conflicts with the Company's interests and must immediately disclose any potential conflicts, safety concerns, or security issues.");
  heading("7. Independent Contractor Status & Insurance");
  paragraph("Contractor is an independent contractor and not an employee of the Company. Contractor shall obtain and maintain all necessary workers' compensation, general liability, and other required insurance at their own expense. Contractor must provide proof of insurance upon request.");
  heading("8. Taxes & Benefits");
  paragraph("Contractor is responsible for all federal, state, and local taxes, including but not limited to income tax, Social Security, Medicare, and unemployment taxes. Company shall not provide any employment benefits, including health insurance, retirement, or workers' compensation.");
  heading("9. Confidential Information");
  paragraph("Contractor shall not disclose, use, or exploit the Company's proprietary information, trade secrets, client lists, or operational methods. Any breach of confidentiality may result in legal action, including injunctive relief.");
  heading("10. Work Quality and Professionalism");
  paragraph("Contractor agrees to maintain a high standard of professionalism, including punctuality, appropriate attire, and respectful conduct toward clients and colleagues. Contractor must complete assignments professionally and in accordance with industry standards.");
  heading("11. Dispute Resolution & Arbitration");
  paragraph("Any disputes arising under this Agreement shall be resolved through binding arbitration in New Orleans, Louisiana, in accordance with the Federal Arbitration Act. No class-action or collective arbitration shall be permitted. The prevailing party shall be entitled to recover reasonable attorney's fees and costs.");
  heading("12. Indemnification");
  paragraph("Contractor shall fully indemnify and hold harmless the Company, its agents, and employees from any claims, demands, liabilities, or damages arising from Contractor's services, including but not limited to injury claims, contract breaches with clients or tax obligations. This indemnification applies even after termination of the Agreement and is not limited by insurance coverage.");
  heading("13. Non-Solicitation");
  paragraph("Contractor agrees that for a period of one (1) year after termination of this Agreement, they shall not solicit or work directly for the Company's clients in a manner that bypasses the Company's involvement.");
  heading("14. Notices");
  paragraph("All notices must be in writing and delivered personally, via certified mail, or by electronic means that provide proof of delivery.");
  heading("15. Governing Law");
  paragraph("This Agreement shall be governed by and construed in accordance with the laws of the State of Louisiana.");
  heading("16. Entire Agreement & Severability");
  paragraph("This Agreement represents the entire understanding between the Parties and supersedes any prior agreements. If any provision is found invalid, the remainder shall remain in full force and effect.");
  heading("APPENDIX A: CERTIFICATION OF INDEPENDENT CONTRACTOR STATUS");
  CONTRACT_CERTIFICATIONS.forEach((cert, index) => checkbox(Boolean(contract.certifications[index]), cert));
  y -= 10;
  ensure(90);
  line("Contractor Electronic Signature", 11, "F2", 15);
  textLine(contractorDisplayName, margin + 1, y - 17, 40, "F4");
  textLine(contractorDisplayName, margin, y - 18, 40, "F4");
  y -= 56;
  line(`Contractor name: ${contractorDisplayName}`, 9.5, "F1", 13);
  line(`Contractor initials applied to Appendix A: ${contractorInitials}`, 9.5, "F1", 13);
  line(`Date signed: ${contract.effective_date}`, 9.5, "F1", 13);
  line(`Submitted through ELS secure onboarding: ${submittedAt}`, 8.5, "F1", 12);
  y -= 12;
  ensure(90);
  line("Company Representative Electronic Signature", 11, "F2", 15);
  textLine(ELS_COMPANY_REPRESENTATIVE, margin + 1, y - 17, 40, "F4");
  textLine(ELS_COMPANY_REPRESENTATIVE, margin, y - 18, 40, "F4");
  y -= 56;
  line(`Company representative: ${ELS_COMPANY_REPRESENTATIVE}`, 9.5, "F1", 13);
  line(`Date countersigned: ${companySignedDate}`, 9.5, "F1", 13);
  line("ELS company signature applied automatically for onboarding recordkeeping.", 8.5, "F1", 12);

  if (content.trim()) pages.push(content);

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_, index) => 7 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /ZapfChancery-MediumItalic >>");

  pages.forEach((pageContent, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(pageContent, "binary")} >>\nstream\n${pageContent}endstream`);
  });

  let pdf = "%PDF-1.4\n%ELS\n";
  const offsets: number[] = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

async function saveGeneratedContractPdf(
  admin: SupabaseAdmin,
  crewId: string,
  requestId: string,
  contract: ContractSignaturePayload,
  submittedAt: string,
  fallbackName: string,
  fallbackMainCity = "",
) {
  const pdf = buildSignedContractPdf(contract, submittedAt, fallbackName);
  const driveArchive = await archivePdfToGoogleDrive(admin, crewId, "contract", pdf, "signed-independent-contractor-agreement.pdf", contract.contractor_name || fallbackName, fallbackMainCity).catch(() => null);
  if (driveArchive) {
    await recordOnboardingDocument(admin, {
      crew_id: crewId,
      request_id: requestId || null,
      document_type: "contract",
      bucket_id: "google-drive",
      storage_path: driveArchive.storagePath,
      file_name: "signed-independent-contractor-agreement.pdf",
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      source: "public_onboarding_google_drive",
    });
    return driveArchive.storagePath;
  }

  const config = DOCUMENT_CONFIG.contract;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.randomBytes(6).toString("hex");
  const storagePath = `${cleanStorageSegment(crewId)}/${config.folder}/${stamp}-${nonce}-signed-independent-contractor-agreement.pdf`;
  const upload = await admin.storage.from(config.bucket).upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upload.error) throw new Error(storageSetupMessage(upload.error.message));
  await recordOnboardingDocument(admin, {
    crew_id: crewId,
    request_id: requestId || null,
    document_type: "contract",
    bucket_id: config.bucket,
    storage_path: storagePath,
    file_name: "signed-independent-contractor-agreement.pdf",
    mime_type: "application/pdf",
    size_bytes: pdf.byteLength,
    source: "public_onboarding",
  });
  return storagePath;
}

function ownerTaxProfileMissingFields(w9: OwnerTaxProfilePayload) {
  const missing: string[] = [];
  if (!w9.tax_legal_name) missing.push("legal tax name");
  if (!w9.tax_address_line_1) missing.push("tax mailing address");
  if (!w9.tax_city_state_zip) missing.push("city/state/ZIP");
  if (w9.tin_digits.length !== 9) missing.push("9-digit SSN/EIN");
  if (!w9.signer_name) missing.push("signer name");
  if (!w9.signature_verified_from_w9)
    missing.push("signature verified from W-9 file");
  if (!w9.certification_verified_from_w9)
    missing.push("certification verified from W-9 file");
  return missing;
}

function digitalW9MissingFields(w9: DigitalW9Payload) {
  const missing: string[] = [];
  if (!w9.tax_legal_name) missing.push("legal tax name");
  if (!w9.tax_address_line_1) missing.push("tax mailing address");
  if (!w9.tax_city_state_zip) missing.push("city/state/ZIP");
  if (w9.tin_digits.length !== 9) missing.push("9-digit SSN/EIN");
  if (!w9.signer_name) missing.push("signer name");
  if (
    !w9.signature_data_url ||
    !w9.signature_data_url.startsWith("data:image/")
  )
    missing.push("electronic signature");
  if (!w9.certification_confirmed) missing.push("certification checkbox");
  if (w9.signature_data_url.length > 750_000)
    missing.push("signature file is too large; clear and sign again");
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
    line_3b_checked: w9.line_3b_checked,
    tin_type: w9.tin_type,
    tin_last4: w9.tin_last4,
    signer_name: w9.signer_name,
    certification_confirmed: w9.certification_confirmed,
    signature_captured: Boolean(w9.signature_data_url),
  };
}

function tinEncryptionKey() {
  const material =
    process.env.W9_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET ||
    "";
  if (!material)
    throw new Error(
      "W-9 encryption is not configured. Add W9_ENCRYPTION_KEY in Vercel, or make sure SUPABASE_SERVICE_ROLE_KEY is set.",
    );
  return crypto.createHash("sha256").update(material).digest();
}

function encryptTin(tinDigits: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", tinEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(tinDigits, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `aes-256-gcm:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function digitalW9Notes(w9: DigitalW9Payload, submittedAt: string) {
  return [
    `Digital substitute W-9 submitted in ELS on ${submittedAt.slice(0, 10)}.`,
    `Tax legal name: ${w9.tax_legal_name}`,
    w9.business_name ? `Business name: ${w9.business_name}` : "",
    `Tax classification: ${w9.federal_tax_classification}${w9.llc_tax_classification ? ` (${w9.llc_tax_classification})` : ""}`,
    w9.line_3b_checked ? "Line 3b checked: yes" : "Line 3b checked: no",
    `TIN type: ${w9.tin_type.toUpperCase()} ending ${w9.tin_last4}`,
    `Signed by: ${w9.signer_name}`,
    "Owner review required before approving for 1099 filing.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function saveDigitalW9(
  admin: SupabaseAdmin,
  crewId: string,
  requestId: string,
  w9: DigitalW9Payload,
  submittedAt: string,
) {
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

  const result = await admin
    .from("crew_tax_profiles")
    .upsert(row, { onConflict: "crew_id" })
    .select("id")
    .single();
  if (result.error) {
    const message = result.error.message || "";
    if (/crew_tax_profiles|schema cache|column|relation/i.test(message)) {
      throw new Error(
        "Digital W-9 storage is not ready. Run ELS218_required_sql.sql in Supabase, then try again.",
      );
    }
    throw new Error(message);
  }
  return result.data;
}

async function saveOwnerTaxProfile(
  admin: SupabaseAdmin,
  crewId: string,
  w9: OwnerTaxProfilePayload,
  submittedAt: string,
) {
  const row = {
    crew_id: crewId,
    request_id: null,
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
    signature_data_url: "verified_from_uploaded_w9_file",
    certification_confirmed: w9.certification_verified_from_w9,
    signed_at: submittedAt,
    source: "owner_tax_center_verified_from_w9_file",
    updated_at: submittedAt,
  };

  const result = await admin
    .from("crew_tax_profiles")
    .upsert(row, { onConflict: "crew_id" })
    .select("id")
    .single();
  if (result.error) {
    const message = result.error.message || "";
    if (/crew_tax_profiles|schema cache|column|relation/i.test(message)) {
      throw new Error(
        "Tax profile storage is not ready. Run ELS218_required_sql.sql in Supabase, then try again.",
      );
    }
    throw new Error(message);
  }
  return result.data;
}

function normalizeRole(role: string | null | undefined) {
  const value = String(role || "viewer")
    .toLowerCase()
    .trim();
  if (
    ["owner", "admin", "coordinator", "salesman", "sales", "viewer"].includes(
      value,
    )
  )
    return value === "sales" ? "salesman" : value;
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
  return safeText(value)
    .split(/\n|,|;/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listValues(value: unknown) {
  return Array.isArray(value) ? value.map(safeText).filter(Boolean) : splitList(value);
}

function phoneDigits(value: unknown) {
  return safeText(value).replace(/\D/g, "");
}

function composeHomeAddress(source: Record<string, unknown>) {
  const line1 = safeText(source.home_address_line1 || source.address);
  const city = safeText(source.home_city);
  const state = safeText(source.home_state).toUpperCase();
  const zip = safeText(source.home_zip);
  const cityStateZip = [city, state].filter(Boolean).join(", ") + (zip ? `${city || state ? " " : ""}${zip}` : "");
  return [line1, cityStateZip].filter(Boolean).join(", ");
}

async function cityPoolNameById(admin: SupabaseAdmin, poolId: string) {
  if (!poolId) return "";
  const { data } = await admin.from("city_pools").select("name").eq("id", poolId).maybeSingle();
  return safeText((data as { name?: string | null } | null)?.name);
}

function appBaseUrl(request: Request) {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";
  if (envUrl)
    return envUrl.startsWith("http")
      ? envUrl.replace(/\/+$/, "")
      : `https://${envUrl.replace(/\/+$/, "")}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function normalizeDocumentType(value: unknown): OnboardingDocumentType | null {
  const normalized = safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, "")
    .replace(/[ -]+/g, "_");
  if (
    ["profile_photo", "work_photo", "w9", "contract", "general"].includes(
      normalized,
    )
  )
    return normalized as OnboardingDocumentType;
  return null;
}

function normalizeRequestType(value: unknown): OnboardingRequestType {
  const normalized = safeText(value)
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

function requestTypeFromRow(row: unknown): OnboardingRequestType {
  const payload = (row as { submission_payload?: unknown } | null)
    ?.submission_payload;
  if (payload && typeof payload === "object") {
    return normalizeRequestType(
      (payload as { request_type?: unknown }).request_type,
    );
  }
  return "full_onboarding";
}

function cleanStorageSegment(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "file"
  );
}

function extensionForFile(file: File) {
  const original = safeText(file.name).split(".").pop()?.toLowerCase() || "";
  if (/^[a-z0-9]{2,8}$/.test(original))
    return original === "jpeg" ? "jpg" : original;
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

function buildStoragePath(
  crewId: string,
  documentType: OnboardingDocumentType,
  file: File,
) {
  const config = DOCUMENT_CONFIG[documentType];
  const ext = extensionForFile(file);
  const originalBase = cleanStorageSegment(
    safeText(file.name).replace(/\.[^.]+$/, ""),
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.randomBytes(6).toString("hex");
  return `${cleanStorageSegment(crewId)}/${config.folder}/${stamp}-${nonce}-${originalBase}.${ext}`;
}

function storageSetupMessage(errorMessage: string) {
  if (
    /bucket|storage|not found|does not exist|schema cache/i.test(errorMessage)
  ) {
    return "Upload storage is not ready. Run ELS211_required_sql.sql once in Supabase, then try again.";
  }
  return errorMessage;
}

function isGoogleDrivePath(value: unknown) {
  return /^gdrive:/i.test(safeText(value)) || /^google-drive:/i.test(safeText(value));
}

function googleDriveFileId(value: unknown) {
  const text = safeText(value);
  if (/^gdrive:/i.test(text)) return text.replace(/^gdrive:/i, "").trim();
  if (/^google-drive:/i.test(text)) return text.replace(/^google-drive:/i, "").trim();
  return "";
}

function googleDriveConfig() {
  return {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "",
    tokenKey: process.env.GOOGLE_CALENDAR_TOKEN_KEY || process.env.W9_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    archiveUserId: process.env.GOOGLE_DRIVE_ARCHIVE_USER_ID || "",
    archiveFolderId: process.env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID || "",
  };
}

function googleDriveReady() {
  const config = googleDriveConfig();
  return Boolean(config.clientId && config.clientSecret && config.tokenKey);
}

function googleDriveTokenKey() {
  const config = googleDriveConfig();
  if (!config.tokenKey) throw new Error("GOOGLE_CALENDAR_TOKEN_KEY or SUPABASE_SERVICE_ROLE_KEY is required for Google Drive document archive.");
  return crypto.createHash("sha256").update(config.tokenKey).digest();
}

function decryptGoogleStoredToken(value: string) {
  const [ivText, tagText, encryptedText] = String(value || "").split(":");
  if (!ivText || !tagText || !encryptedText) throw new Error("Stored Google token is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", googleDriveTokenKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64")), decipher.final()]).toString("utf8");
}

async function googleDriveFetchJson<T>(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorData = data as { error_description?: string; error?: { message?: string } | string };
    const message = safeText(errorData.error_description || (typeof errorData.error === "string" ? errorData.error : errorData.error?.message) || `Google Drive request failed (${res.status}).`);
    throw new Error(message);
  }
  return data as T;
}

async function refreshGoogleDriveAccessToken(refreshToken: string) {
  const config = googleDriveConfig();
  return googleDriveFetchJson<{ access_token: string }>("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
}

async function getGoogleDriveArchiveAccess(admin: SupabaseAdmin) {
  if (!googleDriveReady()) return null;
  const config = googleDriveConfig();

  type GoogleArchiveConnection = { user_id: string; account_email?: string | null; refresh_token_encrypted: string };
  let connection: GoogleArchiveConnection | null = null;
  if (config.archiveUserId) {
    const { data, error } = await admin
      .from("google_calendar_connections")
      .select("user_id, account_email, refresh_token_encrypted, updated_at")
      .eq("user_id", config.archiveUserId)
      .maybeSingle();
    if (error) throw new Error(error.message.includes("google_calendar_connections") ? "Run ELS229_required_sql.sql, then connect Google from the app before using Google Drive archive." : error.message);
    connection = data as GoogleArchiveConnection | null;
  }

  if (!connection) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, role")
      .in("role", ["owner", "admin"]);
    const ownerAdminIds = (profiles || []).map((row) => safeText((row as { id?: string | null }).id)).filter(Boolean);
    let query = admin
      .from("google_calendar_connections")
      .select("user_id, account_email, refresh_token_encrypted, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (ownerAdminIds.length) query = query.in("user_id", ownerAdminIds);
    const { data, error } = await query;
    if (error) throw new Error(error.message.includes("google_calendar_connections") ? "Run ELS229_required_sql.sql, then connect Google from the app before using Google Drive archive." : error.message);
    connection = ((data || [])[0] as GoogleArchiveConnection | undefined) || null;
  }

  if (!connection?.refresh_token_encrypted) return null;
  const refreshToken = decryptGoogleStoredToken(connection.refresh_token_encrypted);
  const token = await refreshGoogleDriveAccessToken(refreshToken);
  if (!token.access_token) throw new Error("Google did not return a Drive access token.");
  return { accessToken: token.access_token, accountEmail: connection.account_email || null, userId: connection.user_id };
}

function escapeDriveQuery(value: string) {
  return safeText(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findDriveFolder(accessToken: string, name: string, parentId?: string) {
  const parts = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${escapeDriveQuery(name)}'`,
    "trashed = false",
  ];
  if (parentId) parts.push(`'${escapeDriveQuery(parentId)}' in parents`);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", parts.join(" and "));
  url.searchParams.set("fields", "files(id,name)");
  url.searchParams.set("pageSize", "1");
  const data = await googleDriveFetchJson<{ files?: Array<{ id: string; name: string }> }>(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data.files?.[0]?.id || "";
}

async function createDriveFolder(accessToken: string, name: string, parentId?: string) {
  const data = await googleDriveFetchJson<{ id: string }>("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return data.id;
}

async function findOrCreateDriveFolder(accessToken: string, name: string, parentId?: string) {
  return (await findDriveFolder(accessToken, name, parentId)) || (await createDriveFolder(accessToken, name, parentId));
}

function cleanDriveFileName(value: string) {
  return cleanStorageSegment(value).replace(/-/g, " ").replace(/\s+/g, " ").trim() || "Crew";
}

async function driveCrewFolderId(
  admin: SupabaseAdmin,
  accessToken: string,
  crewId: string,
  fallbackName?: string,
  fallbackMainCity?: string,
) {
  const config = googleDriveConfig();
  const rootId = config.archiveFolderId || (await findOrCreateDriveFolder(accessToken, "ELS Onboarding"));
  let crewName = safeText(fallbackName);
  let mainCity = safeText(fallbackMainCity);
  if (!crewName || !mainCity) {
    const { data } = await admin.from("crew").select("name, phone, city_pool_id, other_city").eq("id", crewId).maybeSingle();
    const typed = data as { name?: string | null; phone?: string | null; city_pool_id?: string | null; other_city?: string | null } | null;
    crewName = crewName || safeText(typed?.name) || safeText(typed?.phone) || crewId;
    mainCity = mainCity || (typed?.city_pool_id ? await cityPoolNameById(admin, safeText(typed.city_pool_id)) : "") || safeText(typed?.other_city);
  }
  const cityFolderId = await findOrCreateDriveFolder(accessToken, cleanDriveFileName(mainCity || "Unassigned City"), rootId);
  const crewFolderId = await findOrCreateDriveFolder(accessToken, cleanDriveFileName(crewName || crewId), cityFolderId);
  return findOrCreateDriveFolder(accessToken, "Onboarding Documents", crewFolderId);
}

async function uploadBufferToDrive(accessToken: string, metadata: Record<string, unknown>, bytes: Buffer, mimeType: string) {
  const boundary = `els_${crypto.randomBytes(12).toString("hex")}`;
  const delimiter = `--${boundary}\r\n`;
  const nextDelimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`),
    Buffer.from(`${nextDelimiter}Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    bytes,
    Buffer.from(closeDelimiter),
  ]);
  return googleDriveFetchJson<{ id: string; name?: string; webViewLink?: string; webContentLink?: string; mimeType?: string }>("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,mimeType", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  });
}

async function archivePdfToGoogleDrive(
  admin: SupabaseAdmin,
  crewId: string,
  documentType: "w9" | "contract",
  bytes: Buffer,
  fileName: string,
  fallbackCrewName?: string,
  fallbackMainCity?: string,
) {
  const drive = await getGoogleDriveArchiveAccess(admin).catch(() => null);
  if (!drive) return null;
  const folderId = await driveCrewFolderId(admin, drive.accessToken, crewId, fallbackCrewName, fallbackMainCity);
  const label = documentType === "w9" ? "W-9" : "Independent Contractor Agreement";
  const datedName = `${label} - ${cleanDriveFileName(fallbackCrewName || crewId)} - ${new Date().toISOString().slice(0, 10)}.pdf`;
  const uploaded = await uploadBufferToDrive(
    drive.accessToken,
    { name: fileName.endsWith(".pdf") ? datedName : fileName, parents: [folderId], mimeType: "application/pdf" },
    bytes,
    "application/pdf",
  );
  return { storagePath: `gdrive:${uploaded.id}`, fileId: uploaded.id, webViewLink: uploaded.webViewLink || null, accountEmail: drive.accountEmail };
}

async function archiveUploadedDocumentToGoogleDrive(
  admin: SupabaseAdmin,
  crewId: string,
  documentType: OnboardingDocumentType,
  file: File,
  bytes: Buffer,
  fallbackCrewName?: string,
  fallbackMainCity?: string,
) {
  if (documentType !== "w9" && documentType !== "contract") return null;
  if ((file.type || "").toLowerCase() !== "application/pdf") return null;
  const drive = await getGoogleDriveArchiveAccess(admin).catch(() => null);
  if (!drive) return null;
  const folderId = await driveCrewFolderId(admin, drive.accessToken, crewId, fallbackCrewName, fallbackMainCity);
  const label = documentType === "w9" ? "W-9" : "Independent Contractor Agreement";
  const original = safeText(file.name) || `${label}.pdf`;
  const uploaded = await uploadBufferToDrive(
    drive.accessToken,
    { name: `${label} - ${new Date().toISOString().slice(0, 10)} - ${cleanDriveFileName(original)}`.slice(0, 180), parents: [folderId], mimeType: "application/pdf" },
    bytes,
    "application/pdf",
  );
  return { storagePath: `gdrive:${uploaded.id}`, fileId: uploaded.id, webViewLink: uploaded.webViewLink || null, accountEmail: drive.accountEmail };
}

async function deleteDriveFileIfPossible(admin: SupabaseAdmin, storagePath: string) {
  const fileId = googleDriveFileId(storagePath);
  if (!fileId) return false;
  const drive = await getGoogleDriveArchiveAccess(admin).catch(() => null);
  if (!drive) return false;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${drive.accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    const message = safeText((data as { error?: { message?: string } }).error?.message || `Unable to delete Google Drive file (${res.status}).`);
    throw new Error(message);
  }
  return true;
}

async function streamGoogleDriveFile(request: Request, admin: SupabaseAdmin) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const crewId = safeText(url.searchParams.get("crew_id"));
  const documentType = normalizeDocumentType(url.searchParams.get("document_type"));
  const storagePath = normalizeStoredPath(url.searchParams.get("storage_path"), "google-drive");
  const download = url.searchParams.get("download") === "1";
  if (!crewId || !documentType || !isGoogleDrivePath(storagePath)) {
    return NextResponse.json({ message: "Valid crew_id, document_type, and Google Drive storage_path are required." }, { status: 400 });
  }
  const belongs = await storagePathBelongsToCrew(admin, crewId, documentType, storagePath);
  if (!belongs) return NextResponse.json({ message: "That Google Drive file is not attached to this crew profile." }, { status: 403 });
  const drive = await getGoogleDriveArchiveAccess(admin);
  if (!drive) return NextResponse.json({ message: "Google Drive archive is not connected." }, { status: 400 });
  const fileId = googleDriveFileId(storagePath);
  const metadata = await googleDriveFetchJson<{ name?: string; mimeType?: string }>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType`, {
    headers: { Authorization: `Bearer ${drive.accessToken}` },
  });
  const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${drive.accessToken}` },
  });
  if (!fileRes.ok) {
    const data = await fileRes.json().catch(() => ({}));
    return NextResponse.json({ message: safeText((data as { error?: { message?: string } }).error?.message || "Unable to open Google Drive file.") }, { status: fileRes.status });
  }
  const arrayBuffer = await fileRes.arrayBuffer();
  const fileName = cleanStorageSegment(metadata.name || `${documentType}.pdf`) || `${documentType}.pdf`;
  return new NextResponse(arrayBuffer, {
    headers: {
      "Content-Type": metadata.mimeType || "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function requireOwnerAdmin() {
  const supabase = await createSupabaseServerClient();
  if (!supabase)
    return {
      ok: false as const,
      response: NextResponse.json(
        { message: "Supabase is not configured." },
        { status: 500 },
      ),
    };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      ok: false as const,
      response: NextResponse.json(
        { message: "Unauthorized." },
        { status: 401 },
      ),
    };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = normalizeRole(
    (profile as { role?: string | null } | null)?.role,
  );
  if (!isOwnerAdmin(role))
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          message:
            "Only owner/admin can create onboarding links or upload private onboarding documents.",
        },
        { status: 403 },
      ),
    };
  return { ok: true as const, user };
}

async function readValidOnboardingRequest(admin: SupabaseAdmin, token: string) {
  if (!token)
    return {
      ok: false as const,
      response: NextResponse.json(
        { message: "Missing onboarding token." },
        { status: 400 },
      ),
    };
  const { data: requestRow, error } = await admin
    .from("crew_onboarding_requests")
    .select("id, crew_id, status, expires_at, submission_payload")
    .eq("token", token)
    .maybeSingle();
  if (error) {
    if ((error.message || "").includes("crew_onboarding_requests"))
      return {
        ok: false as const,
        response: NextResponse.json(
          {
            message:
              "Onboarding requests table is missing. Run ELS210_required_sql.sql.",
          },
          { status: 400 },
        ),
      };
    throw new Error(error.message);
  }
  if (!requestRow)
    return {
      ok: false as const,
      response: NextResponse.json(
        { message: "This onboarding link is invalid." },
        { status: 404 },
      ),
    };
  const status = safeText((requestRow as { status?: string | null }).status);
  if (status === "cancelled")
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          message:
            "This onboarding link was cancelled. Please ask ELS for a new link.",
        },
        { status: 410 },
      ),
    };
  if (status === "expired")
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          message:
            "This onboarding link has expired. Please ask ELS for a new link.",
        },
        { status: 410 },
      ),
    };
  const expiresAt = safeText(
    (requestRow as { expires_at?: string | null }).expires_at,
  );
  if (expiresAt && new Date(expiresAt).getTime() < Date.now())
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          message:
            "This onboarding link has expired. Please ask ELS for a new link.",
        },
        { status: 410 },
      ),
    };
  return { ok: true as const, requestRow };
}

async function insertIntroQueue(
  admin: SupabaseAdmin,
  row: Record<string, unknown>,
) {
  const withSender = await admin
    .from("crew_intro_text_queue")
    .insert(row)
    .select(
      "id, crew_id, crew_name, phone, body, status, scheduled_for, created_at",
    )
    .single();
  if (!withSender.error) return withSender.data;
  const message = withSender.error.message || "";
  if (
    !(
      message.includes("queued_by_user_id") ||
      message.includes("queued_by_email") ||
      message.includes("queued_by_name") ||
      message.includes("schema cache")
    )
  )
    throw new Error(message);
  const { queued_by_user_id, queued_by_email, queued_by_name, ...legacyRow } =
    row;
  const legacy = await admin
    .from("crew_intro_text_queue")
    .insert(legacyRow)
    .select(
      "id, crew_id, crew_name, phone, body, status, scheduled_for, created_at",
    )
    .single();
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data;
}

async function recordOnboardingDocument(
  admin: SupabaseAdmin,
  row: Record<string, unknown>,
) {
  const result = await admin
    .from("crew_onboarding_documents")
    .insert(row)
    .select("id, document_type, bucket_id, storage_path, created_at")
    .single();
  if (!result.error)
    return { document: result.data, warning: null as string | null };
  const message = result.error.message || "";
  if (/crew_onboarding_documents|schema cache|column/i.test(message)) {
    return {
      document: null,
      warning:
        "File uploaded and saved to the crew profile, but document history is not fully set up. Run ELS211_required_sql.sql to enable crew_onboarding_documents tracking.",
    };
  }
  throw new Error(message);
}

function mergePathLists(existing: unknown, incoming: string[]) {
  const current = Array.isArray(existing)
    ? existing.map(safeText).filter(Boolean)
    : [];
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
  if (isGoogleDrivePath(path)) return path;
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
  return (
    Array.isArray(list) && list.map(safeText).some((item) => item === path)
  );
}

async function storagePathBelongsToCrew(
  admin: SupabaseAdmin,
  crewId: string,
  documentType: OnboardingDocumentType,
  storagePath: string,
) {
  const { data: crew, error: crewError } = await admin
    .from("crew")
    .select(
      "profile_photo_url, work_photo_urls, w9_document_url, contract_document_url",
    )
    .eq("id", crewId)
    .maybeSingle();
  if (crewError) throw new Error(crewError.message);
  if (!crew) return false;

  const typed = crew as {
    profile_photo_url?: string | null;
    work_photo_urls?: string[] | null;
    w9_document_url?: string | null;
    contract_document_url?: string | null;
  };
  if (
    documentType === "profile_photo" &&
    safeText(typed.profile_photo_url) === storagePath
  )
    return true;
  if (
    documentType === "work_photo" &&
    pathInList(typed.work_photo_urls, storagePath)
  )
    return true;
  if (documentType === "w9" && safeText(typed.w9_document_url) === storagePath)
    return true;
  if (
    documentType === "contract" &&
    safeText(typed.contract_document_url) === storagePath
  )
    return true;

  const documentRes = await admin
    .from("crew_onboarding_documents")
    .select("id")
    .eq("crew_id", crewId)
    .eq("document_type", documentType)
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (!documentRes.error && documentRes.data) return true;
  const message = documentRes.error?.message || "";
  if (/crew_onboarding_documents|schema cache|relation/i.test(message))
    return false;
  if (documentRes.error) throw new Error(message);
  return false;
}

async function createSignedDocumentUrl(
  request: Request,
  admin: SupabaseAdmin,
  body: Record<string, unknown>,
) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const crewId = safeText(body.crew_id);
  const documentType = normalizeDocumentType(body.document_type);
  if (!crewId)
    return NextResponse.json(
      { message: "crew_id is required." },
      { status: 400 },
    );
  if (!documentType)
    return NextResponse.json(
      { message: "Valid document_type is required." },
      { status: 400 },
    );

  const config = DOCUMENT_CONFIG[documentType];
  const storagePath = normalizeStoredPath(body.storage_path, config.bucket);
  if (!storagePath)
    return NextResponse.json(
      { message: "storage_path is required." },
      { status: 400 },
    );

  const belongs = await storagePathBelongsToCrew(
    admin,
    crewId,
    documentType,
    storagePath,
  );
  if (!belongs) {
    return NextResponse.json(
      { message: "That private file is not attached to this crew profile." },
      { status: 403 },
    );
  }

  if (isGoogleDrivePath(storagePath)) {
    const url = new URL("/api/onboarding", appBaseUrl(request));
    url.searchParams.set("action", "open_drive_file");
    url.searchParams.set("crew_id", crewId);
    url.searchParams.set("document_type", documentType);
    url.searchParams.set("storage_path", storagePath);
    if (Boolean(body.download)) url.searchParams.set("download", "1");
    return NextResponse.json({
      ok: true,
      document_type: documentType,
      bucket: "google-drive",
      path: storagePath,
      signed_url: url.toString(),
      expires_in_seconds: 600,
      message: "Secure Google Drive file link created.",
    });
  }

  const signed = await admin.storage
    .from(config.bucket)
    .createSignedUrl(storagePath, 60 * 10, {
      download: Boolean(body.download),
    });
  if (signed.error)
    throw new Error(
      storageSetupMessage(
        signed.error.message || "Unable to create secure file link.",
      ),
    );

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

async function updateTaxDocumentReview(
  admin: SupabaseAdmin,
  body: Record<string, unknown>,
) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const crewId = safeText(body.crew_id);
  const reviewAction = safeText(body.review_action).toLowerCase();
  const incomingNotes = safeText(body.notes);
  if (!crewId)
    return NextResponse.json(
      { message: "crew_id is required." },
      { status: 400 },
    );

  const { data: existingCrew, error: existingError } = await admin
    .from("crew")
    .select("id, name, tax_profile_notes")
    .eq("id", crewId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existingCrew)
    return NextResponse.json(
      { message: "Crew contact not found." },
      { status: 404 },
    );

  const currentNotes = safeText(
    (existingCrew as { tax_profile_notes?: string | null }).tax_profile_notes,
  );
  const crewName =
    safeText((existingCrew as { name?: string | null }).name) || "crew member";
  const stamp = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
  });
  const notePrefix =
    reviewAction === "approve_w9"
      ? "W-9 approved"
      : reviewAction === "request_correction"
        ? "W-9 correction requested"
        : "W-9 marked for review";
  const reviewNote = incomingNotes
    ? `${stamp}: ${notePrefix} — ${incomingNotes}`
    : `${stamp}: ${notePrefix}`;
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
    patch = {
      ...patch,
      w9_status: "needs_review",
      tax_profile_status: "needs_review",
    };
  } else {
    return NextResponse.json(
      {
        message:
          "review_action must be approve_w9, request_correction, or mark_needs_review.",
      },
      { status: 400 },
    );
  }

  const { error } = await admin.from("crew").update(patch).eq("id", crewId);
  if (error) throw new Error(error.message);

  return NextResponse.json({
    ok: true,
    crew_id: crewId,
    crew_name: crewName,
    crew_patch: patch,
    message:
      reviewAction === "approve_w9"
        ? `${crewName} is marked W-9 ready.`
        : reviewAction === "request_correction"
          ? `${crewName} is marked as needing a W-9 correction.`
          : `${crewName} is marked for W-9 review.`,
  });
}

async function updateCrewDocumentFields(
  admin: SupabaseAdmin,
  crewId: string,
  documentType: OnboardingDocumentType,
  storagePath: string,
) {
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = { updated_at: nowIso };

  if (documentType === "profile_photo")
    updatePayload.profile_photo_url = storagePath;
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
    const { data: currentCrew, error: currentError } = await admin
      .from("crew")
      .select("work_photo_urls")
      .eq("id", crewId)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    updatePayload.work_photo_urls = mergePathLists(
      (currentCrew as { work_photo_urls?: string[] | null } | null)
        ?.work_photo_urls,
      [storagePath],
    );
  }

  if (documentType !== "general") {
    const { error } = await admin
      .from("crew")
      .update(updatePayload)
      .eq("id", crewId);
    if (error) throw new Error(error.message);
  }

  return updatePayload;
}

async function handleMultipartUpload(request: Request, admin: SupabaseAdmin) {
  const form = await request.formData();
  const action = safeText(form.get("action"));
  const documentType = normalizeDocumentType(form.get("document_type"));
  const fileValue = form.get("file");

  if (!documentType)
    return NextResponse.json(
      { message: "Valid document_type is required." },
      { status: 400 },
    );
  if (!(fileValue instanceof File) || fileValue.size <= 0)
    return NextResponse.json(
      { message: "Please choose a file to upload." },
      { status: 400 },
    );
  if (documentType === "work_photo")
    return NextResponse.json(
      { message: "Work photos are no longer part of ELS onboarding. Upload only the required profile photo, W-9, and contractor agreement." },
      { status: 400 },
    );

  const config = DOCUMENT_CONFIG[documentType];
  if (fileValue.size > config.maxBytes)
    return NextResponse.json(
      {
        message: `File is too large. Maximum size is ${Math.round(config.maxBytes / 1024 / 1024)} MB.`,
      },
      { status: 400 },
    );
  if (!allowedFileType(fileValue, config))
    return NextResponse.json(
      { message: "File type is not allowed for this upload." },
      { status: 400 },
    );

  let crewId = "";
  let requestId: string | null = null;
  let source = "admin_profile";
  let uploadedBy: string | null = null;

  if (action === "upload_public_document") {
    const token = safeText(form.get("token"));
    const onboardingRequest = await readValidOnboardingRequest(admin, token);
    if (!onboardingRequest.ok) return onboardingRequest.response;
    crewId = safeText(
      (onboardingRequest.requestRow as { crew_id?: string | null }).crew_id,
    );
    requestId =
      safeText((onboardingRequest.requestRow as { id?: string | null }).id) ||
      null;
    source = "public_onboarding";

    const status = safeText(
      (onboardingRequest.requestRow as { status?: string | null }).status,
    );
    if (status === "sent") {
      await admin
        .from("crew_onboarding_requests")
        .update({
          status: "opened",
          opened_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);
    }
  } else if (action === "admin_upload_document") {
    const auth = await requireOwnerAdmin();
    if (!auth.ok) return auth.response;
    crewId = safeText(form.get("crew_id"));
    uploadedBy = auth.user.id;
    if (!crewId)
      return NextResponse.json(
        { message: "crew_id is required." },
        { status: 400 },
      );
  } else {
    return NextResponse.json(
      { message: "Unsupported upload action." },
      { status: 400 },
    );
  }

  const uploadCrewName = safeText(form.get("crew_name"));
  const uploadPrimaryCityPoolId = safeText(form.get("primary_city_pool_id"));
  const uploadMainCity = uploadPrimaryCityPoolId ? await cityPoolNameById(admin, uploadPrimaryCityPoolId) : "";
  const bytes = Buffer.from(await fileValue.arrayBuffer());
  let storagePath = "";
  let bucketId = config.bucket;
  let archiveWarning: string | null = null;

  const driveArchive = await archiveUploadedDocumentToGoogleDrive(admin, crewId, documentType, fileValue, bytes, uploadCrewName, uploadMainCity).catch((error) => {
    archiveWarning = error instanceof Error ? error.message : "Google Drive archive failed; saved to Supabase instead.";
    return null;
  });

  if (driveArchive) {
    storagePath = driveArchive.storagePath;
    bucketId = "google-drive";
  } else {
    storagePath = buildStoragePath(crewId, documentType, fileValue);
    const upload = await admin.storage
      .from(config.bucket)
      .upload(storagePath, bytes, {
        contentType: fileValue.type || "application/octet-stream",
        upsert: false,
      });

    if (upload.error)
      throw new Error(
        storageSetupMessage(upload.error.message || "Unable to upload file."),
      );
  }

  const crewPatch = await updateCrewDocumentFields(
    admin,
    crewId,
    documentType,
    storagePath,
  );
  const nowIso = new Date().toISOString();
  const { document, warning } = await recordOnboardingDocument(admin, {
    crew_id: crewId,
    request_id: requestId,
    document_type: documentType,
    bucket_id: bucketId,
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
    bucket: bucketId,
    path: storagePath,
    crew_patch: crewPatch,
    document,
    warning: warning || archiveWarning,
    message: warning || archiveWarning || (bucketId === "google-drive" ? "File archived securely in Google Drive." : "File uploaded securely."),
  });
}


function taxClassLabel(value: string, llcClass?: string, otherClass?: string) {
  const normalized = safeText(value);
  if (normalized === "individual") return "Individual/sole proprietor or single-member LLC";
  if (normalized === "c_corporation") return "C Corporation";
  if (normalized === "s_corporation") return "S Corporation";
  if (normalized === "partnership") return "Partnership";
  if (normalized === "trust_estate") return "Trust/estate";
  if (normalized === "llc") return `Limited liability company${llcClass ? ` (${llcClass})` : ""}`;
  if (normalized === "other") return `Other${otherClass ? `: ${otherClass}` : ""}`;
  return normalized || "Not provided";
}

function formatTinForPdf(digits: string, type: "ssn" | "ein") {
  const clean = cleanDigits(digits).slice(0, 9);
  if (type === "ein") return clean.length > 2 ? `${clean.slice(0, 2)}-${clean.slice(2)}` : clean;
  if (clean.length <= 3) return clean;
  if (clean.length <= 5) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  return `${clean.slice(0, 3)}-${clean.slice(3, 5)}-${clean.slice(5)}`;
}

function buildDigitalW9Pdf(w9: DigitalW9Payload, submittedAt: string) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 42;
  const bottom = 42;
  let y = pageHeight - margin;
  let content = "";
  const pages: string[] = [];

  function textLine(text: string, x: number, lineY: number, size = 10, font = "F1") {
    content += `BT /${font} ${size} Tf ${x} ${lineY} Td (${pdfEscape(text)}) Tj ET\n`;
  }
  function drawLine(x1: number, y1: number, x2: number, y2: number) {
    content += `${x1} ${y1} m ${x2} ${y2} l S\n`;
  }
  function drawRect(x: number, rectY: number, w: number, h: number) {
    content += `${x} ${rectY} ${w} ${h} re S\n`;
  }
  function newPage() {
    if (content.trim()) pages.push(content);
    content = "";
    y = pageHeight - margin;
  }
  function ensure(space = 18) {
    if (y - space < bottom) newPage();
  }
  function line(text: string, size = 10, font = "F1", gap = 13) {
    ensure(gap + 4);
    textLine(text, margin, y, size, font);
    y -= gap;
  }
  function wrapped(text: string, maxChars = 100, size = 9.2, gap = 11) {
    for (const part of wrapPdfText(text, maxChars)) line(part, size, "F1", gap);
  }
  function field(label: string, value: string, height = 34) {
    ensure(height + 10);
    drawRect(margin, y - height + 4, pageWidth - margin * 2, height);
    textLine(label, margin + 8, y - 10, 8.5, "F2");
    textLine(value || "", margin + 8, y - 25, 11, "F1");
    y -= height + 6;
  }
  function checkbox(checked: boolean, label: string) {
    ensure(18);
    drawRect(margin, y - 10, 10, 10);
    if (checked) textLine("X", margin + 2, y - 9, 9, "F2");
    textLine(label, margin + 16, y - 8, 9.3, "F1");
    y -= 15;
  }

  line("SUBSTITUTE FORM W-9", 18, "F2", 20);
  line("Request for Taxpayer Identification Number and Certification", 12, "F2", 16);
  wrapped("This electronic substitute Form W-9 was completed through Emanuel Labor Services secure onboarding. It is retained by Emanuel Labor Services for information return reporting records and is not sent to the IRS as a W-9.", 105, 9, 11);
  y -= 4;
  field("1. Name as shown on income tax return", w9.tax_legal_name);
  field("2. Business name/disregarded entity name, if different", w9.business_name);
  field("3a. Federal tax classification", taxClassLabel(w9.federal_tax_classification, w9.llc_tax_classification, w9.other_classification));
  checkbox(w9.line_3b_checked, "3b. Partnership/trust/estate has foreign partners, owners, or beneficiaries");
  field("4. Exemptions", [w9.exempt_payee_code ? `Exempt payee code: ${w9.exempt_payee_code}` : "", w9.fatca_code ? `FATCA code: ${w9.fatca_code}` : ""].filter(Boolean).join(" • "));
  field("5. Address", w9.tax_address_line_1);
  field("6. City, state, and ZIP code", w9.tax_city_state_zip);
  field("7. Account number(s), optional", w9.account_numbers);

  line("Part I - Taxpayer Identification Number (TIN)", 12, "F2", 16);
  field(w9.tin_type === "ein" ? "Employer identification number" : "Social security number", formatTinForPdf(w9.tin_digits, w9.tin_type));

  line("Part II - Certification", 12, "F2", 16);
  wrapped("Under penalties of perjury, I certify that: (1) The number shown on this form is my correct taxpayer identification number; (2) I am not subject to backup withholding because I am exempt from backup withholding, I have not been notified by the IRS that I am subject to backup withholding, or the IRS has notified me that I am no longer subject to backup withholding; (3) I am a U.S. citizen or other U.S. person; and (4) The FATCA code entered on this form, if any, indicating that I am exempt from FATCA reporting is correct.", 100, 9, 11);
  wrapped("The IRS does not require consent to any provision of this document other than the certifications required to avoid backup withholding.", 100, 9, 11);
  y -= 8;
  ensure(90);
  drawLine(margin, y - 36, margin + 260, y - 36);
  textLine(w9.signer_name, margin + 5, y - 25, 38, "F4");
  textLine(w9.signer_name, margin + 4, y - 26, 38, "F4");
  textLine("Electronic signature of U.S. person", margin, y - 50, 8.5, "F1");
  drawLine(margin + 310, y - 36, margin + 500, y - 36);
  textLine(submittedAt.slice(0, 10), margin + 314, y - 26, 11, "F1");
  textLine("Date", margin + 310, y - 50, 8.5, "F1");
  y -= 76;
  wrapped(`Submission audit: signed electronically by ${w9.signer_name} through ELS secure onboarding on ${submittedAt}. TIN type ${w9.tin_type.toUpperCase()} ending ${w9.tin_last4}.`, 100, 8.5, 10);

  if (content.trim()) pages.push(content);

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_, index) => 7 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /ZapfChancery-MediumItalic >>");

  pages.forEach((pageContent, index) => {
    const pageId = pageObjectIds[index];
    const contentId = pageId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(pageContent, "binary")} >>\nstream\n${pageContent}endstream`);
  });

  let pdf = "%PDF-1.4\n%ELS-W9\n";
  const offsets: number[] = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, "binary"));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

async function saveGeneratedW9Pdf(
  admin: SupabaseAdmin,
  crewId: string,
  requestId: string,
  w9: DigitalW9Payload,
  submittedAt: string,
  fallbackMainCity = "",
) {
  const pdf = buildDigitalW9Pdf(w9, submittedAt);
  const driveArchive = await archivePdfToGoogleDrive(admin, crewId, "w9", pdf, "digital-substitute-w9.pdf", w9.tax_legal_name, fallbackMainCity).catch(() => null);
  if (driveArchive) {
    await recordOnboardingDocument(admin, {
      crew_id: crewId,
      request_id: requestId || null,
      document_type: "w9",
      bucket_id: "google-drive",
      storage_path: driveArchive.storagePath,
      file_name: "digital-substitute-w9.pdf",
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      source: "public_onboarding_digital_w9_google_drive",
      created_at: submittedAt,
    });
    return driveArchive.storagePath;
  }

  const config = DOCUMENT_CONFIG.w9;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.randomBytes(6).toString("hex");
  const storagePath = `${cleanStorageSegment(crewId)}/${config.folder}/${stamp}-${nonce}-digital-substitute-w9.pdf`;
  const upload = await admin.storage.from(config.bucket).upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upload.error) throw new Error(storageSetupMessage(upload.error.message));
  await recordOnboardingDocument(admin, {
    crew_id: crewId,
    request_id: requestId || null,
    document_type: "w9",
    bucket_id: config.bucket,
    storage_path: storagePath,
    file_name: "digital-substitute-w9.pdf",
    mime_type: "application/pdf",
    size_bytes: pdf.byteLength,
    source: "public_onboarding_digital_w9",
    created_at: submittedAt,
  });
  return storagePath;
}

function getPayloadObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function removePathFromPayload(payload: Record<string, unknown>, documentType: OnboardingDocumentType, storagePath: string) {
  const next = { ...payload };
  if (documentType === "profile_photo" && safeText(next.profile_photo_url) === storagePath) next.profile_photo_url = "";
  if (documentType === "w9" && safeText(next.w9_document_url) === storagePath) next.w9_document_url = "";
  if (documentType === "contract" && safeText(next.contract_document_url) === storagePath) next.contract_document_url = "";
  if (documentType === "work_photo") {
    next.work_photo_urls = Array.isArray(next.work_photo_urls)
      ? next.work_photo_urls.map(safeText).filter((path) => path && path !== storagePath)
      : [];
  }
  return next;
}

function removePathFromCrewPatch(existingCrew: Record<string, unknown>, documentType: OnboardingDocumentType, storagePath: string) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (documentType === "profile_photo" && safeText(existingCrew.profile_photo_url) === storagePath) patch.profile_photo_url = null;
  if (documentType === "w9" && safeText(existingCrew.w9_document_url) === storagePath) {
    patch.w9_document_url = null;
    patch.w9_status = "needs_review";
  }
  if (documentType === "contract" && safeText(existingCrew.contract_document_url) === storagePath) {
    patch.contract_document_url = null;
    patch.contract_status = "needs_review";
  }
  if (documentType === "work_photo") {
    const nextPhotos = Array.isArray(existingCrew.work_photo_urls)
      ? existingCrew.work_photo_urls.map(safeText).filter((path) => path && path !== storagePath)
      : [];
    patch.work_photo_urls = nextPhotos;
  }
  return patch;
}

async function deleteOnboardingDocument(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const crewId = safeText(body.crew_id);
  const requestId = safeText(body.request_id);
  const documentType = normalizeDocumentType(body.document_type);
  if (!crewId) return NextResponse.json({ message: "crew_id is required." }, { status: 400 });
  if (!documentType) return NextResponse.json({ message: "Valid document_type is required." }, { status: 400 });
  const config = DOCUMENT_CONFIG[documentType];
  const storagePath = normalizeStoredPath(body.storage_path, config.bucket);
  if (!storagePath) return NextResponse.json({ message: "storage_path is required." }, { status: 400 });

  const belongs = await storagePathBelongsToCrew(admin, crewId, documentType, storagePath);
  if (!belongs) return NextResponse.json({ message: "That private file is not attached to this crew profile." }, { status: 403 });

  const crewRes = await admin
    .from("crew")
    .select("id, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, onboarding_status, questionnaire_status, w9_status, tax_profile_status, contract_status")
    .eq("id", crewId)
    .maybeSingle();
  if (crewRes.error) throw new Error(crewRes.error.message);
  if (!crewRes.data) return NextResponse.json({ message: "Crew contact not found." }, { status: 404 });

  if (isGoogleDrivePath(storagePath)) {
    await deleteDriveFileIfPossible(admin, storagePath);
  } else {
    const remove = await admin.storage.from(config.bucket).remove([storagePath]);
    if (remove.error) {
      const message = remove.error.message || "Unable to remove file.";
      if (!/not found/i.test(message)) throw new Error(storageSetupMessage(message));
    }
  }

  const crewPatch = removePathFromCrewPatch(crewRes.data as Record<string, unknown>, documentType, storagePath);
  if (Object.keys(crewPatch).length > 1) {
    const updateCrew = await admin.from("crew").update(crewPatch).eq("id", crewId);
    if (updateCrew.error) throw new Error(updateCrew.error.message);
  }

  const historyDelete = await admin
    .from("crew_onboarding_documents")
    .delete()
    .eq("crew_id", crewId)
    .eq("document_type", documentType)
    .eq("storage_path", storagePath);
  const historyMessage = historyDelete.error?.message || "";
  if (historyDelete.error && !/crew_onboarding_documents|schema cache|relation/i.test(historyMessage)) {
    throw new Error(historyMessage);
  }

  let requestPayload: Record<string, unknown> | null = null;
  if (requestId) {
    const requestRes = await admin
      .from("crew_onboarding_requests")
      .select("id, submission_payload")
      .eq("id", requestId)
      .maybeSingle();
    if (requestRes.error) throw new Error(requestRes.error.message);
    if (requestRes.data) {
      requestPayload = removePathFromPayload(getPayloadObject((requestRes.data as Record<string, unknown>).submission_payload), documentType, storagePath);
      const updateRequest = await admin
        .from("crew_onboarding_requests")
        .update({ submission_payload: requestPayload, updated_at: new Date().toISOString() })
        .eq("id", requestId);
      if (updateRequest.error) throw new Error(updateRequest.error.message);
    }
  }

  return NextResponse.json({
    ok: true,
    crew_id: crewId,
    request_id: requestId || null,
    document_type: documentType,
    removed_path: storagePath,
    crew_patch: crewPatch,
    payload: requestPayload,
    message: "File removed from this onboarding record.",
  });
}


async function deleteOnboardingSubmission(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const requestId = safeText(body.request_id);
  if (!requestId) return NextResponse.json({ message: "request_id is required." }, { status: 400 });

  const requestRes = await admin
    .from("crew_onboarding_requests")
    .select("id, crew_id, status, submission_payload")
    .eq("id", requestId)
    .maybeSingle();
  if (requestRes.error) throw new Error(requestRes.error.message);
  if (!requestRes.data) return NextResponse.json({ message: "Onboarding submission not found." }, { status: 404 });

  const requestRow = requestRes.data as Record<string, unknown>;
  const status = safeText(requestRow.status);
  if (status === "approved") {
    return NextResponse.json(
      { message: "Approved onboarding packets cannot be deleted from here. Remove individual files or update the crew profile instead." },
      { status: 400 },
    );
  }

  const crewId = safeText(requestRow.crew_id);
  const payload = getPayloadObject(requestRow.submission_payload);
  const requestType = normalizeRequestType(payload.request_type);
  const documentItems: Array<{ type: OnboardingDocumentType; path: string }> = [];
  const profilePhoto = safeText(payload.profile_photo_url);
  const w9Document = safeText(payload.w9_document_url);
  const contractDocument = safeText(payload.contract_document_url);
  const workPhotos = Array.isArray(payload.work_photo_urls)
    ? payload.work_photo_urls.map(safeText).filter(Boolean)
    : [];
  if (profilePhoto) documentItems.push({ type: "profile_photo", path: profilePhoto });
  if (w9Document) documentItems.push({ type: "w9", path: w9Document });
  if (contractDocument) documentItems.push({ type: "contract", path: contractDocument });
  for (const path of workPhotos) documentItems.push({ type: "work_photo", path });

  const crewRes = await admin
    .from("crew")
    .select("id, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, onboarding_status")
    .eq("id", crewId)
    .maybeSingle();
  if (crewRes.error) throw new Error(crewRes.error.message);
  if (!crewRes.data) return NextResponse.json({ message: "Crew contact not found." }, { status: 404 });

  const crewPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const existingCrew = crewRes.data as Record<string, unknown>;
  if (profilePhoto && safeText(existingCrew.profile_photo_url) === normalizeStoredPath(profilePhoto, DOCUMENT_CONFIG.profile_photo.bucket)) crewPatch.profile_photo_url = null;
  if (w9Document && safeText(existingCrew.w9_document_url) === normalizeStoredPath(w9Document, DOCUMENT_CONFIG.w9.bucket)) {
    crewPatch.w9_document_url = null;
    crewPatch.w9_status = "missing";
    crewPatch.tax_profile_status = "missing";
  }
  if (contractDocument && safeText(existingCrew.contract_document_url) === normalizeStoredPath(contractDocument, DOCUMENT_CONFIG.contract.bucket)) {
    crewPatch.contract_document_url = null;
    crewPatch.contract_status = "missing";
  }
  if (workPhotos.length) {
    const removeSet = new Set(workPhotos.map((path) => normalizeStoredPath(path, DOCUMENT_CONFIG.work_photo.bucket)));
    crewPatch.work_photo_urls = Array.isArray(existingCrew.work_photo_urls)
      ? existingCrew.work_photo_urls.map(safeText).filter((path) => path && !removeSet.has(path))
      : [];
  }
  const currentOnboardingStatus = safeText(existingCrew.onboarding_status);
  const currentQuestionnaireStatus = safeText(existingCrew.questionnaire_status);
  const currentW9Status = safeText(existingCrew.w9_status);
  const currentTaxProfileStatus = safeText(existingCrew.tax_profile_status);
  const currentContractStatus = safeText(existingCrew.contract_status);
  if (requestType === "full_onboarding") {
    if (currentOnboardingStatus !== "approved") crewPatch.onboarding_status = "not_started";
    if (currentQuestionnaireStatus !== "approved") crewPatch.questionnaire_status = "missing";
  }
  if (requestType !== "contract_only" && currentW9Status !== "approved" && currentTaxProfileStatus !== "approved") {
    crewPatch.w9_status = "missing";
    crewPatch.tax_profile_status = "missing";
  }
  if (requestType !== "w9_only" && currentContractStatus !== "approved") {
    crewPatch.contract_status = "missing";
  }

  if (Object.keys(crewPatch).length > 1) {
    const crewUpdate = await admin.from("crew").update(crewPatch).eq("id", crewId);
    if (crewUpdate.error) throw new Error(crewUpdate.error.message);
  }

  const removedFiles: string[] = [];
  for (const item of documentItems) {
    const config = DOCUMENT_CONFIG[item.type];
    const storagePath = normalizeStoredPath(item.path, config.bucket);
    if (!storagePath) continue;
    if (isGoogleDrivePath(storagePath)) {
      await deleteDriveFileIfPossible(admin, storagePath);
      removedFiles.push(`google-drive/${storagePath}`);
      continue;
    }
    const remove = await admin.storage.from(config.bucket).remove([storagePath]);
    if (remove.error) {
      const message = remove.error.message || "Unable to remove file.";
      if (!/not found/i.test(message)) throw new Error(storageSetupMessage(message));
    }
    removedFiles.push(`${config.bucket}/${storagePath}`);
  }

  const historyDelete = await admin
    .from("crew_onboarding_documents")
    .delete()
    .eq("request_id", requestId);
  const historyMessage = historyDelete.error?.message || "";
  if (historyDelete.error && !/crew_onboarding_documents|schema cache|relation|request_id/i.test(historyMessage)) {
    throw new Error(historyMessage);
  }

  const taxDelete = await admin
    .from("crew_tax_profiles")
    .delete()
    .eq("request_id", requestId);
  const taxMessage = taxDelete.error?.message || "";
  if (taxDelete.error && !/crew_tax_profiles|schema cache|relation|request_id/i.test(taxMessage)) {
    throw new Error(taxMessage);
  }

  const requestDelete = await admin
    .from("crew_onboarding_requests")
    .delete()
    .eq("id", requestId);
  if (requestDelete.error) {
    const message = requestDelete.error.message || "";
    if (/row-level security|permission|violates/i.test(message)) {
      const fallback = await admin
        .from("crew_onboarding_requests")
        .update({
          status: "deleted",
          submission_payload: {
            ...payload,
            owner_deleted_at: new Date().toISOString(),
            owner_deleted_by: auth.user.email || auth.user.id,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);
      if (fallback.error) throw new Error(fallback.error.message);
    } else {
      throw new Error(message);
    }
  }

  const provisionalContact = safeText(existingCrew.onboarding_status) === "pending_contact";
  if (provisionalContact) {
    await admin.from("crew_positions").delete().eq("crew_id", crewId);
    await admin.from("crew_city_pools").delete().eq("crew_id", crewId);
    const deleteCrew = await admin.from("crew").delete().eq("id", crewId);
    if (deleteCrew.error) throw new Error(deleteCrew.error.message);
  }

  return NextResponse.json({
    ok: true,
    crew_id: crewId,
    request_id: requestId,
    removed_files: removedFiles,
    crew_patch: crewPatch,
    provisional_contact_deleted: provisionalContact,
    message: provisionalContact
      ? "Onboarding submission and its hidden pending contact were deleted."
      : "Onboarding submission deleted. The existing crew contact was not deleted.",
  });
}

async function sendOnboardingCorrection(admin: SupabaseAdmin, request: Request, body: Record<string, unknown>) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const requestId = safeText(body.request_id);
  const correctionNote = safeText(body.correction_note || body.note || body.notes);
  if (!requestId) return NextResponse.json({ message: "request_id is required." }, { status: 400 });
  if (!correctionNote) return NextResponse.json({ message: "Please enter what needs to be fixed before sending it back." }, { status: 400 });

  const requestRes = await admin
    .from("crew_onboarding_requests")
    .select("id, crew_id, token, status, submission_payload, expires_at")
    .eq("id", requestId)
    .maybeSingle();
  if (requestRes.error) throw new Error(requestRes.error.message);
  if (!requestRes.data) return NextResponse.json({ message: "Onboarding request not found." }, { status: 404 });

  const row = requestRes.data as Record<string, unknown>;
  const crewId = safeText(row.crew_id);
  const payload = getPayloadObject(row.submission_payload);
  const requestType = normalizeRequestType(payload.request_type);
  const nowIso = new Date().toISOString();
  const token = safeText(row.token);
  const expiresAt = safeText(row.expires_at);
  const needsExtension = !expiresAt || new Date(expiresAt).getTime() < Date.now() + 1000 * 60 * 60 * 24 * 3;
  const nextExpiresAt = needsExtension ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString() : expiresAt;
  const nextPayload = {
    ...payload,
    request_type: requestType,
    correction_note: correctionNote,
    correction_requested_at: nowIso,
    correction_requested_by: auth.user.email || auth.user.id,
  };

  const updateRequest = await admin
    .from("crew_onboarding_requests")
    .update({
      status: "correction_requested",
      submission_payload: nextPayload,
      expires_at: nextExpiresAt,
      updated_at: nowIso,
    })
    .eq("id", requestId);
  if (updateRequest.error) throw new Error(updateRequest.error.message);

  const crewPatch: Record<string, unknown> = { updated_at: nowIso };
  if (requestType !== "w9_only") crewPatch.contract_status = "needs_correction";
  if (requestType === "full_onboarding") {
    crewPatch.onboarding_status = "correction_requested";
    crewPatch.questionnaire_status = "correction_requested";
    crewPatch.w9_status = "needs_correction";
    crewPatch.tax_profile_status = "needs_correction";
  }
  if (requestType === "w9_only") {
    crewPatch.w9_status = "needs_correction";
    crewPatch.tax_profile_status = "needs_correction";
  }
  await admin.from("crew").update(crewPatch).eq("id", crewId);

  const crewRes = await admin.from("crew").select("name, phone").eq("id", crewId).maybeSingle();
  const crewName = safeText((crewRes.data as { name?: string | null } | null)?.name) || "there";
  const firstName = crewName.split(/\s+/)[0] || "there";
  const phone = cleanPhone((crewRes.data as { phone?: string | null } | null)?.phone);
  const linkSuffix = requestType === "w9_only" ? "?mode=w9" : requestType === "contract_only" ? "?mode=contract" : "";
  const link = `${appBaseUrl(request)}/onboarding/${token}${linkSuffix}`;
  let queued = null as unknown;
  if (phone && body.queue_text !== false) {
    queued = await insertIntroQueue(admin, {
      queued_by_user_id: auth.user.id,
      queued_by_email: auth.user.email || null,
      queued_by_name: auth.user.email || null,
      crew_id: crewId,
      crew_name: crewName,
      phone,
      body: [`Hi ${firstName}, this is Storm with Emanuel Labor Services.`, "I reviewed your onboarding packet and need one correction before I can approve it:", correctionNote, "Please reopen your secure link, update the needed item, and resubmit:", link].join("\n\n"),
      status: "scheduled",
      scheduled_for: new Date(Date.now() + 30_000).toISOString(),
      created_at: nowIso,
      error: null,
    });
  }

  return NextResponse.json({ ok: true, link, queued, payload: nextPayload, message: queued ? "Correction request queued for the iPhone Shortcut." : "Correction request saved. No text was queued because this contact has no valid phone number." });
}

async function listOnboardingReviewQueue(admin: SupabaseAdmin) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;

  const requests = await admin
    .from("crew_onboarding_requests")
    .select("id, crew_id, status, sent_at, opened_at, submitted_at, expires_at, submission_payload, updated_at")
    .in("status", ["sent", "opened", "submitted", "approved", "correction_requested"])
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .limit(150);
  if (requests.error) {
    const message = requests.error.message || "";
    if (/crew_onboarding_requests|schema cache|relation/i.test(message)) {
      return NextResponse.json({ message: "Onboarding requests are not set up. Run the onboarding SQL migrations first." }, { status: 400 });
    }
    throw new Error(message);
  }

  const rows = requests.data ?? [];
  const crewIds = Array.from(new Set(rows.map((row) => safeText((row as { crew_id?: string | null }).crew_id)).filter(Boolean)));
  const crewById = new Map<string, Record<string, unknown>>();
  const taxByCrewId = new Map<string, Record<string, unknown>>();

  if (crewIds.length) {
    const crewRes = await admin
      .from("crew")
      .select("id, name, email, phone, address, onboarding_status, questionnaire_status, w9_status, contract_status, tax_profile_status, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, tax_profile_notes, notes")
      .in("id", crewIds);
    if (crewRes.error) throw new Error(crewRes.error.message);
    for (const row of crewRes.data ?? []) crewById.set(safeText((row as { id?: string }).id), row as Record<string, unknown>);

    const taxRes = await admin
      .from("crew_tax_profiles")
      .select("crew_id, tax_legal_name, business_name, federal_tax_classification, llc_tax_classification, other_classification, tax_address_line_1, tax_city_state_zip, tin_type, tin_last4, signer_name, certification_confirmed, signed_at, source, updated_at")
      .in("crew_id", crewIds);
    if (!taxRes.error) {
      for (const row of taxRes.data ?? []) taxByCrewId.set(safeText((row as { crew_id?: string }).crew_id), row as Record<string, unknown>);
    }
  }

  const cityPoolsRes = await admin.from("city_pools").select("id, name").order("name", { ascending: true });
  const ratesRes = await admin.from("master_rates").select("role_name").order("role_name", { ascending: true });
  const positionOptions = Array.from(new Set((ratesRes.data || []).map((row) => safeText((row as { role_name?: string | null }).role_name)).filter(Boolean)));

  return NextResponse.json({
    ok: true,
    city_pools: cityPoolsRes.data || [],
    position_options: positionOptions,
    rows: rows.map((requestRow) => {
      const typed = requestRow as Record<string, unknown>;
      const crewId = safeText(typed.crew_id);
      const crew = crewById.get(crewId) || {};
      const taxProfile = taxByCrewId.get(crewId) || null;
      const payload = getPayloadObject(typed.submission_payload);
      return {
        id: safeText(typed.id),
        crew_id: crewId,
        status: safeText(typed.status),
        request_type: normalizeRequestType(payload.request_type),
        sent_at: safeText(typed.sent_at),
        opened_at: safeText(typed.opened_at),
        submitted_at: safeText(typed.submitted_at),
        updated_at: safeText(typed.updated_at),
        payload,
        crew,
        tax_profile: taxProfile,
      };
    }),
  });
}

async function approveOnboardingSubmission(admin: SupabaseAdmin, body: Record<string, unknown>) {
  const auth = await requireOwnerAdmin();
  if (!auth.ok) return auth.response;
  const requestId = safeText(body.request_id);
  if (!requestId) return NextResponse.json({ message: "request_id is required." }, { status: 400 });

  const requestRes = await admin
    .from("crew_onboarding_requests")
    .select("id, crew_id, status, submission_payload, submitted_at")
    .eq("id", requestId)
    .maybeSingle();
  if (requestRes.error) throw new Error(requestRes.error.message);
  if (!requestRes.data) return NextResponse.json({ message: "Onboarding submission not found." }, { status: 404 });

  const requestRow = requestRes.data as Record<string, unknown>;
  const crewId = safeText(requestRow.crew_id);
  const payload = getPayloadObject(requestRow.submission_payload);
  const requestType = normalizeRequestType(payload.request_type);

  const crewRes = await admin
    .from("crew")
    .select("id, name, email, phone, notes, work_photo_urls, profile_photo_url, w9_document_url, contract_document_url, onboarding_status, city_pool_id")
    .eq("id", crewId)
    .maybeSingle();
  if (crewRes.error) throw new Error(crewRes.error.message);
  if (!crewRes.data) return NextResponse.json({ message: "Crew contact not found." }, { status: 404 });

  const taxRes = await admin
    .from("crew_tax_profiles")
    .select("id, tax_legal_name, tin_last4, signed_at")
    .eq("crew_id", crewId)
    .maybeSingle();
  const taxProfileReady = !taxRes.error && Boolean(taxRes.data);

  const existingCrew = crewRes.data as Record<string, unknown>;
  const profilePhoto = safeText(payload.profile_photo_url) || safeText(existingCrew.profile_photo_url);
  const w9Document = safeText(payload.w9_document_url) || safeText(existingCrew.w9_document_url);
  const contractDocument = safeText(payload.contract_document_url) || safeText(existingCrew.contract_document_url);
  const workPhotos = Array.isArray(payload.work_photo_urls) ? payload.work_photo_urls.map(safeText).filter(Boolean) : [];
  const missing: string[] = [];
  if (requestType === "full_onboarding") {
    if (!profilePhoto) missing.push("profile photo");
    if (!contractDocument) missing.push("signed contractor agreement PDF");
    if (!w9Document) missing.push("W-9 PDF/hard copy");
    if (!taxProfileReady) missing.push("saved tax data from W-9");
  } else if (requestType === "w9_only") {
    if (!w9Document) missing.push("W-9 PDF/hard copy");
    if (!taxProfileReady) missing.push("saved tax data from W-9");
  } else if (requestType === "contract_only") {
    if (!contractDocument) missing.push("signed contractor agreement PDF");
  }
  if (missing.length) {
    return NextResponse.json({ message: `Cannot approve yet. Missing: ${missing.join(", ")}.` }, { status: 400 });
  }

  const approvedAt = new Date().toISOString();
  const existingNotes = safeText(existingCrew.notes).replace(/\[\[ELS_PENDING_ONBOARDING_CONTACT\]\][\s\S]*?\[\[\/ELS_PENDING_ONBOARDING_CONTACT\]\]\s*/g, "").trim();
  const approvalNote = [
    "[[ELS_ONBOARDING_APPROVAL]]",
    `Approved: ${approvedAt}`,
    `Approved by: ${auth.user.email || auth.user.id}`,
    `Request type: ${requestType}`,
    `Applied legal name: ${safeText(payload.legal_name) || safeText(existingCrew.name)}`,
    "[[/ELS_ONBOARDING_APPROVAL]]",
  ].join("\n");

  const patch: Record<string, unknown> = {
    onboarding_status: requestType === "full_onboarding" ? "approved" : safeText((existingCrew as { onboarding_status?: string }).onboarding_status) || "not_started",
    questionnaire_status: requestType === "full_onboarding" ? "approved" : undefined,
    w9_status: requestType === "contract_only" ? undefined : "approved",
    tax_profile_status: requestType === "contract_only" ? undefined : "approved",
    onboarding_successfully_onboarded: requestType === "full_onboarding" ? true : undefined,
    onboarding_response: true,
    onboarding_paperwork_sent: requestType === "full_onboarding" ? true : undefined,
    profile_photo_url: profilePhoto || undefined,
    w9_document_url: w9Document || undefined,
    contract_document_url: contractDocument || undefined,
    contract_status: requestType === "w9_only" ? undefined : "approved",
    onboarding_completed_at: requestType === "full_onboarding" ? approvedAt : undefined,
    notes: [approvalNote, existingNotes].filter(Boolean).join("\n\n"),
    updated_at: approvedAt,
  };
  if (safeText(payload.legal_name)) patch.name = safeText(payload.legal_name);
  if (safeText(payload.phone)) patch.phone = safeText(payload.phone);
  if (safeText(payload.email)) patch.email = safeText(payload.email);
  if (safeText(payload.address)) patch.address = safeText(payload.address);
  if (safeText(payload.primary_city_pool_id)) patch.city_pool_id = safeText(payload.primary_city_pool_id);
  if (safeText(payload.other_local_cities)) patch.other_city = safeText(payload.other_local_cities);
  if (workPhotos.length) patch.work_photo_urls = mergePathLists(existingCrew.work_photo_urls, workPhotos);
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];

  const update = await admin.from("crew").update(patch).eq("id", crewId);
  if (update.error) throw new Error(update.error.message);

  if (requestType === "full_onboarding") {
    const primaryPoolId = safeText(payload.primary_city_pool_id);
    const additionalPoolIds = listValues(payload.local_city_pool_ids).filter((id) => id && id !== primaryPoolId);
    const poolRows = [primaryPoolId, ...additionalPoolIds].filter(Boolean).map((city_pool_id) => ({ crew_id: crewId, city_pool_id }));
    const deletePools = await admin.from("crew_city_pools").delete().eq("crew_id", crewId);
    if (deletePools.error && !/crew_city_pools|schema cache|relation/i.test(deletePools.error.message || "")) throw new Error(deletePools.error.message);
    if (poolRows.length) {
      const insertPools = await admin.from("crew_city_pools").insert(poolRows);
      if (insertPools.error && !/crew_city_pools|schema cache|relation/i.test(insertPools.error.message || "")) throw new Error(insertPools.error.message);
    }

    const submittedPositions = listValues(payload.positions);
    if (submittedPositions.length) {
      const existingPositionsRes = await admin.from("crew_positions").select("role_name, rate").eq("crew_id", crewId);
      const positionMap = new Map<string, { role_name: string; rate: number }>();
      for (const row of existingPositionsRes.data || []) {
        const roleName = safeText((row as { role_name?: string | null }).role_name);
        if (roleName) positionMap.set(roleName.toLowerCase(), { role_name: roleName, rate: Number((row as { rate?: number | string | null }).rate || 0) });
      }
      for (const roleName of submittedPositions) {
        const key = roleName.toLowerCase();
        if (!positionMap.has(key)) positionMap.set(key, { role_name: roleName, rate: 0 });
      }
      await admin.from("crew_positions").delete().eq("crew_id", crewId);
      const insertPositions = await admin.from("crew_positions").insert(Array.from(positionMap.values()).map((row) => ({ crew_id: crewId, ...row })));
      if (insertPositions.error) throw new Error(insertPositions.error.message);
    }
  }

  const requestUpdate = await admin
    .from("crew_onboarding_requests")
    .update({
      status: "approved",
      submission_payload: { ...payload, owner_approved_at: approvedAt, owner_approved_by: auth.user.email || auth.user.id },
      updated_at: approvedAt,
    })
    .eq("id", requestId);
  if (requestUpdate.error) throw new Error(requestUpdate.error.message);

  return NextResponse.json({ ok: true, crew_id: crewId, crew_patch: patch, message: "Onboarding submission approved and applied to Crew/Tax records." });
}

export async function GET(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { message: "SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 500 },
    );
  const action = new URL(request.url).searchParams.get("action") || "";
  if (action === "open_drive_file") {
    try {
      return await streamGoogleDriveFile(request, admin);
    } catch (error) {
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Unable to open Google Drive file." },
        { status: 400 },
      );
    }
  }
  return NextResponse.json({ message: "Not found." }, { status: 404 });
}

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { message: "SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 500 },
    );

  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("multipart/form-data"))
      return await handleMultipartUpload(request, admin);

    const body = await request.json();
    const action = safeText(body.action);

    if (action === "list_onboarding_review_queue") {
      return await listOnboardingReviewQueue(admin);
    }

    if (action === "approve_onboarding_submission") {
      return await approveOnboardingSubmission(
        admin,
        body as Record<string, unknown>,
      );
    }

    if (action === "delete_onboarding_document") {
      return await deleteOnboardingDocument(admin, body as Record<string, unknown>);
    }

    if (action === "delete_onboarding_submission") {
      return await deleteOnboardingSubmission(admin, body as Record<string, unknown>);
    }

    if (action === "send_onboarding_correction") {
      return await sendOnboardingCorrection(admin, request, body as Record<string, unknown>);
    }

    if (action === "create_signed_document_url") {
      return await createSignedDocumentUrl(
        request,
        admin,
        body as Record<string, unknown>,
      );
    }

    if (action === "save_owner_tax_profile") {
      const auth = await requireOwnerAdmin();
      if (!auth.ok) return auth.response;

      const crewId = safeText(body.crew_id);
      if (!crewId)
        return NextResponse.json(
          { message: "crew_id is required." },
          { status: 400 },
        );
      const ownerW9 = sanitizeOwnerTaxProfile(body.tax_profile);
      const missing = ownerTaxProfileMissingFields(ownerW9);
      if (missing.length)
        return NextResponse.json(
          {
            message: `Please complete the tax profile before saving. Missing: ${missing.join(", ")}.`,
          },
          { status: 400 },
        );

      const { data: crew, error: crewError } = await admin
        .from("crew")
        .select("id, name, tax_profile_notes")
        .eq("id", crewId)
        .maybeSingle();
      if (crewError) throw new Error(crewError.message);
      if (!crew)
        return NextResponse.json(
          { message: "Crew contact not found." },
          { status: 404 },
        );

      const savedAt = new Date().toISOString();
      await saveOwnerTaxProfile(admin, crewId, ownerW9, savedAt);
      const crewName =
        safeText((crew as { name?: string | null }).name) || "crew member";
      const currentNotes = safeText(
        (crew as { tax_profile_notes?: string | null }).tax_profile_notes,
      );
      const reviewNote = [
        `${savedAt.slice(0, 10)}: Tax profile entered/verified by owner from uploaded W-9.`,
        `Legal name: ${ownerW9.tax_legal_name}`,
        ownerW9.business_name ? `Business name: ${ownerW9.business_name}` : "",
        `Tax classification: ${ownerW9.federal_tax_classification}${ownerW9.llc_tax_classification ? ` (${ownerW9.llc_tax_classification})` : ""}`,
        `TIN type: ${ownerW9.tin_type.toUpperCase()} ending ${ownerW9.tin_last4}`,
        `Signed by: ${ownerW9.signer_name}`,
        "Owner approval still required before 1099 filing export.",
      ]
        .filter(Boolean)
        .join("\n");

      const patch = {
        w9_status: "uploaded",
        tax_profile_status: "needs_review",
        tax_profile_notes: [reviewNote, currentNotes]
          .filter(Boolean)
          .join("\n"),
        updated_at: savedAt,
      };
      const { error: updateError } = await admin
        .from("crew")
        .update(patch)
        .eq("id", crewId);
      if (updateError) throw new Error(updateError.message);

      return NextResponse.json({
        ok: true,
        crew_id: crewId,
        crew_name: crewName,
        crew_patch: patch,
        tax_profile: {
          taxLegalName: ownerW9.tax_legal_name,
          businessName: ownerW9.business_name,
          federalTaxClassification: ownerW9.federal_tax_classification,
          llcTaxClassification: ownerW9.llc_tax_classification,
          otherClassification: ownerW9.other_classification,
          taxAddressLine1: ownerW9.tax_address_line_1,
          taxCityStateZip: ownerW9.tax_city_state_zip,
          tinType: ownerW9.tin_type,
          tinLast4: ownerW9.tin_last4,
          signerName: ownerW9.signer_name,
          certificationConfirmed: ownerW9.certification_verified_from_w9,
          signedAt: savedAt,
          source: "owner_tax_center_verified_from_w9_file",
          updatedAt: savedAt,
          hasEncryptedTin: true,
          signatureCaptured: true,
        },
        message: `Tax profile saved for ${crewName}. Review the PDF and tax data together before approving.`,
      });
    }

    if (action === "update_tax_document_review") {
      return await updateTaxDocumentReview(
        admin,
        body as Record<string, unknown>,
      );
    }

    if (action === "read_request") {
      const token = safeText(body.token);
      const onboardingRequest = await readValidOnboardingRequest(admin, token);
      if (!onboardingRequest.ok) return onboardingRequest.response;
      const requestRow = onboardingRequest.requestRow;
      const requestType = requestTypeFromRow(requestRow);
      const requestId = safeText((requestRow as { id?: string | null }).id);
      const status = safeText(
        (requestRow as { status?: string | null }).status,
      );
      if (status === "sent" && requestId) {
        await admin
          .from("crew_onboarding_requests")
          .update({
            status: "opened",
            opened_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestId);
      }
      const payload = getPayloadObject((requestRow as { submission_payload?: unknown }).submission_payload);
      const crewId = safeText((requestRow as { crew_id?: string | null }).crew_id);
      let crew: Record<string, unknown> | null = null;
      if (crewId) {
        const crewRes = await admin
          .from("crew")
          .select("id, name, phone, email, address, city_pool_id, other_city, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url")
          .eq("id", crewId)
          .maybeSingle();
        if (!crewRes.error && crewRes.data) {
          crew = crewRes.data as Record<string, unknown>;
          const extraPoolsRes = await admin.from("crew_city_pools").select("city_pool_id").eq("crew_id", crewId);
          if (!extraPoolsRes.error) crew.additional_city_pool_ids = (extraPoolsRes.data || []).map((row) => safeText((row as { city_pool_id?: string | null }).city_pool_id)).filter(Boolean);
        }
      }
      const cityPoolsRes = await admin.from("city_pools").select("id, name").order("name", { ascending: true });
      const ratesRes = await admin.from("master_rates").select("role_name").order("role_name", { ascending: true });
      const positionOptions = Array.from(new Set((ratesRes.data || []).map((row) => safeText((row as { role_name?: string | null }).role_name)).filter(Boolean)));
      return NextResponse.json({
        ok: true,
        city_pools: cityPoolsRes.data || [],
        position_options: positionOptions,
        request_type: requestType,
        status: status === "sent" ? "opened" : status,
        expires_at:
          safeText((requestRow as { expires_at?: string | null }).expires_at) ||
          null,
        correction_note: safeText(payload.correction_note),
        payload,
        crew,
      });
    }

    if (action === "create_new_crew_request") {
      const auth = await requireOwnerAdmin();
      if (!auth.ok) return auth.response;

      const name = safeText(body.name);
      const phone = safeText(body.phone);
      const email = safeText(body.email).toLowerCase();
      if (!name) return NextResponse.json({ message: "Name is required." }, { status: 400 });
      if (!phone && !email) return NextResponse.json({ message: "Enter at least a phone number or email address." }, { status: 400 });

      let crewId = "";
      let existingContact = false;
      if (email) {
        const { data } = await admin.from("crew").select("id, name, phone, email").ilike("email", email).limit(1).maybeSingle();
        if (data?.id) crewId = safeText(data.id);
      }
      const incomingPhoneDigits = phoneDigits(phone);
      if (!crewId && incomingPhoneDigits) {
        const { data } = await admin.from("crew").select("id, phone").limit(5000);
        const match = (data || []).find((row) => phoneDigits((row as { phone?: string | null }).phone) === incomingPhoneDigits);
        if (match) crewId = safeText((match as { id?: string | null }).id);
      }
      existingContact = Boolean(crewId);

      const nowIso = new Date().toISOString();
      if (!crewId) {
        const pendingNote = [
          "[[ELS_PENDING_ONBOARDING_CONTACT]]",
          `Created from Onboarding Center: ${nowIso}`,
          "This temporary contact remains hidden from Crew until onboarding is approved.",
          "[[/ELS_PENDING_ONBOARDING_CONTACT]]",
        ].join("\n");
        const inserted = await admin
          .from("crew")
          .insert({
            name,
            phone: phone || null,
            email: email || null,
            onboarding_status: "pending_contact",
            questionnaire_status: "requested",
            w9_status: "requested",
            contract_status: "requested",
            tax_profile_status: "requested",
            onboarding_request_sent_at: nowIso,
            onboarding_texted_called: Boolean(phone),
            onboarding_paperwork_sent: true,
            notes: pendingNote,
            group_name: "Ungrouped",
            created_by: auth.user.id,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select("id")
          .single();
        if (inserted.error) throw new Error(inserted.error.message);
        crewId = safeText(inserted.data?.id);
      }

      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      const requestInsert = await admin
        .from("crew_onboarding_requests")
        .insert({
          crew_id: crewId,
          token,
          status: "sent",
          sent_by: auth.user.id,
          sent_at: nowIso,
          expires_at: expiresAt,
          submission_payload: {
            request_type: "full_onboarding",
            invite_name: name,
            invite_phone: phone,
            invite_email: email,
            provisional_contact: !existingContact,
          },
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id, crew_id, token, status, sent_at, expires_at")
        .single();
      if (requestInsert.error) throw new Error(requestInsert.error.message);

      await admin.from("crew").update({
        onboarding_status: existingContact ? "request_sent" : "pending_contact",
        questionnaire_status: "requested",
        w9_status: "requested",
        contract_status: "requested",
        tax_profile_status: "requested",
        onboarding_request_sent_at: nowIso,
        updated_at: nowIso,
      }).eq("id", crewId);

      const link = `${appBaseUrl(request)}/onboarding/${token}`;
      const firstName = name.split(/\s+/)[0] || "there";
      const normalizedPhone = cleanPhone(phone);
      let queued = null as unknown;
      if (normalizedPhone && body.queue_text !== false) {
        queued = await insertIntroQueue(admin, {
          queued_by_user_id: auth.user.id,
          queued_by_email: auth.user.email || null,
          queued_by_name: auth.user.email || null,
          crew_id: crewId,
          crew_name: name,
          phone: normalizedPhone,
          body: [
            `Hi ${firstName}, this is Storm with Emanuel Labor Services.`,
            "Please complete your secure ELS onboarding questionnaire, profile photo, W-9, and contractor agreement using this link:",
            link,
            "Please do not send SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
          ].join("\n\n"),
          status: "scheduled",
          scheduled_for: new Date(Date.now() + 30_000).toISOString(),
          created_at: nowIso,
          error: null,
        });
      }

      return NextResponse.json({
        ok: true,
        crew_id: crewId,
        existing_contact: existingContact,
        provisional_contact: !existingContact,
        link,
        request: requestInsert.data,
        queued,
        message: queued
          ? existingContact
            ? "Existing contact found. Full onboarding request queued for the iPhone Shortcut."
            : "Pending onboarding record created and request queued for the iPhone Shortcut."
          : existingContact
            ? "Existing contact found and onboarding link created."
            : "Pending onboarding record created and link ready to send.",
      });
    }

    if (action === "create_request") {
      const auth = await requireOwnerAdmin();
      if (!auth.ok) return auth.response;

      const crewId = safeText(body.crew_id);
      const requestType = normalizeRequestType(body.request_type ?? body.mode);
      if (!crewId)
        return NextResponse.json(
          { message: "crew_id is required." },
          { status: 400 },
        );

      const { data: crew, error: crewError } = await admin
        .from("crew")
        .select("id, name, phone, email")
        .eq("id", crewId)
        .maybeSingle();
      if (crewError) throw new Error(crewError.message);
      if (!crew)
        return NextResponse.json(
          { message: "Crew contact not found." },
          { status: 404 },
        );

      const token = crypto.randomBytes(32).toString("base64url");
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * 30,
      ).toISOString();

      const { data: requestRow, error: requestError } = await admin
        .from("crew_onboarding_requests")
        .insert({
          crew_id: crewId,
          token,
          status: "sent",
          sent_by: auth.user.id,
          sent_at: nowIso,
          expires_at: expiresAt,
          submission_payload: { request_type: requestType },
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id, crew_id, token, status, sent_at, expires_at")
        .single();

      if (requestError) {
        if ((requestError.message || "").includes("crew_onboarding_requests")) {
          return NextResponse.json(
            {
              message:
                "Run ELS210_required_sql.sql once in Supabase to create crew_onboarding_requests.",
            },
            { status: 400 },
          );
        }
        throw new Error(requestError.message);
      }

      const crewStatusPatch =
        requestType === "w9_only"
          ? {
              w9_status: "requested",
              tax_profile_status: "requested",
              onboarding_request_sent_at: nowIso,
              updated_at: nowIso,
            }
          : requestType === "contract_only"
            ? {
                contract_status: "requested",
                onboarding_request_sent_at: nowIso,
                updated_at: nowIso,
              }
            : {
                onboarding_status: "request_sent",
                questionnaire_status: "requested",
                w9_status: "requested",
                contract_status: "requested",
                onboarding_request_sent_at: nowIso,
                updated_at: nowIso,
              };
      await admin.from("crew").update(crewStatusPatch).eq("id", crewId);

      const link = `${appBaseUrl(request)}/onboarding/${token}${requestType === "w9_only" ? "?mode=w9" : requestType === "contract_only" ? "?mode=contract" : ""}`;
      const crewName =
        safeText((crew as { name?: string | null }).name) || "there";
      const firstName = crewName.split(/\s+/)[0] || "there";
      const phone = cleanPhone((crew as { phone?: string | null }).phone);
      const messageBody =
        requestType === "w9_only"
          ? [
              `Hi ${firstName}, this is Storm with Emanuel Labor Services.`,
              "I only need your W-9 for ELS tax/1099 records. Please upload it through this secure link:",
              link,
              "Please do not send your SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
            ].join("\n\n")
          : requestType === "contract_only"
            ? [
                `Hi ${firstName}, this is Storm with Emanuel Labor Services.`,
                "I only need your Independent Contractor Agreement signed for ELS records. Please complete it through this secure link:",
                link,
                "Thank you.",
              ].join("\n\n")
            : [
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

      return NextResponse.json({
        ok: true,
        link,
        request_type: requestType,
        request: requestRow,
        queued,
        message: queued
          ? requestType === "w9_only"
            ? "W-9 request link created and queued for the iPhone Shortcut."
            : requestType === "contract_only"
              ? "Contract-only request link created and queued for the iPhone Shortcut."
              : "Onboarding request link created and queued for the iPhone Shortcut."
          : requestType === "w9_only"
            ? "W-9 request link created. No text was queued because this contact has no valid phone number."
            : requestType === "contract_only"
              ? "Contract-only request link created. No text was queued because this contact has no valid phone number."
              : "Onboarding request link created. No text was queued because this contact has no valid phone number.",
      });
    }

    if (action === "submit") {
      const token = safeText(body.token);
      const onboardingRequest = await readValidOnboardingRequest(admin, token);
      if (!onboardingRequest.ok) return onboardingRequest.response;
      const requestRow = onboardingRequest.requestRow;
      const requestType = safeText(body.request_type)
        ? normalizeRequestType(body.request_type)
        : requestTypeFromRow(requestRow);
      const crewId = safeText(
        (requestRow as { crew_id?: string | null }).crew_id,
      );
      const currentCrewRes = await admin
        .from("crew")
        .select("notes")
        .eq("id", crewId)
        .maybeSingle();
      if (currentCrewRes.error) throw new Error(currentCrewRes.error.message);

      const submittedAt = new Date().toISOString();
      const requestId = safeText((requestRow as { id?: string | null }).id);
      const workPhotoUrls = Array.isArray(body.work_photo_urls)
        ? body.work_photo_urls.map(safeText).filter(Boolean)
        : splitList(body.work_photo_urls);
      const w9UseDigital = Boolean(body.w9_use_digital);
      const digitalW9 = sanitizeDigitalW9(body.digital_w9);
      const digitalW9Redacted = w9UseDigital
        ? redactedDigitalW9(digitalW9)
        : null;
      const contractSignature = sanitizeContractSignature(
        body.contract_signature,
        safeText(body.legal_name),
      );
      const contractSignatureRedacted = redactedContractSignature(contractSignature);

      if (w9UseDigital) {
        const missing = digitalW9MissingFields(digitalW9);
        if (missing.length) {
          return NextResponse.json(
            {
              message: `Please complete the in-app W-9 before submitting. Missing: ${missing.join(", ")}.`,
            },
            { status: 400 },
          );
        }
      }

      const payload = {
        request_type: requestType,
        legal_name: safeText(body.legal_name),
        preferred_name: safeText(body.preferred_name),
        phone: safeText(body.phone),
        email: safeText(body.email),
        address: composeHomeAddress(body as Record<string, unknown>) || safeText(body.address),
        home_address_line1: safeText(body.home_address_line1),
        home_city: safeText(body.home_city),
        home_state: safeText(body.home_state).toUpperCase(),
        home_zip: safeText(body.home_zip),
        emergency_contact_name: safeText(body.emergency_contact_name),
        emergency_contact_phone: safeText(body.emergency_contact_phone),
        city_state: safeText(body.city_state) || [safeText(body.home_city), safeText(body.home_state).toUpperCase()].filter(Boolean).join(", "),
        primary_city_pool_id: safeText(body.primary_city_pool_id),
        local_city_pool_ids: listValues(body.local_city_pool_ids),
        other_local_cities: safeText(body.other_local_cities),
        positions: splitList(body.positions),
        years_experience: safeText(body.years_experience),
        skills: safeText(body.skills),
        equipment_experience: safeText(body.equipment_experience),
        has_transportation: safeText(body.has_transportation),
        has_tools: safeText(body.has_tools),
        travel_availability: safeText(body.travel_availability),
        travel_markets: safeText(body.travel_markets),
        hotel_flight_willing: safeText(body.hotel_flight_willing),
        profile_photo_note: safeText(body.profile_photo_note),
        w9_status_note: safeText(body.w9_status_note),
        contract_acknowledged: Boolean(body.contract_acknowledged),
        profile_photo_url: safeText(body.profile_photo_url),
        work_photo_urls: [],
        w9_document_url: safeText(body.w9_document_url),
        contract_document_url: safeText(body.contract_document_url),
        contract_signature: contractSignatureRedacted,
        w9_use_digital: w9UseDigital,
        digital_w9: digitalW9Redacted,
        submitted_at: submittedAt,
      };

      if (requestType === "full_onboarding") {
        const requiredMissing: string[] = [];
        if (!payload.legal_name) requiredMissing.push("legal name");
        if (!payload.phone && !payload.email)
          requiredMissing.push("phone number or email");
        if (!payload.home_address_line1 || !payload.home_city || !payload.home_state || !payload.home_zip)
          requiredMissing.push("complete home address");
        if (!payload.primary_city_pool_id) requiredMissing.push("main local work city");
        if (!payload.positions.length) requiredMissing.push("at least one work position");
        if (!payload.profile_photo_url)
          requiredMissing.push("professional profile photo");
        if (!w9UseDigital && !payload.w9_document_url)
          requiredMissing.push("signed W-9");
        const contractMissing = contractMissingFields(contractSignature);
        if (contractMissing.length && !payload.contract_document_url)
          requiredMissing.push(`signed Independent Contractor Agreement (${contractMissing.join(", ")})`);
        if (requiredMissing.length) {
          return NextResponse.json(
            {
              message: `Please complete mandatory onboarding items before submitting: ${requiredMissing.join("; ")}.`,
            },
            { status: 400 },
          );
        }
      }

      const existingNotes = safeText(
        (currentCrewRes.data as { notes?: string | null } | null)?.notes,
      );

      const primaryCityName = payload.primary_city_pool_id ? await cityPoolNameById(admin, payload.primary_city_pool_id) : "";

      if (w9UseDigital) {
        await saveDigitalW9(admin, crewId, requestId, digitalW9, submittedAt);
        if (!payload.w9_document_url) {
          payload.w9_document_url = await saveGeneratedW9Pdf(
            admin,
            crewId,
            requestId,
            digitalW9,
            submittedAt,
            primaryCityName,
          );
        }
      }

      if (requestType === "contract_only") {
        const contractMissing = contractMissingFields(contractSignature);
        if (contractMissing.length && !payload.contract_document_url) {
          return NextResponse.json(
            {
              message: `Please sign the Independent Contractor Agreement before submitting. Missing: ${contractMissing.join(", ")}.`,
            },
            { status: 400 },
          );
        }
        if (!payload.contract_document_url && contractSignature.signature_data_url) {
          payload.contract_document_url = await saveGeneratedContractPdf(
            admin,
            crewId,
            requestId,
            contractSignature,
            submittedAt,
            payload.legal_name,
            primaryCityName,
          );
        }

        const contractNote = [
          "[[ELS_CONTRACT_ONLY_SUBMISSION]]",
          `Submitted: ${payload.submitted_at}`,
          payload.legal_name ? `Legal name: ${payload.legal_name}` : "",
          payload.contract_document_url ? "Contract PDF saved: yes" : "",
          contractSignature.signature_data_url
            ? `Contract signed by: ${contractSignature.contractor_name} on ${contractSignature.effective_date}`
            : "",
          "[[/ELS_CONTRACT_ONLY_SUBMISSION]]",
        ]
          .filter(Boolean)
          .join("\n");

        const { error: updateError } = await admin
          .from("crew")
          .update({
            contract_status: payload.contract_document_url ? "uploaded" : "needs_review",
            contract_document_url: payload.contract_document_url || undefined,
            notes: [existingNotes, contractNote].filter(Boolean).join("\n\n"),
            updated_at: payload.submitted_at,
          })
          .eq("id", crewId);
        if (updateError) throw new Error(updateError.message);

        const { error: requestUpdateError } = await admin
          .from("crew_onboarding_requests")
          .update({
            status: "submitted",
            submitted_at: payload.submitted_at,
            submission_payload: payload,
            updated_at: payload.submitted_at,
          })
          .eq("id", requestId);
        if (requestUpdateError) throw new Error(requestUpdateError.message);

        const audit = await admin.from("crew_onboarding_audit_log").insert({
          crew_id: crewId,
          action: "contract_only_submitted",
          details: payload,
          created_at: payload.submitted_at,
        });
        if (audit.error && !(audit.error.message || "").includes("crew_onboarding_audit_log")) throw new Error(audit.error.message);

        return NextResponse.json({
          ok: true,
          message:
            "Contract submitted securely. Emanuel Labor Services will review it for onboarding records.",
        });
      }

      if (requestType === "w9_only") {
        if (
          !w9UseDigital &&
          !payload.w9_document_url &&
          !payload.w9_status_note
        ) {
          return NextResponse.json(
            {
              message:
                "Please complete the in-app W-9, upload your signed W-9, or add a note before submitting.",
            },
            { status: 400 },
          );
        }

        const w9Note = [
          "[[ELS_W9_ONLY_SUBMISSION]]",
          `Submitted: ${payload.submitted_at}`,
          payload.legal_name ? `Legal name: ${payload.legal_name}` : "",
          w9UseDigital ? "Digital substitute W-9 completed in app: yes" : "",
          w9UseDigital
            ? `TIN: ${digitalW9.tin_type.toUpperCase()} ending ${digitalW9.tin_last4}`
            : "",
          payload.w9_document_url ? "W-9 uploaded: yes" : "",
          payload.w9_status_note ? `W-9 note: ${payload.w9_status_note}` : "",
          "[[/ELS_W9_ONLY_SUBMISSION]]",
        ]
          .filter(Boolean)
          .join("\n");

        const digitalNotes = w9UseDigital
          ? digitalW9Notes(digitalW9, submittedAt)
          : "";
        const updatePayload: Record<string, unknown> = {
          tax_profile_status: "needs_review",
          w9_status:
            w9UseDigital || payload.w9_document_url
              ? "uploaded"
              : "needs_review",
          notes: [existingNotes, w9Note].filter(Boolean).join("\n\n"),
          updated_at: payload.submitted_at,
        };
        if (digitalNotes || payload.legal_name)
          updatePayload.tax_profile_notes =
            digitalNotes ||
            `W-9-only request submitted by ${payload.legal_name} on ${payload.submitted_at.slice(0, 10)}.`;
        if (payload.w9_document_url)
          updatePayload.w9_document_url = payload.w9_document_url;

        const { error: updateError } = await admin
          .from("crew")
          .update(updatePayload)
          .eq("id", crewId);
        if (updateError) throw new Error(updateError.message);

        const { error: requestUpdateError } = await admin
          .from("crew_onboarding_requests")
          .update({
            status: "submitted",
            submitted_at: payload.submitted_at,
            submission_payload: payload,
            updated_at: payload.submitted_at,
          })
          .eq("id", requestId);
        if (requestUpdateError) throw new Error(requestUpdateError.message);

        const audit = await admin
          .from("crew_onboarding_audit_log")
          .insert({
            crew_id: crewId,
            action: "w9_only_submitted",
            details: payload,
            created_at: payload.submitted_at,
          });
        if (
          audit.error &&
          !(audit.error.message || "").includes("crew_onboarding_audit_log")
        )
          throw new Error(audit.error.message);

        return NextResponse.json({
          ok: true,
          message:
            "W-9 submitted securely. Emanuel Labor Services will review it for tax records.",
        });
      }

      if (!payload.contract_document_url && contractSignature.signature_data_url) {
        payload.contract_document_url = await saveGeneratedContractPdf(
          admin,
          crewId,
          requestId,
          contractSignature,
          submittedAt,
          payload.legal_name,
          primaryCityName,
        );
      }

      const onboardingNote = [
        "[[ELS_ONBOARDING_SUBMISSION]]",
        `Submitted: ${payload.submitted_at}`,
        payload.legal_name ? `Legal name: ${payload.legal_name}` : "",
        payload.preferred_name
          ? `Preferred name: ${payload.preferred_name}`
          : "",
        payload.address ? `Home address: ${payload.address}` : "",
        primaryCityName ? `Main local city: ${primaryCityName}` : "",
        payload.local_city_pool_ids.length ? `Additional local city pool IDs: ${payload.local_city_pool_ids.join(", ")}` : "",
        payload.other_local_cities ? `Other local cities: ${payload.other_local_cities}` : "",
        payload.emergency_contact_name || payload.emergency_contact_phone
          ? `Emergency contact: ${[payload.emergency_contact_name, payload.emergency_contact_phone].filter(Boolean).join(" - ")}`
          : "",
        payload.positions.length
          ? `Requested positions: ${payload.positions.join(", ")}`
          : "",
        payload.years_experience ? `Years experience: ${payload.years_experience}` : "",
        payload.has_transportation ? `Reliable transportation: ${payload.has_transportation}` : "",
        payload.has_tools ? `Own tools: ${payload.has_tools}` : "",
        payload.travel_availability
          ? `Travel availability: ${payload.travel_availability}`
          : "",
        payload.hotel_flight_willing
          ? `Hotel/flight willingness: ${payload.hotel_flight_willing}`
          : "",
        payload.travel_markets ? `Travel markets: ${payload.travel_markets}` : "",
        payload.skills ? `Skills: ${payload.skills}` : "",
        payload.equipment_experience
          ? `Equipment: ${payload.equipment_experience}`
          : "",
        payload.profile_photo_url ? "Profile photo uploaded: yes" : "",
        w9UseDigital ? "Digital substitute W-9 completed in app: yes" : "",
        w9UseDigital
          ? `TIN: ${digitalW9.tin_type.toUpperCase()} ending ${digitalW9.tin_last4}`
          : "",
        payload.w9_document_url ? "W-9 uploaded: yes" : "",
        payload.contract_document_url ? "Contract uploaded: yes" : "",
        contractSignature.signature_data_url
          ? "Independent Contractor Agreement signed in app: yes"
          : "",
        contractSignature.signature_data_url
          ? `Contract signed by: ${contractSignature.contractor_name} on ${contractSignature.effective_date}`
          : "",
        payload.profile_photo_note
          ? `Profile photo note: ${payload.profile_photo_note}`
          : "",
        payload.w9_status_note ? `W-9 note: ${payload.w9_status_note}` : "",
        payload.contract_acknowledged
          ? "Contract acknowledgement: checked"
          : "",
        "[[/ELS_ONBOARDING_SUBMISSION]]",
      ]
        .filter(Boolean)
        .join("\n");

      const updatePayload: Record<string, unknown> = {
        onboarding_status: "submitted",
        questionnaire_status: "uploaded",
        tax_profile_status:
          w9UseDigital || payload.w9_document_url || payload.w9_status_note
            ? "needs_review"
            : "missing",
        onboarding_completed_at: payload.submitted_at,
        notes: [existingNotes, onboardingNote].filter(Boolean).join("\n\n"),
        updated_at: payload.submitted_at,
      };
      if (payload.phone) updatePayload.phone = payload.phone;
      if (payload.email) updatePayload.email = payload.email;
      if (payload.address) updatePayload.address = payload.address;
      if (payload.profile_photo_url)
        updatePayload.profile_photo_url = payload.profile_photo_url;
      if (w9UseDigital) {
        updatePayload.w9_status = "uploaded";
        updatePayload.tax_profile_notes = digitalW9Notes(
          digitalW9,
          submittedAt,
        );
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
      } else if (contractSignature.signature_data_url) {
        updatePayload.contract_status = "needs_review";
      } else if (payload.contract_acknowledged) {
        updatePayload.contract_status = "needs_review";
      }
      if (contractSignature.signature_data_url) {
        const contractNotes = contractSignatureNotes(contractSignature, submittedAt);
        updatePayload.tax_profile_notes = [
          safeText(updatePayload.tax_profile_notes),
          contractNotes,
        ]
          .filter(Boolean)
          .join("\n\n");
      }

      const { error: updateError } = await admin
        .from("crew")
        .update(updatePayload)
        .eq("id", crewId);
      if (updateError) throw new Error(updateError.message);

      const { error: requestUpdateError } = await admin
        .from("crew_onboarding_requests")
        .update({
          status: "submitted",
          submitted_at: payload.submitted_at,
          submission_payload: payload,
          updated_at: payload.submitted_at,
        })
        .eq("id", safeText((requestRow as { id?: string | null }).id));
      if (requestUpdateError) throw new Error(requestUpdateError.message);

      const audit = await admin
        .from("crew_onboarding_audit_log")
        .insert({
          crew_id: crewId,
          action: "onboarding_submitted",
          details: payload,
          created_at: payload.submitted_at,
        });
      if (
        audit.error &&
        !(audit.error.message || "").includes("crew_onboarding_audit_log")
      )
        throw new Error(audit.error.message);

      return NextResponse.json({
        ok: true,
        message:
          "Onboarding submitted. Emanuel Labor Services will review your information.",
      });
    }

    return NextResponse.json(
      { message: "Unsupported onboarding action." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to process onboarding request.",
      },
      { status: 400 },
    );
  }
}
