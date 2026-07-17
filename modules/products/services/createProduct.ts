// modules/products/services/createProduct.ts

import type { ProductFormValues } from "../types";
import {
  hasProductFormErrors,
  validateProductForm,
} from "../schemas/productSchema";

import { insertProductCore } from "../repositories/productCoreRepository";
import { findProductCoreById } from "../repositories/productCoreRepository";
import { upsertProductDetail } from "../repositories/productDetailRepository";
import { findProductDetailByProductId } from "../repositories/productDetailRepository";
import { upsertProductLogistics } from "../repositories/productLogisticsRepository";
import { findProductLogisticsByProductId } from "../repositories/productLogisticsRepository";
import { upsertProductFinance } from "../repositories/productFinanceRepository";
import { upsertProductTechnicalSheet } from "../repositories/productTechnicalSheetRepository";
import { findProductTechnicalSheetByProductId } from "../repositories/productTechnicalSheetRepository";
import { findCurrentFactoryCostsByProduct } from "../repositories/productCostsRepository";
import { rollbackCreatedProduct } from "../repositories/productCreateRollbackRepository";
import { saveProductAmazonSetup } from "./saveProductAmazonSetup";
import { saveInitialProductManualCosts } from "./saveProductCosts";
import { buildProductCreatePayloads } from "./buildProductCreatePayloads";

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

  const parentId = values.parentId.trim();
  const parentRows = parentId
    ? await Promise.all([
        findProductCoreById(parentId),
        findProductDetailByProductId(parentId),
        findProductLogisticsByProductId(parentId),
        findProductTechnicalSheetByProductId(parentId),
        findCurrentFactoryCostsByProduct(parentId),
      ])
    : null;

  const {
    corePayload,
    detailPayload,
    logisticsPayload,
    financePayload,
    technicalSheetPayload,
  } = await buildProductCreatePayloads(
    values,
    parentRows
      ? {
          core: parentRows[0] as Record<string, unknown> | null,
          detail: parentRows[1] as Record<string, unknown> | null,
          logistics: parentRows[2] as Record<string, unknown> | null,
          technicalSheet: parentRows[3] as Record<string, unknown> | null,
        }
      : undefined,
  );

  const createdProduct = await insertProductCore(corePayload);

  const productId = createdProduct.id as string;

  try {
    await upsertProductDetail(productId, detailPayload);
    await upsertProductLogistics(productId, logisticsPayload);
    if (financePayload) {
      await upsertProductFinance(productId, financePayload);
    }
    await upsertProductTechnicalSheet(productId, technicalSheetPayload);
    await saveInitialProductManualCosts(
      productId,
      values,
      parentRows ? parentRows[4] : null,
    );
  } catch (error) {
    try {
      await rollbackCreatedProduct(productId);
    } catch (rollbackError) {
      const message =
        error instanceof Error ? error.message : "Error creando producto";
      const rollbackMessage =
        rollbackError instanceof Error
          ? rollbackError.message
          : "rollback incompleto";
      throw new Error(
        `No se pudo crear el producto completo: ${message}. ${rollbackMessage}`,
      );
    }
    throw error;
  }

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
