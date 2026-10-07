"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancePlanningResponse } from "../types/planning.types";
import { AmazonDeferredReleaseModal } from "./AmazonDeferredReleaseModal";
import {
  buildAmazonAnnualChartRows,
  formatPlanningEur,
  monthAxisLabel,
  unvaluedSummary,
} from "./amazonPlanningFormat";

type ChartRow = ReturnType<typeof buildAmazonAnnualChartRows>[number];
type AnnualView = "chart" | "list";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | null; payload: ChartRow }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
      <div className="font-semibold text-slate-900">{label ?? row.month}</div>
      <div className="mt-2 space-y-1 text-slate-700">
        <div>
          <span className="font-medium text-violet-800">Liberación Amazon prevista:</span>{" "}
          {formatPlanningEur(row.deferredKnown)}
          <span className="block text-slate-500">Importe retenido observado · liberación prevista por Amazon</span>
          {row.deferredIncomplete ? (
            <span className="block text-amber-700">Incompleto · importes sin valorar en EUR</span>
          ) : null}
        </div>
        <div>
          <span className="font-medium text-emerald-800">Transferencia en curso (fecha bancaria est.):</span>{" "}
          {formatPlanningEur(row.pendingKnown)}
        </div>
        <div>
          <span className="font-medium text-sky-800">Forecast ERP (estimado):</span>{" "}
          {formatPlanningEur(row.futureEstimated)}
        </div>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">Capas separadas · no sumar como ingreso bancario único</p>
    </div>
  );
}

export function AmazonAnnualPlanningSection({ data }: { data: FinancePlanningResponse }) {
  const [releaseMonth, setReleaseMonth] = useState<string | null>(null);
  const [view, setView] = useState<AnnualView>("chart");

  const horizonMonths = data.amazonPlanningHorizonMonths;
  const layers = data.amazonPlanningLayers;
  const chartRows = useMemo(
    () =>
      buildAmazonAnnualChartRows(
        horizonMonths,
        layers.deferredAmazonRelease.monthly,
        layers.pendingBankByMonth.monthly,
        layers.futureForecastByMonth.monthly,
      ),
    [horizonMonths, layers.deferredAmazonRelease.monthly, layers.pendingBankByMonth.monthly, layers.futureForecastByMonth.monthly],
  );

  const handleBarClick = (row: ChartRow) => {
    const hasRelease =
      row.deferredKnown != null || row.deferredUnvaluedCount > 0 || row.deferredIncomplete;
    if (hasRelease) setReleaseMonth(row.month);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Amazon · Horizonte anual (12 meses)</h2>
          <p className="mt-1 text-xs text-slate-600">
            Importe retenido observado en Amazon, agrupado por fecha de liberación prevista por Amazon (maturityDate).
            <strong className="text-amber-800"> Liberación Amazon ≠ ingreso bancario.</strong>
          </p>
          <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
            <li>
              <span className="inline-block h-2 w-2 rounded-sm bg-violet-500 mr-1.5 align-middle" />
              Liberación Amazon prevista — importe retenido observado · liberación prevista por Amazon
            </li>
            <li>
              <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500 mr-1.5 align-middle" />
              Transferencia en curso — dinero real con fecha bancaria estimada
            </li>
            <li>
              <span className="inline-block h-2 w-2 rounded-sm bg-sky-400 mr-1.5 align-middle" />
              Forecast ERP — estimación separada de Amazon observado
            </li>
          </ul>
        </div>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3 min-w-[220px]">
          <div className="text-[11px] font-medium text-emerald-900">Liquidez Amazon actual (stock)</div>
          <div className="mt-1 text-lg font-bold text-emerald-800">
            {formatPlanningEur(layers.availableLiquidityStock.knownEur)}
          </div>
          <p className="mt-1 text-[10px] text-emerald-800/80">
            Stock actual disponible para solicitar · no distribuido por meses
          </p>
          {layers.availableLiquidityStock.observedAt ? (
            <p className="mt-1 text-[10px] text-slate-500">
              Snapshot: {new Date(layers.availableLiquidityStock.observedAt).toLocaleString("es-ES")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setView((current) => (current === "chart" ? "list" : "chart"))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            {view === "chart" ? "Cambiar a lista detallada" : "Cambiar a gráfica"}
          </button>
        </div>

        {view === "chart" ? (
          <>
            <div className="h-72 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartRows}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  barGap={2}
                  barCategoryGap="18%"
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="axisLabel" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={56} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} width={42} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="deferredKnown"
                    name="Liberación Amazon prevista"
                    fill="#7c3aed"
                    radius={[2, 2, 0, 0]}
                    onClick={(bar) => {
                      const row = bar?.payload as ChartRow | undefined;
                      if (row) handleBarClick(row);
                    }}
                    cursor="pointer"
                  />
                  <Bar dataKey="pendingKnown" name="Transferencia en curso" fill="#059669" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="futureEstimated" name="Forecast ERP" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <p className="text-[11px] text-slate-500">
              Pulsa una barra violeta (Liberación Amazon prevista) para ver días del mes y cargar transacciones bajo demanda.
            </p>
          </>
        ) : null}

        {view === "list" ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2 pr-3">Mes</th>
                  <th className="py-2 pr-3">Liberación Amazon prevista</th>
                  <th className="py-2 pr-3">Transferencia en curso</th>
                  <th className="py-2 pr-3">Forecast ERP</th>
                  <th className="py-2">Incompletitud</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {chartRows.map((row) => {
                  const bucket = row.deferredBucket;
                  const unvalued = bucket ? unvaluedSummary(bucket) : null;
                  const txCount = bucket?.transactionCount ?? 0;
                  const hasDeferredActivity = txCount > 0 || row.deferredKnown != null || row.deferredUnvaluedCount > 0;
                  return (
                    <tr key={row.month}>
                      <td className="py-2 pr-3 font-medium">{monthAxisLabel(row.month)}</td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="text-left text-violet-800 hover:underline disabled:text-slate-400"
                          disabled={!hasDeferredActivity}
                          onClick={() => setReleaseMonth(row.month)}
                        >
                          {formatPlanningEur(row.deferredKnown)}
                          {txCount > 0 ? ` · ${txCount} tx` : ""}
                        </button>
                      </td>
                      <td className="py-2 pr-3 text-emerald-800">{formatPlanningEur(row.pendingKnown)}</td>
                      <td className="py-2 pr-3 text-sky-800">{formatPlanningEur(row.futureEstimated)}</td>
                      <td className="py-2">
                        {bucket && !bucket.isComplete && (bucket.unvaluedCount > 0 || bucket.knownEur == null) ? (
                          <span className="text-amber-800">{unvalued ?? "Importes sin valorar en EUR"}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {releaseMonth ? (
        <AmazonDeferredReleaseModal
          month={releaseMonth}
          dailyBuckets={data.amazonDeferredRelease.dailyByReleaseDate}
          observedAt={data.amazonDeferredRelease.observedAt}
          onClose={() => setReleaseMonth(null)}
        />
      ) : null}
    </section>
  );
}
