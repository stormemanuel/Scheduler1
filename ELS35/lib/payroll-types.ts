export type PayrollStatusRecord = {
  id: string;
  show_id: string;
  crew_id: string;
  role_name: string;
  paid: boolean;
  payout_override: number | null;
  notes: string;
};

export type PayrollCallDetail = {
  assignmentId: string;
  subCallId: string;
  laborDayId: string;
  laborDate: string;
  area: string;
  roleName: string;
  startTime: string;
  endTime: string;
  status: string;
  amount: number;
  durationHours: number | null;
  payLabel: string;
  rateSource: string;
  clientRevenueAmount?: number;
  clientRateSource?: string;
};

export type PayrollCrewShowRow = {
  key: string;
  showId: string;
  showName: string;
  showClient: string;
  showVenue: string;
  showStart: string;
  showEnd: string;
  showYear: number;
  crewId: string;
  crewName: string;
  crewEmail: string;
  crewPhone: string;
  roles: string[];
  calls: PayrollCallDetail[];
  estimatedTotal: number;
  overrideAmount: number | null;
  paid: boolean;
  notes: string;
  statusId: string | null;
  showRevenueOverride?: number | null;
  showExpenses?: number;
  showFinancialNotes?: string;
  taxReserveDone?: boolean;
  taxReserveDoneAt?: string | null;
  consecratedHandsDone?: boolean;
  consecratedHandsDoneAt?: string | null;
};

export type PayrollEventSummary = {
  estimatedRevenue: number;
  estimatedProfit: number;
  consecratedHandsDonation: number;
  taxReserve: number;
  combinedReserve: number;
  pureProfit: number;
  expenses: number;
  revenueOverride: number | null;
  financialNotes: string;
  taxReserveDone: boolean;
  taxReserveDoneAt: string | null;
  consecratedHandsDone: boolean;
  consecratedHandsDoneAt: string | null;
  showId: string;
  showName: string;
  showClient: string;
  showVenue: string;
  showStart: string;
  showEnd: string;
  showYear: number;
  rows: PayrollCrewShowRow[];
  estimatedTotal: number;
  payableTotal: number;
  paidTotal: number;
  unpaidTotal: number;
};

export type PayrollYearTechSummary = {
  crewId: string;
  crewName: string;
  crewEmail: string;
  crewPhone: string;
  paidTotal: number;
  unpaidTotal: number;
  eventCountPaid: number;
  eventCountUnpaid: number;
};

export type PayrollYearPLSummary = {
  estimatedRevenue: number;
  contractLabor: number;
  expenses: number;
  estimatedProfit: number;
  consecratedHandsDonation: number;
  taxReserve: number;
  combinedReserve: number;
  pureProfit: number;
};

export type PayrollPageData = {
  eventSummaries: PayrollEventSummary[];
  crewRows: PayrollCrewShowRow[];
  availableYears: number[];
  setupMissing: boolean;
  error: string | null;
};
