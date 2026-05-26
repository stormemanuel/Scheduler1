import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { BusinessClientRecord, ClientContactRecord, TechRatingRecord } from "@/lib/client-types";

function clientContactTypeFromTitle(title: string | null | undefined) {
  const value = String(title || "").toLowerCase();
  if (value.includes("booth") || value.includes("area")) return "booth-manager" as const;
  if (value.includes("project manager") || value === "pm" || value.includes("producer")) return "project-manager" as const;
  if (value.includes("tech") || value.includes("technician") || value.includes("engineer")) return "client-tech" as const;
  return "labor-coordinator" as const;
}

export async function getClientDirectoryData() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      businessClients: [] as BusinessClientRecord[],
      clientContacts: [] as ClientContactRecord[],
      techRatings: [] as TechRatingRecord[],
      setupMissing: true,
      error: null as string | null,
    };
  }

  const [clientsRes, contactsRes] = await Promise.all([
    supabase.from("business_clients").select("*").order("name", { ascending: true }),
    supabase.from("client_contacts").select("*").order("name", { ascending: true }),
  ]);

  const ratingsResInitial = await supabase
    .from("tech_ratings")
    .select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at")
    .order("updated_at", { ascending: false });
  const ratingContactColumnMissing = Boolean(ratingsResInitial.error && ratingsResInitial.error.message.includes("client_contact_id"));
  const ratingsRes = ratingContactColumnMissing
    ? await supabase.from("tech_ratings").select("id, show_id, client_id, crew_id, assignment_id, rating, notes, created_at, updated_at").order("updated_at", { ascending: false })
    : ratingsResInitial;

  const feedbackRatingsRes = await supabase
    .from("client_feedback_top_tech_ratings")
    .select("id, show_id, client_id, client_contact_id, crew_id, assignment_id, rating, notes, created_at, updated_at, rating_source")
    .order("updated_at", { ascending: false });

  const clientsMissing = Boolean(clientsRes.error && clientsRes.error.message.includes('relation "business_clients" does not exist'));
  const contactsMissing = Boolean(contactsRes.error && contactsRes.error.message.includes('relation "client_contacts" does not exist'));
  const ratingsMissing = Boolean(ratingsRes.error && ratingsRes.error.message.includes('relation "tech_ratings" does not exist'));
  const feedbackRatingsMissing = Boolean(feedbackRatingsRes.error && (feedbackRatingsRes.error.message.includes('relation "client_feedback_top_tech_ratings" does not exist') || feedbackRatingsRes.error.message.includes('client_feedback_top_tech_ratings') || feedbackRatingsRes.error.message.includes('schema cache')));
  const error = (clientsMissing ? null : clientsRes.error) || (contactsMissing ? null : contactsRes.error) || (ratingsMissing ? null : ratingsRes.error) || (feedbackRatingsMissing ? null : feedbackRatingsRes.error);

  if (error) {
    return {
      businessClients: [] as BusinessClientRecord[],
      clientContacts: [] as ClientContactRecord[],
      techRatings: [] as TechRatingRecord[],
      setupMissing: false,
      error: error.message,
    };
  }

  const businessClients = clientsMissing ? [] : (clientsRes.data ?? []).map((row) => {
    const typed = row as Partial<BusinessClientRecord> & { id: string };
    return {
      id: typed.id,
      name: typed.name || "",
      legal_company_name: typed.legal_company_name || "",
      billing_address: typed.billing_address || "",
      billing_city: typed.billing_city || "",
      billing_state: typed.billing_state || "",
      billing_zip: typed.billing_zip || "",
      main_phone: typed.main_phone || "",
      main_email: typed.main_email || "",
      website: typed.website || "",
      default_rate_city: typed.default_rate_city || "Default",
      default_market_notes: typed.default_market_notes || "",
      notes: typed.notes || "",
      ap_contact_name: typed.ap_contact_name || "",
      ap_email: typed.ap_email || "",
      ap_phone: typed.ap_phone || "",
      payment_terms: typed.payment_terms || "",
      po_required: typeof typed.po_required === "boolean" ? typed.po_required : null,
      w9_coi_notes: typed.w9_coi_notes || "",
      default_invoice_email: typed.default_invoice_email || "",
      billing_notes: typed.billing_notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
    } satisfies BusinessClientRecord;
  });

  const clientContacts = contactsMissing ? [] : (contactsRes.data ?? []).map((row) => {
    const typed = row as Partial<ClientContactRecord> & { id: string; client_id: string };
    return {
      id: typed.id,
      client_id: typed.client_id,
      name: typed.name || "",
      title: typed.title || "",
      email: typed.email || "",
      phone: typed.phone || "",
      cell_phone: typed.cell_phone || "",
      notes: typed.notes || "",
      contact_type: typed.contact_type || clientContactTypeFromTitle(typed.title),
      is_primary: Boolean(typed.is_primary),
      is_onsite_contact: Boolean(typed.is_onsite_contact),
      is_billing_contact: Boolean(typed.is_billing_contact),
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
    } satisfies ClientContactRecord;
  });

  const adminRatings = ratingsMissing ? [] : (ratingsRes.data ?? []).map((row) => {
    const typed = row as Partial<TechRatingRecord> & { id: string; show_id: string; crew_id: string };
    return {
      id: typed.id,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      rating: Number(typed.rating || 0),
      notes: typed.notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
      rating_source: "admin",
    } satisfies TechRatingRecord;
  });

  const feedbackRatings = feedbackRatingsMissing ? [] : (feedbackRatingsRes.data ?? []).map((row) => {
    const typed = row as Partial<TechRatingRecord> & { id: string; show_id: string; crew_id: string };
    return {
      id: `feedback-${typed.id}`,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      client_contact_id: typed.client_contact_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      rating: Number(typed.rating || 0),
      notes: typed.notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
      rating_source: typed.rating_source || "client_feedback",
    } satisfies TechRatingRecord;
  });

  const techRatings = [...adminRatings, ...feedbackRatings];

  return {
    businessClients,
    clientContacts,
    techRatings,
    setupMissing: false,
    error: null as string | null,
  };
}
