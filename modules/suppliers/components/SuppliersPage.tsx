"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { SupplierEnriched } from "../types/supplier.types";
import { SupplierStats } from "./SupplierStats";
import {
  SupplierFilters,
  type SupplierFilterState,
} from "./SupplierFilters";
import { SupplierTable } from "./SupplierTable";
import { SupplierFormModal } from "./SupplierFormModal";

type PortOption = { id: string; name: string };
type AgentOption = { id: string; contacto: string | null };

const DEFAULT_FILTERS: SupplierFilterState = {
  q: "",
  pais: "",
  puerto: "",
  agente: "",
  completitud: "all",
};

function buildSuppliersUrl(filters: SupplierFilterState): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.pais) params.set("pais", filters.pais);
  if (filters.puerto) params.set("puerto", filters.puerto);
  if (filters.agente) params.set("agente", filters.agente);
  if (filters.completitud !== "all") {
    params.set("completitud", filters.completitud);
  }
  const qs = params.toString();
  return qs ? `/api/suppliers?${qs}` : "/api/suppliers";
}

/**
 * Vista principal del módulo de proveedores (dashboard + tabla + modal CRUD).
 */
export function SuppliersPage() {
  const [allRows, setAllRows] = useState<SupplierEnriched[]>([]);
  const [statsRows, setStatsRows] = useState<SupplierEnriched[]>([]);
  const [optionPaises, setOptionPaises] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SupplierFilterState>(DEFAULT_FILTERS);
  const [ports, setPorts] = useState<PortOption[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SupplierEnriched | null>(null);

  const loadAux = useCallback(async () => {
    const [portsRes, agentsRes] = await Promise.all([
      fetch("/api/logistics/ports"),
      fetch("/api/purchasing-agents"),
    ]);

    const portsJson = await portsRes.json().catch(() => null);
    if (portsJson?.ok && Array.isArray(portsJson.originPorts)) {
      setPorts(
        portsJson.originPorts.map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        })),
      );
    }

    const agentsJson = await agentsRes.json().catch(() => null);
    if (agentsJson?.ok && Array.isArray(agentsJson.rows)) {
      setAgents(agentsJson.rows as AgentOption[]);
    }
  }, []);

  const loadSuppliers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildSuppliersUrl(filters), { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        suppliers?: SupplierEnriched[];
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Error cargando proveedores.");
      }

      setAllRows(json.suppliers ?? []);
    } catch (e) {
      setAllRows([]);
      setError(e instanceof Error ? e.message : "Error desconocido.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const loadStatsAndOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers", { cache: "no-store" });
      const json = (await res.json()) as {
        ok?: boolean;
        suppliers?: SupplierEnriched[];
      };
      if (json.ok && Array.isArray(json.suppliers)) {
        setStatsRows(json.suppliers);
        const set = new Set<string>();
        for (const r of json.suppliers) {
          if (r.pais?.trim()) set.add(r.pais.trim());
        }
        setOptionPaises(Array.from(set).sort((a, b) => a.localeCompare(b, "es")));
      }
    } catch {
      /* KPIs opcionales si falla */
    }
  }, []);

  useEffect(() => {
    void loadAux();
    void loadStatsAndOptions();
  }, [loadAux, loadStatsAndOptions]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const paises = optionPaises;

  function handleNew() {
    setEditing(null);
    setShowModal(true);
  }

  function handleEdit(row: SupplierEnriched) {
    setEditing(row);
    setShowModal(true);
  }

  async function handleDelete(row: SupplierEnriched) {
    if (
      !confirm(
        `¿Eliminar el proveedor «${row.nombre}»? Solo es posible si no tiene productos ni pedidos vinculados.`,
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/suppliers/${row.id}`, { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "No se pudo eliminar.");
      }
      void loadSuppliers();
      void loadStatsAndOptions();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error eliminando proveedor.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6 px-4 pb-12 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Proveedores
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Gestión de fábricas, agentes, puertos y tiempos logísticos
          </p>
        </div>
        <button
          type="button"
          onClick={handleNew}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 sm:self-auto"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Nuevo proveedor
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <SupplierStats rows={statsRows.length > 0 ? statsRows : allRows} />

      <SupplierFilters
        filters={filters}
        onChange={setFilters}
        ports={ports}
        agents={agents}
        paises={paises}
        loading={loading}
        onReload={() => void loadSuppliers()}
      />

      <SupplierTable
        rows={allRows}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {showModal ? (
        <SupplierFormModal
          supplier={editing}
          ports={ports}
          agents={agents}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            void loadSuppliers();
            void loadStatsAndOptions();
          }}
        />
      ) : null}
    </div>
  );
}
