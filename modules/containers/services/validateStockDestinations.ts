import type {
  ContenedorStockDestinoRow,
  OrdenItemForContainerRow,
} from "../types/containerStock.types";

export type StockDestinationValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateStockDestinations(
  destinos: ContenedorStockDestinoRow[],
  orderItems: OrdenItemForContainerRow[],
): StockDestinationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (destinos.length === 0) {
    return {
      ok: false,
      errors: ["missing_stock_destinations"],
      warnings: [],
    };
  }

  const itemById = new Map(orderItems.map((item) => [item.id, item]));
  const linkedItemIds = new Set(orderItems.map((item) => item.id));

  const sumByOrdenItem = new Map<string, number>();

  for (const destino of destinos) {
    if (!linkedItemIds.has(destino.orden_item_id)) {
      errors.push(
        `Destino ${destino.id} referencia orden_item ${destino.orden_item_id} que no pertenece al contenedor.`,
      );
      continue;
    }

    const item = itemById.get(destino.orden_item_id);
    if (item && destino.producto_id !== item.producto_id) {
      errors.push(
        `Destino ${destino.id}: producto_id no coincide con la línea de pedido.`,
      );
    }

    if (destino.cantidad <= 0) {
      errors.push(`Destino ${destino.id}: cantidad debe ser > 0.`);
    }

    sumByOrdenItem.set(
      destino.orden_item_id,
      (sumByOrdenItem.get(destino.orden_item_id) ?? 0) + destino.cantidad,
    );
  }

  for (const [ordenItemId, totalDestino] of Array.from(sumByOrdenItem.entries())) {
    const item = itemById.get(ordenItemId);
    if (!item) continue;
    if (totalDestino > item.cantidad) {
      errors.push(
        `orden_item ${ordenItemId}: destinos suman ${totalDestino} uds pero la línea tiene ${item.cantidad}.`,
      );
    } else if (totalDestino < item.cantidad) {
      warnings.push(
        `orden_item ${ordenItemId}: destinos cubren ${totalDestino}/${item.cantidad} uds (parcial).`,
      );
    }
  }

  const itemsWithoutDestino = orderItems.filter(
    (item) => !sumByOrdenItem.has(item.id),
  );
  if (itemsWithoutDestino.length > 0) {
    warnings.push(
      `${itemsWithoutDestino.length} línea(s) de pedido sin destino de stock definido.`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}
