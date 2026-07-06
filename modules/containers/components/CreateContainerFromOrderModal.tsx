/**
 * Módulo   : containers
 * Archivo  : modules/containers/components/CreateContainerFromOrderModal.tsx
 * Qué hace : Modal para crear un nuevo contenedor a partir de una orden confirmada.
 *            Carga los puertos de origen y destino desde GET /api/logistics/ports
 *            (tablas reales puerto_china y paises).
 *            Permite seleccionar/deseleccionar órdenes y envía a POST /api/containers.
 *
 * Decisión de campo puerto:
 *   La tabla contenedores almacena puerto_salida y puerto_llegada como TEXT
 *   (nombre del puerto, no UUID). Por tanto se guarda `port.name` en el body.
 *
 * No hace: No aplica stock ni genera facturas (pendiente de fases futuras).
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { X as XIcon, Check as CheckIcon, Package as PackageIcon, RefreshCw, AlertCircle } from "lucide-react";
import type { OriginPort, DestinationCountry } from "@/app/api/logistics/ports/route";
import { createContainerFromOrder } from "@/modules/containers/api/containerClient";
import {
  buildLogisticaContainerHref,
  OrderContainerSummary,
} from "@/modules/orders/components/OrderContainerSummary";
import type { OrderLinkedContainer } from "@/modules/orders/types/orderList.types";
import {
  mergeOrdersToContainerFields,
  type OrderContainerSource,
} from "@/modules/containers/utils/mapOrderToContainerFields";
import {
  fetchConfirmedOrders,
  type ConfirmedOrderSummary,
} from "@/modules/orders/api/orderClient";
import { DEFAULT_LOCALE, isLocale } from "@/config/i18n";
import {
  ESTADOS_LOGISTICOS_OPCIONES,
  TIPO_CONTENEDOR_LABELS,
  type EstadoLogisticoContenedor,
} from "@/modules/containers/constants/estadoContenedor";

// ─── Tipos locales ─────────────────────────────────────────────────────────────

type TouchedFields = {
  fechaSalida: boolean;
  fechaEta: boolean;
  puertoSalida: boolean;
  puertoLlegada: boolean;
  transitario: boolean;
};

const EMPTY_TOUCHED: TouchedFields = {
  fechaSalida: false,
  fechaEta: false,
  puertoSalida: false,
  puertoLlegada: false,
  transitario: false,
};

/** Estados logísticos disponibles al crear (sin entregado automático). */
const ESTADOS_LOGISTICOS_CREATE = ESTADOS_LOGISTICOS_OPCIONES.filter(
  (option) => option.value !== "entregado",
);

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  /** Orden preseleccionada al abrir el modal (desde la fila de pedidos). */
  initialOrdenId?: string | null;
  /** Si la orden ya tiene contenedor (desde pedidos), no permitir crear otro. */
  initialLinkedContainer?: OrderLinkedContainer | null;
  onClose:   () => void;
  onCreated: (contenedorId: string) => void;
}

// ─── Componente ────────────────────────────────────────────────────────────────

/**
 * CreateContainerFromOrderModal
 *
 * Al montar, carga en paralelo:
 *  - Órdenes confirmadas (GET /api/orders?estado=confirmado)
 *  - Puertos disponibles (GET /api/logistics/ports)
 *
 * Preselecciona la orden indicada por `initialOrdenId` y auto-rellena
 * puerto de salida/llegada y ETA desde los datos de esa orden.
 *
 * Guarda puerto_salida y puerto_llegada como texto (nombre del puerto),
 * ya que la tabla contenedores usa columnas tipo TEXT para estos campos.
 */
export default function CreateContainerFromOrderModal({
  initialOrdenId,
  initialLinkedContainer = null,
  onClose,
  onCreated,
}: Props) {
  const params = useParams();
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  // ── Campos del formulario ──────────────────────────────────────────────────
  const [embarque,       setEmbarque]       = useState("");
  const [tipoContenedor, setTipo]           = useState<"propio" | "amazon_agl">("propio");
  const [transitario,    setTransitario]    = useState("");
  const [destinoPaisId,  setDestinoPaisId]  = useState("");
  const [puertoSalida,   setPuertoSalida]   = useState("");
  const [puertoLlegada,  setPuertoLlegada]  = useState("");
  const [fechaSalida,    setFechaSalida]    = useState("");
  const [fechaEta,       setFechaEta]       = useState("");
  const [touched,        setTouched]        = useState<TouchedFields>(EMPTY_TOUCHED);
  const [estado,         setEstado]         = useState<EstadoLogisticoContenedor>("preparando");
  const [notas,          setNotas]          = useState("");
  const [flete,          setFlete]          = useState("");
  const [gastosLlegada,  setGastosLlegada]  = useState("");

  // ── Catálogos de puertos (BD) ──────────────────────────────────────────────
  const [puertosOrigen,  setPuertosOrigen]  = useState<OriginPort[]>([]);
  const [paisesDestino,  setPaisesDestino]  = useState<DestinationCountry[]>([]);
  const [loadingPuertos, setLoadingPuertos] = useState(true);

  // ── Órdenes confirmadas ────────────────────────────────────────────────────
  const [ordenesConf,    setOrdenesConf]    = useState<ConfirmedOrderSummary[]>([]);
  const [selectedOrdens, setSelectedOrdens] = useState<ConfirmedOrderSummary[]>([]);
  const [loadingOrdenes, setLoadingOrdenes] = useState(true);

  // ── Estado UI ──────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // ── Carga de datos al montar ───────────────────────────────────────────────

  /** Carga órdenes confirmadas y puertos en paralelo. */
  useEffect(() => {
    fetchConfirmedOrders(200)
      .then((rows) => setOrdenesConf(rows))
      .finally(() => setLoadingOrdenes(false));

    fetch("/api/logistics/ports")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setPuertosOrigen(j.originPorts      ?? []);
          setPaisesDestino(j.destinationCountries ?? []);
        }
      })
      .finally(() => setLoadingPuertos(false));
  }, []);

  function applyOrdersToForm(orders: OrderContainerSource[]) {
    if (orders.length === 0) return;
    const merged = mergeOrdersToContainerFields(orders);
    if (!touched.puertoSalida && merged.puerto_salida) setPuertoSalida(merged.puerto_salida);
    if (!touched.puertoLlegada && merged.puerto_llegada) setPuertoLlegada(merged.puerto_llegada);
    if (!touched.transitario && merged.transitario) setTransitario(merged.transitario);
    if (!touched.fechaSalida && merged.fecha_salida) setFechaSalida(merged.fecha_salida);
    if (!touched.fechaEta && merged.fecha_eta_estimada) setFechaEta(merged.fecha_eta_estimada);
  }

  // ── Preseleccionar orden inicial ───────────────────────────────────────────

  useEffect(() => {
    if (!initialOrdenId || ordenesConf.length === 0) return;
    const found = ordenesConf.find((o) => o.id === initialOrdenId);
    if (!found || found.contenedor) return;
    if (!selectedOrdens.find((o) => o.id === initialOrdenId)) {
      setSelectedOrdens([found]);
      applyOrdersToForm([found]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrdenId, ordenesConf]);

  const blockedInitialContainer = useMemo(() => {
    if (initialLinkedContainer) return initialLinkedContainer;
    if (!initialOrdenId) return null;
    return ordenesConf.find((order) => order.id === initialOrdenId)?.contenedor ?? null;
  }, [initialLinkedContainer, initialOrdenId, ordenesConf]);

  useEffect(() => {
    applyOrdersToForm(selectedOrdens.filter((order) => !order.contenedor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrdens]);

  // ── Acciones ───────────────────────────────────────────────────────────────

  /** Alterna la selección de una orden confirmada sin contenedor. */
  function toggleOrden(o: ConfirmedOrderSummary) {
    if (o.contenedor) return;
    const seleccionada = selectedOrdens.find((x) => x.id === o.id);
    if (seleccionada) {
      setSelectedOrdens((prev) => prev.filter((x) => x.id !== o.id));
    } else {
      setSelectedOrdens((prev) => [...prev, o]);
    }
  }

  /**
   * Envía el formulario a POST /api/containers.
   * Los campos puerto_salida y puerto_llegada se envían como texto (nombre del
   * puerto) porque la tabla contenedores.puerto_salida / puerto_llegada es TEXT.
   */
  async function handleCreate() {
    setError(null);
    if (!embarque.trim()) {
      setError("El número de embarque es obligatorio.");
      return;
    }
    if (selectedOrdens.length === 0) {
      setError("Selecciona al menos una orden confirmada para vincular al contenedor.");
      return;
    }
    setSaving(true);
    try {
      const toFloat = (v: string): number | null => {
        const n = parseFloat(v.replace(",", "."));
        return Number.isFinite(n) ? n : null;
      };

      const json = await createContainerFromOrder({
        identificador_embarque: embarque.trim(),
        tipo_contenedor:        tipoContenedor,
        destino_pais_id:        destinoPaisId || null,
        transitario:            transitario   || null,
        puerto_salida:          puertoSalida  || null,
        puerto_llegada:         puertoLlegada || null,
        fecha_salida:           fechaSalida   || null,
        fecha_eta_estimada:     fechaEta      || null,
        estado_logistico:       estado,
        notas:                  notas || null,
        costo_flete_total_eur:     toFloat(flete),
        gastos_llegada_puerto_eur: toFloat(gastosLlegada),
        orden_ids:              selectedOrdens.map((o) => o.id),
      });

      onCreated(json.contenedor?.id ?? "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  // ── Totales seleccionados ──────────────────────────────────────────────────
  const totalEur = selectedOrdens.reduce((s, o) => s + Number(o.coste_total_eur ?? 0), 0);
  const totalCbm = selectedOrdens.reduce((s, o) => s + Number(o.cbm_total       ?? 0), 0);

  const cargando = loadingPuertos || loadingOrdenes;

  if (blockedInitialContainer) {
    return (
      <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl my-8">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <h2 className="text-base font-bold text-slate-800">Orden ya vinculada</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded hover:bg-slate-100 text-slate-400 transition"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">
              Esta orden ya está vinculada a un contenedor. No se puede crear otro contenedor para la misma orden.
            </p>
            <OrderContainerSummary contenedor={blockedInitialContainer} locale={locale} />
          </div>
          <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition"
            >
              Cerrar
            </button>
            <Link
              href={buildLogisticaContainerHref(locale, blockedInitialContainer.contenedor_id)}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition"
            >
              Ver contenedor
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl my-8">

        {/* ── Cabecera ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <PackageIcon className="h-5 w-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-800">Crear contenedor</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-100 text-slate-400 transition"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">

          {/* ── Identificación y tipo ── */}
          <div className="grid grid-cols-2 gap-4">

            {/* Nº embarque */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                Nº embarque / BL *
              </label>
              <input
                value={embarque}
                onChange={(e) => setEmbarque(e.target.value)}
                placeholder="Ej: NINGB2506001"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Tipo */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Tipo</label>
              <div className="flex gap-2 h-[38px]">
                {(["propio", "amazon_agl"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTipo(t)}
                    className={`flex-1 rounded-lg text-sm font-medium transition border ${
                      tipoContenedor === t
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {TIPO_CONTENEDOR_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Transitario */}
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                Transitario / Forwarder
              </label>
              <input
                value={transitario}
                onChange={(e) => {
                  setTouched((prev) => ({ ...prev, transitario: true }));
                  setTransitario(e.target.value);
                }}
                placeholder="Nombre del transitario"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Puerto salida — pobla desde puertos_china (BD) */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                Puerto salida
                {loadingPuertos && (
                  <RefreshCw className="inline h-3 w-3 animate-spin ml-1 text-slate-300" />
                )}
              </label>
              <select
                value={puertoSalida}
                onChange={(e) => {
                  setTouched((prev) => ({ ...prev, puertoSalida: true }));
                  setPuertoSalida(e.target.value);
                }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— auto desde orden —</option>
                {puertosOrigen.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}{p.code ? ` (${p.code})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Puerto llegada — pobla desde paises (BD) */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                País destino
                {loadingPuertos && (
                  <RefreshCw className="inline h-3 w-3 animate-spin ml-1 text-slate-300" />
                )}
              </label>
              <select
                value={destinoPaisId}
                onChange={(e) => setDestinoPaisId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— auto desde orden —</option>
                {paisesDestino.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.country ? ` · ${p.country}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Fechas */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                Fecha salida (ETD)
              </label>
              <input
                type="date"
                value={fechaSalida}
                onChange={(e) => {
                  setTouched((prev) => ({ ...prev, fechaSalida: true }));
                  setFechaSalida(e.target.value);
                }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                ETA llegada
              </label>
              <input
                type="date"
                value={fechaEta}
                onChange={(e) => {
                  setTouched((prev) => ({ ...prev, fechaEta: true }));
                  setFechaEta(e.target.value);
                }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-[10px] text-slate-400 mt-0.5">
                Se precarga desde la orden (ETD/ETA). Puedes modificarla antes de crear.
              </p>
            </div>

            {/* Estado logístico inicial */}
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                Estado logístico inicial
              </label>
              <select
                value={estado}
                onChange={(e) => setEstado(e.target.value as EstadoLogisticoContenedor)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {ESTADOS_LOGISTICOS_CREATE.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
            </div>

            {/* Costes logísticos */}
            <div className="col-span-2 border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                Costes logísticos (EUR, opcional)
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    Flete total
                  </label>
                  <input
                    type="number" step="0.01" min="0"
                    value={flete}
                    onChange={(e) => setFlete(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1 block">
                    Gastos llegada puerto
                  </label>
                  <input
                    type="number" step="0.01" min="0"
                    value={gastosLlegada}
                    onChange={(e) => setGastosLlegada(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Órdenes confirmadas disponibles ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-500">
                Órdenes confirmadas a incluir
              </label>
              {selectedOrdens.length > 0 && (
                <span className="text-xs text-blue-600 font-medium">
                  {selectedOrdens.length} seleccionada{selectedOrdens.length > 1 ? "s" : ""}
                  {" · "}€{totalEur.toFixed(0)}
                  {" · "}{totalCbm.toFixed(2)} m³
                </span>
              )}
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto border border-slate-200 rounded-xl p-2">
              {cargando ? (
                <div className="flex items-center justify-center py-6 gap-2 text-slate-400 text-xs">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Cargando…
                </div>
              ) : ordenesConf.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  No hay órdenes confirmadas disponibles.
                </p>
              ) : (
                ordenesConf.map((o) => {
                  const sel = !!selectedOrdens.find((x) => x.id === o.id);
                  const linked = Boolean(o.contenedor);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      disabled={linked}
                      onClick={() => toggleOrden(o)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition text-left ${
                        linked
                          ? "bg-slate-50 border border-slate-200 opacity-70 cursor-not-allowed"
                          : sel
                            ? "bg-blue-50 border border-blue-200"
                            : "hover:bg-slate-50 border border-transparent"
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700">{o.numero_orden}</span>
                        {linked && o.contenedor ? (
                          <p className="text-[10px] text-amber-600 mt-0.5">
                            Ya vinculada a contenedor {o.contenedor.identificador_embarque}
                          </p>
                        ) : null}
                      </div>
                      <span className="text-xs text-slate-400 shrink-0 ml-2">
                        {o.fob_puerto ?? "—"} → {o.destino ?? "—"}
                        {" · "}€{Number(o.coste_total_eur ?? 0).toFixed(0)}
                        {" · "}{Number(o.cbm_total ?? 0).toFixed(2)} m³
                      </span>
                      {sel && !linked ? <CheckIcon className="h-4 w-4 text-blue-600 shrink-0 ml-2" /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Observaciones sobre este contenedor…"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* ── Pie ── */}
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || cargando}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition"
          >
            {saving ? "Creando…" : "Crear contenedor"}
          </button>
        </div>
      </div>
    </div>
  );
}
