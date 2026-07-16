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

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle, X, FileText } from "lucide-react";

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

/** Ítem enriquecido con nombre/SKU de producto para la tabla de costes. */
type ItemWithCost = {
  id: string;
  producto_id: string;
  nombre: string;
  sku: string;
  cantidad: number;
  /** Precio unitario en la moneda de compra seleccionada. */
  coste_unitario_moneda: number | null;
  moneda_coste: string;
  lote_producto: string | null;
};

export interface ConfirmOrderModalProps {
  /** Orden a confirmar. */
  orden: OrdenConfirmRow;
  /** Callback al cerrar sin confirmar. */
  onClose: () => void;
  /** Callback al confirmar con éxito (refresca el listado). */
  onConfirmed: () => void;
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
          const tcOrden =
            ordenData.tipo_cambio_moneda_eur ?? ordenData.tipo_cambio_usd_eur;
          setAgenteId(
            (ordenData.agente_id as string | null | undefined) ??
              orden.agente_id ??
              "",
          );
          if (ordenData.numero_pedido_agente) {
            setNumeroPedidoAgente(String(ordenData.numero_pedido_agente));
          }
          if (monedaOrden === "EUR") {
            setCambio(1);
          } else if (tcOrden != null) {
            setCambio(Number(tcOrden));
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
          const initialEtd = savedEtd || (fechaBase ? addDaysToIsoDate(fechaBase, prod) : "");
          const initialEta = savedEta || (initialEtd ? addDaysToIsoDate(initialEtd, trans) : "");
          setEtd(initialEtd);
          setEta(initialEta);
          setEtaTouched(Boolean(savedEta));
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
                moneda_coste: monedaOrden,
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
  /** 1 unidad de moneda = X EUR */
  const [cambio,  setCambio]  = useState<number | "">(0.92);
  const [etd,     setEtd]     = useState("");
  const [eta,     setEta]     = useState("");
  const [etaTouched, setEtaTouched] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Condiciones de pago (editables)
  const [depositoPct,          setDepositoPct]          = useState(30);
  const [balanceDiasAntesEta,  setBalanceDiasAntesEta]  = useState(10);
  const [balanceCondiciones,   setBalanceCondiciones]   = useState(
    "The balance will be paid 10 days before the vessel arrives at the port",
  );

  const suggestedEta = useMemo(() => {
    if (!etd) return "";
    return addDaysToIsoDate(etd, Math.max(0, diasTransito));
  }, [etd, diasTransito]);

  useEffect(() => {
    if (!etaTouched && eta === "" && suggestedEta) {
      setEta(suggestedEta);
    }
  }, [eta, etaTouched, suggestedEta]);

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
  const tipoCambio = cambio === "" ? null : Number(cambio);

  /** Convierte precio en moneda de compra a EUR. */
  function toEur(unitMoneda: number | null): number | null {
    if (unitMoneda == null) return null;
    if (moneda === "EUR") return unitMoneda;
    if (!tipoCambio) return null;
    return unitMoneda * tipoCambio;
  }

  function toEurForCurrency(unitMoneda: number | null, currency: string): number | null {
    if (unitMoneda == null) return null;
    if (currency === "EUR") return unitMoneda;
    if (currency === moneda && tipoCambio) return unitMoneda * tipoCambio;
    return null;
  }

  const totalMoneda = items.reduce(
    (s, i) => s + (i.coste_unitario_moneda ?? 0) * i.cantidad,
    0,
  );
  const totalEur = items.reduce((s, i) => {
    const eur = toEurForCurrency(i.coste_unitario_moneda, i.moneda_coste);
    return s + (eur ?? 0) * i.cantidad;
  }, 0);

  function handleMonedaChange(nueva: string) {
    setMoneda(nueva);
    if (nueva === "EUR") setCambio(1);
    else if (cambio === 1 || cambio === "") {
      const defaults: Record<string, number> = { USD: 0.92, GBP: 1.17, CNY: 0.13 };
      setCambio(defaults[nueva] ?? "");
    }
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

  function updateItemMoneda(id: string, value: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, moneda_coste: value.toUpperCase() } : item,
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
      const tc = moneda === "EUR" ? 1 : tipoCambio;
      const r = await fetch(`/api/orders/${orden.id}/confirm`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eta:                       eta || suggestedEta,
          etd:                       etd || null,
          lead_time_produccion:      diasProduccion,
          lead_time_transito:        diasTransito,
          numero_pedido_agente:      numeroPedidoAgente || null,
          agente_id:                 agenteId || null,
          moneda_compra:             moneda,
          tipo_cambio_moneda_eur:    tc,
          tipo_cambio_usd_eur:       moneda === "USD" ? tc : null,
          deposito_porcentaje:       depositoPct,
          balance_dias_antes_eta:    balanceDiasAntesEta,
          balance_condiciones_texto: balanceCondiciones,
          items_costes: items.map((i) => {
            const unitMoneda = i.coste_unitario_moneda;
            const unitEur = toEurForCurrency(unitMoneda, i.moneda_coste);
            return {
              item_id:               i.id,
              coste_unitario_moneda: unitMoneda,
              coste_unitario_eur:    unitEur,
              coste_unitario_usd:    i.moneda_coste === "USD" ? unitMoneda : null,
              moneda_coste:          i.moneda_coste,
              lote_producto:         i.lote_producto,
            };
          }),
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error ?? "Error confirmando la orden");
      onConfirmed();
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
                    setEtaTouched(true);
                    setEta(e.target.value);
                  }}
                  className="w-full border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
                {!etaTouched && suggestedEta ? (
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
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  1 {moneda} = EUR
                </label>
                <input
                  type="number"
                  step="0.0001"
                  min={0}
                  value={cambio}
                  disabled={moneda === "EUR"}
                  onChange={(e) =>
                    setCambio(e.target.value === "" ? "" : Number(e.target.value))
                  }
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                />
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
                  onChange={(e) => setEtd(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* ── Sección: Condiciones de pago ── */}
          <section>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Condiciones de pago
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                Moneda: {moneda} · Cambio: {cambio === "" ? "—" : cambio}
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
                      <th className="px-3 py-2.5 text-center w-24">Moneda</th>
                      <th className="px-3 py-2.5 text-center w-32">
                        Precio unitario
                      </th>
                      <th className="px-3 py-2.5 text-right w-28">Total {moneda}</th>
                      {moneda !== "EUR" && (
                        <th className="px-3 py-2.5 text-right w-28">Total EUR</th>
                      )}
                      <th className="px-3 py-2.5 text-center w-32">Lote</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => {
                      const unitMoneda = item.coste_unitario_moneda;
                      const eurUnit = toEurForCurrency(unitMoneda, item.moneda_coste);
                      const itemCurrency = MONEDAS.find((m) => m.code === item.moneda_coste) ?? monedaInfo;
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
                            <select
                              value={item.moneda_coste}
                              onChange={(e) => updateItemMoneda(item.id, e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              {MONEDAS.map((m) => (
                                <option key={m.code} value={m.code}>{m.code}</option>
                              ))}
                            </select>
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
                              ? `${itemCurrency.simbolo}${(unitMoneda * item.cantidad).toFixed(2)}`
                              : "—"}
                          </td>
                          {moneda !== "EUR" && (
                            <td className="px-3 py-2 text-right font-semibold text-blue-700">
                              {eurUnit != null
                                ? `€${(eurUnit * item.cantidad).toFixed(2)}`
                                : "—"}
                            </td>
                          )}
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
                        colSpan={4}
                        className="px-3 py-2.5 text-xs font-semibold text-slate-500 text-right"
                      >
                        Total FOB
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-800">
                        {monedaInfo.simbolo}{totalMoneda.toFixed(2)}
                      </td>
                      {moneda !== "EUR" && (
                        <td className="px-3 py-2.5 text-right font-bold text-blue-700">
                          €{totalEur.toFixed(2)}
                        </td>
                      )}
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
              const params = new URLSearchParams({ moneda });
              if (cambio !== "") params.set("cambio", String(cambio));
              const url = `/api/orders/${orden.id}/proforma?${params.toString()}`;
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
