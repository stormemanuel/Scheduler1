import type { CrewRecord } from "@/lib/crew-types";
import type { SubCallRecord } from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";

export const PAYROLL_STATUS_ROLE = "__event_total__";

const crewFallbackRoleRates: Record<string, { full_day: number; half_day: number | null }> = {
  "general av": { full_day: 350, half_day: 175 },
  gav: { full_day: 350, half_day: 175 },
  avt: { full_day: 350, half_day: 175 },
  "av tech": { full_day: 350, half_day: 175 },
  "audio visual tech": { full_day: 350, half_day: 175 },
  "client facing audio visual tech": { full_day: 400, half_day: 200 },
  "cf avt": { full_day: 400, half_day: 200 },
  stagehand: { full_day: 300, half_day: 150 },
  "led assist": { full_day: 350, half_day: 175 },
  "lighting assist": { full_day: 350, half_day: 175 },
  "audio assist": { full_day: 350, half_day: 175 },
  "video assist": { full_day: 350, half_day: 175 },
  "breakout operator": { full_day: 400, half_day: 200 },
  bo: { full_day: 400, half_day: 200 },
  "bo tech": { full_day: 400, half_day: 200 },
  "warehouse worker": { full_day: 300, half_day: 150 },
  "warehouse workers": { full_day: 300, half_day: 150 },
  warehouse: { full_day: 300, half_day: 150 },
  "on-call replacement": { full_day: 0, half_day: 0 },
  "on call replacement": { full_day: 0, half_day: 0 },
  "on-site replacement": { full_day: 50, half_day: 50 },
  "onsite replacement": { full_day: 50, half_day: 50 },
  "on site replacement": { full_day: 50, half_day: 50 },
};

const clientBillingRates: Record<string, { full_day: number; half_day: number | null }> = {
  "audio engineer specialty": { full_day: 750, half_day: null },
  "audio engineer": { full_day: 700, half_day: null },
  "led engineer": { full_day: 800, half_day: null },
  "lead video engineer": { full_day: 700, half_day: null },
  "lighting designer": { full_day: 700, half_day: null },
  "crew lead": { full_day: 650, half_day: null },
  "breakout lead": { full_day: 650, half_day: null },
  "graphics operator": { full_day: 650, half_day: null },
  "playback operator": { full_day: 650, half_day: null },
  "zoom operator": { full_day: 650, half_day: null },
  "record operator": { full_day: 650, half_day: null },
  "camera operator": { full_day: 700, half_day: null },
  "breakout operator": { full_day: 600, half_day: null },
  "breakout floater": { full_day: 550, half_day: null },
  "audio show support": { full_day: 550, half_day: null },
  "audio assist": { full_day: 500, half_day: 250 },
  "audio setup and strike": { full_day: 450, half_day: 225 },
  "video assist": { full_day: 550, half_day: 250 },
  "video set strike": { full_day: 450, half_day: 225 },
  "lighting assist": { full_day: 500, half_day: 250 },
  "lighting set strike": { full_day: 450, half_day: 225 },
  "led assist": { full_day: 500, half_day: 250 },
  "down rigger": { full_day: 550, half_day: 275 },
  decoration: { full_day: 450, half_day: 225 },
  "general av": { full_day: 450, half_day: 225 },
  gav: { full_day: 450, half_day: 225 },
  avt: { full_day: 450, half_day: 225 },
  stagehand: { full_day: 400, half_day: 200 },
  "client facing audio visual tech": { full_day: 450, half_day: 225 },
  "warehouse worker": { full_day: 400, half_day: 200 },
  "warehouse workers": { full_day: 400, half_day: 200 },
  warehouse: { full_day: 400, half_day: 200 },
  "on-call replacement": { full_day: 0, half_day: 0 },
  "on call replacement": { full_day: 0, half_day: 0 },
  "on-site replacement": { full_day: 0, half_day: 0 },
  "onsite replacement": { full_day: 0, half_day: 0 },
  "on site replacement": { full_day: 0, half_day: 0 },
};

type RoleFamily =
  | "general_av"
  | "client_facing_av"
  | "led_assist"
  | "breakout_operator"
  | "breakout_lead"
  | "lighting_assist"
  | "audio_assist"
  | "video_assist"
  | "stagehand"
  | "crew_lead"
  | "speaker_ready"
  | "camera_operator"
  | "graphics_operator"
  | "playback_operator"
  | "zoom_operator"
  | "record_operator"
  | "down_rigger"
  | "decoration"
  | "audio_engineer"
  | "audio_show_support"
  | "warehouse_worker";

const roleAliasGroups: Record<RoleFamily, string[]> = {
  general_av: ["general av", "gav", "avt", "av tech", "audio visual tech", "audio visual technician", "general audio visual", "general av tech", "general av technician"],
  client_facing_av: ["client facing audio visual tech", "client facing av tech", "client facing audiovisual tech", "client facing avt", "cf avt", "cf av tech", "cfavt"],
  led_assist: ["led assist", "led", "led tech", "led technician", "led stagehand", "led hand"],
  breakout_operator: ["breakout operator", "bo", "bo tech", "bo technician", "breakout tech", "breakout technician", "breakout", "breakouts", "breakout room operator", "breakout room tech", "bo room"],
  breakout_lead: ["breakout lead", "bo lead", "breakout room lead"],
  lighting_assist: ["lighting assist", "l2", "l2 lighting assist", "lighting assistant", "lighting tech", "lighting technician"],
  audio_assist: ["audio assist", "a2", "a2 audio assist", "audio assistant", "audio tech", "audio technician"],
  video_assist: ["video assist", "v2", "v2 video assist", "video assistant", "video tech", "video technician"],
  stagehand: ["stagehand", "stage hand", "hand"],
  crew_lead: ["crew lead", "lead", "working crew lead"],
  speaker_ready: ["speaker ready", "speaker ready operator"],
  camera_operator: ["camera operator", "camera op", "cam op", "ptz", "camera operator ptz"],
  graphics_operator: ["graphics operator", "graphics", "gpx", "powerpoint", "keynote"],
  playback_operator: ["playback operator", "playback", "playback pro", "propresenter"],
  zoom_operator: ["zoom operator", "zoom op", "zoom"],
  record_operator: ["record operator", "record op", "record", "recording"],
  down_rigger: ["down rigger", "rigger"],
  decoration: ["decoration", "decor", "sign assembly"],
  audio_engineer: ["audio engineer", "a1", "a1 audio engineer"],
  audio_show_support: ["audio show support", "show support"],
  warehouse_worker: ["warehouse worker", "warehouse workers", "warehouse", "warehouse prep"],
};

export function normalizePayrollText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wholeWordContains(haystack: string, needle: string) {
  if (!needle) return false;
  if (haystack === needle) return true;
  return new RegExp(`(^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(haystack);
}

function roleFamilies(roleName: string | null | undefined) {
  const target = normalizePayrollText(roleName);
  const families = new Set<RoleFamily>();
  if (!target) return families;

  for (const [family, aliases] of Object.entries(roleAliasGroups) as Array<[RoleFamily, string[]]>) {
    for (const alias of aliases.map(normalizePayrollText)) {
      if (wholeWordContains(target, alias) || wholeWordContains(alias, target)) {
        families.add(family);
        break;
      }
    }
  }

  if (/\bgav\b/.test(target)) families.add("general_av");
  if (/\bavt\b/.test(target) && !/\bcf\b/.test(target)) families.add("general_av");
  if (/\bcf\b/.test(target) && (/\bavt\b|\bav\b|audio visual/.test(target))) families.add("client_facing_av");
  if (/\bled\b/.test(target) && (/assist|tech|technician|stagehand|hand/.test(target) || target === "led")) families.add("led_assist");
  if ((/\bbo\b/.test(target) || /breakout/.test(target)) && !/lead/.test(target)) families.add("breakout_operator");
  if ((/\bbo\b/.test(target) || /breakout/.test(target)) && /lead/.test(target)) families.add("breakout_lead");
  if (/\bl2\b|lighting assist|lighting tech|lighting technician/.test(target)) families.add("lighting_assist");
  if (/\ba2\b|audio assist|audio tech|audio technician/.test(target)) families.add("audio_assist");
  if (/\bv2\b|video assist|video tech|video technician/.test(target)) families.add("video_assist");

  return families;
}

export function roleKeys(roleName: string | null | undefined) {
  const target = normalizePayrollText(roleName);
  const keys = new Set<string>();
  if (target) keys.add(target);

  for (const family of roleFamilies(target)) {
    roleAliasGroups[family].map(normalizePayrollText).forEach((alias) => keys.add(alias));
  }

  return keys;
}

function roleMatches(a: string | null | undefined, b: string | null | undefined) {
  const aText = normalizePayrollText(a);
  const bText = normalizePayrollText(b);
  if (!aText || !bText) return false;
  if (aText === bText) return true;

  const aKeys = roleKeys(aText);
  const bKeys = roleKeys(bText);
  for (const key of aKeys) if (bKeys.has(key)) return true;

  const aFamilies = roleFamilies(aText);
  const bFamilies = roleFamilies(bText);
  for (const family of aFamilies) if (bFamilies.has(family)) return true;

  return aText.includes(bText) || bText.includes(aText);
}

function rateNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function minutesFromTime(value: string | null | undefined) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

export function callDurationHours(call: Pick<SubCallRecord, "start_time" | "end_time" | "one_hour_walkaway">) {
  const start = minutesFromTime(call.start_time);
  const end = minutesFromTime(call.end_time);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  const elapsedHours = diff / 60;
  return Math.max(0, elapsedHours - (call.one_hour_walkaway ? 1 : 0));
}

export function formatPayrollTime(value: string | null | undefined) {
  const minutes = minutesFromTime(value);
  if (minutes === null) return String(value || "").trim();
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatPayrollDate(value: string | null | undefined) {
  if (!value) return "";
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return String(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function matchingCrewPositionRate(crew: CrewRecord | undefined, roleName: string) {
  if (!crew) return null;
  const exact = crew.positions.find((position) => roleMatches(position.role_name, roleName) && rateNumber(position.rate) !== null);
  if (exact) return rateNumber(exact.rate);
  return null;
}

function roleMatchScore(rateRoleName: string | null | undefined, requestedRoleName: string | null | undefined) {
  const rateRole = normalizePayrollText(rateRoleName);
  const requestedRole = normalizePayrollText(requestedRoleName);
  if (!rateRole || !requestedRole) return 0;

  // Exact role names must always win. This prevents a broad role like "LED" or
  // an engineer role from being selected before the intended "LED Assist" row.
  if (rateRole === requestedRole) return 1000;

  const rateKeys = roleKeys(rateRole);
  const requestedKeys = roleKeys(requestedRole);
  if (rateKeys.has(requestedRole)) return 900;
  if (requestedKeys.has(rateRole)) return 800;

  const rateFamilies = roleFamilies(rateRole);
  const requestedFamilies = roleFamilies(requestedRole);
  for (const family of rateFamilies) {
    if (requestedFamilies.has(family)) return 650;
  }

  // Last resort for long, specific role names only. Avoid matching short broad
  // words such as "LED", "AV", or "Lead" to the wrong specialty rate.
  if (rateRole.length >= 8 && requestedRole.length >= 8 && (rateRole.includes(requestedRole) || requestedRole.includes(rateRole))) {
    return 250;
  }

  return 0;
}

function matchingMasterRate(masterRates: MasterRateRecord[], roleName: string, rateCity: string, masterRateId?: string | null) {
  const requestedId = String(masterRateId || "").trim();
  if (requestedId) {
    const exactById = masterRates.find((rate) => String(rate.id || "") === requestedId);
    if (exactById) return exactById;
  }

  const cityTarget = normalizePayrollText(rateCity || "Default");
  const defaultCity = normalizePayrollText("Default");
  const allowedCities = new Set([cityTarget, defaultCity]);

  let bestRate: MasterRateRecord | null = null;
  let bestScore = 0;

  for (const rate of masterRates) {
    const rateCityText = normalizePayrollText(rate.city_name || "Default");
    if (!allowedCities.has(rateCityText)) continue;

    const roleScore = roleMatchScore(rate.role_name, roleName);
    if (roleScore <= 0) continue;

    // Prefer a matching city override, but never let a weak city match beat an
    // exact Default role match.
    const cityBoost = rateCityText === cityTarget && cityTarget !== defaultCity ? 50 : 0;
    const totalScore = roleScore + cityBoost;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestRate = rate;
    }
  }

  return bestRate;
}

function fallbackFor(roleName: string, table: Record<string, { full_day: number; half_day: number | null }>) {
  const keys = [...roleKeys(roleName)];
  return table[keys.find((key) => table[key]) || ""] ?? null;
}

export type AssignmentPayEstimate = {
  amount: number;
  durationHours: number | null;
  payLabel: string;
  rateSource: string;
  fullDayRate: number;
  halfDayRate: number | null;
};

export function estimateAssignmentPay(options: {
  call: SubCallRecord;
  crew?: CrewRecord;
  masterRates: MasterRateRecord[];
  rateCity: string;
}): AssignmentPayEstimate {
  const { call, crew, masterRates, rateCity } = options;
  const duration = callDurationHours(call);
  const masterRate = matchingMasterRate(masterRates, call.role_name, rateCity, call.master_rate_id);
  const crewFullDay = matchingCrewPositionRate(crew, call.role_name);
  const fallback = fallbackFor(call.role_name, crewFallbackRoleRates);

  const masterFull = rateNumber(masterRate?.full_day);
  const masterHalf = rateNumber(masterRate?.half_day);
  const fallbackFull = rateNumber(fallback?.full_day);
  const fallbackHalf = rateNumber(fallback?.half_day);
  const fullDayRate = masterFull ?? fallbackFull ?? crewFullDay ?? 0;
  const halfDayRate = masterHalf ?? fallbackHalf ?? (fullDayRate > 0 ? Math.round((fullDayRate / 2) * 100) / 100 : null);
  const source = masterFull
    ? `${masterRate?.city_name || "Default"} master rate`
    : fallback
      ? "ELS default role rate"
      : crewFullDay
        ? "Crew profile fallback"
        : "No rate found";

  return estimateByBlock({ duration, fullDayRate, halfDayRate, source, blockType: call.day_type });
}

function safeBlockType(value: unknown) {
  const text = String(value || "").trim();
  return text === "full_day" || text === "half_day" || text === "hourly" || text === "custom" ? text : "";
}

function estimateHourlyBlock(options: { duration: number | null; fullDayRate: number; halfDayRate: number | null; source: string }): AssignmentPayEstimate {
  const { duration, fullDayRate, halfDayRate, source } = options;
  const hourlyRate = fullDayRate > 0 ? fullDayRate / 10 : 0;
  if (duration === null || duration <= 0 || hourlyRate <= 0) {
    return { amount: 0, durationHours: duration, payLabel: "Hourly", rateSource: source, fullDayRate, halfDayRate };
  }
  if (duration > 10) {
    const otHours = Math.min(Math.max(duration - 10, 0), 2);
    const dtHours = Math.max(duration - 12, 0);
    const regularHours = Math.min(duration, 10);
    const amount = regularHours * hourlyRate + otHours * hourlyRate * 1.5 + dtHours * hourlyRate * 2;
    const label = dtHours > 0 ? `Hourly ${regularHours.toFixed(1)}h + ${otHours.toFixed(1)} OT + ${dtHours.toFixed(1)} DT` : `Hourly ${regularHours.toFixed(1)}h + ${otHours.toFixed(1)} OT`;
    return { amount: Math.round(amount * 100) / 100, durationHours: duration, payLabel: label, rateSource: source, fullDayRate, halfDayRate };
  }
  const amount = duration * hourlyRate;
  return { amount: Math.round(amount * 100) / 100, durationHours: duration, payLabel: `Hourly ${duration.toFixed(1)}h`, rateSource: source, fullDayRate, halfDayRate };
}

function estimateByBlock(options: { duration: number | null; fullDayRate: number; halfDayRate: number | null; source: string; blockType?: string | null }): AssignmentPayEstimate {
  const { duration, fullDayRate, halfDayRate, source } = options;
  const blockType = safeBlockType(options.blockType);

  if (blockType === "hourly") return estimateHourlyBlock({ duration, fullDayRate, halfDayRate, source });
  if (blockType === "half_day" && halfDayRate !== null) {
    return { amount: halfDayRate, durationHours: duration, payLabel: "Half day", rateSource: source, fullDayRate, halfDayRate };
  }
  if (blockType === "full_day") {
    if (duration !== null && duration > 10 && fullDayRate > 0) {
      const hourly = fullDayRate / 10;
      const otHours = Math.min(Math.max(duration - 10, 0), 2);
      const dtHours = Math.max(duration - 12, 0);
      const amount = fullDayRate + otHours * hourly * 1.5 + dtHours * hourly * 2;
      const label = dtHours > 0 ? `Full day + ${otHours.toFixed(1)} OT + ${dtHours.toFixed(1)} DT` : `Full day + ${otHours.toFixed(1)} OT`;
      return { amount: Math.round(amount * 100) / 100, durationHours: duration, payLabel: label, rateSource: source, fullDayRate, halfDayRate };
    }
    return { amount: fullDayRate, durationHours: duration, payLabel: "Full day", rateSource: source, fullDayRate, halfDayRate };
  }

  if (duration !== null && duration <= 5 && halfDayRate !== null) {
    return { amount: halfDayRate, durationHours: duration, payLabel: "Half day", rateSource: source, fullDayRate, halfDayRate };
  }

  if (duration !== null && duration > 10 && fullDayRate > 0) {
    const hourly = fullDayRate / 10;
    const otHours = Math.min(Math.max(duration - 10, 0), 2);
    const dtHours = Math.max(duration - 12, 0);
    const amount = fullDayRate + otHours * hourly * 1.5 + dtHours * hourly * 2;
    const label = dtHours > 0 ? `Full day + ${otHours.toFixed(1)} OT + ${dtHours.toFixed(1)} DT` : `Full day + ${otHours.toFixed(1)} OT`;
    return { amount: Math.round(amount * 100) / 100, durationHours: duration, payLabel: label, rateSource: source, fullDayRate, halfDayRate };
  }

  return { amount: fullDayRate, durationHours: duration, payLabel: duration !== null && duration <= 10 ? "Full day" : "Full day estimate", rateSource: source, fullDayRate, halfDayRate };
}

export function estimateAssignmentRevenue(options: {
  call: SubCallRecord;
  clientRates?: MasterRateRecord[];
  rateCity?: string;
}): AssignmentPayEstimate {
  const { call, clientRates = [], rateCity = "Default" } = options;
  const duration = callDurationHours(call);
  const clientRate = matchingMasterRate(clientRates, call.role_name, rateCity, null);
  const fallback = fallbackFor(call.role_name, clientBillingRates);
  const rateFull = rateNumber(clientRate?.full_day);
  const rateHalf = rateNumber(clientRate?.half_day);
  const fallbackFull = rateNumber(fallback?.full_day);
  const fallbackHalf = rateNumber(fallback?.half_day);
  const fullDayRate = rateFull ?? fallbackFull ?? 0;
  const halfDayRate = rateHalf ?? fallbackHalf;
  const source = rateFull ? `${clientRate?.city_name || "Default"} client rate` : "ELS default client rate";
  return estimateByBlock({ duration, fullDayRate, halfDayRate, source, blockType: call.day_type });
}

export function showYear(showStart: string | null | undefined) {
  const year = Number(String(showStart || "").slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : new Date().getFullYear();
}

export function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}
