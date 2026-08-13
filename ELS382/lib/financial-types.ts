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


export type ShowExpenseItemRecord = {
  id: string;
  show_id: string;
  category: string;
  description: string;
  amount: number;
  tax_treatment: string;
  receipt_status: string;
  expense_date: string | null;
  notes: string;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};
