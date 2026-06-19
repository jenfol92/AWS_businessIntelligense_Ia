"use client";

import { useState } from "react";
import { Eye, FileText, Package, X } from "lucide-react";

import { unlinkContainerOrder } from "@/modules/containers/api/containerClient";
import type { OrdenDetalle } from "@/modules/containers/types/containerUiTypes";

export function ContainerOrderCard({
  orden,
  contenedorId,
  onRemoved,
  onVerOrden,
}: {
  orden:        OrdenDetalle;
  contenedorId: string;
  onRemoved:    () => void;
  onVerOrden:   (id: string) => void;
}) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    if (!confirm(`¿Desvincular la orden ${orden.numero_orden} de este contenedor?`)) return;
    setRemoving(true);
    try {
      await unlinkContainerOrder(contenedorId, orden.id);
      onRemoved();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Error desvinculando orden");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-100 px-3 py-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <Package className="h-4 w-4 text-slate-400 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800">{orden.numero_orden}</div>
          {orden.numero_pedido_agente && (
            <div className="text-[11px] text-slate-400">{orden.numero_pedido_agente}</div>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-500">
          <span>€{Number(orden.coste_total_eur ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })}</span>
          <span>{Number(orden.cbm_total ?? 0).toFixed(1)} m³</span>
          <span className={orden.agente_contacto ? "text-slate-600" : "text-slate-400"}>
            {orden.agente_contacto ?? "Sin agente"}
          </span>
          {orden.items.length > 0 && (
            <span>{orden.items.length} línea{orden.items.length !== 1 ? "s" : ""}</span>
          )}
          {orden.proforma_firmada_url && (
            <a href={orden.proforma_firmada_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-emerald-600 hover:underline">
              <FileText className="h-3 w-3" />
              Proforma
            </a>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={() => onVerOrden(orden.id)}
          title="Ver detalle completo de la orden"
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-50 text-slate-600 hover:bg-blue-50 hover:text-blue-600 text-xs transition"
        >
          <Eye className="h-3 w-3" />
          Ver
        </button>
        <button
          onClick={handleRemove}
          disabled={removing}
          title="Desvincular orden del contenedor"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
