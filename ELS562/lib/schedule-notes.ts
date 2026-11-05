const defaultAttire = "Attire: Black polo, black pants, and black shoes. Please arrive clean, well-groomed, and professionally presented.";

/** Keep schedule instructions together, including when an older saved template is used. */
export function compactScheduleNotes(value: string) {
  let attire = defaultAttire;
  const text = value
    .replace(/^[ \t]*[★*•-]*[ \t]*IMPORTANT NOTES[ \t]*[★*]*[ \t]*$/gim, "")
    .replace(/^[ \t]*[•*-]?[ \t]*Dates and times are subject to change\.[ \t]*$/gim, "")
    .replace(/^[ \t]*[•*-]?[ \t]*If anyone is 15 minutes late or more, that shift will be paid hourly\.[ \t]*$/gim, "")
    .replace(/^[ \t]*[•*-]?[ \t]*(Attire:[^\n\r]*)/gim, (_line, current: string) => { attire = current.trim(); return ""; })
    .replace(/^[ \t]*[•*-]?[ \t]*Please bring (?:a )?(?:screwdriver|skrewdriver), (?:a )?(?:crescent|cresent) wrench, and (?:a set of )?Allen keys(?:,? please)?\.[ \t]*$/gim, "")
    .replace(/\n(?:[ \t]*\n){2,}/g, "\n\n").trim();
  const block = [
    "★ IMPORTANT NOTES",
    "• Dates and times are subject to change.",
    "• If anyone is 15 minutes late or more, that shift will be paid hourly.",
    `• ${attire}`,
    "• Please bring a screwdriver, crescent wrench, and Allen keys.",
  ].join("\n");
  const confirmation = /(?:\n[ \t]*)*Please confirm\.\s*$/i;
  return confirmation.test(text)
    ? text.replace(confirmation, `\n\n${block}\n\nPlease confirm.`).trim()
    : `${text}\n\n${block}`.trim();
}
