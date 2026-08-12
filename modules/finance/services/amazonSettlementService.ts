import { listFinancialEventGroups, listTransactions } from "@/modules/amazon-sp-api/financesClient";
import { reconcileAmazonSettlementRpc } from "../repositories/amazonSettlementRepository";
import type { AmazonSettlementCandidate, AmazonSettlementImportInput } from "../types/amazonSettlement.types";

function money(group: Parameters<typeof mapClosedFinancialEventGroup>[0]): { currency: string; amount: number } {
  const source = [group.ConvertedTotal,group.OriginalTotal].find(value=>Number.isFinite(Number(value?.CurrencyAmount))&&Number(value?.CurrencyAmount)>0);
  const currency = String(source?.CurrencyCode ?? "").trim().toUpperCase();
  const amount = Number(source?.CurrencyAmount);
  if (!currency || !Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_SETTLEMENT_AMOUNT");
  return { currency, amount };
}

export function mapClosedFinancialEventGroup(
  group: Awaited<ReturnType<typeof listFinancialEventGroups>>[number],
  marketplace: string,
  transactions: AmazonSettlementCandidate["transactions"] = [],
): AmazonSettlementCandidate | null {
  if (group.ProcessingStatus !== "Closed") return null;
  const value = money(group);
  return {
    settlementId: group.FinancialEventGroupId,
    marketplace,
    processingStatus: group.ProcessingStatus,
    transferStatus: group.FundTransferStatus ?? null,
    currency: value.currency,
    amount: value.amount,
    cycleStart: group.FinancialEventGroupStart ?? null,
    cycleEnd: group.FinancialEventGroupEnd ?? null,
    fundTransferAt: group.FundTransferDate ?? null,
    traceId: group.TraceId ?? null,
    group,
    transactions,
  };
}

export async function importAmazonSettlements(input: AmazonSettlementImportInput) {
  const groups = await listFinancialEventGroups(input);
  const results = [];
  for (const group of groups) {
    if (group.ProcessingStatus !== "Closed") continue;
    const transactions = await listTransactions({
      financialEventGroupId: group.FinancialEventGroupId,
      postedAfter: group.FinancialEventGroupStart,
      postedBefore: group.FinancialEventGroupEnd,
    });
    const settlement = mapClosedFinancialEventGroup(group, input.marketplace, transactions);
    if (!settlement) continue;
    results.push({ settlementId: settlement.settlementId, reconciliation: await reconcileAmazonSettlementRpc(settlement) });
  }
  return { found: groups.length, imported: results.length, results };
}
