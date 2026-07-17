// modules/products/services/getProductForm.ts

import { findProductCoreById } from "../repositories/productCoreRepository";
import { findProductDetailByProductId } from "../repositories/productDetailRepository";
import { findProductLogisticsByProductId } from "../repositories/productLogisticsRepository";
import { findProductFinanceByProductId } from "../repositories/productFinanceRepository";
import { findProductTechnicalSheetByProductId } from "../repositories/productTechnicalSheetRepository";
import {
  findCurrentFactoryCostsByProduct,
  findCurrentProductCost,
  findLatestProductCost,
  getProductBaseCostByProductIds,
} from "../repositories/productCostsRepository";

import { mapProductFormDataToValues } from "../mappers/productFormDataMapper";
import type { ProductFormValues } from "../types";
import { getProductAmazonSetup } from "./getProductAmazonSetup";
import { applyPrimaryAmazonDraftToFlatFields } from "../mappers/amazonSetupMapper";
import { findProductVariants } from "../repositories/productVariantsRepository";

/**
 * Carga todos los datos necesarios para editar un producto.
 */
export async function getProductForm(productId: string) {
  const [
    producto,
    detalle,
    logistica,
    finanzas,
    fichaTecnica,
    costo,
    costosVigentes,
    costoActual,
  ] = await Promise.all([
    findProductCoreById(productId),
    findProductDetailByProductId(productId),
    findProductLogisticsByProductId(productId),
    findProductFinanceByProductId(productId),
    findProductTechnicalSheetByProductId(productId),
    findLatestProductCost(productId),
    findCurrentFactoryCostsByProduct(productId),
    findCurrentProductCost(productId),
  ]);

  let product = mapProductFormDataToValues({
    producto,
    detalle,
    logistica,
    finanzas,
    fichaTecnica,
    costo,
    costosVigentes,
    costoActual,
  });

  const effectiveMap = await getProductBaseCostByProductIds([productId]);
  const effective = effectiveMap.get(productId);
  product = {
    ...product,
    costeBaseEfectivoMonto: effective?.monto ?? null,
    costeBaseEfectivoMoneda:
      (effective?.moneda as ProductFormValues["costeBaseEfectivoMoneda"]) ?? null,
    costeBaseSource: effective?.source ?? "none",
  };

  try {
    const amazon = await getProductAmazonSetup(productId);
    product = applyPrimaryAmazonDraftToFlatFields({
      ...product,
      amazonSetup: amazon.formValues,
    });
  } catch {
    // Tablas Amazon opcionales.
  }

  return {
    ok: true as const,
    product,
    variantCount: product.parentId.trim()
      ? 0
      : (await findProductVariants(productId)).length,
  };
}
