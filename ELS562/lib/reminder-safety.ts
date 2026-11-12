type Reminder = { sent_at?: string | null; scheduled_for?: string | null; reminder_key?: string | null; body?: string | null };

/** Check original intent before rebuilding a queue row, and check the rebuilt row again. */
export function reminderSendBlockReason(row: Reminder, timezone = "America/Chicago", now = new Date()) {
  if (row.sent_at) return "Blocked duplicate reminder: it already has a sent timestamp.";
  const localDate = (value: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const part = (type: string) => parts.find(item => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const target = String(row.reminder_key || "").match(/(?:^|_)(20\d{2}-\d{2}-\d{2})(?:$|_)/)?.[1];
  if (!target) return "Blocked reminder: its original shift date is missing. Regenerate reminders from the current schedule.";
  const today = localDate(now);
  const scheduled = new Date(row.scheduled_for || "");
  if (!Number.isFinite(scheduled.getTime())) return "Blocked reminder: its scheduled delivery time is invalid.";
  if (localDate(scheduled) < today) return "Expired reminder: its intended delivery day has passed. Old reminders cannot carry over to another day.";
  if (target < today) return `Expired reminder: the ${target} shift date is already past.`;

  // A key must never authorize a body that still describes a different shift.
  const shiftLine = String(row.body || "").match(/^(?:Your Shift|Call):\s*([^\n]+)/im)?.[1];
  if (shiftLine) {
    const [year, month, day] = target.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const tokens = [target, `${month}/${day}/${String(year).slice(2)}`, `${month}/${day}/${year}`,
      ...["long", "short"].map(length => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: length as "long" | "short", day: "numeric" }).format(date))];
    const lineDate = shiftLine.split(/\s*[·|–—]\s*/)[0].trim().toLowerCase();
    if (!tokens.some(token => lineDate === token.toLowerCase())) return "Blocked reminder: the shift date in its message does not match its original reminder date.";
  }
  return "";
}
