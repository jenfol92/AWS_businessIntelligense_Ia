/**
 * Módulo   : orders
 * Archivo  : modules/orders/components/OrderReadonlyModal.tsx
 * Qué hace : Modal de solo lectura para inspeccionar el detalle de una orden
 *            confirmada (cabecera + líneas de productos).
 *            Carga los datos desde GET /api/orders/[id].
 *
 * Muestra:
 *   - Número de orden, estado, proveedor, fecha, puertos, ETA, notas
 *   - Tabla de ítems: SKU, nombre, proveedor, lote, cantidad, CBM, coste USD
 *   - Totales: CBM, coste EUR
 */

"use client";

import { useEffect, useState } from "react";
import {
  X,
  RefreshCw,
  AlertCircle,
  Package,
  FileText,
  ExternalLink,
} from "lucide-react";
import { formatCurrency, formatEur } from "@/shared/utils/currency";
import { resolveLogisticsLabelFromOrder } from "@/modules/planner/utils/arrivalLogisticsLabel";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Línea de ítem tal como devuelve GET /api/orders/[id]. */
type ItemDetalle = {
  id:                 string;
  producto_id:        string;
  cantidad:           number;
  cbm_unitario:       number;
  cbm_total:          number;
  coste_unitario_moneda: number | null;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  lote_producto:      string | null;
  productos: {
    sku:    string;
    nombre: string;
    producto_detalle?: Array<{ imagen_url: string | null }>;
  } | null;
  proveedores?: { nombre: string } | null;
};

/** Cabecera de orden enriquecida tal como devuelve GET /api/orders/[id]. */
type OrdenDetalle = {
  id:                   string;
  numero_orden:         string | null;
  numero_pedido_agente: string | null;
  estado:               string;
  tipo_envio:           "propio" | "amazon_agl";
  fob_puerto:           string | null;
  destino:              string | null;
  fecha_orden:          string;
  eta:                  string | null;
  cbm_limite:           number | null;
  cbm_total:            number | null;
  coste_total_eur:      number | null;
  coste_total_usd:      number | null;
  moneda_compra:        string | null;
  tipo_cambio_moneda_eur: number | null;
  tipo_cambio_usd_eur:  number | null;
  notas:                string | null;
  proforma_firmada_url: string | null;
  items:                ItemDetalle[];
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface OrderReadonlyModalProps {
  /** ID de la orden a mostrar. */
  ordenId: string;
  /** Callback al cerrar el modal. */
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMoney(n: number | null, currency: string): string {
  if (n == null) return "—";
  return formatCurrency(n, currency);
}

const ESTADO_STYLE: Record<string, string> = {
  borrador:   "bg-amber-50 text-amber-700",
  confirmado: "bg-emerald-50 text-emerald-700",
  cancelado:  "bg-red-50 text-red-600",
  recibido:   "bg-blue-50 text-blue-700",
};

function orderOriginalTotal(orden: OrdenDetalle): number {
  return orden.items.reduce(
    (s, i) => s + Number(i.coste_unitario_moneda ?? i.coste_unitario_usd ?? 0) * Number(i.cantidad ?? 0),
    0,
  );
}

function orderEurTotal(orden: OrdenDetalle, totalOriginal: number): number | null {
  if (orden.coste_total_eur != null) return Number(orden.coste_total_eur);
  const currency = (orden.moneda_compra ?? "USD").toUpperCase();
  if (currency === "EUR") return totalOriginal;
  const fx = orden.tipo_cambio_moneda_eur ?? orden.tipo_cambio_usd_eur;
  return fx != null ? totalOriginal * Number(fx) : null;
}

// ─── Componente ───────────────────────────────────────────────────────────────

/**
 * Modal de solo lectura para el detalle de una orden de compra.
 * Se abre desde el panel de contenedores al pulsar "Ver orden".
 */
export default function OrderReadonlyModal({ ordenId, onClose }: OrderReadonlyModalProps) {
  const [orden,   setOrden]   = useState<OrdenDetalle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/orders/${ordenId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) throw new Error(j.error ?? "Error al cargar la orden");
        setOrden({ ...j.orden, items: j.items ?? [] });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [ordenId]);

  const totalOriginal = orden ? orderOriginalTotal(orden) : 0;
  const totalEur = orden ? orderEurTotal(orden, totalOriginal) : null;
  const isOrderCurrencyEur = (orden?.moneda_compra ?? "USD").toUpperCase() === "EUR";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Cabecera del modal ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <Package className="h-5 w-5 text-slate-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                {orden?.numero_orden ?? "Detalle de orden"}
              </h2>
              {orden?.numero_pedido_agente && (
                <p className="text-xs text-slate-400">{orden.numero_pedido_agente}</p>
              )}
            </div>
            {orden && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${ESTADO_STYLE[orden.estado] ?? "bg-slate-100 text-slate-600"}`}>
                {orden.estado}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Cuerpo del modal ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Cargando */}
          {loading && (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-8 justify-center">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Cargando orden…
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-4 py-3 border border-red-100">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Contenido */}
          {orden && !loading && (
            <>
              {/* ── Cabecera de la orden ── */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-xs">
                {[
                  { label: "Fecha orden",  value: fmtDate(orden.fecha_orden) },
                  { label: "Logística", value: resolveLogisticsLabelFromOrder({ tipoEnvio: orden.tipo_envio }) },
                  { label: "FOB Puerto",   value: orden.fob_puerto  ?? "—" },
                  { label: "Destino",      value: orden.destino     ?? "—" },
                  { label: "ETA",          value: fmtDate(orden.eta) },
                  { label: "CBM total",    value: orden.cbm_total != null ? `${Number(orden.cbm_total).toFixed(2)} m³` : "—" },
                  { label: "CBM límite",   value: orden.cbm_limite != null ? `${orden.cbm_limite} m³` : "—" },
                  ...(!isOrderCurrencyEur
                    ? [{ label: `Total moneda de pago / ${orden.moneda_compra ?? "USD"}`, value: fmtMoney(totalOriginal, orden.moneda_compra ?? "USD") }]
                    : []),
                  { label: "Cambio a EUR", value: orden.moneda_compra === "EUR" ? "1" : orden.tipo_cambio_moneda_eur ?? orden.tipo_cambio_usd_eur ?? "Cambio pendiente" },
                  { label: "EUR previsto", value: totalEur != null ? formatEur(totalEur) : "EUR pendiente: falta tipo de cambio" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">{label}</p>
                    <p className="text-slate-700 font-medium mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* Proforma */}
              {orden.proforma_firmada_url && (
                <a
                  href={orden.proforma_firmada_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Ver proforma firmada
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

              {/* Notas */}
              {orden.notas && (
                <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap">
                  {orden.notas}
                </div>
              )}

              {/* ── Líneas de productos ── */}
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Productos ({orden.items.length})
                </p>
                {orden.items.length === 0 ? (
                  <p className="text-xs text-slate-400">Sin líneas de producto.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-100">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-400 font-semibold">SKU / Producto</th>
                          <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Proveedor</th>
                          <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Lote</th>
                          <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Cant.</th>
                          <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-slate-400 font-semibold">CBM</th>
                          <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Coste unit. {orden.moneda_compra ?? "USD"}</th>
                          <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-slate-400 font-semibold">EUR previsto unit.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {orden.items.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800 leading-snug">
                                {item.productos?.nombre ?? "—"}
                              </div>
                              <div className="font-mono text-[10px] text-slate-400">
                                {item.productos?.sku ?? "—"}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {(item.proveedores as Record<string, unknown> | null | undefined)?.["nombre"] as string ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-slate-500 font-mono">
                              {item.lote_producto ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-slate-800 tabular-nums">
                              {Number(item.cantidad).toLocaleString("es-ES")}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                              {Number(item.cbm_total ?? 0).toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                              {fmtMoney(item.coste_unitario_moneda ?? item.coste_unitario_usd, orden.moneda_compra ?? "USD")}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                              {item.coste_unitario_eur != null ? formatEur(item.coste_unitario_eur) : "Cambio pendiente"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* ── Totales ── */}
              <div className="flex items-center justify-end gap-6 text-xs text-slate-600 pt-1 border-t border-slate-100">
                <span>
                  CBM total: <strong className="text-slate-800">
                    {Number(orden.cbm_total ?? 0).toFixed(2)} m³
                  </strong>
                </span>
                {!isOrderCurrencyEur ? (
                  <span>
                    Total moneda de pago: <strong className="text-slate-800">
                      {fmtMoney(totalOriginal, orden.moneda_compra ?? "USD")}
                    </strong>
                  </span>
                ) : null}
                <span>
                  EUR previsto: <strong className="text-slate-800">
                    {totalEur != null ? formatEur(totalEur) : "EUR pendiente: falta tipo de cambio"}
                  </strong>
                </span>
              </div>
              <p className="pt-1 text-right text-[11px] text-slate-400">
                EUR previsto segun cambio de la orden. El coste real se calcula al registrar pagos proveedor.
              </p>
            </>
          )}
        </div>

        {/* ── Pie del modal ── */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-slate-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
