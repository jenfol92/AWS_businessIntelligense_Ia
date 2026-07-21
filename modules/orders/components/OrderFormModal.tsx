/**
 * Módulo   : orders
 * Archivo  : modules/orders/components/OrderFormModal.tsx
 * Qué hace : Modal para crear una nueva orden de compra en borrador o editar una existente.
 *            Incluye: cabecera (puerto FOB, destino, fecha, límite CBM), tabla de ítems,
 *            buscador de productos, barra de cubicaje con indicador de exceso,
 *            sección de split ("gestionar en varios pedidos") y notas.
 * Responsabilidad : Recoger datos del usuario y persistirlos mediante
 *                   POST /api/orders (nueva) o PUT /api/orders/[id] (edición).
 *                   Cargar los ítems existentes al editar desde GET /api/orders/[id].
 * No debe          : Confirmar órdenes (ver ConfirmOrderModal), gestionar stock
 *                   ni importar desde la carpeta legacy (bussines/).
 */

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Scissors, Trash2, ArrowDown, ArrowUp } from "lucide-react";
import { syncOrderLineCostFields } from "@/modules/orders/utils/syncOrderLineCostFields";
import type { PreloadedItem } from "@/modules/orders/types/orderForm.types";
import { useOrderCatalogs } from "@/modules/orders/hooks/useOrderCatalogs";
import { useOrderProductSearch } from "@/modules/orders/hooks/useOrderProductSearch";
import { useOrderFormLoader } from "@/modules/orders/hooks/useOrderFormLoader";
import { useOrderLeadTimeSuggestions } from "@/modules/orders/hooks/useOrderLeadTimeSuggestions";
import { buildOrderFormPayload } from "@/modules/orders/utils/buildOrderFormPayload";
import { productSearchToOrderItem } from "@/modules/orders/utils/productSearchToOrderItem";
import type { ProductoSearch } from "@/modules/orders/types/orderProductSearch.types";

export type { PreloadedItem };

// ─── Tipos locales ────────────────────────────────────────────────────────────

/** Orden de compra tal como la devuelve GET /api/orders (cabecera). */
export type OrdenRow = {
  id: string;
  numero_orden: string | null;
  estado: "borrador" | "confirmado";
  tipo_envio?: "propio" | "amazon_agl";
  fob_puerto: string | null;
  destino: string | null;
  fecha_orden: string;
  cbm_limite: number | null;
  cbm_total: number | null;
  coste_total_eur: number | null;
  notas: string | null;
  numero_pedido_agente: string | null;
  agente_id: string | null;
  agente_contacto?: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  tipo_cambio_usd_eur: number | null;
  eta: string | null;
  etd?: string | null;
  moneda_compra?: string | null;
  tipo_cambio_moneda_eur?: number | null;
};

/** Ítem dentro del formulario de orden (con _key local para listas React). */
type OrderItem = {
  _key: string;
  producto_id: string;
  nombre: string;
  sku: string;
  proveedor_id: string | null;
  proveedor_nombre: string;
  cantidad: number;
  cbm_unitario: number;
  coste_unitario_moneda: number | null;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  lote_producto: string | null;
  sin_coste_historico?: boolean;
};

export interface OrderFormModalProps {
  /** null → crear nueva orden; OrdenRow → editar borrador existente. */
  initialOrden: OrdenRow | null;
  /**
   * Productos precargados (desde sugerencias u otras fuentes).
   * Solo se aplican al crear una orden nueva (initialOrden === null).
   */
  initialItems?: PreloadedItem[];
  /** Callback al cerrar sin guardar. */
  onClose: () => void;
  /** Callback al guardar con éxito (refresca el listado). */
  onSaved: (orden?: OrdenRow) => void;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const CBM_LIMITE_DEFAULT = 65;
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "EUR ", GBP: "GBP ", CNY: "CNY " };

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toNonNegativeInteger(value: number | "" | string | null | undefined): number | null {
  if (value === "" || value == null) return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return null;
  return Math.round(numberValue);
}

function formatMoney(value: number, currency: string): string {
  const code = currency.trim().toUpperCase() || "USD";
  return `${CURRENCY_SYMBOLS[code] ?? `${code} `}${value.toFixed(2)}`;
}

// ─── Sub-componente: chip de cobertura de días ─────────────────────────────────

function CoberturaChip({ dias }: { dias: number | null }) {
  if (dias === null) return <span className="text-slate-400 text-xs">—</span>;
  if (dias <= 0)     return <span className="text-xs font-semibold text-red-600">Roto</span>;
  if (dias <= 14)    return <span className="text-xs font-semibold text-red-600">{dias}d ⚠</span>;
  if (dias <= 30)    return <span className="text-xs font-semibold text-orange-500">{dias}d</span>;
  return <span className="text-xs text-emerald-600">{dias}d</span>;
}

// ─── Componente principal ──────────────────────────────────────────────────────

/**
 * Modal para crear o editar una orden de compra en borrador.
 * Si initialOrden es null se hace POST /api/orders.
 * Si initialOrden tiene id se hace PUT /api/orders/[id].
 */
export default function OrderFormModal({
  initialOrden,
  initialItems,
  onClose,
  onSaved,
}: OrderFormModalProps) {
  const isEdit   = !!initialOrden;
  const isConfirmedEdit = initialOrden?.estado === "confirmado";
  const readonly = false;
  const [tipoEnvio, setTipoEnvio] = useState<"propio" | "amazon_agl">(
    initialOrden?.tipo_envio === "amazon_agl" ? "amazon_agl" : "propio",
  );

  // ─── Estado cabecera ──────────────────────────────────────────────────────

  const [fob, setFob] = useState<string>(() => {
    // Al editar, usar el puerto que ya tiene la orden
    if (initialOrden?.fob_puerto) return initialOrden.fob_puerto;
    // Al crear desde sugerencias: preseleccionar si todos los ítems comparten el mismo puerto
    if (!isEdit && initialItems && initialItems.length > 0) {
      const puertos = Array.from(
        new Set(initialItems.map((i) => i.fob_puerto).filter((p): p is string => !!p)),
      );
      if (puertos.length === 1) return puertos[0];
    }
    return "";
  });
  const [destino,   setDestino]   = useState(initialOrden?.destino ?? "");
  const [agenteId,  setAgenteId]  = useState<string>(() => {
    if (initialOrden?.agente_id) return initialOrden.agente_id;
    if (!isEdit && initialItems && initialItems.length > 0) {
      const agentes = Array.from(
        new Set(initialItems.map((i) => i.agente_id).filter((id): id is string => !!id)),
      );
      if (agentes.length === 1) return agentes[0];
    }
    return "";
  });
  const [fecha,     setFecha]     = useState(
    initialOrden?.fecha_orden ?? new Date().toISOString().slice(0, 10),
  );
  const [cbmLimite, setCbmLimite] = useState<number>(
    initialOrden?.cbm_limite ?? CBM_LIMITE_DEFAULT,
  );
  const [notas, setNotas]         = useState(initialOrden?.notas ?? "");
  const [etd, setEtd]               = useState(initialOrden?.etd?.slice(0, 10) ?? "");
  const [eta, setEta]               = useState(initialOrden?.eta?.slice(0, 10) ?? "");
  const [etdTouched, setEtdTouched] = useState(false);
  const [etaTouched, setEtaTouched] = useState(false);
  const [monedaCompra, setMonedaCompra] = useState(initialOrden?.moneda_compra ?? "USD");
  const [tipoCambio, setTipoCambio] = useState<number | "">(
    initialOrden?.tipo_cambio_moneda_eur ?? initialOrden?.tipo_cambio_usd_eur ?? "",
  );
  const [numeroPedidoAgente, setNumeroPedidoAgente] = useState(
    initialOrden?.numero_pedido_agente ?? "",
  );
  const [leadProduccion, setLeadProduccion] = useState<number | "">(
    initialOrden?.lead_time_produccion ?? "",
  );
  const [leadTransito, setLeadTransito] = useState<number | "">(
    initialOrden?.lead_time_transito ?? "",
  );
  const [leadProduccionTouched, setLeadProduccionTouched] = useState(false);
  const [leadTransitoTouched, setLeadTransitoTouched] = useState(false);
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);

  // ─── Estado ítems ─────────────────────────────────────────────────────────

  // Si se reciben productos precargados (desde sugerencias) y es una orden nueva,
  // se usan como ítems iniciales. Al editar, el useEffect de carga de API los sobreescribe.
  const [items, setItems] = useState<OrderItem[]>(() => {
    if (isEdit || !initialItems || initialItems.length === 0) return [];
    return initialItems.map((s) => ({
      _key:               `preloaded-${s.producto_id}-${Date.now()}`,
      producto_id:        s.producto_id,
      nombre:             s.nombre,
      sku:                s.sku,
      proveedor_id:       s.proveedor_id ?? null,
      proveedor_nombre:   s.proveedor_nombre ?? "",
      cantidad:           s.unidades_sugeridas ?? 1,
      cbm_unitario:       s.cbm_unitario ?? 0,
      coste_unitario_moneda: s.coste_unitario_usd ?? null,
      coste_unitario_usd: s.coste_unitario_usd ?? null,
      coste_unitario_eur: null,
      lote_producto:      null,
    }));
  });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // ─── Búsqueda de productos ────────────────────────────────────────────────

  const {
    searchQ,
    setSearchQ,
    searchResults,
    searchLoading,
    showDropdown,
    setShowDropdown,
    selectedForAdd,
    setSelectedForAdd,
    dropdownRef,
  } = useOrderProductSearch(monedaCompra);

  // ─── Estado split (gestionar en varios pedidos) ───────────────────────────

  const [showSplit,    setShowSplit]    = useState(false);
  const [items2,       setItems2]       = useState<OrderItem[]>([]);
  const [fob2,         setFob2]         = useState("");
  const [destino2,     setDestino2]     = useState("");
  const [fecha2,       setFecha2]       = useState(new Date().toISOString().slice(0, 10));
  const [cbmLimite2,   setCbmLimite2]   = useState<number>(CBM_LIMITE_DEFAULT);
  const [notas2,       setNotas2]       = useState("");

  // ─── Catálogos de puertos y agentes ──────────────────────────────────────

  const { puertosOrigen, puertosDestino, agentesCompra } = useOrderCatalogs();
  const leadSuggestionItems = useMemo(
    () =>
      items.map((item) => ({
        producto_id: item.producto_id,
        proveedor_id: item.proveedor_id,
      })),
    [items],
  );
  const suggestedLeadTimes = useOrderLeadTimeSuggestions(leadSuggestionItems);

  // ─── Métricas de cubicaje ─────────────────────────────────────────────────

  const cbmTotal  = items.reduce((s, i) => s + i.cantidad * i.cbm_unitario, 0);
  const cbmPct    = Math.min((cbmTotal / cbmLimite) * 100, 100);
  const cbmOver   = cbmTotal > cbmLimite;
  const cbmTotal2 = items2.reduce((s, i) => s + i.cantidad * i.cbm_unitario, 0);
  const cbmPct2   = Math.min((cbmTotal2 / cbmLimite2) * 100, 100);
  const totalOriginal = items.reduce(
    (sum, item) => sum + Number(item.coste_unitario_moneda ?? 0) * Number(item.cantidad ?? 0),
    0,
  );
  const fx = monedaCompra === "EUR" ? 1 : tipoCambio === "" ? null : Number(tipoCambio);
  const totalEurPreview = fx != null ? totalOriginal * fx : null;

  // ─── Carga de orden al editar ─────────────────────────────────────────────

  const { detailState } = useOrderFormLoader(
    isEdit ? (initialOrden?.id ?? null) : null,
  );

  useEffect(() => {
    if (!detailState) return;
    setTipoEnvio(detailState.tipoEnvio);
    setFob(detailState.fob);
    setDestino(detailState.destino);
    setAgenteId(detailState.agenteId);
    setFecha(detailState.fecha);
    setCbmLimite(detailState.cbmLimite);
    setNotas(detailState.notas);
    setEtd(detailState.etd);
    setEta(detailState.eta);
    setMonedaCompra(detailState.monedaCompra);
    setTipoCambio(detailState.tipoCambio);
    setNumeroPedidoAgente(detailState.numeroPedidoAgente);
    setLeadProduccion(detailState.leadProduccion);
    setLeadTransito(detailState.leadTransito);
    setItems(detailState.items);
  }, [detailState]);

  useEffect(() => {
    if (readonly) return;
    if (isEdit && !detailState) return;

    // Sin productos no hay base para estimar producción, tránsito ni fechas.
    if (items.length === 0) {
      setLeadProduccion("");
      setLeadTransito("");
      setEtd("");
      setEta("");
      setLeadProduccionTouched(false);
      setLeadTransitoTouched(false);
      setEtdTouched(false);
      setEtaTouched(false);
      return;
    }

    if (
      !leadProduccionTouched &&
      suggestedLeadTimes.lead_time_produccion != null
    ) {
      setLeadProduccion(suggestedLeadTimes.lead_time_produccion);
    }
    if (
      !leadTransitoTouched &&
      suggestedLeadTimes.lead_time_transito != null
    ) {
      setLeadTransito(suggestedLeadTimes.lead_time_transito);
    }
  }, [
    leadProduccion,
    leadProduccionTouched,
    leadTransito,
    leadTransitoTouched,
    detailState,
    isEdit,
    items.length,
    readonly,
    suggestedLeadTimes.lead_time_produccion,
    suggestedLeadTimes.lead_time_transito,
  ]);

  useEffect(() => {
    if (readonly) return;
    if (isEdit && !detailState) return;
    if (items.length === 0) return;

    const produccion = toNonNegativeInteger(leadProduccion);
    const transito = toNonNegativeInteger(leadTransito);
    if (!fecha || produccion == null) return;

    // Recalcula solo los campos automáticos; los valores tocados por el usuario se conservan.
    const calculatedEtd = addDaysToIsoDate(fecha, produccion);
    const baseEtd = etdTouched && etd ? etd : calculatedEtd;

    if (!etdTouched && etd !== calculatedEtd) {
      setEtd(calculatedEtd);
    }

    if (transito == null) return;
    const calculatedEta = addDaysToIsoDate(baseEtd, transito);
    if (!etaTouched && eta !== calculatedEta) {
      setEta(calculatedEta);
    }
  }, [
    eta,
    etaTouched,
    detailState,
    etd,
    etdTouched,
    fecha,
    isEdit,
    items.length,
    leadProduccion,
    leadTransito,
    readonly,
  ]);

  // ─── Manipulación de ítems ────────────────────────────────────────────────

  const removeItem = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i._key !== key));
  }, []);

  const updateItem = useCallback(
    (key: string, field: keyof OrderItem, value: unknown) => {
      setItems((prev) =>
        prev.map((i) => (i._key === key ? { ...i, [field]: value } : i)),
      );
    },
    [],
  );

  function toggleProductSelection(productoId: string) {
    setShowDropdown(true);
    setSelectedForAdd((prev) => {
      const next = new Set(prev);
      next.has(productoId) ? next.delete(productoId) : next.add(productoId);
      return next;
    });
  }

  function addProductFromSearch(prod: ProductoSearch) {
    if (items.find((i) => i.producto_id === prod.producto_id)) return;
    setItems((prev) => [...prev, productSearchToOrderItem(prod, monedaCompra)]);
  }

  function addSelectedProducts() {
    const toAdd = searchResults.filter(
      (p) =>
        selectedForAdd.has(p.producto_id) &&
        !items.find((i) => i.producto_id === p.producto_id),
    );
    if (!toAdd.length) return;
    setItems((prev) => [
      ...prev,
      ...toAdd.map((prod) => productSearchToOrderItem(prod, monedaCompra)),
    ]);
    setSelectedForAdd(new Set());
  }

  // ─── Split automático: mueve ítems de exceso a la Orden 2 ─────────────────

  function handleSplit() {
    setFob2(fob);
    setDestino2(destino);
    setFecha2(fecha);
    setCbmLimite2(cbmLimite);
    let acc = 0;
    const keep: OrderItem[] = [];
    const overflow: OrderItem[] = [];
    for (const item of items) {
      const itemCbm = item.cantidad * item.cbm_unitario;
      if (acc + itemCbm <= cbmLimite) {
        keep.push(item);
        acc += itemCbm;
      } else {
        overflow.push(item);
      }
    }
    setItems(keep);
    setItems2(overflow);
    setShowSplit(true);
  }

  function moveToOrder2(key: string) {
    const item = items.find((i) => i._key === key);
    if (!item) return;
    setItems((prev) => prev.filter((i) => i._key !== key));
    setItems2((prev) => [...prev, item]);
  }

  function moveToOrder1(key: string) {
    const item = items2.find((i) => i._key === key);
    if (!item) return;
    setItems2((prev) => prev.filter((i) => i._key !== key));
    setItems((prev) => [...prev, item]);
  }

  // ─── Guardado ─────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaveWarnings([]);
    const headerOpts = {
      tipoEnvio,
      fob,
      destino,
      agenteId,
      fecha,
      cbmLimite,
      notas,
      etd,
      eta,
      monedaCompra,
      tipoCambio,
      numeroPedidoAgente,
      leadProduccion,
      leadTransito,
    };
    try {
      const body1 = buildOrderFormPayload(items, headerOpts);
      const url1  = isConfirmedEdit
        ? `/api/orders/${initialOrden!.id}/confirmed-edit`
        : isEdit
          ? `/api/orders/${initialOrden!.id}`
          : "/api/orders";
      const r1    = await fetch(url1, {
        method:  isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body1),
      });
      const j1 = await r1.json();
      if (!j1.ok) throw new Error(j1.error ?? "Error guardando la orden");
      const warnings = (j1.warnings ?? []) as Array<{ code?: string }>;
      if (warnings.length > 0) {
        setSaveWarnings(["Algunas líneas no tienen coste histórico. Revísalas antes de confirmar."]);
      }

      if (showSplit && items2.length > 0) {
        const body2 = buildOrderFormPayload(items2, {
          ...headerOpts,
          tipoEnvio,
          fob: fob2,
          destino: destino2,
          fecha: fecha2,
          cbmLimite: cbmLimite2,
          notas: notas2,
        });
        const r2 = await fetch("/api/orders", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body2),
        });
        const j2 = await r2.json();
        if (!j2.ok) throw new Error(j2.error ?? "Error guardando la segunda orden");
      }

      if (isConfirmedEdit && initialOrden?.id) {
        window.open(`/api/orders/${initialOrden.id}/proforma`, "_blank", "noopener,noreferrer");
      }

      onSaved(j1.orden as OrdenRow | undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const titleText = isConfirmedEdit
    ? `Editar ${initialOrden?.numero_orden ?? "confirmada"}`
    : isEdit
      ? `Editar ${initialOrden?.numero_orden ?? "borrador"}`
      : "Nueva Orden de Compra";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl my-8">

        {/* ── Encabezado ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">{titleText}</h2>
            {isConfirmedEdit && (
              <span className="text-xs text-emerald-600 font-medium">
                Confirmada - edicion economica/logistica
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <span className="sr-only">Cerrar</span>
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* ── Cabecera de la orden ── */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                FOB Puerto salida
              </label>
              <select
                disabled={readonly}
                value={fob}
                onChange={(e) => setFob(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona puerto</option>
                {puertosOrigen.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                {fob && !puertosOrigen.some((p) => p.name === fob) && (
                  <option value={fob}>{fob}</option>
                )}
              </select>
              {/* DEBUG — eliminar cuando el problema esté resuelto */}
              {puertosOrigen.length === 0 && (
                <p className="mt-1 text-[10px] text-red-500">No se han cargado puertos de origen</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Tipo de envio previsto
              </label>
              <select
                disabled={readonly}
                value={tipoEnvio}
                onChange={(e) =>
                  setTipoEnvio(e.target.value === "amazon_agl" ? "amazon_agl" : "propio")
                }
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="propio">Propio</option>
                <option value="amazon_agl">Amazon AGL</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Destino
              </label>
              <select
                disabled={readonly}
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Selecciona destino</option>
                {puertosDestino.map((d) => <option key={d.id} value={d.name}>{d.name}{d.country ? ` (${d.country})` : ""}</option>)}
                {destino && !puertosDestino.some((d) => d.name === destino) && (
                  <option value={destino}>{destino}</option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Agente de compra
              </label>
              <select
                disabled={readonly}
                value={agenteId}
                onChange={(e) => setAgenteId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Sin agente</option>
                {agentesCompra.map((agente) => (
                  <option key={agente.id} value={agente.id}>
                    {agente.contacto ?? "Sin contacto"}
                  </option>
                ))}
                {agenteId && !agentesCompra.some((agente) => agente.id === agenteId) ? (
                  <option value={agenteId}>
                    {initialOrden?.agente_contacto ?? "Agente asignado"}
                  </option>
                ) : null}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Fecha orden
              </label>
              <input
                type="date"
                disabled={readonly || isConfirmedEdit}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Límite contenedor (m³)
              </label>
              <input
                type="number"
                disabled={readonly || isConfirmedEdit}
                value={cbmLimite}
                onChange={(e) => setCbmLimite(Number(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {!readonly ? (
            <div className="grid grid-cols-2 md:grid-cols-7 gap-4 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">ETD</label>
                <input
                  type="date"
                  value={etd}
                  onChange={(e) => {
                    setEtdTouched(true);
                    setEtd(e.target.value);
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">ETA</label>
                <input
                  type="date"
                  value={eta}
                  onChange={(e) => {
                    setEtaTouched(true);
                    setEta(e.target.value);
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">ProducciÃ³n</label>
                <input
                  type="number"
                  min={0}
                  value={leadProduccion}
                  onChange={(e) => {
                    setLeadProduccionTouched(true);
                    setLeadProduccion(e.target.value === "" ? "" : Number(e.target.value));
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">TrÃ¡nsito</label>
                <input
                  type="number"
                  min={0}
                  value={leadTransito}
                  onChange={(e) => {
                    setLeadTransitoTouched(true);
                    setLeadTransito(e.target.value === "" ? "" : Number(e.target.value));
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Moneda</label>
                <select
                  value={monedaCompra}
                  disabled={isConfirmedEdit}
                  onChange={(e) => setMonedaCompra(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {["USD", "EUR", "GBP", "CNY"].map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  1 {monedaCompra} = EUR
                </label>
                <input
                  type="number"
                  step="0.0001"
                  value={tipoCambio}
                  disabled={monedaCompra === "EUR" || isConfirmedEdit}
                  onChange={(e) =>
                    setTipoCambio(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nº pedido agente</label>
                <input
                  value={numeroPedidoAgente}
                  onChange={(e) => setNumeroPedidoAgente(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          ) : null}

          {saveWarnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {saveWarnings.join(" ")}
            </div>
          ) : null}

          {/* ── Info extra en modo readonly (orden confirmada) ── */}
          {false && readonly && initialOrden && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
              <div>
                <span className="text-[10px] uppercase text-emerald-700/80 font-medium">ETA</span>
                <p className="font-semibold text-slate-800">{initialOrden.eta ?? "—"}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase text-emerald-700/80 font-medium">
                  Producción / Tránsito
                </span>
                <p className="font-semibold text-slate-800">
                  {initialOrden.lead_time_produccion ?? "—"} /{" "}
                  {initialOrden.lead_time_transito ?? "—"} días
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase text-emerald-700/80 font-medium">
                  Cambio USD→EUR
                </span>
                <p className="font-semibold text-slate-800">
                  {initialOrden.tipo_cambio_usd_eur ?? "—"}
                </p>
              </div>
              <div>
                <span className="text-[10px] uppercase text-emerald-700/80 font-medium">
                  Nº pedido agente
                </span>
                <p className="font-semibold text-slate-800 truncate">
                  {initialOrden.numero_pedido_agente ?? "—"}
                </p>
              </div>
            </div>
          )}

          {/* ── Barra de cubicaje ── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-slate-500">Cubicaje utilizado</span>
              <span
                className={`text-xs font-bold ${
                  cbmOver ? "text-red-600" : cbmPct >= 80 ? "text-orange-500" : "text-emerald-600"
                }`}
              >
                {cbmTotal.toFixed(3)} / {cbmLimite} m³ (
                {cbmTotal > 0 ? ((cbmTotal / cbmLimite) * 100).toFixed(1) : "0.0"}%)
              </span>
            </div>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  cbmOver ? "bg-red-500" : cbmPct >= 80 ? "bg-orange-400" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min((cbmTotal / cbmLimite) * 100, 100)}%` }}
              />
            </div>

            {/* Panel de exceso de cubicaje */}
            {cbmOver && !showSplit && !readonly && !isConfirmedEdit && (
              <div className="mt-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-red-700 flex-1">
                    <strong>⚠ Exceso:</strong>{" "}
                    {(cbmTotal - cbmLimite).toFixed(3)} m³ sobre el límite.
                  </span>
                  <button
                    type="button"
                    onClick={handleSplit}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    Gestionar en varios pedidos
                  </button>
                </div>
              </div>
            )}
            {cbmOver && showSplit && (
              <p className="text-xs text-blue-600 mt-1">
                Pedido dividido en 2 órdenes · ambas se guardarán como borrador
              </p>
            )}
          </div>

          {/* ── Tabla de ítems ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700">Productos del pedido</h3>
              <span className="text-xs text-slate-400">
                {items.length} artículo{items.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-medium">Ref / Nombre</th>
                    <th className="px-3 py-2.5 text-left font-medium">Proveedor</th>
                    <th className="px-3 py-2.5 text-center font-medium w-24">Cantidad</th>
                    <th className="px-3 py-2.5 text-center font-medium w-24">CBM unit.</th>
                    <th className="px-3 py-2.5 text-center font-medium w-28">CBM total</th>
                    <th className="px-3 py-2.5 text-center font-medium w-28">
                      {readonly ? "Coste USD / EUR" : `Coste ${monedaCompra}`}
                    </th>
                    <th className="px-3 py-2.5 text-center font-medium w-28">Lote</th>
                    {!readonly && !isConfirmedEdit && <th className="px-3 py-2.5 w-16" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={readonly || isConfirmedEdit ? 7 : 8}
                        className="px-4 py-8 text-center text-slate-400 text-sm"
                      >
                        {readonly
                          ? "Esta orden no tiene líneas."
                          : "Busca y agrega productos desde el buscador inferior."}
                      </td>
                    </tr>
                  )}
                  {items.map((item) => (
                    <tr key={item._key} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-800 text-xs leading-tight">
                          {item.nombre}
                        </p>
                        <p className="text-xs text-slate-400">{item.sku}</p>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {item.proveedor_nombre}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          disabled={readonly || isConfirmedEdit}
                          value={item.cantidad}
                          onChange={(e) =>
                            updateItem(item._key, "cantidad", Math.max(1, Number(e.target.value)))
                          }
                          className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-center disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          readOnly
                          value={item.cbm_unitario}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-center bg-slate-50 text-slate-500"
                        />
                      </td>
                      <td className="px-3 py-2 text-center text-sm font-medium text-slate-700">
                        {(item.cantidad * item.cbm_unitario).toFixed(4)}
                      </td>
                      <td className="px-3 py-2">
                        {readonly ? (
                          <div className="text-center text-xs space-y-1">
                            <div className="font-medium text-slate-800">
                              {item.coste_unitario_usd != null
                                ? `$${Number(item.coste_unitario_usd).toFixed(2)}`
                                : "—"}
                            </div>
                            <div className="font-semibold text-blue-700">
                              {item.coste_unitario_eur != null
                                ? `€${Number(item.coste_unitario_eur).toFixed(2)}`
                                : "—"}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={item.coste_unitario_moneda ?? item.coste_unitario_usd ?? ""}
                              onChange={(e) => {
                                const val = e.target.value ? Number(e.target.value) : null;
                                const synced = syncOrderLineCostFields({
                                  monedaCompra,
                                  costeUnitarioUsd: monedaCompra === "USD" ? val : item.coste_unitario_usd,
                                  costeUnitarioMoneda: val,
                                  costeUnitarioEur: item.coste_unitario_eur,
                                });
                                setItems((prev) =>
                                  prev.map((row) =>
                                    row._key === item._key
                                      ? { ...row, ...synced, sin_coste_historico: false }
                                      : row,
                                  ),
                                );
                              }}
                              placeholder="—"
                              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {item.sin_coste_historico ? (
                              <p className="mt-0.5 text-[10px] text-amber-600">Sin coste histórico</p>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          disabled={readonly || isConfirmedEdit}
                          value={item.lote_producto ?? ""}
                          onChange={(e) =>
                            updateItem(item._key, "lote_producto", e.target.value || null)
                          }
                          placeholder="L-2026-01"
                          className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs text-center disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                        />
                      </td>
                      {!readonly && !isConfirmedEdit && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            {showSplit && (
                              <button
                                type="button"
                                onClick={() => moveToOrder2(item._key)}
                                title="Mover a Orden 2"
                                className="p-1 rounded hover:bg-amber-50 text-slate-300 hover:text-amber-500 transition"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removeItem(item._key)}
                              className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Buscador de productos ── */}
            {!readonly && !isConfirmedEdit && (
              <div className="mt-3 relative" ref={dropdownRef}>
                <div className="relative">
                  <input
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                    placeholder="Buscar por nombre, SKU, categoría o proveedor…"
                    className="w-full border border-dashed border-blue-300 rounded-xl px-4 py-2.5 text-sm bg-blue-50 placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                  />
                  <Search
                    className={`absolute right-3 top-2.5 h-4 w-4 pointer-events-none ${
                      searchLoading ? "animate-pulse text-blue-400" : "text-blue-300"
                    }`}
                  />
                </div>

                {showDropdown && searchResults.length > 0 && (
                  <div
                    className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-96 overflow-hidden z-50"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {selectedForAdd.size > 0 && (
                      <div className="sticky top-0 bg-blue-50 border-b border-blue-200 px-3 py-2 flex items-center justify-between z-10">
                        <span className="text-xs font-semibold text-blue-700">
                          {selectedForAdd.size} producto{selectedForAdd.size !== 1 ? "s" : ""}{" "}
                          seleccionado{selectedForAdd.size !== 1 ? "s" : ""}
                        </span>
                        <button
                          type="button"
                          onClick={addSelectedProducts}
                          className="px-3 py-1 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition"
                        >
                          Añadir seleccionados
                        </button>
                      </div>
                    )}
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                      {searchResults.map((p) => {
                        const alreadyAdded = items.some((i) => i.producto_id === p.producto_id);
                        const isSelected   = selectedForAdd.has(p.producto_id);
                        return (
                          <div
                            key={p.producto_id}
                            className={`flex items-center gap-3 px-3 py-2 transition ${
                              alreadyAdded
                                ? "opacity-60 bg-emerald-50/50"
                                : isSelected
                                  ? "bg-blue-50"
                                  : "hover:bg-blue-50"
                            }`}
                          >
                            {!alreadyAdded && (
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleProductSelection(p.producto_id)}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500 cursor-pointer shrink-0"
                              />
                            )}
                            {alreadyAdded && <div className="w-4 shrink-0" />}

                            {/* Thumbnail */}
                            <div className="w-9 h-9 rounded-lg overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center">
                              {p.imagen_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={p.imagen_url}
                                  alt={p.nombre}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-xs text-slate-400">IMG</span>
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-800 text-sm truncate">
                                {p.nombre}
                              </p>
                              <p className="text-xs text-slate-400">
                                {p.sku}
                                {p.categoria && (
                                  <span className="ml-2 text-slate-300">· {p.categoria}</span>
                                )}
                              </p>
                            </div>

                            <div className="text-right shrink-0 text-xs space-y-0.5">
                              <p className="text-slate-600">
                                FBA <span className="font-semibold">{p.stock_fba}</span>{" "}
                                · FBM <span className="font-semibold">{p.stock_fbm}</span>
                              </p>
                              <CoberturaChip dias={p.dias_cobertura} />
                            </div>

                            {p.cbm_unitario > 0 && (
                              <div className="text-right shrink-0 text-xs text-slate-400 w-16">
                                {p.cbm_unitario.toFixed(4)} m³
                              </div>
                            )}

                            {alreadyAdded && (
                              <span className="text-xs text-emerald-600 font-medium shrink-0">
                                ✓ Añadido
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {showDropdown && searchQ.length > 0 && searchResults.length === 0 && !searchLoading && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3 z-50">
                    <p className="text-sm text-slate-400">Sin resultados para "{searchQ}"</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Notas ── */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Notas</label>
            <textarea
              disabled={readonly}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Instrucciones especiales, referencias…"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* ── Orden 2 (split) ── */}
          {showSplit && (
            <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/30 p-5 space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Scissors className="h-4 w-4 text-amber-600" />
                  <h3 className="text-sm font-bold text-amber-800">
                    Orden 2 — Exceso de cubicaje
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSplit(false);
                    setItems((prev) => [...prev, ...items2]);
                    setItems2([]);
                  }}
                  className="text-xs text-slate-500 hover:text-red-600 transition"
                >
                  Deshacer split
                </button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    FOB Puerto
                  </label>
                  <select
                    value={fob2}
                    onChange={(e) => setFob2(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">Selecciona puerto</option>
                    {puertosOrigen.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Destino</label>
                  <select
                    value={destino2}
                    onChange={(e) => setDestino2(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">Selecciona destino</option>
                    {puertosDestino.map((d) => <option key={d.id} value={d.name}>{d.name}{d.country ? ` (${d.country})` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Fecha orden
                  </label>
                  <input
                    type="date"
                    value={fecha2}
                    onChange={(e) => setFecha2(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Límite m³</label>
                  <input
                    type="number"
                    value={cbmLimite2}
                    onChange={(e) => setCbmLimite2(Number(e.target.value))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-500">Cubicaje orden 2</span>
                  <span className={`font-bold ${cbmPct2 > 100 ? "text-red-600" : "text-emerald-600"}`}>
                    {cbmTotal2.toFixed(3)} / {cbmLimite2} m³
                  </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${cbmPct2 > 100 ? "bg-red-500" : "bg-amber-400"}`}
                    style={{ width: `${Math.min(cbmPct2, 100)}%` }}
                  />
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-amber-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-amber-50 text-xs uppercase text-amber-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Producto</th>
                      <th className="px-3 py-2 text-center w-24">Cantidad</th>
                      <th className="px-3 py-2 text-center w-28">CBM total</th>
                      <th className="px-3 py-2 w-16" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-50">
                    {items2.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-400 text-sm">
                          Sin ítems en esta orden
                        </td>
                      </tr>
                    )}
                    {items2.map((item) => (
                      <tr key={item._key} className="hover:bg-amber-50/50">
                        <td className="px-3 py-2">
                          <p className="font-medium text-xs text-slate-800">{item.nombre}</p>
                          <p className="text-xs text-slate-400">{item.sku}</p>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={1}
                            value={item.cantidad}
                            onChange={(e) =>
                              setItems2((prev) =>
                                prev.map((i) =>
                                  i._key === item._key
                                    ? { ...i, cantidad: Math.max(1, Number(e.target.value)) }
                                    : i,
                                ),
                              )
                            }
                            className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-amber-400"
                          />
                        </td>
                        <td className="px-3 py-2 text-center text-sm font-medium text-slate-700">
                          {(item.cantidad * item.cbm_unitario).toFixed(4)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => moveToOrder1(item._key)}
                              title="Mover a Orden 1"
                              className="p-1 rounded hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setItems2((prev) => prev.filter((i) => i._key !== item._key))
                              }
                              className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Notas orden 2
                </label>
                <textarea
                  value={notas2}
                  onChange={(e) => setNotas2(e.target.value)}
                  rows={2}
                  placeholder="Instrucciones para este contenedor…"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-semibold text-slate-600">Total orden</span>
              <span className="font-bold text-slate-900">
                {formatMoney(totalOriginal, monedaCompra)}
                <span className="ml-3 text-blue-700">
                  {totalEurPreview != null ? `EUR ${totalEurPreview.toFixed(2)}` : "EUR pendiente"}
                </span>
              </span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* ── Footer ── */}
        {!readonly ? (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition"
            >
              {saving
                ? "Guardando…"
                : isConfirmedEdit
                  ? "Guardar y generar nueva proforma"
                  : showSplit
                  ? "Guardar 2 borradores"
                  : isEdit
                    ? "Guardar cambios"
                    : "Guardar borrador"}
            </button>
          </div>
        ) : (
          <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
            >
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
