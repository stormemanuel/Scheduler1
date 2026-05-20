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
  created_at: string;
  updated_at: string | null;
};

export type ClientContactRecord = {
  id: string;
  client_id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  cell_phone: string;
  notes: string;
  is_primary: boolean;
  is_onsite_contact: boolean;
  is_billing_contact: boolean;
  created_at: string;
  updated_at: string | null;
};

export type TechRatingRecord = {
  id: string;
  show_id: string;
  client_id: string | null;
  crew_id: string;
  assignment_id: string | null;
  rating: number;
  notes: string;
  created_at: string;
  updated_at: string | null;
};

export type ClientTopTechRecord = {
  client_id: string;
  crew_id: string;
  crew_name: string;
  phone: string;
  email: string;
  average_rating: number;
  rating_count: number;
  last_rating_at: string;
};
