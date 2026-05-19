"use client";

import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CityPoolRecord, CrewGroupRecord, CrewRecord, PositionInput } from "@/lib/crew-types";
import type { MasterRateRecord } from "@/lib/rates-types";
import { crewRoleRateOptions, getDefaultCrewPayRate } from "@/lib/crew-pay-defaults";

type CrewClientProps = {
  cityPools: CityPoolRecord[];
  crewGroups: CrewGroupRecord[];
  initialCrew: CrewRecord[];
  masterRates: MasterRateRecord[];
};

type CrewDraft = {
  id?: string;
  name: string;
  description: string;
  city_pool_id: string;
  city_name: string;
  group_name: string;
  tier: string;
  email: string;
  phone: string;
  other_city: string;
  ob: boolean;
  blacklisted: boolean;
  blacklist_reason: string;
  notes: string;
  conflict_companies_text: string;
  unavailable_dates_text: string;
  positions: PositionInput[];
};

type DetailTab = "info" | "roles" | "availability" | "notes" | "move";

const ALL_GROUPS = "__all_groups__";
const UNASSIGNED_CITY = "__unassigned_city__";

const CUSTOM_ROLE_OPTION = "__custom_role__";

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


function blankDraft(cityPools: CityPoolRecord[], cityId?: string, groupName?: string): CrewDraft {
  const chosenCity = cityPools.find((pool) => pool.id === cityId) || cityPools[0];
  return {
    name: "",
    description: "",
    city_pool_id: chosenCity?.id || "",
    city_name: chosenCity?.name || "",
    group_name: groupName && groupName !== ALL_GROUPS ? groupName : "Ungrouped",
    tier: "",
    email: "",
    phone: "",
    other_city: "",
    ob: false,
    blacklisted: false,
    blacklist_reason: "",
    notes: "",
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
    group_name: record.group_name,
    tier: record.tier,
    email: record.email,
    phone: record.phone,
    other_city: record.other_city,
    ob: record.ob,
    blacklisted: Boolean(record.blacklisted),
    blacklist_reason: record.blacklist_reason || "",
    notes: record.notes,
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
    group_name: draft.group_name || "Ungrouped",
    tier: draft.tier,
    email: draft.email,
    phone: draft.phone,
    other_city: draft.other_city,
    ob: draft.ob,
    blacklisted: draft.blacklisted,
    blacklist_reason: draft.blacklist_reason,
    notes: draft.notes,
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
    group_name: draft.group_name.trim() || "Ungrouped",
    tier: draft.tier.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    other_city: draft.other_city.trim(),
    ob: draft.ob,
    blacklisted: draft.blacklisted,
    blacklist_reason: draft.blacklist_reason.trim(),
    notes: draft.notes.trim(),
    conflict_companies: draft.conflict_companies_text.split(",").map((item) => item.trim()).filter(Boolean),
    unavailable_dates: draft.unavailable_dates_text.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    positions: draft.positions.filter((item) => item.role_name.trim()).map((item) => ({ role_name: item.role_name.trim(), rate: Number(item.rate || getDefaultCrewPayRate(item.role_name) || 0) })),
  };
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
    record.group_name,
    record.tier,
    record.email,
    record.phone,
    record.other_city,
    record.description,
    record.notes,
    record.ob ? "ob owner operator" : "",
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
  const fields: ParsedFormFields = { name: "", email: "", phone: "", message: "", resume: "", skillsets: "" };
  let activeKey: keyof ParsedFormFields | null = null;

  raw
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^([A-Za-z][A-Za-z\s/&()\-_.]+?)\s*:\s*(.*)$/);
      const matchedKey = match ? FORM_LABELS[normalizeText(match[1])] : undefined;
      if (match && matchedKey) {
        activeKey = matchedKey;
        const value = match[2]?.trim() || "";
        fields[activeKey] = fields[activeKey] ? `${fields[activeKey]}\n${value}`.trim() : value;
        return;
      }
      if (activeKey) fields[activeKey] = `${fields[activeKey]}\n${line}`.trim();
    });

  return fields;
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
      if (/\ba2\b|audio assist/.test(normalized)) addMappedRole(roles, "A2-Audio Assist");
      if (/\bv2\b|video assist/.test(normalized)) addMappedRole(roles, "V2-Video Assist");
      if (/lighting|lights|\bl2\b|lighting assist/.test(normalized)) addMappedRole(roles, "L2-Lighting Assist");
      if (/rigging|rigger|up and down/.test(normalized)) addMappedRole(roles, "Down Rigger");
      if (/warehouse|prep|unload|loader|load in|load out/.test(normalized)) addMappedRole(roles, "Truck Loader");
      if (/\bgav\b|\bavt\b/.test(normalized)) addMappedRole(roles, "GAV");
      if (/breakout|\bbo\b|bo tech/.test(normalized)) addMappedRole(roles, "BO Tech");
      if (/floater|float/.test(normalized)) addMappedRole(roles, "Floater");
      if (/crew lead|lead/.test(normalized)) addMappedRole(roles, "Crew Lead");
    });
  return Array.from(roles.values());
}

function draftFromPastedContactForm(raw: string, cityPools: CityPoolRecord[], cityId: string, groupName: string): CrewDraft {
  const fields = parseContactFormFields(raw);
  const positions = positionsFromSkillsets(fields.skillsets);
  const notes = [
    fields.message ? `Application message:\n${fields.message}` : "",
    fields.resume ? `Resume: ${fields.resume}` : "",
    fields.skillsets ? `Skillsets: ${fields.skillsets}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    ...blankDraft(cityPools, cityId !== UNASSIGNED_CITY ? cityId : cityPools[0]?.id, groupName !== ALL_GROUPS ? groupName : "Applicant"),
    name: fields.name,
    email: fields.email,
    phone: cleanPhone(fields.phone),
    description: "Imported from pasted applicant form text.",
    group_name: groupName !== ALL_GROUPS ? groupName : "Applicant",
    notes,
    positions: positions.length ? positions : [{ role_name: "", rate: 0 }],
  };
}

export default function CrewClient({ cityPools: initialCityPools, crewGroups: initialGroups, initialCrew, masterRates }: CrewClientProps) {
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [cityPools, setCityPools] = useState(initialCityPools);
  const [crewGroups, setCrewGroups] = useState(initialGroups);
  const [crewRecords, setCrewRecords] = useState(initialCrew);
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
  const [selectedCityId, setSelectedCityId] = useState<string>(initialCityPools[0]?.id || UNASSIGNED_CITY);
  const [selectedGroup, setSelectedGroup] = useState<string>(ALL_GROUPS);
  const [globalSearch, setGlobalSearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<"all" | "ob" | "blacklisted" | "withConflicts" | "unavailable" | "noRole">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("info");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CrewDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [formImporterOpen, setFormImporterOpen] = useState(false);
  const [formText, setFormText] = useState("");
  const [newCityName, setNewCityName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [bulkCityId, setBulkCityId] = useState("");
  const [bulkGroupName, setBulkGroupName] = useState("Ungrouped");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"error" | "success">("success");

  useEffect(() => {
    if (!selectedCityId && cityPools[0]?.id) setSelectedCityId(cityPools[0].id);
  }, [cityPools, selectedCityId]);

  useEffect(() => {
    if (selectedCityId && selectedCityId !== UNASSIGNED_CITY) setBulkCityId((current) => current || selectedCityId);
  }, [selectedCityId]);

  const globallyMatchedCrew = useMemo(() => crewRecords.filter((record) => matchesSearch(record, globalSearch)), [crewRecords, globalSearch]);

  const cityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    cityPools.forEach((pool) => counts.set(pool.id, 0));
    counts.set(UNASSIGNED_CITY, 0);
    globallyMatchedCrew.forEach((record) => {
      const key = record.city_pool_id || UNASSIGNED_CITY;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [cityPools, globallyMatchedCrew]);

  const selectedCity = cityPools.find((pool) => pool.id === selectedCityId) || null;

  const cityScopedCrew = useMemo(() => {
    return globallyMatchedCrew.filter((record) => {
      const cityMatch = selectedCityId === UNASSIGNED_CITY ? !record.city_pool_id : record.city_pool_id === selectedCityId;
      const cityQueryMatch = matchesSearch(record, citySearch);
      return cityMatch && cityQueryMatch;
    });
  }, [globallyMatchedCrew, selectedCityId, citySearch]);

  const availableGroups = useMemo(() => groupSummaries(cityScopedCrew, crewGroups, selectedCityId), [cityScopedCrew, crewGroups, selectedCityId]);

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
        (quickFilter === "ob" && record.ob) ||
        (quickFilter === "blacklisted" && record.blacklisted) ||
        (quickFilter === "withConflicts" && record.conflict_companies.length > 0) ||
        (quickFilter === "unavailable" && record.unavailable_dates.length > 0) ||
        (quickFilter === "noRole" && record.positions.length === 0);
      return groupMatch && groupQueryMatch && quickMatch;
    });
  }, [cityScopedCrew, selectedGroup, groupSearch, quickFilter]);

  const selectedContact = useMemo(() => crewRecords.find((record) => record.id === selectedContactId) || null, [crewRecords, selectedContactId]);

  useEffect(() => {
    if (adding || editingId) return;
    if (selectedContactId && !visibleCrew.some((record) => record.id === selectedContactId)) {
      setSelectedContactId(null);
    }
  }, [adding, editingId, selectedContactId, visibleCrew]);

  const targetGroupsForBulkCity = useMemo(() => {
    const cityId = bulkCityId || (selectedCityId !== UNASSIGNED_CITY ? selectedCityId : "");
    const names = new Set<string>(["Ungrouped"]);
    crewRecords.filter((record) => record.city_pool_id === cityId).forEach((record) => names.add(record.group_name || "Ungrouped"));
    crewGroups.filter((group) => group.city_pool_id === cityId).forEach((group) => names.add(group.name));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [bulkCityId, crewGroups, crewRecords, selectedCityId]);

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
    setDraft(blankDraft(cityPools, selectedCityId !== UNASSIGNED_CITY ? selectedCityId : cityPools[0]?.id, selectedGroup));
    setMessage(null);
  }

  function beginPastedFormImport() {
    setAdding(true);
    setEditingId(null);
    setSelectedContactId(null);
    setDetailTab("info");
    setFormImporterOpen(true);
    setDraft(blankDraft(cityPools, selectedCityId !== UNASSIGNED_CITY ? selectedCityId : cityPools[0]?.id, selectedGroup));
    setMessage(null);
  }

  function applyPastedFormText() {
    if (!formText.trim()) {
      setMessageKind("error");
      setMessage("Paste the applicant form text first.");
      return;
    }
    const parsedDraft = draftFromPastedContactForm(formText, cityPools, selectedCityId, selectedGroup);
    setDraft(parsedDraft);
    setAdding(true);
    setFormImporterOpen(true);
    setMessageKind("success");
    setMessage("Applicant form parsed. Review the contact, roles, and rates, then save.");
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
        if (draft.id) return current.map((record) => (record.id === draft.id ? nextRecord : record));
        return [nextRecord, ...current];
      });
      if (nextRecord.city_pool_id) {
        const exists = crewGroups.some((group) => group.city_pool_id === nextRecord.city_pool_id && group.name === nextRecord.group_name);
        if (!exists) setCrewGroups((current) => [...current, { id: `temp-${nextRecord.id}`, city_pool_id: nextRecord.city_pool_id!, name: nextRecord.group_name }]);
      }
      setMessageKind("success");
      setMessage(draft.id ? "Crew contact updated." : "Crew contact added.");
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
    if (!window.confirm("Delete this crew contact?")) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/crew/${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Delete failed.");
      setCrewRecords((current) => current.filter((record) => record.id !== id));
      setSelectedIds((current) => current.filter((value) => value !== id));
      if (editingId === id) closeEditor();
      if (selectedContactId === id) setSelectedContactId(visibleCrew.find((record) => record.id !== id)?.id || null);
      setMessageKind("success");
      setMessage("Crew contact deleted.");
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
      setNewCityName("");
      setSelectedGroup(ALL_GROUPS);
      setMessageKind("success");
      setMessage(`City pool created: ${city.name}`);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to add city pool.");
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
        body: JSON.stringify({ city_pool_id: selectedCityId, old_name: currentName, name: nextName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to rename group.");
      const nextGroup = result.group as CrewGroupRecord;

      setCrewGroups((current) => {
        const withoutOld = current.filter((group) => !(group.city_pool_id === selectedCityId && group.name === currentName));
        const exists = withoutOld.some((group) => group.city_pool_id === selectedCityId && group.name === nextGroup.name);
        return exists ? withoutOld : [...withoutOld, nextGroup].sort((a, b) => a.name.localeCompare(b.name));
      });
      setCrewRecords((current) =>
        current.map((record) =>
          record.city_pool_id === selectedCityId && record.group_name === currentName ? { ...record, group_name: nextName } : record
        )
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

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  function selectVisible() {
    setSelectedIds((current) => Array.from(new Set([...current, ...visibleCrew.map((record) => record.id)])));
  }

  function clearSelected() {
    setSelectedIds([]);
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
    const headers = ["Name", "City", "Group", "Tier", "Email", "Phone", "Primary Role", "Rates", "OB", "Blacklisted", "Blacklist Reason", "Conflicts", "Unavailable Dates", "Notes"];
    const body = visibleCrew.map((record) => [
      record.name,
      record.city_name,
      record.group_name,
      record.tier,
      record.email,
      record.phone,
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

  async function importContactsCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSaving(true);
    setMessage(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("CSV must include a header row and at least one contact row.");
      const headers = rows[0];
      const imported: CrewRecord[] = [];
      const errors: string[] = [];
      for (const [index, values] of rows.slice(1).entries()) {
        const row: Record<string, string> = {};
        headers.forEach((header, cellIndex) => { row[header] = values[cellIndex] || ""; });
        const name = valueFromRow(row, ["name", "crew name", "contact name", "full name"]);
        if (!name.trim()) {
          errors.push(`Row ${index + 2}: missing name`);
          continue;
        }
        const cityName = valueFromRow(row, ["city", "city pool", "pool"]);
        const city = cityPools.find((pool) => normalizeText(pool.name) === normalizeText(cityName)) || (selectedCityId !== UNASSIGNED_CITY ? selectedCity : cityPools[0]);
        const groupName = valueFromRow(row, ["group", "crew group", "subgroup"]) || (selectedGroup !== ALL_GROUPS ? selectedGroup : "Ungrouped");
        const role = valueFromRow(row, ["role", "position", "primary role"]);
        const importedRate = Number(valueFromRow(row, ["rate", "day rate", "pay rate"]).replace(/[^0-9.]/g, "") || 0);
        const rate = importedRate || getDefaultCrewPayRate(role);
        const nextDraft: CrewDraft = {
          ...blankDraft(cityPools, city?.id, groupName),
          name,
          description: valueFromRow(row, ["description"]),
          city_pool_id: city?.id || "",
          city_name: city?.name || "",
          group_name: groupName || "Ungrouped",
          tier: valueFromRow(row, ["tier"]),
          email: valueFromRow(row, ["email", "email address"]),
          phone: valueFromRow(row, ["phone", "mobile", "contact number"]),
          other_city: valueFromRow(row, ["other city", "secondary city"]),
          ob: /^(yes|true|1|ob)$/i.test(valueFromRow(row, ["ob", "owner operator"])),
          blacklisted: /^(yes|true|1|blacklisted|blocked)$/i.test(valueFromRow(row, ["blacklisted", "do not use", "blocked"])),
          blacklist_reason: valueFromRow(row, ["blacklist reason", "blacklist notes", "do not use reason"]),
          notes: valueFromRow(row, ["notes", "note"]),
          conflict_companies_text: valueFromRow(row, ["conflicts", "conflict companies"]),
          unavailable_dates_text: valueFromRow(row, ["unavailable", "unavailable dates"]),
          positions: role ? [{ role_name: role, rate }] : [{ role_name: "", rate: 0 }],
        };
        const response = await fetch("/api/crew", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(normalizePayload(nextDraft)),
        });
        const result = await response.json();
        if (!response.ok) {
          errors.push(`Row ${index + 2}: ${result.message || "import failed"}`);
          continue;
        }
        imported.push(recordFromDraft({ ...nextDraft, id: result.id }, cityPools));
      }
      if (imported.length) {
        setCrewRecords((current) => [...imported, ...current]);
        setSelectedContactId(imported[0].id);
      }
      setMessageKind(errors.length ? "error" : "success");
      setMessage(errors.length ? `Imported ${imported.length} contacts. ${errors.slice(0, 3).join(" ")}${errors.length > 3 ? " …" : ""}` : `Imported ${imported.length} contacts.`);
      router.refresh();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Unable to import contacts CSV.");
    } finally {
      setSaving(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  const selectedCityCount = cityCounts.get(selectedCityId) || 0;
  const selectedGroupCount = visibleCrew.length;
  const totalCrew = crewRecords.length;
  const activeEditorTitle = adding ? "New crew contact" : draft?.name ? `Edit ${draft.name}` : "Edit crew contact";

  return (
    <div className="grid" style={{ gap: 16 }}>
      {message ? (
        <section className="card">
          <p className={messageKind === "error" ? "error" : "success"}>{message}</p>
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
              {cityPools.map((pool) => {
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
              {selectedGroup !== ALL_GROUPS && selectedCityId !== UNASSIGNED_CITY ? (
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
                <option value="ob">OB only</option>
                <option value="blacklisted">Blacklisted</option>
                <option value="withConflicts">Has conflicts</option>
                <option value="unavailable">Has unavailable dates</option>
                <option value="noRole">Missing role</option>
              </select>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 14 }}>
              <label className="field">
                <span>Add city pool</span>
                <input value={newCityName} onChange={(event) => setNewCityName(event.target.value)} placeholder="Example: Birmingham, AL" />
              </label>
              <button className="ghost" type="button" onClick={addCityPool} disabled={saving} style={{ marginTop: 10, width: "100%" }}>Create city pool</button>
            </div>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginTop: 14 }}>
              <label className="field">
                <span>Create group</span>
                <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="Example: Tier 1" disabled={selectedCityId === UNASSIGNED_CITY} />
              </label>
              <button className="ghost" type="button" onClick={createGroup} disabled={saving || !selectedCityId || selectedCityId === UNASSIGNED_CITY} style={{ marginTop: 10, width: "100%" }}>Create group</button>
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
                    <span className="editable-group-label" title="Rename this crew group">
                      <span>{selectedGroup}</span>
                      <button className="edit-group-button" type="button" aria-label={`Rename ${selectedGroup}`} onClick={() => renameSelectedGroup(selectedGroup)} disabled={saving}>✎</button>
                    </span>
                  )} • {selectedGroupCount} visible
                </div>
              </div>
              <div className="toolbar" style={{ justifyContent: "flex-end" }}>
                <button className="ghost" type="button" onClick={selectVisible}>Select</button>
                <button className="ghost" type="button" onClick={clearSelected}>Clear</button>
              </div>
            </div>

            <label className="field" style={{ marginBottom: 12 }}>
              <span>Search visible list</span>
              <input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="Search this view…" />
            </label>

            <div className="row" style={{ alignItems: "end", marginBottom: 14 }}>
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, flex: 1 }}>
                <label className="field">
                  <span>Move selected to city</span>
                  <select value={bulkCityId} onChange={(event) => setBulkCityId(event.target.value)}>
                    <option value="">Choose city</option>
                    {cityPools.map((pool) => (
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

            <div className="toolbar" style={{ marginBottom: 14 }}>
              <button className="primary" type="button" onClick={beginAdd}>Add contact</button>
              <button className="ghost" type="button" onClick={beginPastedFormImport}>Paste form</button>
              <button className="ghost" type="button" onClick={exportVisibleContacts}>Export visible</button>
              <button className="ghost" type="button" onClick={() => importInputRef.current?.click()} disabled={saving}>Import CSV</button>
              <input ref={importInputRef} type="file" accept=".csv,text/csv" onChange={importContactsCsv} style={{ display: "none" }} />
            </div>

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
                        <h3 style={{ margin: 0 }}>Paste applicant form text</h3>
                        <div className="muted small">Paste the website form text, then apply it to auto-fill name, email, phone, notes, and roles.</div>
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
                      <button className="primary" type="button" onClick={applyPastedFormText}>Build contact from form</button>
                      <button className="ghost" type="button" onClick={() => setFormText("")}>Clear form text</button>
                    </div>
                  </div>
                ) : (
                  <button className="ghost" type="button" onClick={() => setFormImporterOpen(true)} style={{ marginBottom: 14 }}>Paste applicant form text</button>
                )}

                <CrewEditor
                  cityPools={cityPools}
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
                          {record.phone ? cleanPhone(record.phone) : "No phone"}{record.email ? ` • ${record.email}` : ""}{record.ob ? " • OB" : ""}{record.blacklisted ? " • Blacklisted" : ""}
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
                              cityPools={cityPools}
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
                            cityPools={cityPools}
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
};

function ContactDetail({ record, cityPools, targetGroups, bulkCityId, bulkGroupName, detailTab, onTab, onEdit, onDelete, onMove, onBulkCityChange, onBulkGroupChange, saving }: ContactDetailProps) {
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
              <div className="muted">{primaryRole(record)} • {record.city_name} • {record.group_name}</div>
              <div className="muted small">{record.tier ? `Tier ${record.tier}` : "No tier"}{record.ob ? " • OB" : ""}{record.blacklisted ? " • Blacklisted" : ""}</div>
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
        </div>
      </div>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        {(["info", "roles", "availability", "notes", "move"] as DetailTab[]).map((tab) => (
          <button key={tab} className={detailTab === tab ? "primary" : "ghost"} type="button" onClick={() => onTab(tab)}>
            {tab === "info" ? "Info" : tab === "roles" ? "Roles & rates" : tab === "availability" ? "Availability" : tab === "notes" ? "Notes" : "Move"}
          </button>
        ))}
      </div>

      {detailTab === "info" ? (
        <div className="list">
          <InfoRow label="Phone" value={record.phone ? cleanPhone(record.phone) : "No phone saved"} />
          <InfoRow label="Email" value={record.email || "No email saved"} />
          <InfoRow label="City pool" value={record.city_name || "Unassigned"} />
          <InfoRow label="Group" value={record.group_name || "Ungrouped"} />
          <InfoRow label="Other city" value={record.other_city || "None"} />
          <InfoRow label="Description" value={record.description || "No description"} />
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

function CrewEditor({ cityPools, roleOptions, defaultRateForRole, draft, onChange, onPositionChange, onAddPosition, onRemovePosition, onSave, onClose, saving }: CrewEditorProps) {
  return (
    <div className="list">
      <div className="grid grid-2">
        <label className="field">
          <span>Name</span>
          <input value={draft.name} onChange={(event) => onChange("name", event.target.value)} />
        </label>
        <label className="field">
          <span>City pool</span>
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

      <div className="grid grid-2">
        <label className="field"><span>Group</span><input value={draft.group_name} onChange={(event) => onChange("group_name", event.target.value)} /></label>
        <label className="field"><span>Tier</span><input value={draft.tier} onChange={(event) => onChange("tier", event.target.value)} /></label>
      </div>

      <div className="grid grid-2">
        <label className="field"><span>Email</span><input value={draft.email} onChange={(event) => onChange("email", event.target.value)} /></label>
        <label className="field"><span>Phone</span><input value={draft.phone} onChange={(event) => onChange("phone", event.target.value)} /></label>
      </div>

      <div className="grid grid-2">
        <label className="field"><span>Other city</span><input value={draft.other_city} onChange={(event) => onChange("other_city", event.target.value)} /></label>
        <label className="field checkboxField">
          <span>OB</span>
          <input type="checkbox" checked={draft.ob} onChange={(event) => onChange("ob", event.target.checked)} />
        </label>
      </div>

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
