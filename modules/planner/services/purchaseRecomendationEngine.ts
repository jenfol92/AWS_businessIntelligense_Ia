// modules/planner/services/purchaseRecomendationEngine.ts

import type { PlanningProduct } from "../types/planner.types";

function calculateSuggestedUnits(
  product: PlanningProduct,
  dailySales: number,
): number {
  if (dailySales <= 0) return 0;
  const targetDays = 45;
  const needed = dailySales * targetDays - product.stockTotal;
  return Math.max(0, Math.ceil(needed));
}

export function calculatePurchaseRecommendation(product: PlanningProduct) {
  const dailySales = product.salesUnits / product.windowDays;
  const coverageDays =
    dailySales > 0 ? product.stockTotal / dailySales : 999;

  let status = "ok";

  if (coverageDays < 15) status = "urgente";
  else if (coverageDays < 30) status = "pedir_ya";
  else if (coverageDays > 180) status = "sobrestock";

  return {
    productId: product.id,
    sku: product.sku,
    coverageDays,
    status,
    suggestedUnits: calculateSuggestedUnits(product, dailySales),
  };
}
