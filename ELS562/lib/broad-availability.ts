function validDate(value: string) {
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}
export function availabilityDateRange(start: string, end: string) {
  if (!validDate(start) || !validDate(end) || end < start) throw new Error("Choose valid start and end dates, with the end on or after the start.");
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 365) throw new Error("Choose a date range of no more than one year.");
  const format = (date: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  return { start, end, label: start === end ? format(start) : `${format(start)} through ${format(end)}` };
}
export function broadAvailabilityRate(value: string) {
  const match = value.trim().match(/^\$?(\d+(?:\.\d{1,2})?)(?:\s*\/\s*(?:hr|hour))?$/i);
  const rate = Number(match?.[1]);
  if (!match || !Number.isFinite(rate) || rate <= 0) throw new Error("Choose a valid hourly rate for the date-range inquiry.");
  return `$${Number.isInteger(rate) ? rate : rate.toFixed(2)}/hr`;
}
export function broadAvailabilityEventLabel(name: string, reference: string) {
  return reference && !name.toLowerCase().startsWith(reference.toLowerCase()) ? `${reference} | ${name}` : name || reference || "ELS event";
}
export function broadAvailabilityMessage(args: { firstName: string; event: string; location: string; rate: string; start: string; end: string; position?: string; coordinator: string }) {
  const range = availabilityDateRange(args.start, args.end);
  return [
    `Hello ${args.firstName}, are you available for any of these days?`, "",
    `Event: ${args.event}`, `Location: ${args.location || "Confirm with coordinator"}`,
    ...(args.position ? [`Position: ${args.position}`] : []), `Rate: ${args.rate}`, "",
    `Dates: ${range.label}`, "", "Please reply with the dates you are available to work.", "",
    `Coordinator: ${args.coordinator}`, "Emanuel Labor Services.",
  ].join("\n");
}
