/** Remove the retired filler sentence from defaults and previously saved messages. */
export function cleanAvailabilityMessage(value: string) {
  return value
    .replace(/^[ \t]*(?:Position|Area):[ \t]*See position details below[ \t]*\r?\n?/gim, "")
    .replace(/I have some days in between this span that I am looking to book for December\.[ \t]*/gi, "")
    .replace(/I have some days in between that range that I am booking\.[ \t]*/gi, "")
    .replace(/I have some days between those dates I[’']m looking to get filled\.[ \t]*/gi, "")
    .replace(/^([ \t]*Rate:[^\r\n]*)\r?\n(?:[ \t]*\r?\n)*([ \t]*Checking[ \t]+Availability(?:[ \t]+for these dates)?[ \t]*:)/gim, "$1\n\n$2")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatAvailabilityGroups(rows: Array<{ position: string; area: string; line: string }>) {
  const groups = new Map<string, { position: string; area: string; lines: string[] }>();
  for (const row of rows) {
    const key = `${row.position.trim().toLowerCase()}|${row.area.trim().toLowerCase()}`;
    const group = groups.get(key) || { position: row.position, area: row.area, lines: [] };
    group.lines.push(row.line);
    groups.set(key, group);
  }
  if (groups.size <= 1) return rows.map(row => row.line).join("\n");
  return [...groups.values()].map(group => [
    `Position: ${group.position || "Crew"}`,
    ...(group.area ? [`Area: ${group.area}`] : []),
    ...group.lines,
  ].join("\n")).join("\n\n");
}
