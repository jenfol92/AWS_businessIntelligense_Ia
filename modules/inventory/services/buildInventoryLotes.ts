// modules/inventory/services/buildInventoryLotes.ts
//
// Agrupa lotes de producto_costos con resumen de costes.

import { fetchLotesForProduct } from "../repositories/inventoryRepository";
import type { InventoryLotesResponse } from "../types/inventory.types";

export async function buildInventoryLotes(
  productoId: string,
  pais?: string,
): Promise<InventoryLotesResponse> {
  const lotes = await fetchLotesForProduct(productoId, pais);

  const merged = new Map<
    string,
    (typeof lotes)[number] & { unidades: number; costoTotal: number | null }
  >();

  for (const l of lotes) {
    const existing = merged.get(l.lote);
    if (existing) {
      existing.unidades += l.unidades;
      if (l.costoTotal != null) {
        existing.costoTotal = (existing.costoTotal ?? 0) + l.costoTotal;
      }
    } else {
      merged.set(l.lote, { ...l });
    }
  }

  const lotesAgrupados = Array.from(merged.values());
  const totalUnidades = lotesAgrupados.reduce((s, l) => s + l.unidades, 0);
  const costoTotal = lotesAgrupados.reduce(
    (s, l) => s + (l.costoTotal ?? 0),
    0,
  );
  const costoMedio =
    totalUnidades > 0 && costoTotal > 0 ? costoTotal / totalUnidades : null;

  return {
    ok: true,
    lotes: lotesAgrupados,
    resumen: {
      totalUnidades,
      costoTotal,
      costoMedioUnitario: costoMedio,
    },
  };
}
