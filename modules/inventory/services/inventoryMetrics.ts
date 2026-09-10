// modules/inventory/services/inventoryMetrics.ts
//
// Cálculos compartidos de cobertura y riesgo para inventario por país.

import type { InventoryRiskLevel } from "../types/inventory.types";
import { resolveChannelScope } from "./inventoryScope";

export function countryStockTotal(
  stockFba: number,
  stockFbm: number,
  stockPais: number | null,
  canal: string,
): number {
  const scope = resolveChannelScope(canal);
  if (scope.filter === "AMAZON_FBA") return stockFba;
  if (scope.filter === "AMAZON_FBM") return stockFbm;
  if (stockPais != null && stockPais > 0) return stockPais;
  return stockFba + stockFbm;
}

export function avgDaily(units: number, windowDays: number): number {
  return windowDays > 0 ? units / windowDays : 0;
}

export function coverageDays(
  stockTotal: number,
  avgDailySales: number,
): number | null {
  if (avgDailySales <= 0) return null;
  return stockTotal / avgDailySales;
}

/** Riesgo por país (reglas alineadas con comparison legacy). */
export function countryRisk(
  stockTotal: number,
  coverage: number | null,
): InventoryRiskLevel {
  if (stockTotal === 0) return "critico";
  if (coverage == null) return "sin_ventas";
  if (coverage <= 60) return "critico";
  if (coverage <= 120) return "bajo";
  if (coverage <= 180) return "saludable";
  return "exceso";
}

/** Riesgo global del producto a partir de países y vista stock. */
export function productRisk(
  countryRisks: InventoryRiskLevel[],
  viewRisk: string | null | undefined,
): InventoryRiskLevel {
  if (viewRisk === "critico") return "critico";
  if (viewRisk === "bajo") return "bajo";
  if (viewRisk === "saludable") return "saludable";
  if (viewRisk === "exceso") return "exceso";
  if (viewRisk === "sin_ventas") return "sin_ventas";

  if (countryRisks.some((r) => r === "critico")) return "critico";
  if (countryRisks.some((r) => r === "bajo")) return "bajo";
  if (countryRisks.some((r) => r === "saludable")) return "saludable";
  if (countryRisks.some((r) => r === "exceso")) return "exceso";
  if (countryRisks.every((r) => r === "sin_ventas")) return "sin_ventas";
  return "saludable";
}

/** Canal para ventas_diarias: FBA | FBM | ALL (sin filtro). */
export function normalizeCanal(raw: string | undefined): string {
  const scope = resolveChannelScope(raw);
  return scope.ventasCanal ?? "ALL";
}

export function salesKey(productoId: string, pais: string): string {
  return `${productoId}::${pais}`;
}

export function salesKeyGlobal(productoId: string): string {
  return `${productoId}::__ALL__`;
}
