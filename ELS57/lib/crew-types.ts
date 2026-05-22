export type PositionInput = {
  id?: string;
  role_name: string;
  rate: number;
};

export type CrewRecord = {
  id: string;
  name: string;
  description: string;
  city_pool_id: string | null;
  city_name: string;
  additional_city_pool_ids: string[];
  additional_city_pool_names: string[];
  group_name: string;
  tier: string;
  email: string;
  phone: string;
  other_city: string;
  ob: boolean;
  blacklisted: boolean;
  blacklist_reason: string;
  notes: string;
  conflict_companies: string[];
  positions: PositionInput[];
  unavailable_dates: string[];
  created_by?: string | null;
};

export type CityPoolRecord = {
  id: string;
  name: string;
};

export type CrewGroupRecord = {
  id: string;
  city_pool_id: string;
  name: string;
};
