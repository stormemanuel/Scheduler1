import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  createSupabaseAdminClient,
  createSupabaseServerClient,
} from "@/lib/supabase-server";
import { getDefaultCrewPayRate } from "@/lib/crew-pay-defaults";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

type SupabaseAdmin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type OnboardingDocumentType =
  | "profile_photo"
  | "work_photo"
  | "w9"
  | "contract"
  | "general";
type OnboardingRequestType = "full_onboarding" | "w9_only" | "contract_only";

const RETAINED_W9_SIGNATURE = "els-retained-w9-signature";
const RETAINED_CONTRACT_SIGNATURE = "els-retained-contract-signature";

function isSignatureImage(value: unknown) {
  return /^data:image\/(?:jpeg|jpg);base64,/i.test(safeText(value));
}

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

function isCoordinatorSystemPoolName(name: unknown) {
  return safeText(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .startsWith("coordinator ");
}

function publicOnboardingCityPools(rows: unknown[] | null | undefined) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row || typeof row !== "object") return false;
    return !isCoordinatorSystemPoolName((row as { name?: unknown }).name);
  });
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
    !/^data:image\/(?:jpeg|jpg);base64,/i.test(contract.signature_data_url)
  )
    missing.push("contract electronic signature (press the green signature button again)");
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

type EmbeddedJpeg = {
  bytes: Buffer;
  width: number;
  height: number;
  components: number;
};

const ELS_COMPANY_SIGNATURE_JPEG_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCADwA+gDASIAAhEBAxEB/8QAHgABAAICAwEBAQAAAAAAAAAAAAgJBgcEBQoBAwL/xABUEAABAwMCBAIFBwcHCQcDBQABAAIDBAUGBxEIEhMhCTEUIkFhgRUWFyMyUXEZQlKCkZPVJFhZcpKVoRgzU1Zic5Sx1ENXlqOmstNjotE0RMHC8P/EABkBAQADAQEAAAAAAAAAAAAAAAABAwQCBf/EAC4RAQACAgEDBAEDAwQDAAAAAAABAgMREgQhMRMiQVFhIzKRUqHwFDNCcYGx0f/aAAwDAQACEQMRAD8AtTREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQERcC+32y4xZ6zIcju1JbLZb4XVFXWVczYoYI2jcue9xAaB95Qc9FWZxJ+LVNT1tVinDVZ6eWKJzon5PdoC4SH9Klpjt2+58u+/+j8ioXZHxkcVOU1b6256/ZtDJISS23XWS3x9/ujpjGwD3ALRXpr2jc9lc5aw9AiKv7wwbRxGZtQV+s2rGrWZ3XFZWyUNitl2us1UyulB2lqT1i49NhBY3Y9385/MG9gKpvXhbjt3WeUbERFykREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBFxrjcbfaKCput2rqeioqOJ09RU1ErY4oY2jdz3ucQGtABJJOwAVcXER4neVZLkculfB9jdTd6+V7qZt/FvdVz1Dx5+g0gaeYDbtJI12/fZgGzj3THa86hza0V8rGLxfLLj1E65X+8UVso2faqKyoZDG38XPIAWHUfEFoJca5tst+t2AVVY5wa2nhyWifKSfIBok33+Cp7y3hF8QDVmd+aZ3p9l9/qngydW73andO0Eb8rIZZg9g/wBhrRt2Gw8lHDKsSyjBr9VYvmWPXCyXehdyVFFX07oZoztuN2uAOxGxB8iCCOy0V6atv+Sucsx8PShHJHLG2WJ7XseA5rmncEHyIPtX9KlHgI4ysx0Q1Hsun+U3+prtPL/Vx0FRR1Upey1ySuDWVMBP+ba1xHO0eqWlx25g0i65UZMc451KytotGxERVuhERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBEWleJfiz0q4XscFyzSvNbe6yMutlgo3tNZWHy5iD2iiB85HduxADneqZiJtOoRM67y3Uios1z8QbiP1quUwgzKrw2wlx6Fox6ofShrPYJZ2kSzHbbfdwbv5Mb5KPNbeb7e6rq3G619fUyv35p53yvc4+8kklaY6WZ8yqnNHw9LKKK3h88Md04f9Jm3nN5Kp2ZZYyOrr6eeVzhbafbeKla0nZrwDzSED7Z5e4YCpUrPaIidRK2J3G5ERFykREQEREBERARF0GoFmv+RYLkNhxW/wAtjvVxtlTTW65Rbc9HUvjc2KUbg/ZcQfLft27oNB8XPHXpvwxW6aw0joMkzyeLelskEvq0vMN2y1bx/mmdwQz7b+2wAPOMj4LOIp/Evobbs3uzqRmR0VRLbL7BTN5GMqmHdr2tJJDXxOjePYC5wG/KqJsxocnteWXm25qK0ZBSV88F0Fa9z5/S2yES9RziS53OHbkk7lWBeEdhWulr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DmtPaxU6iVWM3C6TimFvvtqqIX0zzKY2meeNslLGw9n85m5WtcC8t2cBKRdFmGB4NqHbIrLn+GWLJrfBO2qipLxboa2Fkwa5okayVrmh4a94DgN9nOHtKcqT5g1b7cXC9UNNNSfTPo71ExjKfk7p+mfIt3p670bqc3T6nRe7k5uR+2+2/K7byKydRl1K8OLhJ1J+Uar6N/mtc7j0f5fjVW+h9G6fIPqaX1qNnM1nK76g78znfbPOuruHChxIYT8p1WhPG9nUXpVC3loM8pYMj61bH1Szlqpm/wAkidzsa7pwOd2Lj1NmMa40nxJuY8wlciiQ7XLjv0tudyl1f4XbFnWN0k9C0XbTa4vMzYZHNE74qCofJVVb29RoDOSAAxSEuLD1G7D0Z40NCdbsmGn9jvNzsOcN9LbUYpkVtkoLlTyU0jmSxOB3hdKA0vMTJHPDA4ua3kkDYnHaI2cob0REXDoREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBdX818Z+c3z0+bts+cPoPyX8reiR+m+hdTqej9fbn6XU9fk35ebvtv3XaIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiIC19rHoHpJr5Yo8f1VwyjvUNOXOpZ3F0VTSuPmYpmEPZvsNwDyu2HMDstgopiZidweVfeWeDnpLcKiSXC9V8pssb+7Yq+mgr2sP3At6J2/Ek+8rFGeC/SCQmTiNlMf6IxMA/t9MP8AyVl6Kz18kfLj06/Sv3GvBz0fopY5Mt1Vy27Nb3cyihp6Jr/d6zZSB+B396kVpZwOcL2kM0NfjOldtrLlA4PZcLyXXCdrx5Pb1i5kbh97GtW+EUWy3t5lMUrHiHzy7BfURVuhERAREQEREBERAREQFxZLXbJrnT3qW3Ur7hSQTUsFW6FpmihldG6WNj9uZrHuhhLmg7OMTCd+UbcpEBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQf//Z";

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error("Electronic signature image is not a valid JPEG.");

  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const markerCode = bytes[offset];
    offset += 1;

    if (
      markerCode === 0xd8 ||
      markerCode === 0xd9 ||
      markerCode === 0x01 ||
      (markerCode >= 0xd0 && markerCode <= 0xd7)
    )
      continue;

    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const isStartOfFrame =
      markerCode === 0xc0 ||
      markerCode === 0xc1 ||
      markerCode === 0xc2 ||
      markerCode === 0xc3 ||
      markerCode === 0xc5 ||
      markerCode === 0xc6 ||
      markerCode === 0xc7 ||
      markerCode === 0xc9 ||
      markerCode === 0xca ||
      markerCode === 0xcb ||
      markerCode === 0xcd ||
      markerCode === 0xce ||
      markerCode === 0xcf;

    if (isStartOfFrame) {
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7];
      if (!width || !height || ![1, 3].includes(components))
        throw new Error("Electronic signature JPEG uses an unsupported color format.");
      return { width, height, components };
    }

    offset += segmentLength;
  }

  throw new Error("Unable to read the electronic signature JPEG dimensions.");
}

function embeddedSignatureJpeg(value: string, label: string): EmbeddedJpeg {
  const match = safeText(value).match(/^data:image\/(?:jpeg|jpg);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match)
    throw new Error(
      `${label} must use the ELS handwritten signature. Clear the signature and press the green signature button again.`,
    );
  const bytes = Buffer.from(match[1], "base64");
  const dimensions = jpegDimensions(bytes);
  return { bytes, ...dimensions };
}

function jpegImageObject(image: EmbeddedJpeg) {
  const colorSpace = image.components === 1 ? "/DeviceGray" : "/DeviceRGB";
  return Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      "binary",
    ),
    image.bytes,
    Buffer.from("\nendstream", "binary"),
  ]);
}

function drawJpegCommand(
  resourceName: string,
  image: EmbeddedJpeg,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /${resourceName} Do Q\n`;
}

function buildPdfWithJpegResources(
  pages: string[],
  pageWidth: number,
  pageHeight: number,
  images: Record<string, EmbeddedJpeg>,
  markerText: string,
) {
  const objects: Buffer[] = [];
  const imageEntries = Object.entries(images);
  const imageObjectIds = new Map<string, number>();
  imageEntries.forEach(([name], index) => imageObjectIds.set(name, 5 + index));
  const firstPageObjectId = 5 + imageEntries.length;
  const pageObjectIds = pages.map((_, index) => firstPageObjectId + index * 2);

  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "binary"));
  objects.push(
    Buffer.from(
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
      "binary",
    ),
  );
  objects.push(
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "binary"),
  );
  objects.push(
    Buffer.from(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      "binary",
    ),
  );

  imageEntries.forEach(([, image]) => objects.push(jpegImageObject(image)));

  const xObjectResources = imageEntries
    .map(([name]) => `/${name} ${imageObjectIds.get(name)} 0 R`)
    .join(" ");

  pages.forEach((pageContent) => {
    const contentId = objects.length + 2;
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${
          xObjectResources ? ` /XObject << ${xObjectResources} >>` : ""
        } >> /Contents ${contentId} 0 R >>`,
        "binary",
      ),
    );
    const contentBytes = Buffer.from(pageContent, "binary");
    objects.push(
      Buffer.concat([
        Buffer.from(`<< /Length ${contentBytes.length} >>\nstream\n`, "binary"),
        contentBytes,
        Buffer.from("endstream", "binary"),
      ]),
    );
  });

  const chunks: Buffer[] = [Buffer.from(`%PDF-1.4\n%${markerText}\n`, "binary")];
  const offsets: number[] = [0];
  let length = chunks[0].length;

  objects.forEach((object, index) => {
    offsets[index + 1] = length;
    const prefix = Buffer.from(`${index + 1} 0 obj\n`, "binary");
    const suffix = Buffer.from("\nendobj\n", "binary");
    chunks.push(prefix, object, suffix);
    length += prefix.length + object.length + suffix.length;
  });

  const xrefOffset = length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1)
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "binary"));
  return Buffer.concat(chunks);
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
  const contractorSignature = embeddedSignatureJpeg(
    contract.signature_data_url,
    "Contractor signature",
  );
  const companySignature = embeddedSignatureJpeg(
    ELS_COMPANY_SIGNATURE_JPEG_DATA_URL,
    "ELS company signature",
  );
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
  content += drawJpegCommand(
    "ContractorSignature",
    contractorSignature,
    margin,
    y - 48,
    360,
    54,
  );
  y -= 62;
  line(`Contractor name: ${contractorDisplayName}`, 9.5, "F1", 13);
  line(`Contractor initials applied to Appendix A: ${contractorInitials}`, 9.5, "F1", 13);
  line(`Date signed: ${contract.effective_date}`, 9.5, "F1", 13);
  line(`Submitted through ELS secure onboarding: ${submittedAt}`, 8.5, "F1", 12);
  y -= 12;
  ensure(90);
  line("Company Representative Electronic Signature", 11, "F2", 15);
  content += drawJpegCommand(
    "CompanySignature",
    companySignature,
    margin,
    y - 48,
    360,
    54,
  );
  y -= 62;
  line(`Company representative: ${ELS_COMPANY_REPRESENTATIVE}`, 9.5, "F1", 13);
  line(`Date countersigned: ${companySignedDate}`, 9.5, "F1", 13);
  line("ELS company signature applied automatically for onboarding recordkeeping.", 8.5, "F1", 12);

  if (content.trim()) pages.push(content);

  return buildPdfWithJpegResources(
    pages,
    pageWidth,
    pageHeight,
    {
      ContractorSignature: contractorSignature,
      CompanySignature: companySignature,
    },
    "ELS-CONTRACT",
  );

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
    !/^data:image\/(?:jpeg|jpg);base64,/i.test(w9.signature_data_url)
  )
    missing.push("electronic signature (press the green signature button again)");
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

function decryptTin(value: unknown) {
  const parts = safeText(value).split(":");
  if (parts.length !== 4 || parts[0] !== "aes-256-gcm") return "";
  try {
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const encrypted = Buffer.from(parts[3], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", tinEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
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

type OnboardingSenderContext = {
  userId: string;
  email: string | null;
  role: string;
  allowedCityPoolIds: string[];
  isViewingAs: boolean;
};

async function onboardingSenderContext(allowPreview = false) {
  const session = await getSessionUser();
  if (!session.user) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }),
    };
  }
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  if (!isOwnerAdmin(role) && role !== "coordinator") {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Onboarding access is not available for this account." }, { status: 403 }),
    };
  }
  if (session.isViewingAs && !allowPreview) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "View as user mode is read-only. Exit user view to send onboarding." }, { status: 423 }),
    };
  }
  if (role === "coordinator" && !(session.access?.allowed_pages || []).includes("onboarding")) {
    return {
      ok: false as const,
      response: NextResponse.json({ message: "Onboarding page access has not been enabled for this coordinator." }, { status: 403 }),
    };
  }
  return {
    ok: true as const,
    context: {
      userId: session.user.id,
      email: session.user.email || null,
      role,
      allowedCityPoolIds: session.access?.allowed_city_pool_ids || [],
      isViewingAs: Boolean(session.isViewingAs),
    } satisfies OnboardingSenderContext,
  };
}

async function scopedCrewForOnboarding(admin: SupabaseAdmin, context: OnboardingSenderContext, crewId: string) {
  const crewRes = await admin
    .from("crew")
    .select("id, name, phone, email, city_pool_id, created_by, coordinator_hidden_at, coordinator_hidden_by, onboarding_status")
    .eq("id", crewId)
    .maybeSingle();
  if (crewRes.error) throw new Error(crewRes.error.message);
  const crew = crewRes.data as {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    city_pool_id?: string | null;
    created_by?: string | null;
    coordinator_hidden_at?: string | null;
    coordinator_hidden_by?: string | null;
    onboarding_status?: string | null;
  } | null;
  if (!crew || safeText(crew.onboarding_status) === "pending_contact") return null;
  if (isOwnerAdmin(context.role)) return crew;
  if (safeText(crew.created_by) !== context.userId) return null;
  if (crew.coordinator_hidden_at && safeText(crew.coordinator_hidden_by) === context.userId) return null;

  const allowedPools = new Set(context.allowedCityPoolIds.map(safeText).filter(Boolean));
  const extraPoolsRes = await admin.from("crew_city_pools").select("city_pool_id").eq("crew_id", crewId);
  const extraPoolIds = extraPoolsRes.error && /crew_city_pools|schema cache|relation/i.test(extraPoolsRes.error.message || "")
    ? []
    : (extraPoolsRes.data || []).map((row) => safeText((row as { city_pool_id?: string | null }).city_pool_id)).filter(Boolean);
  if (extraPoolsRes.error && extraPoolIds.length === 0 && !/crew_city_pools|schema cache|relation/i.test(extraPoolsRes.error.message || "")) {
    throw new Error(extraPoolsRes.error.message);
  }
  const primaryAllowed = Boolean(crew.city_pool_id && allowedPools.has(safeText(crew.city_pool_id)));
  const extraAllowed = extraPoolIds.some((poolId) => allowedPools.has(poolId));
  const ownUnassigned = !crew.city_pool_id && extraPoolIds.length === 0;
  return primaryAllowed || extraAllowed || ownUnassigned ? crew : null;
}

async function coordinatorOnboardingDashboard(admin: SupabaseAdmin) {
  const auth = await onboardingSenderContext(true);
  if (!auth.ok) return auth.response;
  const context = auth.context;
  if (isOwnerAdmin(context.role)) {
    return NextResponse.json({ ok: true, mode: "admin", read_only: context.isViewingAs });
  }

  const [crewRes, cityPoolsRes, extraPoolsRes] = await Promise.all([
    admin
      .from("crew")
      .select("id, name, phone, email, city_pool_id, group_name, created_by, coordinator_hidden_at, coordinator_hidden_by, onboarding_status, onboarding_request_sent_at, onboarding_completed_at")
      .eq("created_by", context.userId)
      .order("name", { ascending: true }),
    admin.from("city_pools").select("id, name"),
    admin.from("crew_city_pools").select("crew_id, city_pool_id"),
  ]);
  if (crewRes.error) throw new Error(crewRes.error.message);
  if (cityPoolsRes.error) throw new Error(cityPoolsRes.error.message);
  const extraPoolsMissing = Boolean(extraPoolsRes.error && /crew_city_pools|schema cache|relation/i.test(extraPoolsRes.error.message || ""));
  if (extraPoolsRes.error && !extraPoolsMissing) throw new Error(extraPoolsRes.error.message);

  const cityMap = new Map((cityPoolsRes.data || []).map((row) => [safeText((row as { id?: string | null }).id), safeText((row as { name?: string | null }).name)]));
  const extrasByCrew = new Map<string, string[]>();
  if (!extraPoolsMissing) {
    for (const row of extraPoolsRes.data || []) {
      const crewId = safeText((row as { crew_id?: string | null }).crew_id);
      const poolId = safeText((row as { city_pool_id?: string | null }).city_pool_id);
      if (!crewId || !poolId) continue;
      const list = extrasByCrew.get(crewId) || [];
      if (!list.includes(poolId)) list.push(poolId);
      extrasByCrew.set(crewId, list);
    }
  }
  const allowedPools = new Set(context.allowedCityPoolIds.map(safeText).filter(Boolean));
  const rows = (crewRes.data || []).filter((row) => {
    const typed = row as { id?: string | null; city_pool_id?: string | null; onboarding_status?: string | null; coordinator_hidden_at?: string | null; coordinator_hidden_by?: string | null };
    const crewId = safeText(typed.id);
    if (!crewId || safeText(typed.onboarding_status) === "pending_contact") return false;
    if (typed.coordinator_hidden_at && safeText(typed.coordinator_hidden_by) === context.userId) return false;
    const extras = extrasByCrew.get(crewId) || [];
    const primaryAllowed = Boolean(typed.city_pool_id && allowedPools.has(safeText(typed.city_pool_id)));
    const extraAllowed = extras.some((poolId) => allowedPools.has(poolId));
    const ownUnassigned = !typed.city_pool_id && extras.length === 0;
    return primaryAllowed || extraAllowed || ownUnassigned;
  }).map((row) => {
    const typed = row as Record<string, unknown>;
    const crewId = safeText(typed.id);
    const onboardingStatus = safeText(typed.onboarding_status) || "not_started";
    const completedAt = safeText(typed.onboarding_completed_at) || null;
    const onboardingComplete = onboardingStatus === "approved" || Boolean(completedAt);
    const submittedOrReview = ["submitted", "needs_review", "correction_requested"].includes(onboardingStatus);
    const requestSent = ["request_sent", "requested", "opened"].includes(onboardingStatus) || Boolean(typed.onboarding_request_sent_at);
    return {
      id: crewId,
      name: safeText(typed.name),
      phone: safeText(typed.phone),
      email: safeText(typed.email),
      city_name: safeText(typed.city_pool_id) ? cityMap.get(safeText(typed.city_pool_id)) || "Unassigned" : "Unassigned",
      group_name: safeText(typed.group_name) || "Ungrouped",
      onboarding_complete: onboardingComplete,
      progress_status: onboardingComplete ? "complete" : submittedOrReview ? "submitted_for_admin_review" : requestSent ? "in_progress" : "not_started",
      onboarding_request_sent_at: safeText(typed.onboarding_request_sent_at) || null,
      onboarding_completed_at: completedAt,
    };
  });

  return NextResponse.json({
    ok: true,
    mode: "coordinator",
    read_only: context.isViewingAs,
    rows,
  });
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


type OnboardingActor = {
  user: { id: string; email?: string | null };
  role: string;
  fullName: string;
};

type OnboardingSendHistoryEntry = {
  user_id: string;
  user_email: string;
  user_name: string;
  user_role: string;
  sent_at: string;
  action: "created" | "reused" | "reminder";
  channel: "queued_text" | "link_only";
};

function onboardingSendHistory(payload: Record<string, unknown>) {
  return Array.isArray(payload.send_history)
    ? payload.send_history.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    : [];
}

function appendOnboardingSendHistory(
  payload: Record<string, unknown>,
  actor: OnboardingActor,
  nowIso: string,
  action: OnboardingSendHistoryEntry["action"],
  queuedText: boolean,
) {
  const history = onboardingSendHistory(payload).slice(-49);
  const entry: OnboardingSendHistoryEntry = {
    user_id: actor.user.id,
    user_email: safeText(actor.user.email),
    user_name: actor.fullName,
    user_role: actor.role,
    sent_at: nowIso,
    action,
    channel: queuedText ? "queued_text" : "link_only",
  };
  return { ...payload, send_history: [...history, entry] };
}

function onboardingLinkForRequest(
  request: Request,
  token: string,
  requestType: OnboardingRequestType,
) {
  const suffix = requestType === "w9_only" ? "?mode=w9" : requestType === "contract_only" ? "?mode=contract" : "";
  return `${appBaseUrl(request)}/onboarding/${token}${suffix}`;
}

function activeOnboardingRequest(row: Record<string, unknown>) {
  const status = safeText(row.status);
  if (!["sent", "opened", "correction_requested"].includes(status)) return false;
  const expiresAt = safeText(row.expires_at);
  return Boolean(safeText(row.token) && (!expiresAt || new Date(expiresAt).getTime() > Date.now()));
}

async function findReusableOnboardingRequest(
  admin: SupabaseAdmin,
  crewId: string,
  requestType: OnboardingRequestType,
) {
  const result = await admin
    .from("crew_onboarding_requests")
    .select("id, crew_id, token, status, sent_by, sent_at, opened_at, submitted_at, expires_at, submission_payload, created_at, updated_at")
    .eq("crew_id", crewId)
    .in("status", ["sent", "opened", "correction_requested"])
    .order("updated_at", { ascending: false })
    .limit(20);
  if (result.error) throw new Error(result.error.message);
  return ((result.data || []) as Record<string, unknown>[]).find(
    (row) => activeOnboardingRequest(row) && requestTypeFromRow(row) === requestType,
  ) || null;
}

function requestWasSentByUser(row: Record<string, unknown>, userId: string) {
  if (safeText(row.sent_by) === userId) return true;
  const payload = getPayloadObject(row.submission_payload);
  return onboardingSendHistory(payload).some((entry) => safeText(entry.user_id) === userId);
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

function isPdfDocumentReference(value: unknown) {
  const text = safeText(value);
  if (!text) return false;
  if (isGoogleDrivePath(text)) return true;
  return /\.pdf(?:$|[?#])/i.test(text);
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

async function archiveApprovedPdfToGoogleDrive(
  admin: SupabaseAdmin,
  crewId: string,
  requestId: string,
  documentType: "w9" | "contract",
  storagePath: string,
  fallbackCrewName: string,
  fallbackMainCity: string,
) {
  if (!storagePath || isGoogleDrivePath(storagePath))
    return {
      storagePath,
      archived: Boolean(storagePath && isGoogleDrivePath(storagePath)),
      warning: null as string | null,
    };

  const config = DOCUMENT_CONFIG[documentType];
  const download = await admin.storage.from(config.bucket).download(storagePath);
  if (download.error || !download.data) {
    return {
      storagePath,
      archived: false,
      warning: `Approved ${documentType === "w9" ? "W-9" : "contract"} could not be read from secure app storage, so it was not archived to Google Drive.`,
    };
  }

  const bytes = Buffer.from(await download.data.arrayBuffer());
  const fileName =
    documentType === "w9"
      ? "digital-substitute-w9.pdf"
      : "signed-independent-contractor-agreement.pdf";
  const driveArchive = await archivePdfToGoogleDrive(
    admin,
    crewId,
    documentType,
    bytes,
    fileName,
    fallbackCrewName,
    fallbackMainCity,
  ).catch(() => null);

  if (!driveArchive) {
    return {
      storagePath,
      archived: false,
      warning:
        "Onboarding was approved, but Google Drive was not connected or the archive upload failed. The approved PDF remains in secure app storage.",
    };
  }

  await recordOnboardingDocument(admin, {
    crew_id: crewId,
    request_id: requestId || null,
    document_type: documentType,
    bucket_id: "google-drive",
    storage_path: driveArchive.storagePath,
    file_name: fileName,
    mime_type: "application/pdf",
    size_bytes: bytes.byteLength,
    source: "approved_onboarding_google_drive",
    created_at: new Date().toISOString(),
  });

  const removeStorage = await admin.storage.from(config.bucket).remove([storagePath]);
  if (removeStorage.error && !/not found/i.test(removeStorage.error.message || "")) {
    return {
      storagePath: driveArchive.storagePath,
      archived: true,
      warning:
        "The approved PDF was archived to Google Drive, but its temporary app-storage copy could not be removed automatically.",
    };
  }

  const historyDelete = await admin
    .from("crew_onboarding_documents")
    .delete()
    .eq("crew_id", crewId)
    .eq("document_type", documentType)
    .eq("storage_path", storagePath);
  const historyMessage = historyDelete.error?.message || "";
  if (
    historyDelete.error &&
    !/crew_onboarding_documents|schema cache|relation/i.test(historyMessage)
  ) {
    return {
      storagePath: driveArchive.storagePath,
      archived: true,
      warning:
        "The approved PDF was archived to Google Drive, but its old document-history row could not be removed automatically.",
    };
  }

  return {
    storagePath: driveArchive.storagePath,
    archived: true,
    warning: null as string | null,
  };
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

type OnboardingAccess = {
  user: { id: string; email?: string | null };
  role: string;
  fullName: string;
};

function onboardingSenderFooter(fullName: unknown) {
  const name = safeText(fullName) || "ELS Coordinator";
  return `Coordinator: ${name}\nEmanuel Labor Services`;
}

async function requireOnboardingAccess() {
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
    .select("role, full_name, email")
    .eq("id", user.id)
    .maybeSingle();
  const role = normalizeRole(
    (profile as { role?: string | null } | null)?.role,
  );
  if (!(isOwnerAdmin(role) || role === "coordinator"))
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          message:
            "Only owner, admin, or coordinator users can use the onboarding center.",
        },
        { status: 403 },
      ),
    };
  return {
    ok: true as const,
    user,
    role,
    fullName:
      safeText((profile as { full_name?: string | null } | null)?.full_name) ||
      safeText((profile as { email?: string | null } | null)?.email) ||
      safeText(user.email) ||
      "ELS Coordinator",
  } satisfies { ok: true; user: OnboardingAccess["user"]; role: string; fullName: string };
}

async function requireOwnerAdmin() {
  const auth = await requireOnboardingAccess();
  if (!auth.ok) return auth;
  if (!isOwnerAdmin(auth.role))
    return {
      ok: false as const,
      response: NextResponse.json(
        {
          message:
            "Only owner/admin can review private onboarding documents or approve onboarding packets.",
        },
        { status: 403 },
      ),
    };
  return auth;
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
  const isCompletedStatus = status === "submitted" || status === "approved";
  if (!isCompletedStatus && expiresAt && new Date(expiresAt).getTime() < Date.now())
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
      { message: "Work photos are no longer part of ELS onboarding. Upload only the required profile photo." },
      { status: 400 },
    );
  if (action === "upload_public_document" && (documentType === "w9" || documentType === "contract"))
    return NextResponse.json(
      {
        message:
          documentType === "w9"
            ? "Complete and sign the W-9 in the secure form. File uploads are not used for crew onboarding."
            : "Complete and sign the Independent Contractor Agreement in the secure form. File uploads are not used for crew onboarding.",
      },
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

  const driveArchive =
    action === "admin_upload_document"
      ? await archiveUploadedDocumentToGoogleDrive(
          admin,
          crewId,
          documentType,
          fileValue,
          bytes,
          uploadCrewName,
          uploadMainCity,
        ).catch((error) => {
          archiveWarning =
            error instanceof Error
              ? error.message
              : "Google Drive archive failed; saved to Supabase instead.";
          return null;
        })
      : null;

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
    message:
      warning ||
      archiveWarning ||
      (bucketId === "google-drive"
        ? "File archived securely in Google Drive."
        : action === "upload_public_document" &&
            (documentType === "w9" || documentType === "contract")
          ? "File uploaded securely. It will be archived to Google Drive after owner approval."
          : "File uploaded securely."),
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
  const signerSignature = embeddedSignatureJpeg(
    w9.signature_data_url,
    "W-9 signature",
  );
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
  content += drawJpegCommand(
    "W9Signature",
    signerSignature,
    margin + 2,
    y - 33,
    250,
    42,
  );
  textLine("Electronic signature of U.S. person", margin, y - 50, 8.5, "F1");
  drawLine(margin + 310, y - 36, margin + 500, y - 36);
  textLine(submittedAt.slice(0, 10), margin + 314, y - 26, 11, "F1");
  textLine("Date", margin + 310, y - 50, 8.5, "F1");
  y -= 76;
  wrapped(`Submission audit: signed electronically by ${w9.signer_name} through ELS secure onboarding on ${submittedAt}. TIN type ${w9.tin_type.toUpperCase()} ending ${w9.tin_last4}.`, 100, 8.5, 10);

  if (content.trim()) pages.push(content);

  return buildPdfWithJpegResources(
    pages,
    pageWidth,
    pageHeight,
    { W9Signature: signerSignature },
    "ELS-W9",
  );

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
      queued_by_name: auth.fullName,
      crew_id: crewId,
      crew_name: crewName,
      phone,
      body: [
        `Hi ${firstName}, ${auth.fullName} with Emanuel Labor Services reviewed your onboarding packet and needs one correction before it can be approved:`,
        correctionNote,
        "Please reopen your secure link, update the needed item, and resubmit:",
        link,
        onboardingSenderFooter(auth.fullName),
      ].join("\n\n"),
      status: "scheduled",
      scheduled_for: new Date(Date.now() + 30_000).toISOString(),
      created_at: nowIso,
      error: null,
    });
  }

  return NextResponse.json({ ok: true, link, queued, payload: nextPayload, message: queued ? "Correction request queued for the iPhone Shortcut." : "Correction request saved. No text was queued because this contact has no valid phone number." });
}

async function listOnboardingReviewQueue(admin: SupabaseAdmin, request: Request) {
  const auth = await requireOnboardingAccess();
  if (!auth.ok) return auth.response;
  const canReview = isOwnerAdmin(auth.role);

  const requests = await admin
    .from("crew_onboarding_requests")
    .select("id, crew_id, token, status, sent_by, sent_at, opened_at, submitted_at, expires_at, submission_payload, created_at, updated_at")
    .in("status", ["sent", "opened", "submitted", "approved", "correction_requested"])
    .order("updated_at", { ascending: false })
    .limit(300);
  if (requests.error) {
    const message = requests.error.message || "";
    if (/crew_onboarding_requests|schema cache|relation/i.test(message)) {
      return NextResponse.json({ message: "Onboarding requests are not set up. Run the onboarding SQL migrations first." }, { status: 400 });
    }
    throw new Error(message);
  }

  const allRows = (requests.data ?? []) as Record<string, unknown>[];
  const rows = canReview
    ? allRows.slice(0, 150)
    : allRows.filter((row) => requestWasSentByUser(row, auth.user.id)).slice(0, 150);
  const crewIds = Array.from(new Set(rows.map((row) => safeText(row.crew_id)).filter(Boolean)));
  const crewById = new Map<string, Record<string, unknown>>();
  const taxByCrewId = new Map<string, Record<string, unknown>>();

  if (crewIds.length) {
    // Keep the admin and coordinator projections as separate literal selects.
    // Supabase's generated SelectQueryParser cannot safely infer a conditional
    // select string here and turns the result into ParserError during `next build`.
    let crewRows: Record<string, unknown>[] = [];
    if (canReview) {
      const crewRes = await admin
        .from("crew")
        .select("id, name, email, phone, address, onboarding_status, questionnaire_status, w9_status, contract_status, tax_profile_status, profile_photo_url, work_photo_urls, w9_document_url, contract_document_url, tax_profile_notes, notes")
        .in("id", crewIds);
      if (crewRes.error) throw new Error(crewRes.error.message);
      crewRows = (crewRes.data ?? []) as unknown as Record<string, unknown>[];
    } else {
      const crewRes = await admin
        .from("crew")
        .select("id, name, email, phone, onboarding_status")
        .in("id", crewIds);
      if (crewRes.error) throw new Error(crewRes.error.message);
      crewRows = (crewRes.data ?? []) as unknown as Record<string, unknown>[];
    }
    for (const row of crewRows) crewById.set(safeText(row.id), row);

    if (canReview) {
      const taxRes = await admin
        .from("crew_tax_profiles")
        .select("crew_id, tax_legal_name, business_name, federal_tax_classification, llc_tax_classification, other_classification, tax_address_line_1, tax_city_state_zip, tin_type, tin_last4, signer_name, certification_confirmed, signed_at, source, updated_at")
        .in("crew_id", crewIds);
      if (!taxRes.error) {
        for (const row of taxRes.data ?? []) taxByCrewId.set(safeText((row as { crew_id?: string }).crew_id), row as Record<string, unknown>);
      }
    }
  }

  // Owner/admin review also repairs legacy contract rows. Coordinators never receive
  // or process private document or tax data.
  if (canReview) {
    for (const requestRow of rows) {
      const typed = requestRow as Record<string, unknown>;
      const status = safeText(typed.status);
      if (status !== "submitted") continue;
      const requestType = normalizeRequestType(getPayloadObject(typed.submission_payload).request_type);
      if (requestType === "w9_only") continue;
      const payload = getPayloadObject(typed.submission_payload);
      const crewId = safeText(typed.crew_id);
      const crew = crewById.get(crewId) || {};
      const profilePath = safeText(payload.profile_photo_url) || safeText(crew.profile_photo_url);
      const currentContractPath = safeText(payload.contract_document_url) || safeText(crew.contract_document_url);
      const signatureData = safeText(payload.contract_signature_data_url);
      if (isPdfDocumentReference(currentContractPath) && currentContractPath !== profilePath) continue;
      if (!isSignatureImage(signatureData)) continue;

      const contractSignature = sanitizeContractSignature(
        { ...getPayloadObject(payload.contract_signature), signature_data_url: signatureData },
        safeText(payload.legal_name) || safeText(crew.name),
      );
      if (contractMissingFields(contractSignature).length) continue;

      try {
        const requestId = safeText(typed.id);
        const mainCity = safeText(payload.primary_city_pool_id)
          ? await cityPoolNameById(admin, safeText(payload.primary_city_pool_id))
          : "";
        const generatedPath = await saveGeneratedContractPdf(
          admin,
          crewId,
          requestId,
          contractSignature,
          safeText(typed.submitted_at) || new Date().toISOString(),
          safeText(payload.legal_name) || safeText(crew.name),
          mainCity,
        );
        payload.contract_document_url = generatedPath;
        typed.submission_payload = payload;
        await admin
          .from("crew_onboarding_requests")
          .update({ submission_payload: payload, updated_at: new Date().toISOString() })
          .eq("id", requestId);
        await admin
          .from("crew")
          .update({ contract_document_url: generatedPath, contract_status: "uploaded", updated_at: new Date().toISOString() })
          .eq("id", crewId);
        crew.contract_document_url = generatedPath;
        crew.contract_status = "uploaded";
      } catch {
        // Keep the review queue usable even if a legacy row cannot be repaired automatically.
      }
    }
  }

  const senderIds = Array.from(new Set(rows.flatMap((row) => {
    const payload = getPayloadObject(row.submission_payload);
    return [safeText(row.sent_by), ...onboardingSendHistory(payload).map((entry) => safeText(entry.user_id))].filter(Boolean);
  })));
  const senderById = new Map<string, { id: string; full_name: string; email: string }>();
  if (senderIds.length) {
    const senderRes = await admin.from("profiles").select("id, full_name, email").in("id", senderIds);
    if (!senderRes.error) {
      for (const row of senderRes.data || []) {
        const typed = row as { id?: string | null; full_name?: string | null; email?: string | null };
        const id = safeText(typed.id);
        if (id) senderById.set(id, { id, full_name: safeText(typed.full_name), email: safeText(typed.email) });
      }
    }
  }

  const cityPoolsRes = canReview
    ? await admin.from("city_pools").select("id, name").order("name", { ascending: true })
    : { data: [] as unknown[] };
  const ratesRes = canReview
    ? await admin.from("master_rates").select("role_name").order("role_name", { ascending: true })
    : { data: [] as unknown[] };
  const positionOptions = Array.from(new Set((ratesRes.data || []).map((row) => safeText((row as { role_name?: string | null }).role_name)).filter(Boolean)));

  return NextResponse.json({
    ok: true,
    viewer_role: auth.role,
    can_review: canReview,
    current_user_id: auth.user.id,
    current_user_name: auth.fullName,
    city_pools: publicOnboardingCityPools(cityPoolsRes.data),
    position_options: positionOptions,
    rows: rows.map((requestRow) => {
      const typed = requestRow as Record<string, unknown>;
      const crewId = safeText(typed.crew_id);
      const crew = crewById.get(crewId) || {};
      const payload = getPayloadObject(typed.submission_payload);
      const requestType = normalizeRequestType(payload.request_type);
      const history = onboardingSendHistory(payload);
      const latestHistory = history.length ? history[history.length - 1] : null;
      const originalSenderId = safeText(typed.sent_by);
      const latestSenderId = safeText(latestHistory?.user_id) || originalSenderId;
      const senderProfile = senderById.get(latestSenderId) || senderById.get(originalSenderId);
      const safePayload = canReview
        ? payload
        : {
            request_type: requestType,
            invite_name: safeText(payload.invite_name) || safeText(crew.name),
            invite_phone: safeText(payload.invite_phone) || safeText(crew.phone),
            invite_email: safeText(payload.invite_email) || safeText(crew.email),
            correction_note: safeText(payload.correction_note),
          };
      const requestStatus = safeText(typed.status);
      const safeCrew = canReview
        ? crew
        : {
            id: crewId,
            name: safeText(crew.name),
            phone: safeText(crew.phone),
            email: safeText(crew.email),
            onboarding_complete: Boolean(
              safeText(crew.onboarding_status) === "approved" || requestStatus === "approved"
            ),
            progress_status: requestStatus === "approved"
              ? "complete"
              : requestStatus === "submitted"
                ? "submitted_for_admin_review"
                : ["sent", "opened", "correction_requested"].includes(requestStatus)
                  ? "in_progress"
                  : "not_started",
          };
      return {
        id: safeText(typed.id),
        crew_id: crewId,
        status: safeText(typed.status),
        request_type: requestType,
        sent_by_user_id: latestSenderId,
        sent_by_name: safeText(latestHistory?.user_name) || senderProfile?.full_name || senderProfile?.email || "ELS user",
        sent_by_email: safeText(latestHistory?.user_email) || senderProfile?.email || "",
        send_history_count: history.length || (originalSenderId ? 1 : 0),
        sent_at: safeText(typed.sent_at),
        opened_at: safeText(typed.opened_at),
        submitted_at: safeText(typed.submitted_at),
        expires_at: safeText(typed.expires_at),
        updated_at: safeText(typed.updated_at),
        link: onboardingLinkForRequest(request, safeText(typed.token), requestType),
        payload: safePayload,
        crew: safeCrew,
        tax_profile: canReview ? taxByCrewId.get(crewId) || null : null,
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
  let w9Document = safeText(payload.w9_document_url) || safeText(existingCrew.w9_document_url);
  let contractDocument = safeText(payload.contract_document_url) || safeText(existingCrew.contract_document_url);

  if (requestType !== "w9_only" && (!isPdfDocumentReference(contractDocument) || contractDocument === profilePhoto)) {
    const signatureData = safeText(payload.contract_signature_data_url);
    if (isSignatureImage(signatureData)) {
      const contractSignature = sanitizeContractSignature(
        {
          ...getPayloadObject(payload.contract_signature),
          signature_data_url: signatureData,
        },
        safeText(payload.legal_name) || safeText(existingCrew.name),
      );
      if (!contractMissingFields(contractSignature).length) {
        const repairMainCity = safeText(payload.primary_city_pool_id)
          ? await cityPoolNameById(admin, safeText(payload.primary_city_pool_id))
          : "";
        contractDocument = await saveGeneratedContractPdf(
          admin,
          crewId,
          requestId,
          contractSignature,
          safeText(requestRow.submitted_at) || new Date().toISOString(),
          safeText(payload.legal_name) || safeText(existingCrew.name),
          repairMainCity,
        );
        payload.contract_document_url = contractDocument;
        await admin
          .from("crew_onboarding_requests")
          .update({ submission_payload: payload, updated_at: new Date().toISOString() })
          .eq("id", requestId);
      }
    }
  }

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

  const archiveWarnings: string[] = [];
  const approvedCrewName =
    safeText(payload.legal_name) || safeText(existingCrew.name) || crewId;
  const approvedMainCity = safeText(payload.primary_city_pool_id)
    ? await cityPoolNameById(admin, safeText(payload.primary_city_pool_id))
    : safeText(existingCrew.city_pool_id)
      ? await cityPoolNameById(admin, safeText(existingCrew.city_pool_id))
      : "";

  if (requestType !== "contract_only" && w9Document) {
    const archivedW9 = await archiveApprovedPdfToGoogleDrive(
      admin,
      crewId,
      requestId,
      "w9",
      w9Document,
      approvedCrewName,
      approvedMainCity,
    );
    w9Document = archivedW9.storagePath;
    payload.w9_document_url = w9Document;
    if (archivedW9.warning) archiveWarnings.push(archivedW9.warning);
  }

  if (requestType !== "w9_only" && contractDocument) {
    const archivedContract = await archiveApprovedPdfToGoogleDrive(
      admin,
      crewId,
      requestId,
      "contract",
      contractDocument,
      approvedCrewName,
      approvedMainCity,
    );
    contractDocument = archivedContract.storagePath;
    payload.contract_document_url = contractDocument;
    if (archivedContract.warning) archiveWarnings.push(archivedContract.warning);
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
        if (!roleName) continue;
        const storedRate = Number((row as { rate?: number | string | null }).rate || 0);
        const defaultRate = getDefaultCrewPayRate(roleName);
        positionMap.set(roleName.toLowerCase(), {
          role_name: roleName,
          // Never overwrite an established custom rate. Only repair a zero rate
          // when this is a recognized ELS role with a defined default.
          rate: storedRate > 0 ? storedRate : defaultRate > 0 ? defaultRate : 0,
        });
      }
      for (const roleName of submittedPositions) {
        const key = roleName.toLowerCase();
        if (!positionMap.has(key)) {
          const defaultRate = getDefaultCrewPayRate(roleName);
          positionMap.set(key, { role_name: roleName, rate: defaultRate > 0 ? defaultRate : 0 });
        }
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

  return NextResponse.json({
    ok: true,
    crew_id: crewId,
    crew_patch: patch,
    archive_warnings: archiveWarnings,
    message: archiveWarnings.length
      ? `Onboarding approved and applied to Crew/Tax records. ${archiveWarnings.join(" ")}`
      : "Onboarding approved, applied to Crew/Tax records, and archived to Google Drive.",
  });
}

export async function GET(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin)
    return NextResponse.json(
      { message: "SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 500 },
    );
  const action = new URL(request.url).searchParams.get("action") || "";
  if (action === "coordinator_dashboard") {
    try {
      return await coordinatorOnboardingDashboard(admin);
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to load onboarding." }, { status: 400 });
    }
  }
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
      return await listOnboardingReviewQueue(admin, request);
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
      if (status === "submitted" || status === "approved") {
        return NextResponse.json({
          ok: true,
          request_type: requestType,
          status,
          locked: true,
          approved: status === "approved",
        });
      }
      const payload = getPayloadObject((requestRow as { submission_payload?: unknown }).submission_payload);
      const responsePayload: Record<string, unknown> = { ...payload };
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
      if (status === "correction_requested" && crewId) {
        const savedTaxRes = await admin
          .from("crew_tax_profiles")
          .select("tin_last4, signature_data_url")
          .eq("crew_id", crewId)
          .maybeSingle();
        if (!savedTaxRes.error && savedTaxRes.data) {
          const currentDigital = getPayloadObject(responsePayload.digital_w9);
          const savedSignature = safeText((savedTaxRes.data as { signature_data_url?: string | null }).signature_data_url);
          responsePayload.digital_w9 = {
            ...currentDigital,
            tin_last4:
              safeText((savedTaxRes.data as { tin_last4?: string | null }).tin_last4) ||
              safeText(currentDigital.tin_last4),
            signature_data_url: isSignatureImage(savedSignature)
              ? savedSignature
              : RETAINED_W9_SIGNATURE,
          };
        }

        const currentContract = getPayloadObject(responsePayload.contract_signature);
        const savedContractSignature = safeText(responsePayload.contract_signature_data_url);
        if (isSignatureImage(savedContractSignature)) {
          responsePayload.contract_signature = {
            ...currentContract,
            signature_data_url: savedContractSignature,
          };
        } else if (Boolean(currentContract.signature_captured)) {
          responsePayload.contract_signature = {
            ...currentContract,
            signature_data_url: RETAINED_CONTRACT_SIGNATURE,
          };
        }
      }

      const cityPoolsRes = await admin.from("city_pools").select("id, name").order("name", { ascending: true });
      const ratesRes = await admin.from("master_rates").select("role_name").order("role_name", { ascending: true });
      const positionOptions = Array.from(new Set((ratesRes.data || []).map((row) => safeText((row as { role_name?: string | null }).role_name)).filter(Boolean)));
      return NextResponse.json({
        ok: true,
        city_pools: publicOnboardingCityPools(cityPoolsRes.data),
        position_options: positionOptions,
        request_type: requestType,
        status: status === "sent" ? "opened" : status,
        expires_at:
          safeText((requestRow as { expires_at?: string | null }).expires_at) ||
          null,
        correction_note: safeText(payload.correction_note),
        payload: responsePayload,
        crew,
      });
    }

    if (action === "resend_request") {
      const auth = await requireOnboardingAccess();
      if (!auth.ok) return auth.response;
      const requestId = safeText(body.request_id);
      if (!requestId) return NextResponse.json({ message: "request_id is required." }, { status: 400 });

      const requestRes = await admin
        .from("crew_onboarding_requests")
        .select("id, crew_id, token, status, sent_by, sent_at, expires_at, submission_payload")
        .eq("id", requestId)
        .maybeSingle();
      if (requestRes.error) throw new Error(requestRes.error.message);
      if (!requestRes.data) return NextResponse.json({ message: "Onboarding request not found." }, { status: 404 });
      const requestRow = requestRes.data as Record<string, unknown>;
      if (!isOwnerAdmin(auth.role) && !requestWasSentByUser(requestRow, auth.user.id)) {
        return NextResponse.json({ message: "You can only resend onboarding links that you sent." }, { status: 403 });
      }
      const status = safeText(requestRow.status);
      if (["submitted", "approved"].includes(status)) {
        return NextResponse.json({ message: status === "approved" ? "This onboarding packet is already approved." : "This onboarding packet has already been submitted for admin review." }, { status: 400 });
      }

      const crewId = safeText(requestRow.crew_id);
      const crewRes = await admin.from("crew").select("id, name, phone").eq("id", crewId).maybeSingle();
      if (crewRes.error) throw new Error(crewRes.error.message);
      if (!crewRes.data) return NextResponse.json({ message: "Crew contact not found." }, { status: 404 });
      const crewName = safeText((crewRes.data as { name?: string | null }).name) || "there";
      const firstName = crewName.split(/\s+/)[0] || "there";
      const phone = cleanPhone((crewRes.data as { phone?: string | null }).phone);
      if (!phone) return NextResponse.json({ message: "This contact does not have a valid phone number." }, { status: 400 });

      const requestType = requestTypeFromRow(requestRow);
      const token = safeText(requestRow.token);
      const link = onboardingLinkForRequest(request, token, requestType);
      const nowIso = new Date().toISOString();
      const currentPayload = getPayloadObject(requestRow.submission_payload);
      const nextPayload = appendOnboardingSendHistory(currentPayload, auth, nowIso, "reminder", true);
      const currentExpiry = safeText(requestRow.expires_at);
      const expiresAt = currentExpiry && new Date(currentExpiry).getTime() > Date.now() + 1000 * 60 * 60 * 24 * 7
        ? currentExpiry
        : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      const update = await admin
        .from("crew_onboarding_requests")
        .update({ sent_at: nowIso, expires_at: expiresAt, submission_payload: nextPayload, updated_at: nowIso })
        .eq("id", requestId);
      if (update.error) throw new Error(update.error.message);

      const queued = await insertIntroQueue(admin, {
        queued_by_user_id: auth.user.id,
        queued_by_email: auth.user.email || null,
        queued_by_name: auth.fullName,
        crew_id: crewId,
        crew_name: crewName,
        phone,
        body: [
          `Hi ${firstName}, ${auth.fullName} with Emanuel Labor Services is reminding you to complete your secure ELS onboarding packet.`,
          "Please reopen the same secure link:",
          link,
          "Please use the secure form for all W-9 and tax information. Thank you.",
          onboardingSenderFooter(auth.fullName),
        ].join("\n\n"),
        status: "scheduled",
        scheduled_for: new Date(Date.now() + 30_000).toISOString(),
        created_at: nowIso,
        error: null,
      });
      return NextResponse.json({ ok: true, link, queued, message: "Onboarding reminder queued using the same secure link." });
    }

    if (action === "create_new_crew_request") {
      const auth = await requireOnboardingAccess();
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
          `Created from Onboarding Center by ${auth.fullName}: ${nowIso}`,
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

      const requestType: OnboardingRequestType = "full_onboarding";
      const normalizedPhone = cleanPhone(phone);
      const willQueue = Boolean(normalizedPhone && body.queue_text !== false);
      const reusable = await findReusableOnboardingRequest(admin, crewId, requestType);
      const token = reusable ? safeText(reusable.token) : crypto.randomBytes(32).toString("base64url");
      const currentExpiry = reusable ? safeText(reusable.expires_at) : "";
      const expiresAt = currentExpiry && new Date(currentExpiry).getTime() > Date.now() + 1000 * 60 * 60 * 24 * 7
        ? currentExpiry
        : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      const basePayload = reusable ? getPayloadObject(reusable.submission_payload) : {};
      const requestPayload = appendOnboardingSendHistory({
        ...basePayload,
        request_type: requestType,
        invite_name: name,
        invite_phone: phone,
        invite_email: email,
        provisional_contact: !existingContact,
      }, auth, nowIso, reusable ? "reused" : "created", willQueue);

      let requestRow: Record<string, unknown>;
      if (reusable) {
        const updated = await admin
          .from("crew_onboarding_requests")
          .update({
            sent_at: nowIso,
            expires_at: expiresAt,
            submission_payload: requestPayload,
            updated_at: nowIso,
          })
          .eq("id", safeText(reusable.id))
          .select("id, crew_id, token, status, sent_by, sent_at, expires_at, submission_payload")
          .single();
        if (updated.error) throw new Error(updated.error.message);
        requestRow = updated.data as Record<string, unknown>;
      } else {
        const requestInsert = await admin
          .from("crew_onboarding_requests")
          .insert({
            crew_id: crewId,
            token,
            status: "sent",
            sent_by: auth.user.id,
            sent_at: nowIso,
            expires_at: expiresAt,
            submission_payload: requestPayload,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select("id, crew_id, token, status, sent_by, sent_at, expires_at, submission_payload")
          .single();
        if (requestInsert.error) throw new Error(requestInsert.error.message);
        requestRow = requestInsert.data as Record<string, unknown>;
      }

      if (!reusable || safeText(reusable.status) !== "correction_requested") {
        await admin.from("crew").update({
          onboarding_status: existingContact ? "request_sent" : "pending_contact",
          questionnaire_status: "requested",
          w9_status: "requested",
          contract_status: "requested",
          tax_profile_status: "requested",
          onboarding_request_sent_at: nowIso,
          updated_at: nowIso,
        }).eq("id", crewId);
      } else {
        await admin.from("crew").update({ onboarding_request_sent_at: nowIso, updated_at: nowIso }).eq("id", crewId);
      }

      const link = onboardingLinkForRequest(request, token, requestType);
      const firstName = name.split(/\s+/)[0] || "there";
      let queued = null as unknown;
      if (willQueue) {
        queued = await insertIntroQueue(admin, {
          queued_by_user_id: auth.user.id,
          queued_by_email: auth.user.email || null,
          queued_by_name: auth.fullName,
          crew_id: crewId,
          crew_name: name,
          phone: normalizedPhone,
          body: [
            `Hi ${firstName}, ${auth.fullName} with Emanuel Labor Services has invited you to complete your onboarding.`,
            "Please complete your secure ELS onboarding questionnaire, profile photo, W-9, and contractor agreement using this link:",
            link,
            "Please do not send SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
            onboardingSenderFooter(auth.fullName),
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
        reused_link: Boolean(reusable),
        link,
        request: requestRow,
        queued,
        message: reusable
          ? queued
            ? "Existing active onboarding link reused and queued again. Admin and coordinator invitations now point to the same packet."
            : "Existing active onboarding link reused. Admin and coordinator invitations point to the same packet."
          : queued
            ? existingContact
              ? "Existing contact found. Full onboarding request queued for the iPhone Shortcut."
              : "Pending onboarding record created and request queued for the iPhone Shortcut."
            : existingContact
              ? "Existing contact found and onboarding link created."
              : "Pending onboarding record created and link ready to send.",
      });
    }

    if (action === "create_request") {
      const auth = await requireOnboardingAccess();
      if (!auth.ok) return auth.response;

      const crewId = safeText(body.crew_id);
      const requestType = normalizeRequestType(body.request_type ?? body.mode);
      if (auth.role === "coordinator" && requestType !== "full_onboarding") {
        return NextResponse.json({ message: "Coordinators can send the full onboarding packet. W-9-only and contract-only requests remain owner/admin actions." }, { status: 403 });
      }
      if (!crewId)
        return NextResponse.json(
          { message: "crew_id is required." },
          { status: 400 },
        );
      let crew: Record<string, unknown> | null = null;
      if (auth.role === "coordinator") {
        const scopedAuth = await onboardingSenderContext();
        if (!scopedAuth.ok) return scopedAuth.response;
        crew = await scopedCrewForOnboarding(admin, scopedAuth.context, crewId) as Record<string, unknown> | null;
      } else {
        const crewResult = await admin
          .from("crew")
          .select("id, name, phone, email")
          .eq("id", crewId)
          .maybeSingle();
        if (crewResult.error) throw new Error(crewResult.error.message);
        crew = crewResult.data as Record<string, unknown> | null;
      }
      if (!crew)
        return NextResponse.json(
          { message: auth.role === "coordinator" ? "Crew contact was not found in your assigned crew pool." : "Crew contact not found." },
          { status: 404 },
        );

      const nowIso = new Date().toISOString();
      const phone = cleanPhone((crew as { phone?: string | null }).phone);
      const willQueue = Boolean(phone && body.queue_text !== false);
      const reusable = await findReusableOnboardingRequest(admin, crewId, requestType);
      const token = reusable ? safeText(reusable.token) : crypto.randomBytes(32).toString("base64url");
      const currentExpiry = reusable ? safeText(reusable.expires_at) : "";
      const expiresAt = currentExpiry && new Date(currentExpiry).getTime() > Date.now() + 1000 * 60 * 60 * 24 * 7
        ? currentExpiry
        : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
      const payload = appendOnboardingSendHistory({
        ...(reusable ? getPayloadObject(reusable.submission_payload) : {}),
        request_type: requestType,
      }, auth, nowIso, reusable ? "reused" : "created", willQueue);


      let requestRow: Record<string, unknown>;
      if (reusable) {
        const updated = await admin
          .from("crew_onboarding_requests")
          .update({ sent_at: nowIso, expires_at: expiresAt, submission_payload: payload, updated_at: nowIso })
          .eq("id", safeText(reusable.id))
          .select("id, crew_id, token, status, sent_by, sent_at, expires_at, submission_payload")
          .single();
        if (updated.error) throw new Error(updated.error.message);
        requestRow = updated.data as Record<string, unknown>;
      } else {
        const inserted = await admin
          .from("crew_onboarding_requests")
          .insert({
            crew_id: crewId,
            token,
            status: "sent",
            sent_by: auth.user.id,
            sent_at: nowIso,
            expires_at: expiresAt,
            submission_payload: payload,
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select("id, crew_id, token, status, sent_by, sent_at, expires_at, submission_payload")
          .single();
        if (inserted.error) {
          if ((inserted.error.message || "").includes("crew_onboarding_requests")) {
            return NextResponse.json(
              { message: "Run ELS210_required_sql.sql once in Supabase to create crew_onboarding_requests." },
              { status: 400 },
            );
          }
          throw new Error(inserted.error.message);
        }
        requestRow = inserted.data as Record<string, unknown>;
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
      if (!reusable || safeText(reusable.status) !== "correction_requested") {
        await admin.from("crew").update(crewStatusPatch).eq("id", crewId);
      }

      const link = onboardingLinkForRequest(request, token, requestType);
      const crewName = safeText((crew as { name?: string | null }).name) || "there";
      const firstName = crewName.split(/\s+/)[0] || "there";
      const messageBody =
        requestType === "w9_only"
          ? [
              `Hi ${firstName}, ${auth.fullName} with Emanuel Labor Services is requesting your W-9 for ELS tax/1099 records.`,
              "Please complete and sign it through this secure link:",
              link,
              "Please do not send your SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
              onboardingSenderFooter(auth.fullName),
            ].join("\n\n")
          : requestType === "contract_only"
            ? [
                `Hi ${firstName}, ${auth.fullName} with Emanuel Labor Services is requesting your Independent Contractor Agreement.`,
                "Please complete and sign it through this secure link:",
                link,
                "Thank you.",
                onboardingSenderFooter(auth.fullName),
              ].join("\n\n")
            : [
                `Hi ${firstName}, ${auth.fullName} with Emanuel Labor Services has invited you to complete your onboarding.`,
                "Please complete your secure onboarding packet using this link:",
                link,
                "Please do not send your SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
                onboardingSenderFooter(auth.fullName),
              ].join("\n\n");

      let queued = null as unknown;
      if (willQueue) {
        queued = await insertIntroQueue(admin, {
          queued_by_user_id: auth.user.id,
          queued_by_email: auth.user.email || null,
          queued_by_name: auth.fullName,

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
        reused_link: Boolean(reusable),
        request_type: requestType,
        request: requestRow,
        queued,
        message: reusable
          ? queued
            ? "Existing active onboarding link reused and queued again."
            : "Existing active onboarding link reused."
          : queued
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
      const requestStatus = safeText(
        (requestRow as { status?: string | null }).status,
      );
      if (requestStatus === "submitted" || requestStatus === "approved") {
        return NextResponse.json(
          {
            message:
              "This onboarding packet has already been submitted and is locked. Emanuel Labor Services must send it back for correction before it can be edited or resubmitted.",
          },
          { status: 409 },
        );
      }
      const previousPayload = getPayloadObject(
        (requestRow as { submission_payload?: unknown }).submission_payload,
      );
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
      // Crew-facing full onboarding and W-9-only requests must use the
      // structured in-app W-9 so tax fields are saved directly and the
      // substitute W-9 PDF is generated from the submitted data.
      const w9UseDigital = requestType !== "contract_only";
      const digitalW9Source = getPayloadObject(body.digital_w9);
      let digitalW9 = sanitizeDigitalW9(body.digital_w9);
      const reuseSavedTin = Boolean(digitalW9Source.tin_retained);
      const reuseSavedW9Signature =
        digitalW9.signature_data_url === RETAINED_W9_SIGNATURE;

      if (w9UseDigital && (reuseSavedTin || reuseSavedW9Signature)) {
        const savedTaxRes = await admin
          .from("crew_tax_profiles")
          .select("tin_encrypted, tin_last4, signature_data_url")
          .eq("crew_id", crewId)
          .maybeSingle();
        if (!savedTaxRes.error && savedTaxRes.data) {
          const savedTax = savedTaxRes.data as {
            tin_encrypted?: string | null;
            tin_last4?: string | null;
            signature_data_url?: string | null;
          };
          if (reuseSavedTin && digitalW9.tin_digits.length !== 9) {
            const decryptedTin = decryptTin(savedTax.tin_encrypted);
            if (/^\d{9}$/.test(decryptedTin)) {
              digitalW9 = {
                ...digitalW9,
                tin_digits: decryptedTin,
                tin_last4: safeText(savedTax.tin_last4) || decryptedTin.slice(-4),
              };
            }
          }
          if (reuseSavedW9Signature && isSignatureImage(savedTax.signature_data_url)) {
            digitalW9 = {
              ...digitalW9,
              signature_data_url: safeText(savedTax.signature_data_url),
            };
          }
        }
      }

      const digitalW9Redacted = w9UseDigital
        ? redactedDigitalW9(digitalW9)
        : null;
      let contractSignature = sanitizeContractSignature(
        body.contract_signature,
        safeText(body.legal_name),
      );
      const savedContractSignature = safeText(previousPayload.contract_signature_data_url);
      if (
        contractSignature.signature_data_url === RETAINED_CONTRACT_SIGNATURE &&
        isSignatureImage(savedContractSignature)
      ) {
        contractSignature = {
          ...contractSignature,
          signature_data_url: savedContractSignature,
        };
      }
      const contractSignatureRedacted = redactedContractSignature(contractSignature);
      const contractSignatureForCorrection = isSignatureImage(
        contractSignature.signature_data_url,
      )
        ? contractSignature.signature_data_url
        : isSignatureImage(savedContractSignature)
          ? savedContractSignature
          : "";

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
        w9_document_url: "",
        contract_document_url: "",
        contract_signature: contractSignatureRedacted,
        contract_signature_data_url: contractSignatureForCorrection,
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
        const contractMissing = contractMissingFields(contractSignature);
        if (contractMissing.length)
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
        if (contractMissing.length) {
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
        if (!w9UseDigital) {
          return NextResponse.json(
            {
              message:
                "Please complete and sign the in-app W-9 before submitting.",
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
          payload.w9_document_url ? "W-9 PDF generated: yes" : "",
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
        payload.w9_document_url ? "W-9 PDF generated: yes" : "",
        payload.contract_document_url ? "Signed contract PDF generated: yes" : "",
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
