export type StockoutCorrectionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type StockoutCorrectedMonth = {
  monthIndex: number;
  daysInMonth: number;
  actualSalesUnits: number;
  daysWithStock: number;
  snapshotDays?: number;
  missingSnapshotDays?: number;
  stockoutDays: number;
  correctedSalesUnits: number;
  estimatedLostDemandUnits: number;
  correctionFactor: number;
  confidence: StockoutCorrectionConfidence;
  warning?: string;
};

export type StockoutCorrectionDebugPayload = {
  productId: string;
  sku?: string;
  method: string;
  country: string;
  channel: string;
  baseYear: number;
  actualMonthlySales: number[];
  daysWithStockByMonth: number[];
  stockoutDaysByMonth: number[];
  snapshotDaysByMonth: number[];
  correctedMonthlySales: number[];
  totalActualSales: number;
  totalCorrectedSales: number;
  totalEstimatedLostDemand: number;
  applied: boolean;
  overallConfidence: string;
  warnings: string[];
};

export type StockoutCorrectionResult = {
  monthly: StockoutCorrectedMonth[];
  totalActualSales: number;
  totalCorrectedSales: number;
  totalEstimatedLostDemand: number;
  correctedMonthsCount: number;
  overallConfidence: StockoutCorrectionConfidence;
  applied: boolean;
  warnings: string[];
  debug?: StockoutCorrectionDebugPayload;
};
