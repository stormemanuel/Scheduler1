import { NextResponse } from "next/server";
import crypto from "crypto";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeRole(role: string | null | undefined) {
  const value = String(role || "viewer").toLowerCase().trim();
  if (["owner", "admin", "coordinator", "salesman", "sales", "viewer"].includes(value)) return value === "sales" ? "salesman" : value;
  return "viewer";
}

function isOwnerAdmin(role: string) {
  return role === "owner" || role === "admin";
}

function cleanPhone(value: string | null | undefined) {
  const raw = String(value || "");
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return digits ? `+${digits}` : "";
}

function splitList(value: unknown) {
  return safeText(value).split(/\n|,|;/).map((item) => item.trim()).filter(Boolean);
}

function appBaseUrl(request: Request) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "";
  if (envUrl) return envUrl.startsWith("http") ? envUrl.replace(/\/+$/, "") : `https://${envUrl.replace(/\/+$/, "")}`;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function requireOwnerAdmin() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, response: NextResponse.json({ message: "Supabase is not configured." }, { status: 500 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ message: "Unauthorized." }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = normalizeRole((profile as { role?: string | null } | null)?.role);
  if (!isOwnerAdmin(role)) return { ok: false as const, response: NextResponse.json({ message: "Only owner/admin can create onboarding links." }, { status: 403 }) };
  return { ok: true as const, user };
}

async function insertIntroQueue(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, row: Record<string, unknown>) {
  const withSender = await admin.from("crew_intro_text_queue").insert(row).select("id, crew_id, crew_name, phone, body, status, scheduled_for, created_at").single();
  if (!withSender.error) return withSender.data;
  const message = withSender.error.message || "";
  if (!(message.includes("queued_by_user_id") || message.includes("queued_by_email") || message.includes("queued_by_name") || message.includes("schema cache"))) throw new Error(message);
  const { queued_by_user_id, queued_by_email, queued_by_name, ...legacyRow } = row;
  const legacy = await admin.from("crew_intro_text_queue").insert(legacyRow).select("id, crew_id, crew_name, phone, body, status, scheduled_for, created_at").single();
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.data;
}

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ message: "SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });

  try {
    const body = await request.json();
    const action = safeText(body.action);

    if (action === "create_request") {
      const auth = await requireOwnerAdmin();
      if (!auth.ok) return auth.response;

      const crewId = safeText(body.crew_id);
      if (!crewId) return NextResponse.json({ message: "crew_id is required." }, { status: 400 });

      const { data: crew, error: crewError } = await admin.from("crew").select("id, name, phone, email").eq("id", crewId).maybeSingle();
      if (crewError) throw new Error(crewError.message);
      if (!crew) return NextResponse.json({ message: "Crew contact not found." }, { status: 404 });

      const token = crypto.randomBytes(32).toString("base64url");
      const nowIso = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

      const { data: requestRow, error: requestError } = await admin
        .from("crew_onboarding_requests")
        .insert({ crew_id: crewId, token, status: "sent", sent_by: auth.user.id, sent_at: nowIso, expires_at: expiresAt, created_at: nowIso, updated_at: nowIso })
        .select("id, crew_id, token, status, sent_at, expires_at")
        .single();

      if (requestError) {
        if ((requestError.message || "").includes("crew_onboarding_requests")) {
          return NextResponse.json({ message: "Run ELS210_required_sql.sql once in Supabase to create crew_onboarding_requests." }, { status: 400 });
        }
        throw new Error(requestError.message);
      }

      await admin.from("crew").update({
        onboarding_status: "request_sent",
        questionnaire_status: "requested",
        w9_status: "requested",
        contract_status: "requested",
        onboarding_request_sent_at: nowIso,
        updated_at: nowIso,
      }).eq("id", crewId);

      const link = `${appBaseUrl(request)}/onboarding/${token}`;
      const crewName = safeText((crew as { name?: string | null }).name) || "there";
      const firstName = crewName.split(/\s+/)[0] || "there";
      const phone = cleanPhone((crew as { phone?: string | null }).phone);
      const messageBody = [
        `Hi ${firstName}, this is Storm with Emanuel Labor Services.`,
        "Please complete your secure onboarding packet using this link:",
        link,
        "Please do not send your SSN, EIN, or tax information by regular text or email. Use the secure form only. Thank you.",
      ].join("\n\n");

      let queued = null as unknown;
      if (phone && body.queue_text !== false) {
        queued = await insertIntroQueue(admin, {
          queued_by_user_id: auth.user.id,
          queued_by_email: auth.user.email || null,
          queued_by_name: auth.user.email || null,
          crew_id: crewId,
          crew_name: crewName,
          phone,
          body: messageBody,
          status: "scheduled",
          scheduled_for: new Date(Date.now() + 30_000).toISOString(),
          created_at: nowIso,
          error: null,
        });
      }

      return NextResponse.json({ ok: true, link, request: requestRow, queued, message: queued ? "Onboarding request link created and queued for the iPhone Shortcut." : "Onboarding request link created. No text was queued because this contact has no valid phone number." });
    }

    if (action === "submit") {
      const token = safeText(body.token);
      if (!token) return NextResponse.json({ message: "Missing onboarding token." }, { status: 400 });

      const { data: requestRow, error: requestError } = await admin.from("crew_onboarding_requests").select("id, crew_id, status, expires_at").eq("token", token).maybeSingle();
      if (requestError) {
        if ((requestError.message || "").includes("crew_onboarding_requests")) return NextResponse.json({ message: "Onboarding requests table is missing. Run ELS210_required_sql.sql." }, { status: 400 });
        throw new Error(requestError.message);
      }
      if (!requestRow) return NextResponse.json({ message: "This onboarding link is invalid." }, { status: 404 });

      const expiresAt = safeText((requestRow as { expires_at?: string | null }).expires_at);
      if (expiresAt && new Date(expiresAt).getTime() < Date.now()) return NextResponse.json({ message: "This onboarding link has expired. Please ask ELS for a new link." }, { status: 410 });

      const crewId = safeText((requestRow as { crew_id?: string | null }).crew_id);
      const currentCrewRes = await admin.from("crew").select("notes").eq("id", crewId).maybeSingle();
      if (currentCrewRes.error) throw new Error(currentCrewRes.error.message);

      const submittedAt = new Date().toISOString();
      const payload = {
        legal_name: safeText(body.legal_name),
        preferred_name: safeText(body.preferred_name),
        phone: safeText(body.phone),
        email: safeText(body.email),
        address: safeText(body.address),
        emergency_contact_name: safeText(body.emergency_contact_name),
        emergency_contact_phone: safeText(body.emergency_contact_phone),
        city_state: safeText(body.city_state),
        positions: splitList(body.positions),
        skills: safeText(body.skills),
        equipment_experience: safeText(body.equipment_experience),
        travel_availability: safeText(body.travel_availability),
        hotel_flight_willing: safeText(body.hotel_flight_willing),
        profile_photo_note: safeText(body.profile_photo_note),
        work_photo_note: safeText(body.work_photo_note),
        w9_status_note: safeText(body.w9_status_note),
        contract_acknowledged: Boolean(body.contract_acknowledged),
        submitted_at: submittedAt,
      };

      const existingNotes = safeText((currentCrewRes.data as { notes?: string | null } | null)?.notes);
      const onboardingNote = [
        "[[ELS_ONBOARDING_SUBMISSION]]",
        `Submitted: ${payload.submitted_at}`,
        payload.legal_name ? `Legal name: ${payload.legal_name}` : "",
        payload.preferred_name ? `Preferred name: ${payload.preferred_name}` : "",
        payload.city_state ? `City/State: ${payload.city_state}` : "",
        payload.emergency_contact_name || payload.emergency_contact_phone ? `Emergency contact: ${[payload.emergency_contact_name, payload.emergency_contact_phone].filter(Boolean).join(" - ")}` : "",
        payload.positions.length ? `Requested positions: ${payload.positions.join(", ")}` : "",
        payload.travel_availability ? `Travel availability: ${payload.travel_availability}` : "",
        payload.hotel_flight_willing ? `Hotel/flight willingness: ${payload.hotel_flight_willing}` : "",
        payload.skills ? `Skills: ${payload.skills}` : "",
        payload.equipment_experience ? `Equipment: ${payload.equipment_experience}` : "",
        payload.profile_photo_note ? `Profile photo note: ${payload.profile_photo_note}` : "",
        payload.work_photo_note ? `Work photo note: ${payload.work_photo_note}` : "",
        payload.w9_status_note ? `W-9 note: ${payload.w9_status_note}` : "",
        payload.contract_acknowledged ? "Contract acknowledgement: checked" : "",
        "[[/ELS_ONBOARDING_SUBMISSION]]",
      ].filter(Boolean).join("\n");

      const updatePayload: Record<string, unknown> = {
        onboarding_status: "submitted",
        questionnaire_status: "uploaded",
        tax_profile_status: payload.w9_status_note ? "needs_review" : "missing",
        onboarding_completed_at: payload.submitted_at,
        notes: [existingNotes, onboardingNote].filter(Boolean).join("\n\n"),
        updated_at: payload.submitted_at,
      };
      if (payload.phone) updatePayload.phone = payload.phone;
      if (payload.email) updatePayload.email = payload.email;
      if (payload.address) updatePayload.address = payload.address;

      const { error: updateError } = await admin.from("crew").update(updatePayload).eq("id", crewId);
      if (updateError) throw new Error(updateError.message);

      const { error: requestUpdateError } = await admin.from("crew_onboarding_requests").update({ status: "submitted", submitted_at: payload.submitted_at, submission_payload: payload, updated_at: payload.submitted_at }).eq("id", safeText((requestRow as { id?: string | null }).id));
      if (requestUpdateError) throw new Error(requestUpdateError.message);

      const audit = await admin.from("crew_onboarding_audit_log").insert({ crew_id: crewId, action: "onboarding_submitted", details: payload, created_at: payload.submitted_at });
      if (audit.error && !(audit.error.message || "").includes("crew_onboarding_audit_log")) throw new Error(audit.error.message);

      return NextResponse.json({ ok: true, message: "Onboarding submitted. Emanuel Labor Services will review your information." });
    }

    return NextResponse.json({ message: "Unsupported onboarding action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Unable to process onboarding request." }, { status: 400 });
  }
}
