"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ForecastMethodInfo } from "../services/buildForecastMethodInfo";
import { forecastMethodBusinessLabel } from "../services/forecastMethodUi";

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
}

type Props = {
  info: ForecastMethodInfo;
  variant?: "full" | "compact";
  className?: string;
  stockoutCorrectionSummary?: {
    totalActualSales: number;
    totalCorrectedSales: number;
    totalEstimatedLostDemand: number;
    correctedMonthsCount: number;
  } | null;
};

export function ForecastMethodExplanationBox({
  info,
  variant = "full",
  className = "",
  stockoutCorrectionSummary,
}: Props) {
  const [showTechnical, setShowTechnical] = useState(false);
  const configuredLabel = forecastMethodBusinessLabel(info.configuredMethod);
  const effectiveLabel = forecastMethodBusinessLabel(info.effectiveMethod);
  const showEffective =
    info.configuredMethod === "AUTO" ||
    (info.configuredMethod !== info.effectiveMethod && info.fallbackApplied);

  if (variant === "compact") {
    return (
      <div
        className={`rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-700 ${className}`}
      >
        <p className="font-medium text-slate-900">
          {showEffective ? effectiveLabel : configuredLabel}
        </p>
        <p className="mt-1 text-slate-600">{info.businessSummary ?? info.description}</p>
        {stockoutCorrectionSummary ? (
          <div className="mt-2 space-y-0.5 text-slate-700">
            <p>Ventas reales: {Math.round(stockoutCorrectionSummary.totalActualSales).toLocaleString("es-ES")} uds</p>
            <p>Demanda corregida: {Math.round(stockoutCorrectionSummary.totalCorrectedSales).toLocaleString("es-ES")} uds</p>
            <p>
              Demanda no servida estimada:{" "}
              {Math.round(stockoutCorrectionSummary.totalEstimatedLostDemand).toLocaleString("es-ES")} uds
            </p>
            <p>Meses con rotura: {stockoutCorrectionSummary.correctedMonthsCount}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm ${className}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Método de forecast
      </p>
      <p className="mt-2 font-semibold text-slate-900">
        {showEffective ? effectiveLabel : configuredLabel}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        {info.businessSummary ?? info.description}
      </p>

      {stockoutCorrectionSummary ? (
        <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs text-violet-950 space-y-0.5">
          <p>Ventas reales: {Math.round(stockoutCorrectionSummary.totalActualSales).toLocaleString("es-ES")} uds</p>
          <p>Demanda corregida: {Math.round(stockoutCorrectionSummary.totalCorrectedSales).toLocaleString("es-ES")} uds</p>
          <p>
            Demanda no servida estimada:{" "}
            {Math.round(stockoutCorrectionSummary.totalEstimatedLostDemand).toLocaleString("es-ES")} uds
          </p>
          <p>Meses con rotura: {stockoutCorrectionSummary.correctedMonthsCount}</p>
        </div>
      ) : null}

      {info.configuredMethod === "OWN_SALES_CORRECTED" ? (
        <p className="mt-2 text-xs text-slate-600">
          Usa histórico de stock FBA para estimar ventas perdidas por rotura.
        </p>
      ) : null}

      {showEffective && info.configuredMethod !== "AUTO" ? (
        <p className="mt-2 text-xs text-amber-800">
          Método aplicado: {effectiveLabel}. {info.reason}
        </p>
      ) : null}

      {info.warnings.length > 0 ? (
        <div className="mt-2 space-y-1">
          {info.warnings.map((w) => (
            <p
              key={w}
              className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900"
            >
              {w}
            </p>
          ))}
        </div>
      ) : null}

      {(info.mixOwnWeightPct != null || info.capturePctApplied != null) && (
        <div className="mt-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs">
          {info.mixOwnWeightPct != null ? (
            <p className="text-slate-700">
              Peso histórico propio: {fmtPct(info.mixOwnWeightPct)}
            </p>
          ) : null}
          {info.mixCompetitorWeightPct != null ? (
            <p className="text-slate-700">
              Peso competidores: {fmtPct(info.mixCompetitorWeightPct)}
            </p>
          ) : null}
          {info.capturePctApplied != null ? (
            <p className="text-slate-700">
              Captura competidor: {fmtPct(info.capturePctApplied * 100)}
            </p>
          ) : null}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowTechnical((v) => !v)}
        className="mt-3 flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900"
      >
        {showTechnical ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Ver detalle técnico
      </button>

      {showTechnical ? (
        <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
          <p>
            Configurado: {info.configuredMethod} · Efectivo: {info.effectiveMethod}
          </p>
          <p>{info.description}</p>
          {info.sourcesUsed.length > 0 ? (
            <div>
              <p className="font-medium">Fuentes:</p>
              <ul className="mt-1 list-disc pl-4">
                {info.sourcesUsed.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {info.sourcesNotUsed.length > 0 ? (
            <div>
              <p className="font-medium">No usa:</p>
              <ul className="mt-1 list-disc pl-4">
                {info.sourcesNotUsed.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p>Motivo: {info.reason}</p>
        </div>
      ) : null}
    </div>
  );
}

export type { ForecastMethodInfo };
