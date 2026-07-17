// modules/products/services/updateProduct.ts

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

import {
  findProductCoreById,
  updateProductCoreById,
} from "../repositories/productCoreRepository";
import { upsertProductDetail } from "../repositories/productDetailRepository";
import { upsertProductLogistics } from "../repositories/productLogisticsRepository";
import { upsertProductFinance } from "../repositories/productFinanceRepository";
import { upsertProductTechnicalSheet } from "../repositories/productTechnicalSheetRepository";
import { saveProductAmazonSetup } from "./saveProductAmazonSetup";
import {
  propagateFactoryCostToVariants,
  saveProductManualCost,
} from "./saveProductCosts";
import { resolveProductLogisticsPayloadForSave } from "./resolveProductLogisticsPayloadForSave";

/**
 * Caso de uso: actualizar producto completo.
 *
 * Actualiza productos y hace upsert del resto de tablas hijas.
 */
export async function updateProduct(
  productId: string,
  values: ProductFormValues
) {
  const errors = validateProductForm(values);

  if (hasProductFormErrors(errors)) {
    return {
      ok: false as const,
      errors,
    };
  }

  const existing = await findProductCoreById(productId);

  const updatedProduct = await updateProductCoreById(
    productId,
    mapProductFormToCorePayload(
      values,
      existing?.especificaciones ?? null,
    ),
  );

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

  let costPropagation:
    | Awaited<ReturnType<typeof propagateFactoryCostToVariants>>
    | null = null;
  if (values.applyCostChangeToVariants && !values.parentId.trim()) {
    costPropagation = await propagateFactoryCostToVariants(productId, values);
    if (costPropagation.errors.length > 0) {
      throw new Error(
        `Producto actualizado, pero no se pudo aplicar el coste a ${costPropagation.errors.length} variante(s).`,
      );
    }
  }

  try {
    await saveProductAmazonSetup(productId, values.amazonSetup);
  } catch {
    // Persistencia Amazon opcional hasta migrar tablas / políticas Supabase.
  }

  return {
    ok: true as const,
    product: updatedProduct,
    costPropagation,
  };
}
