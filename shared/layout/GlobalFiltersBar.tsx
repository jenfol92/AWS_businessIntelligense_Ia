// shared/layout/GlobalFiltersBar.tsx

"use client";

import { useGlobalFilters } from "@/shared/filters/useGlobalFilters";

export default function GlobalFiltersBar() {
  const {
    windowDays,
    setWindowDays,
    pais,
    setPais,
    canal,
    setCanal,
  } = useGlobalFilters();

  return (
    <div className="d-flex gap-2 align-items-center">
      {/* Ventana temporal */}
      <select
        className="form-select form-select-sm"
        value={windowDays}
        onChange={(e) => setWindowDays(Number(e.target.value))}
      >
        <option value={7}>7 días</option>
        <option value={30}>30 días</option>
        <option value={60}>60 días</option>
        <option value={90}>90 días</option>
      </select>

      {/* País */}
      <select
        className="form-select form-select-sm"
        value={pais}
        onChange={(e) => setPais(e.target.value)}
      >
        <option value="ALL">Todos</option>
        <option value="ES">España</option>
        <option value="FR">Francia</option>
        <option value="IT">Italia</option>
        <option value="DE">Alemania</option>
      </select>

      {/* Canal */}
      <select
        className="form-select form-select-sm"
        value={canal}
        onChange={(e) => setCanal(e.target.value)}
      >
        <option value="ALL">Todos</option>
        <option value="FBA">FBA</option>
        <option value="FBM">FBM</option>
      </select>
    </div>
  );
}