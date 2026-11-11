type LocationShow = { venue?: string | null; event_location?: string | null; rate_city?: string | null };
type LocationCall = { location?: string | null };
const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

export function workLocation(show: LocationShow, call: LocationCall) {
  const override = clean(call.location);
  if (override) return override;
  const venue = clean(show.venue), address = clean(show.event_location);
  return venue && address && venue.toLowerCase() !== address.toLowerCase()
    ? `${venue} — ${address}` : venue || address || clean(show.rate_city) || "Location TBD — confirm with coordinator";
}

export function workLocationLine(show: LocationShow, call: LocationCall) {
  return `WORK LOCATION: ${workLocation(show, call)}`;
}

export function scheduleLocationSummary(locations: string[]) {
  const unique = [...new Map(locations.map(location => [clean(location).toLowerCase(), clean(location)])).values()].filter(Boolean);
  const multiple = unique.length > 1;
  return {
    multiple,
    venue: multiple ? "MULTIPLE WORK LOCATIONS — see each shift below" : unique[0] || "Location TBD",
    location: multiple ? "***** WORK LOCATION CHANGES BY SHIFT *****\nReport to the WORK LOCATION listed under each date and shift." : `WORK LOCATION: ${unique[0] || "Location TBD"}`,
  };
}

export function workMeetup(show: LocationShow, call: LocationCall, defaultMeetup: string, boothMeetup = "") {
  if (boothMeetup) return boothMeetup;
  // The event's usual meeting point may belong to a different venue.
  if (clean(call.location) && workLocation(show, call).toLowerCase() !== workLocation(show, {}).toLowerCase()) return "Confirm the meeting point at this work location with your coordinator";
  return defaultMeetup;
}

/** Saved schedule templates used to repeat the full venue/address in the greeting. */
export function normalizeScheduleLocationGreeting(template: string) {
  if (!/\{location\}/i.test(template)) return template;
  return template.replace(/(\{show_name\})[ \t]*@[ \t]*\{venue\}/gi, "$1");
}

export function normalizeReminderLocationGreeting(template: string) {
  if (!/\{next_call_sentence\}|\{location\}/i.test(template)) return template;
  return template.replace(/(\{show_name\})[ \t]+at[ \t]+\{venue\}/gi, "$1")
    .replace(/(\{next_call_sentence\})\s+(\{meet_up_section\})/gi, "$1\n\n$2")
    .replace(/(\{meet_up_section\})\s+(\{booth_line\})/gi, "$1\n\n$2");
}

export function formatReminderDetails(value: string) {
  let text = value
    .replace(/^(?:Call|Your Shift):[ \t]*(?:\n[ \t]*)*/gim, "Your Shift: ")
    .replace(/\n[ \t]*((?:Location|Meet-up|Area|Your assigned area):)/gi, "\n\n$1")
    .replace(/^[ \t]*(?:Tools:[ \t]*)?Please bring (?:a )?(?:screwdriver|skrewdriver) and (?:a )?(?:crescent|cresent) wrench\.[ \t]*$/gim, "")
    .replace(/\n{3,}/g, "\n\n").trim();
  const tools = "Please bring a screwdriver and crescent wrench.";
  const confirmation = /\n*(Please reply confirmed\.|See you soon\. Please confirm\.|Please confirm\.|Please text me here when you arrive at the meet-up location\.)/i;
  text = confirmation.test(text) ? text.replace(confirmation, `\n\n${tools}\n\n$1`) : `${text}\n\n${tools}`;
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
