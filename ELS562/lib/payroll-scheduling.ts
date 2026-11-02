import type { PayrollCrewShowRow, PayrollPaymentStatus } from "@/lib/payroll-types";
export type NetDays = 15 | 30;
export type ScheduleMode = "automatic" | "manual";
type Settings = { netDays: NetDays; mode: ScheduleMode; date: string | null; status?: PayrollPaymentStatus };
const marker = /\[\[ELS_PAYROLL_SCHEDULE_V1:([^\]]+)\]\]/g;
export function validPayrollDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^(?:19|20|21)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function addNetDays(date: string | null, days: NetDays): string | null {
  if (!validPayrollDate(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}
export function lastPayrollWorkDate(row: Pick<PayrollCrewShowRow, "calls">): string | null {
  return row.calls.map((call) => call.laborDate.slice(0, 10)).filter(validPayrollDate).sort().at(-1) || null;
}
export function stripPayrollSchedule(notes: string | null | undefined) { return String(notes || "").replace(marker, "").trim(); }
export function readPayrollSchedule(notes: string | null | undefined, legacyDate: string | null = null): Settings {
  const fallback: Settings = { netDays: 30, mode: legacyDate ? "manual" : "automatic", date: legacyDate };
  const match = [...String(notes || "").matchAll(marker)].at(-1);
  if (!match) return fallback;
  try {
    const data = JSON.parse(decodeURIComponent(match[1]));
    if (![15, 30].includes(data.netDays) || !["automatic", "manual"].includes(data.mode) || (data.date !== null && !validPayrollDate(data.date))) return fallback;
    return { netDays: data.netDays, mode: data.mode, date: data.date, status: ["paid", "scheduled", "unpaid"].includes(data.status) ? data.status : undefined };
  } catch { return fallback; }
}
export function mergePayrollSchedule(notes: string | null | undefined, settings: Settings) {
  const clean = stripPayrollSchedule(notes);
  return [clean, `[[ELS_PAYROLL_SCHEDULE_V1:${encodeURIComponent(JSON.stringify(settings))}]]`].filter(Boolean).join("\n\n");
}
export function payrollScheduledBy(row: Pick<PayrollCrewShowRow, "calls" | "scheduledFor" | "paymentTermsDays" | "scheduleMode">) {
  if (row.scheduleMode === "manual" || (!row.scheduleMode && row.scheduledFor)) return row.scheduledFor;
  return addNetDays(lastPayrollWorkDate(row), row.paymentTermsDays || 30);
}

export function mergePayrollPaymentState(row: PayrollCrewShowRow, saved?: PayrollCrewShowRow): PayrollCrewShowRow {
  if (!saved) return row;
  // Refreshes may carry newer work dates or event finances. Reapply only the
  // payment fields saved locally, never a stale copy of the whole event row.
  return { ...row, paid: saved.paid, paymentStatus: saved.paymentStatus, scheduledFor: saved.scheduledFor, paymentTermsDays: saved.paymentTermsDays, scheduleMode: saved.scheduleMode, notes: saved.notes, overrideAmount: saved.overrideAmount, statusId: saved.statusId };
}
