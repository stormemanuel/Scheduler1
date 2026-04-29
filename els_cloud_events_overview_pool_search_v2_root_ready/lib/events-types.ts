export type ShowRecord = {
  id: string;
  name: string;
  client: string;
  venue: string;
  rate_city: string;
  show_start: string;
  show_end: string;
  notes: string;
};

export type LaborDayRecord = {
  id: string;
  show_id: string;
  labor_date: string;
  label: string;
  notes: string;
};

export type SubCallRecord = {
  id: string;
  labor_day_id: string;
  area: string;
  role_name: string;
  start_time: string;
  end_time: string;
  crew_needed: number;
  notes: string;
};

export type AssignmentRecord = {
  id: string;
  sub_call_id: string;
  crew_id: string;
  status: string;
};
