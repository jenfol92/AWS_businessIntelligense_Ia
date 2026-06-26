// modules/products/services/getProductForm.ts

import { findProductCoreById } from "../repositories/productCoreRepository";
import { findProductDetailByProductId } from "../repositories/productDetailRepository";
import { findProductLogisticsByProductId } from "../repositories/productLogisticsRepository";
import { findProductFinanceByProductId } from "../repositories/productFinanceRepository";
import { findProductTechnicalSheetByProductId } from "../repositories/productTechnicalSheetRepository";
import {
  findCurrentProductCost,
  findLatestProductCost,
  getProductBaseCostByProductIds,
} from "../repositories/productCostsRepository";

import {
  mapProductCostFieldsFromDb,
  mapProductFormDataToValues,
} from "../mappers/productFormDataMapper";
import type { ProductFormValues } from "../types";
import { getProductAmazonSetup } from "./getProductAmazonSetup";
import { applyPrimaryAmazonDraftToFlatFields } from "../mappers/amazonSetupMapper";

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
    costoActual,
  ] = await Promise.all([
    findProductCoreById(productId),
    findProductDetailByProductId(productId),
    findProductLogisticsByProductId(productId),
    findProductFinanceByProductId(productId),
    findProductTechnicalSheetByProductId(productId),
    findLatestProductCost(productId),
    findCurrentProductCost(productId),
  ]);

  let product = mapProductFormDataToValues({
    producto,
    detalle,
    logistica,
    finanzas,
    fichaTecnica,
    costo,
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

  if (product.parentId.trim() && product.heredarCosteUnitarioTotal) {
    const [parentCore, parentCost, parentCurrentCost] = await Promise.all([
      findProductCoreById(product.parentId),
      findLatestProductCost(product.parentId),
      findCurrentProductCost(product.parentId),
    ]);
    product = {
      ...product,
      ...mapProductCostFieldsFromDb(
        parentCore as Record<string, unknown> | null,
        parentCost as Record<string, unknown> | null,
        parentCurrentCost as Record<string, unknown> | null,
      ),
      costeBaseEfectivoMonto: effective?.monto ?? null,
      costeBaseEfectivoMoneda:
        (effective?.moneda as ProductFormValues["costeBaseEfectivoMoneda"]) ?? null,
      costeBaseSource: effective?.source ?? "none",
    };
  }

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
  };
}
