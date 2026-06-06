export type ShowFinancialRecord = {
  show_id: string;
  estimated_revenue_override: number | null;
  expenses: number;
  notes: string;
  tax_reserve_done?: boolean;
  tax_reserve_done_at?: string | null;
  consecrated_hands_done?: boolean;
  consecrated_hands_done_at?: string | null;
};
