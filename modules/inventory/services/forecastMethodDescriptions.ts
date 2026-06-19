// modules/inventory/services/forecastMethodDescriptions.ts
//
// Textos de ayuda por método de forecast (UI orientada a negocio).

import type { ForecastMethod } from "@/modules/planning/types";
import {
  FORECAST_METHOD_BUSINESS_LABELS,
  forecastMethodBusinessLabel,
} from "./forecastMethodUi";

export type ForecastMethodDescription = {
  method: ForecastMethod;
  title: string;
  description: string;
  /** Detalle técnico (solo acordeón). */
  sourcesUsed: string[];
  sourcesNotUsed: string[];
  notices: string[];
  recommendedWhen: string;
  /** Resumen corto para bloque principal de simulación. */
  businessSummary?: string;
};

export const FORECAST_METHOD_DESCRIPTIONS: Record<
  ForecastMethod,
  ForecastMethodDescription
> = {
  AUTO: {
    method: "AUTO",
    title: "Automático",
    description:
      "El sistema elige la fuente más adecuada según los datos disponibles del producto.",
    businessSummary:
      "Se resolverá automáticamente al histórico propio, competidores o mixto según disponibilidad.",
    sourcesUsed: [
      "ventas_diarias",
      "competitor_benchmark_snapshots",
      "product_competitor_benchmark_selection",
    ],
    sourcesNotUsed: [],
    notices: [],
    recommendedWhen:
      "Prefieres que el sistema decida según los datos disponibles.",
  },
  OWN_SALES: {
    method: "OWN_SALES",
    title: "Histórico propio",
    description:
      "Estima la demanda a partir de las ventas reales del producto. Recomendable cuando hubo stock suficiente y el histórico es fiable.",
    businessSummary:
      "Usa las ventas registradas del producto como base del forecast.",
    sourcesUsed: ["ventas_diarias", "inventario_paises"],
    sourcesNotUsed: ["competidores"],
    notices: [],
    recommendedWhen:
      "El producto tiene histórico fiable y no hubo roturas prolongadas.",
  },
  OWN_SALES_CORRECTED: {
    method: "OWN_SALES_CORRECTED",
    title: "Histórico corregido por roturas",
    description:
      "Este método estima la demanda real corrigiendo los meses en los que faltó stock. Usa histórico de stock FBA para estimar ventas perdidas por rotura.",
    businessSummary:
      "Este método estima la demanda real corrigiendo los meses en los que faltó stock.",
    sourcesUsed: [
      "ventas_diarias",
      "v_product_fba_stock_daily",
    ],
    sourcesNotUsed: ["histórico diario FBM (no disponible aún)"],
    notices: [
      "No hay histórico diario de stock FBM. Para corregir roturas FBM hay que importar snapshots diarios de stock FBM o stock de almacén propio.",
      "La corrección por rotura actual aplica a stock FBA.",
    ],
    recommendedWhen:
      "Tuviste roturas de stock y las ventas registradas no reflejan la demanda real.",
  },
  COMPETITOR_BENCHMARK: {
    method: "COMPETITOR_BENCHMARK",
    title: "Competidores",
    description:
      "Usa las ventas mensuales estimadas de competidores seleccionados. Útil para productos nuevos o sin histórico fiable.",
    businessSummary:
      "Estima la demanda a partir del benchmark de competidores seleccionados.",
    sourcesUsed: [
      "competitor_benchmark_snapshots",
      "product_competitor_benchmark_selection",
    ],
    sourcesNotUsed: ["ventas propias como fuente principal"],
    notices: [],
    recommendedWhen:
      "Producto nuevo, sin ventas propias o con histórico poco representativo.",
  },
  MIXED: {
    method: "MIXED",
    title: "Mixto histórico + competencia",
    description:
      "Combina ventas propias y benchmark de competidores según los pesos configurados.",
    businessSummary:
      "Mezcla histórico propio y competencia según los pesos que configures.",
    sourcesUsed: [
      "ventas_diarias",
      "competitor_benchmark_snapshots",
      "forecast_mix_own_weight",
      "forecast_mix_competitor_weight",
    ],
    sourcesNotUsed: [],
    notices: [],
    recommendedWhen:
      "Hay ventas propias y benchmark, pero las ventas pueden estar infravaloradas.",
  },
  MANUAL: {
    method: "MANUAL",
    title: "Manual",
    description:
      "Introducción manual del forecast mes a mes (en preparación).",
    businessSummary: "Forecast definido manualmente por el usuario.",
    sourcesUsed: [],
    sourcesNotUsed: ["cálculo automático"],
    notices: ["Forecast manual en preparación."],
    recommendedWhen:
      "Quieres fijar unidades mes a mes sin depender de histórico ni competidores.",
  },
};

export function getForecastMethodDescription(
  method: ForecastMethod,
): ForecastMethodDescription {
  return FORECAST_METHOD_DESCRIPTIONS[method];
}

export function formatMethodOptionLabel(method: ForecastMethod): string {
  return forecastMethodBusinessLabel(method);
}

export { FORECAST_METHOD_BUSINESS_LABELS, forecastMethodBusinessLabel };
