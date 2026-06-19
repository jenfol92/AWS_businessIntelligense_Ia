// modules/products/services/createProduct.ts

import type { ProductFormValues } from "../types";
import {
  hasProductFormErrors,
  validateProductForm,
} from "../schemas/productSchema";

import {
  mapProductFormToCorePayload,
  mapProductFormToDetailPayload,
  mapProductFormToFinancePayload,
  mapProductFormToTechnicalSheetPayload,
} from "../mappers/productFormMapper";

import { insertProductCore } from "../repositories/productCoreRepository";
import { upsertProductDetail } from "../repositories/productDetailRepository";
import { upsertProductLogistics } from "../repositories/productLogisticsRepository";
import { upsertProductFinance } from "../repositories/productFinanceRepository";
import { upsertProductTechnicalSheet } from "../repositories/productTechnicalSheetRepository";
import { saveProductAmazonSetup } from "./saveProductAmazonSetup";
import { saveProductManualCost } from "./saveProductCosts";
import { resolveProductLogisticsPayloadForSave } from "./resolveProductLogisticsPayloadForSave";

/**
 * Caso de uso: crear producto completo.
 *
 * Inserta primero en productos y, con el id creado,
 * completa el resto de tablas relacionadas.
 */
export async function createProduct(values: ProductFormValues) {
  const errors = validateProductForm(values);

  if (hasProductFormErrors(errors)) {
    return {
      ok: false as const,
      errors,
    };
  }

  const corePayload = mapProductFormToCorePayload(values, null);
  const createdProduct = await insertProductCore(corePayload);

  const productId = createdProduct.id as string;
  const logisticsPayload = await resolveProductLogisticsPayloadForSave(values);

  await Promise.all([
    upsertProductDetail(productId, mapProductFormToDetailPayload(values)),
    upsertProductLogistics(productId, logisticsPayload),
    ...(values.heredarPrecio && values.parentId.trim()
      ? []
      : [
          upsertProductFinance(
            productId,
            mapProductFormToFinancePayload(values),
          ),
        ]),
    upsertProductTechnicalSheet(
      productId,
      mapProductFormToTechnicalSheetPayload(values)
    ),
  ]);

  await saveProductManualCost(productId, values);

  try {
    await saveProductAmazonSetup(productId, values.amazonSetup);
  } catch {
    // Persistencia Amazon opcional hasta migrar tablas / políticas Supabase.
  }

  return {
    ok: true as const,
    product: createdProduct,
  };
}