import { fetchProductFbaStockDailyByYear } from "@/modules/inventory/repositories/inventoryRepository";
import type {
  StockoutCorrectedMonth,
  StockoutCorrectionConfidence,
  StockoutCorrectionResult,
} from "../types/stockoutCorrection.types";
import {
  buildStockoutCorrectionDebugPayload,
  isStockoutDebugSku,
  logStockoutCorrectionDebug,
} from "./stockoutCorrectionDebug";

export type CorrectOwnSalesForStockoutsInput = {
  productId: string;
  sku?: string;
  country: string | "ALL";
  channel: string | "ALL" | "AMAZON_FBA" | "AMAZON_FBM";
  baseYear: number;
  monthlyOwnSales: number[];
  benchmarkMonthlyUnits?: number[];
};

function daysInCalendarMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function isoDate(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function overallConfidence(
  months: StockoutCorrectedMonth[],
): StockoutCorrectionConfidence {
  if (months.some((m) => m.confidence === "LOW")) return "LOW";
  if (months.some((m) => m.confidence === "MEDIUM")) return "MEDIUM";
  return "HIGH";
}

function countDaysWithStockForMonth(
  stockByDate: Map<string, number>,
  year: number,
  monthIndex0: number,
): {
  daysInMonth: number;
  daysWithStock: number;
  snapshotDays: number;
  missingSnapshotDays: number;
} {
  const daysInMonth = daysInCalendarMonth(year, monthIndex0);
  let daysWithStock = 0;
  let snapshotDays = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = isoDate(year, monthIndex0 + 1, day);
    if (!stockByDate.has(date)) continue;
    snapshotDays += 1;
    if ((stockByDate.get(date) ?? 0) > 0) {
      daysWithStock += 1;
    }
  }

  return {
    daysInMonth,
    daysWithStock,
    snapshotDays,
    missingSnapshotDays: Math.max(0, daysInMonth - snapshotDays),
  };
}

export function computeStockoutCorrection(
  input: Omit<CorrectOwnSalesForStockoutsInput, "productId" | "sku"> & {
    stockByDate: Map<string, number>;
    channelAllowsCorrection: boolean;
    hasStockHistory: boolean;
  },
): StockoutCorrectionResult {
  const warnings: string[] = [];
  const monthly: StockoutCorrectedMonth[] = [];
  let totalActual = 0;
  let totalCorrected = 0;
  let totalLost = 0;
  let correctedMonthsCount = 0;

  if (!input.channelAllowsCorrection) {
    if (input.channel === "AMAZON_FBM" || input.channel === "FBM") {
      warnings.push(
        "No hay histórico FBM equivalente para corrección por rotura; se usan ventas reales.",
      );
    }
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const actualSalesUnits = input.monthlyOwnSales[monthIndex] ?? 0;
      const daysInMonth = daysInCalendarMonth(input.baseYear, monthIndex);
      monthly.push({
        monthIndex: monthIndex + 1,
        daysInMonth,
        actualSalesUnits,
        daysWithStock: daysInMonth,
        stockoutDays: 0,
        correctedSalesUnits: actualSalesUnits,
        estimatedLostDemandUnits: 0,
        correctionFactor: 1,
        confidence: "HIGH",
      });
      totalActual += actualSalesUnits;
      totalCorrected += actualSalesUnits;
    }
    return {
      monthly,
      totalActualSales: totalActual,
      totalCorrectedSales: totalCorrected,
      totalEstimatedLostDemand: 0,
      correctedMonthsCount: 0,
      overallConfidence: "HIGH",
      applied: false,
      warnings,
    };
  }

  if (!input.hasStockHistory) {
    warnings.push(
      "Sin histórico FBA en v_product_fba_stock_daily para el año base; no se puede corregir por rotura.",
    );
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const actualSalesUnits = input.monthlyOwnSales[monthIndex] ?? 0;
      const daysInMonth = daysInCalendarMonth(input.baseYear, monthIndex);
      monthly.push({
        monthIndex: monthIndex + 1,
        daysInMonth,
        actualSalesUnits,
        daysWithStock: 0,
        stockoutDays: daysInMonth,
        correctedSalesUnits: actualSalesUnits,
        estimatedLostDemandUnits: 0,
        correctionFactor: 1,
        confidence: "LOW",
        warning: "Sin datos de stock FBA.",
      });
      totalActual += actualSalesUnits;
      totalCorrected += actualSalesUnits;
    }
    return {
      monthly,
      totalActualSales: totalActual,
      totalCorrectedSales: totalCorrected,
      totalEstimatedLostDemand: 0,
      correctedMonthsCount: 0,
      overallConfidence: "LOW",
      applied: false,
      warnings,
    };
  }

  if (input.channel === "ALL") {
    warnings.push(
      "La corrección de stockout usa histórico FBA. No hay histórico equivalente para FBM.",
    );
  }

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const actualSalesUnits = Math.max(0, input.monthlyOwnSales[monthIndex] ?? 0);
    const { daysInMonth, daysWithStock, snapshotDays, missingSnapshotDays } =
      countDaysWithStockForMonth(input.stockByDate, input.baseYear, monthIndex);

    let correctedSalesUnits = actualSalesUnits;
    let estimatedLostDemandUnits = 0;
    let correctionFactor = 1;
    let confidence: StockoutCorrectionConfidence = "HIGH";
    let warning: string | undefined;

    const stockoutDays = Math.max(0, daysInMonth - daysWithStock);

    if (snapshotDays === 0) {
      warning = "Sin snapshots FBA en el mes; no se corrige.";
      confidence = "LOW";
    } else {
      if (missingSnapshotDays > 0) {
        warning = `${missingSnapshotDays} días del mes sin snapshot FBA; se tratan como rotura histórica.`;
        if (confidence === "HIGH") confidence = "MEDIUM";
      }

      if (actualSalesUnits > 0 && daysWithStock === 0) {
        warning = warning ?? "No hubo días con stock; no se puede estimar demanda corregida.";
        confidence = "LOW";
      } else if (
        actualSalesUnits > 0 &&
        daysWithStock > 0 &&
        daysWithStock < daysInMonth
      ) {
        correctedSalesUnits = Math.ceil((actualSalesUnits / daysWithStock) * daysInMonth);
        estimatedLostDemandUnits = Math.max(0, correctedSalesUnits - actualSalesUnits);
        correctionFactor =
          actualSalesUnits > 0 ? correctedSalesUnits / actualSalesUnits : 1;
        correctedMonthsCount += 1;

        if (daysWithStock < 7) {
          confidence = "LOW";
          warning =
            warning ?? "Muy pocos días con stock; corrección poco fiable.";
        } else if (daysWithStock < daysInMonth * 0.5) {
          confidence = "MEDIUM";
        } else {
          confidence = "MEDIUM";
        }
      }
    }

    const benchmarkCap = input.benchmarkMonthlyUnits?.[monthIndex];
    if (benchmarkCap != null && benchmarkCap > 0) {
      const capped = Math.ceil(benchmarkCap * 1.25);
      if (correctedSalesUnits > capped) {
        correctedSalesUnits = capped;
        estimatedLostDemandUnits = Math.max(0, correctedSalesUnits - actualSalesUnits);
        correctionFactor =
          actualSalesUnits > 0 ? correctedSalesUnits / actualSalesUnits : 1;
        warnings.push(
          `Mes ${monthIndex + 1}: corrección limitada por cap de benchmark (×1.25).`,
        );
      }
    } else if (actualSalesUnits > 0 && correctedSalesUnits > actualSalesUnits * 3) {
      correctedSalesUnits = Math.ceil(actualSalesUnits * 3);
      estimatedLostDemandUnits = Math.max(0, correctedSalesUnits - actualSalesUnits);
      correctionFactor = correctedSalesUnits / actualSalesUnits;
      warnings.push(
        `Mes ${monthIndex + 1}: corrección limitada por cap de seguridad (×3 ventas reales).`,
      );
    }

    monthly.push({
      monthIndex: monthIndex + 1,
      daysInMonth,
      actualSalesUnits,
      daysWithStock,
      snapshotDays,
      missingSnapshotDays,
      stockoutDays,
      correctedSalesUnits,
      estimatedLostDemandUnits,
      correctionFactor,
      confidence,
      warning,
    });

    totalActual += actualSalesUnits;
    totalCorrected += correctedSalesUnits;
    totalLost += estimatedLostDemandUnits;
  }

  const uniqueWarnings = Array.from(new Set(warnings));

  const result: StockoutCorrectionResult = {
    monthly,
    totalActualSales: totalActual,
    totalCorrectedSales: totalCorrected,
    totalEstimatedLostDemand: totalLost,
    correctedMonthsCount,
    overallConfidence: overallConfidence(monthly),
    applied: correctedMonthsCount > 0,
    warnings: uniqueWarnings,
  };

  return result;
}

export async function correctOwnSalesForStockouts(
  input: CorrectOwnSalesForStockoutsInput & {
    effectiveMethod?: string;
    includeDebug?: boolean;
  },
): Promise<StockoutCorrectionResult> {
  const channel = input.channel ?? "ALL";
  const channelAllowsCorrection =
    channel === "ALL" || channel === "AMAZON_FBA" || channel === "FBA";

  const stockByDate = channelAllowsCorrection
    ? await fetchProductFbaStockDailyByYear(input.productId, input.baseYear)
    : new Map<string, number>();

  const result = computeStockoutCorrection({
    ...input,
    stockByDate,
    channelAllowsCorrection,
    hasStockHistory: stockByDate.size > 0,
  });

  const shouldDebug =
    input.includeDebug === true || isStockoutDebugSku(input.sku);
  if (shouldDebug) {
    const debug = buildStockoutCorrectionDebugPayload({
      productId: input.productId,
      sku: input.sku,
      method: input.effectiveMethod ?? "OWN_SALES_CORRECTED",
      country: input.country,
      channel: input.channel,
      baseYear: input.baseYear,
      actualMonthlySales: input.monthlyOwnSales,
      result,
    });
    result.debug = debug;
    logStockoutCorrectionDebug(debug);
  }

  return result;
}
