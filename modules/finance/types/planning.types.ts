export type FinanceEventType =
  | "unlinked_obligation"
  | "unlinked_payment_settlement"
  | "supplier_deposit"
  | "supplier_balance"
  | "supplier_payment_settlement"
  | "container_freight"
  | "container_arrival_expense"
  | "container_transit"
  | "container_bank_fee"
  | "credit_line_maturity"
  | "credit_line_repayment_settlement"
  | "credit_line_planned_maturity"
  | "credit_line_release"
  | "amazon_income";

export type FinanceEventStatus = "pendiente" | "parcial" | "pagado" | "vencido" | "previsto";

export type FinancePaymentSource = "cash" | "caja_rural" | "la_caixa" | "bbva";

/** Fuentes contables oficiales. `manual` solo puede aparecer en lecturas legacy. */
export type FinanceSupplierPaymentSourceType = "cash_account" | "credit_line";

export type FinanceSupplierPaymentSourceTypeLegacy =
  | FinanceSupplierPaymentSourceType
  | "manual";

export type FinanceCreditLine = {
  id: string;
  bankName: string;
  lineName: string;
  creditLimit: number;
  availableAmount: number;
  usedAmount: number;
  cycleDays: number | null;
  maturityDate: string | null;
  repaymentMode: string;
  priority: number | null;
  fixedFee: number | null;
  plannedReleaseDuringHorizon?: number;
  scheduledExcessEur?: number;
  status: string;
  notes: string | null;
  legacyGap?: { explainedRemaining: number; unexplainedAmount: number } | null;
};

export type FinanceCashAccount = {
  id: string;
  name: string;
  balance: number;
  currency: string;
  isOperatingTreasury: boolean;
};

export type FinancePlanningEvent = {
  unlinkedInstallmentId?: string;
  unlinkedTemplateId?: string;
  paymentTypeName?: string;
  id: string;
  type: FinanceEventType;
  title: string;
  displayDate?: string;
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
  allocatedAmountOriginal?: number | null;
  pendingAmountOriginal?: number | null;
  allocatedAmountEur?: number | null;
  linkedBatchCount?: number;
  latestBatchId?: string | null;
  latestBatchReference?: string | null;
  hasMixedPaymentSources?: boolean;
  originalCurrency: string;
  depositPercent?: number | null;
  balancePercent?: number | null;
  plannedFxRate: number | null;
  plannedFxForeignPerEur?: number | null;
  plannedFxPending?: boolean;
  estimatedPendingEur?: number | null;
  provisionalCostEur?: number | null;
  plannedFxSource: "legacy" | "payment" | "order" | "container" | "global_setting" | "not_configured";
  plannedAmountEur: number;
  paidAmountEur: number | null;
  actualAmountOriginal?: number | null;
  actualAmountEur?: number | null;
  actualFxRate?: number | null;
  actualFxForeignPerEur?: number | null;
  actualFxRateIsWeighted?: boolean;
  paidAt?: string | null;
  paymentSource?: FinancePaymentSource | null;
  bankReference?: string | null;
  bankFeeEur?: number | null;
  ffFeeEur?: number | null;
  totalOperationEur?: number | null;
  orderTotalEur?: number | null;
  orderPaidRealOriginal?: number | null;
  orderPendingRealOriginal?: number | null;
  orderPaidRealEur?: number | null;
  orderPendingRealEur?: number | null;
  recommendedSource: FinancePaymentSource | null;
  recommendationReason: string;
  canMarkPaid: boolean;
  paymentSourceType?: FinanceSupplierPaymentSourceType | null;
  paymentCashAccountId?: string | null;
  paymentCreditLineId?: string | null;
  creditLineId?: string | null;
  creditLineBank?: string | null;
  creditLineName?: string | null;
  paidLineAmountEur?: number | null;
  repaymentGroupId?: string | null;
  repaymentGroupStatus?: string | null;
  originalAmountEur?: number | null;
  remainingAmountEur?: number | null;
  daysUntilDue?: number | null;
  movementCount?: number | null;
  financedOrderCount?: number | null;
  financedOrderCodes?: string[];
  canRepay?: boolean;
  isInformational?: boolean;
  isLegacyOpeningBalance?: boolean;
  sourcePaymentId?: string | null;
  obligationCategory?: "lines" | "deposits" | "balances" | "others";
  plannedPrincipalEur?: number;
  expectedInterestEur?: number | null;
  expectedFeesEur?: number | null;
  plannedCashOutEur?: number;
  plannedCreditReleaseEur?: number;
  plannedMaturityReference?: string | null;
  amazonStatus?: "FUTURE" | "DEFERRED" | "AVAILABLE" | "PENDING_BANK" | "RECEIVED" | "LEGACY_CONFIRMED";
  amazonConfidence?: string | null;
  amazonEstimationMethod?: string | null;
  sourceKey?: string | null;
  settlementId?: string | null;
  marketplace?: string | null;
  dateIsEstimated?: boolean;
};

export type FinanceMonthBucket = {
  month: string;
  label: string;
  totalPendingPayments: number;
  totalPaidPayments: number;
  pendingFxObligations: number;
  hasUnvaluedForeignDebt: boolean;
  pendingBreakdown: FinanceMonthlyBreakdown;
  paidBreakdown: FinanceMonthlyBreakdown;
  totalIncome: number;
  amazonExpectedEur: number;
  amazonConfirmedEur: number;
  amazonReceivedEur: number;
  amazonAvailableEur: number;
  amazonPendingBankEur: number;
  amazonDeferredEur: number;
  amazonMonthlyEstimateEur?: number | null;
  amazonFutureEur: number;
  amazonIncomes: FinanceMonthlyAmazonIncome[];
  totalCreditReleases: number;
  plannedCreditPrincipalEur: number;
  plannedCreditInterestEur: number | null;
  plannedCreditFeesEur: number | null;
  plannedCreditCashOutEur: number;
  plannedCreditReleaseEur: number;
  plannedFinancialExpenseEur: number | null;
  recordedInterestEur: number | null;
  recordedFeesEur: number | null;
  projectedCashBalance: number;
  projectedCreditAvailable: number;
  events: FinancePlanningEvent[];
  pendingDateEvents: FinancePlanningEvent[];
};

export type FinanceMonthlyAmazonIncome = {
  amazonExpectedEur: number;
  amazonConfirmedEur: number;
  amazonReceivedEur: number;
  date: string | null;
  marketplace: string | null;
  status: "FUTURE" | "DEFERRED" | "AVAILABLE" | "PENDING_BANK" | "RECEIVED" | "LEGACY_CONFIRMED";
  sourceKey: string | null;
  settlementId: string | null;
  dateIsEstimated: boolean;
  confidence: string | null;
  estimationMethod: string | null;
  originalCurrency: string;
  originalAmount: number;
  amountEur: number | null;
};

export type FinanceMonthlyBreakdown = {
  lines: number;
  deposits: number;
  balances: number;
  others: number;
  total: number;
};

export type FinancePlanningSummary = {
  /** Limite contractual de lineas activas (admiten disposicion). */
  totalActiveCreditLimit: number;
  /** Deuda dispuesta de todas las lineas no eliminadas (incluye canceladas/inactivas). */
  totalCreditUsed: number;
  /** Disponible usable solo de lineas activas. */
  totalActiveCreditAvailable: number;
  /**
   * Alias de totalActiveCreditLimit (compat UI).
   * No incluye limite de lineas canceladas/inactivas.
   */
  totalCreditLimit: number;
  /**
   * Alias de totalActiveCreditAvailable (compat UI).
   * Nunca incluye disponible matematico de lineas no activas.
   */
  totalCreditAvailable: number;
  cashBalance: number;
  pendingPayments: number;
  /** Pagos ejecutados dentro del mismo horizonte mensual visible. */
  paidPayments: number;
  plannedIncome: number;
  amazonAvailable: number;
  amazonAvailableSource: string;
  amazonExpected: number;
  amazonExpectedNetRatio: number | null;
  pendingFxObligations: number;
  plannedUsdEurRate: number | null;
  plannedUsdEurRateSource: "global_setting" | "not_configured";
  minimumOperatingReserveEur: number;
  operatingCashAvailableAboveReserveEur: number;
  treasuryEvaluation: import("../services/treasuryEngine").TreasuryEvaluation;
};

export type FinancePlanningResponse = {
  ok: true;
  recurringPaymentsWarning?: string | null;
  summary: FinancePlanningSummary;
  creditLines: FinanceCreditLine[];
  cashAccounts: FinanceCashAccount[];
  months: FinanceMonthBucket[];
  pendingDateEvents: FinancePlanningEvent[];
  permissions: { canManageCreditLineRegularizations: boolean };
  amazonCashForecast: {
    marketplaceCards: import("../services/amazonCashForecast").AmazonMarketplaceCashCard[];
    monthlyScenarios: ReturnType<typeof import("../services/amazonCashForecast").summarizeAmazonCashByMonth>;
  };
  amazonSync?: {
    stale: boolean;
    warning: "AMAZON_FINANCE_SYNC_STALE" | null;
    lastSuccessfulAmazonSyncAt: string | null;
    syncAttempted: boolean;
  };
};

export type FinancePlanningQuery = {
  fromMonth?: string;
  months?: number;
};

export type FinancePlanningRawData = {
  recurringPayments?: Record<string, unknown>[];
  recurringPaymentsWarning?: string | null;
  containers: Record<string, unknown>[];
  supplierPayments: Record<string, unknown>[];
  creditLines: Record<string, unknown>[];
  creditLineRepaymentGroups: Record<string, unknown>[];
  creditLineRepaymentMovements: Record<string, unknown>[];
  creditLineLegacyRegularizationItems: Record<string, unknown>[];
  creditLinePlannedMaturities: Record<string, unknown>[];
  cashAccounts: Record<string, unknown>[];
  amazonIncomeForecasts: Record<string, unknown>[];
  amazonTreasuryObservations: Record<string, unknown>[];
  settings: Record<string, unknown>[];
};
