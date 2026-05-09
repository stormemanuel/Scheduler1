import type { CrewRecord } from "@/lib/crew-types";
import type { LaborDayRecord, SubCallRecord } from "@/lib/events-types";
import type { MasterRateRecord } from "@/lib/rates-types";

export const PAYROLL_STATUS_ROLE = "__event_total__";

const fallbackRoleRates: Record<string, { full_day: number; half_day: number | null }> = {
  "general av": { full_day: 450, half_day: 225 },
  "av tech": { full_day: 450, half_day: 225 },
  "audio visual tech": { full_day: 450, half_day: 225 },
  "client facing audio visual tech": { full_day: 400, half_day: 200 },
  "cf avt": { full_day: 400, half_day: 200 },
  "stagehand": { full_day: 400, half_day: 200 },
  "led assist": { full_day: 500, half_day: 250 },
  "lighting assist": { full_day: 500, half_day: 250 },
  "audio assist": { full_day: 500, half_day: 250 },
  "video assist": { full_day: 550, half_day: 250 },
};

const roleAliasGroups = [
  ["general av", "gav", "avt", "av tech", "audio visual tech", "audio visual technician", "general audio visual"],
  ["client facing audio visual tech", "client facing av tech", "client facing audiovisual tech", "client facing avt", "cf avt"],
  ["led assist", "led", "led tech", "led technician", "led stagehand"],
  ["lighting assist", "l2", "lighting assistant"],
  ["audio assist", "a2", "audio assistant"],
  ["video assist", "v2", "video assistant"],
  ["stagehand", "stage hand", "hand"],
  ["crew lead", "lead", "breakout lead"],
];

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

export function roleKeys(roleName: string | null | undefined) {
  const target = normalizePayrollText(roleName);
  const keys = new Set<string>();
  if (target) keys.add(target);

  for (const group of roleAliasGroups) {
    const normalizedGroup = group.map(normalizePayrollText);
    if (normalizedGroup.includes(target)) {
      normalizedGroup.forEach((item) => keys.add(item));
    }
  }

  if (/\bled\b/.test(target) && /\bstagehand\b/.test(target)) {
    keys.add("led assist");
    keys.add("led stagehand");
  }

  return keys;
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
  const keys = roleKeys(roleName);
  const exact = crew.positions.find((position) => keys.has(normalizePayrollText(position.role_name)) && Number(position.rate) > 0);
  if (exact) return Number(exact.rate);

  const fuzzy = crew.positions.find((position) => {
    const role = normalizePayrollText(position.role_name);
    return Number(position.rate) > 0 && [...keys].some((key) => role.includes(key) || key.includes(role));
  });
  return fuzzy ? Number(fuzzy.rate) : null;
}

function matchingMasterRate(masterRates: MasterRateRecord[], roleName: string, rateCity: string) {
  const keys = roleKeys(roleName);
  const isMatch = (rate: MasterRateRecord, city: string) =>
    normalizePayrollText(rate.city_name) === normalizePayrollText(city) && keys.has(normalizePayrollText(rate.role_name));

  return masterRates.find((rate) => isMatch(rate, rateCity)) ?? masterRates.find((rate) => isMatch(rate, "Default")) ?? null;
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
  const crewFullDay = matchingCrewPositionRate(crew, call.role_name);
  const masterRate = matchingMasterRate(masterRates, call.role_name, rateCity);
  const keys = [...roleKeys(call.role_name)];
  const fallback = fallbackRoleRates[keys.find((key) => fallbackRoleRates[key]) || ""] ?? null;

  const fullDayRate = crewFullDay ?? masterRate?.full_day ?? fallback?.full_day ?? 0;
  const halfDayRate = crewFullDay ? Math.round((crewFullDay / 2) * 100) / 100 : masterRate?.half_day ?? fallback?.half_day ?? null;
  const source = crewFullDay ? "Crew rate" : masterRate ? `${masterRate.city_name || "Default"} master rate` : fallback ? "Built-in fallback" : "No rate found";

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
