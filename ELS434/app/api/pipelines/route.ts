import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";
import type { PipelineStage } from "@/lib/pipeline-types";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

const stages: PipelineStage[] = ["Inquiry", "Estimating", "Quote Sent", "Verbal Yes", "Confirmed", "Lost", "Archived"];
function cleanStage(value: unknown): PipelineStage {
  return stages.includes(value as PipelineStage) ? (value as PipelineStage) : "Inquiry";
}

function cleanPayload(body: Record<string, unknown>) {
  const estimated = Number(body.estimated_revenue || 0);
  const probability = Number(body.probability || 0);
  return {
    event_name: String(body.event_name || "").trim(),
    client_name: String(body.client_name || "").trim(),
    contact_name: String(body.contact_name || "").trim() || null,
    contact_phone: String(body.contact_phone || "").trim() || null,
    contact_email: String(body.contact_email || "").trim() || null,
    venue: String(body.venue || "").trim() || null,
    city: String(body.city || "").trim() || null,
    show_start: String(body.show_start || "").trim() || null,
    show_end: String(body.show_end || "").trim() || null,
    stage: cleanStage(body.stage),
    estimated_revenue: Number.isFinite(estimated) ? estimated : 0,
    probability: Number.isFinite(probability) ? Math.min(100, Math.max(0, probability)) : 0,
    next_follow_up: String(body.next_follow_up || "").trim() || null,
    notes: String(body.notes || "").trim() || null,
    updated_at: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  const body = await request.json();
  const payload = cleanPayload(body);
  if (!payload.event_name || !payload.client_name) {
    return NextResponse.json({ message: "Event/show name and client are required." }, { status: 400 });
  }
  const { data, error } = await admin
    .from("sales_pipeline")
    .insert(payload)
    .select("id, event_name, client_name, contact_name, contact_phone, contact_email, venue, city, show_start, show_end, stage, estimated_revenue, probability, next_follow_up, notes, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, row: data, message: "Pipeline item saved." });
}
