import type { PurchasePaymentCandidate } from "../types/purchasePaymentBatch.types";

export function selectedPurchasePaymentRows(
  selected: Map<string, PurchasePaymentCandidate>,
): PurchasePaymentCandidate[] {
  return Array.from(selected.values());
}

export function canAddPurchasePaymentCandidate(
  selected: Map<string, PurchasePaymentCandidate>,
  candidate: PurchasePaymentCandidate,
): boolean {
  const first = selected.values().next().value as PurchasePaymentCandidate | undefined;
  return !first
    || (first.agentId === candidate.agentId
      && first.originalCurrency === candidate.originalCurrency);
}

export function togglePurchasePaymentCandidate(
  selected: Map<string, PurchasePaymentCandidate>,
  candidate: PurchasePaymentCandidate,
): Map<string, PurchasePaymentCandidate> {
  const next = new Map(selected);
  if (next.has(candidate.supplierPaymentId)) {
    next.delete(candidate.supplierPaymentId);
    return next;
  }
  if (canAddPurchasePaymentCandidate(next, candidate)) {
    next.set(candidate.supplierPaymentId, candidate);
  }
  return next;
}
