import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { BusinessClientRecord, ClientContactRecord, TechRatingRecord } from "@/lib/client-types";

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

  const [clientsRes, contactsRes, ratingsRes] = await Promise.all([
    supabase.from("business_clients").select("id, name, default_rate_city, notes, created_at, updated_at").order("name", { ascending: true }),
    supabase.from("client_contacts").select("id, client_id, name, title, email, phone, notes, is_primary, created_at, updated_at").order("name", { ascending: true }),
    supabase.from("tech_ratings").select("id, show_id, client_id, crew_id, assignment_id, rating, notes, created_at, updated_at").order("updated_at", { ascending: false }),
  ]);

  const clientsMissing = Boolean(clientsRes.error && clientsRes.error.message.includes('relation "business_clients" does not exist'));
  const contactsMissing = Boolean(contactsRes.error && contactsRes.error.message.includes('relation "client_contacts" does not exist'));
  const ratingsMissing = Boolean(ratingsRes.error && ratingsRes.error.message.includes('relation "tech_ratings" does not exist'));
  const error = (clientsMissing ? null : clientsRes.error) || (contactsMissing ? null : contactsRes.error) || (ratingsMissing ? null : ratingsRes.error);

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
      default_rate_city: typed.default_rate_city || "Default",
      notes: typed.notes || "",
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
      notes: typed.notes || "",
      is_primary: Boolean(typed.is_primary),
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
    } satisfies ClientContactRecord;
  });

  const techRatings = ratingsMissing ? [] : (ratingsRes.data ?? []).map((row) => {
    const typed = row as Partial<TechRatingRecord> & { id: string; show_id: string; crew_id: string };
    return {
      id: typed.id,
      show_id: typed.show_id,
      client_id: typed.client_id || null,
      crew_id: typed.crew_id,
      assignment_id: typed.assignment_id || null,
      rating: Number(typed.rating || 0),
      notes: typed.notes || "",
      created_at: typed.created_at || "",
      updated_at: typed.updated_at || null,
    } satisfies TechRatingRecord;
  });

  return {
    businessClients,
    clientContacts,
    techRatings,
    setupMissing: false,
    error: null as string | null,
  };
}
