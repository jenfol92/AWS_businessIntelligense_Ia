export type CreditLineRefinancingInput = {
  sourceRepaymentGroupId: string;
  fundingCreditLineId: string;
  effectiveDate: string;
  principalEur: number;
  interestEur: number;
  feesEur: number;
  fundingManualDueDate?: string | null;
  reference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
};

export type CreditLineRefinancingResult = {
  refinancingId: string;
  sourceCreditLineId: string;
  fundingCreditLineId: string;
  fundingRepaymentGroupId: string;
  principalEur: number;
  interestEur: number;
  feesEur: number;
  fundedTotalEur: number;
  fundingDueDate: string;
  sourceCreditUsedEur: number;
  fundingCreditUsedEur: number;
  idempotent: boolean;
};

export type OperatingTreasuryInput = {
  cashAccountId: string;
  operationType: "contribution" | "withdrawal" | "opening_adjustment";
  direction: "in" | "out";
  amountEur: number;
  effectiveDate: string;
  reference?: string | null;
  notes?: string | null;
  idempotencyKey: string;
};

export type AmazonIncomeStatus = "projected" | "accumulated" | "confirmed" | "received";

export type AmazonIncomeInput = {
  sourceKey: string;
  forecastDate: string;
  description: string;
  amountEur: number;
  status: Exclude<AmazonIncomeStatus, "received">;
  marketplace?: string | null;
  cycleStart?: string | null;
  cycleEnd?: string | null;
  estimatedGrossEur?: number | null;
  historicalNetRatio?: number | null;
  confirmedAmountEur?: number | null;
  notes?: string | null;
};
