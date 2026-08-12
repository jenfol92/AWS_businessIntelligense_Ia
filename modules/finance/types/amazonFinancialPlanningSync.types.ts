export type AmazonProjectedCycle = {
  marketplace: string;
  cycleStart: string;
  cycleEnd: string;
  forecastDate: string;
  forecastUnits: number;
  estimatedGrossEur: number;
  ratio: number | null;
  amazonExpectedEur: number | null;
  sourceKey: string;
  expectedBankDate: string | null;
  snapshotAt: string;
  confidence: "low" | "unavailable";
  estimationMethod: string;
};

export type AmazonEconomicState = "RECEIVED" | "PENDING_BANK" | "AVAILABLE" | "DEFERRED" | "FUTURE";

export type AmazonFinancialPlanningSyncResult = {
  successful: boolean;
  skipped: boolean;
  skipReason: "already_running" | null;
  projectedCreated: number;
  projectedUpdated: number;
  projected: AmazonProjectedCycle[];
  settlementsFound: number;
  closed: number;
  open: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  confirmedAmountEur: number;
  availableUpserted: number;
  deferredUpserted: number;
  deferredReleasedObserved: number;
  pendingBankUpserted: number;
  settlementDiagnostics: Array<{
    financialEventGroupId: string;
    processingStatus: string;
    convertedTotal: { currency: string | null; amount: number | null };
    originalTotal: { currency: string | null; amount: number | null };
    boundedTransactions: number;
    unboundedTransactions: number | null;
    transactionTopLevelKeys: string[];
    marketplaceDetails: Array<{ marketplaceId: string | null; marketplaceName: string | null }>;
    marketplaceSignals: string[];
    resolvedMarketplace: string | null;
    reconciliation: "matched" | "unmatched" | "ambiguous" | null;
    rejectionReason: string | null;
  }>;
  errors: Array<{ scope: string; message: string }>;
  durationMs: number;
  lastSyncAt: string;
};

export type AmazonSyncState = {
  status: "idle" | "running" | "succeeded" | "failed";
  lastSuccessfulAt: string | null;
  lockedUntil: string | null;
  lastResult: AmazonFinancialPlanningSyncResult | null;
};
