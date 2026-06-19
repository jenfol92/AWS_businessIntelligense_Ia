import type { ProductFormValues } from "../types";
import { mapProductFormToLogisticsPayload } from "../mappers/productFormMapper";
import { findProductLogisticsByProductId } from "../repositories/productLogisticsRepository";
import { mergeLogisticsPayloadWithParent } from "../utils/mergeLogisticsPayloadWithParent";

/**
 * Payload logístico listo para upsert.
 * Variantes (parent_id): heredan medidas del padre si el hijo no tiene valores propios.
 */
export async function resolveProductLogisticsPayloadForSave(
  values: ProductFormValues,
): Promise<Record<string, unknown>> {
  const payload = mapProductFormToLogisticsPayload(values);
  const parentId = values.parentId?.trim();
  if (!parentId) return payload;

  const parentLogistics = await findProductLogisticsByProductId(parentId);
  if (!parentLogistics) return payload;

  return mergeLogisticsPayloadWithParent(
    payload,
    parentLogistics as Record<string, unknown>,
  );
}
