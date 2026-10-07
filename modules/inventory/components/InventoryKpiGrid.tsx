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
  onOpenSales,
}: {
  detail: InventoryProductCoreResponse;
  forecast?: InventoryProductForecastResponse["forecast"] | null;
  /** Abre el modal de ventas por país del periodo seleccionado. */
  onOpenSales?: () => void;
}) {
  const orders = detail.salesOrders ?? null;
  const salesUnits = orders ? orders.units : detail.product.salesUnitsPeriod;

  const items: Array<{ label: string; value: string }> = [
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
  ];

  return (
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <button
        type="button"
        onClick={onOpenSales}
        disabled={!onOpenSales}
        className="rounded-lg border border-blue-100 bg-blue-50/60 p-2 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-default"
        title="Ver ventas por país"
      >
        <Text className="text-[10px] uppercase text-slate-400">
          Ventas {detail.periodLabel}
        </Text>
        <p className="text-sm font-semibold text-blue-800">
          {fmtNum(salesUnits)} uds
          <span className="ml-1 text-[10px] font-normal text-blue-600">
            ver por país ›
          </span>
        </p>
        <p className="text-[10px] text-slate-500">
          {orders?.source === "amazon_orders"
            ? `FBA ${fmtNum(orders.unitsFba)} · FBM ${fmtNum(orders.unitsFbm)}${
                orders.unitsPending > 0 ? ` · ${fmtNum(orders.unitsPending)} pend.` : ""
              } · por fecha de compra`
            : "Envíos FBA · por fecha de envío"}
        </p>
      </button>
      {items.map(({ label, value }) => (
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
