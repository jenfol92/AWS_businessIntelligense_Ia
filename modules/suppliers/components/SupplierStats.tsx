"use client";

import type { SupplierEnriched } from "../types/supplier.types";

type SupplierStatsProps = {
  rows: SupplierEnriched[];
};

function avg(values: number[]) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

export function SupplierStats({ rows }: SupplierStatsProps) {
  const total = rows.length;
  const withPort = rows.filter((r) => r.puerto_preferido_nombre).length;
  const withoutPort = total - withPort;
  const withAgent = rows.filter((r) => r.agente_id).length;

  const avgProduction = avg(
    rows
      .map((r) => r.dias_produccion_estandar)
      .filter((v): v is number => v != null && v >= 0),
  );
  const avgTransit = avg(
    rows
      .map((r) => r.dias_transito_estandar)
      .filter((v): v is number => v != null && v >= 0),
  );

  const cards = [
    { label: "Total proveedores", value: total },
    { label: "Con puerto asignado", value: withPort },
    { label: "Sin puerto", value: withoutPort },
    { label: "Producción media (días)", value: avgProduction ?? "—" },
    { label: "Tránsito medio (días)", value: avgTransit ?? "—" },
    { label: "Con agente", value: withAgent },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {card.label}
          </div>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}
