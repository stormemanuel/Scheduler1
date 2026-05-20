export type BusinessClientRecord = {
  id: string;
  name: string;
  default_rate_city: string;
  notes: string;
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
  notes: string;
  is_primary: boolean;
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
