import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSessionUser, normalizeRole } from "@/lib/auth";
import type { AppUserSummaryRecord, BusinessClientRecord, ClientCityRateOverrideRecord, ClientContactRecord, TechRatingRecord } from "@/lib/client-types";
import type { CityPoolRecord } from "@/lib/crew-types";
import type { ClientRateRecord } from "@/lib/rates-types";

function clientContactTypeFromTitle(title: string | null | undefined) {
  const value = String(title || "").toLowerCase();
  if (value.includes("booth") || value.includes("area")) return "booth-manager" as const;
  if (value.includes("project manager") || value === "pm" || value.includes("producer")) return "project-manager" as const;
  if (value.includes("tech") || value.includes("technician") || value.includes("engineer")) return "client-tech" as const;
  return "labor-coordinator" as const;
}

export async function getClientDirectoryData() {
  const session = await getSessionUser();
  const role = normalizeRole(session.profile?.role as string | null | undefined);
  const restrictToOwnClients = Boolean(role === "coordinator" && session.user?.id);
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      businessClients: [] as BusinessClientRecord[],
      clientContacts: [] as ClientContactRecord[],
      techRatings: [] as TechRatingRecord[],
      appUsers: [] as AppUserSummaryRecord[],
      cityPools: [] as CityPoolRecord[],
      clientRates: [] as ClientRateRecord[],
      clientRateOverrides: [] as ClientCityRateOverrideRecord[],
      clientRateOverridesMissing: false,
      setupMissing: true,
      error: null as string | null,
    };
  }

  const clientsResInitial = await supabase
    .from("business_clients")
    .select("id, name, legal_company_name, billing_address, billing_city, billing_state, billing_zip, main_phone, main_email, website, default_rate_city, default_market_notes, notes, ap_contact_name, ap_email, ap_phone, payment_terms, po_required, w9_coi_notes, default_invoice_email, billing_notes, created_at, updated_at, created_by")
    .order("name", { ascending: true });
  const clientCreatedByMissing = Boolean(clientsResInitial.error && clientsResInitial.error.message.includes("created_by"));
  const clientsRes = clientCreatedByMissing
    ? await supabase.from("business_clients").select("id, name, legal_company_name, billing_address, billing_city, billing_state, billing_zip, main_phone, main_email, website, default_rate_city, default_market_notes, notes, ap_contact_name, ap_email, ap_phone, payment_terms, po_required, w9_coi_notes, default_invoice_email, billing_notes, created_at, updated_at").order("name", { ascending: true })
    : clientsResInitial;

  const [contactsRes, usersRes, cityPoolsRes, clientRatesRes, clientRateOverridesRes] = await Promise.all([
    supabase.from("client_contacts").select("id, client_id, name, title, email, phone, cell_phone, notes, contact_type, created_by, is_primary, is_onsite_contact, is_billing_contact, created_at, updated_at").order("name", { ascending: true }),
    supabase.from("profiles").select("id, email, full_name, role, is_active"),
    supabase.from("city_pools").select("id, name").order("name", { ascending: true }),
    supabase.from("client_rates").select("id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier").order("city_name", { ascending: true }).order("role_name", { ascending: true }),
    supabase.from("client_rate_overrides").select("id, client_id, city_name, role_name, full_day, half_day, overtime_multiplier, doubletime_multiplier, created_at, updated_at").order("city_name", { ascending: true }).order("role_name", { ascending: true }),
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
  const clientRatesMissing = Boolean(clientRatesRes.error && (/client_rates|schema cache|relation/i.test(clientRatesRes.error.message || "")));
  const clientRateOverridesMissing = Boolean(clientRateOverridesRes.error && (/client_rate_overrides|schema cache|relation/i.test(clientRateOverridesRes.error.message || "")));
  const error =
    (clientsMissing ? null : clientsRes.error) ||
    (contactsMissing ? null : contactsRes.error) ||
    (ratingsMissing ? null : ratingsRes.error) ||
    (feedbackRatingsMissing ? null : feedbackRatingsRes.error) ||
    cityPoolsRes.error ||
    (clientRatesMissing ? null : clientRatesRes.error) ||
    (clientRateOverridesMissing ? null : clientRateOverridesRes.error);

  if (error) {
    return {
      businessClients: [] as BusinessClientRecord[],
      clientContacts: [] as ClientContactRecord[],
      techRatings: [] as TechRatingRecord[],
      appUsers: [] as AppUserSummaryRecord[],
      cityPools: [] as CityPoolRecord[],
      clientRates: [] as ClientRateRecord[],
      clientRateOverrides: [] as ClientCityRateOverrideRecord[],
      clientRateOverridesMissing,
      setupMissing: false,
      error: error.message,
    };
  }

  const appUsers = (usersRes.data ?? []).map((row) => {
    const typed = row as Partial<AppUserSummaryRecord> & { id: string };
    return {
      id: typed.id,
      email: typed.email || "",
      full_name: typed.full_name || typed.email || "Unknown user",
      role: typed.role || "viewer",
      is_active: typed.is_active !== false,
    } satisfies AppUserSummaryRecord;
  });
  const userNameById = new Map(appUsers.map((user) => [user.id, user.full_name || user.email || user.id]));

  const businessClients = clientsMissing ? [] : (clientsRes.data ?? [])
    .filter((row) => {
      const typed = row as Partial<BusinessClientRecord> & { id: string };
      return !restrictToOwnClients || typed.created_by === session.user?.id;
    })
    .map((row) => {
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
      created_by: typed.created_by ? String(typed.created_by) : null,
      created_by_name: typed.created_by ? (String(userNameById.get(String(typed.created_by)) || "") || null) : null,
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
    } satisfies BusinessClientRecord;
  });

  const visibleClientIds = new Set(businessClients.map((client) => client.id));
  const clientContacts = contactsMissing ? [] : (contactsRes.data ?? [])
    .filter((row) => {
      const typed = row as Partial<ClientContactRecord> & { id: string; client_id: string };
      if (!visibleClientIds.has(typed.client_id)) return false;
      return !restrictToOwnClients || typed.created_by === session.user?.id;
    })
    .map((row) => {
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
      created_by: typed.created_by ? String(typed.created_by) : null,
      created_by_name: typed.created_by ? (String(userNameById.get(String(typed.created_by)) || "") || null) : null,
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

  const techRatings = [...adminRatings, ...feedbackRatings].filter((rating) => {
    if (!restrictToOwnClients) return true;
    return Boolean(rating.client_id && visibleClientIds.has(rating.client_id));
  });

  const cityPools = (cityPoolsRes.data ?? []).map((row) => ({
    id: String((row as { id: string }).id || ""),
    name: String((row as { name?: string | null }).name || ""),
  })).filter((row) => row.id && row.name) as CityPoolRecord[];

  const clientRates = clientRatesMissing ? [] : (clientRatesRes.data ?? []).map((row) => {
    const typed = row as Partial<ClientRateRecord> & { id: string };
    return {
      id: String(typed.id || ""),
      city_name: String(typed.city_name || "Default"),
      role_name: String(typed.role_name || ""),
      full_day: Number(typed.full_day || 0),
      half_day: typed.half_day === null || typed.half_day === undefined ? null : Number(typed.half_day),
      overtime_multiplier: Number(typed.overtime_multiplier || 1.5),
      doubletime_multiplier: Number(typed.doubletime_multiplier || 2),
    } satisfies ClientRateRecord;
  }).filter((row) => row.id && row.role_name);

  const clientRateOverrides = clientRateOverridesMissing ? [] : (clientRateOverridesRes.data ?? [])
    .filter((row) => {
      const typed = row as Partial<ClientCityRateOverrideRecord> & { client_id?: string };
      return Boolean(typed.client_id && visibleClientIds.has(String(typed.client_id)));
    })
    .map((row) => {
      const typed = row as Partial<ClientCityRateOverrideRecord> & { id: string; client_id: string };
      const numberOrNull = (value: unknown) => value === null || value === undefined || value === "" ? null : Number(value);
      return {
        id: String(typed.id || ""),
        client_id: String(typed.client_id || ""),
        city_name: String(typed.city_name || "Default"),
        role_name: String(typed.role_name || ""),
        full_day: numberOrNull(typed.full_day),
        half_day: numberOrNull(typed.half_day),
        overtime_multiplier: numberOrNull(typed.overtime_multiplier),
        doubletime_multiplier: numberOrNull(typed.doubletime_multiplier),
        created_at: typed.created_at || null,
        updated_at: typed.updated_at || null,
      } satisfies ClientCityRateOverrideRecord;
    })
    .filter((row) => row.id && row.client_id && row.role_name);

  return {
    businessClients,
    clientContacts,
    techRatings,
    appUsers,
    cityPools,
    clientRates,
    clientRateOverrides,
    clientRateOverridesMissing,
    setupMissing: false,
    error: null as string | null,
  };
}
