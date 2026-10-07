import type { FinancesTransaction, FinancialEventGroup } from "../../amazon-sp-api/financesClient";
import type { AmazonTreasuryObservation } from "../repositories/amazonFinancialPlanningSyncRepository";
import { availablePayoutSimulation, expectedBankDateForPending } from "./amazonTreasuryModel.ts";
import { valueAmazonAmountEur as eurAmounts, type EcbFxTable } from "./ecbFxService.ts";
import { materialKey, resolveObservationMarketplace, signals } from "./amazonTreasuryObservationCore.ts";

export function groupObservation(
  group: FinancialEventGroup,
  transactions: FinancesTransaction[],
  now: Date,
  weekdays: number[],
  ecb?: EcbFxTable | null,
): AmazonTreasuryObservation | null {
  const pending = group.ProcessingStatus === "Closed" && group.FundTransferStatus === "Processing";
  if (group.ProcessingStatus !== "Open" && !pending) return null;
  const currency = group.OriginalTotal?.CurrencyCode?.toUpperCase();
  const amount = Number(group.OriginalTotal?.CurrencyAmount);
  if (!currency || !Number.isFinite(amount)) return null;
  const state = pending ? "PENDING_BANK" : "AVAILABLE";
  const marketplace = resolveObservationMarketplace(transactions);
  const simulation = availablePayoutSimulation(now, weekdays);
  const fx = eurAmounts(currency, amount, group.ConvertedTotal, ecb, group.FundTransferDate ?? null);
  const expectedBankDate = pending ? expectedBankDateForPending(group.FundTransferDate ?? null) : null;
  const material = {
    amount,
    currency,
    marketplace,
    processingStatus: group.ProcessingStatus,
    fundTransferStatus: group.FundTransferStatus ?? null,
    fundTransferAt: group.FundTransferDate ?? null,
    expectedBankDate,
  };
  return {
    observationKey: materialKey(state, group.FinancialEventGroupId, now.toISOString(), material),
    sourceKey: `${pending ? "pending-bank" : "available"}:${group.FinancialEventGroupId}`,
    marketplace,
    economicState: state,
    observedAt: now.toISOString(),
    originalCurrency: currency,
    originalAmount: amount,
    ...fx,
    financialEventGroupId: group.FinancialEventGroupId,
    settlementProcessingStatus: group.ProcessingStatus,
    fundTransferStatus: group.FundTransferStatus ?? null,
    fundTransferAt: group.FundTransferDate ?? null,
    expectedAvailabilityDate: pending ? group.FundTransferDate?.slice(0, 10) ?? null : now.toISOString().slice(0, 10),
    expectedRequestDate: pending ? null : simulation.expectedRequestDate,
    expectedBankDate,
    confidence: pending && group.FundTransferDate ? "high" : marketplace === "UNRESOLVED" ? "low" : "medium",
    estimationMethod: pending
      ? "amazon_fund_transfer_date_plus_one_business_day_base"
      : "open_original_total_conditional_configured_request_window",
    source: "amazon_sp_api_finances",
    evidence: {
      financialEventGroupId: group.FinancialEventGroupId,
      processingStatus: group.ProcessingStatus,
      fundTransferStatus: group.FundTransferStatus ?? null,
      fundTransferAt: group.FundTransferDate ?? null,
      availableTiming: pending
        ? null
        : {
            timing: simulation.timing,
            expectedRequestDate: simulation.expectedRequestDate,
            arrivalBase: simulation.arrival?.base ?? null,
            arrivalConservative: simulation.arrival?.conservative ?? null,
          },
      marketplaceSignals: Array.from(signals(transactions)).sort(),
      transactionCount: transactions.length,
    },
  };
}
