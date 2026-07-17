import { assertProductCostCurrency } from "../../products/utils/productCostCurrency";

export type OrderItemForConfirmation = {
  id: string;
  orden_id: string;
  producto_id: string | null;
};

export type InputItemCostForConfirmation = {
  item_id: string;
  coste_unitario_moneda?: number | null;
  coste_unitario_usd?: number | null;
  coste_unitario_eur?: number | null;
  lote_producto?: string | null;
};

export type CompleteOrderItemCostPatch = {
  item_id: string;
  producto_id: string;
  coste_unitario_moneda: number;
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  lote_producto?: string | null;
};

function positiveCost(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

export function normalizeOrderCostCurrency(value: unknown): string {
  return assertProductCostCurrency(value);
}

export function buildCompleteOrderItemCostPatches(
  orderItems: OrderItemForConfirmation[],
  inputItems: InputItemCostForConfirmation[] | null | undefined,
): CompleteOrderItemCostPatch[] {
  if (orderItems.length === 0) {
    throw new Error("La orden no tiene lineas para confirmar.");
  }
  if (!inputItems || inputItems.length === 0) {
    throw new Error("No se recibieron costes para confirmar todas las lineas.");
  }

  const itemsById = new Map(orderItems.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const patches: CompleteOrderItemCostPatch[] = [];

  for (const inputItem of inputItems) {
    const itemId = String(inputItem.item_id ?? "").trim();
    if (!itemId) {
      throw new Error("Se recibio una linea sin item_id.");
    }
    if (seen.has(itemId)) {
      throw new Error(`Linea repetida en confirmacion: ${itemId}.`);
    }
    seen.add(itemId);

    const orderItem = itemsById.get(itemId);
    if (!orderItem) {
      throw new Error(`La linea ${itemId} no pertenece a la orden.`);
    }
    if (!orderItem.producto_id) {
      throw new Error(`La linea ${itemId} no tiene producto asociado.`);
    }

    const cost = positiveCost(inputItem.coste_unitario_moneda);
    if (cost == null) {
      throw new Error(`La linea ${itemId} no tiene coste unitario valido.`);
    }

    patches.push({
      item_id: itemId,
      producto_id: orderItem.producto_id,
      coste_unitario_moneda: cost,
      coste_unitario_usd: inputItem.coste_unitario_usd ?? null,
      coste_unitario_eur: inputItem.coste_unitario_eur ?? null,
      ...(inputItem.lote_producto !== undefined
        ? {
            lote_producto:
              inputItem.lote_producto === "" ? null : inputItem.lote_producto,
          }
        : {}),
    });
  }

  if (seen.size !== orderItems.length) {
    const missing = orderItems
      .filter((item) => !seen.has(item.id))
      .map((item) => item.id);
    throw new Error(
      `Faltan costes para ${missing.length} lineas de la orden: ${missing.join(", ")}.`,
    );
  }

  return patches;
}
