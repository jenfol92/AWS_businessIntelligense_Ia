export type UnlinkedObligationCategory =
  | "payroll" | "social_security" | "mortgage" | "loan" | "rent"
  | "insurance" | "taxes" | "utilities" | "professional_services" | "other";

export type UnlinkedObligationOriginType = "one_off" | "recurring_occurrence";
export type UnlinkedObligationLifecycleStatus = "active" | "cancelled";
export type UnlinkedAmountBreakdownMode = "total_only" | "detailed";
export type UnlinkedObligationFinancialStatus = "pending" | "partial" | "paid" | "cancelled";
export type UnlinkedInstallmentFinancialStatus =
  | "pending" | "partial" | "paid" | "cancelled" | "superseded";
export type UnlinkedInstallmentTemporalCondition = "current" | "due_soon" | "overdue";
export type UnlinkedInstallmentStatus = "active" | "cancelled" | "superseded";
export type UnlinkedTemplateStatus = "active" | "paused" | "ended" | "cancelled";
export type UnlinkedFrequencyInterval = 1 | 3 | 12;

export type UnlinkedObligationListFilters = {
  q?: string;
  category?: UnlinkedObligationCategory;
  financialStatus?: UnlinkedObligationFinancialStatus;
  lifecycleStatus?: UnlinkedObligationLifecycleStatus;
  overdue?: boolean;
  dueFrom?: string;
  dueTo?: string;
  originType?: UnlinkedObligationOriginType;
  templateId?: string;
};

export type UnlinkedTemplateListFilters = {
  q?: string;
  category?: UnlinkedObligationCategory;
  status?: UnlinkedTemplateStatus;
};

export type UnlinkedInstallmentListOptions = {
  statuses?: UnlinkedInstallmentStatus[];
};

export type UnlinkedAmountBreakdown = {
  amountBreakdownMode: UnlinkedAmountBreakdownMode;
  principalEur: number | null;
  interestEur: number | null;
  otherFeesEur: number | null;
  totalEur: number;
};

export type UnlinkedObligationListItem = {
  id: string;
  templateId: string | null;
  occurrencePeriod: string | null;
  originType: UnlinkedObligationOriginType;
  concept: string;
  category: UnlinkedObligationCategory;
  counterpartyName: string | null;
  description: string | null;
  lifecycleStatus: UnlinkedObligationLifecycleStatus;
  amountBreakdownMode: UnlinkedAmountBreakdownMode;
  plannedTotalEur: number;
  paidTotalEur: number;
  outstandingTotalEur: number;
  financialStatus: UnlinkedObligationFinancialStatus;
  hasOverdueInstallment: boolean;
  nextPendingDueDate: string | null;
  installmentCount: number;
  paidInstallmentCount: number;
  partialInstallmentCount: number;
  pendingInstallmentCount: number;
};

export type UnlinkedInstallmentBalance = {
  id: string;
  obligationId: string;
  planRevision: number;
  sequenceNumber: number;
  dueDate: string;
  status: UnlinkedInstallmentStatus;
  amountBreakdownMode: UnlinkedAmountBreakdownMode;
  plannedPrincipalEur: number | null;
  plannedInterestEur: number | null;
  plannedOtherFeesEur: number | null;
  plannedTotalEur: number;
  allocatedPrincipalEur: number | null;
  allocatedInterestEur: number | null;
  allocatedOtherFeesEur: number | null;
  allocatedTotalEur: number;
  outstandingTotalEur: number;
  financialStatus: UnlinkedInstallmentFinancialStatus;
  temporalCondition: UnlinkedInstallmentTemporalCondition;
};

export type UnlinkedPaymentAllocation = {
  id: string;
  paymentId: string;
  installmentId: string;
  amountBreakdownMode: UnlinkedAmountBreakdownMode;
  allocatedPrincipalEur: number | null;
  allocatedInterestEur: number | null;
  allocatedOtherFeesEur: number | null;
  allocatedTotalEur: number;
  createdAt: string;
};

export type UnlinkedObligationPayment = {
  id: string;
  obligationId: string;
  paidAt: string;
  amountBreakdownMode: UnlinkedAmountBreakdownMode;
  actualPrincipalEur: number | null;
  actualInterestEur: number | null;
  actualOtherFeesEur: number | null;
  actualTotalEur: number;
  bankFeeEur: number;
  fundedTotalEur: number;
  sourceType: "cash_account" | "credit_line";
  cashAccountId: string | null;
  creditLineId: string | null;
  cashMovementId: string | null;
  creditLineMovementId: string | null;
  repaymentGroupId: string | null;
  bankReference: string | null;
  notes: string | null;
  status: "posted" | "reversed";
  createdAt: string;
};

export type UnlinkedObligationDetail = {
  id: string;
  templateId: string | null;
  occurrencePeriod: string | null;
  originType: UnlinkedObligationOriginType;
  concept: string;
  category: UnlinkedObligationCategory;
  counterpartyName: string | null;
  description: string | null;
  lifecycleStatus: UnlinkedObligationLifecycleStatus;
  cancellationReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  amount: UnlinkedAmountBreakdown;
  balance: UnlinkedObligationListItem;
  installments: UnlinkedInstallmentBalance[];
  payments: UnlinkedObligationPayment[];
  allocations: UnlinkedPaymentAllocation[];
};

export type UnlinkedObligationTemplate = {
  id: string;
  concept: string;
  category: UnlinkedObligationCategory;
  counterpartyName: string | null;
  description: string | null;
  amount: UnlinkedAmountBreakdown;
  startDate: string;
  endDate: string;
  anchorDay: number;
  anchorMonth: number;
  frequencyUnit: "month";
  frequencyInterval: UnlinkedFrequencyInterval;
  status: UnlinkedTemplateStatus;
  createdAt: string;
  updatedAt: string;
};

export type UnlinkedObligationOccurrenceSummary = UnlinkedObligationListItem & {
  templateId: string;
  occurrencePeriod: string;
  originType: "recurring_occurrence";
};

export type UnlinkedObligationTemplateDetail = {
  template: UnlinkedObligationTemplate;
  occurrences: UnlinkedObligationOccurrenceSummary[];
};
