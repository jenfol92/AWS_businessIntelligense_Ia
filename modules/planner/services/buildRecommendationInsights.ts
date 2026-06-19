/**
 * Genera motivos, urgencia y textos legibles para cada línea del plan anual.
 */

import { CHINESE_NEW_YEAR_RISK_WINDOW, SALES_SPIKE_THRESHOLD } from "../config/plannerInsights.config";
import type {
  AnnualPurchasePlanLine,
  DemandForecastResult,
  PlanningProduct,
  RecommendationReasonCode,
  SupplySimulationResult,
} from "../types/planner.types";

export type RecommendationInsights = {
  recommendationReasonCode: RecommendationReasonCode;
  recommendationReasonLabel: string;
  recommendationExplanation: string;
  businessImpact: string;
  urgencyLabel: "Crítico" | "Urgente" | "Planificado" | "Observación";
  urgencyScore: number;
  latestSafeOrderDate: string | null;
  readableTiming: string;
};

const REASON_LABELS: Record<RecommendationReasonCode, string> = {
  STOCKOUT_RISK: "Riesgo de rotura",
  LOW_COVERAGE: "Cobertura baja",
  LEAD_TIME_REQUIRED: "Lead time largo",
  SALES_SPIKE: "Pico de ventas",
  SEASONALITY: "Estacionalidad",
  CHINESE_NEW_YEAR: "Año Nuevo Chino",
  NEW_PRODUCT_BENCHMARK: "Producto nuevo por benchmark",
  NO_HISTORY_FALLBACK: "Sin histórico suficiente",
};

type BuildInsightInput = {
  line: AnnualPurchasePlanLine;
  product: PlanningProduct;
  forecast: DemandForecastResult;
  simulation: SupplySimulationResult;
  salesLast30Days?: number;
  salesAvgDaily90Days?: number;
};

function parseIso(iso: string): Date | null {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatEsDate(iso: string): string {
  const d = parseIso(iso);
  if (!d) return iso;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function leadTimeTotalDays(product: PlanningProduct): number {
  return (
    (product.leadTimeProductionDays ?? 0) +
    (product.leadTimeSeaDays ?? 0) +
    (product.leadTimeLandDays ?? 0)
  );
}

/** Comprueba si una fecha cae en o cerca de la ventana de Año Nuevo Chino. */
export function isNearChineseNewYearWindow(isoDate: string | null): boolean {
  if (!isoDate) return false;
  const d = parseIso(isoDate);
  if (!d) return false;

  const year = d.getUTCFullYear();
  const windowStart = Date.UTC(
    year,
    CHINESE_NEW_YEAR_RISK_WINDOW.startMonth - 1,
    CHINESE_NEW_YEAR_RISK_WINDOW.startDay,
  );
  const windowEnd = Date.UTC(
    year,
    CHINESE_NEW_YEAR_RISK_WINDOW.endMonth - 1,
    CHINESE_NEW_YEAR_RISK_WINDOW.endDay,
    23,
    59,
    59,
  );
  const preWindowStart = windowStart - CHINESE_NEW_YEAR_RISK_WINDOW.daysBeforeWindow * 86400000;
  const t = d.getTime();

  return t >= preWindowStart && t <= windowEnd;
}

function hasSalesSpike(sales30: number | undefined, avgDaily90: number | undefined): boolean {
  if (sales30 == null || avgDaily90 == null || avgDaily90 <= 0) return false;
  const avgDaily30 = sales30 / 30;
  return avgDaily30 > avgDaily90 * SALES_SPIKE_THRESHOLD;
}

function hasSeasonalityProfile(product: PlanningProduct): boolean {
  const p = (product.seasonalityProfile ?? "").trim().toLowerCase();
  return Boolean(p && !p.includes("evergreen"));
}

function availableStock(product: PlanningProduct): number {
  return (product.stockTotal ?? 0) + (product.stockInboundConfirmed ?? 0);
}

function buildReadableTiming(line: AnnualPurchasePlanLine): string {
  if (line.orderTimingStatus === "OVERDUE" && line.daysLate > 0) {
    return `Debió pedirse hace ${line.daysLate} día${line.daysLate === 1 ? "" : "s"}`;
  }
  if (line.orderTimingStatus === "DUE_NOW") {
    return "Pedir esta semana";
  }
  if (line.recommendedOrderDate) {
    return `Planificado para ${formatEsDate(line.recommendedOrderDate)}`;
  }
  return "Sin fecha definida";
}

function computeUrgency(
  line: AnnualPurchasePlanLine,
  simulation: SupplySimulationResult,
): Pick<RecommendationInsights, "urgencyLabel" | "urgencyScore"> {
  let score = 20;

  if (simulation.stockoutMonthIndex != null) score += 35;
  if (line.orderTimingStatus === "OVERDUE") {
    score += Math.min(40, 10 + line.daysLate);
  } else if (line.orderTimingStatus === "DUE_NOW") {
    score += 25;
  }

  if (score >= 75) return { urgencyLabel: "Crítico", urgencyScore: Math.min(100, score) };
  if (score >= 50) return { urgencyLabel: "Urgente", urgencyScore: score };
  if (score >= 30) return { urgencyLabel: "Planificado", urgencyScore: score };
  return { urgencyLabel: "Observación", urgencyScore: score };
}

function pickReason(input: BuildInsightInput): {
  code: RecommendationReasonCode;
  explanation: string;
  businessImpact: string;
} {
  const { line, product, forecast, simulation, salesLast30Days, salesAvgDaily90Days } = input;
  const leadDays = leadTimeTotalDays(product);
  const stock = availableStock(product);
  const coverageAfter = line.expectedCoverageDaysAfterOrder;
  const targetDays = line.targetCoverageDays;

  if (isNearChineseNewYearWindow(line.recommendedOrderDate)) {
    return {
      code: "CHINESE_NEW_YEAR",
      explanation:
        "La fecha recomendada cae cerca del periodo de parón por Año Nuevo Chino. Conviene adelantar pedido.",
      businessImpact:
        "Si se retrasa el pedido, la producción o el despacho pueden quedar bloqueados durante la ventana festiva.",
    };
  }

  if (hasSalesSpike(salesLast30Days, salesAvgDaily90Days)) {
    return {
      code: "SALES_SPIKE",
      explanation:
        "Las ventas recientes están por encima de la media, por lo que aumenta la necesidad de reposición.",
      businessImpact:
        "Sin reposición, el stock puede agotarse antes de lo previsto por el incremento de demanda.",
    };
  }

  if (simulation.stockoutMonthIndex != null || simulation.estimatedStockoutDate) {
    const stockoutText = simulation.estimatedStockoutDate
      ? `Rotura estimada hacia ${formatEsDate(simulation.estimatedStockoutDate)}.`
      : "La simulación prevé rotura de stock en el horizonte analizado.";
    return {
      code: "STOCKOUT_RISK",
      explanation: `Stock actual (${stock} uds.) insuficiente para cubrir la demanda prevista. ${stockoutText}`,
      businessImpact:
        "Si no se pide, el producto puede quedar sin stock antes de la llegada estimada del pedido.",
    };
  }

  if (
    coverageAfter != null &&
    targetDays > 0 &&
    coverageAfter < targetDays * 0.6
  ) {
    return {
      code: "LOW_COVERAGE",
      explanation: `Tras el pedido la cobertura sería de ~${Math.round(coverageAfter)} días, por debajo del objetivo de ${targetDays} días.`,
      businessImpact:
        "La cobertura quedaría corta y aumenta el riesgo de quedar sin stock entre pedidos.",
    };
  }

  if (forecast.method === "NEW_PRODUCT_BENCHMARK") {
    return {
      code: "NEW_PRODUCT_BENCHMARK",
      explanation:
        "Producto nuevo sin histórico propio; la recomendación se basa en benchmark de competidores.",
      businessImpact:
        "Sin pedido inicial, se pierde oportunidad de lanzamiento y posicionamiento en marketplace.",
    };
  }

  if (hasSeasonalityProfile(product)) {
    return {
      code: "SEASONALITY",
      explanation: `Perfil estacional (${product.seasonalityProfile}) que refuerza la necesidad de reposición en este periodo.`,
      businessImpact:
        "Si no se cubre la demanda estacional, se pueden perder ventas en el pico previsto.",
    };
  }

  if (leadDays >= 45 && line.orderTimingStatus === "OVERDUE") {
    return {
      code: "LEAD_TIME_REQUIRED",
      explanation: `Stock actual insuficiente para cubrir el lead time de ${leadDays} días. ${buildReadableTiming(line)}.`,
      businessImpact:
        "El plazo de producción y tránsito es largo; cada día de retraso acerca la rotura de stock.",
    };
  }

  if (forecast.method === "NO_HISTORY") {
    return {
      code: "NO_HISTORY_FALLBACK",
      explanation:
        "No hay histórico de ventas suficiente; se aplica regla conservadora de reposición.",
      businessImpact:
        "Sin pedido, no hay cobertura garantizada hasta disponer de más datos de venta.",
    };
  }

  return {
    code: "LOW_COVERAGE",
    explanation: `Reposición recomendada para mantener ${targetDays} días de cobertura con ${line.recommendedOrderUnits} unidades.`,
    businessImpact:
      "Si no se pide, la disponibilidad puede reducirse y afectar ventas continuas.",
  };
}

export function buildRecommendationInsights(input: BuildInsightInput): RecommendationInsights {
  const { line, simulation } = input;
  const { code, explanation, businessImpact } = pickReason(input);
  const { urgencyLabel, urgencyScore } = computeUrgency(line, simulation);

  return {
    recommendationReasonCode: code,
    recommendationReasonLabel: REASON_LABELS[code],
    recommendationExplanation: explanation,
    businessImpact,
    urgencyLabel,
    urgencyScore,
    latestSafeOrderDate:
      simulation.replenishment?.latestOrderDate ?? line.recommendedOrderDate,
    readableTiming: buildReadableTiming(line),
  };
}
