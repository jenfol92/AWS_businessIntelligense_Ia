/**
 * Módulo   : logistics
 * Archivo  : app/[locale]/(dashboard)/logistica/page.tsx
 * Qué hace : Vista principal del módulo de logística.
 *
 * Funcionalidades (fase 2):
 *   - Listado de contenedores con barra de progreso ETA
 *   - Filtro por estado
 *   - Botón FindTEU para localizar el contenedor en findteu.com
 *   - Botón "Ver orden" en cada orden vinculada (modal OrderReadonlyModal)
 *   - Panel de documentación con subida de archivos (ContainerDocumentsPanel)
 *   - ETA editable + registro de retraso con motivo (appendNota)
 *   - Modal para crear nuevos contenedores
 *
 * Datos desde:
 *   GET  /api/containers              — listado con órdenes vinculadas
 *   GET  /api/containers/[id]         — detalle con ítems y documentos
 *   PUT  /api/containers/[id]         — actualizar ETA, costes, estado, notas
 *   POST /api/containers/[id]/orders  — añadir orden al contenedor
 *   DELETE /api/containers/[id]/orders — quitar orden del contenedor
 *   GET  /api/containers/[id]/documentos — documentos del contenedor
 *   POST /api/containers/[id]/documentos — subir documento
 *
 * No implementado: aplicar stock y eliminar documentos.
 * Facturación de costes: implementada como cierre de costes sin aplicar stock.
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Package,
  AlertCircle,
  FileText,
  Anchor,
  Truck,
  MapPin,
  Pencil,
} from "lucide-react";

import { LogisticaCreateContainerTrigger } from "@/modules/containers/components/LogisticaCreateContainerTrigger";
import { ContainerDetailPanel }      from "@/modules/containers/components/ContainerDetailPanel";
import { ContainerEditModal }        from "@/modules/containers/components/ContainerEditModal";
import { ContainerMobileCard }       from "@/modules/containers/components/ContainerMobileCard";
import { ContenedorEstadosBadges }   from "@/modules/containers/components/ContainerEstadosBadges";
import { EtaBar }                    from "@/modules/containers/components/EtaBar";
import {
  TIPO_CONTENEDOR_LABELS,
  ESTADOS_CONTENEDOR_OPCIONES,
} from "@/modules/containers/constants/estadoContenedor";
import { resolveContainerEstados } from "@/modules/containers/utils/resolveContainerEstados";
import { parseDelayFromNotes } from "@/modules/containers/utils/parseDelayFromNotes";
import type {
  ContenedorRow,
  EstadoFiltro,
} from "@/modules/containers/types/containerUiTypes";
import { fetchContainers } from "@/modules/containers/api/containerClient";
import OrderReadonlyModal            from "@/modules/orders/components/OrderReadonlyModal";
import { ResponsiveTable }           from "@/shared/ui/ResponsiveTable";

// ─── Configuración visual ─────────────────────────────────────────────────────

function resolveEstadosContenedor(c: Pick<
  ContenedorRow,
  "estado" | "estado_logistico" | "estado_stock" | "estado_costes" | "tipo_contenedor"
>) {
  return resolveContainerEstados(c);
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * LogisticaPage — vista completa del módulo de logística.
 */
export default function LogisticaPage() {
  const searchParams = useSearchParams();
  const [contenedores, setContenedores] = useState<ContenedorRow[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [filterEstado, setFilterEstado] = useState<EstadoFiltro>("ALL");
  const [expandedId,   setExpandedId]   = useState<string | null>(null);
  const [toast,        setToast]        = useState<string | null>(null);

  // Modal para ver detalle de orden (OrderReadonlyModal)
  const [verOrdenId, setVerOrdenId] = useState<string | null>(null);
  const [editContainerId, setEditContainerId] = useState<string | null>(null);
  const containerIdFromUrl = searchParams.get("containerId");

  // ── Carga de datos ────────────────────────────────────────────────────────

  const fetchContenedores = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchContainers(filterEstado !== "ALL" ? filterEstado : undefined);
      setContenedores((json.rows ?? []) as ContenedorRow[]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [filterEstado]);

  useEffect(() => { fetchContenedores(); }, [fetchContenedores]);

  // Permite llegar desde el cronograma y abrir directamente el contenedor.
  useEffect(() => {
    if (containerIdFromUrl) {
      setExpandedId(containerIdFromUrl);
    }
  }, [containerIdFromUrl]);

  // ── Toast ─────────────────────────────────────────────────────────────────

  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 4000);
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpiTotal      = contenedores.length;
  const kpiTransito = contenedores.filter((c) => {
    const e = resolveEstadosContenedor(c);
    return e.estado_logistico === "en_puerto_salida" || e.estado_logistico === "en_transito";
  }).length;
  const kpiDestino = contenedores.filter(
    (c) => resolveEstadosContenedor(c).estado_logistico === "en_puerto_destino",
  ).length;
  const kpiEntregados = contenedores.filter(
    (c) => resolveEstadosContenedor(c).estado_logistico === "entregado",
  ).length;

  function fmtDate(d: string | null): string {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
  }

  /**
   * Comprueba si el identificador cumple el formato ISO 6346 (4 letras + 7 dígitos).
   * Solo se usa como aviso visual — NO bloquea el botón FindTEU.
   */
  function isIsoContainerNumber(id: string): boolean {
    return /^[A-Z]{4}\d{7}$/i.test(id.trim().replace(/\s/g, ""));
  }

  /**
   * Abre FindTEU en una nueva pestaña y copia el número de contenedor al portapapeles.
   * FindTEU no admite URLs directas verificadas, así que abrimos la home y el
   * número ya está en el portapapeles para que el usuario lo pegue.
   */
  async function handleFindTeu(identificador: string) {
    const numero = identificador.trim().toUpperCase().replace(/\s/g, "");
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(numero);
        showToast(`Número copiado. Pégalo en FindTEU para consultar la localización.`);
      } catch {
        showToast(`Número de contenedor: ${numero} — Pégalo en FindTEU.`);
      }
    } else {
      showToast(`Número de contenedor: ${numero} — Pégalo en FindTEU.`);
    }
    window.open("https://www.findteu.com/", "_blank", "noopener,noreferrer");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-screen-xl mx-auto space-y-5 p-4 pb-10">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-800 text-white text-sm rounded-xl px-4 py-3 shadow-xl">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          {toast}
        </div>
      )}

      {/* Modal detalle de orden */}
      {verOrdenId && (
        <OrderReadonlyModal
          ordenId={verOrdenId}
          onClose={() => setVerOrdenId(null)}
        />
      )}

      {editContainerId && (
        <ContainerEditModal
          contenedorId={editContainerId}
          onClose={() => setEditContainerId(null)}
          onOrdersChanged={fetchContenedores}
          onSaved={() => {
            setEditContainerId(null);
            fetchContenedores();
            showToast("Contenedor actualizado.");
          }}
        />
      )}

      {/* Encabezado */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Logística</h1>
          <p className="text-sm text-slate-500 mt-0.5">Gestión de contenedores y envíos</p>
        </div>
        <div className="flex items-center gap-2">
          <button disabled title="Envíos Amazon — próximamente"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-400 cursor-not-allowed opacity-60"
          >
            <Truck className="h-4 w-4" />
            Envíos Amazon
          </button>
          <LogisticaCreateContainerTrigger
            onCreated={(cid) => {
              showToast(`Contenedor creado (ID: ${cid.slice(0, 8)}…).`);
              fetchContenedores();
            }}
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total",        value: kpiTotal,      color: "text-slate-700"   },
          { label: "En tránsito",  value: kpiTransito,   color: "text-blue-600"    },
          { label: "En destino",   value: kpiDestino,    color: "text-amber-600"   },
          { label: "Entregados",   value: kpiEntregados, color: "text-emerald-600" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{k.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Estado (legacy)</label>
          <select value={filterEstado}
            onChange={(e) => setFilterEstado(e.target.value as EstadoFiltro)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">Todos</option>
            {ESTADOS_CONTENEDOR_OPCIONES.map((op) => (
              <option key={op.value} value={op.value}>{op.label}</option>
            ))}
          </select>
        </div>
        <button onClick={fetchContenedores} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-4 py-3 border border-red-100">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && contenedores.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Anchor className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No hay contenedores registrados.</p>
          <p className="text-xs mt-1">Crea el primero con el botón "Nuevo contenedor".</p>
        </div>
      )}

      {/* Tabla de contenedores */}
      {contenedores.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <ResponsiveTable
            desktop={
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-4 py-2.5 w-6" />
                      <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Contenedor</th>
                      <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Ruta</th>
                      <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Tipo / Transitario</th>
                      <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Agente</th>
                      <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Estado / ETA</th>
                      <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Fechas</th>
                      <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Órdenes</th>
                      <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Coste EUR</th>
                      <th className="px-4 py-2.5 text-center text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contenedores.map((c) => {
                      const expanded = expandedId === c.id;
                      const hasId = c.identificador_embarque.trim().length > 0;
                      const isIsoFormat = isIsoContainerNumber(c.identificador_embarque);
                      return (
                        <React.Fragment key={c.id}>
                          <tr
                            className={`border-b border-slate-50 transition-colors ${expanded ? "bg-blue-50/40" : "hover:bg-blue-50/20"}`}
                          >
                            <td
                              className="px-4 py-3 cursor-pointer text-slate-400"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </td>
                            <td
                              className="px-4 py-3 cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <div className="font-semibold text-slate-800 text-xs font-mono">{c.identificador_embarque}</div>
                              {c.notas ? (
                                <div className="text-[11px] text-slate-400 truncate max-w-[160px]" title={c.notas}>
                                  {c.notas.split("\n")[0]}
                                </div>
                              ) : null}
                            </td>
                            <td
                              className="px-4 py-3 cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <div className="flex items-center gap-1 text-xs text-slate-600">
                                <span className="font-medium text-slate-700">{c.puerto_salida ?? "—"}</span>
                                <span className="text-slate-300">→</span>
                                <span className="font-medium text-slate-700">{c.puerto_llegada ?? "—"}</span>
                              </div>
                            </td>
                            <td
                              className="px-4 py-3 cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {c.tipo_contenedor ? (
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      resolveEstadosContenedor(c).tipo_contenedor === "propio"
                                        ? "bg-blue-50 text-blue-700"
                                        : "bg-purple-50 text-purple-700"
                                    }`}
                                  >
                                    {TIPO_CONTENEDOR_LABELS[resolveEstadosContenedor(c).tipo_contenedor]}
                                  </span>
                                ) : null}
                                <span className="text-xs text-slate-500">{c.transitario ?? "—"}</span>
                              </div>
                            </td>
                            <td
                              className="px-4 py-3 cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <span
                                className={`text-xs font-medium ${(c.ordenes_count ?? 0) === 0 || !c.agente_contacto ? "text-slate-400" : "text-slate-700"}`}
                              >
                                {(c.ordenes_count ?? 0) === 0 ? "Sin orden" : c.agente_contacto ?? "Sin agente"}
                              </span>
                            </td>
                            <td
                              className="px-4 py-3 cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <div className="space-y-1">
                                <ContenedorEstadosBadges contenedor={c} />
                                <EtaBar
                                  fechaSalida={c.fecha_salida}
                                  fechaEta={c.fecha_eta_estimada}
                                  estadoLogistico={resolveEstadosContenedor(c).estado_logistico}
                                  estadoStock={resolveEstadosContenedor(c).estado_stock}
                                />
                                {(() => {
                                  const retraso = parseDelayFromNotes(c.notas);
                                  if (!retraso) return null;
                                  return (
                                    <div className="text-[10px] font-medium text-red-600 leading-snug">
                                      ⚠ Retraso de {retraso.dias}d
                                      {retraso.motivo && retraso.motivo !== "—"
                                        ? `: ${retraso.motivo.slice(0, 40)}${retraso.motivo.length > 40 ? "…" : ""}`
                                        : ""}
                                    </div>
                                  );
                                })()}
                              </div>
                            </td>
                            <td
                              className="px-4 py-3 text-right cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <div className="text-[11px] text-slate-500 leading-snug">
                                <div>Sal: {fmtDate(c.fecha_salida)}</div>
                                <div>ETA: {fmtDate(c.fecha_eta_estimada)}</div>
                              </div>
                            </td>
                            <td
                              className="px-4 py-3 text-right cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <span className="text-xs font-medium text-slate-700">{c.ordenes_count ?? 0}</span>
                            </td>
                            <td
                              className="px-4 py-3 text-right cursor-pointer"
                              onClick={() => setExpandedId(expanded ? null : c.id)}
                            >
                              <span className="text-xs font-semibold text-slate-800 tabular-nums">
                                €{Number(c.coste_total_eur ?? 0).toLocaleString("es-ES", { maximumFractionDigits: 0 })}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditContainerId(c.id);
                                  }}
                                  title="Editar datos generales y órdenes"
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-medium transition"
                                >
                                  <Pencil className="h-3 w-3" />
                                  Editar
                                </button>
                                {hasId ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleFindTeu(c.identificador_embarque);
                                      }}
                                      title={`Copiar "${c.identificador_embarque}" y abrir FindTEU`}
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-medium transition"
                                    >
                                      <MapPin className="h-3 w-3" />
                                      FindTEU
                                    </button>
                                    {!isIsoFormat ? (
                                      <span className="text-[9px] text-amber-500 leading-none">
                                        Número no estándar
                                      </span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <span
                                    title="Sin número de contenedor"
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-slate-300 text-xs cursor-not-allowed"
                                  >
                                    <MapPin className="h-3 w-3" />
                                    FindTEU
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded ? (
                            <tr className="border-b border-slate-100">
                              <td colSpan={10} className="p-0">
                                <ContainerDetailPanel
                                  contenedorId={c.id}
                                  onChanged={() => {
                                    fetchContenedores();
                                    showToast("Contenedor actualizado.");
                                  }}
                                  onVerOrden={(id) => setVerOrdenId(id)}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            }
            mobile={
              <div className="space-y-3 p-4">
                {contenedores.map((c) => {
                  const expanded = expandedId === c.id;
                  const hasId = c.identificador_embarque.trim().length > 0;
                  const isIsoFormat = isIsoContainerNumber(c.identificador_embarque);
                  return (
                    <ContainerMobileCard
                      key={c.id}
                      contenedor={c}
                      expanded={expanded}
                      hasId={hasId}
                      isIsoFormat={isIsoFormat}
                      onToggle={() => setExpandedId(expanded ? null : c.id)}
                      onEdit={() => setEditContainerId(c.id)}
                      onFindTeu={() => void handleFindTeu(c.identificador_embarque)}
                      onChanged={() => {
                        fetchContenedores();
                        showToast("Contenedor actualizado.");
                      }}
                      onVerOrden={(id) => setVerOrdenId(id)}
                    />
                  );
                })}
              </div>
            }
          />

          {/* Pie de tabla */}
          <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-[11px] text-slate-400">
            {contenedores.length} contenedor{contenedores.length !== 1 ? "es" : ""}
            {filterEstado !== "ALL" ? ` (estado: ${filterEstado})` : ""}
          </div>
        </div>
      )}

    </div>
  );
}
