import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthItem = { name: string; ok: boolean; message?: string };

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function friendlyError(error: unknown) {
  if (!error || typeof error !== "object") return "Not available.";
  const message = "message" in error ? String((error as { message?: unknown }).message || "") : "";
  if (!message) return "Not available.";
  if (message.includes("schema cache")) return "Missing from Supabase schema cache. Run the feedback SQL, then notify pgrst reload.";
  if (message.includes("does not exist") || message.includes("not exist")) return "Missing in Supabase. Run the feedback SQL migration.";
  return message;
}

export async function GET(request: Request) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const url = new URL(request.url);
  const showId = url.searchParams.get("show_id") || "";

  const relationChecks = [
    ["feedback_survey_links", "feedback_survey_links"],
    ["client_feedback_responses", "client_feedback_responses"],
    ["client_feedback_scores", "client_feedback_scores"],
    ["feedback_tech_ratings", "feedback_tech_ratings"],
    ["client_feedback_top_tech_ratings view", "client_feedback_top_tech_ratings"],
  ] as const;

  const tables: HealthItem[] = [];
  for (const [label, relation] of relationChecks) {
    const { error } = await admin.from(relation).select("id", { count: "exact", head: true });
    tables.push({ name: label, ok: !error, message: error ? friendlyError(error) : undefined });
  }

  let selectedShow: {
    id: string;
    submitted_responses: number;
    pending_responses: number;
    approved_responses: number;
    excluded_responses: number;
    submitted_tech_ratings: number;
    approved_tech_ratings: number;
  } | undefined;

  if (showId) {
    const [submitted, pending, approved, excluded, submittedTech, approvedTech] = await Promise.all([
      admin.from("client_feedback_responses").select("id", { count: "exact", head: true }).eq("show_id", showId),
      admin.from("client_feedback_responses").select("id", { count: "exact", head: true }).eq("show_id", showId).eq("rating_approved", false).eq("excluded_from_ratings", false),
      admin.from("client_feedback_responses").select("id", { count: "exact", head: true }).eq("show_id", showId).eq("rating_approved", true).eq("excluded_from_ratings", false),
      admin.from("client_feedback_responses").select("id", { count: "exact", head: true }).eq("show_id", showId).eq("excluded_from_ratings", true),
      admin.from("feedback_tech_ratings").select("id", { count: "exact", head: true }).eq("show_id", showId),
      admin.from("client_feedback_top_tech_ratings").select("id", { count: "exact", head: true }).eq("show_id", showId),
    ]);
    selectedShow = {
      id: showId,
      submitted_responses: submitted.count || 0,
      pending_responses: pending.count || 0,
      approved_responses: approved.count || 0,
      excluded_responses: excluded.count || 0,
      submitted_tech_ratings: submittedTech.count || 0,
      approved_tech_ratings: approvedTech.count || 0,
    };
  }

  const ok = tables.every((item) => item.ok);
  return NextResponse.json({
    ok,
    checked_at: new Date().toISOString(),
    tables,
    selected_show: selectedShow,
    message: ok ? "Feedback tables and rating view are reachable." : "One or more feedback tables/views are missing or blocked.",
  });
}
