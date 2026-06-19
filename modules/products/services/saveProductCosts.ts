/**
 * Persiste coste manual de fábrica en `producto_costos`.
 * No escribe costes de contenedor (tránsito, flete, etc.).
 */

import type { ProductFormValues } from "../types";
import { mapProductFormToManualCostPayload } from "../mappers/productFormMapper";
import { upsertManualProductCost } from "../repositories/productCostsRepository";

export async function saveProductManualCost(
  productId: string,
  values: ProductFormValues,
) {
  const payload = mapProductFormToManualCostPayload(values, productId);
  if (!payload) return;

  await upsertManualProductCost(productId, payload);
}
