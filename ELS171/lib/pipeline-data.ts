import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { PipelineRecord, PipelineStage } from "@/lib/pipeline-types";

function asStage(value: string | null | undefined): PipelineStage {
  const allowed: PipelineStage[] = ["Inquiry", "Estimating", "Quote Sent", "Verbal Yes", "Confirmed", "Lost", "Archived"];
  return allowed.includes(value as PipelineStage) ? (value as PipelineStage) : "Inquiry";
}

export async function getPipelinePageData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      pipelineRows: [] as PipelineRecord[],
      setupMissing: true,
      tableMissing: false,
      error: null as string | null,
    };
  }

  const { data, error } = await supabase
    .from("sales_pipeline")
    .select("id, event_name, client_name, contact_name, contact_phone, contact_email, venue, city, show_start, show_end, stage, estimated_revenue, probability, next_follow_up, notes, created_at, updated_at")
    .order("next_follow_up", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  const tableMissing = Boolean(error && error.message.includes('relation "sales_pipeline" does not exist'));
  if (tableMissing) {
    return {
      pipelineRows: [] as PipelineRecord[],
      setupMissing: false,
      tableMissing: true,
      error: null as string | null,
    };
  }

  if (error) {
    return {
      pipelineRows: [] as PipelineRecord[],
      setupMissing: false,
      tableMissing: false,
      error: error.message,
    };
  }

  const pipelineRows = (data ?? []).map((row) => {
    const typed = row as Record<string, unknown>;
    return {
      id: String(typed.id),
      event_name: String(typed.event_name ?? ""),
      client_name: String(typed.client_name ?? ""),
      contact_name: String(typed.contact_name ?? ""),
      contact_phone: String(typed.contact_phone ?? ""),
      contact_email: String(typed.contact_email ?? ""),
      venue: String(typed.venue ?? ""),
      city: String(typed.city ?? ""),
      show_start: typed.show_start ? String(typed.show_start) : null,
      show_end: typed.show_end ? String(typed.show_end) : null,
      stage: asStage(String(typed.stage ?? "Inquiry")),
      estimated_revenue: Number(typed.estimated_revenue ?? 0),
      probability: Number(typed.probability ?? 0),
      next_follow_up: typed.next_follow_up ? String(typed.next_follow_up) : null,
      notes: String(typed.notes ?? ""),
      created_at: String(typed.created_at ?? ""),
      updated_at: String(typed.updated_at ?? ""),
    } as PipelineRecord;
  });

  return {
    pipelineRows,
    setupMissing: false,
    tableMissing: false,
    error: null as string | null,
  };
}
