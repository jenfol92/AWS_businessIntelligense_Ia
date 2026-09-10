import { Text } from "@tremor/react";

import {
  forecastMethodLabel,
  riskLabel,
} from "../services/buildInventoryProduct";

import type {
  InventoryProductCoreResponse,
  InventoryProductForecastResponse,
} from "../types/inventory.types";

function fmtNum(
  n: number | null | undefined,
  digits = 0,
): string {
  if (n == null || Number.isNaN(n)) return "—";

  return n.toLocaleString("es-ES", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function InventoryKpiGrid({
  detail,
  forecast,
}: {
  detail: InventoryProductCoreResponse;
  forecast?: InventoryProductForecastResponse["forecast"] | null;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        {
          label: "Ventas 30d",
          value: fmtNum(detail.product.salesUnits30),
        },
        {
          label: "Ventas 60d",
          value: fmtNum(detail.product.salesUnits60),
        },
        {
          label: "Ventas 90d",
          value: fmtNum(detail.product.salesUnits90),
        },
        {
          label: `Ventas ${detail.periodLabel}`,
          value: fmtNum(detail.product.salesUnitsPeriod),
        },
        {
          label:
            detail.product.stockFbm == null
              ? "Cobertura FBA"
              : "Cobertura operativa",
          value:
            detail.product.coverageDays != null
              ? `${Math.round(detail.product.coverageDays)} d`
              : "—",
        },
        {
          label: "Riesgo",
          value: riskLabel(detail.product.risk),
        },
        {
          label: "Inbound conf.",
          value: fmtNum(
            detail.inboundUnitsConfirmedTotal ??
              detail.inboundUnitsTotal,
          ),
        },
        {
          label: "Inbound prov.",
          value: fmtNum(
            detail.inboundUnitsProvisionalTotal ?? 0,
          ),
        },
        {
          label: "Forecast",
          value: forecast
            ? forecastMethodLabel(forecast.method)
            : "Calculando…",
        },
      ].map(({ label, value }) => (
        <div
          key={label}
          className="rounded-lg border border-slate-100 bg-slate-50/60 p-2"
        >
          <Text className="text-[10px] uppercase text-slate-400">
            {label}
          </Text>

          <p className="text-sm font-semibold text-slate-900">
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}