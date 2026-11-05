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
  if (clean(call.location) && workLocation(show, call).toLowerCase() !== workLocation(show, {}).toLowerCase()) return `At ${workLocation(show, call)} — confirm the exact meeting point with your coordinator`;
  return defaultMeetup;
}

/** Saved schedule templates used to repeat the full venue/address in the greeting. */
export function normalizeScheduleLocationGreeting(template: string) {
  if (!/\{location\}/i.test(template)) return template;
  return template.replace(/(\{show_name\})[ \t]*@[ \t]*\{venue\}/gi, "$1");
}
