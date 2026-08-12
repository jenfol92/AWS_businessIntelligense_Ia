import type { FinancialEventGroup, FinancesTransaction } from "@/modules/amazon-sp-api/financesClient";

export type AmazonSettlementImportInput = {
  marketplace: string;
  startedAfter: string;
  startedBefore?: string;
};

export type AmazonSettlementCandidate = {
  settlementId: string;
  marketplace: string;
  processingStatus: string;
  transferStatus: string | null;
  currency: string;
  amount: number;
  cycleStart: string | null;
  cycleEnd: string | null;
  fundTransferAt: string | null;
  traceId: string | null;
  group: FinancialEventGroup;
  transactions: FinancesTransaction[];
};

export type AmazonSettlementReconciliation =
  | { outcome: "matched"; forecastId: string }
  | { outcome: "unmatched" | "ambiguous"; forecastId: null; candidateCount: number };
