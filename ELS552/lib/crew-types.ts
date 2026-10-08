export type PositionInput = {
  id?: string;
  role_name: string;
  rate: number;
};

export type CrewRecord = {
  id: string;
  name: string;
  description: string;
  city_pool_id: string | null;
  city_name: string;
  additional_city_pool_ids: string[];
  additional_city_pool_names: string[];
  group_name: string;
  tier: string;
  email: string;
  phone: string;
  address: string;
  lead_from: string;
  other_city: string;
  ob: boolean;
  onboarding_texted_called: boolean;
  onboarding_response: boolean;
  onboarding_paperwork_sent: boolean;
  onboarding_successfully_onboarded: boolean;
  onboarding_called_placed_tier: boolean;
  onboarding_status?: string | null;
  w9_status?: string | null;
  contract_status?: string | null;
  questionnaire_status?: string | null;
  tax_profile_status?: string | null;
  profile_photo_url?: string | null;
  work_photo_urls?: string[];
  w9_document_url?: string | null;
  contract_document_url?: string | null;
  tax_profile_notes?: string | null;
  direct_deposit_ready?: boolean;
  onboarding_request_sent_at?: string | null;
  onboarding_completed_at?: string | null;
  blacklisted: boolean;
  blacklist_reason: string;
  notes: string;
  conflict_companies: string[];
  positions: PositionInput[];
  unavailable_dates: string[];
  created_by?: string | null;
  assigned_coordinator_user_ids?: string[];
  coordinator_hidden_at?: string | null;
  coordinator_hidden_by?: string | null;
  coordinator_hidden_reviewed_at?: string | null;
};

export const DIRECT_DEPOSIT_READY_MARKER = "[ELS_DIRECT_DEPOSIT_READY]";

export function directDepositReadyFromTaxNotes(value: unknown) {
  return String(value || "").includes(DIRECT_DEPOSIT_READY_MARKER);
}

export function taxNotesWithoutDirectDepositMarker(value: unknown) {
  return String(value || "").replaceAll(DIRECT_DEPOSIT_READY_MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function taxNotesWithDirectDepositReady(value: unknown, ready: boolean) {
  const clean = taxNotesWithoutDirectDepositMarker(value);
  return [clean, ready ? DIRECT_DEPOSIT_READY_MARKER : ""].filter(Boolean).join("\n");
}

export type CityPoolRecord = {
  id: string;
  name: string;
};

export type CrewGroupRecord = {
  id: string;
  city_pool_id: string;
  name: string;
};

/** A comparable key without conflating unrelated international country codes. */
export function phoneDigitsForMatch(value: unknown): string {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `local:${digits}` : "";
}

export function normalizePhoneForStorage(value: unknown): string {
  const raw = String(value ?? "").trim();
  const key = phoneDigitsForMatch(raw);
  if (key.startsWith("+1") && key.length === 12) {
    const n = key.slice(2);
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (raw.startsWith("+") && key.startsWith("+")) return key;
  return raw;
}

export function phoneForMessaging(value: unknown): string {
  const key = phoneDigitsForMatch(value);
  return key.startsWith("+") ? key : "";
}
