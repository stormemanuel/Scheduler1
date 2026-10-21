export type ShiftInterval = { start: number; end: number };

// Compare local schedule dates consistently. These are wall-clock intervals,
// not UTC timestamps to be displayed to a user.
export function availabilityInterval(date: string, startTime: string | null | undefined, endTime: string | null | undefined): ShiftInterval | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const midnight = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== date) return null;
  const minutes = (value: string | null | undefined) => {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]), minute = Number(match[2]);
    return hour < 24 && minute < 60 ? hour * 60 + minute : null;
  };
  const start = minutes(startTime), end = minutes(endTime);
  if (start === null || end === null) return null;
  return { start: midnight / 60000 + start, end: midnight / 60000 + end + (end <= start ? 1440 : 0) };
}

export function availabilityOverlaps(left: ShiftInterval, right: ShiftInterval) {
  return left.start < right.end && right.start < left.end;
}

export function availabilityAssignmentActive(status: string | null | undefined) {
  return !['no_show_replaced', 'called_in_replacement_used', 'cancelled', 'canceled', 'removed', 'declined', 'unavailable']
    .includes(String(status || '').trim().toLowerCase());
}
