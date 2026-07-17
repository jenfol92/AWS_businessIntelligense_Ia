/**
 * Orquesta la confirmacion de una orden de compra.
 * La RPC transaccional definitiva se prepara en SQL; mientras no este aplicada,
 * este servicio valida la cobertura completa antes de escribir.
 */

import {
  fetchOrderItemsForConfirmation,
  updateOrderItemCostsForConfirmation,
  confirmOrderHeader,
  fetchOrderHeaderForConfirmation,
  type ConfirmedOrderItemCostRow,
} from "@/modules/orders/repositories/orderConfirmRepository";
import type {
  ConfirmOrderInput,
  OrdenCompraRow,
} from "@/modules/orders/types/orderPersistence.types";
import { upsertConfirmedOrderCostSnapshots } from "@/modules/orders/repositories/orderConfirmedCostSnapshotRepository";
import { upsertCurrentFactoryCostByCurrency } from "@/modules/products/repositories/productCostsRepository";
import {
  buildCompleteOrderItemCostPatches,
  normalizeOrderCostCurrency,
} from "./confirmOrderValidation";

export type ConfirmOrderServiceResult = {
  orden: OrdenCompraRow;
  warnings: string[];
};

const DEFAULT_DEPOSITO_PORCENTAJE = 30;
const DEFAULT_BALANCE_DIAS_ANTES_ETA = 10;
const DEFAULT_BALANCE_CONDICIONES_TEXTO =
  "The balance will be paid 10 days before the vessel arrives at the port";

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
      warnings.push(
        "La orden ya estaba confirmada, pero no se pudo completar el snapshot de costes.",
      );
    }
    return { orden: existingOrder, warnings };
  }

  if (existingOrder.estado !== "borrador") {
    throw new Error(
      `No se puede confirmar una orden en estado ${existingOrder.estado}.`,
    );
  }

  const orderCurrency = normalizeOrderCostCurrency(
    input.moneda_compra ?? existingOrder.moneda_compra,
  );
  const confirmationDate = new Date().toISOString().slice(0, 10);

  const orderItems = await fetchOrderItemsForConfirmation(orderId);
  const patches = buildCompleteOrderItemCostPatches(
    orderItems,
    input.items_costes,
  );

  const updatedCostRows = await updateOrderItemCostsForConfirmation(
    orderId,
    patches,
  );
  await persistCurrentFactoryCostsFromOrderItems(
    updatedCostRows,
    orderCurrency,
    confirmationDate,
  );

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
    deposito_porcentaje:
      input.deposito_porcentaje ?? DEFAULT_DEPOSITO_PORCENTAJE,
    balance_dias_antes_eta:
      input.balance_dias_antes_eta ?? DEFAULT_BALANCE_DIAS_ANTES_ETA,
    balance_condiciones_texto:
      input.balance_condiciones_texto ?? DEFAULT_BALANCE_CONDICIONES_TEXTO,
  };

  const confirmedOrder = await confirmOrderHeader(orderId, payload);
  const warnings: string[] = [];
  try {
    await upsertConfirmedOrderCostSnapshots(confirmedOrder);
  } catch (snapshotError) {
    console.error("upsertConfirmedOrderCostSnapshots:", snapshotError);
    warnings.push(
      "La orden se confirmo, pero no se pudo completar el snapshot de costes.",
    );
  }

  return { orden: confirmedOrder, warnings };
}
