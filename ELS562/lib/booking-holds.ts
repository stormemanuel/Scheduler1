export type BookingHold = { id: string; crew_id: string; respond_by: string; created_by: string; created_at: string };
const marker = /\[\[ELS_BOOKING_HOLDS:([^\]]*)\]\]/gi;
export function stripBookingHolds(notes?: string | null) {
  return String(notes || "").replace(marker, "").replace(/\n{3,}/g, "\n\n").trim();
}
export function readBookingHolds(notes?: string | null): BookingHold[] {
  const raw = /\[\[ELS_BOOKING_HOLDS:([^\]]*)\]\]/i.exec(String(notes || ""))?.[1];
  if (!raw) return [];
  try {
    const rows: unknown = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is BookingHold => row && typeof row.id === "string" && typeof row.crew_id === "string" && typeof row.created_by === "string" && typeof row.created_at === "string" && typeof row.respond_by === "string");
  } catch { return []; }
}
export function notesWithBookingHolds(notes: string | null | undefined, holds: BookingHold[]) {
  return [stripBookingHolds(notes), holds.length ? `[[ELS_BOOKING_HOLDS:${encodeURIComponent(JSON.stringify(holds))}]]` : ""].filter(Boolean).join("\n");
}
export function activeBookingHolds(notes: string | null | undefined, bookedCrewIds: string[]) {
  const booked = new Set(bookedCrewIds);
  return readBookingHolds(notes).filter(hold => !booked.has(hold.crew_id));
}
export function validHoldDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
