export type CreditLineMaturityFilter =
  | "all"
  | "overdue"
  | "next_7"
  | "next_15"
  | "this_month"
  | "partial";

export type CreditLineMaturityVisualStatus =
  | "overdue"
  | "due_today"
  | "next_7"
  | "next_15"
  | "pending"
  | "partial";

export type CreditLineMaturityGroupStatus = "open" | "partially_paid";

export type CreditLineMaturity = {
  id: string;
  creditLineId: string;
  repaymentGroupId: string;
  bankName: string;
  lineName: string;
  dueDate: string;
  originalAmountEur: number;
  paidAmountEur: number;
  remainingAmountEur: number;
  groupStatus: CreditLineMaturityGroupStatus;
  /** pendiente | vencido | parcial | vencido_parcial */
  displayStatus: "pendiente" | "vencido" | "parcial" | "vencido_parcial";
  visualStatus: CreditLineMaturityVisualStatus;
  daysUntilDue: number;
  movementCount: number;
  financedOrderCount: number;
  financedOrderCodes: string[];
  canRepay: boolean;
  isLegacyOpeningBalance: boolean;
};

export type CreditLineMaturitySummary = {
  overdueAmountEur: number;
  next7AmountEur: number;
  next15AmountEur: number;
  thisMonthAmountEur: number;
  totalPendingAmountEur: number;
  overdueCount: number;
  next7Count: number;
  next15Count: number;
  thisMonthCount: number;
  totalCount: number;
};

export type CreditLineLegacyGap = {
  creditLineId: string;
  bankName: string;
  lineName: string;
  usedAmount: number;
  explainedRemaining: number;
  unexplainedAmount: number;
};

export type CreditLineMaturitiesQuery = {
  status?: CreditLineMaturityFilter;
  from?: string;
  to?: string;
  creditLineId?: string;
};

export type CreditLineMaturitiesResponse = {
  ok: true;
  asOf: string;
  summary: CreditLineMaturitySummary;
  maturities: CreditLineMaturity[];
  legacyGaps: CreditLineLegacyGap[];
};
