"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  FileText,
  Package,
  RefreshCw,
  Save,
} from "lucide-react";

import {
  facturarContainerCosts,
  fetchContainerDetail,
  updateContainer,
} from "@/modules/containers/api/containerClient";
import ContainerDocumentsPanel from "@/modules/containers/components/ContainerDocumentsPanel";
import { ContainerOrderCard } from "@/modules/containers/components/ContainerOrderCard";
import { StockStatusBadge } from "@/modules/containers/components/StockStatusBadge";
import {
  ESTADOS_COSTES_OPCIONES,
  ESTADOS_LOGISTICOS_OPCIONES,
  ESTADOS_STOCK_OPCIONES,
  TIPO_CONTENEDOR_LABELS,
  type EstadoCostesContenedor,
  type EstadoLogisticoContenedor,
  type EstadoStockContenedor,
} from "@/modules/containers/constants/estadoContenedor";
import type {
  ContenedorRow,
  ContainerStockStatus,
  DetallePestaña,
  FacturarResultLinea,
  OrdenDetalle,
} from "@/modules/containers/types/containerUiTypes";
import { resolveContainerEstados } from "@/modules/containers/utils/resolveContainerEstados";

export type ContainerDetailPanelProps = {
  contenedorId: string;
  onChanged: () => void;
  onVerOrden: (id: string) => void;
};

function resolveEstadosContenedor(c: Pick<
  ContenedorRow,
  "estado" | "estado_logistico" | "estado_stock" | "estado_costes" | "tipo_contenedor"
>) {
  return resolveContainerEstados(c);
}

export function ContainerDetailPanel({
  contenedorId,
  onChanged,
  onVerOrden,
}: ContainerDetailPanelProps) {
  const [data,    setData]    = useState<{
    contenedor: ContenedorRow;
    ordenes: OrdenDetalle[];
    stockStatus?: ContainerStockStatus | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [pestaña, setPestaña] = useState<DetallePestaña>("editar");

  const [editEta,      setEditEta]      = useState("");
  const [editFlete,    setEditFlete]    = useState("");
  const [editGastos,   setEditGastos]   = useState("");
  const [editTransito, setEditTransito] = useState("");
  const [editEstadoLogistico, setEditEstadoLogistico] = useState<EstadoLogisticoContenedor>("preparando");
  const [editEstadoStock, setEditEstadoStock] = useState<EstadoStockContenedor>("pendiente_stock");
  const [editEstadoCostes, setEditEstadoCostes] = useState<EstadoCostesContenedor>("costes_estimados");
  const [costsDirty,    setCostsDirty]    = useState(false);

  // Campos registro de retraso
  const [diasRetraso,    setDiasRetraso]    = useState("");
  const [motivoRetraso,  setMotivoRetraso]  = useState("");
  const [savingRetraso,  setSavingRetraso]  = useState(false);
  const [errorRetraso,   setErrorRetraso]   = useState<string | null>(null);

  const [facturando, setFacturando] = useState(false);
  const [facturarError, setFacturarError] = useState<string | null>(null);

  const [facturarResult, setFacturarResult] = useState<{
    lineas_procesadas: number;
    producto_costos_upserted: number;
    cbm_total_contenedor: number;
    coste_total_logistico: number;
    warnings: string[];
    lineas: FacturarResultLinea[];
  } | null>(null);

  async function handleFacturarCostes() {
    setFacturando(true);
    setFacturarError(null);
    try {
      const json = await facturarContainerCosts(contenedorId);
      setFacturarResult({
        lineas_procesadas: json.lineas_procesadas,
        producto_costos_upserted: json.producto_costos_upserted,
        cbm_total_contenedor: json.cbm_total_contenedor,
        coste_total_logistico: json.coste_total_logistico,
        warnings: json.warnings ?? [],
        lineas: (json.lineas ?? []) as FacturarResultLinea[],
      });
      setEditEstadoCostes("costes_facturados");
      load();
      onChanged();
    } catch (e: unknown) {
      setFacturarError(e instanceof Error ? e.message : "Error al facturar costes");
    } finally {
      setFacturando(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const j = await fetchContainerDetail(contenedorId);
      setData({
        contenedor: j.contenedor as ContenedorRow,
        ordenes: (j.ordenes ?? []) as OrdenDetalle[],
        stockStatus: j.stockStatus as ContainerStockStatus | null | undefined,
      });
      const c = j.contenedor as ContenedorRow;
      const estados = resolveEstadosContenedor(c);
      setEditEta(c.fecha_eta_estimada?.slice(0, 10) ?? "");
      setEditFlete(c.costo_flete_total_eur     != null ? String(c.costo_flete_total_eur)     : "");
      setEditGastos(c.gastos_llegada_puerto_eur != null ? String(c.gastos_llegada_puerto_eur) : "");
      setEditTransito(c.costo_transito_total_eur != null ? String(c.costo_transito_total_eur) : "");
      setEditEstadoLogistico(estados.estado_logistico);
      setEditEstadoStock(estados.estado_stock);
      setEditEstadoCostes(estados.estado_costes);
      setCostsDirty(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando");
    } finally {
      setLoading(false);
    }
  }, [contenedorId]);

  useEffect(() => { load(); }, [load]);

  function toNum(s: string): number | null {
    const n = parseFloat(String(s).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  /** Guarda cambios de ETA y costes (sin retraso). */
  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateContainer(contenedorId, {
        fecha_eta_estimada: editEta || null,
        costo_flete_total_eur:     toNum(editFlete),
        gastos_llegada_puerto_eur: toNum(editGastos),
        costo_transito_total_eur:  toNum(editTransito),
        estado_logistico:          editEstadoLogistico,
        estado_stock:              editEstadoStock,
        estado_costes:             editEstadoCostes,
      });
      load();
      onChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  /** Registra retraso: recalcula ETA y añade nota de auditoría. */
  async function handleRegistrarRetraso() {
    if (!motivoRetraso.trim() && !diasRetraso) {
      setErrorRetraso("Introduce al menos los días de retraso o un motivo.");
      return;
    }
    setSavingRetraso(true);
    setErrorRetraso(null);
    try {
      const dias = parseInt(diasRetraso, 10) || 0;

      // Calcular nueva ETA si se especifican días
      let nuevaEta: string | null = null;
      const etaActual = editEta;
      if (dias > 0 && etaActual) {
        const fechaBase = new Date(etaActual);
        fechaBase.setDate(fechaBase.getDate() + dias);
        nuevaEta = fechaBase.toISOString().slice(0, 10);
      } else if (dias > 0) {
        // Sin ETA previa: usar hoy + días
        const hoy = new Date();
        hoy.setDate(hoy.getDate() + dias);
        nuevaEta = hoy.toISOString().slice(0, 10);
      }

      // Nota de auditoría en formato parseble por parseDelayFromNotes
      const now   = new Date();
      const ts    = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
      const nota  = `[${ts}] RETRASO: +${dias}d. Motivo: ${motivoRetraso || "—"}`;

      const body: Record<string, unknown> = { appendNota: nota };
      if (nuevaEta) body["fecha_eta_estimada"] = nuevaEta;

      await updateContainer(contenedorId, body);

      setDiasRetraso("");
      setMotivoRetraso("");
      load();
      onChanged();
    } catch (e: unknown) {
      setErrorRetraso(e instanceof Error ? e.message : "Error");
    } finally {
      setSavingRetraso(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-4 px-4">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Cargando detalle…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-sm py-4 px-4">
        <AlertCircle className="h-3.5 w-3.5" />
        {error ?? "Error cargando el detalle"}
      </div>
    );
  }

  const { ordenes } = data;

  return (
    <div className="bg-slate-50/80 border-t border-slate-100">

      {/* ── Pestañas internas ── */}
      <div className="flex items-center gap-0 border-b border-slate-200 px-4 pt-2">
        {([
          { id: "editar",    label: "ETA / Costes",  icon: <Clock className="h-3.5 w-3.5" /> },
          { id: "ordenes",   label: `Órdenes (${ordenes.length})`, icon: <Package className="h-3.5 w-3.5" /> },
          { id: "documentos", label: "Documentos", icon: <FileText className="h-3.5 w-3.5" /> },
        ] as { id: DetallePestaña; label: string; icon: React.ReactNode }[]).map((t) => (
          <button
            key={t.id}
            onClick={() => setPestaña(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              pestaña === t.id
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Contenido por pestaña ── */}
      <div className="px-4 py-4 space-y-4">

        {/* ═══ Pestaña: ETA / Costes ═══ */}
        {pestaña === "editar" && (
          <>
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
                ETA llegada
              </p>
              <input
                type="date"
                value={editEta}
                onChange={(e) => { setEditEta(e.target.value); setCostsDirty(true); }}
                className="w-full max-w-xs border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Edición costes logísticos */}
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Costes logísticos
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Flete (EUR)</label>
                  <input type="text" inputMode="decimal" value={editFlete} placeholder="—"
                    onChange={(e) => { setEditFlete(e.target.value); setCostsDirty(true); }}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Gastos llegada (EUR)</label>
                  <input type="text" inputMode="decimal" value={editGastos} placeholder="—"
                    onChange={(e) => { setEditGastos(e.target.value); setCostsDirty(true); }}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Tránsito (EUR)</label>
                  <input type="text" inputMode="decimal" value={editTransito} placeholder="—"
                    onChange={(e) => { setEditTransito(e.target.value); setCostsDirty(true); }}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Estados separados */}
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                Estados del contenedor
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Logístico</label>
                  <select
                    value={editEstadoLogistico}
                    onChange={(e) => {
                      setEditEstadoLogistico(e.target.value as EstadoLogisticoContenedor);
                      setCostsDirty(true);
                    }}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {ESTADOS_LOGISTICOS_OPCIONES.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Stock</label>
                  <select
                    value={editEstadoStock}
                    onChange={(e) => {
                      setEditEstadoStock(e.target.value as EstadoStockContenedor);
                      setCostsDirty(true);
                    }}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {ESTADOS_STOCK_OPCIONES.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Costes</label>
                  <select
                    value={editEstadoCostes}
                    onChange={(e) => {
                      setEditEstadoCostes(e.target.value as EstadoCostesContenedor);
                      setCostsDirty(true);
                    }}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {ESTADOS_COSTES_OPCIONES.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                </div>
                {costsDirty && (
                  <button onClick={handleSave} disabled={saving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition self-end"
                  >
                    <Save className="h-3 w-3" />
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </button>
                )}
              </div>
            </div>

            {data.stockStatus ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <StockStatusBadge ok={data.stockStatus.stockApplied} label="Stock aplicado" />
                <StockStatusBadge ok={data.stockStatus.destinationsDefined} label="Destinos definidos" />
                <StockStatusBadge ok={data.stockStatus.costsProrated} label="Costes prorrateados" />
                {data.stockStatus.tipoContenedor?.toLowerCase() === "agl" ||
                data.stockStatus.tipoContenedor?.toLowerCase() === "amazon_agl" ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-800">
                    {TIPO_CONTENEDOR_LABELS.amazon_agl} — stock FBA vía Amazon
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                  Cierre de costes (solo costes, sin stock)
                </p>
                <button
                  type="button"
                  onClick={handleFacturarCostes}
                  disabled={facturando}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  <Package className="h-3 w-3" />
                  {facturando ? "Facturando…" : "Facturar costes"}
                </button>
              </div>

              {facturarError ? (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {facturarError}
                </div>
              ) : null}

              {facturarResult ? (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-3 text-xs space-y-2">
                  <p className="font-medium text-indigo-900">
                    Costes facturados: {facturarResult.producto_costos_upserted} registro(s),{" "}
                    {facturarResult.lineas_procesadas} línea(s), CBM total{" "}
                    {facturarResult.cbm_total_contenedor.toFixed(4)} m³
                  </p>
                  {facturarResult.warnings.length > 0 ? (
                    <ul className="list-disc pl-4 text-amber-700">
                      {facturarResult.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-[10px]">
                      <thead>
                        <tr className="text-left text-slate-500">
                          <th className="pr-2 py-1">SKU</th>
                          <th className="pr-2 py-1">Cant.</th>
                          <th className="pr-2 py-1">CBM</th>
                          <th className="pr-2 py-1">% CBM</th>
                          <th className="pr-2 py-1">Total EUR/u</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facturarResult.lineas.map((line) => (
                          <tr key={`${line.sku}-${line.cantidad}`} className="border-t border-indigo-100">
                            <td className="pr-2 py-1">{line.sku ?? "—"}</td>
                            <td className="pr-2 py-1">{line.cantidad}</td>
                            <td className="pr-2 py-1">{line.cbm_total.toFixed(4)}</td>
                            <td className="pr-2 py-1">{(line.peso_cbm * 100).toFixed(1)}%</td>
                            <td className="pr-2 py-1">€{line.costo_unitario_total_eur.toFixed(4)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{error}
              </div>
            )}

            {/* Registrar retraso */}
            <div className="border-t border-slate-200 pt-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Registrar retraso de ETA
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Días de retraso</label>
                  <input type="text" inputMode="numeric" value={diasRetraso} placeholder="0"
                    onChange={(e) => setDiasRetraso(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-400 block mb-0.5">Motivo del retraso</label>
                  <input type="text" value={motivoRetraso} placeholder="Ej: Congestionamiento en puerto de origen"
                    onChange={(e) => setMotivoRetraso(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={handleRegistrarRetraso}
                  disabled={savingRetraso}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  <Clock className="h-3 w-3" />
                  {savingRetraso ? "Registrando…" : "Registrar retraso"}
                </button>
                <p className="text-[10px] text-slate-400">
                  Se anotará en el historial del contenedor y se actualizará la ETA.
                </p>
              </div>
              {errorRetraso && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2 mt-2">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{errorRetraso}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══ Pestaña: Órdenes ═══ */}
        {pestaña === "ordenes" && (
          <div>
            {ordenes.length === 0 ? (
              <p className="text-xs text-slate-400">No hay órdenes vinculadas a este contenedor.</p>
            ) : (
              <div className="space-y-2">
                {ordenes.map((o) => (
                  <ContainerOrderCard
                    key={o.id}
                    orden={o}
                    contenedorId={contenedorId}
                    onRemoved={() => { load(); onChanged(); }}
                    onVerOrden={onVerOrden}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ Pestaña: Documentos ═══ */}
        {pestaña === "documentos" && (
          <ContainerDocumentsPanel contenedorId={contenedorId} />
        )}
      </div>
    </div>
  );
}
