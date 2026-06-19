// modules/products/components/ProductCatalogStats.tsx

import type { ProductCatalogItem } from "../types/catalog.types";

type ProductCatalogStatsProps = {
  rows: ProductCatalogItem[];
};

function avg(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number | null) {
  if (value === null) return "—";
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(1)}%`;
}

export function ProductCatalogStats({ rows }: ProductCatalogStatsProps) {
  const totalProducts = rows.length;
  const totalStock = rows.reduce((sum, row) => sum + row.stockTotal, 0);

  const averageMargin = avg(
    rows
      .map((row) => row.margenEstimado)
      .filter((value): value is number => value !== null)
  );

  const averageAcos = avg(
    rows
      .map((row) => row.acos30d)
      .filter((value): value is number => value !== null)
  );

  const riskProducts = rows.filter(
    (row) => row.riesgo === "critico" || row.riesgo === "alto"
  ).length;

  const cards = [
    { label: "Productos", value: totalProducts },
    { label: "Stock total", value: totalStock },
    { label: "Margen medio", value: formatPercent(averageMargin) },
    { label: "ACOS medio", value: formatPercent(averageAcos) },
    { label: "Riesgo stock", value: riskProducts },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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