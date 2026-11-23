export type CallNextEntry = { id: string; crew_id: string; created_by: string; created_at: string; note: string };
const marker = /\[\[ELS_CALL_NEXT:([^\]]*)\]\]/gi;
export function stripCallNext(notes?: string | null) {
  return String(notes || "").replace(marker, "").replace(/\n{3,}/g, "\n\n").trim();
}
export function readCallNext(notes?: string | null): CallNextEntry[] {
  const encoded = /\[\[ELS_CALL_NEXT:([^\]]*)\]\]/i.exec(String(notes || ""))?.[1];
  if (!encoded) return [];
  try {
    const rows: unknown = JSON.parse(decodeURIComponent(encoded));
    return Array.isArray(rows) ? rows.filter((row): row is CallNextEntry => row && typeof row.id === "string" && typeof row.crew_id === "string" && typeof row.created_by === "string" && typeof row.created_at === "string" && typeof row.note === "string") : [];
  } catch { return []; }
}
export function notesWithCallNext(notes: string | null | undefined, entries: CallNextEntry[]) {
  return [stripCallNext(notes), entries.length ? `[[ELS_CALL_NEXT:${encodeURIComponent(JSON.stringify(entries))}]]` : ""].filter(Boolean).join("\n");
}
export function editCallNext(entries: CallNextEntry[], actor: string, owner: boolean, action: string, entryId: string, added?: CallNextEntry) {
  if (action === "add") {
    if (!added || added.created_by !== actor || !added.crew_id) throw new Error("Choose a crew member.");
    return entries.some(entry => entry.crew_id === added.crew_id && entry.created_by === actor) ? entries : [...entries, added];
  }
  const index = entries.findIndex(entry => entry.id === entryId);
  if (index < 0) throw new Error("This Call Next entry changed. Refresh the list.");
  if (!owner && entries[index].created_by !== actor) throw new Error("You can only change your own Call Next entries.");
  if (action === "remove") return entries.filter(entry => entry.id !== entryId);
  if (action !== "up" && action !== "down") throw new Error("Invalid Call Next action.");
  const visible = entries.map((entry, i) => ({entry,i})).filter(({entry}) => owner || entry.created_by === actor);
  const target = visible[visible.findIndex(item => item.i === index) + (action === "up" ? -1 : 1)]?.i;
  if (target == null) return entries;
  const next = [...entries];[next[index],next[target]]=[next[target],next[index]];return next;
}
