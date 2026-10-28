import type { TechRatingRecord } from "@/lib/client-types";

export function summarizeCrewRatings(ratings: TechRatingRecord[]) {
  const valid = ratings.filter((row) => Number.isFinite(row.rating) && row.rating >= 1 && row.rating <= 5);
  const summary = (rows: TechRatingRecord[]) => ({ count: rows.length, average: rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : null });
  const els = valid.filter((row) => row.rating_source !== "client_feedback");
  const client = valid.filter((row) => row.rating_source === "client_feedback");
  const byClient = new Map<string, TechRatingRecord[]>();
  for (const row of client) {
    const key = row.client_id || "";
    byClient.set(key, [...(byClient.get(key) || []), row]);
  }
  return { overall: summary(valid), els: summary(els), clients: [...byClient].map(([clientId, rows]) => ({ clientId, ...summary(rows) })) };
}
