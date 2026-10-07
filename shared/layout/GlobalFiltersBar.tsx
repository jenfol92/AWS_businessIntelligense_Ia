// shared/layout/GlobalFiltersBar.tsx

"use client";

import { useGlobalFilters } from "@/shared/filters/useGlobalFilters";
import { localIsoDate } from "@/shared/filters/periodDates";
import type { PeriodPreset } from "@/shared/filters/types";

const SELECT_CLASS =
  "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700";

export default function GlobalFiltersBar() {
  const {
    periodPreset,
    setPeriodPreset,
    periodFrom,
    periodTo,
    setCustomPeriod,
    pais,
    setPais,
    canal,
    setCanal,
  } = useGlobalFilters();

  const today = localIsoDate();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Periodo */}
      <select
        className={SELECT_CLASS}
        value={periodPreset}
        onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
        aria-label="Periodo"
      >
        <option value="today">Hoy</option>
        <option value="7">7 días</option>
        <option value="30">30 días</option>
        <option value="60">60 días</option>
        <option value="90">90 días</option>
        <option value="custom">Personalizado</option>
      </select>

      {periodPreset === "custom" ? (
        <div className="flex items-center gap-1 text-sm text-slate-600">
          <input
            type="date"
            className={SELECT_CLASS}
            value={periodFrom ?? ""}
            max={periodTo ?? today}
            onChange={(e) => {
              if (e.target.value) setCustomPeriod(e.target.value, periodTo ?? today);
            }}
            aria-label="Desde"
          />
          <span>–</span>
          <input
            type="date"
            className={SELECT_CLASS}
            value={periodTo ?? ""}
            min={periodFrom ?? undefined}
            max={today}
            onChange={(e) => {
              if (e.target.value) setCustomPeriod(periodFrom ?? e.target.value, e.target.value);
            }}
            aria-label="Hasta"
          />
        </div>
      ) : null}

      {/* País */}
      <select
        className={SELECT_CLASS}
        value={pais}
        onChange={(e) => setPais(e.target.value)}
        aria-label="País"
      >
        <option value="ALL">Todos</option>
        <option value="ES">España</option>
        <option value="FR">Francia</option>
        <option value="IT">Italia</option>
        <option value="DE">Alemania</option>
      </select>

      {/* Canal */}
      <select
        className={SELECT_CLASS}
        value={canal}
        onChange={(e) => setCanal(e.target.value)}
        aria-label="Canal"
      >
        <option value="ALL">Todos</option>
        <option value="FBA">FBA</option>
        <option value="FBM">FBM</option>
      </select>
    </div>
  );
}
