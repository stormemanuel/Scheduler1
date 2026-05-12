import type { CrewRecord } from "@/lib/crew-types";
import type { SubCallRecord } from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";

export const PAYROLL_STATUS_ROLE = "__event_total__";

const fallbackRoleRates: Record<string, { full_day: number; half_day: number | null }> = {
  "general av": { full_day: 350, half_day: 175 },
  "av tech": { full_day: 350, half_day: 175 },
  "audio visual tech": { full_day: 350, half_day: 175 },
  "client facing audio visual tech": { full_day: 400, half_day: 200 },
  "cf avt": { full_day: 400, half_day: 200 },
  "stagehand": { full_day: 300, half_day: 150 },
  "led assist": { full_day: 350, half_day: 175 },
  "lighting assist": { full_day: 350, half_day: 175 },
  "audio assist": { full_day: 350, half_day: 175 },
  "video assist": { full_day: 350, half_day: 175 },
  "breakout operator": { full_day: 400, half_day: 200 },
  "bo": { full_day: 400, half_day: 200 },
  "bo tech": { full_day: 400, half_day: 200 },
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
  | "decoration";

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

export function callDurationHours(call: Pick<SubCallRecord, "start_time" | "end_time">) {
  const start = minutesFromTime(call.start_time);
  const end = minutesFromTime(call.end_time);
  if (start === null || end === null) return null;
  let diff = end - start;
  if (diff <= 0) diff += 24 * 60;
  return diff / 60;
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

function matchingMasterRateForAnyCity(masterRates: MasterRateRecord[], roleName: string) {
  return masterRates.find((rate) => roleMatches(rate.role_name, roleName)) ?? null;
}

function matchingMasterRate(masterRates: MasterRateRecord[], roleName: string, rateCity: string) {
  const cityTarget = normalizePayrollText(rateCity || "Default");
  const defaultCity = normalizePayrollText("Default");
  const findForCity = (city: string) =>
    masterRates.find((rate) => normalizePayrollText(rate.city_name || "Default") === city && roleMatches(rate.role_name, roleName));

  return findForCity(cityTarget) ?? findForCity(defaultCity) ?? null;
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
  const masterRate = matchingMasterRate(masterRates, call.role_name, rateCity);
  const anyMasterRate = matchingMasterRateForAnyCity(masterRates, call.role_name);
  const crewFullDay = matchingCrewPositionRate(crew, call.role_name);
  const keys = [...roleKeys(call.role_name)];
  const fallback = fallbackRoleRates[keys.find((key) => fallbackRoleRates[key]) || ""] ?? null;

  const masterFull = rateNumber(masterRate?.full_day);
  const masterHalf = rateNumber(masterRate?.half_day);
  const anyMasterFull = rateNumber(anyMasterRate?.full_day);
  const anyMasterHalf = rateNumber(anyMasterRate?.half_day);

  // Payroll should follow the saved crew-pay default/master rates first. Crew profile
  // role rates are treated as old/contact-level fallback data so stale client-facing
  // values like $450 GAV do not override the current Default Rates table.
  const fullDayRate = masterFull ?? anyMasterFull ?? crewFullDay ?? fallback?.full_day ?? 0;
  const halfDayRate = masterHalf ?? anyMasterHalf ?? (crewFullDay ? Math.round((crewFullDay / 2) * 100) / 100 : null) ?? fallback?.half_day ?? null;
  const source = masterFull
    ? `${masterRate?.city_name || "Default"} default crew rate`
    : anyMasterFull
      ? `${anyMasterRate?.city_name || "Default"} default crew rate`
      : crewFullDay
        ? "Crew role fallback"
        : fallback
          ? "Built-in fallback"
          : "No rate found";

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

export function showYear(showStart: string | null | undefined) {
  const year = Number(String(showStart || "").slice(0, 4));
  return Number.isFinite(year) && year > 1900 ? year : new Date().getFullYear();
}

export function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
}
