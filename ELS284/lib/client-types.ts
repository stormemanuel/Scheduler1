export type BusinessClientRecord = {
  id: string;
  name: string;
  legal_company_name: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_zip: string;
  main_phone: string;
  main_email: string;
  website: string;
  default_rate_city: string;
  default_market_notes: string;
  notes: string;
  ap_contact_name: string;
  ap_email: string;
  ap_phone: string;
  payment_terms: string;
  po_required: boolean | null;
  w9_coi_notes: string;
  default_invoice_email: string;
  billing_notes: string;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ClientCityRateOverrideRecord = {
  id: string;
  client_id: string;
  city_name: string;
  role_name: string;
  full_day: number | null;
  half_day: number | null;
  overtime_multiplier: number | null;
  doubletime_multiplier: number | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ClientContactType = "labor-coordinator" | "project-manager" | "booth-manager" | "client-tech";

export type ClientContactRecord = {
  id: string;
  client_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  cell_phone: string;
  notes: string;
  contact_type: ClientContactType;
  created_by?: string | null;
  created_by_name?: string | null;
  is_primary: boolean;
  is_onsite_contact: boolean;
  is_billing_contact: boolean;
  created_at: string;
  updated_at: string | null;
};

export type AppUserSummaryRecord = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  allowed_city_pool_ids?: string[];
  restrict_crew_to_owner?: boolean;
};

export type TechRatingRecord = {
  id: string;
  show_id: string;
  client_id: string | null;
  client_contact_id: string | null;
  crew_id: string;
  assignment_id: string | null;
  rating: number;
  notes: string;
  created_at: string;
  updated_at: string | null;
  rating_source?: string;
};

export type ClientTopTechRecord = {
  client_id: string;
  client_contact_id?: string | null;
  crew_id: string;
  crew_name: string;
  phone: string;
  email: string;
  median_rating: number;
  average_rating: number;
  rating_count: number;
  last_rating_at: string;
};
