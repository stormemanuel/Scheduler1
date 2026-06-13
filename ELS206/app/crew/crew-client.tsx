"use client";

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CityPoolRecord, CrewGroupRecord, CrewRecord, PositionInput } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import type { AppUserSummaryRecord, TechRatingRecord } from "@/lib/client-types";
import { crewRoleRateOptions, getDefaultCrewPayRate } from "@/lib/crew-pay-defaults";

type CrewClientProps = {
  cityPools: CityPoolRecord[];
  crewGroups: CrewGroupRecord[];
  initialCrew: CrewRecord[];
  masterRates: MasterRateRecord[];
  initialRatings: TechRatingRecord[];
  appUsers: AppUserSummaryRecord[];
  currentUserId: string;
  currentUserName: string;
  currentUserRole: string;
};

type CrewRatingSummary = {
  average: number;
  median: number;
  count: number;
  lastRatingAt: string;
};

type CoordinatorRatingSummary = {
  median: number;
  average: number;
  ratedCrewCount: number;
  totalCrewCount: number;
};

type CrewDraft = {
  id?: string;
  name: string;
  description: string;
  city_pool_id: string;
  city_name: string;
  additional_city_pool_ids: string[];
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
  onboarding_status: string;
  w9_status: string;
  contract_status: string;
  questionnaire_status: string;
  tax_profile_status: string;
  profile_photo_url: string;
  work_photo_urls_text: string;
  w9_document_url: string;
  contract_document_url: string;
  tax_profile_notes: string;
  onboarding_request_sent_at: string;
  onboarding_completed_at: string;
  blacklisted: boolean;
  blacklist_reason: string;
  notes: string;
  resume_link: string;
  conflict_companies_text: string;
  unavailable_dates_text: string;
  positions: PositionInput[];
};

type CsvPreviewRow = {
  tempId: string;
  rowNumber: number;
  selected: boolean;
  row: Record<string, string>;
  draft: CrewDraft | null;
  poolNames: string[];
  warnings: string[];
  likelyDuplicate: string;
};

type DetailTab = "info" | "roles" | "availability" | "onboarding" | "notes" | "move";

const ALL_GROUPS = "__all_groups__";
const UNASSIGNED_CITY = "__unassigned_city__";
const MASTER_CREW_VIEW = "__master_crew_view__";

const CUSTOM_ROLE_OPTION = "__custom_role__";

const onboardingStatusOptions = [
  ["not_started", "Not started"],
  ["request_sent", "Request sent"],
  ["submitted", "Submitted"],
  ["needs_review", "Needs review"],
  ["approved", "Approved"],
  ["rejected", "Rejected / correction needed"],
] as const;

const documentStatusOptions = [
  ["missing", "Missing"],
  ["requested", "Requested"],
  ["uploaded", "Uploaded"],
  ["needs_review", "Needs review"],
  ["approved", "Approved"],
  ["rejected", "Rejected / correction needed"],
] as const;

function statusLabel(value: string | null | undefined, options: readonly (readonly [string, string])[]) {
  return options.find(([key]) => key === value)?.[1] || String(value || "Missing").replace(/_/g, " ");
}

function isCoordinatorSystemPoolName(name: string | null | undefined) {
  return normalizeText(String(name || "")).startsWith("coordinator ");
}

function isOwnerAdminRole(role: string | null | undefined) {
  const normalized = normalizeText(String(role || ""));
  return normalized === "owner" || normalized === "admin";
}

function possessiveFirstName(name: string | null | undefined) {
  const firstName = String(name || "Storm").trim().split(/\s+/)[0] || "Storm";
  return firstName.endsWith("s") ? `${firstName}'` : `${firstName}'s`;
}

function userDisplayName(user: AppUserSummaryRecord) {
  return user.full_name || user.email || "User";
}

function roleOptionLabel(option: { roleName: string; fullDay: number; halfDay: number | null }) {
  return `${option.roleName} — $${option.fullDay}${option.halfDay ? ` / $${option.halfDay} half` : ""}`;
}

function matchingDefaultRole(roleName: string, options = crewRoleRateOptions) {
  const normalized = normalizeText(roleName);
  if (!normalized) return null;
  return options.find((option) => normalizeText(option.roleName) === normalized) ?? null;
}

function shouldApplyDefaultRate(currentRole: string, currentRate: number) {
  const previousDefault = getDefaultCrewPayRate(currentRole);
  return !currentRate || !previousDefault || currentRate === previousDefault;
}

function numberInputValue(value: number | string | null | undefined) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? String(value) : "";
}

function extractResumeLink(notes: string) {
  const match = String(notes || "").match(/(?:^|\n)Resume(?: file| link)?:\s*(.+)(?:\n|$)/i);
  return match ? match[1].trim() : "";
}

function removeResumeLine(notes: string) {
  return String(notes || "").replace(/(?:^|\n)Resume(?: file| link)?:\s*.+(?=\n|$)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

function combineNotesAndResume(notes: string, resumeLink: string) {
  const cleanNotes = removeResumeLine(notes);
  const cleanResume = resumeLink.trim();
  return [cleanNotes, cleanResume ? `Resume: ${cleanResume}` : ""].filter(Boolean).join("\n\n");
}


function blankDraft(cityPools: CityPoolRecord[], cityId?: string, groupName?: string): CrewDraft {
  const chosenCity = cityPools.find((pool) => pool.id === cityId) || cityPools[0];
  return {
    name: "",
    description: "",
    city_pool_id: chosenCity?.id || "",
    city_name: chosenCity?.name || "",
    additional_city_pool_ids: [],
    group_name: groupName && groupName !== ALL_GROUPS ? groupName : "Ungrouped",
    tier: "",
    email: "",
    phone: "",
    address: "",
    lead_from: "",
    other_city: "",
    ob: false,
    onboarding_texted_called: false,
    onboarding_response: false,
    onboarding_paperwork_sent: false,
    onboarding_successfully_onboarded: false,
    onboarding_called_placed_tier: false,
    onboarding_status: "not_started",
    w9_status: "missing",
    contract_status: "missing",
    questionnaire_status: "missing",
    tax_profile_status: "missing",
    profile_photo_url: "",
    work_photo_urls_text: "",
    w9_document_url: "",
    contract_document_url: "",
    tax_profile_notes: "",
    onboarding_request_sent_at: "",
    onboarding_completed_at: "",
    blacklisted: false,
    blacklist_reason: "",
    notes: "",
    resume_link: "",
    conflict_companies_text: "",
    unavailable_dates_text: "",
    positions: [{ role_name: "", rate: 0 }],
  };
}

function draftFromRecord(record: CrewRecord): CrewDraft {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    city_pool_id: record.city_pool_id || "",
    city_name: record.city_name,
    additional_city_pool_ids: record.additional_city_pool_ids ?? [],
    group_name: record.group_name,
    tier: record.tier,
    email: record.email,
    phone: record.phone,
    address: record.address || "",
    lead_from: record.lead_from || "",
    other_city: record.other_city,
    ob: record.ob,
    onboarding_texted_called: Boolean(record.onboarding_texted_called),
    onboarding_response: Boolean(record.onboarding_response),
    onboarding_paperwork_sent: Boolean(record.onboarding_paperwork_sent),
    onboarding_successfully_onboarded: Boolean(record.onboarding_successfully_onboarded),
    onboarding_called_placed_tier: Boolean(record.onboarding_called_placed_tier),
    onboarding_status: record.onboarding_status || "not_started",
    w9_status: record.w9_status || "missing",
    contract_status: record.contract_status || "missing",
    questionnaire_status: record.questionnaire_status || "missing",
    tax_profile_status: record.tax_profile_status || "missing",
    profile_photo_url: record.profile_photo_url || "",
    work_photo_urls_text: (record.work_photo_urls || []).join("\n"),
    w9_document_url: record.w9_document_url || "",
    contract_document_url: record.contract_document_url || "",
    tax_profile_notes: record.tax_profile_notes || "",
    onboarding_request_sent_at: record.onboarding_request_sent_at || "",
    onboarding_completed_at: record.onboarding_completed_at || "",
    blacklisted: Boolean(record.blacklisted),
    blacklist_reason: record.blacklist_reason || "",
    notes: removeResumeLine(record.notes),
    resume_link: extractResumeLink(record.notes),
    conflict_companies_text: record.conflict_companies.join(", "),
    unavailable_dates_text: record.unavailable_dates.join("\n"),
    positions: record.positions.length ? record.positions.map((item) => ({ ...item })) : [{ role_name: "", rate: 0 }],
  };
}

function recordFromDraft(draft: CrewDraft, cityPools: CityPoolRecord[]): CrewRecord {
  const city = cityPools.find((pool) => pool.id === draft.city_pool_id);
  return {
    id: draft.id || `temp-${Math.random().toString(36).slice(2)}`,
    name: draft.name,
    description: draft.description,
    city_pool_id: draft.city_pool_id || null,
    city_name: city?.name || draft.city_name || "Unassigned",
    additional_city_pool_ids: draft.additional_city_pool_ids || [],
    additional_city_pool_names: (draft.additional_city_pool_ids || []).map((poolId) => cityPools.find((pool) => pool.id === poolId)?.name).filter((name): name is string => Boolean(name)),
    group_name: draft.group_name || "Ungrouped",
    tier: draft.tier,
    email: draft.email,
    phone: draft.phone,
    address: draft.address,
    lead_from: draft.lead_from,
    other_city: draft.other_city,
    ob: draft.ob,
    onboarding_texted_called: draft.onboarding_texted_called,
    onboarding_response: draft.onboarding_response,
    onboarding_paperwork_sent: draft.onboarding_paperwork_sent,
    onboarding_successfully_onboarded: draft.onboarding_successfully_onboarded,
    onboarding_called_placed_tier: draft.onboarding_called_placed_tier,
    onboarding_status: draft.onboarding_status,
    w9_status: draft.w9_status,
    contract_status: draft.contract_status,
    questionnaire_status: draft.questionnaire_status,
    tax_profile_status: draft.tax_profile_status,
    profile_photo_url: draft.profile_photo_url || null,
    work_photo_urls: draft.work_photo_urls_text.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    w9_document_url: draft.w9_document_url || null,
    contract_document_url: draft.contract_document_url || null,
    tax_profile_notes: draft.tax_profile_notes,
    onboarding_request_sent_at: draft.onboarding_request_sent_at || null,
    onboarding_completed_at: draft.onboarding_completed_at || null,
    blacklisted: draft.blacklisted,
    blacklist_reason: draft.blacklist_reason,
    notes: combineNotesAndResume(draft.notes, draft.resume_link),
    conflict_companies: draft.conflict_companies_text.split(",").map((item) => item.trim()).filter(Boolean),
    positions: draft.positions.filter((item) => item.role_name.trim()).map((item) => ({ id: item.id, role_name: item.role_name.trim(), rate: Number(item.rate || getDefaultCrewPayRate(item.role_name) || 0) })),
    unavailable_dates: draft.unavailable_dates_text.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
  };
}

function normalizePayload(draft: CrewDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    city_pool_id: draft.city_pool_id || null,
    city_name: draft.city_name || null,
    additional_city_pool_ids: draft.additional_city_pool_ids || [],
    group_name: draft.group_name.trim() || "Ungrouped",
    tier: draft.tier.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    address: draft.address.trim(),
    lead_from: draft.lead_from.trim(),
    other_city: draft.other_city.trim(),
    ob: draft.ob,
    onboarding_texted_called: draft.onboarding_texted_called,
    onboarding_response: draft.onboarding_response,
    onboarding_paperwork_sent: draft.onboarding_paperwork_sent,
    onboarding_successfully_onboarded: draft.onboarding_successfully_onboarded,
    onboarding_called_placed_tier: draft.onboarding_called_placed_tier,
    onboarding_status: draft.onboarding_status || "not_started",
    w9_status: draft.w9_status || "missing",
    contract_status: draft.contract_status || "missing",
    questionnaire_status: draft.questionnaire_status || "missing",
    tax_profile_status: draft.tax_profile_status || "missing",
    profile_photo_url: draft.profile_photo_url.trim(),
    work_photo_urls: draft.work_photo_urls_text.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    w9_document_url: draft.w9_document_url.trim(),
    contract_document_url: draft.contract_document_url.trim(),
    tax_profile_notes: draft.tax_profile_notes.trim(),
    onboarding_request_sent_at: draft.onboarding_request_sent_at.trim(),
    onboarding_completed_at: draft.onboarding_completed_at.trim(),
    blacklisted: draft.blacklisted,
    blacklist_reason: draft.blacklist_reason.trim(),
    notes: combineNotesAndResume(draft.notes, draft.resume_link),
    conflict_companies: draft.conflict_companies_text.split(",").map((item) => item.trim()).filter(Boolean),
    unavailable_dates: draft.unavailable_dates_text.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    positions: draft.positions.filter((item) => item.role_name.trim()).map((item) => ({ role_name: item.role_name.trim(), rate: Number(item.rate || getDefaultCrewPayRate(item.role_name) || 0) })),
  };
}

function starDisplay(value: number) {
  const rating = Math.max(0, Math.min(5, Math.round(Number(value || 0))));
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

function medianValue(values: number[]) {
  const clean = values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  if (clean.length % 2) return clean[middle];
  return (clean[middle - 1] + clean[middle]) / 2;
}

function roundedOneDecimal(value: number) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function ratingSummaryText(summary: CrewRatingSummary | null | undefined) {
  if (!summary || !summary.count) return "No ratings yet";
  return `${starDisplay(summary.median)} ${roundedOneDecimal(summary.median).toFixed(1)}/5 median (${summary.count})`;
}

function coordinatorRatingText(summary: CoordinatorRatingSummary | null | undefined) {
  if (!summary || !summary.ratedCrewCount) return "No coordinator rating yet";
  return `${starDisplay(summary.median)} ${roundedOneDecimal(summary.median).toFixed(1)}/5 median across ${summary.ratedCrewCount} rated crew`;
}

const ONBOARDING_STEPS: Array<{ key: keyof Pick<CrewRecord, "onboarding_texted_called" | "onboarding_response" | "onboarding_paperwork_sent" | "onboarding_successfully_onboarded" | "onboarding_called_placed_tier">; label: string }> = [
  { key: "onboarding_texted_called", label: "Texted/called" },
  { key: "onboarding_response", label: "Response" },
  { key: "onboarding_paperwork_sent", label: "Sent onboarding paperwork" },
  { key: "onboarding_successfully_onboarded", label: "Successfully onboarded" },
  { key: "onboarding_called_placed_tier", label: "Called and placed in tier" },
];

function onboardingStepCount(record: Pick<CrewRecord, "onboarding_texted_called" | "onboarding_response" | "onboarding_paperwork_sent" | "onboarding_successfully_onboarded" | "onboarding_called_placed_tier">) {
  return ONBOARDING_STEPS.filter((step) => Boolean(record[step.key])).length;
}

function isFullyOnboarded(record: Pick<CrewRecord, "onboarding_texted_called" | "onboarding_response" | "onboarding_paperwork_sent" | "onboarding_successfully_onboarded" | "onboarding_called_placed_tier">) {
  return ONBOARDING_STEPS.every((step) => Boolean(record[step.key]));
}

function onboardingStatusText(record: CrewRecord) {
  const complete = onboardingStepCount(record);
  return isFullyOnboarded(record) ? "Onboarded" : `${complete}/${ONBOARDING_STEPS.length} onboarding`;
}

function parseBooleanLike(value: string) {
  return /^(true|yes|y|1|x|checked|complete|completed|done)$/i.test(String(value || "").trim());
}

function tierGroupName(value: string) {
  const clean = String(value || "").trim();
  if (!clean) return "Ungrouped";
  return /^tier\s+/i.test(clean) ? clean.replace(/\s+/g, " ") : `Tier ${clean}`;
}

function mergeNotes(...parts: string[]) {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expandRoleAliases(value: string) {
  const normalized = normalizeText(value);
  const aliases = new Set<string>([normalized]);
  const add = (...terms: string[]) => terms.forEach((term) => aliases.add(normalizeText(term)));

  if (normalized.includes("general av") || normalized === "gav" || normalized === "avt") add("general av", "gav", "avt", "audio visual tech");
  if (normalized.includes("client facing") || normalized.includes("cf avt")) add("client facing av tech", "client facing audio visual tech", "cf avt");
  if (normalized.includes("floater") || normalized.includes("float tech")) add("floater", "float tech", "general av", "avt");
  if (normalized.includes("breakout") || normalized === "bo") add("breakout", "breakout operator", "bo", "bo op");
  if (normalized.includes("crew lead")) add("crew lead", "lead");
  if (normalized.includes("speaker ready")) add("speaker ready", "sr");
  if (normalized.includes("camera operator")) add("camera operator", "camera");
  if (normalized.includes("video") || normalized === "v2") add("video", "v2", "video assist");
  if (normalized.includes("audio") || normalized === "a2") add("audio", "a2", "audio assist");
  if (normalized.includes("lighting") || normalized === "l2") add("lighting", "l2", "lighting assist");
  if (normalized.includes("led")) add("led", "led assist", "led stagehand");
  return Array.from(aliases);
}

function buildSearchText(record: CrewRecord) {
  const parts = [
    record.name,
    record.city_name,
    ...(record.additional_city_pool_names ?? []),
    record.group_name,
    record.tier,
    record.email,
    record.phone,
    record.other_city,
    record.description,
    record.notes,
    record.ob ? "ob owner operator" : "",
    isFullyOnboarded(record) ? "onboarded successfully onboarded complete" : "not onboarded onboarding incomplete",
    ...ONBOARDING_STEPS.filter((step) => Boolean(record[step.key])).map((step) => step.label),
    ...record.positions.flatMap((position) => [position.role_name, ...expandRoleAliases(position.role_name)]),
    ...record.conflict_companies,
  ];
  return normalizeText(parts.filter(Boolean).join(" "));
}

function matchesSearch(record: CrewRecord, query: string) {
  const trimmed = normalizeText(query);
  if (!trimmed) return true;
  const haystack = buildSearchText(record);
  return trimmed.split(" ").every((token) => haystack.includes(token));
}

function groupSummaries(records: CrewRecord[], crewGroups: CrewGroupRecord[], selectedCityId: string) {
  const counts = new Map<string, number>();
  records.forEach((record) => counts.set(record.group_name || "Ungrouped", (counts.get(record.group_name || "Ungrouped") || 0) + 1));
  crewGroups
    .filter((group) => group.city_pool_id === selectedCityId)
    .forEach((group) => counts.set(group.name, counts.get(group.name) || 0));
  if (counts.size === 0) counts.set("Ungrouped", 0);
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "?") + (parts[1]?.[0] || "");
}

function primaryRole(record: CrewRecord) {
  return record.positions[0]?.role_name || "No role saved";
}

function firstNameFromCrew(name: string) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

function buildSquarespaceIntroMessage(record: CrewRecord) {
  const firstName = firstNameFromCrew(record.name);
  const role = primaryRole(record);
  const pool = record.city_name && record.city_name !== "Unassigned" ? record.city_name : "your area";
  return [
    `Hi ${firstName}, this is Storm Leigh with Emanuel Labor Services. Thank you for reaching out through our website.`,
    `I saw your submission and wanted to personally introduce myself. We provide professional AV/event labor support for corporate events, meetings, breakouts, expo floors, and show-site labor needs.`,
    `I have you listed in ${pool}${role && role !== "No role saved" ? ` with ${role} experience` : ""}. The next step is to confirm your current availability, skill level, preferred roles, and onboarding paperwork so we can place you properly when the right call opens up.`,
    `I appreciate you reaching out, and I look forward to learning more about your experience.`
  ].join("\n\n");
}

async function queueSquarespaceIntroForShortcut(record: CrewRecord) {
  const message = buildSquarespaceIntroMessage(record);
  const response = await fetch("/api/text-automation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "queue_intro",
      crew_id: record.id,
      crew_name: record.name,
      phone: record.phone,
      body: message,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Unable to queue intro text.");
  return data;
}

function buildCrewMessageValues(record: CrewRecord) {
  return {
    first_name: firstNameFromCrew(record.name),
    name: record.name || "Crew contact",
    crew_name: record.name || "Crew contact",
    pool: poolNamesForRecord(record),
    role: primaryRole(record),
    phone: record.phone || "",
  };
}

function applyCrewMessageTemplate(template: string, record: CrewRecord) {
  const values = buildCrewMessageValues(record);
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => values[key as keyof typeof values] ?? "");
}

async function queueBulkCrewMessageForShortcut(records: CrewRecord[], body: string) {
  const response = await fetch("/api/text-automation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "queue_crew_bulk_message",
      body,
      contacts: records.map((record) => ({
        crew_id: record.id,
        crew_name: record.name,
        phone: record.phone,
        pool_name: poolNamesForRecord(record),
        role_name: primaryRole(record),
      })),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Unable to queue crew messages.");
  return data as { message?: string; queue?: unknown[]; skipped?: number };
}

function isCrewLeadRoleName(roleName: string) {
  const text = normalizeText(roleName);
  return text === "crew lead" || text === "lead" || text === "working crew lead" || text.includes("crew lead") || text.includes("lead labor") || text.includes("labor lead");
}

function isCrewLeadContact(record: CrewRecord) {
  const groupText = normalizeText([record.group_name, record.tier, record.description].join(" "));
  return record.positions.some((position) => isCrewLeadRoleName(position.role_name)) || groupText.includes("crew lead") || groupText.includes("lead labor") || groupText.includes("labor lead");
}

function draftHasCrewLeadPosition(draft: CrewDraft) {
  return draft.positions.some((position) => isCrewLeadRoleName(position.role_name));
}

function withCrewLeadPosition(draft: CrewDraft, enabled: boolean, defaultRate: number): PositionInput[] {
  const existingPositions = draft.positions.filter((position) => String(position.role_name || "").trim() || Number(position.rate || 0));
  const hasLeadPosition = existingPositions.some((position) => isCrewLeadRoleName(position.role_name));
  if (enabled && !hasLeadPosition) {
    return [...existingPositions, { role_name: "Crew Lead", rate: defaultRate || getDefaultCrewPayRate("Crew Lead") || 0 }];
  }
  if (!enabled) {
    const nextPositions = existingPositions.filter((position) => !isCrewLeadRoleName(position.role_name));
    return nextPositions.length ? nextPositions : [{ role_name: "", rate: 0 }];
  }
  return existingPositions.length ? existingPositions : [{ role_name: "", rate: 0 }];
}

function positionSummary(record: CrewRecord) {
  if (!record.positions.length) return "No roles";
  if (record.positions.length === 1) return record.positions[0].role_name;
  return `${record.positions[0].role_name} +${record.positions.length - 1}`;
}

function formatMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  return `$${value.toFixed(value % 1 ? 2 : 0)}`;
}

function cleanPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return value;
}

function phoneDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((value) => value)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value)) rows.push(row);
  return rows;
}

function valueFromRow(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const normalizedKey = normalizeText(key);
    const foundKey = Object.keys(row).find((candidate) => normalizeText(candidate) === normalizedKey);
    if (foundKey && row[foundKey]) return row[foundKey];
  }
  return "";
}


type ParsedFormFields = {
  name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  location: string;
  address: string;
  message: string;
  resume: string;
  skillsets: string;
};

const FORM_LABELS: Record<string, keyof ParsedFormFields> = {
  name: "name",
  email: "email",
  "email address": "email",
  phone: "phone",
  mobile: "phone",
  "phone number": "phone",
  city: "city",
  "city state": "city",
  "city and state": "city",
  "city or state": "city",
  location: "location",
  address: "address",
  "street address": "address",
  state: "state",
  "state province": "state",
  "state region": "state",
  province: "state",
  region: "state",
  message: "message",
  resume: "resume",
  "upload resume": "resume",
  "uploaded resume": "resume",
  skills: "skillsets",
  skillset: "skillsets",
  skillsets: "skillsets",
  "skill sets": "skillsets",
};

function parseContactFormFields(raw: string): ParsedFormFields {
  const fields: ParsedFormFields = { name: "", email: "", phone: "", city: "", state: "", location: "", address: "", message: "", resume: "", skillsets: "" };
  let activeKey: keyof ParsedFormFields | null = null;

  raw
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      // Accept labels with punctuation, such as:
      // "City, State : Boston ma" or "City/State: Boston, MA".
      const match = line.match(/^([^:]{1,80})\s*:\s*(.*)$/);
      const label = match ? normalizeText(match[1]) : "";
      const matchedKey = label ? FORM_LABELS[label] : undefined;
      if (match && matchedKey) {
        activeKey = matchedKey;
        const value = match[2]?.trim() || "";
        fields[activeKey] = fields[activeKey] ? `${fields[activeKey]}\n${value}`.trim() : value;
        return;
      }

      // If a line looks like a field label that we do not understand, do not append it
      // to the previous field. This prevents city/state lines from being swallowed by Name.
      if (match) {
        activeKey = null;
        return;
      }

      if (activeKey) fields[activeKey] = `${fields[activeKey]}\n${line}`.trim();
    });

  return fields;
}


const STATE_LOOKUP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC", dc: "DC"
};

function titleCaseCity(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.split("-").map((chunk) => chunk ? chunk[0].toUpperCase() + chunk.slice(1) : chunk).join("-"))
    .join(" ")
    .replace(/\bMc([a-z])/g, (_, letter: string) => `Mc${letter.toUpperCase()}`);
}

function normalizeState(value: string) {
  const cleaned = value.replace(/[^A-Za-z]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const upper = cleaned.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return STATE_LOOKUP[cleaned.toLowerCase()] || "";
}

function cityStateFromText(value: string): { city: string; state: string } | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const commaMatch = text.match(/([A-Za-z][A-Za-z .'-]{1,60}?)\s*,\s*([A-Za-z]{2}|[A-Za-z][A-Za-z ]{3,24})(?:\s+\d{5}(?:-\d{4})?)?/);
  if (commaMatch) {
    const state = normalizeState(commaMatch[2]);
    const city = titleCaseCity(commaMatch[1].replace(/^.*\b(?:city|location|address)\b\s*/i, "").trim());
    if (city && state) return { city, state };
  }

  const stateWords = Object.keys(STATE_LOOKUP).sort((a, b) => b.length - a.length).map((item) => item.replace(/\s+/g, "\\s+")).join("|");
  const looseMatch = text.match(new RegExp(`([A-Za-z][A-Za-z .'-]{1,60}?)\\s+(${stateWords}|[A-Z]{2})(?:\\s+\\d{5}(?:-\\d{4})?)?`, "i"));
  if (looseMatch) {
    const state = normalizeState(looseMatch[2]);
    const city = titleCaseCity(looseMatch[1].replace(/^.*\b(?:city|location|address)\b\s*/i, "").trim());
    if (city && state) return { city, state };
  }

  return null;
}

function deriveCityPoolName(fields: ParsedFormFields, raw: string) {
  const directCityState = cityStateFromText(fields.city);
  if (directCityState) return `${directCityState.city}, ${directCityState.state}`;

  const state = normalizeState(fields.state);
  const cityOnly = fields.city.split("\n")[0]?.replace(/[,]+$/, "").trim() || "";
  if (cityOnly && state) return `${titleCaseCity(cityOnly)}, ${state}`;

  for (const candidate of [fields.location, fields.address, raw]) {
    const parsed = cityStateFromText(candidate);
    if (parsed) return `${parsed.city}, ${parsed.state}`;
  }

  return "";
}

const CITY_ALIAS_POOL_NAMES: Record<string, string> = {
  nola: "New Orleans, LA",
  "new orleans": "New Orleans, LA",
  "new orleans la": "New Orleans, LA",
  atl: "Atlanta, GA",
  atlanta: "Atlanta, GA",
  "atlanta ga": "Atlanta, GA",
  nash: "Nashville, TN",
  nashville: "Nashville, TN",
  "nashville tn": "Nashville, TN",
  dallas: "Dallas, TX",
  "dallas tx": "Dallas, TX",
  houston: "Houston, TX",
  "houston tx": "Houston, TX",
  austin: "Austin, TX",
  "austin tx": "Austin, TX",
  orlando: "Orlando, FL",
  "orlando fl": "Orlando, FL",
  miami: "Miami, FL",
  "miami fl": "Miami, FL",
  tampa: "Tampa, FL",
  "tampa fl": "Tampa, FL",
  chicago: "Chicago, IL",
  "chicago il": "Chicago, IL",
  vegas: "Las Vegas, NV",
  "las vegas": "Las Vegas, NV",
  "las vegas nv": "Las Vegas, NV",
  "los angeles": "Los Angeles, CA",
  la: "Los Angeles, CA",
  "los angeles ca": "Los Angeles, CA",
  phoenix: "Phoenix, AZ",
  "phoenix az": "Phoenix, AZ",
  denver: "Denver, CO",
  "denver co": "Denver, CO",
  seattle: "Seattle, WA",
  "seattle wa": "Seattle, WA",
  "new york": "New York, NY",
  nyc: "New York, NY",
  "new york ny": "New York, NY",
  "washington dc": "Washington, DC",
  dc: "Washington, DC",
  charlotte: "Charlotte, NC",
  "charlotte nc": "Charlotte, NC"
};

function normalizeCityPoolLabel(value: string) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const alias = CITY_ALIAS_POOL_NAMES[normalizeText(raw)];
  if (alias) return alias;
  const parsed = cityStateFromText(raw);
  if (parsed) return `${parsed.city}, ${parsed.state}`;
  return raw.includes(",") ? raw : titleCaseCity(raw);
}

function splitCsvPoolValues(value: string) {
  return String(value || "")
    .split(/;|\||\n|\/{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function poolNamesFromCsvRow(row: Record<string, string>) {
  const values: string[] = [];
  const cityStateDirect = valueFromRow(row, [
    "city/state pool",
    "city state pool",
    "city pool",
    "pool",
    "pool city",
    "market",
    "market city",
    "location",
    "city/state",
    "city state"
  ]);
  values.push(...splitCsvPoolValues(cityStateDirect));

  const city = valueFromRow(row, ["city", "primary city"]);
  const state = valueFromRow(row, ["state", "st", "primary state"]);
  if (city && state) values.push(`${city}, ${state}`);
  else if (city) values.push(city);

  const otherCities = valueFromRow(row, [
    "other city",
    "other cities",
    "additional city",
    "additional cities",
    "additional city pools",
    "additional pools",
    "secondary city",
    "secondary cities",
    "travel cities",
    "willing to travel",
    "travel pool"
  ]);
  values.push(...splitCsvPoolValues(otherCities));

  const normalized: string[] = [];
  for (const value of values) {
    const clean = normalizeCityPoolLabel(value);
    if (clean && !normalized.some((existing) => normalizeText(existing) === normalizeText(clean))) normalized.push(clean);
  }
  return normalized;
}

async function ensureCityPoolForImport(poolName: string, currentPools: CityPoolRecord[]) {
  const normalized = normalizeText(poolName);
  const existing = currentPools.find((pool) => normalizeText(pool.name) === normalized);
  if (existing) return { pool: existing, created: false };

  const response = await fetch("/api/city-pools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: poolName }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || `Unable to create city/state pool: ${poolName}`);
  return { pool: result.cityPool as CityPoolRecord, created: true };
}


function findCityPoolByName(cityPools: CityPoolRecord[], cityName: string) {
  const normalized = normalizeText(cityName);
  if (!normalized) return null;
  return cityPools.find((pool) => normalizeText(pool.name) === normalized) || null;
}

function crewBelongsToCityPool(record: CrewRecord, cityPoolId: string) {
  if (cityPoolId === UNASSIGNED_CITY) return !record.city_pool_id && !(record.additional_city_pool_ids ?? []).length;
  return record.city_pool_id === cityPoolId || (record.additional_city_pool_ids ?? []).includes(cityPoolId);
}

function poolNamesForRecord(record: CrewRecord) {
  const names = [record.city_name, ...(record.additional_city_pool_names ?? [])]
    .filter((name, index, list) => Boolean(name) && list.indexOf(name) === index)
    .filter((name) => !isCoordinatorSystemPoolName(name));
  return names.join(", ") || "Unassigned";
}

function visiblePoolName(value: string | null | undefined) {
  return value && !isCoordinatorSystemPoolName(value) ? value : "Unassigned";
}

function visibleAdditionalPoolNames(record: CrewRecord) {
  return (record.additional_city_pool_names ?? []).filter((name, index, list) => Boolean(name) && list.indexOf(name) === index && !isCoordinatorSystemPoolName(name));
}

function suggestedPoolMatches(cityPools: CityPoolRecord[], detectedCityName: string) {
  const normalized = normalizeText(detectedCityName);
  if (!normalized) return [] as CityPoolRecord[];
  const detectedCityOnly = normalizeText(detectedCityName.split(",")[0] || detectedCityName);
  return cityPools.filter((pool) => {
    const poolName = normalizeText(pool.name);
    return poolName.includes(normalized) || normalized.includes(poolName) || (detectedCityOnly && poolName.includes(detectedCityOnly));
  }).slice(0, 5);
}

function addMappedRole(map: Map<string, PositionInput>, roleName: string) {
  const rate = getDefaultCrewPayRate(roleName);
  if (!map.has(roleName)) map.set(roleName, { role_name: roleName, rate });
}

function addGeneralAvSetupRoles(map: Map<string, PositionInput>) {
  addMappedRole(map, "GAV");
  addMappedRole(map, "LED Stagehand");
}

function positionsFromSkillsets(skillsets: string): PositionInput[] {
  const roles = new Map<string, PositionInput>();
  skillsets
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((skill) => {
      const normalized = normalizeText(skill);
      if (!normalized) return;

      const hasExplicitAssist = /\ba2\b|audio assist|\bv2\b|video assist|\bl2\b|lighting assist/.test(normalized);

      // Generic applicant skill words are intentionally mapped to broad, usable ELS roles.
      // Example: "Audio", "Video", or "Setup" should create GAV + LED Stagehand
      // instead of over-classifying the contact as a dedicated A2/V2 specialist.
      if (/\baudio\b|sound|\bvideo\b|audio visual|\bav\b|setup|set up|strike/.test(normalized) && !hasExplicitAssist) {
        addGeneralAvSetupRoles(roles);
      }

      if (/\bled\b/.test(normalized)) addMappedRole(roles, "LED Stagehand");
      if (/stagehand|stage hand|stage tech|stagetech/.test(normalized)) addMappedRole(roles, "Stagehand");
      if (/\ba1\b|a1 audio|audio engineer|lead audio/.test(normalized)) addMappedRole(roles, "A1-Audio Engineer");
      if (/\ba2\b|audio assist/.test(normalized)) addMappedRole(roles, "A2-Audio Assist");
      if (/\bv1\b|v1 video|lead video|video engineer/.test(normalized)) addMappedRole(roles, "V1-Lead Video Engineer");
      if (/\bv2\b|video assist/.test(normalized)) addMappedRole(roles, "V2-Video Assist");
      if (/lighting|lights|\bl2\b|lighting assist/.test(normalized)) addMappedRole(roles, "L2-Lighting Assist");
      if (/speaker ready|speakerready/.test(normalized)) addMappedRole(roles, "Speaker Ready");
      if (/digital service|digital services|graphics|powerpoint|keynote/.test(normalized)) addMappedRole(roles, "Graphics Operator");
      if (/camera|cam op|camera op|\bptz\b|robotic camera|robotic\/?ptz|owner operator/.test(normalized)) addMappedRole(roles, "Camera Operator");
      if (/rigging|rigger|up and down/.test(normalized)) addMappedRole(roles, "Down Rigger");
      if (/warehouse|prep|unload|loader|load in|load out/.test(normalized)) addMappedRole(roles, "Truck Loader");
      if (/\bgav\b|\bavt\b/.test(normalized)) addMappedRole(roles, "GAV");
      if (/breakout|\bbo\b|bo tech/.test(normalized)) addMappedRole(roles, "BO Tech");
      if (/floater|float/.test(normalized)) addMappedRole(roles, "Floater");
      if (/crew lead|lead/.test(normalized)) addMappedRole(roles, "Crew Lead");
    });
  return Array.from(roles.values());
}

function draftFromPastedContactForm(raw: string, cityPools: CityPoolRecord[], cityId: string, groupName: string, detectedCityName = ""): CrewDraft {
  const fields = parseContactFormFields(raw);
  // Some applicant forms put skill words in Message instead of Skillsets.
  // Use both fields so text like "PTZ camera operator" still creates the right role.
  const positions = positionsFromSkillsets([fields.skillsets, fields.message].filter(Boolean).join("\n"));
  const derivedCityName = detectedCityName || deriveCityPoolName(fields, raw);
  const notes = [
    fields.message ? `Application message:\n${fields.message}` : "",
    fields.resume ? `Resume: ${fields.resume}` : "",
    fields.skillsets ? `Skillsets: ${fields.skillsets}` : "",
    derivedCityName ? `Detected city pool: ${derivedCityName}` : "",
  ].filter(Boolean).join("\n\n");

  const resolvedCityPool = cityId && cityId !== UNASSIGNED_CITY ? cityId : findCityPoolByName(cityPools, derivedCityName)?.id || cityPools[0]?.id;
  const baseDraft = blankDraft(cityPools, resolvedCityPool, groupName !== ALL_GROUPS ? groupName : "Applicant");

  return {
    ...baseDraft,
    city_pool_id: resolvedCityPool || "",
    city_name: derivedCityName || baseDraft.city_name,
    name: fields.name,
    email: fields.email,
    phone: cleanPhone(fields.phone),
    description: "Imported from pasted applicant/contact form text.",
    group_name: groupName !== ALL_GROUPS ? groupName : "Applicant",
    notes: removeResumeLine(notes),
    resume_link: fields.resume,
    positions: positions.length ? positions : [{ role_name: "", rate: 0 }],
  };
}

export default function CrewClient({ cityPools: initialCityPools, crewGroups: initialGroups, initialCrew, masterRates, initialRatings, appUsers, currentUserId, currentUserName, currentUserRole }: CrewClientProps) {
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [cityPools, setCityPools] = useState(initialCityPools);
  const [crewGroups, setCrewGroups] = useState(initialGroups);
  const [crewRecords, setCrewRecords] = useState(initialCrew);
  const [ratings] = useState(initialRatings);
  const ratingSummaryByCrew = useMemo(() => {
    const map = new Map<string, { values: number[]; lastRatingAt: string }>();
    for (const rating of ratings) {
      if (!rating.crew_id || !Number(rating.rating)) continue;
      const existing = map.get(rating.crew_id) ?? { values: [] as number[], lastRatingAt: "" };
      existing.values.push(Number(rating.rating || 0));
      const ratingDate = rating.updated_at || rating.created_at || "";
      if (ratingDate > existing.lastRatingAt) existing.lastRatingAt = ratingDate;
      map.set(rating.crew_id, existing);
    }
    const summaries = new Map<string, CrewRatingSummary>();
    for (const [crewId, row] of map.entries()) {
      const total = row.values.reduce((sum, value) => sum + value, 0);
      summaries.set(crewId, { average: total / Math.max(1, row.values.length), median: medianValue(row.values), count: row.values.length, lastRatingAt: row.lastRatingAt });
    }
    return summaries;
  }, [ratings]);
  const roleOptions = useMemo(() => {
    const map = new Map<string, { roleName: string; fullDay: number; halfDay: number | null; featured?: boolean }>();
    for (const option of crewRoleRateOptions) map.set(normalizeText(option.roleName), option);
    for (const rate of masterRates) {
      if (normalizeText(rate.city_name) !== "default") continue;
      const roleName = String(rate.role_name || "").trim();
      if (!roleName) continue;
      const key = normalizeText(roleName);
      if (!map.has(key)) {
        map.set(key, { roleName, fullDay: Number(rate.full_day || 0), halfDay: rate.half_day == null ? null : Number(rate.half_day) });
      }
    }
    const topOrder = ["GAV", "LED Stagehand", "Stagehand", "BO Tech", "Floater", "Crew Lead", "Warehouse Worker"].map(normalizeText);
    return [...map.values()].sort((a, b) => {
      const ai = topOrder.indexOf(normalizeText(a.roleName));
      const bi = topOrder.indexOf(normalizeText(b.roleName));
      if (ai >= 0 || bi >= 0) return (ai >= 0 ? ai : 999) - (bi >= 0 ? bi : 999);
      return a.roleName.localeCompare(b.roleName);
    });
  }, [masterRates]);
  const defaultRateForRole = (roleName: string) => matchingDefaultRole(roleName, roleOptions)?.fullDay || getDefaultCrewPayRate(roleName);
  const initialDisplayCity = initialCityPools.find((pool) => !isCoordinatorSystemPoolName(pool.name)) || initialCityPools[0];
  const [selectedCityId, setSelectedCityId] = useState<string>(initialDisplayCity?.id || UNASSIGNED_CITY);
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_GROUPS);
  const [globalSearch, setGlobalSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | "notOnboarded" | "onboarded" | "ob" | "blacklisted" | "withConflicts" | "unavailable" | "noRole">("all");
  const [sortMode, setSortMode] = useState<"name" | "notOnboarded" | "rating" | "tier">("name");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("info");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CrewDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [formImporterOpen, setFormImporterOpen] = useState(false);
  const [formText, setFormText] = useState("");
  const [csvHelpOpen, setCsvHelpOpen] = useState(false);
  const [csvPreviewRows, setCsvPreviewRows] = useState<CsvPreviewRow[]>([]);
  const [csvPreviewFileName, setCsvPreviewFileName] = useState("");
  const [newCityName, setNewCityName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [poolOptionMode, setPoolOptionMode] = useState<"" | "add-city" | "travel" | "rename" | "delete" | "create-group" | "rename-group" | "remove-group">("");
  const [bulkCityId, setBulkCityId] = useState("");
  const [bulkGroupName, setBulkGroupName] = useState("Ungrouped");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"error" | "success">("success");
  const [bulkMessageOpen, setBulkMessageOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMessageBody, setBulkMessageBody] = useState("Hi {first_name}, this is Storm with Emanuel Labor Services. I’m reaching out to check your availability for upcoming labor calls in {pool}. Please reply with your current availability and the roles you are comfortable taking.");
  const [crewOwnerView, setCrewOwnerView] = useState(MASTER_CREW_VIEW);
  const [coordinatorPoolAccessByUser, setCoordinatorPoolAccessByUser] = useState<Record<string, string[]>>(() => Object.fromEntries(appUsers.map((user) => [user.id, user.allowed_city_pool_ids ?? []])));
  const [coordinatorNewPoolName, setCoordinatorNewPoolName] = useState("");
  const [coordinatorAccessSaving, setCoordinatorAccessSaving] = useState(false);

  const isAdminCrewView = isOwnerAdminRole(currentUserRole);
  const cityPoolsForDisplay = useMemo(() => cityPools.filter((pool) => !isCoordinatorSystemPoolName(pool.name)), [cityPools]);
  const appUserById = useMemo(() => new Map(appUsers.map((user) => [user.id, user])), [appUsers]);
  const crewOwnerViews = useMemo(() => {
    const ownerIdsWithCrew = new Set(crewRecords.map((record) => String(record.created_by || "")).filter(Boolean));
    const userRows = appUsers
      .filter((user) => user.is_active !== false && user.id !== currentUserId && (ownerIdsWithCrew.has(user.id) || ["owner", "admin", "coordinator"].includes(normalizeText(user.role))))
      .sort((a, b) => userDisplayName(a).localeCompare(userDisplayName(b)));
    return [
      { id: MASTER_CREW_VIEW, label: `${possessiveFirstName(currentUserName)} Pool (Master Pool)`, userId: null as string | null },
      ...userRows.map((user) => ({ id: user.id, label: `${userDisplayName(user)} Pool`, userId: user.id })),
    ];
  }, [appUsers, crewRecords, currentUserId, currentUserName]);
  const selectedOwnerUser = crewOwnerView !== MASTER_CREW_VIEW ? appUserById.get(crewOwnerView) ?? null : null;
  const selectedOwnerAllowedPoolIds = coordinatorPoolAccessByUser[crewOwnerView] ?? selectedOwnerUser?.allowed_city_pool_ids ?? [];
  const selectedOwnerAllowedPoolSet = new Set(selectedOwnerAllowedPoolIds);

  const ownerScopedCrewRecords = useMemo(() => {
    if (!isAdminCrewView) return crewRecords.filter((record) => !record.coordinator_hidden_at);
    if (crewOwnerView === MASTER_CREW_VIEW) return crewRecords;
    return crewRecords.filter((record) => String(record.created_by || "") === crewOwnerView);
  }, [crewRecords, crewOwnerView, isAdminCrewView]);

  const coordinatorRatingByUser = useMemo(() => {
    const map = new Map<string, { values: number[]; totalCrewCount: number }>();
    for (const record of crewRecords) {
      const ownerId = String(record.created_by || "");
      if (!ownerId) continue;
      const existing = map.get(ownerId) ?? { values: [] as number[], totalCrewCount: 0 };
      existing.totalCrewCount += 1;
      const summary = ratingSummaryByCrew.get(record.id);
      if (summary?.count) existing.values.push(summary.median);
      map.set(ownerId, existing);
    }
    const summaries = new Map<string, CoordinatorRatingSummary>();
    for (const [userId, row] of map.entries()) {
      const total = row.values.reduce((sum, value) => sum + value, 0);
      summaries.set(userId, {
        median: medianValue(row.values),
        average: row.values.length ? total / row.values.length : 0,
        ratedCrewCount: row.values.length,
        totalCrewCount: row.totalCrewCount,
      });
    }
    return summaries;
  }, [crewRecords, ratingSummaryByCrew]);

  const currentViewRatingSummary = useMemo(() => {
    const summaries = ownerScopedCrewRecords.map((record) => ratingSummaryByCrew.get(record.id)).filter((summary): summary is CrewRatingSummary => Boolean(summary?.count));
    if (!summaries.length) return null;
    const values = summaries.map((summary) => summary.median);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { median: medianValue(values), average, ratedCrewCount: values.length, totalCrewCount: ownerScopedCrewRecords.length } satisfies CoordinatorRatingSummary;
  }, [ownerScopedCrewRecords, ratingSummaryByCrew]);

  function toggleCoordinatorPoolAccess(poolId: string) {
    if (!selectedOwnerUser) return;
    setCoordinatorPoolAccessByUser((current) => {
      const existing = current[selectedOwnerUser.id] ?? selectedOwnerUser.allowed_city_pool_ids ?? [];
      const next = existing.includes(poolId) ? existing.filter((id) => id !== poolId) : [...existing, poolId];
      return { ...current, [selectedOwnerUser.id]: next };
    });
  }

  async function saveCoordinatorPoolAccess(userId = selectedOwnerUser?.id, poolIds = selectedOwnerAllowedPoolIds) {
    if (!userId) return;
    setCoordinatorAccessSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/user-access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, allowed_city_pool_ids: poolIds }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Unable to save coordinator pool access.");
      const nextIds = Array.isArray(result.allowed_city_pool_ids) ? result.allowed_city_pool_ids.map(String) : poolIds;
      setCoordinatorPoolAccessByUser((current) => ({ ...current, [userId]: nextIds }));
      setMessageKind("success");
      setMessage("Coordinator pool access saved.");
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to save coordinator pool access.");
    } finally {
      setCoordinatorAccessSaving(false);
    }
  }

  async function createPoolForSelectedCoordinator() {
    if (!selectedOwnerUser || !coordinatorNewPoolName.trim()) return;
    setCoordinatorAccessSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/city-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: coordinatorNewPoolName.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Unable to create city pool.");
      const city = result.cityPool as CityPoolRecord;
      setCityPools((current) => current.some((pool) => pool.id === city.id) ? current : [...current, city].sort((a, b) => a.name.localeCompare(b.name)));
      const nextIds = Array.from(new Set([...(coordinatorPoolAccessByUser[selectedOwnerUser.id] ?? selectedOwnerUser.allowed_city_pool_ids ?? []), city.id]));
      setCoordinatorPoolAccessByUser((current) => ({ ...current, [selectedOwnerUser.id]: nextIds }));
      setCoordinatorNewPoolName("");
      await saveCoordinatorPoolAccess(selectedOwnerUser.id, nextIds);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to add pool to coordinator account.");
      setCoordinatorAccessSaving(false);
    }
  }

  useEffect(() => {
    if ((!selectedCityId || (selectedCityId !== UNASSIGNED_CITY && isCoordinatorSystemPoolName(cityPools.find((pool) => pool.id === selectedCityId)?.name))) && cityPoolsForDisplay[0]?.id) setSelectedCityId(cityPoolsForDisplay[0].id);
  }, [cityPools, cityPoolsForDisplay, selectedCityId]);

  useEffect(() => {
    if (selectedCityId && selectedCityId !== UNASSIGNED_CITY) setBulkCityId((current) => current || selectedCityId);
  }, [selectedCityId]);

  const globallyMatchedCrew = useMemo(() => ownerScopedCrewRecords.filter((record) => matchesSearch(record, globalSearch)), [ownerScopedCrewRecords, globalSearch]);

  const cityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    cityPoolsForDisplay.forEach((pool) => counts.set(pool.id, 0));
    counts.set(UNASSIGNED_CITY, 0);
    globallyMatchedCrew.forEach((record) => {
      let counted = false;
      cityPoolsForDisplay.forEach((pool) => {
        if (crewBelongsToCityPool(record, pool.id)) {
          counts.set(pool.id, (counts.get(pool.id) || 0) + 1);
          counted = true;
        }
      });
      if (!counted) counts.set(UNASSIGNED_CITY, (counts.get(UNASSIGNED_CITY) || 0) + 1);
    });
    return counts;
  }, [cityPoolsForDisplay, globallyMatchedCrew]);

  const selectedCity = cityPoolsForDisplay.find((pool) => pool.id === selectedCityId) || null;

  const cityScopedCrew = useMemo(() => {
    return globallyMatchedCrew.filter((record) => {
      const cityMatch = crewBelongsToCityPool(record, selectedCityId);
      const cityQueryMatch = matchesSearch(record, citySearch);
      return cityMatch && cityQueryMatch;
    });
  }, [globallyMatchedCrew, selectedCityId, citySearch]);

  const availableGroups = useMemo(
    () => groupSummaries(cityScopedCrew, isAdminCrewView && !selectedOwnerUser ? crewGroups : [], selectedCityId),
    [cityScopedCrew, crewGroups, selectedCityId, isAdminCrewView, selectedOwnerUser]
  );

  useEffect(() => {
    if (selectedGroup !== ALL_GROUPS && !availableGroups.some((group) => group.name === selectedGroup)) {
      setSelectedGroup(ALL_GROUPS);
    }
  }, [availableGroups, selectedGroup]);

  const visibleCrew = useMemo(() => {
    return cityScopedCrew.filter((record) => {
      const groupMatch = selectedGroup === ALL_GROUPS || record.group_name === selectedGroup;
      const groupQueryMatch = matchesSearch(record, groupSearch);
      const quickMatch =
        quickFilter === "all" ||
        (quickFilter === "notOnboarded" && !isFullyOnboarded(record)) ||
        (quickFilter === "onboarded" && isFullyOnboarded(record)) ||
        (quickFilter === "ob" && record.ob) ||
        (quickFilter === "blacklisted" && record.blacklisted) ||
        (quickFilter === "withConflicts" && record.conflict_companies.length > 0) ||
        (quickFilter === "unavailable" && record.unavailable_dates.length > 0) ||
        (quickFilter === "noRole" && record.positions.length === 0);
      return groupMatch && groupQueryMatch && quickMatch;
    }).sort((a, b) => {
      if (sortMode === "notOnboarded") {
        const aDone = isFullyOnboarded(a) ? 1 : 0;
        const bDone = isFullyOnboarded(b) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const stepDiff = onboardingStepCount(a) - onboardingStepCount(b);
        if (stepDiff !== 0) return stepDiff;
      }
      if (sortMode === "rating") {
        const ar = ratingSummaryByCrew.get(a.id);
        const br = ratingSummaryByCrew.get(b.id);
        const ratingDiff = (br?.average || 0) - (ar?.average || 0);
        if (ratingDiff !== 0) return ratingDiff;
        const countDiff = (br?.count || 0) - (ar?.count || 0);
        if (countDiff !== 0) return countDiff;
      }
      if (sortMode === "tier") {
        const tierDiff = String(a.group_name || "").localeCompare(String(b.group_name || ""), undefined, { numeric: true, sensitivity: "base" });
        if (tierDiff !== 0) return tierDiff;
      }
      return a.name.localeCompare(b.name);
    });
  }, [cityScopedCrew, selectedGroup, groupSearch, quickFilter, sortMode, ratingSummaryByCrew]);

  const crewLeadContactsForPool = useMemo(() => {
    return cityScopedCrew
      .filter((record) => isCrewLeadContact(record))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cityScopedCrew]);

  const selectedContact = useMemo(() => ownerScopedCrewRecords.find((record) => record.id === selectedContactId) || null, [ownerScopedCrewRecords, selectedContactId]);
  const selectedCrewForMessaging = useMemo(() => ownerScopedCrewRecords.filter((record) => selectedIds.includes(record.id)), [ownerScopedCrewRecords, selectedIds]);
  const selectedCrewWithPhones = useMemo(() => selectedCrewForMessaging.filter((record) => phoneDigits(record.phone).length >= 10), [selectedCrewForMessaging]);
  const selectedCrewMessagePreview = useMemo(() => selectedCrewForMessaging[0] ? applyCrewMessageTemplate(bulkMessageBody, selectedCrewForMessaging[0]) : "", [bulkMessageBody, selectedCrewForMessaging]);

  useEffect(() => {
    if (adding || editingId) return;
    if (selectedContactId && !visibleCrew.some((record) => record.id === selectedContactId)) {
      setSelectedContactId(null);
    }
  }, [adding, editingId, selectedContactId, visibleCrew]);

  const targetGroupsForBulkCity = useMemo(() => {
    const cityId = bulkCityId || (selectedCityId !== UNASSIGNED_CITY ? selectedCityId : "");
    const names = new Set<string>(["Ungrouped"]);
    ownerScopedCrewRecords.filter((record) => crewBelongsToCityPool(record, cityId)).forEach((record) => names.add(record.group_name || "Ungrouped"));
    if (isAdminCrewView && !selectedOwnerUser) crewGroups.filter((group) => group.city_pool_id === cityId).forEach((group) => names.add(group.name));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [bulkCityId, crewGroups, ownerScopedCrewRecords, selectedCityId, isAdminCrewView, selectedOwnerUser]);

  function setDraftField(key: keyof CrewDraft, value: CrewDraft[keyof CrewDraft]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function setPosition(index: number, patch: Partial<PositionInput>) {
    setDraft((current) => {
      if (!current) return current;
      const positions = [...current.positions];
      positions[index] = { ...positions[index], ...patch };
      return { ...current, positions };
    });
  }

  function addPosition() {
    setDraft((current) => (current ? { ...current, positions: [...current.positions, { role_name: "", rate: 0 }] } : current));
  }

  function removePosition(index: number) {
    setDraft((current) => {
      if (!current) return current;
      const positions = current.positions.filter((_, idx) => idx !== index);
      return { ...current, positions: positions.length ? positions : [{ role_name: "", rate: 0 }] };
    });
  }

  function beginAdd() {
    setAdding(true);
    setEditingId(null);
    setSelectedContactId(null);
    setDetailTab("info");
    setFormImporterOpen(false);
    setDraft(blankDraft(cityPoolsForDisplay.length ? cityPoolsForDisplay : cityPools, selectedCityId !== UNASSIGNED_CITY ? selectedCityId : cityPoolsForDisplay[0]?.id || cityPools[0]?.id, selectedGroup));
    setMessage(null);
  }

  function beginPastedFormImport() {
    setAdding(true);
    setEditingId(null);
    setSelectedContactId(null);
    setDetailTab("info");
    setFormImporterOpen(true);
    setDraft(blankDraft(cityPoolsForDisplay.length ? cityPoolsForDisplay : cityPools, selectedCityId !== UNASSIGNED_CITY ? selectedCityId : cityPoolsForDisplay[0]?.id || cityPools[0]?.id, selectedGroup));
    setMessage(null);
  }

  async function applyPastedFormText() {
    if (!formText.trim()) {
      setMessageKind("error");
      setMessage("Paste the applicant or contact form text first.");
      return;
    }

    const parsedFields = parseContactFormFields(formText);
    const detectedCityName = deriveCityPoolName(parsedFields, formText);
    let nextCityPools = cityPools;
    let targetCityId = selectedCityId;

    setSaving(true);
    setMessage(null);
    try {
      if (detectedCityName) {
        const existingPool = findCityPoolByName(nextCityPools, detectedCityName);
        if (existingPool) {
          targetCityId = existingPool.id;
        } else {
          const suggestions = suggestedPoolMatches(nextCityPools, detectedCityName);
          const suggestionText = suggestions.length ? `\n\nPossible existing pools:\n${suggestions.map((pool) => `- ${pool.name}`).join("\n")}` : "";
          const shouldCreate = window.confirm(`No exact city pool was found for "${detectedCityName}".${suggestionText}\n\nCreate a new city pool named "${detectedCityName}"? Press Cancel to review/select an existing pool manually.`);
          if (shouldCreate) {
            const response = await fetch("/api/city-pools", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: detectedCityName }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message || `Unable to create city pool: ${detectedCityName}`);
            const city = result.cityPool as CityPoolRecord;
            nextCityPools = [...nextCityPools.filter((pool) => pool.id !== city.id), city].sort((a, b) => a.name.localeCompare(b.name));
            setCityPools(nextCityPools);
            targetCityId = city.id;
          }
        }
        if (targetCityId && targetCityId !== UNASSIGNED_CITY) {
          setSelectedCityId(targetCityId);
          setBulkCityId(targetCityId);
          setSelectedGroup(ALL_GROUPS);
        }
      }

      const parsedDraft = draftFromPastedContactForm(formText, nextCityPools, targetCityId, selectedGroup, detectedCityName);
      setDraft(parsedDraft);
      setAdding(true);
      setFormImporterOpen(true);
      setMessageKind("success");
      setMessage(detectedCityName ? `Contact form parsed and city pool selected: ${detectedCityName}. Review, then save.` : "Contact form parsed. Review the contact, roles, and rates, then save.");
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to parse contact form.");
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(record: CrewRecord) {
    setEditingId(record.id);
    setAdding(false);
    setSelectedContactId(record.id);
    setDetailTab("info");
    setDraft(draftFromRecord(record));
    setFormImporterOpen(false);
    setMessage(null);
  }

  function closeEditor(nextSelectedId?: string) {
    setEditingId(null);
    setAdding(false);
    setDraft(null);
    setFormImporterOpen(false);
    if (nextSelectedId) setSelectedContactId(nextSelectedId);
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setMessageKind("error");
      setMessage("Crew name is required.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const payload = normalizePayload(draft);
      const response = await fetch(draft.id ? `/api/crew/${draft.id}` : "/api/crew", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Save failed.");

      const nextRecord = recordFromDraft({ ...draft, id: draft.id || result.id }, cityPools);
      setCrewRecords((current) => {
        if (draft.id || result.merged) {
          const exists = current.some((record) => record.id === nextRecord.id);
          return exists ? current.map((record) => (record.id === nextRecord.id ? nextRecord : record)) : [nextRecord, ...current];
        }
        return [nextRecord, ...current];
      });
      if (nextRecord.city_pool_id) {
        const exists = crewGroups.some((group) => group.city_pool_id === nextRecord.city_pool_id && group.name === nextRecord.group_name);
        if (!exists) setCrewGroups((current) => [...current, { id: `temp-${nextRecord.id}`, city_pool_id: nextRecord.city_pool_id!, name: nextRecord.group_name }]);
      }
      setMessageKind("success");
      setMessage(draft.id || result.merged ? "Crew contact updated. Duplicate contact was merged instead of creating another copy." : "Crew contact added.");
      closeEditor(nextRecord.id);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to save crew contact.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(id: string) {
    const removingFromCoordinatorView = Boolean(isAdminCrewView && selectedOwnerUser);
    const coordinatorSelfRemoving = !isAdminCrewView;
    const confirmMessage = removingFromCoordinatorView
      ? `Hide this contact from ${userDisplayName(selectedOwnerUser!)} Pool? Storm’s Master Pool record will stay preserved.`
      : coordinatorSelfRemoving
        ? "Remove this contact from your crew view?"
        : "Delete this crew contact?";
    if (!window.confirm(confirmMessage)) return;
    setSaving(true);
    try {
      const deleteUrl = removingFromCoordinatorView
        ? `/api/crew/${id}?soft=1&hidden_by=${encodeURIComponent(selectedOwnerUser!.id)}`
        : `/api/crew/${id}`;
      const response = await fetch(deleteUrl, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Delete failed.");
      if (result.soft_deleted && isAdminCrewView) {
        const hiddenAt = new Date().toISOString();
        const hiddenBy = removingFromCoordinatorView ? selectedOwnerUser!.id : currentUserId;
        setCrewRecords((current) => current.map((record) => record.id === id ? { ...record, coordinator_hidden_at: hiddenAt, coordinator_hidden_by: hiddenBy } : record));
      } else {
        setCrewRecords((current) => current.filter((record) => record.id !== id));
      }
      setSelectedIds((current) => current.filter((value) => value !== id));
      if (editingId === id && (!result.soft_deleted || coordinatorSelfRemoving)) closeEditor();
      if (selectedContactId === id) setSelectedContactId(visibleCrew.find((record) => record.id !== id)?.id || null);
      setMessageKind("success");
      setMessage(result.soft_deleted ? (coordinatorSelfRemoving ? "Contact removed from your view." : "Contact hidden from the coordinator view. Storm’s Master Pool record is preserved.") : "Crew contact deleted.");
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete crew contact.");
    } finally {
      setSaving(false);
    }
  }

  async function addCityPool() {
    if (!newCityName.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/city-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCityName.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to add city pool.");
      const city = result.cityPool as CityPoolRecord;
      setCityPools((current) => [...current.filter((item) => item.id !== city.id), city].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCityId(city.id);
      setBulkCityId(city.id);
      if (selectedOwnerUser) {
        const currentIds = coordinatorPoolAccessByUser[selectedOwnerUser.id] ?? selectedOwnerUser.allowed_city_pool_ids ?? [];
        const nextIds = Array.from(new Set([...currentIds, city.id]));
        const accessResponse = await fetch("/api/user-access", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: selectedOwnerUser.id, allowed_city_pool_ids: nextIds }),
        });
        const accessResult = await accessResponse.json().catch(() => ({}));
        if (!accessResponse.ok) throw new Error(accessResult.message || "City pool was created, but could not be added to this coordinator account.");
        const savedIds = Array.isArray(accessResult.allowed_city_pool_ids) ? accessResult.allowed_city_pool_ids.map(String) : nextIds;
        setCoordinatorPoolAccessByUser((current) => ({ ...current, [selectedOwnerUser.id]: savedIds }));
      }
      setNewCityName("");
      setSelectedGroup(ALL_GROUPS);
      setMessageKind("success");
      setMessage(selectedOwnerUser ? `City pool created and added to ${userDisplayName(selectedOwnerUser)} Pool: ${city.name}` : `City pool created: ${city.name}`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to add city pool.");
    } finally {
      setSaving(false);
    }
  }

  async function ensureTravelTechsPool() {
    const existing = cityPools.find((pool) => normalizeText(pool.name) === "travel techs");
    if (existing) {
      setSelectedCityId(existing.id);
      setMessageKind("success");
      setMessage("Travel Techs pool already exists.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/city-pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Travel Techs" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to create Travel Techs pool.");
      const city = result.cityPool as CityPoolRecord;
      setCityPools((current) => [...current.filter((item) => item.id !== city.id), city].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedCityId(city.id);
      setBulkCityId(city.id);
      setMessageKind("success");
      setMessage("Travel Techs pool created.");
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to create Travel Techs pool.");
    } finally {
      setSaving(false);
    }
  }

  async function renameSelectedCityPool() {
    if (!selectedCity || selectedCityId === UNASSIGNED_CITY) {
      setMessageKind("error");
      setMessage("Select a city pool to rename.");
      return;
    }
    const nextName = window.prompt("Rename city pool", selectedCity.name)?.trim();
    if (!nextName || nextName === selectedCity.name) return;

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/city-pools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedCity.id, name: nextName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to rename city pool.");
      const city = result.cityPool as CityPoolRecord;
      setCityPools((current) => current.map((pool) => pool.id === city.id ? city : pool).sort((a, b) => a.name.localeCompare(b.name)));
      setCrewRecords((current) => current.map((record) => {
        const isPrimary = record.city_pool_id === city.id;
        const hasAdditional = (record.additional_city_pool_ids ?? []).includes(city.id);
        if (!isPrimary && !hasAdditional) return record;
        return {
          ...record,
          city_name: isPrimary ? city.name : record.city_name,
          additional_city_pool_names: hasAdditional ? (record.additional_city_pool_ids ?? []).map((poolId) => poolId === city.id ? city.name : cityPools.find((pool) => pool.id === poolId)?.name || "").filter(Boolean) : record.additional_city_pool_names,
        };
      }));
      setMessageKind("success");
      setMessage(`City pool renamed: ${selectedCity.name} → ${city.name}`);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to rename city pool.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedCityPool() {
    if (!selectedCity || selectedCityId === UNASSIGNED_CITY) {
      setMessageKind("error");
      setMessage(selectedOwnerUser ? "Select a city pool to remove from this coordinator account." : "Select a city pool to delete.");
      return;
    }

    if (selectedOwnerUser) {
      const currentIds = coordinatorPoolAccessByUser[selectedOwnerUser.id] ?? selectedOwnerUser.allowed_city_pool_ids ?? [];
      if (!currentIds.includes(selectedCity.id)) {
        setMessageKind("error");
        setMessage(`${selectedCity.name} is not currently visible to ${userDisplayName(selectedOwnerUser)}.`);
        return;
      }
      if (!window.confirm(`Remove ${selectedCity.name} from ${userDisplayName(selectedOwnerUser)} Pool? This will not delete the city pool or any master crew records.`)) return;
      setSaving(true);
      setMessage(null);
      try {
        const nextIds = currentIds.filter((id) => id !== selectedCity.id);
        const response = await fetch("/api/user-access", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: selectedOwnerUser.id, allowed_city_pool_ids: nextIds }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || "Unable to remove city pool from coordinator account.");
        const savedIds = Array.isArray(result.allowed_city_pool_ids) ? result.allowed_city_pool_ids.map(String) : nextIds;
        setCoordinatorPoolAccessByUser((current) => ({ ...current, [selectedOwnerUser.id]: savedIds }));
        setMessageKind("success");
        setMessage(`${selectedCity.name} removed from ${userDisplayName(selectedOwnerUser)} Pool only. Master Pool was not changed.`);
        router.refresh();
      } catch (error) {
        setMessageKind("error");
        setMessage(error instanceof Error ? error.message : "Unable to remove city pool from coordinator account.");
      } finally {
        setSaving(false);
      }
      return;
    }

    const assignedCount = crewRecords.filter((record) => crewBelongsToCityPool(record, selectedCity.id)).length;
    const warning = assignedCount > 0
      ? `Delete city pool ${selectedCity.name}? ${assignedCount} contact${assignedCount === 1 ? "" : "s"} in this pool will move to Unassigned. This affects the Master Pool.`
      : `Delete empty city pool ${selectedCity.name} from the Master Pool?`;

    if (!window.confirm(warning)) return;

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/city-pools", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedCity.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to delete city pool.");

      const remainingPools = cityPools.filter((pool) => pool.id !== selectedCity.id);
      setCityPools(remainingPools);
      setCrewGroups((current) => current.filter((group) => group.city_pool_id !== selectedCity.id));
      setCrewRecords((current) => current.map((record) => {
        const additionalIds = (record.additional_city_pool_ids ?? []).filter((id) => id !== selectedCity.id);
        const additionalNames = (record.additional_city_pool_names ?? []).filter((name) => name !== selectedCity.name);
        if (record.city_pool_id === selectedCity.id) return { ...record, city_pool_id: null, city_name: "Unassigned", additional_city_pool_ids: additionalIds, additional_city_pool_names: additionalNames };
        if ((record.additional_city_pool_ids ?? []).includes(selectedCity.id)) return { ...record, additional_city_pool_ids: additionalIds, additional_city_pool_names: additionalNames };
        return record;
      }));
      setSelectedIds([]);
      setSelectedGroup(ALL_GROUPS);
      setCitySearch("");
      setGroupSearch("");
      const nextSelected = remainingPools[0]?.id || UNASSIGNED_CITY;
      setSelectedCityId(nextSelected);
      setBulkCityId(nextSelected !== UNASSIGNED_CITY ? nextSelected : "");
      setMessageKind("success");
      setMessage(assignedCount > 0
        ? `City pool deleted from Master Pool. ${assignedCount} contact${assignedCount === 1 ? "" : "s"} moved to Unassigned.`
        : "City pool deleted from Master Pool.");
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete city pool.");
    } finally {
      setSaving(false);
    }
  }

  async function createGroup() {
    if (!selectedCityId || selectedCityId === UNASSIGNED_CITY || !newGroupName.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/crew-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_pool_id: selectedCityId, name: newGroupName.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to create group.");
      const nextGroup = result.group as CrewGroupRecord;
      setCrewGroups((current) => {
        if (current.some((group) => group.city_pool_id === nextGroup.city_pool_id && group.name === nextGroup.name)) return current;
        return [...current, nextGroup];
      });
      setSelectedGroup(nextGroup.name);
      setBulkGroupName(nextGroup.name);
      setNewGroupName("");
      setMessageKind("success");
      setMessage(`Group created: ${nextGroup.name}`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to create group.");
    } finally {
      setSaving(false);
    }
  }

  async function renameSelectedGroup(groupName = selectedGroup) {
    if (!selectedCityId || selectedCityId === UNASSIGNED_CITY || groupName === ALL_GROUPS) return;
    const currentName = groupName.trim() || "Ungrouped";
    const nextName = window.prompt("Rename crew group", currentName)?.trim();
    if (!nextName || nextName === currentName) return;

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/crew-groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_pool_id: selectedCityId, old_name: currentName, name: nextName, owner_user_id: selectedOwnerUser?.id || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to rename group.");
      const nextGroup = result.group as CrewGroupRecord;

      setCrewGroups((current) => {
        const withoutOld = current.filter((group) => !(group.city_pool_id === selectedCityId && group.name === currentName));
        const exists = withoutOld.some((group) => group.city_pool_id === selectedCityId && group.name === nextGroup.name);
        return exists ? withoutOld : [...withoutOld, nextGroup].sort((a, b) => a.name.localeCompare(b.name));
      });
      const scopedOwnerId = selectedOwnerUser?.id || (!isAdminCrewView ? currentUserId : null);
      setCrewRecords((current) =>
        current.map((record) => {
          const ownerMatch = scopedOwnerId ? String(record.created_by || "") === scopedOwnerId : true;
          return ownerMatch && record.city_pool_id === selectedCityId && record.group_name === currentName ? { ...record, group_name: nextName } : record;
        })
      );
      setSelectedGroup(nextName);
      setBulkGroupName((current) => (current === currentName ? nextName : current));
      setMessageKind("success");
      setMessage(`Group renamed: ${currentName} → ${nextName}`);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to rename group.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSelectedGroup(groupName = selectedGroup) {
    if (!selectedCityId || selectedCityId === UNASSIGNED_CITY || groupName === ALL_GROUPS) return;
    const currentName = groupName.trim() || "Ungrouped";
    if (currentName === "Ungrouped") return;
    const scopeLabel = selectedOwnerUser ? `${userDisplayName(selectedOwnerUser)} Pool` : isAdminCrewView ? "Master Pool" : "your pool";
    if (!window.confirm(`Remove group "${currentName}" from ${scopeLabel}? Contacts in this group will move to Ungrouped/main pool. This will not delete contact records.`)) return;

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/crew-groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_pool_id: selectedCityId, name: currentName, owner_user_id: selectedOwnerUser?.id || undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "Unable to remove group.");

      const scopedOwnerId = selectedOwnerUser?.id || (!isAdminCrewView ? currentUserId : null);
      setCrewRecords((current) =>
        current.map((record) => {
          const ownerMatch = scopedOwnerId ? String(record.created_by || "") === scopedOwnerId : true;
          return ownerMatch && record.city_pool_id === selectedCityId && record.group_name === currentName ? { ...record, group_name: "Ungrouped" } : record;
        })
      );
      if (isAdminCrewView && !selectedOwnerUser) {
        setCrewGroups((current) => current.filter((group) => !(group.city_pool_id === selectedCityId && group.name === currentName)));
      }
      setSelectedGroup(ALL_GROUPS);
      setBulkGroupName((current) => (current === currentName ? "Ungrouped" : current));
      setMessageKind("success");
      setMessage(`${currentName} removed from ${scopeLabel}. ${Number(result.moved || 0)} contact${Number(result.moved || 0) === 1 ? "" : "s"} moved to Ungrouped.`);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to remove group.");
    } finally {
      setSaving(false);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function selectVisible() {
    setSelectedIds((current) => Array.from(new Set([...current, ...visibleCrew.map((record) => record.id)])));
  }

  function clearSelected() {
    setSelectedIds([]);
  }

  async function queueSelectedCrewMessage() {
    if (!selectedCrewForMessaging.length) {
      setMessageKind("error");
      setMessage("Select one or more crew contacts first.");
      return;
    }
    if (!bulkMessageBody.trim()) {
      setMessageKind("error");
      setMessage("Enter the message you want to send to the selected crew.");
      return;
    }
    if (!selectedCrewWithPhones.length) {
      setMessageKind("error");
      setMessage("None of the selected crew have valid phone numbers saved.");
      return;
    }
    setSaving(true);
    try {
      const data = await queueBulkCrewMessageForShortcut(selectedCrewForMessaging, bulkMessageBody);
      setMessageKind("success");
      setMessage(data.message || `Queued ${selectedCrewWithPhones.length} crew message${selectedCrewWithPhones.length === 1 ? "" : "s"} for the iPhone Shortcut.`);
      setBulkMessageOpen(false);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to queue selected crew messages.");
    } finally {
      setSaving(false);
    }
  }

  async function moveSelected(customIds?: string[], customCityId?: string, customGroupName?: string) {
    const idsToMove = customIds?.length ? customIds : selectedIds;
    if (!idsToMove.length) return;
    const targetCityId = customCityId || bulkCityId || (selectedCityId !== UNASSIGNED_CITY ? selectedCityId : "");
    const targetGroup = (customGroupName || bulkGroupName).trim() || "Ungrouped";
    if (!targetCityId) {
      setMessageKind("error");
      setMessage("Choose a destination city pool.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/crew-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_pool_id: targetCityId, name: targetGroup }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to create destination group.");
      if (result.group) {
        const group = result.group as CrewGroupRecord;
        setCrewGroups((current) => {
          if (current.some((item) => item.city_pool_id === group.city_pool_id && item.name === group.name)) return current;
          return [...current, group];
        });
      }

      const targetCity = cityPools.find((pool) => pool.id === targetCityId);
      for (const record of crewRecords.filter((record) => idsToMove.includes(record.id))) {
        const payload = {
          name: record.name,
          description: record.description,
          city_pool_id: targetCityId,
          city_name: targetCity?.name || record.city_name,
          group_name: targetGroup,
          tier: record.tier,
          email: record.email,
          phone: record.phone,
          other_city: record.other_city,
          ob: record.ob,
          notes: record.notes,
          conflict_companies: record.conflict_companies,
          unavailable_dates: record.unavailable_dates,
          positions: record.positions,
        };
        const moveResponse = await fetch(`/api/crew/${record.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const moveResult = await moveResponse.json();
        if (!moveResponse.ok) throw new Error(moveResult.message || `Move failed for ${record.name}.`);
      }

      setCrewRecords((current) =>
        current.map((record) =>
          idsToMove.includes(record.id)
            ? { ...record, city_pool_id: targetCityId, city_name: targetCity?.name || record.city_name, group_name: targetGroup }
            : record
        )
      );
      setSelectedIds((current) => current.filter((id) => !idsToMove.includes(id)));
      setMessageKind("success");
      setMessage(`Moved ${idsToMove.length} crew contact${idsToMove.length === 1 ? "" : "s"} to ${targetCity?.name || "selected city"} • ${targetGroup}.`);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to move selected crew.");
    } finally {
      setSaving(false);
    }
  }

  function exportVisibleContacts() {
    const headers = ["Name", "City", "Group", "Tier", "Email", "Phone", "Address", "Lead from", "Primary Role", "Rates", "OB", "Blacklisted", "Blacklist Reason", "Conflicts", "Unavailable Dates", "Notes"];
    const body = visibleCrew.map((record) => [
      record.name,
      record.city_name,
      record.group_name,
      record.tier,
      record.email,
      record.phone,
      record.address || "",
      record.lead_from || "",
      primaryRole(record),
      record.positions.map((position) => `${position.role_name}: ${formatMoney(Number(position.rate || 0))}`).join("; "),
      record.ob ? "Yes" : "No",
      record.blacklisted ? "Yes" : "No",
      record.blacklist_reason || "",
      record.conflict_companies.join("; "),
      record.unavailable_dates.join("; "),
      record.notes,
    ]);
    const csv = [headers, ...body].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `els-crew-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }


  function buildCsvImportDraft(row: Record<string, string>, poolsForImport = cityPools, primaryPool?: CityPoolRecord | null, additionalPoolIds: string[] = []): CrewDraft | null {
    const name = valueFromRow(row, ["name", "crew name", "contact name", "full name"]);
    if (!name.trim()) return null;

    const number = valueFromRow(row, ["number", "phone", "mobile", "contact number"]);
    const email = valueFromRow(row, ["email", "email address"]);
    const address = valueFromRow(row, ["address", "street address", "mailing address", "home address"]);
    const skills = valueFromRow(row, ["skills", "skill", "position", "role", "roles", "primary role"]);
    const capabilities = valueFromRow(row, ["capabilities", "capability"]);
    const tier = valueFromRow(row, ["tier", "teir", "group", "crew group"]);
    const notesValue = valueFromRow(row, ["notes:", "notes", "note"]);
    const descriptionValue = valueFromRow(row, ["description", "desc", "bio"]);
    const leadFrom = valueFromRow(row, ["lead from", "lead source", "source", "referred by", "referral", "contact source"]);
    const rateValue = Number(valueFromRow(row, ["rate", "pay rate", "hourly rate", "default rate"]) || 0);
    const groupName = tierGroupName(tier) || (selectedGroup !== ALL_GROUPS ? selectedGroup : "Ungrouped");
    const cityName = valueFromRow(row, ["city/state pool", "city state pool", "city pool", "pool", "location", "city"]);
    const city = primaryPool || poolsForImport.find((pool) => normalizeText(pool.name) === normalizeText(normalizeCityPoolLabel(cityName))) || (selectedCityId !== UNASSIGNED_CITY ? selectedCity : poolsForImport[0]);
    const positions = positionsFromSkillsets([skills, capabilities, valueFromRow(row, ["positions", "position", "roles", "role"])].filter(Boolean).join(", "));
    const ratedPositions = rateValue > 0 ? positions.map((position, index) => index === 0 ? { ...position, rate: rateValue } : position) : positions;

    return {
      ...blankDraft(poolsForImport, city?.id, groupName),
      name: name.trim(),
      description: descriptionValue.trim() || "Imported from master crew CSV.",
      city_pool_id: city?.id || "",
      city_name: city?.name || "",
      additional_city_pool_ids: additionalPoolIds.filter((id) => id && id !== city?.id),
      group_name: groupName,
      tier: String(tier || "").trim(),
      email: email.trim(),
      phone: cleanPhone(number),
      address: address.trim(),
      lead_from: leadFrom.trim(),
      onboarding_texted_called: parseBooleanLike(valueFromRow(row, ["texted", "texted/called", "called", "texted called"])),
      onboarding_response: parseBooleanLike(valueFromRow(row, ["response", "responded"])),
      onboarding_paperwork_sent: parseBooleanLike(valueFromRow(row, ["sent onboarding paperwork", "paperwork", "onboarding paperwork sent"])),
      onboarding_successfully_onboarded: parseBooleanLike(valueFromRow(row, ["successfully onboarded", "onboarded"])),
      onboarding_called_placed_tier: parseBooleanLike(valueFromRow(row, ["called and placed in tier", "called and placed in appropriate tier", "placed in tier"])),
      notes: mergeNotes(
        notesValue,
        skills ? `Skills: ${skills}` : "",
        capabilities ? `Capabilities: ${capabilities}` : "",
        poolNamesFromCsvRow(row).length ? `City/state pools: ${poolNamesFromCsvRow(row).join("; ")}` : "",
        leadFrom ? `Lead from: ${leadFrom}` : "",
        address ? `Address: ${address}` : "",
        tier ? `CSV tier: ${tier}` : ""
      ),
      positions: ratedPositions.length ? ratedPositions : [{ role_name: "", rate: rateValue || 0 }],
    };
  }

  function downloadMasterCsvTemplate() {
    const headers = [
      "Name",
      "Number",
      "Email",
      "Lead from",
      "Address",
      "Location",
      "City",
      "State",
      "Other Cities",
      "Skills",
      "Capabilities",
      "Tier",
      "Texted",
      "Response",
      "Sent onboarding paperwork",
      "Successfully Onboarded",
      "Called and placed in tier",
      "Notes"
    ];
    const rows = [
      headers,
      [
        "Christian Sample",
        "504-555-0100",
        "christian@example.com",
        "Nicole Anderson",
        "123 Example St",
        "New Orleans, LA",
        "New Orleans",
        "LA",
        "Atlanta, GA; Nashville, TN",
        "General AV; LED; Breakout",
        "Setup; Strike; Camera",
        "1",
        "Yes",
        "Yes",
        "No",
        "No",
        "No",
        "Reliable lead candidate. Willing to travel."
      ],
      [
        "Taylor Example",
        "404-555-0199",
        "taylor@example.com",
        "Facebook AV Freelancers Group",
        "456 Example Ave",
        "Atlanta, GA",
        "Atlanta",
        "GA",
        "New Orleans, LA",
        "Audio; Video; Stagehand",
        "A2; V2; General AV",
        "2",
        "Yes",
        "No",
        "No",
        "No",
        "No",
        "Needs onboarding paperwork."
      ]
    ];
    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ELS-master-crew-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function buildCsvPreviewRows(headers: string[], dataRows: string[][]) {
    return dataRows.map((values, index) => {
      const row: Record<string, string> = {};
      headers.forEach((header, cellIndex) => { row[header] = values[cellIndex] || ""; });
      const poolNames = poolNamesFromCsvRow(row);
      const primaryPoolName = poolNames[0] || "";
      const primaryPool = primaryPoolName ? cityPools.find((pool) => normalizeText(pool.name) === normalizeText(primaryPoolName)) || null : null;
      const draft = buildCsvImportDraft(row, cityPools, primaryPool || (selectedCityId !== UNASSIGNED_CITY ? selectedCity : cityPools[0]), []);
      const warnings: string[] = [];
      if (!draft) warnings.push("Missing name");
      if (draft && !draft.email && !phoneDigits(draft.phone)) warnings.push("No email or phone — duplicate matching will use exact name only");
      if (!poolNames.length) warnings.push("No city/state pool detected");
      poolNames.forEach((poolName) => {
        if (!cityPools.some((pool) => normalizeText(pool.name) === normalizeText(poolName))) warnings.push(`New pool will be created: ${poolName}`);
      });
      const draftPhoneDigits = draft ? phoneDigits(draft.phone) : "";
      const likelyDuplicate = draft ? crewRecords.find((record) =>
        (draft.email && record.email && normalizeText(record.email) === normalizeText(draft.email)) ||
        (draftPhoneDigits && phoneDigits(record.phone) === draftPhoneDigits) ||
        (draft.name && normalizeText(record.name) === normalizeText(draft.name))
      ) : null;
      if (likelyDuplicate) warnings.push(`Will merge/update existing contact: ${likelyDuplicate.name}`);
      return {
        tempId: `csv-${index + 2}-${draft?.name || "missing"}`,
        rowNumber: index + 2,
        selected: Boolean(draft),
        row,
        draft,
        poolNames,
        warnings,
        likelyDuplicate: likelyDuplicate?.name || "",
      } satisfies CsvPreviewRow;
    });
  }

  async function previewContactsCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setMessage(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("CSV must include a header row and at least one contact row.");
      const previewRows = buildCsvPreviewRows(rows[0], rows.slice(1));
      setCsvPreviewRows(previewRows);
      setCsvPreviewFileName(file.name);
      setMessageKind("success");
      setMessage(`Preview ready: ${previewRows.filter((row) => row.selected).length} of ${previewRows.length} contacts selected. Review the list, deselect anything that did not transfer correctly, then confirm import.`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to preview contacts CSV.");
    } finally {
      setSaving(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  function setCsvPreviewSelected(tempId: string, selected: boolean) {
    setCsvPreviewRows((current) => current.map((row) => row.tempId === tempId ? { ...row, selected } : row));
  }

  function setAllCsvPreviewSelected(selected: boolean) {
    setCsvPreviewRows((current) => current.map((row) => row.draft ? { ...row, selected } : row));
  }

  async function confirmCsvPreviewImport() {
    const rowsToImport = csvPreviewRows.filter((row) => row.selected && row.draft);
    if (!rowsToImport.length) {
      setMessageKind("error");
      setMessage("Select at least one valid preview row before importing.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const importedOrMerged: CrewRecord[] = [];
      const errors: string[] = [];
      let mergedCount = 0;
      let createdPoolCount = 0;
      let nextCityPools = [...cityPools];

      for (const previewRow of rowsToImport) {
        const row = previewRow.row;
        let ensuredPools: CityPoolRecord[] = [];
        try {
          const poolNames = previewRow.poolNames.length ? previewRow.poolNames : poolNamesFromCsvRow(row);
          for (const poolName of poolNames) {
            const ensured = await ensureCityPoolForImport(poolName, nextCityPools);
            if (ensured.created) {
              createdPoolCount += 1;
              nextCityPools = [...nextCityPools, ensured.pool].sort((a, b) => a.name.localeCompare(b.name));
            }
            if (!ensuredPools.some((pool) => pool.id === ensured.pool.id)) ensuredPools.push(ensured.pool);
          }
        } catch (error) {
          errors.push(`Row ${previewRow.rowNumber}: ${error instanceof Error ? error.message : "city/state pool failed"}`);
          continue;
        }

        const primaryPool = ensuredPools[0] || (selectedCityId !== UNASSIGNED_CITY ? selectedCity : nextCityPools[0]);
        const additionalPoolIds = ensuredPools.slice(1).map((pool) => pool.id);
        const nextDraft = buildCsvImportDraft(row, nextCityPools, primaryPool, additionalPoolIds);
        if (!nextDraft) {
          errors.push(`Row ${previewRow.rowNumber}: missing name`);
          continue;
        }

        const response = await fetch("/api/crew", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalizePayload(nextDraft)),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          errors.push(`Row ${previewRow.rowNumber}: ${result.message || "import failed"}`);
          continue;
        }
        if (result.merged) mergedCount += 1;
        importedOrMerged.push(recordFromDraft({ ...nextDraft, id: result.id }, nextCityPools));
      }

      if (nextCityPools.length !== cityPools.length) setCityPools(nextCityPools);

      if (importedOrMerged.length) {
        setCrewRecords((current) => {
          const next = [...current];
          for (const importedRecord of importedOrMerged) {
            const existingIndex = next.findIndex((record) => record.id === importedRecord.id);
            if (existingIndex >= 0) {
              const existing = next[existingIndex];
              next[existingIndex] = {
                ...existing,
                ...importedRecord,
                additional_city_pool_ids: Array.from(new Set([...(existing.additional_city_pool_ids ?? []), ...(importedRecord.additional_city_pool_ids ?? [])])),
                additional_city_pool_names: Array.from(new Set([...(existing.additional_city_pool_names ?? []), ...(importedRecord.additional_city_pool_names ?? [])])),
              };
            } else {
              next.unshift(importedRecord);
            }
          }
          return next;
        });
        setSelectedContactId(importedOrMerged[0].id);
        setCrewGroups((current) => {
          const map = new Map(current.map((group) => [`${group.city_pool_id}::${group.name}`, group]));
          for (const record of importedOrMerged) {
            if (record.city_pool_id && record.group_name) {
              map.set(`${record.city_pool_id}::${record.group_name}`, { id: `temp-${record.city_pool_id}-${record.group_name}`, city_pool_id: record.city_pool_id, name: record.group_name });
            }
          }
          return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        });
      }
      setCsvPreviewRows((current) => current.filter((row) => !rowsToImport.some((imported) => imported.tempId === row.tempId)));
      setMessageKind(errors.length ? "error" : "success");
      const createdCount = importedOrMerged.length - mergedCount;
      setMessage(errors.length
        ? `Imported/merged ${importedOrMerged.length} contacts (${createdCount} new, ${mergedCount} merged). Created ${createdPoolCount} city/state pool${createdPoolCount === 1 ? "" : "s"}. ${errors.slice(0, 3).join(" ")}${errors.length > 3 ? " …" : ""}`
        : `Master import complete: ${importedOrMerged.length} contacts (${createdCount} new, ${mergedCount} merged). Created ${createdPoolCount} city/state pool${createdPoolCount === 1 ? "" : "s"}. Duplicates were matched by email, phone, or name and updated instead of copied.`);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to import selected preview contacts.");
    } finally {
      setSaving(false);
    }
  }

  const selectedCityCount = cityCounts.get(selectedCityId) || 0;
  const selectedGroupCount = visibleCrew.length;
  const totalCrew = ownerScopedCrewRecords.length;
  const activeEditorTitle = adding ? "New crew contact" : draft?.name ? `Edit ${draft.name}` : "Edit crew contact";

  return (
    <div className="grid" style={{ gap: 16 }}>
      {message ? (
        <section className="card">
          <p className={messageKind === "error" ? "error" : "success"}>{message}</p>
        </section>
      ) : null}

      {!isAdminCrewView ? (
        <section className="card compact" style={{ background: "#fbfcfd" }}>
          <div className="row" style={{ alignItems: "center" }}>
            <div>
              <strong>My crew rating</strong>
              <p className="small muted" style={{ margin: "4px 0 0" }}>Median rating across your rated crew, based on approved survey/admin ratings.</p>
            </div>
            <span className="badge">{coordinatorRatingText(currentViewRatingSummary)}</span>
          </div>
        </section>
      ) : null}

      {isAdminCrewView ? (
        <section className="card compact" style={{ background: "#fbfcfd" }}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              <strong>Crew ownership view</strong>
              <p className="small muted" style={{ margin: "4px 0 0" }}>
                Master Pool shows every contact. Coordinator pools show only contacts added by that coordinator. Ratings below use approved survey/admin ratings attached to each crew profile.
              </p>
              <div className="toolbar" style={{ justifyContent: "flex-start", marginTop: 8 }}>
                <span className="badge">{selectedOwnerUser ? "Coordinator rating" : "Current view rating"}: {coordinatorRatingText(selectedOwnerUser ? coordinatorRatingByUser.get(selectedOwnerUser.id) : currentViewRatingSummary)}</span>
              </div>
            </div>
            <select value={crewOwnerView} onChange={(event) => { setCrewOwnerView(event.target.value); setSelectedGroup(ALL_GROUPS); setSelectedIds([]); setSelectedContactId(null); }} style={{ maxWidth: 320 }}>
              {crewOwnerViews.map((view) => <option key={view.id} value={view.id}>{view.label}</option>)}
            </select>
          </div>
          {selectedOwnerUser ? (
            <div className="card compact" style={{ background: "#fff", marginTop: 12 }}>
              <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                <div>
                  <strong>{userDisplayName(selectedOwnerUser)} Pool access</strong>
                  <div className="small" style={{ marginTop: 4 }}><strong>Coordinator rating:</strong> {coordinatorRatingText(coordinatorRatingByUser.get(selectedOwnerUser.id))}</div>
                  <p className="small muted" style={{ margin: "4px 0 0" }}>
                    These checkboxes give the coordinator city workspaces for organizing their own contacts only. Checking a city does not reveal Storm’s Master Pool contacts. Unchecking removes the workspace from their view; it does not delete the city pool or master contact records.
                  </p>
                </div>
                <button className="primary" type="button" disabled={coordinatorAccessSaving} onClick={() => void saveCoordinatorPoolAccess()}>
                  {coordinatorAccessSaving ? "Saving..." : "Save pool access"}
                </button>
              </div>
              <div className="grid grid-3" style={{ marginTop: 12 }}>
                {cityPoolsForDisplay.map((pool) => (
                  <label key={pool.id} className="checkbox-card">
                    <input type="checkbox" checked={selectedOwnerAllowedPoolSet.has(pool.id)} onChange={() => toggleCoordinatorPoolAccess(pool.id)} />
                    <span><strong>{pool.name}</strong><small>{selectedOwnerAllowedPoolSet.has(pool.id) ? "Selected" : "Not selected"}</small></span>
                  </label>
                ))}
              </div>
              <div className="row" style={{ alignItems: "end", marginTop: 12 }}>
                <label className="field" style={{ flex: 1 }}>
                  <span>Add new city pool to this coordinator account</span>
                  <input value={coordinatorNewPoolName} onChange={(event) => setCoordinatorNewPoolName(event.target.value)} placeholder="Example: Houston, TX" />
                </label>
                <button className="ghost" type="button" disabled={coordinatorAccessSaving || !coordinatorNewPoolName.trim()} onClick={() => void createPoolForSelectedCoordinator()}>Create + add to account</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="crew-bigin-shell" style={{ display: "grid", gridTemplateColumns: "260px minmax(360px, 1fr)", minHeight: 720 }}>
          <aside style={{ borderRight: "1px solid var(--line)", padding: 16, background: "#fbfcfd" }}>
            <div className="row" style={{ alignItems: "center", marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>Contacts</h3>
                <div className="muted small">{totalCrew} crew records</div>
              </div>
              <button className="primary" type="button" onClick={beginAdd}>+</button>
            </div>

            <label className="field" style={{ marginBottom: 14 }}>
              <span>Search all contacts</span>
              <input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="Name, phone, role, city…" />
            </label>

            <div className="list" style={{ gap: 8, marginBottom: 16 }}>
              {cityPoolsForDisplay.map((pool) => {
                const active = pool.id === selectedCityId;
                return (
                  <button
                    key={pool.id}
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setSelectedCityId(pool.id);
                      setSelectedGroup(ALL_GROUPS);
                      setCitySearch("");
                      setGroupSearch("");
                    }}
                    style={{ textAlign: "left", borderColor: active ? "var(--brand)" : undefined, background: active ? "#eef2f7" : "#fff" }}
                  >
                    <div className="row" style={{ alignItems: "center" }}>
                      <strong>{pool.name}</strong>
                      <span className="badge" style={{ margin: 0 }}>{cityCounts.get(pool.id) || 0}</span>
                    </div>
                  </button>
                );
              })}
              {(cityCounts.get(UNASSIGNED_CITY) || 0) > 0 ? (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    setSelectedCityId(UNASSIGNED_CITY);
                    setSelectedGroup(ALL_GROUPS);
                    setCitySearch("");
                    setGroupSearch("");
                  }}
                  style={{ textAlign: "left", borderColor: selectedCityId === UNASSIGNED_CITY ? "var(--brand)" : undefined, background: selectedCityId === UNASSIGNED_CITY ? "#eef2f7" : "#fff" }}
                >
                  <div className="row" style={{ alignItems: "center" }}>
                    <strong>Unassigned</strong>
                    <span className="badge" style={{ margin: 0 }}>{cityCounts.get(UNASSIGNED_CITY) || 0}</span>
                  </div>
                </button>
              ) : null}
            </div>

            <label className="field" style={{ marginBottom: 12 }}>
              <span>Filter this city</span>
              <input value={citySearch} onChange={(event) => setCitySearch(event.target.value)} placeholder="Role, tier, OB, notes…" />
            </label>

            <div className="field" style={{ marginBottom: 12 }}>
              <span>Groups</span>
              <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
                <option value={ALL_GROUPS}>All groups ({cityScopedCrew.length})</option>
                {availableGroups.map((group) => (
                  <option key={group.name} value={group.name}>{group.name} ({group.count})</option>
                ))}
              </select>
              {selectedGroup !== ALL_GROUPS && selectedCityId !== UNASSIGNED_CITY && isAdminCrewView && !selectedOwnerUser ? (
                <div className="editable-group-label group-edit-inline" title="Rename this crew group">
                  <span>{selectedGroup}</span>
                  <button className="edit-group-button" type="button" aria-label={`Rename ${selectedGroup}`} onClick={() => renameSelectedGroup(selectedGroup)} disabled={saving}>✎</button>
                </div>
              ) : null}
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <span>Quick filter</span>
              <select value={quickFilter} onChange={(event) => setQuickFilter(event.target.value as typeof quickFilter)}>
                <option value="all">All contacts</option>
                <option value="notOnboarded">Not yet onboarded</option>
                <option value="onboarded">Successfully onboarded</option>
                <option value="ob">OB only</option>
                <option value="blacklisted">Blacklisted</option>
                <option value="withConflicts">Has conflicts</option>
                <option value="unavailable">Has unavailable dates</option>
                <option value="noRole">Missing role</option>
              </select>
            </div>

            <div className="field" style={{ marginBottom: 12 }}>
              <span>Sort this pool</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}>
                <option value="name">Name A-Z</option>
                <option value="notOnboarded">Not onboarded first</option>
                <option value="rating">Highest rated first</option>
                <option value="tier">Tier / group</option>
              </select>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 14 }}>
              <label className="field">
                <span>Pool options</span>
                <select value={poolOptionMode} onChange={(event) => setPoolOptionMode(event.target.value as typeof poolOptionMode)}>
                  <option value="">Choose a pool or group action…</option>
                  <option value="add-city">Create city pool</option>
                  <option value="travel">Create/use Travel Techs pool</option>
                  {isAdminCrewView && !selectedOwnerUser ? <option value="rename">Rename selected city pool</option> : null}
                  {isAdminCrewView && !selectedOwnerUser ? <option value="delete">Delete selected city pool from Master Pool</option> : null}
                  {selectedOwnerUser ? <option value="delete">Remove selected pool from this coordinator account</option> : null}
                  <option value="create-group">Create group in this pool</option>
                  <option value="rename-group">Rename selected group</option>
                  <option value="remove-group">Remove selected group to main pool</option>
                </select>
              </label>
              {poolOptionMode === "add-city" ? (
                <div style={{ marginTop: 10 }}>
                  <label className="field">
                    <span>New city pool name</span>
                    <input value={newCityName} onChange={(event) => setNewCityName(event.target.value)} placeholder="Example: Birmingham, AL" />
                  </label>
                  <button className="ghost" type="button" onClick={addCityPool} disabled={saving || !newCityName.trim()} style={{ marginTop: 10, width: "100%" }}>Create city pool</button>
                </div>
              ) : null}
              {poolOptionMode === "travel" ? (
                <div style={{ marginTop: 10 }}>
                  <p className="muted small" style={{ marginTop: 0 }}>Use this when a contact can travel outside their primary market.</p>
                  <button className="ghost" type="button" onClick={ensureTravelTechsPool} disabled={saving} style={{ width: "100%" }}>Create/use Travel Techs pool</button>
                </div>
              ) : null}
              {poolOptionMode === "rename" ? (
                <div style={{ marginTop: 10 }}>
                  <p className="muted small" style={{ marginTop: 0 }}>Renames the currently selected city pool: <strong>{selectedCity?.name || "None selected"}</strong>.</p>
                  <button className="ghost" type="button" onClick={renameSelectedCityPool} disabled={saving || !selectedCity || selectedCityId === UNASSIGNED_CITY} style={{ width: "100%" }}>Rename selected city pool</button>
                </div>
              ) : null}
              {poolOptionMode === "delete" ? (
                <div style={{ marginTop: 10 }}>
                  <p className="muted small" style={{ marginTop: 0 }}>
                    {selectedOwnerUser
                      ? `Removes the selected city pool from ${userDisplayName(selectedOwnerUser)} Pool only. Master Pool contacts and city pools stay preserved.`
                      : "Deletes the selected city pool from the Master Pool. This option is hidden from coordinator users."}
                  </p>
                  <button
                    className="ghost danger"
                    type="button"
                    onClick={deleteSelectedCityPool}
                    disabled={saving || !selectedCity || selectedCityId === UNASSIGNED_CITY || (!selectedOwnerUser && !isAdminCrewView)}
                    style={{ width: "100%" }}
                    title={selectedOwnerUser ? "Remove this city pool from the coordinator account only." : "Deletes the selected city pool from the Master Pool."}
                  >
                    {selectedOwnerUser ? "Remove pool from coordinator account" : "Delete selected city pool from Master Pool"}
                  </button>
                </div>
              ) : null}
              {poolOptionMode === "create-group" ? (
                <div style={{ marginTop: 10 }}>
                  <label className="field">
                    <span>New group name</span>
                    <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Example: Tier 1" disabled={selectedCityId === UNASSIGNED_CITY} />
                  </label>
                  <button className="ghost" type="button" onClick={createGroup} disabled={saving || !selectedCityId || selectedCityId === UNASSIGNED_CITY || !newGroupName.trim()} style={{ marginTop: 10, width: "100%" }}>Create group</button>
                </div>
              ) : null}
              {poolOptionMode === "rename-group" ? (
                <div style={{ marginTop: 10 }}>
                  <p className="muted small" style={{ marginTop: 0 }}>Renames the selected group for the current view. Coordinator group edits only affect that coordinator’s own contacts.</p>
                  <button className="ghost" type="button" onClick={() => renameSelectedGroup(selectedGroup)} disabled={saving || selectedGroup === ALL_GROUPS || selectedCityId === UNASSIGNED_CITY} style={{ width: "100%" }}>Rename selected group</button>
                </div>
              ) : null}
              {poolOptionMode === "remove-group" ? (
                <div style={{ marginTop: 10 }}>
                  <p className="muted small" style={{ marginTop: 0 }}>Moves contacts in the selected group back to Ungrouped/main pool. It does not delete contact records.</p>
                  <button className="ghost danger" type="button" onClick={() => removeSelectedGroup(selectedGroup)} disabled={saving || selectedGroup === ALL_GROUPS || selectedCityId === UNASSIGNED_CITY} style={{ width: "100%" }}>Remove selected group</button>
                </div>
              ) : null}
            </div>
          </aside>

          <section style={{ borderRight: "1px solid var(--line)", padding: 16 }}>
            <div className="row" style={{ alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0 }}>{selectedCity?.name || (selectedCityId === UNASSIGNED_CITY ? "Unassigned" : "Crew contacts")}</h3>
                <div className="muted small">
                  {selectedGroup === ALL_GROUPS || selectedCityId === UNASSIGNED_CITY ? (
                    <span>{selectedGroup === ALL_GROUPS ? "All groups" : selectedGroup}</span>
                  ) : (
                    <span className="editable-group-label" title="Edit this crew group">
                      <span>{selectedGroup}</span>
                      <button className="edit-group-button" type="button" aria-label={`Rename ${selectedGroup}`} onClick={() => renameSelectedGroup(selectedGroup)} disabled={saving}>✎</button>
                      <button className="edit-group-button" type="button" aria-label={`Remove ${selectedGroup}`} onClick={() => removeSelectedGroup(selectedGroup)} disabled={saving} title="Move this group back to Ungrouped">×</button>
                    </span>
                  )} • {selectedGroupCount} visible
                </div>
              </div>
              <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                <button className="ghost" type="button" onClick={selectVisible}>Select</button>
                <button className="ghost" type="button" onClick={clearSelected}>Clear</button>
                <button className="primary" type="button" onClick={() => setBulkMessageOpen((current) => !current)} disabled={!selectedIds.length}>
                  {selectedIds.length ? `Message ${selectedIds.length}` : "Message selected"}
                </button>
              </div>
            </div>

            <label className="field" style={{ marginBottom: 12 }}>
              <span>Search visible list</span>
              <input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search this view…" />
            </label>

            {bulkMessageOpen ? (
              <div className="card compact" style={{ background: "#fbfcfd", marginBottom: 14 }}>
                <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Message selected crew</h3>
                    <p className="muted small" style={{ margin: "4px 0 0" }}>
                      Selected: {selectedCrewForMessaging.length}. Textable: {selectedCrewWithPhones.length}. These queue for the universal iPhone Shortcut pull.
                    </p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setBulkMessageOpen(false)}>Close</button>
                </div>
                <label className="field" style={{ marginTop: 12 }}>
                  <span>Message</span>
                  <textarea
                    value={bulkMessageBody}
                    onChange={(event) => setBulkMessageBody(event.target.value)}
                    rows={6}
                    placeholder="Hi {first_name}, this is Storm with Emanuel Labor Services..."
                  />
                </label>
                <div className="small muted" style={{ marginTop: 8 }}>
                  Available merge fields: {"{first_name}"}, {"{name}"}, {"{pool}"}, {"{role}"}. The app personalizes the text once for each selected crew member.
                </div>
                {selectedCrewMessagePreview ? (
                  <div className="card compact" style={{ background: "#fff", marginTop: 10 }}>
                    <strong>Preview for {selectedCrewForMessaging[0]?.name}</strong>
                    <p className="small muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{selectedCrewMessagePreview}</p>
                  </div>
                ) : null}
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button className="primary" type="button" onClick={queueSelectedCrewMessage} disabled={saving || !selectedCrewWithPhones.length || !bulkMessageBody.trim()}>
                    {saving ? "Queueing..." : `Queue ${selectedCrewWithPhones.length || ""} for Shortcut`}
                  </button>
                  <button className="ghost" type="button" onClick={() => setBulkMessageBody("Hi {first_name}, this is Storm with Emanuel Labor Services. I’m reaching out to check your availability for upcoming labor calls in {pool}. Please reply with your current availability and the roles you are comfortable taking.")}>Use availability template</button>
                </div>
              </div>
            ) : null}

            <div className="card compact" style={{ background: "#fbfcfd", marginBottom: 14 }}>
              <div className="row" style={{ alignItems: "baseline" }}>
                <div>
                  <h4 style={{ margin: 0 }}>Crew Leads in this pool</h4>
                  <p className="small muted" style={{ margin: "4px 0 0" }}>
                    Leads in this labor pool can use the Crew Lead feedback survey from Events → Feedback forms to rate assigned techs and give internal show notes.
                  </p>
                </div>
                <span className="badge">{crewLeadContactsForPool.length}</span>
              </div>
              {crewLeadContactsForPool.length ? (
                <div className="list" style={{ marginTop: 10 }}>
                  {crewLeadContactsForPool.slice(0, 8).map((lead) => (
                    <div key={lead.id} className="row" style={{ alignItems: "center" }}>
                      <div>
                        <strong>{lead.name}</strong>
                        <div className="small muted">{[primaryRole(lead), lead.phone ? cleanPhone(lead.phone) : "", lead.email].filter(Boolean).join(" • ")}</div>
                      </div>
                      <button className="ghost" type="button" onClick={() => beginEdit(lead)}>Open</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small muted" style={{ marginBottom: 0 }}>
                  No crew leads detected in this pool yet. Open a contact and check “Add to Crew Leads for this labor pool,” or add “Crew Lead” as a position.
                </p>
              )}
            </div>

            <div className="card compact" style={{ background: "#fbfcfd", marginBottom: 14 }}>
              <div className="row" style={{ alignItems: "center", gap: 12 }}>
                <div>
                  <strong>Advanced crew move tools</strong>
                  <p className="small muted" style={{ margin: "4px 0 0" }}>
                    Hidden by default. Use only when you need to move selected contacts into another city pool or group.
                  </p>
                </div>
                <button className="ghost" type="button" onClick={() => setBulkMoveOpen((current) => !current)} aria-expanded={bulkMoveOpen}>
                  {bulkMoveOpen ? "Hide" : "Show"}
                </button>
              </div>
              {bulkMoveOpen ? (
                <div className="row" style={{ alignItems: "end", marginTop: 12 }}>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1 }}>
                    <label className="field">
                      <span>Move selected to city / pool</span>
                      <select value={bulkCityId} onChange={(event) => setBulkCityId(event.target.value)}>
                        <option value="">Choose city</option>
                        {cityPoolsForDisplay.map((pool) => (
                          <option key={pool.id} value={pool.id}>{pool.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Move selected to group</span>
                      <select value={bulkGroupName} onChange={(event) => setBulkGroupName(event.target.value)}>
                        {targetGroupsForBulkCity.map((group) => (
                          <option key={group} value={group}>{group}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button className="primary" type="button" onClick={() => moveSelected()} disabled={saving || !selectedIds.length}>{selectedIds.length ? `Move ${selectedIds.length}` : "Move"}</button>
                </div>
              ) : null}
            </div>

            <div className="toolbar" style={{ marginBottom: 14 }}>
              <button className="primary" type="button" onClick={beginAdd}>Add contact</button>
              <button className="ghost" type="button" onClick={beginPastedFormImport}>Paste form / upload text</button>
              <button className="ghost" type="button" onClick={exportVisibleContacts}>Export visible</button>
              <button className="ghost" type="button" onClick={() => importInputRef.current?.click()} disabled={saving}>Preview master CSV</button>
              <button className="ghost" type="button" onClick={() => setCsvHelpOpen((current) => !current)} aria-expanded={csvHelpOpen} aria-label="Show CSV import heading help" title="CSV heading help">ⓘ CSV format</button>
              <button className="ghost" type="button" onClick={downloadMasterCsvTemplate}>Download CSV template</button>
              <input ref={importInputRef} type="file" accept=".csv,text/csv" onChange={previewContactsCsv} style={{ display: "none" }} />
              <span className="muted small">Choose a CSV to preview first. Nothing uploads until you confirm selected rows.</span>
            </div>

            {csvHelpOpen ? (
              <div className="card compact" style={{ background: "#fffdf2", borderColor: "rgba(244,197,66,.65)", marginBottom: 14 }}>
                <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div>
                    <h3 style={{ margin: "0 0 8px" }}>Master CSV import heading guide</h3>
                    <p className="muted" style={{ marginTop: 0 }}>
                      The first row of the CSV must be the heading row. The importer is flexible, but these headings work best.
                    </p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setCsvHelpOpen(false)}>Close</button>
                </div>
                <div className="grid grid-2">
                  <div>
                    <strong>Contact fields</strong>
                    <ul className="muted small" style={{ lineHeight: 1.7, marginTop: 8 }}>
                      <li><strong>Name</strong> or Contact Name — required.</li>
                      <li><strong>Number</strong>, Phone, Mobile, or Contact Number.</li>
                      <li><strong>Email</strong> or Email Address.</li>
                      <li><strong>Lead from</strong>, Lead Source, Source, Referred By, Referral, or Contact Source.</li>
                      <li><strong>Address</strong>, Street Address, Mailing Address, or Home Address.</li>
                      <li><strong>Notes</strong>, Note, or Notes:.</li>
                    </ul>
                  </div>
                  <div>
                    <strong>City/state pool fields</strong>
                    <ul className="muted small" style={{ lineHeight: 1.7, marginTop: 8 }}>
                      <li><strong>Location</strong> can be “New Orleans, LA”.</li>
                      <li><strong>City</strong> and <strong>State</strong> can be separate columns.</li>
                      <li><strong>City/State Pool</strong>, City Pool, Pool, or Market also work.</li>
                      <li><strong>Other Cities</strong> or Additional Pools can list extra pools separated by semicolons.</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Skills and grouping</strong>
                    <ul className="muted small" style={{ lineHeight: 1.7, marginTop: 8 }}>
                      <li><strong>Skills</strong>, Skill, Position, Role, Roles, or Primary Role.</li>
                      <li><strong>Capabilities</strong> or Capability.</li>
                      <li><strong>Tier</strong>, Teir, Group, or Crew Group.</li>
                      <li>Tier values like “1” become “Tier 1”; if the group does not exist, it is created.</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Onboarding checklist</strong>
                    <ul className="muted small" style={{ lineHeight: 1.7, marginTop: 8 }}>
                      <li><strong>Texted</strong> / Texted Called</li>
                      <li><strong>Response</strong> / Responded</li>
                      <li><strong>Sent onboarding paperwork</strong></li>
                      <li><strong>Successfully Onboarded</strong></li>
                      <li><strong>Called and placed in tier</strong></li>
                    </ul>
                  </div>
                </div>
                <p className="muted small" style={{ marginBottom: 0 }}>
                  Accepted checkmark values: Yes, Y, True, 1, X, Checked, Complete, Completed, or Done. Existing contacts are matched by email, phone, or exact name and updated instead of duplicated.
                </p>
              </div>
            ) : null}

            {csvPreviewRows.length ? (
              <div className="card compact" style={{ background: "#fff", marginBottom: 14 }}>
                <div className="row" style={{ alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>CSV import preview</h3>
                    <div className="muted small">
                      {csvPreviewFileName ? `${csvPreviewFileName} • ` : ""}{csvPreviewRows.filter((row) => row.selected).length} selected of {csvPreviewRows.length}. Review before upload.
                    </div>
                  </div>
                  <div className="toolbar">
                    <button className="ghost" type="button" onClick={() => setAllCsvPreviewSelected(true)} disabled={saving}>Select all valid</button>
                    <button className="ghost" type="button" onClick={() => setAllCsvPreviewSelected(false)} disabled={saving}>Deselect all</button>
                    <button className="primary" type="button" onClick={confirmCsvPreviewImport} disabled={saving || csvPreviewRows.every((row) => !row.selected)}>
                      {saving ? "Importing…" : "Confirm import selected"}
                    </button>
                    <button className="ghost" type="button" onClick={() => setCsvPreviewRows([])} disabled={saving}>Clear preview</button>
                  </div>
                </div>
                <div className="mobile-table" style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="muted small" style={{ textAlign: "left" }}>
                        <th style={{ padding: 8 }}>Include</th>
                        <th style={{ padding: 8 }}>Contact</th>
                        <th style={{ padding: 8 }}>Pool(s)</th>
                        <th style={{ padding: 8 }}>Skills</th>
                        <th style={{ padding: 8 }}>Warnings</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreviewRows.map((row) => (
                        <tr key={row.tempId} style={{ borderTop: "1px solid var(--line)" }}>
                          <td style={{ padding: 8, verticalAlign: "top" }}>
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={!row.draft || saving}
                              onChange={(event) => setCsvPreviewSelected(row.tempId, event.currentTarget.checked)}
                              aria-label={`Include row ${row.rowNumber}`}
                            />
                          </td>
                          <td style={{ padding: 8, verticalAlign: "top" }}>
                            <strong>{row.draft?.name || `Row ${row.rowNumber}`}</strong>
                            <div className="muted small">{row.draft?.phone || "No phone"} {row.draft?.email ? `• ${row.draft.email}` : ""}</div>
                            <div className="muted small">Row {row.rowNumber}{row.likelyDuplicate ? ` • merge: ${row.likelyDuplicate}` : ""}</div>
                          </td>
                          <td style={{ padding: 8, verticalAlign: "top" }}>
                            {(row.poolNames.length ? row.poolNames : [row.draft?.city_name || "No pool detected"]).map((pool) => <span key={pool} className="badge">{pool}</span>)}
                          </td>
                          <td style={{ padding: 8, verticalAlign: "top" }} className="small">
                            {row.draft?.positions?.map((position) => position.role_name).filter(Boolean).join(", ") || "No roles detected"}
                          </td>
                          <td style={{ padding: 8, verticalAlign: "top" }} className={row.warnings.length ? "error small" : "success small"}>
                            {row.warnings.length ? row.warnings.join(" • ") : "Looks ready"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {draft && adding ? (
              <div className="card compact" style={{ background: "#fbfcfd", marginBottom: 14 }}>
                <div className="row" style={{ alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>{activeEditorTitle}</h3>
                    <div className="muted small">Add the crew contact, roles, payout rates, notes, conflicts, and unavailable dates.</div>
                  </div>
                  <button className="ghost" type="button" onClick={() => closeEditor(selectedContactId || undefined)} disabled={saving}>Close</button>
                </div>
                {formImporterOpen ? (
                  <div className="card compact" style={{ background: "#fff", marginBottom: 14 }}>
                    <div className="row" style={{ alignItems: "flex-start", marginBottom: 10 }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Paste contact / applicant form text</h3>
                        <div className="muted small">Paste the website form text. The app will auto-fill name, email, phone, notes, roles, and city pool. If the detected city pool does not exist, it will ask before creating it.</div>
                      </div>
                      <button className="ghost" type="button" onClick={() => setFormImporterOpen(false)}>Hide</button>
                    </div>
                    <label className="field">
                      <span>Form text</span>
                      <textarea
                        value={formText}
                        onChange={(event) => setFormText(event.target.value)}
                        rows={8}
                        placeholder={"Name: Elizabeth Juarez\nEmail: e.juarez3@yahoo.com\nPhone: (469) 386-5272\nMessage: Hello...\nUpload Resume: Juarez.pdf\nSkillsets : Stagehand, Audio, Video"}
                      />
                    </label>
                    <div className="toolbar" style={{ marginTop: 10 }}>
                      <button className="primary" type="button" onClick={applyPastedFormText} disabled={saving}>{saving ? "Building..." : "Build contact from form"}</button>
                      <button className="ghost" type="button" onClick={() => setFormText("")}>Clear form text</button>
                    </div>
                  </div>
                ) : (
                  <button className="ghost" type="button" onClick={() => setFormImporterOpen(true)} style={{ marginBottom: 14 }}>Paste contact/applicant form text</button>
                )}

                <CrewEditor
                  cityPools={cityPoolsForDisplay}
                  crewGroups={crewGroups}
                  roleOptions={roleOptions}
                  defaultRateForRole={defaultRateForRole}
                  draft={draft}
                  onChange={setDraftField}
                  onPositionChange={setPosition}
                  onAddPosition={addPosition}
                  onRemovePosition={removePosition}
                  onSave={saveDraft}
                  onClose={() => closeEditor(selectedContactId || undefined)}
                  saving={saving}
                />
              </div>
            ) : null}

            <div className="crew-contact-list" style={{ border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
              <div className="row small muted crew-contact-list-head" style={{ padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid var(--line)", alignItems: "center" }}>
                <span style={{ width: 28 }} />
                <span style={{ flex: 1 }}>Name</span>
                <span className="crew-contact-role-head" style={{ width: 120 }}>Role</span>
                <span className="crew-contact-group-head" style={{ width: 90 }}>Group</span>
              </div>

              {visibleCrew.length === 0 ? (
                <div style={{ padding: 18 }}>
                  <h3 style={{ marginTop: 0 }}>No contacts found</h3>
                  <p className="muted" style={{ marginBottom: 0 }}>Try a different search, city, group, or quick filter.</p>
                </div>
              ) : visibleCrew.map((record) => {
                const isSelected = selectedIds.includes(record.id);
                const isActive = selectedContactId === record.id && !adding;
                return (
                  <Fragment key={record.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const nextActive = isActive ? null : record.id;
                        setSelectedContactId(nextActive);
                        setAdding(false);
                        setEditingId(null);
                        setDraft(null);
    setFormImporterOpen(false);
                        if (nextActive) setDetailTab("info");
                      }}
                      className="crew-contact-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        width: "100%",
                        gap: 10,
                        textAlign: "left",
                        border: 0,
                        borderBottom: isActive ? 0 : "1px solid var(--line)",
                        background: isActive ? "#eef2f7" : "#fff",
                        padding: "12px",
                        cursor: "pointer",
                        font: "inherit",
                      }}
                    >
                      <span onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(record.id)} />
                      </span>
                      <span style={{ width: 38, height: 38, borderRadius: 999, background: "#111827", color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                        {initials(record.name).toUpperCase()}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{record.name}</strong>
                        <span className="muted small" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {record.phone ? cleanPhone(record.phone) : "No phone"}{record.email ? ` • ${record.email}` : ""}{record.ob ? " • OB" : ""}{record.blacklisted ? " • Blacklisted" : ""}{` • ${onboardingStatusText(record)}`}
                        </span>
                        {isAdminCrewView && record.coordinator_hidden_at ? (
                          <span className="small" style={{ display: "block", color: "#b91c1c", fontWeight: 700 }}>
                            Deleted/hidden by coordinator{record.coordinator_hidden_at ? ` • ${record.coordinator_hidden_at.slice(0, 10)}` : ""}
                          </span>
                        ) : null}
                        <span className="small" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {ratingSummaryText(ratingSummaryByCrew.get(record.id))}
                        </span>
                      </span>
                      <span className="small crew-contact-role" style={{ width: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{positionSummary(record)}</span>
                      <span className="small muted crew-contact-group" style={{ width: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.group_name || "Ungrouped"}</span>
                      <span className="muted small" aria-hidden="true">{isActive ? "▲" : "▼"}</span>
                    </button>
                    {isActive ? (
                      <div className="crew-inline-detail" style={{ borderBottom: "1px solid var(--line)", background: "#fff", padding: 14 }}>
                        {draft && editingId === record.id ? (
                          <div>
                            <div className="row" style={{ alignItems: "center", marginBottom: 16 }}>
                              <div>
                                <h3 style={{ margin: 0 }}>{activeEditorTitle}</h3>
                                <div className="muted small">Save the crew contact, roles, payout rates, notes, conflicts, and unavailable dates.</div>
                              </div>
                              <button className="ghost" type="button" onClick={() => closeEditor(record.id)} disabled={saving}>Close</button>
                            </div>
                            <CrewEditor
                              cityPools={cityPoolsForDisplay}
                              crewGroups={crewGroups}
                              roleOptions={roleOptions}
                              defaultRateForRole={defaultRateForRole}
                              draft={draft}
                              onChange={setDraftField}
                              onPositionChange={setPosition}
                              onAddPosition={addPosition}
                              onRemovePosition={removePosition}
                              onSave={saveDraft}
                              onClose={() => closeEditor(record.id)}
                              saving={saving}
                            />
                          </div>
                        ) : (
                          <ContactDetail
                            record={record}
                            ratingSummary={ratingSummaryByCrew.get(record.id) || null}
                            cityPools={cityPoolsForDisplay}
                            targetGroups={targetGroupsForBulkCity}
                            bulkCityId={bulkCityId || record.city_pool_id || ""}
                            bulkGroupName={bulkGroupName || record.group_name || "Ungrouped"}
                            detailTab={detailTab}
                            onTab={setDetailTab}
                            onEdit={() => beginEdit(record)}
                            onDelete={() => deleteRecord(record.id)}
                            onMove={(cityId, groupName) => moveSelected([record.id], cityId, groupName)}
                            onBulkCityChange={setBulkCityId}
                            onBulkGroupChange={setBulkGroupName}
                            saving={saving}
                            canSeeAdminAudit={isAdminCrewView}
                          />
                        )}
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </section>

        </div>
      </section>
    </div>
  );
}

type ContactDetailProps = {
  record: CrewRecord;
  ratingSummary: CrewRatingSummary | null;
  cityPools: CityPoolRecord[];
  targetGroups: string[];
  bulkCityId: string;
  bulkGroupName: string;
  detailTab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (cityId: string, groupName: string) => void;
  onBulkCityChange: (value: string) => void;
  onBulkGroupChange: (value: string) => void;
  saving: boolean;
  canSeeAdminAudit: boolean;
};

function ContactDetail({ record, ratingSummary, cityPools, targetGroups, bulkCityId, bulkGroupName, detailTab, onTab, onEdit, onDelete, onMove, onBulkCityChange, onBulkGroupChange, saving, canSeeAdminAudit }: ContactDetailProps) {
  const phoneHref = record.phone ? `tel:${record.phone.replace(/[^0-9+]/g, "")}` : undefined;
  const smsHref = record.phone ? `sms:${record.phone.replace(/[^0-9+]/g, "")}` : undefined;
  const emailHref = record.email ? `mailto:${record.email}` : undefined;

  return (
    <div>
      <div style={{ border: "1px solid var(--line)", borderRadius: 18, padding: 18, background: "#fbfcfd", marginBottom: 14 }}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 12, alignItems: "center", justifyContent: "flex-start" }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: "#111827", color: "white", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800 }}>
              {initials(record.name).toUpperCase()}
            </div>
            <div>
              <h2 style={{ margin: 0 }}>{record.name}</h2>
              <div className="muted">{primaryRole(record)} • {poolNamesForRecord(record)} • {record.group_name}</div>
              <div className="muted small">{record.tier ? `Tier ${record.tier}` : "No tier"}{record.ob ? " • OB" : ""}{record.blacklisted ? " • Blacklisted" : ""}</div>
              <div className="small"><strong>Approved rating:</strong> {ratingSummaryText(ratingSummary)}</div>
              {canSeeAdminAudit && record.coordinator_hidden_at ? (
                <div className="small" style={{ color: "#b91c1c", fontWeight: 700 }}>
                  Deleted/hidden by coordinator on {record.coordinator_hidden_at.slice(0, 10)}. Kept in Master Pool for admin review.
                </div>
              ) : null}
            </div>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <button className="primary" type="button" onClick={onEdit}>Edit</button>
            <button className="ghost danger" type="button" onClick={onDelete} disabled={saving}>Delete</button>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 16 }}>
          <a className="ghost" href={phoneHref || "#"} aria-disabled={!phoneHref}>Call</a>
          <a className="ghost" href={smsHref || "#"} aria-disabled={!smsHref}>Text</a>
          <a className="ghost" href={emailHref || "#"} aria-disabled={!emailHref}>Email</a>
          {canSeeAdminAudit ? (
            <>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  const message = buildSquarespaceIntroMessage(record);
                  if (navigator.clipboard?.writeText) {
                    void navigator.clipboard.writeText(message);
                    window.alert("Introductory message copied.");
                  } else {
                    window.prompt("Copy introductory message", message);
                  }
                }}
              >
                Copy intro message
              </button>
              <button
                className="ghost"
                type="button"
                disabled={!record.phone}
                onClick={async () => {
                  try {
                    await queueSquarespaceIntroForShortcut(record);
                    window.alert("Intro text queued for the iPhone Shortcut.");
                  } catch (error) {
                    window.alert(error instanceof Error ? error.message : "Unable to queue intro text.");
                  }
                }}
              >
                Queue intro for Shortcut
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        {(["info", "roles", "availability", ...(canSeeAdminAudit ? ["onboarding" as const] : []), "notes", "move"] as DetailTab[]).map((tab) => (
          <button key={tab} className={detailTab === tab ? "primary" : "ghost"} type="button" onClick={() => onTab(tab)}>
            {tab === "info" ? "Info" : tab === "roles" ? "Roles & rates" : tab === "availability" ? "Availability" : tab === "onboarding" ? "Onboarding" : tab === "notes" ? "Notes" : "Move"}
          </button>
        ))}
      </div>

      {detailTab === "info" ? (
        <div className="list">
          <InfoRow label="Phone" value={record.phone ? cleanPhone(record.phone) : "No phone saved"} />
          <InfoRow label="Email" value={record.email || "No email saved"} />
          <InfoRow label="Address" value={record.address || "No address saved"} />
          <InfoRow label="Lead from" value={record.lead_from || "Not tracked yet"} />
          {canSeeAdminAudit ? (
            <>
              <InfoRow label="Onboarding status" value={statusLabel(record.onboarding_status || "not_started", onboardingStatusOptions)} />
              <InfoRow label="W-9 status" value={statusLabel(record.w9_status || "missing", documentStatusOptions)} />
              <InfoRow label="Contract status" value={statusLabel(record.contract_status || "missing", documentStatusOptions)} />
            </>
          ) : null}
          <InfoRow label="Show rating median" value={ratingSummaryText(ratingSummary)} />
          <InfoRow label="Rating count" value={ratingSummary?.count ? `${ratingSummary.count} saved show rating${ratingSummary.count === 1 ? "" : "s"}` : "No approved/admin show ratings"} />
          <InfoRow label="Primary city pool" value={visiblePoolName(record.city_name)} />
          <InfoRow label="Additional pools" value={visibleAdditionalPoolNames(record).length ? visibleAdditionalPoolNames(record).join(", ") : "None"} />
          {canSeeAdminAudit ? <InfoRow label="Added by" value={record.created_by ? "Tracked coordinator/admin user" : "Master/imported record"} /> : null}
          {canSeeAdminAudit && record.coordinator_hidden_at ? <InfoRow label="Coordinator delete note" value={`Hidden by coordinator on ${record.coordinator_hidden_at.slice(0, 10)}. This is still retained in Master Pool.`} /> : null}
          <InfoRow label="Group" value={record.group_name || "Ungrouped"} />
          <InfoRow label="Other city" value={record.other_city || "None"} />
          <InfoRow label="Description" value={record.description || "No description"} />
          {canSeeAdminAudit ? (
            <div className="card compact" style={{ background: "#fbfcfd" }}>
              <h3 style={{ marginTop: 0 }}>Squarespace submission intro</h3>
              <p className="muted small" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{buildSquarespaceIntroMessage(record)}</p>
            </div>
          ) : null}
          <div className="card compact" style={{ background: "#fbfcfd" }}>
            <h3 style={{ marginTop: 0 }}>Onboarding</h3>
            <div className="grid grid-2">
              {ONBOARDING_STEPS.map((step) => (
                <div key={step.key} className="badge" style={{ background: record[step.key] ? "var(--success-soft)" : "#fff", borderColor: record[step.key] ? "rgba(6,118,71,.25)" : undefined }}>
                  {record[step.key] ? "✓" : "○"} {step.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {canSeeAdminAudit && detailTab === "onboarding" ? (
        <div className="list">
          <div className="card compact" style={{ background: "#fbfcfd" }}>
            <h3 style={{ marginTop: 0 }}>Onboarding Center</h3>
            <p className="muted small">Track W-9, contract, questionnaire, profile photo, work photos, and tax profile review for this crew member.</p>
            <div className="grid grid-2">
              <InfoRow label="Overall onboarding" value={statusLabel(record.onboarding_status || "not_started", onboardingStatusOptions)} />
              <InfoRow label="Questionnaire" value={statusLabel(record.questionnaire_status || "missing", documentStatusOptions)} />
              <InfoRow label="W-9" value={statusLabel(record.w9_status || "missing", documentStatusOptions)} />
              <InfoRow label="Contract" value={statusLabel(record.contract_status || "missing", documentStatusOptions)} />
              <InfoRow label="Tax profile" value={statusLabel(record.tax_profile_status || "missing", documentStatusOptions)} />
              <InfoRow label="Request sent" value={record.onboarding_request_sent_at ? record.onboarding_request_sent_at.slice(0, 10) : "Not sent"} />
              <InfoRow label="Completed" value={record.onboarding_completed_at ? record.onboarding_completed_at.slice(0, 10) : "Not complete"} />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="card compact" style={{ background: "#fbfcfd" }}>
              <h3 style={{ marginTop: 0 }}>Files / links</h3>
              <InfoRow label="Profile photo" value={record.profile_photo_url || "Missing"} />
              <InfoRow label="W-9 document" value={record.w9_document_url || "Missing"} />
              <InfoRow label="Contract document" value={record.contract_document_url || "Missing"} />
              <InfoRow label="Work photos" value={(record.work_photo_urls || []).length ? `${record.work_photo_urls?.length} saved` : "None"} />
            </div>
            <div className="card compact" style={{ background: "#fff7ed" }}>
              <h3 style={{ marginTop: 0 }}>Photo compression target</h3>
              <p className="small muted" style={{ margin: 0 }}>
                Profile photos should be compressed to WebP around 800×800. Work photos should be resized to about 1600px wide. Keep W-9/contract PDFs readable and private.
              </p>
            </div>
          </div>
          {record.tax_profile_notes ? (
            <div className="card compact" style={{ background: "#fbfcfd" }}>
              <h3 style={{ marginTop: 0 }}>Tax profile notes</h3>
              <p className="small muted" style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>{record.tax_profile_notes}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {detailTab === "roles" ? (
        <div className="list">
          <p className="muted small" style={{ marginTop: 0 }}>These are crew payout rates, not client billing rates. Edit the contact to change what you pay this person.</p>
          {record.positions.length ? record.positions.map((position) => (
            <div key={`${record.id}-${position.role_name}-${position.rate}`} className="card compact" style={{ background: "#fbfcfd" }}>
              <div className="row">
                <strong>{position.role_name}</strong>
                <span className="badge" style={{ margin: 0 }}>{formatMoney(Number(position.rate || 0))}</span>
              </div>
            </div>
          )) : <p className="muted">No roles saved yet.</p>}
        </div>
      ) : null}

      {detailTab === "availability" ? (
        <div className="list">
          <div className="card compact" style={{ background: "#fbfcfd" }}>
            <h3 style={{ marginBottom: 8 }}>Unavailable dates</h3>
            {record.unavailable_dates.length ? record.unavailable_dates.map((date) => <span key={date} className="badge">{date}</span>) : <p className="muted">No unavailable dates saved.</p>}
          </div>
          <div className="card compact" style={{ background: "#fbfcfd" }}>
            <h3 style={{ marginBottom: 8 }}>Conflict companies</h3>
            {record.conflict_companies.length ? record.conflict_companies.map((company) => <span key={company} className="badge">{company}</span>) : <p className="muted">No conflict companies saved.</p>}
          </div>
        </div>
      ) : null}

      {detailTab === "notes" ? (
        <div className="card compact" style={{ background: "#fbfcfd" }}>
          <h3 style={{ marginBottom: 8 }}>Notes</h3>
          <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{record.notes || "No notes saved."}</p>
        </div>
      ) : null}

      {detailTab === "move" ? (
        <div className="card compact" style={{ background: "#fbfcfd" }}>
          <h3 style={{ marginTop: 0 }}>Move contact</h3>
          <div className="grid grid-2">
            <label className="field">
              <span>Destination city</span>
              <select value={bulkCityId} onChange={(event) => onBulkCityChange(event.target.value)}>
                <option value="">Choose city</option>
                {cityPools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Destination group</span>
              <select value={bulkGroupName} onChange={(event) => onBulkGroupChange(event.target.value)}>
                {targetGroups.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
          </div>
          <button className="primary" type="button" onClick={() => onMove(bulkCityId, bulkGroupName)} disabled={saving || !bulkCityId} style={{ marginTop: 12 }}>Move this contact</button>
        </div>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
      <span className="muted">{label}</span>
      <strong style={{ textAlign: "right" }}>{value}</strong>
    </div>
  );
}

type CrewEditorProps = {
  cityPools: CityPoolRecord[];
  crewGroups: CrewGroupRecord[];
  roleOptions: Array<{ roleName: string; fullDay: number; halfDay: number | null; featured?: boolean }>;
  defaultRateForRole: (roleName: string) => number;
  draft: CrewDraft;
  onChange: (key: keyof CrewDraft, value: CrewDraft[keyof CrewDraft]) => void;
  onPositionChange: (index: number, patch: Partial<PositionInput>) => void;
  onAddPosition: () => void;
  onRemovePosition: (index: number) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
};

function CrewEditor({ cityPools, crewGroups, roleOptions, defaultRateForRole, draft, onChange, onPositionChange, onAddPosition, onRemovePosition, onSave, onClose, saving }: CrewEditorProps) {
  const [additionalPoolsOpen, setAdditionalPoolsOpen] = useState(false);
  const [customGroupOpen, setCustomGroupOpen] = useState(false);
  const additionalPoolCount = (draft.additional_city_pool_ids || []).filter((id) => id !== draft.city_pool_id).length;
  const groupOptionsForPool = useMemo(() => {
    const names = new Set<string>(["Ungrouped"]);
    crewGroups
      .filter((group) => group.city_pool_id === draft.city_pool_id)
      .forEach((group) => {
        const name = String(group.name || "").trim();
        if (name) names.add(name);
      });
    const currentGroup = String(draft.group_name || "").trim();
    if (currentGroup) names.add(currentGroup);
    return Array.from(names).sort((a, b) => {
      if (a === "Ungrouped") return -1;
      if (b === "Ungrouped") return 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [crewGroups, draft.city_pool_id, draft.group_name]);
  const selectedGroupOption = customGroupOpen ? "__custom__" : (groupOptionsForPool.includes(draft.group_name || "Ungrouped") ? (draft.group_name || "Ungrouped") : "__custom__");

  return (
    <div className="list">
      <div className="grid grid-2">
        <label className="field">
          <span>Name</span>
          <input value={draft.name} onChange={(event) => onChange("name", event.target.value)} />
        </label>
        <label className="field">
          <span>Primary city pool</span>
          <select value={draft.city_pool_id} onChange={(event) => {
            const city = cityPools.find((pool) => pool.id === event.target.value);
            onChange("city_pool_id", event.target.value);
            onChange("city_name", city?.name || "");
          }}>
            <option value="">No city pool</option>
            {cityPools.map((pool) => (
              <option key={pool.id} value={pool.id}>{pool.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="card compact" style={{ background: "#fbfcfd" }}>
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          <div>
            <strong>Additional city pools</strong>
            <div className="muted small">Collapsed by default. Use this only for nearby cities or travel techs. The contact stays one record and can appear in multiple pools.</div>
            <div className="small muted" style={{ marginTop: 4 }}>{additionalPoolCount ? `${additionalPoolCount} additional pool${additionalPoolCount === 1 ? "" : "s"} selected` : "No additional pools selected"}</div>
          </div>
          <button className="ghost" type="button" onClick={() => setAdditionalPoolsOpen((current) => !current)} aria-expanded={additionalPoolsOpen}>
            {additionalPoolsOpen ? "Hide" : "Show"}
          </button>
        </div>
        {additionalPoolsOpen ? (
          <div style={{ marginTop: 12 }}>
            <label className="field checkboxField" style={{ marginBottom: 10 }}>
              <span>Add to Travel Techs pool</span>
              <input
                type="checkbox"
                checked={(draft.additional_city_pool_ids || []).some((id) => normalizeText(cityPools.find((pool) => pool.id === id)?.name || "") === "travel techs")}
                onChange={(event) => {
                  const travelPool = cityPools.find((pool) => normalizeText(pool.name) === "travel techs");
                  if (!travelPool) {
                    window.alert("Create a city pool named Travel Techs first, then check this box.");
                    return;
                  }
                  const current = draft.additional_city_pool_ids || [];
                  onChange("additional_city_pool_ids", event.target.checked ? Array.from(new Set([...current, travelPool.id])) : current.filter((id) => id !== travelPool.id));
                }}
              />
            </label>
            <div className="grid grid-2">
              {cityPools.map((pool) => {
                const checked = (draft.additional_city_pool_ids || []).includes(pool.id);
                const disabled = pool.id === draft.city_pool_id;
                return (
                  <label key={pool.id} className="field checkboxField" style={{ opacity: disabled ? 0.55 : 1 }}>
                    <span>{pool.name}{disabled ? " (primary)" : ""}</span>
                    <input
                      type="checkbox"
                      checked={checked || disabled}
                      disabled={disabled}
                      onChange={(event) => {
                        const current = draft.additional_city_pool_ids || [];
                        const next = event.target.checked ? Array.from(new Set([...current, pool.id])) : current.filter((id) => id !== pool.id);
                        onChange("additional_city_pool_ids", next.filter((id) => id !== draft.city_pool_id));
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-2">
        <label className="field">
          <span>Group</span>
          <select
            value={selectedGroupOption}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "__custom__") {
                setCustomGroupOpen(true);
                onChange("group_name", "");
              } else {
                setCustomGroupOpen(false);
                onChange("group_name", value);
              }
            }}
          >
            {groupOptionsForPool.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
            <option value="__custom__">Add new group...</option>
          </select>
          {customGroupOpen ? (
            <input
              value={draft.group_name}
              onChange={(event) => onChange("group_name", event.target.value)}
              placeholder="Type new group name"
              style={{ marginTop: 8 }}
            />
          ) : null}
          <span className="muted small">Groups shown are from the selected primary city pool.</span>
        </label>
        <label className="field"><span>Tier</span><input value={draft.tier} onChange={(event) => onChange("tier", event.target.value)} /></label>
      </div>

      <div className="card compact" style={{ background: "#fbfcfd" }}>
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 4px" }}>Crew Lead section</h3>
            <p className="muted small" style={{ margin: 0 }}>
              Check this to show this contact under <strong>Crew Leads in this pool</strong>. It adds a Crew Lead position to this same contact; it does not create a duplicate contact.
            </p>
          </div>
          <span className="badge" style={{ margin: 0 }}>{draftHasCrewLeadPosition(draft) ? "Lead" : "Standard"}</span>
        </div>
        <label className="field checkboxField" style={{ marginTop: 12 }}>
          <span>Add to Crew Leads for this labor pool</span>
          <input
            type="checkbox"
            checked={draftHasCrewLeadPosition(draft)}
            onChange={(event) => onChange("positions", withCrewLeadPosition(draft, event.target.checked, defaultRateForRole("Crew Lead")))}
          />
        </label>
      </div>

      <div className="grid grid-2">
        <label className="field"><span>Email</span><input value={draft.email} onChange={(event) => onChange("email", event.target.value)} /></label>
        <label className="field"><span>Phone</span><input value={draft.phone} onChange={(event) => onChange("phone", event.target.value)} /></label>
      </div>

      <div className="grid grid-2">
        <label className="field"><span>Address</span><input value={draft.address} onChange={(event) => onChange("address", event.target.value)} placeholder="Street address, city, state if known" /></label>
        <label className="field"><span>Lead from / contact source</span><input value={draft.lead_from} onChange={(event) => onChange("lead_from", event.target.value)} placeholder="Nicole Anderson, Facebook, referral, etc." /></label>
        <label className="field"><span>Other city</span><input value={draft.other_city} onChange={(event) => onChange("other_city", event.target.value)} /></label>
      </div>

      <div className="grid grid-2">
        <label className="field checkboxField">
          <span>OB</span>
          <input type="checkbox" checked={draft.ob} onChange={(event) => onChange("ob", event.target.checked)} />
        </label>
      </div>

      <div className="card compact" style={{ background: "#fbfcfd" }}>
        <h3 style={{ marginTop: 0 }}>Onboarding checklist</h3>
        <p className="muted small" style={{ marginTop: -4 }}>Track where this contact stands before they are fully available for scheduling.</p>
        <div className="grid grid-2">
          <label className="field checkboxField"><span>Texted/called</span><input type="checkbox" checked={draft.onboarding_texted_called} onChange={(event) => onChange("onboarding_texted_called", event.target.checked)} /></label>
          <label className="field checkboxField"><span>Response</span><input type="checkbox" checked={draft.onboarding_response} onChange={(event) => onChange("onboarding_response", event.target.checked)} /></label>
          <label className="field checkboxField"><span>Sent onboarding paperwork</span><input type="checkbox" checked={draft.onboarding_paperwork_sent} onChange={(event) => onChange("onboarding_paperwork_sent", event.target.checked)} /></label>
          <label className="field checkboxField"><span>Successfully onboarded</span><input type="checkbox" checked={draft.onboarding_successfully_onboarded} onChange={(event) => onChange("onboarding_successfully_onboarded", event.target.checked)} /></label>
          <label className="field checkboxField"><span>Called and placed in appropriate tier</span><input type="checkbox" checked={draft.onboarding_called_placed_tier} onChange={(event) => onChange("onboarding_called_placed_tier", event.target.checked)} /></label>
        </div>
      </div>

      {canSeeAdminAudit ? (
      <div className="card compact" style={{ background: "#fbfcfd" }}>
        <h3 style={{ marginTop: 0 }}>Onboarding Center / Tax & documents</h3>
        <p className="muted small" style={{ marginTop: -4 }}>Use links or storage paths for now. Future build can turn these into secure upload buttons and signed onboarding links.</p>
        <div className="grid grid-2">
          <label className="field"><span>Overall onboarding status</span><select value={draft.onboarding_status} onChange={(event) => onChange("onboarding_status", event.target.value)}>{onboardingStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Questionnaire status</span><select value={draft.questionnaire_status} onChange={(event) => onChange("questionnaire_status", event.target.value)}>{documentStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>W-9 status</span><select value={draft.w9_status} onChange={(event) => onChange("w9_status", event.target.value)}>{documentStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Contract status</span><select value={draft.contract_status} onChange={(event) => onChange("contract_status", event.target.value)}>{documentStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Tax profile status</span><select value={draft.tax_profile_status} onChange={(event) => onChange("tax_profile_status", event.target.value)}>{documentStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Onboarding request sent date</span><input type="date" value={draft.onboarding_request_sent_at?.slice(0, 10) || ""} onChange={(event) => onChange("onboarding_request_sent_at", event.target.value)} /></label>
          <label className="field"><span>Onboarding completed date</span><input type="date" value={draft.onboarding_completed_at?.slice(0, 10) || ""} onChange={(event) => onChange("onboarding_completed_at", event.target.value)} /></label>
          <label className="field"><span>Profile photo path/link</span><input value={draft.profile_photo_url} onChange={(event) => onChange("profile_photo_url", event.target.value)} placeholder="crew-profile-photos/name.webp or secure link" /></label>
          <label className="field"><span>W-9 document path/link</span><input value={draft.w9_document_url} onChange={(event) => onChange("w9_document_url", event.target.value)} placeholder="Private W-9 storage path" /></label>
          <label className="field"><span>Contract document path/link</span><input value={draft.contract_document_url} onChange={(event) => onChange("contract_document_url", event.target.value)} placeholder="Private contract storage path" /></label>
        </div>
        <label className="field"><span>Work photo paths/links</span><textarea value={draft.work_photo_urls_text} onChange={(event) => onChange("work_photo_urls_text", event.target.value)} rows={3} placeholder="One work photo path/link per line" /></label>
        <label className="field"><span>Tax profile / W-9 review notes</span><textarea value={draft.tax_profile_notes} onChange={(event) => onChange("tax_profile_notes", event.target.value)} rows={3} placeholder="Legal name review, TIN last 4, correction request, approval notes..." /></label>
      </div>
      ) : null}

      <div className="card compact" style={{ background: draft.blacklisted ? "#fff1f2" : "#fbfcfd", borderColor: draft.blacklisted ? "#fb7185" : "var(--line)" }}>
        <label className="field checkboxField" style={{ marginBottom: 10 }}>
          <span>Blacklist / do not assign</span>
          <input type="checkbox" checked={draft.blacklisted} onChange={(event) => onChange("blacklisted", event.target.checked)} />
        </label>
        <label className="field"><span>Blacklist reason</span><input value={draft.blacklist_reason} onChange={(event) => onChange("blacklist_reason", event.target.value)} placeholder="Internal reason. Hidden from event assignment picker." /></label>
      </div>

      <label className="field"><span>Description</span><input value={draft.description} onChange={(event) => onChange("description", event.target.value)} /></label>
      <label className="field"><span>Conflict companies</span><input value={draft.conflict_companies_text} onChange={(event) => onChange("conflict_companies_text", event.target.value)} placeholder="Company A, Company B" /></label>
      <label className="field"><span>Unavailable dates</span><textarea value={draft.unavailable_dates_text} onChange={(event) => onChange("unavailable_dates_text", event.target.value)} rows={3} placeholder="2026-05-01" /></label>
      <label className="field"><span>Notes</span><textarea value={draft.notes} onChange={(event) => onChange("notes", event.target.value)} rows={4} /></label>
      <label className="field"><span>Resume file name or link</span><input value={draft.resume_link} onChange={(event) => onChange("resume_link", event.target.value)} placeholder="Paste resume file name, Google Drive link, or storage link" /></label>
      <p className="muted small" style={{ marginTop: -8 }}>This stores a resume reference/link with the contact notes. It avoids filling the app database with large resume files.</p>

      <div className="field">
        <span>Positions and crew pay rates</span>
        <div className="list">
          {draft.positions.map((position, index) => {
            const selectedDefault = matchingDefaultRole(position.role_name, roleOptions);
            const currentRate = Number(position.rate || 0);
            const roleDefaultRate = defaultRateForRole(position.role_name);
            const roleSuggestionId = `crew-role-suggestions-${index}`;
            const normalizedRole = normalizeText(position.role_name);
            const visibleSuggestions = roleOptions.filter((option) => !normalizedRole || normalizeText(option.roleName).includes(normalizedRole)).slice(0, 8);
            return (
              <div key={`position-${index}`} className="card compact" style={{ background: "#fbfcfd" }}>
                <div className="grid grid-3" style={{ alignItems: "end" }}>
                  <label className="field">
                    <span>Default role/rate</span>
                    <select
                      value={selectedDefault?.roleName || CUSTOM_ROLE_OPTION}
                      onChange={(event) => {
                        const option = roleOptions.find((item) => item.roleName === event.target.value);
                        if (!option) return;
                        const patch: Partial<PositionInput> = { role_name: option.roleName };
                        if (shouldApplyDefaultRate(position.role_name, currentRate)) patch.rate = option.fullDay;
                        onPositionChange(index, patch);
                      }}
                    >
                      <option value={CUSTOM_ROLE_OPTION}>Custom role / manual entry</option>
                      <optgroup label="Top defaults">
                        {roleOptions.filter((option) => option.featured || ["gav", "led stagehand", "stagehand", "bo tech", "floater", "crew lead", "warehouse worker"].includes(normalizeText(option.roleName))).map((option) => (
                          <option key={option.roleName} value={option.roleName}>{roleOptionLabel(option)}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Other defaults">
                        {roleOptions.filter((option) => !(option.featured || ["gav", "led stagehand", "stagehand", "bo tech", "floater", "crew lead", "warehouse worker"].includes(normalizeText(option.roleName)))).map((option) => (
                          <option key={option.roleName} value={option.roleName}>{roleOptionLabel(option)}</option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label className="field">
                    <span>Role name</span>
                    <input
                      value={position.role_name}
                      list={roleSuggestionId}
                      onChange={(event) => {
                        const nextRole = event.target.value;
                        const nextDefaultRate = defaultRateForRole(nextRole);
                        const patch: Partial<PositionInput> = { role_name: nextRole };
                        if (nextDefaultRate && shouldApplyDefaultRate(position.role_name, currentRate)) patch.rate = nextDefaultRate;
                        onPositionChange(index, patch);
                      }}
                      placeholder="GAV, LED Stagehand, Crew Lead..."
                    />
                    <datalist id={roleSuggestionId}>
                      {roleOptions.map((option) => <option key={option.roleName} value={option.roleName} />)}
                    </datalist>
                    {visibleSuggestions.length && position.role_name ? (
                      <div className="role-suggestions">
                        {visibleSuggestions.map((option) => (
                          <button key={option.roleName} type="button" className="role-suggestion-button" onClick={() => {
                            const patch: Partial<PositionInput> = { role_name: option.roleName };
                            if (shouldApplyDefaultRate(position.role_name, currentRate)) patch.rate = option.fullDay;
                            onPositionChange(index, patch);
                          }}>{option.roleName}</button>
                        ))}
                      </div>
                    ) : null}
                  </label>
                  <label className="field">
                    <span>Crew day pay</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={numberInputValue(position.rate)}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => onPositionChange(index, { rate: event.target.value.trim() === "" ? 0 : Number(event.target.value) })}
                      placeholder={roleDefaultRate ? `Default $${roleDefaultRate}` : "Manual rate"}
                    />
                  </label>
                </div>
                <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
                  <p className="muted small" style={{ margin: 0 }}>
                    {roleDefaultRate && !currentRate ? `Leaving crew day pay blank will save the default ${formatMoney(roleDefaultRate)} rate.` : "Manual rate overrides the default for this contact."}
                  </p>
                  <button className="ghost" type="button" onClick={() => onRemovePosition(index)}>Remove</button>
                </div>
              </div>
            );
          })}
          <button className="ghost" type="button" onClick={onAddPosition}>Add position</button>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 6 }}>
        <button className="primary" type="button" onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save contact"}</button>
        <button className="ghost" type="button" onClick={onClose} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
