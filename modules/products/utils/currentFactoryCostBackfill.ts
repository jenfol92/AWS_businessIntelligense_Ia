import { assertProductCostCurrency } from "./productCostCurrency";

export type ConfirmedOrderCostCandidate = {
  orderId: string;
  productId: string | null;
  currency: string | null;
  amount: number | null;
  confirmedAt: string | null;
  createdAt: string | null;
  lineId?: string | null;
};

export function selectLatestConfirmedCostByProductCurrency(
  rows: ConfirmedOrderCostCandidate[],
): ConfirmedOrderCostCandidate[] {
  const byKey = new Map<string, ConfirmedOrderCostCandidate>();
  const ordered = [...rows].sort((a, b) => {
    const confirmed = String(b.confirmedAt ?? "").localeCompare(
      String(a.confirmedAt ?? ""),
    );
    if (confirmed !== 0) return confirmed;
    const created = String(b.createdAt ?? "").localeCompare(
      String(a.createdAt ?? ""),
    );
    if (created !== 0) return created;
    const order = String(b.orderId).localeCompare(String(a.orderId));
    if (order !== 0) return order;
    return String(b.lineId ?? "").localeCompare(String(a.lineId ?? ""));
  });

  for (const row of ordered) {
    if (!row.productId || row.amount == null || row.amount <= 0) continue;
    const currency = assertProductCostCurrency(row.currency);
    const key = `${row.productId}|${currency}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...row, currency });
    }
  }

  return Array.from(byKey.values());
}
