export type ShowFinancialRecord = {
  show_id: string;
  estimated_revenue_override: number | null;
  expenses: number;
  notes: string;
  tax_reserve_done?: boolean;
  tax_reserve_done_at?: string | null;
  consecrated_hands_done?: boolean;
  consecrated_hands_done_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export const PAYROLL_SNAPSHOT_START = "[ELS_PAYROLL_SNAPSHOT]";
export const PAYROLL_SNAPSHOT_END = "[/ELS_PAYROLL_SNAPSHOT]";

export type StoredPayrollSnapshot = {
  snapshot_version?: number;
  show_id?: string;
  saved_at?: string;
  source?: string;
  show_process_cycle_id?: string | null;
  latest_show_process_completed?: boolean;
  event?: Record<string, unknown>;
};

function safeString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function stripPayrollSnapshotFromNotes(notes: unknown) {
  const text = safeString(notes);
  const start = text.lastIndexOf(PAYROLL_SNAPSHOT_START);
  const end = text.lastIndexOf(PAYROLL_SNAPSHOT_END);
  if (start < 0 || end < 0 || end <= start) return text.trim();
  return text.slice(0, start).trim();
}

export function extractPayrollSnapshotFromNotes(notes: unknown): StoredPayrollSnapshot | null {
  const text = safeString(notes);
  const start = text.lastIndexOf(PAYROLL_SNAPSHOT_START);
  const end = text.lastIndexOf(PAYROLL_SNAPSHOT_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const raw = text.slice(start + PAYROLL_SNAPSHOT_START.length, end).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as StoredPayrollSnapshot;
  } catch {
    return null;
  }
}

export function mergePayrollSnapshotIntoNotes(notes: unknown, snapshot: StoredPayrollSnapshot | null | undefined) {
  const visibleNotes = stripPayrollSnapshotFromNotes(notes);
  if (!snapshot) return visibleNotes || null;
  const encoded = JSON.stringify(snapshot);
  return `${visibleNotes}${visibleNotes ? "\n\n" : ""}${PAYROLL_SNAPSHOT_START}\n${encoded}\n${PAYROLL_SNAPSHOT_END}`;
}

export function publicShowFinancialRecord<T extends { notes?: string | null }>(row: T | null | undefined): T | null {
  if (!row) return null;
  return { ...row, notes: stripPayrollSnapshotFromNotes(row.notes) } as T;
}


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

function moneyOrNull(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Amount must be a positive number or blank.");
  return Math.round(parsed * 100) / 100;
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function buildShowFinancialsPayload(body: Record<string, unknown>, now: string) {
  const showId = String(body.show_id || "").trim();
  if (!showId) throw new Error("Show is required.");
  const taxReserveProvided = hasOwn(body, "tax_reserve_done");
  const consecratedHandsProvided = hasOwn(body, "consecrated_hands_done");
  const taxReserveDone = taxReserveProvided ? booleanValue(body.tax_reserve_done) : null;
  const consecratedHandsDone = consecratedHandsProvided ? booleanValue(body.consecrated_hands_done) : null;
  const payload: Record<string, unknown> = {
    show_id: showId,
    updated_at: now,
  };
  if (hasOwn(body, "estimated_revenue_override")) payload.estimated_revenue_override = moneyOrNull(body.estimated_revenue_override);
  if (hasOwn(body, "expenses")) payload.expenses = moneyOrNull(body.expenses) ?? 0;
  if (hasOwn(body, "notes")) payload.notes = stripPayrollSnapshotFromNotes(body.notes) || null;
  if (taxReserveProvided) {
    payload.tax_reserve_done = taxReserveDone;
    payload.tax_reserve_done_at = taxReserveDone ? (body.tax_reserve_done_at || now) : null;
  }
  if (consecratedHandsProvided) {
    payload.consecrated_hands_done = consecratedHandsDone;
    payload.consecrated_hands_done_at = consecratedHandsDone ? (body.consecrated_hands_done_at || now) : null;
  }

  return {
    payload,
    taxReserveProvided,
    taxReserveDone,
    consecratedHandsProvided,
    consecratedHandsDone,
  };
}
