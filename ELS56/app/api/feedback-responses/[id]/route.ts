import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

async function requireSignedIn() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  return { ok: true as const, user };
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const excluded = Boolean(body.excluded_from_ratings);

  const { data, error } = await admin
    .from("client_feedback_responses")
    .update({
      excluded_from_ratings: excluded,
      excluded_reason: excluded ? cleanText(body.excluded_reason) || "Removed from rating database." : null,
      excluded_at: excluded ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("id, survey_link_id, show_id, client_id, client_contact_id, form_kind, area_name, respondent_name, respondent_title, respondent_email, request_again, testimonial_permission, testimonial_text, went_well, follow_up, additional_comments, submitted_at, excluded_from_ratings, excluded_reason, excluded_at")
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, response: data, message: excluded ? "Feedback response removed from rating database." : "Feedback response restored to rating database." });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSignedIn();
  if (!auth.ok) return auth.response;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  const { id } = await params;
  const { error } = await admin.from("client_feedback_responses").delete().eq("id", id);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, message: "Submitted feedback form deleted." });
}
