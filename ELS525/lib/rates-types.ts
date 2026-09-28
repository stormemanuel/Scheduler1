export type MasterRateRecord = {
  id: string;
  city_name: string;
  role_name: string;
  full_day: number;
  half_day: number | null;
  overtime_multiplier: number;
  doubletime_multiplier: number;
};

export type ClientRateRecord = MasterRateRecord;

export function halfDayFromFullDay(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const fullDay = Number(value);
  if (!Number.isFinite(fullDay) || fullDay < 0) return null;
  return Math.round((fullDay / 2) * 100) / 100;
}
