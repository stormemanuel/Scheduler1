/** Presentation only: keep imported reference numbers intact for matching and search. */
export function areaDisplayLabel(area: string | null | undefined, booth?: string | string[] | null) {
  const original = String(area || "").trim();
  const inlineBooths = [...original.matchAll(/\bBooth\s*(?:Number|No\.?|#)?\s*:?\s*(TBD|[A-Z]*\d[A-Z0-9-]*)\b/gi)].map(match => match[1]);
  const name = original
    .replace(/\b(?:RO|PO)\s*[:#-]?\s*\d+[A-Z0-9]*(?:[.-][A-Z0-9]+)*\b/gi, " ")
    .replace(/\bBooth\s*(?:Number|No\.?|#)?\s*:?\s*(TBD|[A-Z]*\d[A-Z0-9-]*)\b/gi, " ")
    .replace(/\s+/g, " ").replace(/^[\s,;|/–—-]+|[\s,;|/–—-]+$/g, "").trim() || "Area TBD";
  const booths = [...new Set([...(Array.isArray(booth) ? booth : [booth]), ...inlineBooths]
    .map(value => String(value || "").replace(/^Booth\s*:?\s*/i, "").trim())
    .filter(value => value && !/^(TBD|N\/A|unknown)$/i.test(value)))];
  return booths.length ? `${name} · ${booths.length === 1 ? "Booth" : "Booths"} ${booths.join(" / ")}` : name;
}
