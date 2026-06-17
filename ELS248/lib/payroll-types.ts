import type { ShowExpenseItemRecord } from "@/lib/financial-types";

export type PayrollTaxProfileSummary = {
  taxLegalName: string;
  businessName: string;
  federalTaxClassification: string;
  llcTaxClassification: string;
  otherClassification: string;
  taxAddressLine1: string;
  taxCityStateZip: string;
  tinType: string;
  tinLast4: string;
  signerName: string;
  certificationConfirmed: boolean;
  signedAt: string | null;
  source: string;
  updatedAt: string | null;
  hasEncryptedTin: boolean;
  signatureCaptured: boolean;
};

export type PayrollPaymentStatus = "unpaid" | "scheduled" | "paid";

export type PayrollStatusRecord = {
  id: string;
  show_id: string;
  crew_id: string;
  role_name: string;
  paid: boolean;
  payment_status: PayrollPaymentStatus;
  payout_override: number | null;
  notes: string;
  scheduled_for: string | null;
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
  coordinationOwnerUserId?: string | null;
  coordinationOwnerName?: string | null;
  coordinationFeeWaived?: boolean;
  coordinationPaymentStatus?: PayrollPaymentStatus;
  coordinationPaid?: boolean;
  coordinationScheduledFor?: string | null;
  coordinationOverrideAmount?: number | null;
  coordinationNotes?: string;
  coordinationPaymentStatusId?: string | null;
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
  showAssignedCoordinatorUserId?: string | null;
  showAssignedCoordinatorName?: string | null;
  coordinatorPaymentStatus?: PayrollPaymentStatus;
  coordinatorPaid?: boolean;
  coordinatorScheduledFor?: string | null;
  coordinatorOverrideAmount?: number | null;
  coordinatorNotes?: string;
  coordinatorPaymentStatusId?: string | null;
  crewId: string;
  crewName: string;
  crewEmail: string;
  crewPhone: string;
  w9Status?: string | null;
  taxProfileStatus?: string | null;
  w9DocumentUrl?: string | null;
  taxProfileNotes?: string | null;
  taxProfile?: PayrollTaxProfileSummary | null;
  roles: string[];
  calls: PayrollCallDetail[];
  estimatedTotal: number;
  overrideAmount: number | null;
  paid: boolean;
  paymentStatus: PayrollPaymentStatus;
  notes: string;
  scheduledFor: string | null;
  statusId: string | null;
  showRevenueOverride?: number | null;
  showExpenses?: number;
  showFinancialNotes?: string;
  showExpenseItems?: ShowExpenseItemRecord[];
  taxReserveDone?: boolean;
  taxReserveDoneAt?: string | null;
  consecratedHandsDone?: boolean;
  consecratedHandsDoneAt?: string | null;
};

export type PayrollCoordinatorPaymentSummary = {
  showId: string;
  coordinatorUserId: string | null;
  coordinatorName: string;
  fullDayTechDays: number;
  halfDayTechs: number;
  projectedAmount: number;
  overrideAmount: number | null;
  payableAmount: number;
  paymentStatus: PayrollPaymentStatus;
  paid: boolean;
  scheduledFor: string | null;
  notes: string;
  statusId: string | null;
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
  expenseItems: ShowExpenseItemRecord[];
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
  coordinatorPayment?: PayrollCoordinatorPaymentSummary | null;
  coordinatorPayments?: PayrollCoordinatorPaymentSummary[];
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
  w9Status: string;
  taxProfileStatus: string;
  w9DocumentUrl: string;
  taxProfileNotes: string;
  taxProfile: PayrollTaxProfileSummary | null;
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
