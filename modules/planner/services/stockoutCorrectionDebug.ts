import type {
  StockoutCorrectionDebugPayload,
  StockoutCorrectionResult,
} from "../types/stockoutCorrection.types";

const DEFAULT_DEBUG_SKUS = new Set(["8436616610104", "8436616610098"]);

export function isStockoutDebugSku(sku?: string | null): boolean {
  if (!sku) return false;
  const env = process.env.STOCKOUT_DEBUG_SKUS?.trim();
  if (env) {
    const list = env.split(",").map((s) => s.trim()).filter(Boolean);
    return list.includes(sku);
  }
  return DEFAULT_DEBUG_SKUS.has(sku);
}

export function buildStockoutCorrectionDebugPayload(params: {
  productId: string;
  sku?: string;
  method: string;
  country: string;
  channel: string;
  baseYear: number;
  actualMonthlySales: number[];
  result: StockoutCorrectionResult;
}): StockoutCorrectionDebugPayload {
  const { result } = params;
  return {
    productId: params.productId,
    sku: params.sku,
    method: params.method,
    country: params.country,
    channel: params.channel,
    baseYear: params.baseYear,
    actualMonthlySales: params.actualMonthlySales,
    daysWithStockByMonth: result.monthly.map((m) => m.daysWithStock),
    stockoutDaysByMonth: result.monthly.map((m) => m.stockoutDays),
    snapshotDaysByMonth: result.monthly.map((m) => m.snapshotDays ?? 0),
    correctedMonthlySales: result.monthly.map((m) => m.correctedSalesUnits),
    totalActualSales: result.totalActualSales,
    totalCorrectedSales: result.totalCorrectedSales,
    totalEstimatedLostDemand: result.totalEstimatedLostDemand,
    applied: result.applied,
    overallConfidence: result.overallConfidence,
    warnings: result.warnings,
  };
}

export function logStockoutCorrectionDebug(payload: StockoutCorrectionDebugPayload): void {
  console.info("[stockout-correction:debug]", JSON.stringify(payload, null, 2));
}
