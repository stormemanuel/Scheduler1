"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  BusinessClientRecord,
  ClientCityRateOverrideRecord,
  ClientContactRecord,
  ClientContactType,
  TechRatingRecord,
  AppUserSummaryRecord,
} from "@/lib/client-types";
import type { CityPoolRecord, CrewRecord } from "@/lib/crew-types";
import { halfDayFromFullDay, type ClientRateRecord } from "@/lib/rates-types";

type Props = {
  initialClients: BusinessClientRecord[];
  initialContacts: ClientContactRecord[];
  initialRatings: TechRatingRecord[];
  crewRecords: CrewRecord[];
  appUsers: AppUserSummaryRecord[];
  cityPools: CityPoolRecord[];
  clientRates: ClientRateRecord[];
  initialClientRateOverrides: ClientCityRateOverrideRecord[];
  clientRateOverridesMissing: boolean;
};

type SaveState = { kind: "success" | "error"; text: string } | null;
type PoRequiredDraft = "" | "yes" | "no";

type ClientDraft = {
  name: string;
  legal_company_name: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  main_phone: string;
  main_email: string;
  website: string;
  default_rate_city: string;
  default_market_notes: string;
  notes: string;
  ap_contact_name: string;
  ap_email: string;
  ap_phone: string;
  payment_terms: string;
  po_required: PoRequiredDraft;
  w9_coi_notes: string;
  default_invoice_email: string;
  billing_notes: string;
};

type ContactDraft = {
  client_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  cell_phone: string;
  notes: string;
  contact_type: ClientContactType;
  is_primary: boolean;
  is_onsite_contact: boolean;
  is_billing_contact: boolean;
};

type ClientRateDraftRow = {
  key: string;
  id?: string;
  role_name: string;
  full_day: string;
  half_day: string;
  overtime_multiplier: string;
  doubletime_multiplier: string;
  inherited_full_day: number | null;
  inherited_half_day: number | null;
  inherited_overtime_multiplier: number | null;
  inherited_doubletime_multiplier: number | null;
};

const emptyClient: ClientDraft = {
  name: "",
  legal_company_name: "",
  billing_address: "",
  billing_city: "",
  billing_state: "",
  billing_zip: "",
  main_phone: "",
  main_email: "",
  website: "",
  default_rate_city: "Default",
  default_market_notes: "",
  notes: "",
  ap_contact_name: "",
  ap_email: "",
  ap_phone: "",
  payment_terms: "",
  po_required: "",
  w9_coi_notes: "",
  default_invoice_email: "",
  billing_notes: "",
};

const emptyContact: ContactDraft = {
  client_id: "",
  name: "",
  title: "",
  email: "",
  phone: "",
  cell_phone: "",
  notes: "",
  contact_type: "labor-coordinator",
  is_primary: false,
  is_onsite_contact: false,
  is_billing_contact: false,
};

const CONTACT_VIEW_OPTIONS: Array<{ key: ClientContactType; label: string; description: string }> = [
  { key: "labor-coordinator", label: "Labor Coordinators view", description: "Company labor coordinators and staffing contacts. Top tech lists stay hidden in this view." },
  { key: "project-manager", label: "Project Managers view", description: "Project managers with their own client/contact-specific top tech history." },
  { key: "booth-manager", label: "Booth Managers view", description: "Booth or area managers and the techs they rated/requested." },
  { key: "client-tech", label: "Client Techs view", description: "Client-level top tech lists by median rating and city/state pool." },
];

function contactTypeLabel(value: ClientContactType) {
  return CONTACT_VIEW_OPTIONS.find((option) => option.key === value)?.label.replace(" view", "") || "Labor Coordinator";
}

function normalizeContactType(value: string | null | undefined, title = ""): ClientContactType {
  if (value === "project-manager" || value === "booth-manager" || value === "client-tech" || value === "labor-coordinator") return value;
  const lower = String(title || "").toLowerCase();
  if (lower.includes("booth") || lower.includes("area")) return "booth-manager";
  if (lower.includes("project manager") || lower === "pm" || lower.includes("producer")) return "project-manager";
  if (lower.includes("tech") || lower.includes("technician") || lower.includes("engineer")) return "client-tech";
  return "labor-coordinator";
}


function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value;
}

function stars(value: number) {
  const rounded = Math.round(Number(value || 0));
  const safe = Math.max(0, Math.min(5, rounded));
  return "★".repeat(safe) + "☆".repeat(5 - safe);
}

function medianRating(values: number[]) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

type TopTechItem = {
  crew: CrewRecord | undefined;
  median: number;
  count: number;
  last: string;
};
type PoolTopTechGroup = {
  poolName: string;
  items: TopTechItem[];
  totalRatings: number;
};

function buildMedianTopTechs(
  rows: TechRatingRecord[],
  crewRecords: CrewRecord[],
  limit = 10,
): TopTechItem[] {
  const byCrew = new Map<string, { values: number[]; last: string }>();
  for (const row of rows) {
    const value = Number(row.rating || 0);
    if (!row.crew_id || value <= 0) continue;
    const existing = byCrew.get(row.crew_id) ?? { values: [], last: "" };
    existing.values.push(value);
    const ratingDate = row.updated_at || row.created_at || "";
    if (ratingDate > existing.last) existing.last = ratingDate;
    byCrew.set(row.crew_id, existing);
  }
  return [...byCrew.entries()]
    .map(([crewId, row]) => ({
      crew: crewRecords.find((crew) => crew.id === crewId),
      median: medianRating(row.values),
      count: row.values.length,
      last: row.last,
    }))
    .sort(
      (a, b) =>
        b.median - a.median ||
        b.count - a.count ||
        (a.crew?.name || "").localeCompare(b.crew?.name || ""),
    )
    .slice(0, limit);
}

function poolLabelsForCrew(crew: CrewRecord | undefined) {
  const labels = new Set<string>();
  const primary = (crew?.city_name || "").trim();
  if (primary && primary.toLowerCase() !== "unassigned") labels.add(primary);
  for (const name of crew?.additional_city_pool_names || []) {
    const label = String(name || "").trim();
    if (label && label.toLowerCase() !== "unassigned") labels.add(label);
  }
  if (!labels.size) labels.add("Unassigned / no city pool");
  return [...labels].sort((a, b) => a.localeCompare(b));
}

function buildMedianTopTechsByPool(
  rows: TechRatingRecord[],
  crewRecords: CrewRecord[],
  limitPerPool = 8,
): PoolTopTechGroup[] {
  const crewById = new Map(crewRecords.map((crew) => [crew.id, crew]));
  const byPool = new Map<
    string,
    Map<string, { values: number[]; last: string }>
  >();

  for (const row of rows) {
    const value = Number(row.rating || 0);
    if (!row.crew_id || value <= 0) continue;
    const crew = crewById.get(row.crew_id);
    const ratingDate = row.updated_at || row.created_at || "";

    for (const poolName of poolLabelsForCrew(crew)) {
      const poolMap =
        byPool.get(poolName) ??
        new Map<string, { values: number[]; last: string }>();
      const existing = poolMap.get(row.crew_id) ?? { values: [], last: "" };
      existing.values.push(value);
      if (ratingDate > existing.last) existing.last = ratingDate;
      poolMap.set(row.crew_id, existing);
      byPool.set(poolName, poolMap);
    }
  }

  return [...byPool.entries()]
    .map(([poolName, crewMap]) => {
      const items = [...crewMap.entries()]
        .map(([crewId, row]) => ({
          crew: crewById.get(crewId),
          median: medianRating(row.values),
          count: row.values.length,
          last: row.last,
        }))
        .sort(
          (a, b) =>
            b.median - a.median ||
            b.count - a.count ||
            (a.crew?.name || "").localeCompare(b.crew?.name || ""),
        )
        .slice(0, limitPerPool);
      return {
        poolName,
        items,
        totalRatings: [...crewMap.values()].reduce(
          (sum, row) => sum + row.values.length,
          0,
        ),
      } satisfies PoolTopTechGroup;
    })
    .sort((a, b) => a.poolName.localeCompare(b.poolName));
}

function poDraftFromClient(client: BusinessClientRecord): PoRequiredDraft {
  if (client.po_required === true) return "yes";
  if (client.po_required === false) return "no";
  return "";
}

function hasAny(values: Array<string | null | undefined>) {
  return values.some((value) => String(value || "").trim().length > 0);
}

function normalizeRateName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function rateValue(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "" : String(Number(value));
}

function displayMoneyRate(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "No inherited price"
    : `$${Number(value).toFixed(2)}`;
}

function displayMultiplier(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "No inherited multiplier"
    : `${Number(value)}×`;
}

function inheritedRateForRole(clientRates: ClientRateRecord[], cityName: string, roleName: string) {
  const roleKey = normalizeRateName(roleName);
  const cityKey = normalizeRateName(cityName || "Default");
  const cityMatch = clientRates.find(
    (rate) => normalizeRateName(rate.city_name) === cityKey && normalizeRateName(rate.role_name) === roleKey,
  );
  const defaultMatch = clientRates.find(
    (rate) => normalizeRateName(rate.city_name) === "default" && normalizeRateName(rate.role_name) === roleKey,
  );
  return cityMatch || defaultMatch || null;
}

function buildClientRateDraftRows(
  clientId: string,
  cityName: string,
  clientRates: ClientRateRecord[],
  overrides: ClientCityRateOverrideRecord[],
) {
  if (!clientId) return [] as ClientRateDraftRow[];
  const cityKey = normalizeRateName(cityName || "Default");
  const relevantOverrides = overrides.filter(
    (row) => row.client_id === clientId && normalizeRateName(row.city_name) === cityKey,
  );
  const roleNames = new Map<string, string>();
  for (const rate of clientRates) {
    const rateCity = normalizeRateName(rate.city_name);
    if (rateCity !== "default" && rateCity !== cityKey) continue;
    const roleKey = normalizeRateName(rate.role_name);
    if (roleKey) roleNames.set(roleKey, rate.role_name);
  }
  for (const row of relevantOverrides) {
    const roleKey = normalizeRateName(row.role_name);
    if (roleKey) roleNames.set(roleKey, row.role_name);
  }

  const overrideByRole = new Map(relevantOverrides.map((row) => [normalizeRateName(row.role_name), row]));
  return [...roleNames.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([roleKey, roleName]) => {
      const inherited = inheritedRateForRole(clientRates, cityName, roleName);
      const override = overrideByRole.get(roleKey);
      return {
        key: override?.id || `${clientId}:${cityName}:${roleName}`,
        id: override?.id,
        role_name: override?.role_name || inherited?.role_name || roleName,
        full_day: rateValue(override?.full_day),
        half_day: rateValue(halfDayFromFullDay(override?.full_day)),
        overtime_multiplier: rateValue(override?.overtime_multiplier),
        doubletime_multiplier: rateValue(override?.doubletime_multiplier),
        inherited_full_day: inherited?.full_day ?? null,
        inherited_half_day: halfDayFromFullDay(inherited?.full_day),
        inherited_overtime_multiplier: inherited?.overtime_multiplier ?? null,
        inherited_doubletime_multiplier: inherited?.doubletime_multiplier ?? null,
      } satisfies ClientRateDraftRow;
    });
}

function rowHasClientRateOverride(row: ClientRateDraftRow) {
  return Boolean(
    row.full_day.trim() ||
    row.overtime_multiplier.trim() ||
    row.doubletime_multiplier.trim(),
  );
}

export default function ClientsClient({
  initialClients,
  initialContacts,
  initialRatings,
  crewRecords,
  appUsers,
  cityPools,
  clientRates,
  initialClientRateOverrides,
  clientRateOverridesMissing,
}: Props) {
  const [clients, setClients] = useState(initialClients);
  const [contacts, setContacts] = useState(initialContacts);
  const [ratings] = useState(initialRatings);
  const [clientRateOverrides, setClientRateOverrides] = useState(initialClientRateOverrides);
  const [selectedClientId, setSelectedClientId] = useState(
    initialClients[0]?.id || "",
  );
  const [selectedRateCity, setSelectedRateCity] = useState(
    initialClients[0]?.default_rate_city || "Default",
  );
  const [clientRateDraftRows, setClientRateDraftRows] = useState<ClientRateDraftRow[]>(() =>
    buildClientRateDraftRows(
      initialClients[0]?.id || "",
      initialClients[0]?.default_rate_city || "Default",
      clientRates,
      initialClientRateOverrides,
    ),
  );
  const [newRateRole, setNewRateRole] = useState("");
  const [bulkClientRateAdjustAmount, setBulkClientRateAdjustAmount] = useState("");
  const [clientDraft, setClientDraft] = useState<ClientDraft>(emptyClient);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({
    ...emptyContact,
    client_id: initialClients[0]?.id || "",
  });
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedRatingPool, setSelectedRatingPool] = useState("");
  const [contactView, setContactView] = useState<ClientContactType>("labor-coordinator");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveState>(null);

  const selectedClient =
    clients.find((client) => client.id === selectedClientId) ||
    clients[0] ||
    null;

  useEffect(() => {
    setSelectedRateCity(selectedClient?.default_rate_city || "Default");
    setNewRateRole("");
  }, [selectedClient?.id]);

  useEffect(() => {
    setClientRateDraftRows(
      buildClientRateDraftRows(
        selectedClient?.id || "",
        selectedRateCity || "Default",
        clientRates,
        clientRateOverrides,
      ),
    );
  }, [selectedClient?.id, selectedRateCity, clientRates, clientRateOverrides]);

  const selectedContacts = contacts.filter(
    (contact) => contact.client_id === selectedClient?.id,
  );

  const clientRateCityOptions = useMemo(() => {
    const names = new Map<string, string>();
    const add = (value: string | null | undefined) => {
      const label = String(value || "").trim();
      if (!label) return;
      names.set(normalizeRateName(label), label);
    };
    add("Default");
    cityPools.forEach((pool) => add(pool.name));
    clientRates.forEach((rate) => add(rate.city_name));
    clientRateOverrides
      .filter((row) => row.client_id === selectedClient?.id)
      .forEach((row) => add(row.city_name));
    return [...names.values()].sort((a, b) => {
      if (normalizeRateName(a) === "default") return -1;
      if (normalizeRateName(b) === "default") return 1;
      return a.localeCompare(b);
    });
  }, [cityPools, clientRates, clientRateOverrides, selectedClient?.id]);

  const visibleSectionContacts = selectedContacts.filter(
    (contact) => normalizeContactType(contact.contact_type, contact.title) === contactView,
  );
  const currentContactView = CONTACT_VIEW_OPTIONS.find((option) => option.key === contactView) || CONTACT_VIEW_OPTIONS[0];
  const userNameById = useMemo(() => new Map(appUsers.map((user) => [user.id, user.full_name || user.email || user.id])), [appUsers]);
  const contactOwnerLabel = (contact: ClientContactRecord) => contact.created_by_name || (contact.created_by ? userNameById.get(contact.created_by) || "Unknown user" : "Owner / admin");
  const clientOwnerLabel = (client: BusinessClientRecord) => client.created_by_name || (client.created_by ? userNameById.get(client.created_by) || "Unknown user" : "Owner / admin");


  const filteredClients = useMemo(() => {
    const token = search.toLowerCase().trim();
    const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    if (!token) return sorted;
    return sorted.filter((client) =>
      [
        client.name,
        client.legal_company_name,
        client.billing_address,
        client.billing_city,
        client.billing_state,
        client.billing_zip,
        client.main_phone,
        client.main_email,
        client.website,
        client.default_rate_city,
        client.default_market_notes,
        client.notes,
        client.ap_contact_name,
        client.ap_email,
        client.ap_phone,
        client.default_invoice_email,
        client.billing_notes,
      ]
        .join(" ")
        .toLowerCase()
        .includes(token),
    );
  }, [clients, search]);

  const selectedClientRatings = useMemo(() => {
    if (!selectedClient) return [] as TechRatingRecord[];
    return ratings.filter((rating) => rating.client_id === selectedClient.id);
  }, [ratings, selectedClient]);

  const topTechs = useMemo(() => {
    return buildMedianTopTechs(selectedClientRatings, crewRecords, 25);
  }, [selectedClientRatings, crewRecords]);

  const poolTopTechs = useMemo(() => {
    return buildMedianTopTechsByPool(selectedClientRatings, crewRecords, 8);
  }, [selectedClientRatings, crewRecords]);

  const contactTopTechs = useMemo(() => {
    const map = new Map<string, TopTechItem[]>();
    if (!selectedClient) return map;
    for (const contact of selectedContacts) {
      const rows = selectedClientRatings.filter(
        (rating) => rating.client_contact_id === contact.id,
      );
      map.set(contact.id, buildMedianTopTechs(rows, crewRecords, 10));
    }
    return map;
  }, [selectedClient, selectedContacts, selectedClientRatings, crewRecords]);

  const contactPoolTopTechs = useMemo(() => {
    const map = new Map<string, PoolTopTechGroup[]>();
    if (!selectedClient) return map;
    for (const contact of selectedContacts) {
      const rows = selectedClientRatings.filter(
        (rating) => rating.client_contact_id === contact.id,
      );
      map.set(contact.id, buildMedianTopTechsByPool(rows, crewRecords, 5));
    }
    return map;
  }, [selectedClient, selectedContacts, selectedClientRatings, crewRecords]);

  const ratingPoolOptions = useMemo(() => {
    const names = new Set<string>();
    for (const group of poolTopTechs) names.add(group.poolName);
    for (const groups of contactPoolTopTechs.values()) {
      for (const group of groups) names.add(group.poolName);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [poolTopTechs, contactPoolTopTechs]);

  const selectedRatingPoolName = ratingPoolOptions.includes(selectedRatingPool)
    ? selectedRatingPool
    : ratingPoolOptions[0] || "";

  const selectedBusinessPoolTopTechs = selectedRatingPoolName
    ? poolTopTechs.find((group) => group.poolName === selectedRatingPoolName) || null
    : null;

  const selectedContactPoolTopTechs = useMemo(() => {
    const map = new Map<string, PoolTopTechGroup | null>();
    for (const contact of selectedContacts) {
      const group = (contactPoolTopTechs.get(contact.id) || []).find(
        (item) => item.poolName === selectedRatingPoolName,
      );
      map.set(contact.id, group || null);
    }
    return map;
  }, [selectedContacts, contactPoolTopTechs, selectedRatingPoolName]);

  async function request(url: string, method: string, body?: unknown) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Request failed.");
      if (data.message) setMsg({ kind: "success", text: data.message });
      return data;
    } catch (error) {
      const text = error instanceof Error ? error.message : "Request failed.";
      setMsg({ kind: "error", text });
      throw error;
    } finally {
      setSaving(false);
    }
  }

  function updateClientRateRow(key: string, patch: Partial<ClientRateDraftRow>) {
    setClientRateDraftRows((current) =>
      current.map((row) => {
        if (row.key !== key) return row;
        if (Object.prototype.hasOwnProperty.call(patch, "full_day")) {
          const fullDay = String(patch.full_day ?? "");
          return { ...row, ...patch, full_day: fullDay, half_day: rateValue(halfDayFromFullDay(fullDay)) };
        }
        return { ...row, ...patch };
      }),
    );
  }

  function adjustedClientPrice(value: string, inherited: number | null, delta: number) {
    const currentValue = value.trim() ? Number(value) : inherited;
    if (currentValue === null || !Number.isFinite(Number(currentValue))) return value;
    const nextValue = Number(currentValue) + delta;
    if (!Number.isFinite(nextValue) || nextValue <= 0) return "";
    return String(Math.round(nextValue * 100) / 100);
  }

  function applyClientRateBulkAdjust() {
    const delta = Number(bulkClientRateAdjustAmount);
    if (!Number.isFinite(delta) || delta === 0) {
      setMsg({ kind: "error", text: "Enter a dollar amount to add or subtract." });
      return;
    }

    let adjustedFields = 0;
    const nextRows = clientRateDraftRows.map((row) => {
      const fullDay = adjustedClientPrice(row.full_day, row.inherited_full_day, delta);
      if (fullDay !== row.full_day) adjustedFields += 1;
      return { ...row, full_day: fullDay, half_day: rateValue(halfDayFromFullDay(fullDay)) };
    });

    if (!adjustedFields) {
      setMsg({ kind: "error", text: "There are no full-day prices available to adjust in this rate card." });
      return;
    }

    setClientRateDraftRows(nextRows);
    setBulkClientRateAdjustAmount("");
    setMsg({
      kind: "success",
      text: `${selectedClient?.name || "Client"} ${selectedRateCity || "Default"} draft prices adjusted by ${delta > 0 ? "+" : "-"}$${Math.abs(delta)}. Click Save to make the change permanent.`,
    });
  }

  function addClientRateRole() {
    if (!selectedClient) return;
    const roleName = newRateRole.trim();
    if (!roleName) return;
    if (clientRateDraftRows.some((row) => normalizeRateName(row.role_name) === normalizeRateName(roleName))) {
      setMsg({ kind: "error", text: `${roleName} is already listed for this city.` });
      return;
    }
    const inherited = inheritedRateForRole(clientRates, selectedRateCity, roleName);
    setClientRateDraftRows((current) => [
      ...current,
      {
        key: `${selectedClient.id}:${selectedRateCity}:${roleName}:${Date.now()}`,
        role_name: roleName,
        full_day: "",
        half_day: "",
        overtime_multiplier: "",
        doubletime_multiplier: "",
        inherited_full_day: inherited?.full_day ?? null,
        inherited_half_day: halfDayFromFullDay(inherited?.full_day),
        inherited_overtime_multiplier: inherited?.overtime_multiplier ?? null,
        inherited_doubletime_multiplier: inherited?.doubletime_multiplier ?? null,
      },
    ].sort((a, b) => a.role_name.localeCompare(b.role_name)));
    setNewRateRole("");
  }

  async function saveClientCityRates() {
    if (!selectedClient) return;
    if (clientRateOverridesMissing) {
      setMsg({
        kind: "error",
        text: "Client-specific city pricing storage is not installed yet. Run the ELS279 SQL migration first.",
      });
      return;
    }
    const rows = clientRateDraftRows
      .filter(rowHasClientRateOverride)
      .map((row) => ({
        role_name: row.role_name.trim(),
        full_day: row.full_day.trim() || null,
        half_day: halfDayFromFullDay(row.full_day),
        overtime_multiplier: row.overtime_multiplier.trim() || null,
        doubletime_multiplier: row.doubletime_multiplier.trim() || null,
      }));
    const data = await request(`/api/clients/${selectedClient.id}`, "PUT", {
      action: "save-city-rates",
      city_name: selectedRateCity || "Default",
      rows,
    });
    const savedRows = (Array.isArray(data.rows) ? data.rows : []).map((row: ClientCityRateOverrideRecord) => ({
      ...row,
      full_day: row.full_day === null || row.full_day === undefined ? null : Number(row.full_day),
      half_day: halfDayFromFullDay(row.full_day),
      overtime_multiplier: row.overtime_multiplier === null || row.overtime_multiplier === undefined ? null : Number(row.overtime_multiplier),
      doubletime_multiplier: row.doubletime_multiplier === null || row.doubletime_multiplier === undefined ? null : Number(row.doubletime_multiplier),
    }));
    const cityKey = normalizeRateName(selectedRateCity);
    setClientRateOverrides((current) => [
      ...current.filter(
        (row) => !(row.client_id === selectedClient.id && normalizeRateName(row.city_name) === cityKey),
      ),
      ...savedRows,
    ]);
  }

  function startAddClient() {
    setEditingClientId(null);
    setClientDraft(emptyClient);
  }

  function startEditClient(client: BusinessClientRecord) {
    setEditingClientId(client.id);
    setClientDraft({
      name: client.name || "",
      legal_company_name: client.legal_company_name || "",
      billing_address: client.billing_address || "",
      billing_city: client.billing_city || "",
      billing_state: client.billing_state || "",
      billing_zip: client.billing_zip || "",
      main_phone: client.main_phone || "",
      main_email: client.main_email || "",
      website: client.website || "",
      default_rate_city: client.default_rate_city || "Default",
      default_market_notes: client.default_market_notes || "",
      notes: client.notes || "",
      ap_contact_name: client.ap_contact_name || "",
      ap_email: client.ap_email || "",
      ap_phone: client.ap_phone || "",
      payment_terms: client.payment_terms || "",
      po_required: poDraftFromClient(client),
      w9_coi_notes: client.w9_coi_notes || "",
      default_invoice_email: client.default_invoice_email || "",
      billing_notes: client.billing_notes || "",
    });
  }

  function startAddContact(clientId = selectedClient?.id || "") {
    setEditingContactId(null);
    setContactDraft({ ...emptyContact, client_id: clientId, contact_type: contactView });
  }

  function startEditContact(contact: ClientContactRecord) {
    setEditingContactId(contact.id);
    setContactDraft({
      client_id: contact.client_id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      cell_phone: contact.cell_phone,
      notes: contact.notes,
      contact_type: normalizeContactType(contact.contact_type, contact.title),
      is_primary: contact.is_primary,
      is_onsite_contact: contact.is_onsite_contact,
      is_billing_contact: contact.is_billing_contact,
    });
  }

  async function saveClient() {
    const payload = {
      name: clientDraft.name.trim(),
      legal_company_name: clientDraft.legal_company_name.trim(),
      billing_address: clientDraft.billing_address.trim(),
      billing_city: clientDraft.billing_city.trim(),
      billing_state: clientDraft.billing_state.trim(),
      billing_zip: clientDraft.billing_zip.trim(),
      main_phone: clientDraft.main_phone.trim(),
      main_email: clientDraft.main_email.trim(),
      website: clientDraft.website.trim(),
      default_rate_city: clientDraft.default_rate_city.trim() || "Default",
      default_market_notes: clientDraft.default_market_notes.trim(),
      notes: clientDraft.notes.trim(),
      ap_contact_name: clientDraft.ap_contact_name.trim(),
      ap_email: clientDraft.ap_email.trim(),
      ap_phone: clientDraft.ap_phone.trim(),
      payment_terms: clientDraft.payment_terms.trim(),
      po_required:
        clientDraft.po_required === ""
          ? null
          : clientDraft.po_required === "yes",
      w9_coi_notes: clientDraft.w9_coi_notes.trim(),
      default_invoice_email: clientDraft.default_invoice_email.trim(),
      billing_notes: clientDraft.billing_notes.trim(),
    };
    if (!payload.name) {
      setMsg({
        kind: "error",
        text: "Client name is required. All other company details are optional.",
      });
      return;
    }
    const data = editingClientId
      ? await request(`/api/clients/${editingClientId}`, "PATCH", payload)
      : await request("/api/clients", "POST", payload);
    const next = data.client as BusinessClientRecord;
    if (!next?.id) return;
    setClients((current) =>
      editingClientId
        ? current.map((client) => (client.id === next.id ? next : client))
        : [...current.filter((client) => client.id !== next.id), next],
    );
    setSelectedClientId(next.id);
    setContactDraft((current) => ({ ...current, client_id: next.id }));
    setEditingClientId(null);
    setClientDraft(emptyClient);
  }

  async function deleteClient(id: string) {
    if (
      !confirm(
        "Delete this client and its client contacts? Existing show text remains, but the saved client link will be cleared.",
      )
    )
      return;
    await request(`/api/clients/${id}`, "DELETE");
    setClients((current) => current.filter((client) => client.id !== id));
    setContacts((current) =>
      current.filter((contact) => contact.client_id !== id),
    );
    if (selectedClientId === id)
      setSelectedClientId(clients.find((client) => client.id !== id)?.id || "");
  }

  async function saveContact() {
    const payload = {
      client_id: contactDraft.client_id || selectedClient?.id || "",
      name: contactDraft.name.trim(),
      title: contactDraft.title.trim(),
      email: contactDraft.email.trim(),
      phone: contactDraft.phone.trim(),
      cell_phone: contactDraft.cell_phone.trim(),
      notes: contactDraft.notes.trim(),
      contact_type: contactDraft.contact_type,
      is_primary: contactDraft.is_primary,
      is_onsite_contact: contactDraft.is_onsite_contact,
      is_billing_contact: contactDraft.is_billing_contact,
    };
    if (!payload.client_id) {
      setMsg({
        kind: "error",
        text: "Choose a client before saving a contact.",
      });
      return;
    }
    if (!payload.name) {
      setMsg({
        kind: "error",
        text: "Contact name is required when adding a contact. Phone, email, title, and flags are optional.",
      });
      return;
    }
    const data = editingContactId
      ? await request(
          `/api/client-contacts/${editingContactId}`,
          "PATCH",
          payload,
        )
      : await request("/api/client-contacts", "POST", payload);
    const next = { ...(data.contact as ClientContactRecord), contact_type: normalizeContactType((data.contact as ClientContactRecord)?.contact_type || payload.contact_type, payload.title) };
    if (!next?.id) return;
    setContacts((current) => {
      const normalized = next.is_primary
        ? current.map((contact) =>
            contact.client_id === next.client_id
              ? { ...contact, is_primary: false }
              : contact,
          )
        : current;
      return editingContactId
        ? normalized.map((contact) => (contact.id === next.id ? next : contact))
        : [...normalized.filter((contact) => contact.id !== next.id), next];
    });
    setSelectedClientId(next.client_id);
    setContactView(normalizeContactType(next.contact_type, next.title));
    setEditingContactId(null);
    setContactDraft({ ...emptyContact, client_id: next.client_id });
  }

  async function deleteContact(id: string) {
    if (!confirm("Delete this client contact?")) return;
    await request(`/api/client-contacts/${id}`, "DELETE");
    setContacts((current) => current.filter((contact) => contact.id !== id));
  }

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "minmax(280px, .9fr) minmax(0, 1.7fr)",
        gap: 16,
      }}
    >
      {msg ? (
        <p
          className={msg.kind === "error" ? "error" : "success"}
          style={{ gridColumn: "1 / -1" }}
        >
          {msg.text}
        </p>
      ) : null}

      <aside className="card">
        <div className="row">
          <div>
            <h3 style={{ marginBottom: 6 }}>Business Clients</h3>
            <p className="small muted" style={{ marginTop: 0 }}>
              One saved company profile can have multiple contacts. Only the
              client name is required.
            </p>
          </div>
          <button type="button" className="primary" onClick={startAddClient}>
            New Client
          </button>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>Search clients</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Client, city, email, address, notes..."
          />
        </label>
        <div className="list" style={{ marginTop: 12 }}>
          {filteredClients.length ? (
            filteredClients.map((client) => (
              <button
                key={client.id}
                type="button"
                className="ghost"
                style={{
                  textAlign: "left",
                  borderColor:
                    selectedClient?.id === client.id
                      ? "var(--brand)"
                      : undefined,
                }}
                onClick={() => {
                  setSelectedClientId(client.id);
                  setContactDraft((current) => ({
                    ...current,
                    client_id: client.id,
                  }));
                }}
              >
                <strong>{client.name}</strong>
                {client.legal_company_name ? (
                  <span className="small muted" style={{ display: "block" }}>
                    {client.legal_company_name}
                  </span>
                ) : null}
                <span className="small muted" style={{ display: "block" }}>
                  Default rate city: {client.default_rate_city || "Default"}
                </span>
                <span className="small muted" style={{ display: "block" }}>
                  Owner: {clientOwnerLabel(client)}
                </span>
                <span className="small muted" style={{ display: "block" }}>
                  {
                    contacts.filter(
                      (contact) => contact.client_id === client.id,
                    ).length
                  }{" "}
                  contact(s)
                </span>
                <span className="small muted" style={{ display: "block" }}>
                  Top tech pools:{" "}
                  {
                    buildMedianTopTechsByPool(
                      ratings.filter(
                        (rating) => rating.client_id === client.id,
                      ),
                      crewRecords,
                      1,
                    ).length
                  }
                </span>
              </button>
            ))
          ) : (
            <p className="small muted">
              No clients yet. Add your first business client.
            </p>
          )}
        </div>
      </aside>

      <section className="grid" style={{ gap: 16 }}>
        <div className="card">
          <div className="row">
            <div>
              <h3 style={{ marginBottom: 6 }}>
                {editingClientId ? "Edit Client" : "Add Client"}
              </h3>
              <p className="small muted" style={{ marginTop: 0 }}>
                Only Client name is required. Address, billing, AP, website,
                notes, and other company details can be left blank.
              </p>
            </div>
            {selectedClient ? (
              <div className="toolbar">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => startEditClient(selectedClient)}
                >
                  Edit selected
                </button>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => deleteClient(selectedClient.id)}
                >
                  Delete selected
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Client name *</span>
              <input
                value={clientDraft.name}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="NMR Events, Encore, etc."
              />
            </label>
            <label className="field">
              <span>Legal company name</span>
              <input
                value={clientDraft.legal_company_name}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    legal_company_name: event.target.value,
                  }))
                }
                placeholder="Optional"
              />
            </label>
          </div>

          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Main phone</span>
              <input
                value={clientDraft.main_phone}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    main_phone: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field">
              <span>Main email</span>
              <input
                type="email"
                value={clientDraft.main_email}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    main_email: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Website</span>
              <input
                value={clientDraft.website}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    website: event.target.value,
                  }))
                }
                placeholder="https://..."
              />
            </label>
            <label className="field">
              <span>Default rate city</span>
              <input
                value={clientDraft.default_rate_city}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    default_rate_city: event.target.value,
                  }))
                }
                placeholder="Default, New Orleans, Dallas..."
              />
            </label>
          </div>

          <div
            className="card compact"
            style={{ marginTop: 14, background: "#fbfcfd" }}
          >
            <h4 style={{ marginTop: 0 }}>Company / billing address</h4>
            <label className="field">
              <span>Billing address</span>
              <input
                value={clientDraft.billing_address}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    billing_address: event.target.value,
                  }))
                }
                placeholder="Street address or mailing address"
              />
            </label>
            <div className="grid grid-3" style={{ marginTop: 10 }}>
              <label className="field">
                <span>City</span>
                <input
                  value={clientDraft.billing_city}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      billing_city: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>State</span>
                <input
                  value={clientDraft.billing_state}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      billing_state: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>ZIP</span>
                <input
                  value={clientDraft.billing_zip}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      billing_zip: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </div>

          <div
            className="card compact"
            style={{ marginTop: 14, background: "#fbfcfd" }}
          >
            <h4 style={{ marginTop: 0 }}>Billing / admin details</h4>
            <div className="grid grid-2">
              <label className="field">
                <span>AP contact name</span>
                <input
                  value={clientDraft.ap_contact_name}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      ap_contact_name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>AP email</span>
                <input
                  type="email"
                  value={clientDraft.ap_email}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      ap_email: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <label className="field">
                <span>AP phone</span>
                <input
                  value={clientDraft.ap_phone}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      ap_phone: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Default invoice email</span>
                <input
                  type="email"
                  value={clientDraft.default_invoice_email}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      default_invoice_email: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <label className="field">
                <span>Payment terms</span>
                <input
                  value={clientDraft.payment_terms}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      payment_terms: event.target.value,
                    }))
                  }
                  placeholder="NET 30, due on receipt, etc."
                />
              </label>
              <label className="field">
                <span>PO required?</span>
                <select
                  value={clientDraft.po_required}
                  onChange={(event) =>
                    setClientDraft((current) => ({
                      ...current,
                      po_required: event.target.value as PoRequiredDraft,
                    }))
                  }
                >
                  <option value="">Unknown / not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
            </div>
            <label className="field" style={{ marginTop: 10 }}>
              <span>W-9 / COI notes</span>
              <textarea
                rows={2}
                value={clientDraft.w9_coi_notes}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    w9_coi_notes: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field" style={{ marginTop: 10 }}>
              <span>Billing notes</span>
              <textarea
                rows={2}
                value={clientDraft.billing_notes}
                onChange={(event) =>
                  setClientDraft((current) => ({
                    ...current,
                    billing_notes: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <label className="field" style={{ marginTop: 12 }}>
            <span>Default venue / market notes</span>
            <textarea
              rows={2}
              value={clientDraft.default_market_notes}
              onChange={(event) =>
                setClientDraft((current) => ({
                  ...current,
                  default_market_notes: event.target.value,
                }))
              }
              placeholder="Preferred venues, markets, billing rules, or scheduling reminders."
            />
          </label>
          <label className="field" style={{ marginTop: 12 }}>
            <span>General client notes</span>
            <textarea
              rows={3}
              value={clientDraft.notes}
              onChange={(event) =>
                setClientDraft((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
            />
          </label>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={saveClient}
            >
              {saving
                ? "Saving..."
                : editingClientId
                  ? "Save Client"
                  : "Add Client"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setEditingClientId(null);
                setClientDraft(emptyClient);
              }}
            >
              Clear
            </button>
          </div>
        </div>

        {selectedClient ? (
          <div className="card">
            <div className="row">
              <div>
                <h3 style={{ marginBottom: 6 }}>{selectedClient.name}</h3>
                <p className="small muted" style={{ marginTop: 0 }}>
                  Company profile, contacts, and client-specific top techs.
                </p>
              </div>
              <button
                type="button"
                className="primary"
                onClick={() => startAddContact(selectedClient.id)}
              >
                New Contact
              </button>
            </div>

            <div
              className="card compact"
              style={{ background: "#fbfcfd", marginTop: 14 }}
            >
              <h4 style={{ marginTop: 0 }}>Saved company profile</h4>
              {hasAny([
                selectedClient.legal_company_name,
                selectedClient.billing_address,
                selectedClient.main_phone,
                selectedClient.main_email,
                selectedClient.website,
                selectedClient.ap_contact_name,
                selectedClient.default_invoice_email,
                selectedClient.payment_terms,
                selectedClient.billing_notes,
                selectedClient.default_market_notes,
                selectedClient.notes,
              ]) ? (
                <div className="grid grid-2">
                  <div>
                    {selectedClient.legal_company_name ? (
                      <p className="small">
                        <strong>Legal name:</strong>{" "}
                        {selectedClient.legal_company_name}
                      </p>
                    ) : null}
                    {hasAny([
                      selectedClient.billing_address,
                      selectedClient.billing_city,
                      selectedClient.billing_state,
                      selectedClient.billing_zip,
                    ]) ? (
                      <p className="small">
                        <strong>Billing address:</strong>
                        <br />
                        {selectedClient.billing_address}
                        <br />
                        {[
                          selectedClient.billing_city,
                          selectedClient.billing_state,
                          selectedClient.billing_zip,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    ) : null}
                    {selectedClient.main_phone ? (
                      <p className="small">
                        <strong>Main phone:</strong>{" "}
                        {formatPhone(selectedClient.main_phone)}
                      </p>
                    ) : null}
                    {selectedClient.main_email ? (
                      <p className="small">
                        <strong>Main email:</strong> {selectedClient.main_email}
                      </p>
                    ) : null}
                    {selectedClient.website ? (
                      <p className="small">
                        <strong>Website:</strong> {selectedClient.website}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    {selectedClient.default_rate_city ? (
                      <p className="small">
                        <strong>Default rate city:</strong>{" "}
                        {selectedClient.default_rate_city}
                      </p>
                    ) : null}
                    {selectedClient.payment_terms ? (
                      <p className="small">
                        <strong>Payment terms:</strong>{" "}
                        {selectedClient.payment_terms}
                      </p>
                    ) : null}
                    {selectedClient.po_required !== null ? (
                      <p className="small">
                        <strong>PO required:</strong>{" "}
                        {selectedClient.po_required ? "Yes" : "No"}
                      </p>
                    ) : null}
                    {selectedClient.ap_contact_name ? (
                      <p className="small">
                        <strong>AP contact:</strong>{" "}
                        {selectedClient.ap_contact_name}
                      </p>
                    ) : null}
                    {selectedClient.ap_email ? (
                      <p className="small">
                        <strong>AP email:</strong> {selectedClient.ap_email}
                      </p>
                    ) : null}
                    {selectedClient.ap_phone ? (
                      <p className="small">
                        <strong>AP phone:</strong>{" "}
                        {formatPhone(selectedClient.ap_phone)}
                      </p>
                    ) : null}
                    {selectedClient.default_invoice_email ? (
                      <p className="small">
                        <strong>Invoice email:</strong>{" "}
                        {selectedClient.default_invoice_email}
                      </p>
                    ) : null}
                  </div>
                  {selectedClient.default_market_notes ? (
                    <p
                      className="small"
                      style={{ gridColumn: "1 / -1", whiteSpace: "pre-wrap" }}
                    >
                      <strong>Market notes:</strong>
                      <br />
                      {selectedClient.default_market_notes}
                    </p>
                  ) : null}
                  {selectedClient.w9_coi_notes ? (
                    <p
                      className="small"
                      style={{ gridColumn: "1 / -1", whiteSpace: "pre-wrap" }}
                    >
                      <strong>W-9 / COI notes:</strong>
                      <br />
                      {selectedClient.w9_coi_notes}
                    </p>
                  ) : null}
                  {selectedClient.billing_notes ? (
                    <p
                      className="small"
                      style={{ gridColumn: "1 / -1", whiteSpace: "pre-wrap" }}
                    >
                      <strong>Billing notes:</strong>
                      <br />
                      {selectedClient.billing_notes}
                    </p>
                  ) : null}
                  {selectedClient.notes ? (
                    <p
                      className="small"
                      style={{ gridColumn: "1 / -1", whiteSpace: "pre-wrap" }}
                    >
                      <strong>General notes:</strong>
                      <br />
                      {selectedClient.notes}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="small muted">
                  No optional company details saved yet. Click Edit selected to
                  add address, billing, AP, website, or notes.
                </p>
              )}
            </div>

            <div className="card compact" style={{ background: "#fbfcfd", marginTop: 14 }}>
              <div className="row" style={{ alignItems: "flex-end", gap: 12 }}>
                <div>
                  <div>
                    <h4 style={{ margin: 0 }}>Client-specific city prices</h4>
                    <div className="small muted" style={{ marginTop: 4 }}>Full Day is the source of truth. Half Day is always calculated at 50%.</div>
                  </div>
                  <p className="small muted" style={{ margin: "6px 0 0" }}>
                    Override only the prices this client pays in a particular market. Blank fields continue using the general city billing card, then the Default billing card.
                  </p>
                </div>
                <label className="field" style={{ minWidth: 220 }}>
                  <span>Pricing city</span>
                  <input
                    list="client-rate-city-options"
                    value={selectedRateCity}
                    onChange={(event) => setSelectedRateCity(event.target.value || "Default")}
                    placeholder="Default or city name"
                  />
                  <datalist id="client-rate-city-options">
                    {clientRateCityOptions.map((city) => <option key={city} value={city} />)}
                  </datalist>
                </label>
              </div>

              {clientRateOverridesMissing ? (
                <p className="error" style={{ marginTop: 12 }}>
                  Client-specific city pricing is not installed yet. Run the ELS279 SQL migration before saving these prices.
                </p>
              ) : null}

              <div className="toolbar" style={{ marginTop: 12, alignItems: "flex-end" }}>
                <label className="field" style={{ minWidth: 260 }}>
                  <span>Add a position</span>
                  <input
                    value={newRateRole}
                    onChange={(event) => setNewRateRole(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addClientRateRole();
                      }
                    }}
                    placeholder="Camera Operator, A1, General AV..."
                  />
                </label>
                <button type="button" className="ghost" onClick={addClientRateRole}>Add position</button>
                <label className="field" style={{ minWidth: 230 }}>
                  <span>Raise/lower all client prices</span>
                  <input
                    type="number"
                    step="0.01"
                    value={bulkClientRateAdjustAmount}
                    onChange={(event) => setBulkClientRateAdjustAmount(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applyClientRateBulkAdjust();
                      }
                    }}
                    placeholder="Example: 25 or -10"
                  />
                </label>
                <button
                  type="button"
                  className="ghost"
                  disabled={saving || clientRateOverridesMissing}
                  onClick={applyClientRateBulkAdjust}
                >
                  Apply amount to all
                </button>
              </div>

              <div className="mobile-table" style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--line)" }}>Position</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--line)" }}>Full day override</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--line)" }}>Half day (auto 50%)</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--line)" }}>OT override</th>
                      <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid var(--line)" }}>DT override</th>
                      <th style={{ padding: "8px 6px", borderBottom: "1px solid var(--line)" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {clientRateDraftRows.map((row) => (
                      <tr key={row.key}>
                        <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                          <input
                            value={row.role_name}
                            onChange={(event) => updateClientRateRow(row.key, { role_name: event.target.value })}
                            aria-label="Position name"
                          />
                        </td>
                        <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.full_day}
                            onChange={(event) => updateClientRateRow(row.key, { full_day: event.target.value })}
                            placeholder={displayMoneyRate(row.inherited_full_day)}
                          />
                          <div className="small muted" style={{ marginTop: 4 }}>Inherited: {displayMoneyRate(row.inherited_full_day)}</div>
                        </td>
                        <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.half_day}
                            readOnly
                            aria-readonly="true"
                            tabIndex={-1}
                            placeholder="Calculated from Full Day"
                            title="Half Day is always calculated as 50% of Full Day."
                            style={{ background: "var(--surface-muted, #f3f4f6)", color: "var(--muted)" }}
                          />
                          <div className="small muted" style={{ marginTop: 4 }}>Inherited 50% rate: {displayMoneyRate(row.inherited_half_day)}</div>
                        </td>
                        <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.05"
                            value={row.overtime_multiplier}
                            onChange={(event) => updateClientRateRow(row.key, { overtime_multiplier: event.target.value })}
                            placeholder={displayMultiplier(row.inherited_overtime_multiplier)}
                          />
                          <div className="small muted" style={{ marginTop: 4 }}>Inherited: {displayMultiplier(row.inherited_overtime_multiplier)}</div>
                        </td>
                        <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                          <input
                            type="number"
                            min="0"
                            step="0.05"
                            value={row.doubletime_multiplier}
                            onChange={(event) => updateClientRateRow(row.key, { doubletime_multiplier: event.target.value })}
                            placeholder={displayMultiplier(row.inherited_doubletime_multiplier)}
                          />
                          <div className="small muted" style={{ marginTop: 4 }}>Inherited: {displayMultiplier(row.inherited_doubletime_multiplier)}</div>
                        </td>
                        <td style={{ padding: "8px 6px", verticalAlign: "top" }}>
                          <button
                            type="button"
                            className="danger ghost"
                            onClick={() => {
                              if (row.inherited_full_day === null && row.inherited_half_day === null && !row.id) {
                                setClientRateDraftRows((current) => current.filter((item) => item.key !== row.key));
                              } else {
                                updateClientRateRow(row.key, {
                                  full_day: "",
                                  half_day: "",
                                  overtime_multiplier: "",
                                  doubletime_multiplier: "",
                                });
                              }
                            }}
                          >
                            {row.inherited_full_day === null && row.inherited_half_day === null && !row.id ? "Remove" : "Clear override"}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!clientRateDraftRows.length ? (
                      <tr>
                        <td colSpan={6} className="small muted" style={{ padding: 14 }}>
                          No general client billing roles are available yet. Add a position above or create the main client billing card in Settings.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="toolbar" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="primary"
                  disabled={saving || clientRateOverridesMissing}
                  onClick={saveClientCityRates}
                >
                  {saving ? "Saving..." : `Save ${selectedRateCity || "Default"} prices`}
                </button>
                <span className="small muted">
                  These prices apply automatically when an event uses this client and the same rate city.
                </span>
              </div>
            </div>

            <div className="grid grid-2" style={{ marginTop: 14 }}>
              <div className="card compact" style={{ background: "#fbfcfd" }}>
                <h4 style={{ marginTop: 0 }}>
                  {editingContactId ? "Edit Contact" : "Add Contact"}
                </h4>
                <p className="small muted" style={{ marginTop: -4 }}>
                  For contact records, only the contact name is required.
                  Everything else is optional.
                </p>
                <div className="grid grid-2">
                  <label className="field">
                    <span>Name *</span>
                    <input
                      value={contactDraft.name}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Title / role</span>
                    <input
                      value={contactDraft.title}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Contact section</span>
                  <select
                    value={contactDraft.contact_type}
                    onChange={(event) =>
                      setContactDraft((current) => ({
                        ...current,
                        contact_type: event.target.value as ClientContactType,
                      }))
                    }
                  >
                    {CONTACT_VIEW_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  <label className="field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={contactDraft.email}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          email: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Office phone</span>
                    <input
                      value={contactDraft.phone}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          phone: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Cell phone</span>
                  <input
                    value={contactDraft.cell_phone}
                    onChange={(event) =>
                      setContactDraft((current) => ({
                        ...current,
                        cell_phone: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Notes</span>
                  <textarea
                    rows={3}
                    value={contactDraft.notes}
                    onChange={(event) =>
                      setContactDraft((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="grid" style={{ gap: 8, marginTop: 10 }}>
                  <label
                    className="row small"
                    style={{
                      justifyContent: "flex-start",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={contactDraft.is_primary}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          is_primary: event.target.checked,
                        }))
                      }
                    />
                    Primary contact for this client
                  </label>
                  <label
                    className="row small"
                    style={{
                      justifyContent: "flex-start",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={contactDraft.is_onsite_contact}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          is_onsite_contact: event.target.checked,
                        }))
                      }
                    />
                    Common onsite contact
                  </label>
                  <label
                    className="row small"
                    style={{
                      justifyContent: "flex-start",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={contactDraft.is_billing_contact}
                      onChange={(event) =>
                        setContactDraft((current) => ({
                          ...current,
                          is_billing_contact: event.target.checked,
                        }))
                      }
                    />
                    Billing / AP contact
                  </label>
                </div>
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={saving}
                    onClick={saveContact}
                  >
                    {saving
                      ? "Saving..."
                      : editingContactId
                        ? "Save Contact"
                        : "Add Contact"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => startAddContact(selectedClient.id)}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="list">
                <div className="row" style={{ alignItems: "end" }}>
                  <div>
                    <h4 style={{ margin: 0 }}>Client contacts</h4>
                    <p className="small muted" style={{ margin: "4px 0 0" }}>{currentContactView.description}</p>
                  </div>
                  <label className="field" style={{ minWidth: 250 }}>
                    <span>Contact view</span>
                    <select value={contactView} onChange={(event) => setContactView(event.target.value as ClientContactType)}>
                      {CONTACT_VIEW_OPTIONS.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {visibleSectionContacts.length ? (
                  visibleSectionContacts.map((contact) => (
                    <div key={contact.id} className="card compact">
                      <div className="row">
                        <div>
                          <strong>{contact.name}</strong>
                          {contact.is_primary ? (
                            <span className="badge" style={{ marginLeft: 8 }}>
                              Primary
                            </span>
                          ) : null}
                          {contact.is_onsite_contact ? (
                            <span className="badge" style={{ marginLeft: 8 }}>
                              Onsite
                            </span>
                          ) : null}
                          {contact.is_billing_contact ? (
                            <span className="badge" style={{ marginLeft: 8 }}>
                              Billing
                            </span>
                          ) : null}
                          <span className="badge" style={{ marginLeft: 8 }}>
                            {contactTypeLabel(normalizeContactType(contact.contact_type, contact.title))}
                          </span>
                          <div className="small muted">
                            {contact.title || "No title"}
                          </div>
                          <div className="small muted">
                            {[
                              contact.email,
                              contact.phone
                                ? `Office ${formatPhone(contact.phone)}`
                                : "",
                              contact.cell_phone
                                ? `Cell ${formatPhone(contact.cell_phone)}`
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" • ") || "No contact details"}
                          </div>
                          <div className="small muted">Owner: {contactOwnerLabel(contact)}</div>
                        </div>
                        <div className="toolbar">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => startEditContact(contact)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ghost danger"
                            onClick={() => deleteContact(contact.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {contact.notes ? (
                        <p
                          className="small muted"
                          style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}
                        >
                          {contact.notes}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="small muted">
                    No contacts saved in this section yet. Use the Contact section dropdown when adding/editing a contact.
                  </p>
                )}
              </div>
            </div>

            <div className="card compact" style={{ marginTop: 14 }}>
              <div className="row" style={{ alignItems: "end" }}>
                <div>
                  <h4 style={{ marginTop: 0, marginBottom: 6 }}>Top tech rating view</h4>
                  <p className="small muted" style={{ marginTop: 0 }}>{currentContactView.description}</p>
                </div>
                <label className="field" style={{ minWidth: 260 }}>
                  <span>Choose view</span>
                  <select value={contactView} onChange={(event) => setContactView(event.target.value as ClientContactType)}>
                    {CONTACT_VIEW_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {contactView === "labor-coordinator" ? (
              <div className="card compact" style={{ marginTop: 14 }}>
                <h4 style={{ marginTop: 0 }}>Labor Coordinators</h4>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  This view is for the client’s labor coordinators and staffing contacts. Each contact shows who added it, so owner/admin can see contacts created by hired coordinators.
                </p>
              </div>
            ) : contactView === "client-tech" ? (
              <>
            <div className="card compact accent-card" style={{ marginTop: 14 }}>
              <h4 style={{ marginTop: 0 }}>
                Business Client Top Techs · Median
              </h4>
              <p className="small muted">
                This list uses the median 1–5 star rating across all events
                linked to this business client. It is separate from each project
                manager/contact&apos;s own Top Techs list.
              </p>
              {topTechs.length ? (
                <div className="list">
                  {topTechs.map((item, index) => (
                    <div
                      key={item.crew?.id || index}
                      className="row card compact"
                      style={{ alignItems: "center" }}
                    >
                      <div>
                        <strong>
                          #{index + 1} {item.crew?.name || "Unknown tech"}
                        </strong>
                        <div className="small muted">
                          {[
                            item.crew?.phone
                              ? formatPhone(item.crew.phone)
                              : "",
                            item.crew?.email || "",
                          ]
                            .filter(Boolean)
                            .join(" • ") || "No contact details"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 20, fontWeight: 800 }}>
                          {stars(item.median)} {item.median.toFixed(1)} median
                        </div>
                        <div className="small muted">
                          {item.count} event rating{item.count === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="small muted">No ratings for this client yet.</p>
              )}
            </div>

            <div className="card compact" style={{ marginTop: 14 }}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div>
                  <h4 style={{ marginTop: 0, marginBottom: 6 }}>
                    Business Client Top Techs by City/State Pool
                  </h4>
                  <p className="small muted" style={{ marginTop: 0 }}>
                    Choose one crew pool at a time so the client profile stays
                    organized. Techs with multiple pool memberships can appear
                    under each approved pool.
                  </p>
                </div>
                {ratingPoolOptions.length ? (
                  <label className="field" style={{ minWidth: 240 }}>
                    <span>Pool rating view</span>
                    <select
                      value={selectedRatingPoolName}
                      onChange={(event) => setSelectedRatingPool(event.target.value)}
                    >
                      {ratingPoolOptions.map((poolName) => (
                        <option key={poolName} value={poolName}>
                          {poolName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              {selectedBusinessPoolTopTechs ? (
                <div className="card compact" style={{ background: "#fbfcfd", marginTop: 10 }}>
                  <div className="row" style={{ alignItems: "baseline" }}>
                    <strong>{selectedBusinessPoolTopTechs.poolName}</strong>
                    <span className="badge">
                      {selectedBusinessPoolTopTechs.totalRatings} rating
                      {selectedBusinessPoolTopTechs.totalRatings === 1 ? "" : "s"}
                    </span>
                  </div>
                  {selectedBusinessPoolTopTechs.items.length ? (
                    <div className="list" style={{ marginTop: 8 }}>
                      {selectedBusinessPoolTopTechs.items.map((item, index) => (
                        <div
                          key={item.crew?.id || index}
                          className="row"
                          style={{ alignItems: "center", gap: 10 }}
                        >
                          <div>
                            <strong>
                              #{index + 1} {item.crew?.name || "Unknown tech"}
                            </strong>
                            <div className="small muted">
                              {[
                                item.crew?.phone ? formatPhone(item.crew.phone) : "",
                                item.crew?.email || "",
                              ]
                                .filter(Boolean)
                                .join(" • ") || "No contact details"}
                            </div>
                          </div>
                          <div style={{ textAlign: "right", minWidth: 115 }}>
                            <div style={{ fontWeight: 800 }}>
                              {stars(item.median)} {item.median.toFixed(1)}
                            </div>
                            <div className="small muted">
                              {item.count} rating{item.count === 1 ? "" : "s"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="small muted">No rated techs in this pool yet.</p>
                  )}
                </div>
              ) : (
                <p className="small muted">
                  No pool-specific top techs yet. Ratings will appear here after
                  techs are rated and their crew contact has a city/state pool.
                </p>
              )}
            </div>

              </>
            ) : (
            <div className="card compact" style={{ marginTop: 14 }}>
              <h4 style={{ marginTop: 0 }}>
                {contactView === "booth-manager" ? "Booth Manager Top Techs" : "Project Manager Top Techs"}
              </h4>
              <p className="small muted">
                Each client contact gets a separate median Top Techs list based
                on events where that contact was selected as the project
                manager/client contact.
              </p>
              {visibleSectionContacts.length ? (
                <div className="list">
                  {visibleSectionContacts.map((contact) => {
                    const rows = contactTopTechs.get(contact.id) || [];
                    return (
                      <div key={contact.id} className="card compact">
                        <strong>{contact.name}</strong>
                        <div className="small muted">
                          {contact.title || "Client contact"}
                        </div>
                        {rows.length ? (
                          <div className="list" style={{ marginTop: 8 }}>
                            {rows.map((item, index) => (
                              <div
                                key={item.crew?.id || index}
                                className="row"
                                style={{ alignItems: "center" }}
                              >
                                <div>
                                  <strong>
                                    #{index + 1}{" "}
                                    {item.crew?.name || "Unknown tech"}
                                  </strong>
                                  <div className="small muted">
                                    {[
                                      item.crew?.phone
                                        ? formatPhone(item.crew.phone)
                                        : "",
                                      item.crew?.email || "",
                                    ]
                                      .filter(Boolean)
                                      .join(" • ") || "No contact details"}
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontWeight: 800 }}>
                                    {stars(item.median)}{" "}
                                    {item.median.toFixed(1)} median
                                  </div>
                                  <div className="small muted">
                                    {item.count} event rating
                                    {item.count === 1 ? "" : "s"}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p
                            className="small muted"
                            style={{ marginBottom: 0 }}
                          >
                            No ratings tied to this project manager/contact yet.
                          </p>
                        )}

                        <div
                          className="card compact"
                          style={{ marginTop: 10, background: "#fbfcfd" }}
                        >
                          <div className="row" style={{ alignItems: "baseline" }}>
                            <strong>
                              Top Techs in {selectedRatingPoolName || "selected pool"}
                            </strong>
                            {selectedContactPoolTopTechs.get(contact.id) ? (
                              <span className="badge">
                                {selectedContactPoolTopTechs.get(contact.id)?.totalRatings} rating
                                {selectedContactPoolTopTechs.get(contact.id)?.totalRatings === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                          <p className="small muted" style={{ marginTop: 4 }}>
                            Use the pool dropdown above to switch this project
                            manager/contact list between New Orleans, travel,
                            or any other city/state pool.
                          </p>
                          {selectedContactPoolTopTechs.get(contact.id)?.items.length ? (
                            <div className="list" style={{ marginTop: 8 }}>
                              {(selectedContactPoolTopTechs.get(contact.id)?.items || []).map(
                                (item, index) => (
                                  <div
                                    key={item.crew?.id || index}
                                    className="row"
                                    style={{ alignItems: "center", gap: 10 }}
                                  >
                                    <div>
                                      <strong>
                                        #{index + 1} {item.crew?.name || "Unknown tech"}
                                      </strong>
                                      <div className="small muted">
                                        {[
                                          item.crew?.phone
                                            ? formatPhone(item.crew.phone)
                                            : "",
                                          item.crew?.email || "",
                                        ]
                                          .filter(Boolean)
                                          .join(" • ") || "No contact details"}
                                      </div>
                                    </div>
                                    <div style={{ textAlign: "right", minWidth: 96 }}>
                                      <div style={{ fontWeight: 800 }}>
                                        {stars(item.median)} {item.median.toFixed(1)}
                                      </div>
                                      <div className="small muted">
                                        {item.count} rating{item.count === 1 ? "" : "s"}
                                      </div>
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          ) : (
                            <p className="small muted" style={{ marginBottom: 0 }}>
                              No project-manager ratings in this selected pool yet.
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="small muted">
                  Add or assign contacts to this section, then choose that contact on an event so contact-specific Top Techs can build.
                </p>
              )}
            </div>
            )}
          </div>
        ) : (
          <div className="card compact">
            <strong>No client selected</strong>
            <p className="small muted">
              Add or choose a business client to manage company details,
              contacts, and top techs.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
