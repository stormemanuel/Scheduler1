export type CityPool = {
  id: string;
  name: string;
};

export type CrewPosition = {
  role: string;
  rate: number;
};

export type CrewMember = {
  id: string;
  name: string;
  city: string;
  group: string;
  tier: string;
  email: string;
  phone: string;
  positions: CrewPosition[];
  conflictCompanies: string[];
  notes: string;
};

export type Show = {
  id: string;
  name: string;
  client: string;
  rateCity: string;
  showStart: string;
  showEnd: string;
  status: "Upcoming" | "Current" | "Past";
};

export type LaborDay = {
  id: string;
  showId: string;
  date: string;
  label: string;
};

export type SubCall = {
  id: string;
  laborDayId: string;
  area: string;
  role: string;
  startTime: string;
  endTime: string;
  crewNeeded: number;
};

export type PayrollRow = {
  id: string;
  showId: string;
  crewId: string;
  role: string;
  baseEstimate: number;
  payType: "Regular" | "OT" | "DT";
  paid: boolean;
};
