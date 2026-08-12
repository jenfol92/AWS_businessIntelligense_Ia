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
import { findActiveProductVariants } from "../repositories/productVariantsRepository";
import { resolveProductVariantInheritance } from "./resolveProductVariantInheritance";

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

  const parentId = producto?.parent_id ? String(producto.parent_id) : "";
  const parentRows = parentId
    ? await Promise.all([
        findProductCoreById(parentId),
        findProductDetailByProductId(parentId),
        findProductLogisticsByProductId(parentId),
        findProductTechnicalSheetByProductId(parentId),
      ])
    : null;
  const resolved = resolveProductVariantInheritance({
    productId,
    child: {
      core: producto as Record<string, unknown> | null,
      detail: detalle as Record<string, unknown> | null,
      logistics: logistica as Record<string, unknown> | null,
      technicalSheet: fichaTecnica as Record<string, unknown> | null,
    },
    parent: parentRows
      ? {
          core: parentRows[0] as Record<string, unknown> | null,
          detail: parentRows[1] as Record<string, unknown> | null,
          logistics: parentRows[2] as Record<string, unknown> | null,
          technicalSheet: parentRows[3] as Record<string, unknown> | null,
        }
      : null,
  });

  let product = mapProductFormDataToValues({
    producto: resolved.core,
    detalle: resolved.detail,
    logistica: resolved.logistics,
    finanzas,
    fichaTecnica: resolved.technicalSheet,
    costo,
    costosVigentes,
    costoActual,
  });
  product = { ...product, inheritanceOverrides: resolved.overrides };

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
      : (await findActiveProductVariants(productId)).length,
  };
}
