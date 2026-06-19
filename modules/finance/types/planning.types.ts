export type FinanceEventType =
  | "supplier_deposit"
  | "supplier_balance"
  | "container_freight"
  | "container_arrival_expense"
  | "container_transit"
  | "container_bank_fee"
  | "credit_line_release"
  | "amazon_income";

export type FinanceEventStatus = "pendiente" | "pagado" | "vencido" | "previsto";

export type FinancePaymentSource = "cash" | "caja_rural" | "la_caixa" | "bbva" | "manual";

export type FinanceCreditLine = {
  id: string;
  bankName: string;
  lineName: string;
  creditLimit: number;
  availableAmount: number;
  usedAmount: number;
  cycleDays: number | null;
  repaymentMode: string;
  priority: number | null;
  status: string;
  notes: string | null;
};

export type FinanceCashAccount = {
  id: string;
  name: string;
  balance: number;
  currency: string;
};

export type FinancePlanningEvent = {
  id: string;
  type: FinanceEventType;
  title: string;
  date: string | null;
  month: string | null;
  isPendingDate: boolean;
  status: FinanceEventStatus;
  containerId: string | null;
  containerCode: string | null;
  orderId: string | null;
  orderCode: string | null;
  numeroPedidoAgente: string | null;
  agentContact: string | null;
  logisticsType: "AGL" | "PROPIO" | "SIN_DEFINIR";
  originalAmount: number | null;
  originalCurrency: string;
  plannedFxRate: number | null;
  plannedFxSource: "order" | "container" | "global_setting" | "not_configured";
  plannedAmountEur: number;
  paidAmountEur: number | null;
  recommendedSource: FinancePaymentSource | null;
  recommendationReason: string;
  canMarkPaid: boolean;
  creditLineBank?: string | null;
  sourcePaymentId?: string | null;
};

export type FinanceMonthBucket = {
  month: string;
  label: string;
  totalPendingPayments: number;
  totalPaidPayments: number;
  totalIncome: number;
  totalCreditReleases: number;
  projectedCashBalance: number;
  projectedCreditAvailable: number;
  events: FinancePlanningEvent[];
  pendingDateEvents: FinancePlanningEvent[];
};

export type FinancePlanningSummary = {
  totalCreditLimit: number;
  totalCreditUsed: number;
  totalCreditAvailable: number;
  cashBalance: number;
  pendingPayments: number;
  paidPayments: number;
  plannedIncome: number;
  plannedUsdEurRate: number | null;
  plannedUsdEurRateSource: "global_setting" | "not_configured";
};

export type FinancePlanningResponse = {
  ok: true;
  summary: FinancePlanningSummary;
  creditLines: FinanceCreditLine[];
  cashAccounts: FinanceCashAccount[];
  months: FinanceMonthBucket[];
};

export type FinancePlanningQuery = {
  fromMonth?: string;
  months?: number;
};

export type FinancePlanningRawData = {
  containers: Record<string, unknown>[];
  supplierPayments: Record<string, unknown>[];
  creditLines: Record<string, unknown>[];
  creditLineMovements: Record<string, unknown>[];
  cashAccounts: Record<string, unknown>[];
  amazonIncomeForecasts: Record<string, unknown>[];
  settings: Record<string, unknown>[];
};
