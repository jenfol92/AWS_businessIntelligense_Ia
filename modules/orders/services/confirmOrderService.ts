/**
 * Módulo      : orders
 * Archivo     : services/confirmOrderService.ts
 * Responsabilidad: orquestación de la confirmación de una orden de compra:
 *   1. Normaliza los patches de costes de línea (empty string → null).
 *   2. Aplica los costes a las líneas vía repository.
 *   3. Construye el payload de cabecera con defaults de pago.
 *   4. Confirma la cabecera (borrador → confirmado) vía repository.
 *   5. Devuelve la cabecera confirmada.
 * No debe     : usar createSupabaseRouteClient ni supabase.from directamente.
 *               Gestionar autenticación ni construir respuestas HTTP.
 *               Llamar a syncSupplierPaymentsForOrder (responsabilidad de la ruta API).
 *
 * ADVERTENCIA DE TRANSACCIONALIDAD:
 *   La actualización de líneas y la confirmación de cabecera se ejecutan en dos
 *   operaciones Supabase independientes. No existe transacción real (BEGIN/COMMIT).
 *   Si la confirmación de cabecera falla tras actualizar líneas, las líneas quedan
 *   con los nuevos costes pero el estado de la orden permanece en "borrador".
 *   El comportamiento es idéntico al código original.
 *   Pendiente para FASE B: migrar a una RPC transaccional en Postgres.
 */

import {
  updateOrderItemCostsForConfirmation,
  confirmOrderHeader,
  fetchOrderHeaderForConfirmation,
  type ConfirmedOrderItemCostRow,
  type NormalizedItemCostPatch,
} from "@/modules/orders/repositories/orderConfirmRepository";
import type {
  ConfirmOrderInput,
  OrdenCompraRow,
} from "@/modules/orders/types/orderPersistence.types";
import { upsertConfirmedOrderCostSnapshots } from "@/modules/orders/repositories/orderConfirmedCostSnapshotRepository";
import { upsertCurrentFactoryCostByCurrency } from "@/modules/products/repositories/productCostsRepository";

export type ConfirmOrderServiceResult = {
  orden: OrdenCompraRow;
  warnings: string[];
};

// Defaults de pago documentados explícitamente para facilitar su búsqueda y cambio futuro.
const DEFAULT_DEPOSITO_PORCENTAJE = 30;
const DEFAULT_BALANCE_DIAS_ANTES_ETA = 10;
const DEFAULT_BALANCE_CONDICIONES_TEXTO =
  "The balance will be paid 10 days before the vessel arrives at the port";

function normalizeOrderCurrency(value: string | null | undefined): string {
  return (value ?? "USD").trim().toUpperCase() || "USD";
}

async function persistCurrentFactoryCostsFromOrderItems(
  items: ConfirmedOrderItemCostRow[],
  currency: string,
  fecha: string,
) {
  for (const item of items) {
    const amount =
      item.coste_unitario_moneda != null &&
      Number.isFinite(Number(item.coste_unitario_moneda))
        ? Number(item.coste_unitario_moneda)
        : null;
    if (!item.producto_id || amount == null || amount <= 0) {
      throw new Error(
        `La linea ${item.id} no tiene producto o coste unitario valido para actualizar producto_costos.`,
      );
    }
    await upsertCurrentFactoryCostByCurrency({
      productId: item.producto_id,
      currency,
      amount,
      fecha,
    });
  }
}

/**
 * Confirma una orden de compra: actualiza los costes por línea, cambia el estado
 * a "confirmado" y registra todos los parámetros logísticos y de pago.
 *
 * Solo actúa sobre órdenes en estado "borrador". Si la orden ya estaba confirmada,
 * el UPDATE con filtro estado=borrador devuelve 0 filas → se lanza error de negocio.
 *
 * @param orderId - UUID de la orden a confirmar.
 * @param input   - Datos de confirmación (lead times, ETA, costes, payment terms).
 * @returns La cabecera de la orden ya confirmada.
 * @throws Error de negocio si la orden no existe o no está en borrador.
 */
export async function confirmOrderService(
  orderId: string,
  input: ConfirmOrderInput,
): Promise<ConfirmOrderServiceResult> {
  const existingOrder = await fetchOrderHeaderForConfirmation(orderId);
  if (!existingOrder) {
    throw new Error("Orden no encontrada.");
  }

  if (existingOrder.estado === "confirmado") {
    const warnings: string[] = [];
    try {
      await upsertConfirmedOrderCostSnapshots(existingOrder);
    } catch (snapshotError) {
      console.error("upsertConfirmedOrderCostSnapshots:", snapshotError);
      warnings.push("La orden ya estaba confirmada, pero no se pudo completar el snapshot de costes.");
    }
    return { orden: existingOrder, warnings };
  }

  if (existingOrder.estado !== "borrador") {
    throw new Error(`No se puede confirmar una orden en estado ${existingOrder.estado}.`);
  }

  const orderCurrency = normalizeOrderCurrency(
    input.moneda_compra ?? existingOrder.moneda_compra,
  );
  const confirmationDate = new Date().toISOString().slice(0, 10);
  let updatedCostRows: ConfirmedOrderItemCostRow[] = [];

  // ── 1. Normalizar patches de costes de línea ─────────────────────────────
  // Convierte "" → null en lote_producto (regla de negocio de datos de entrada).
  if (input.items_costes && input.items_costes.length > 0) {
    const patches: NormalizedItemCostPatch[] = input.items_costes.map((ic) => {
      const patch: NormalizedItemCostPatch = {
        item_id: ic.item_id,
        coste_unitario_moneda: ic.coste_unitario_moneda ?? null,
        coste_unitario_usd: ic.coste_unitario_usd ?? null,
        coste_unitario_eur: ic.coste_unitario_eur ?? null,
      };
      if (ic.lote_producto !== undefined) {
        patch.lote_producto = ic.lote_producto === "" ? null : ic.lote_producto;
      }
      return patch;
    });

    // ── 2. Actualizar costes de líneas vía repository ───────────────────────
    updatedCostRows = await updateOrderItemCostsForConfirmation(orderId, patches);
    await persistCurrentFactoryCostsFromOrderItems(
      updatedCostRows,
      orderCurrency,
      confirmationDate,
    );
  }

  // ── 3. Construir payload de cabecera con defaults ────────────────────────
  // Los defaults garantizan que la orden siempre tenga valores de pago válidos.
  const payload = {
    estado: "confirmado" as const,
    fecha_confirmacion: confirmationDate,
    eta: input.eta,
    etd: input.etd ?? null,
    eta_real: input.eta_real ?? null,
    lead_time_produccion: input.lead_time_produccion ?? null,
    lead_time_transito: input.lead_time_transito ?? null,
    numero_pedido_agente: input.numero_pedido_agente ?? null,
    agente_id: input.agente_id ?? null,
    moneda_compra: orderCurrency,
    tipo_cambio_moneda_eur: input.tipo_cambio_moneda_eur ?? null,
    tipo_cambio_usd_eur: input.tipo_cambio_usd_eur ?? null,
    deposito_porcentaje: input.deposito_porcentaje ?? DEFAULT_DEPOSITO_PORCENTAJE,
    balance_dias_antes_eta: input.balance_dias_antes_eta ?? DEFAULT_BALANCE_DIAS_ANTES_ETA,
    balance_condiciones_texto:
      input.balance_condiciones_texto ?? DEFAULT_BALANCE_CONDICIONES_TEXTO,
  };

  // ── 4. Confirmar cabecera vía repository ─────────────────────────────────
  // (ver advertencia de transaccionalidad en el encabezado del archivo)
  const confirmedOrder = await confirmOrderHeader(orderId, payload);
  const warnings: string[] = [];
  try {
    await upsertConfirmedOrderCostSnapshots(confirmedOrder);
  } catch (snapshotError) {
    console.error("upsertConfirmedOrderCostSnapshots:", snapshotError);
    warnings.push("La orden se confirmó, pero no se pudo completar el snapshot de costes.");
  }
  return { orden: confirmedOrder, warnings };
}
