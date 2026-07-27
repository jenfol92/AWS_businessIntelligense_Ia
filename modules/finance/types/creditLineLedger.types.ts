export type CreditLineMovementType =
  | "drawdown"
  | "repayment"
  | "interest"
  | "fee"
  | "adjustment";

export type CreditLineMovementStatus = "posted" | "pagado" | "pendiente" | "cancelled";

export type RepaymentGroupStatus = "open" | "partially_paid" | "paid" | "cancelled";

export type CashMovementType =
  | "supplier_payment"
  | "credit_repayment"
  | "income"
  | "fee"
  | "adjustment";

export type CashMovementDirection = "in" | "out";

export type CreditLineLedgerErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_DATE"
  | "INVALID_CURRENCY"
  | "NOT_FOUND"
  | "MANUAL_DUE_DATE_REQUIRED"
  | "INSUFFICIENT_CREDIT"
  | "INSUFFICIENT_USED_AMOUNT"
  | "INSUFFICIENT_CASH"
  | "GROUP_MISMATCH"
  | "GROUP_CLOSED"
  | "CREDIT_LINE_INACTIVE"
  | "CREDIT_LINE_DELETED"
  | "MISSING_CASH_ACCOUNT"
  | "MISSING_REPAYMENT_GROUP"
  | "UNAUTHORIZED"
  | "IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "DIRECT_DML_FORBIDDEN";

export class CreditLineLedgerError extends Error {
  constructor(
    message: string,
    public readonly code: CreditLineLedgerErrorCode,
  ) {
    super(message);
    this.name = "CreditLineLedgerError";
  }
}

export type CreditLineRow = {
  id: string;
  bank_name: string | null;
  line_name: string | null;
  credit_limit: number;
  available_amount: number;
  used_amount: number;
  cycle_days: number | null;
  status: string;
};

export type RepaymentGroupRow = {
  id: string;
  credit_line_id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: RepaymentGroupStatus;
  paid_at: string | null;
};

export type CreditLineMovementRow = {
  id: string;
  credit_line_id: string;
  movement_type: CreditLineMovementType;
  description: string;
  due_date: string | null;
  paid_at: string | null;
  amount: number;
  status: CreditLineMovementStatus;
  source_type: string | null;
  source_id: string | null;
  movement_date: string | null;
  repayment_group_id: string | null;
  idempotency_key: string | null;
  cash_movement_id: string | null;
};

export type CashAccountRow = {
  id: string;
  name: string;
  balance: number;
  currency: string;
};

export type CashMovementRow = {
  id: string;
  cash_account_id: string;
  movement_type: CashMovementType;
  direction: CashMovementDirection;
  amount: number;
  source_type: string | null;
  source_id: string | null;
  movement_date: string;
  notes: string | null;
};

export type FindOrCreateOpenRepaymentGroupInput = {
  creditLineId: string;
  movementDate: string;
};

export type CreateCreditLineDrawdownInput = {
  creditLineId: string;
  amount: number;
  movementDate: string;
  sourceType: "supplier_payment" | "manual" | "purchase_payment_batch";
  sourceId?: string | null;
  description: string;
  idempotencyKey?: string | null;
  /** Obligatorio cuando la linea no tiene cycle_days. */
  manualDueDate?: string | null;
};

export type CreateCreditLineDrawdownResult = {
  movement: CreditLineMovementRow;
  repaymentGroup: RepaymentGroupRow;
  creditLine: CreditLineRow;
  idempotent: boolean;
};

export type CreateCreditLineRepaymentInput = {
  creditLineId: string;
  amount: number;
  movementDate: string;
  cashAccountId: string;
  repaymentGroupId: string;
  sourceType: "repayment_group" | "manual_repayment";
  sourceId?: string | null;
  notes?: string | null;
  bankReference?: string | null;
  idempotencyKey?: string | null;
};

export type CreateCreditLineRepaymentResult = {
  movement: CreditLineMovementRow;
  cashMovement: CashMovementRow;
  repaymentGroup: RepaymentGroupRow | null;
  creditLine: CreditLineRow;
  cashAccount: CashAccountRow;
  idempotent: boolean;
};

export type CreateCashMovementInput = {
  cashAccountId: string;
  movementType: CashMovementType;
  direction: CashMovementDirection;
  amount: number;
  sourceType?: string | null;
  sourceId?: string | null;
  movementDate: string;
  notes?: string | null;
};

export type CreateCashMovementResult = {
  cashMovement: CashMovementRow;
  cashAccount: CashAccountRow;
};

export type CreditLineDrawdownRpcResponse = {
  movement_id: string;
  repayment_group_id: string;
  credit_line_id: string;
  used_amount: number;
  available_amount: number;
  idempotent: boolean;
};

export type CreditLineRepaymentRpcResponse = {
  movement_id: string;
  cash_movement_id: string;
  repayment_group_id: string | null;
  credit_line_id: string;
  cash_account_id: string;
  used_amount: number;
  available_amount: number;
  cash_balance: number;
  idempotent: boolean;
};
