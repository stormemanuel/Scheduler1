const normalized = (value: unknown) => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const compact = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, "");

/** Match only fields already available to the current user's event view. */
export function matchesEventCallSearch(query: string, fields: Array<string | null | undefined>) {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  const text = fields.map(normalized).join(" ");
  const joined = compact(text);
  return terms.every(term => text.includes(term) || Boolean(compact(term) && joined.includes(compact(term))));
}
