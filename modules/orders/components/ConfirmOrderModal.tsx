/**
 * Módulo   : orders
 * Archivo  : modules/orders/components/ConfirmOrderModal.tsx
 * Qué hace : Modal de confirmación de una orden de compra en borrador.
 *            Permite revisar/editar lead times, fechas ETD/ETA, condiciones de pago
 *            y costes unitarios por línea antes de confirmar.
 * Responsabilidad : Cargar las líneas desde GET /api/orders/[id] y confirmar
 *                   la orden mediante POST /api/orders/[id]/confirm.
 * No debe          : Crear órdenes, gestionar stock ni importar desde legacy (bussines/).
 */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, X, FileText } from "lucide-react";
import { useMarketFxRate } from "@/modules/orders/hooks/useMarketFxRate";

// ─── Tipos locales ────────────────────────────────────────────────────────────

/** Cabecera mínima de la orden necesaria para el modal. */
export type OrdenConfirmRow = {
  id: string;
  numero_orden: string | null;
  fob_puerto: string | null;
  destino: string | null;
  fecha_orden?: string | null;
  etd?: string | null;
  eta?: string | null;
  cbm_total: number | null;
  coste_total_eur: number | null;
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;
  agente_id?: string | null;
  agente_contacto?: string | null;
};

type PurchasingAgent = {
  id: string;
  contacto: string | null;
};

type ConfirmedOrderAttemptResult = {
  orden: OrdenConfirmRow & { estado?: string };
  warnings: string[];
};

/** Ítem enriquecido con nombre/SKU de producto para la tabla de costes. */
type ItemWithCost = {
  id: string;
  producto_id: string;
  nombre: string;
  sku: string;
  cantidad: number;
  /** Precio unitario en la moneda de compra seleccionada. */
  coste_unitario_moneda: number | null;
  lote_producto: string | null;
};

export interface ConfirmOrderModalProps {
  /** Orden a confirmar. */
  orden: OrdenConfirmRow;
  /** Callback al cerrar sin confirmar. */
  onClose: () => void;
  /** Callback al confirmar con éxito (refresca el listado). */
  onConfirmed: (result: ConfirmedOrderAttemptResult) => void;
  onOrderRefreshed?: (orden: ConfirmedOrderAttemptResult["orden"]) => void;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const MONEDAS = [
  { code: "USD", simbolo: "$" },
  { code: "EUR", simbolo: "€" },
  { code: "GBP", simbolo: "£" },
  { code: "CNY", simbolo: "¥" },
];

/** Fallback solo si la orden no tiene lead times y los proveedores tampoco. */
const LEAD_TIME_FALLBACK = { produccion: 30, transito: 35 } as const;

type OrderLeadSource = {
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;
};

type ItemSupplierLead = {
  proveedor_id?: string | null;
  proveedores?: SupplierLeadRow | SupplierLeadRow[] | null;
};

type SupplierLeadRow = {
    dias_produccion_estandar?: number | null;
    dias_transito_estandar?: number | null;
};

function toLeadDays(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeDate(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.slice(0, 10) : "";
}

function todayIsoDate(): string {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Máximo por proveedor distinto (contenedor espera a la fábrica más lenta). */
function maxLeadFromSuppliers(items: ItemSupplierLead[]): {
  produccion: number;
  transito: number;
  found: boolean;
} {
  const seen = new Set<string>();
  let maxProd = 0;
  let maxTrans = 0;
  let found = false;

  for (const item of items) {
    const proveedorId = item.proveedor_id;
    if (!proveedorId || seen.has(proveedorId)) continue;
    seen.add(proveedorId);

    const proveedor = firstRelation(item.proveedores);
    const prod = toLeadDays(proveedor?.dias_produccion_estandar);
    const trans = toLeadDays(proveedor?.dias_transito_estandar);
    if (prod != null) {
      maxProd = Math.max(maxProd, prod);
      found = true;
    }
    if (trans != null) {
      maxTrans = Math.max(maxTrans, trans);
      found = true;
    }
  }

  return { produccion: maxProd, transito: maxTrans, found };
}

/**
 * Prioridad: lead times ya guardados en ordenes_compra; si no, máximos de proveedores
 * (dias_produccion_estandar / dias_transito_estandar en tabla proveedores).
 */
function resolveInitialLeadTimes(
  orden: OrderLeadSource,
  items: ItemSupplierLead[],
): { diasProduccion: number; diasTransito: number; fuente: "orden" | "proveedor" } {
  const orderProd = toLeadDays(orden.lead_time_produccion);
  const orderTrans = toLeadDays(orden.lead_time_transito);

  if (orderProd != null && orderTrans != null) {
    return {
      diasProduccion: orderProd,
      diasTransito: orderTrans,
      fuente: "orden",
    };
  }

  const supplierLeads = maxLeadFromSuppliers(items);
  const fallbackProd = supplierLeads.found
    ? supplierLeads.produccion
    : LEAD_TIME_FALLBACK.produccion;
  const fallbackTrans = supplierLeads.found
    ? supplierLeads.transito
    : LEAD_TIME_FALLBACK.transito;

  if (orderProd != null || orderTrans != null) {
    return {
      diasProduccion: orderProd ?? fallbackProd,
      diasTransito: orderTrans ?? fallbackTrans,
      fuente: "orden",
    };
  }

  return {
    diasProduccion: fallbackProd,
    diasTransito: fallbackTrans,
    fuente: "proveedor",
  };
}

// ─── Componente principal ──────────────────────────────────────────────────────

/**
 * Modal que guía al usuario a través de los pasos finales antes de confirmar
 * una orden: verificar tiempos, ajustar costes y establecer condiciones de pago.
 */
export default function ConfirmOrderModal({
  orden,
  onClose,
  onConfirmed,
  onOrderRefreshed,
}: ConfirmOrderModalProps) {
  // ─── Carga de líneas ──────────────────────────────────────────────────────

  const [items,   setItems]   = useState<ItemWithCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentesCompra, setAgentesCompra] = useState<PurchasingAgent[]>([]);

  useEffect(() => {
    fetch(`/api/orders/${orden.id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const ordenData = j.orden as OrderLeadSource & Record<string, unknown>;
          const rawItems = (j.items ?? []) as ItemSupplierLead[];

          const monedaOrden = (ordenData.moneda_compra ?? "USD").toString().toUpperCase();
          setMoneda(monedaOrden);
          const storedFx = ordenData.planned_fx_foreign_per_eur;
          // Un tipo ya congelado (orden reabierta) prevalece sobre el del mercado.
          fxEditedRef.current = storedFx != null && storedFx !== "";
          setPlannedFxForeignPerEur(
            monedaOrden === "EUR" ? "1" : String(storedFx ?? ""),
          );
          // Cada carga sin tipo guardado vuelve a pedir el del mercado (la carga
          // puede repetirse, p. ej. StrictMode, después de haberlo rellenado).
          setFxLoadKey((key) => key + 1);
          setAgenteId(
            (ordenData.agente_id as string | null | undefined) ??
              orden.agente_id ??
              "",
          );
          if (ordenData.numero_pedido_agente) {
            setNumeroPedidoAgente(String(ordenData.numero_pedido_agente));
          }
          const { diasProduccion: prod, diasTransito: trans, fuente } =
            resolveInitialLeadTimes({ ...orden, ...ordenData }, rawItems);
          setDiasProduccion(prod);
          setDiasTransito(trans);
          console.log("Lead producción:", prod);
          console.log("Lead tránsito:", trans);
          console.log("Fuente:", fuente);

          const savedEtd = normalizeDate(ordenData.etd ?? orden.etd);
          const savedEta = normalizeDate(ordenData.eta ?? orden.eta);
          const fechaBase = normalizeDate(ordenData.fecha_orden ?? orden.fecha_orden);
          setOrderDate(fechaBase);
          if (!etdEditedRef.current) setEtd(savedEtd);
          if (!etaEditedRef.current) setEta(savedEta);
          if (ordenData.deposito_porcentaje != null) {
            setDepositoPct(Number(ordenData.deposito_porcentaje));
          }
          if (ordenData.balance_dias_antes_eta != null) {
            setBalanceDiasAntesEta(Number(ordenData.balance_dias_antes_eta));
          }
          if (ordenData.balance_condiciones_texto) {
            setBalanceCondiciones(String(ordenData.balance_condiciones_texto));
          }

          setItems(
            rawItems.map((i) => {
              const row = i as ItemSupplierLead & Record<string, unknown>;
              const usd = row.coste_unitario_usd as number | null;
              const eur = row.coste_unitario_eur as number | null;
              const mon = row.coste_unitario_moneda as number | null;
              let costeMoneda: number | null = mon;
              if (costeMoneda == null) {
                if (monedaOrden === "EUR") costeMoneda = eur ?? usd;
                else if (monedaOrden === "USD") costeMoneda = usd ?? eur;
                else costeMoneda = mon ?? eur ?? usd;
              }
              return {
                id: row.id as string,
                producto_id: row.producto_id as string,
                nombre: (row.productos as { nombre?: string } | null)?.nombre ?? "",
                sku: (row.productos as { sku?: string } | null)?.sku ?? "",
                cantidad: row.cantidad as number,
                coste_unitario_moneda: costeMoneda,
                lote_producto: (row.lote_producto as string | null) ?? null,
              };
            }),
          );
        }
      })
      .finally(() => setLoading(false));
  }, [orden.id]);

  useEffect(() => {
    fetch("/api/purchasing-agents")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok && Array.isArray(j.rows)) {
          setAgentesCompra(j.rows as PurchasingAgent[]);
        }
      })
      .catch(() => setAgentesCompra([]));
  }, []);

  // ─── Estado del formulario ────────────────────────────────────────────────

  const [diasProduccion, setDiasProduccion] = useState<number>(
    toLeadDays(orden.lead_time_produccion) ?? LEAD_TIME_FALLBACK.produccion,
  );
  const [diasTransito, setDiasTransito] = useState<number>(
    toLeadDays(orden.lead_time_transito) ?? LEAD_TIME_FALLBACK.transito,
  );
  const [numeroPedidoAgente, setNumeroPedidoAgente] = useState("");
  const [agenteId, setAgenteId] = useState(orden.agente_id ?? "");
  const [moneda,  setMoneda]  = useState("USD");
  const [plannedFxForeignPerEur,setPlannedFxForeignPerEur]=useState("");
  const fxEditedRef = useRef(false);
  const [fxLoadKey, setFxLoadKey] = useState(0);
  const marketFx = useMarketFxRate(moneda);
  useEffect(() => {
    // Esperar a la orden (puede traer un tipo congelado) y no aplicar el tipo de otra moneda.
    if (fxLoadKey === 0 || moneda === "EUR" || fxEditedRef.current) return;
    if (marketFx.currency !== moneda || marketFx.foreignPerEur == null) return;
    setPlannedFxForeignPerEur(String(marketFx.foreignPerEur));
  }, [fxLoadKey, moneda, marketFx.currency, marketFx.foreignPerEur]);
  const [confirmationDate, setConfirmationDate] = useState(todayIsoDate);
  const [orderDate, setOrderDate] = useState(normalizeDate(orden.fecha_orden));
  const [etd,     setEtd]     = useState("");
  const [eta,     setEta]     = useState("");
  const etdEditedRef = useRef(false);
  const etaEditedRef = useRef(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Condiciones de pago (editables)
  const [depositoPct,          setDepositoPct]          = useState(30);
  const [balanceDiasAntesEta,  setBalanceDiasAntesEta]  = useState(10);
  const [balanceCondiciones,   setBalanceCondiciones]   = useState(
    "The balance will be paid 10 days before the vessel arrives at the port",
  );

  const suggestedEtd = useMemo(() => {
    if (!orderDate) return "";
    return addDaysToIsoDate(orderDate, Math.max(0, diasProduccion));
  }, [orderDate, diasProduccion]);

  const suggestedEta = useMemo(() => {
    const effectiveEtd = etd || suggestedEtd;
    if (!effectiveEtd) return "";
    return addDaysToIsoDate(effectiveEtd, Math.max(0, diasTransito));
  }, [etd, suggestedEtd, diasTransito]);

  /** Fecha de pago del balance (ETA real o calculada - balanceDiasAntesEta días). */
  function calcBalanceDate(): string {
    const targetEta = eta || suggestedEta;
    if (!targetEta) return "-";
    const d = new Date(targetEta);
    d.setDate(d.getDate() - balanceDiasAntesEta);
    return d.toLocaleDateString("es-ES");
  }

  // ─── Helpers de moneda ────────────────────────────────────────────────────

  const monedaInfo = MONEDAS.find((m) => m.code === moneda) ?? MONEDAS[0];

  const totalMoneda = items.reduce(
    (s, i) => s + (i.coste_unitario_moneda ?? 0) * i.cantidad,
    0,
  );
  function handleMonedaChange(nueva: string) {
    // Otra moneda invalida el tipo anterior: se vuelve a proponer el del mercado.
    fxEditedRef.current = false;
    setPlannedFxForeignPerEur("");
    setMoneda(nueva);
  }

  // ─── Edición de costes ────────────────────────────────────────────────────

  function updateCosteMoneda(id: string, val: string) {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, coste_unitario_moneda: val === "" ? null : Number(val) }
          : i,
      ),
    );
  }

  function updateItemCantidad(id: string, value: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, cantidad: Math.max(1, Number(value) || 1) } : item,
      ),
    );
  }

  function updateLote(id: string, val: string) {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, lote_producto: val.trim() || null } : i)),
    );
  }

  // ─── Confirmación ────────────────────────────────────────────────────────

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      const plannedFx = moneda === "EUR" ? 1 : Number(plannedFxForeignPerEur);
      if (!Number.isFinite(plannedFx) || plannedFx <= 0) {
        throw new Error("Introduce un tipo de cambio estimado válido para planificación.");
      }
      const r = await fetch(`/api/orders/${orden.id}/confirm`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmationDate,
          eta:                       eta || null,
          etd:                       etd || null,
          lead_time_produccion:      diasProduccion,
          lead_time_transito:        diasTransito,
          numero_pedido_agente:      numeroPedidoAgente || null,
          agente_id:                 agenteId || null,
          moneda_compra:             moneda,
          planned_fx_foreign_per_eur: plannedFx,
          deposito_porcentaje:       depositoPct,
          balance_dias_antes_eta:    balanceDiasAntesEta,
          balance_condiciones_texto: balanceCondiciones,
          items_costes: items.map((i) => ({
              item_id:               i.id,
              coste_unitario_moneda: i.coste_unitario_moneda,
              coste_unitario_eur:    moneda === "EUR" ? i.coste_unitario_moneda : null,
              coste_unitario_usd:    moneda === "USD" ? i.coste_unitario_moneda : null,
              lote_producto:         i.lote_producto,
          })),
        }),
      });
      const j = await r.json() as {
        ok?: boolean;
        orden?: ConfirmedOrderAttemptResult["orden"];
        warnings?: string[];
        error?: string;
      };
      const warnings = Array.isArray(j.warnings) ? j.warnings : [];
      let serverOrder = j.orden;

      try {
        const refreshed = await fetch(`/api/orders/${orden.id}`);
        const refreshedJson = await refreshed.json();
        if (refreshedJson.ok && refreshedJson.orden) {
          serverOrder = refreshedJson.orden as ConfirmedOrderAttemptResult["orden"];
          onOrderRefreshed?.(serverOrder);
        }
      } catch (refreshError) {
        console.error("refresh order after confirm:", refreshError);
      }

      if (j.ok && serverOrder) {
        onConfirmed({ orden: serverOrder, warnings });
        return;
      }

      if (serverOrder?.estado === "confirmado") {
        onConfirmed({
          orden: serverOrder,
          warnings: warnings.length > 0
            ? warnings
            : ["La orden se confirmó, pero quedó pendiente completar una operación secundaria."],
        });
        return;
      }

      throw new Error(j.error ?? "Error confirmando la orden");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl my-8">

        {/* Encabezado */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              Confirmar orden {orden.numero_orden}
            </h2>
            <p className="text-xs text-slate-500">
              Revisa los datos antes de confirmar. No podrás editar la orden después.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* ── Sección: Lead time y ETA ── */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Lead time y ETA estimada
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Días producción
                </label>
                <input
                  type="number"
                  min={0}
                  value={diasProduccion}
                  onChange={(e) => setDiasProduccion(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Días tránsito
                </label>
                <input
                  type="number"
                  min={0}
                  value={diasTransito}
                  onChange={(e) => setDiasTransito(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  ETA
                </label>
                <input
                  type="date"
                  value={eta}
                  onChange={(e) => {
                    etaEditedRef.current = true;
                    setEta(e.target.value);
                  }}
                  className="w-full border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                {!eta && suggestedEta ? (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Sugerida: {new Date(suggestedEta).toLocaleDateString("es-ES")}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Moneda</label>
                <select
                  value={moneda}
                  onChange={(e) => handleMonedaChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {MONEDAS.map((m) => (
                    <option key={m.code} value={m.code}>{m.code}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Nº pedido agente
                </label>
                <input
                  value={numeroPedidoAgente}
                  onChange={(e) => setNumeroPedidoAgente(e.target.value)}
                  placeholder="ej. PO-2026-001"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Agente de compra
                </label>
                <select
                  value={agenteId}
                  onChange={(e) => setAgenteId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sin agente</option>
                  {agentesCompra.map((agente) => (
                    <option key={agente.id} value={agente.id}>
                      {agente.contacto ?? "Sin contacto"}
                    </option>
                  ))}
                  {agenteId && !agentesCompra.some((agente) => agente.id === agenteId) ? (
                    <option value={agenteId}>{orden.agente_contacto ?? "Agente asignado"}</option>
                  ) : null}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  ETD
                </label>
                <input
                  type="date"
                  value={etd}
                  onChange={(e) => {
                    etdEditedRef.current = true;
                    setEtd(e.target.value);
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {!etd && suggestedEtd ? (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Sugerida: {new Date(suggestedEtd).toLocaleDateString("es-ES")}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {/* ── Sección: Condiciones de pago ── */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Condiciones de pago
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Fecha de confirmación
                </label>
                <input
                  type="date"
                  required
                  value={confirmationDate}
                  onChange={(event) => setConfirmationDate(event.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Depósito (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={depositoPct}
                  onChange={(e) => setDepositoPct(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Días balance antes de ETA
                </label>
                <input
                  type="number"
                  min={0}
                  value={balanceDiasAntesEta}
                  onChange={(e) => setBalanceDiasAntesEta(Number(e.target.value))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Fecha pago balance
                </label>
                <div className="border border-blue-200 bg-blue-50 rounded-lg px-3 py-2 text-sm font-semibold text-blue-700">
                  {calcBalanceDate()}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Tipo de cambio estimado para planificación
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">1 EUR =</span>
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  required={moneda !== "EUR"}
                  disabled={moneda === "EUR"}
                  value={moneda === "EUR" ? "1" : plannedFxForeignPerEur}
                  onChange={(e) => {
                    fxEditedRef.current = true;
                    setPlannedFxForeignPerEur(e.target.value);
                  }}
                  className="w-40 border border-slate-200 rounded-lg px-3 py-2 text-sm disabled:bg-slate-50"
                />
                <span className="text-sm font-medium text-slate-700">{moneda}</span>
              </div>
              {moneda !== "EUR" ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {marketFx.loading
                    ? "Consultando tipo de referencia del BCE…"
                    : marketFx.currency === moneda && marketFx.foreignPerEur != null
                      ? `Mercado (BCE${marketFx.referenceDate ? `, ${marketFx.referenceDate}` : ""}): 1 EUR = ${marketFx.foreignPerEur} ${moneda}${String(marketFx.foreignPerEur) !== plannedFxForeignPerEur ? " · editado manualmente" : ""}`
                      : `${marketFx.error ?? "Tipo de cambio no disponible"}. Introdúcelo manualmente.`}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-slate-500">
                Referencia para planificación. El coste real se calculará con el tipo de cambio efectivo de cada pago.
              </p>
            </div>
            <div className="mt-4">
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Condiciones de pago (texto libre para proforma)
              </label>
              <textarea
                value={balanceCondiciones}
                onChange={(e) => setBalanceCondiciones(e.target.value)}
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* ── Sección: Costes unitarios ── */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-700">Costes unitarios</h3>
              <span className="text-xs text-slate-400">
                Moneda comercial: {moneda}
              </span>
            </div>

            {loading ? (
              <p className="text-sm text-slate-400 py-4">Cargando líneas…</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 text-left">Producto / SKU</th>
                      <th className="px-3 py-2.5 text-center w-16">Uds</th>
                      <th className="px-3 py-2.5 text-center w-32">
                        Precio unitario
                      </th>
                      <th className="px-3 py-2.5 text-right w-28">Total {moneda}</th>
                      <th className="px-3 py-2.5 text-center w-32">Lote</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const unitMoneda = item.coste_unitario_moneda;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-800 text-xs">{item.nombre}</p>
                            <p className="text-xs text-slate-400">{item.sku}</p>
                          </td>
                          <td className="px-3 py-2 text-center text-slate-700">
                            <input
                              type="number"
                              min={1}
                              value={item.cantidad}
                              onChange={(e) => updateItemCantidad(item.id, e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={unitMoneda ?? ""}
                              onChange={(e) =>
                                updateCosteMoneda(item.id, e.target.value)
                              }
                              placeholder="—"
                              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-slate-700">
                            {unitMoneda != null && unitMoneda > 0
                              ? `${monedaInfo.simbolo}${(unitMoneda * item.cantidad).toFixed(2)}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={item.lote_producto ?? ""}
                              onChange={(e) => updateLote(item.id, e.target.value)}
                              placeholder="L-2026-01"
                              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs text-center font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right"
                      >
                        Total FOB
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-800">
                        {monedaInfo.simbolo}{totalMoneda.toFixed(2)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          {/*
           * Abre la Proforma Invoice en una nueva pestaña (HTML imprimible).
           * El endpoint GET /api/orders/[id]/proforma genera el HTML con todos los
           * datos de la orden: productos, cantidades, precios, términos de pago, etc.
           * El usuario puede imprimir o guardar como PDF desde el navegador.
           */}
          <button
            type="button"
            onClick={() => {
              const url = `/api/orders/${orden.id}/proforma`;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100 transition"
          >
            <FileText className="h-4 w-4" />
            Generar Proforma Invoice
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition"
            >
              <CheckCircle className="h-4 w-4" />
              {saving ? "Confirmando…" : "Confirmar orden"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
