"use client";

import { Search, RefreshCw } from "lucide-react";

export type SupplierFilterState = {
  q: string;
  pais: string;
  puerto: string;
  agente: string;
  completitud: "all" | "complete" | "incomplete";
};

type PortOption = { id: string; name: string };
type AgentOption = { id: string; contacto: string | null };

type SupplierFiltersProps = {
  filters: SupplierFilterState;
  onChange: (next: SupplierFilterState) => void;
  ports: PortOption[];
  agents: AgentOption[];
  paises: string[];
  loading: boolean;
  onReload: () => void;
};

export function SupplierFilters({
  filters,
  onChange,
  ports,
  agents,
  paises,
  loading,
  onReload,
}: SupplierFiltersProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <div className="relative xl:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={filters.q}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            placeholder="Buscar nombre, ciudad, provincia…"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={filters.pais}
          onChange={(e) => onChange({ ...filters, pais: e.target.value })}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todos los países</option>
          {paises.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          value={filters.puerto}
          onChange={(e) => onChange({ ...filters, puerto: e.target.value })}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todos los puertos</option>
          {ports.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={filters.agente}
          onChange={(e) => onChange({ ...filters, agente: e.target.value })}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Todos los agentes</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.contacto ?? "Sin contacto"}
            </option>
          ))}
        </select>

        <select
          value={filters.completitud}
          onChange={(e) =>
            onChange({
              ...filters,
              completitud: e.target.value as SupplierFilterState["completitud"],
            })
          }
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Todos los estados</option>
          <option value="complete">Completos</option>
          <option value="incomplete">Incompletos</option>
        </select>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onReload}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>
    </div>
  );
}
