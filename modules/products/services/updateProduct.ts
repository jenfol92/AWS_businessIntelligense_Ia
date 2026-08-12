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
  mapProductFormToLogisticsPayload,
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
import { PRODUCT_FORM_ESPECIFICACIONES_KEY } from "../constants";

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

  const corePayload = mapProductFormToCorePayload(values, existing?.especificaciones ?? null);
  const detailPayload = mapProductFormToDetailPayload(values);
  const logisticsPayload = mapProductFormToLogisticsPayload(values);
  const technicalPayload = mapProductFormToTechnicalSheetPayload(values);
  if (values.parentId.trim()) {
    const overrides = values.inheritanceOverrides;
    const specs = corePayload.especificaciones as Record<string, unknown>;
    for (const key of Object.keys(specs)) {
      if (key === PRODUCT_FORM_ESPECIFICACIONES_KEY) continue;
      if (!overrides.categorySpecifications[key]) delete specs[key];
    }
    const extension = (specs[PRODUCT_FORM_ESPECIFICACIONES_KEY] ?? {}) as Record<string, unknown>;
    const identifiers = { ...((extension.identifiers ?? {}) as Record<string, unknown>) };
    if (!overrides.fields.referenciaFabricante) delete identifiers.referencia_fabricante;
    extension.identifiers = identifiers;
    specs[PRODUCT_FORM_ESPECIFICACIONES_KEY] = extension;
    if (!overrides.fields.categoriaId) {
      detailPayload.categoria_id = null;
      detailPayload.categoria = null;
    }
    const masks: Array<[string, Record<string, unknown>, string]> = [
      ["unidadesPorCaja", logisticsPayload, "unidades_por_caja"],
      ["pedidoMinimoUnidades", logisticsPayload, "pedido_minimo_unidades"],
      ["pesoBrutoKg", logisticsPayload, "peso_kg_bruto"],
      ["largoCajaCm", logisticsPayload, "largo_cm"],
      ["anchoCajaCm", logisticsPayload, "ancho_cm"],
      ["altoCajaCm", logisticsPayload, "alto_cm"],
      ["materialEstructura", technicalPayload, "material_estructura"],
      ["materialTapizado", technicalPayload, "material_tapizado"],
      ["materialRuedas", technicalPayload, "material_ruedas"],
      ["pesoNetoKg", technicalPayload, "peso_neto_kg"],
      ["altoAbiertoCm", technicalPayload, "alto_abierto_cm"],
      ["anchoAbiertoCm", technicalPayload, "ancho_abierto_cm"],
      ["fondoAbiertoCm", technicalPayload, "fondo_abierto_cm"],
      ["altoPlegadoCm", technicalPayload, "alto_plegado_cm"],
      ["anchoPlegadoCm", technicalPayload, "ancho_plegado_cm"],
      ["fondoPlegadoCm", technicalPayload, "fondo_plegado_cm"],
    ];
    for (const [field, payload, column] of masks) {
      if (!overrides.fields[field as keyof typeof overrides.fields]) payload[column] = null;
    }
  }

  const updatedProduct = await updateProductCoreById(productId, corePayload);

  await Promise.all([
    upsertProductDetail(productId, detailPayload),
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
      technicalPayload
    ),
  ]);

  await saveProductManualCost(productId, values);

  let costPropagation:
    | Awaited<ReturnType<typeof propagateFactoryCostToVariants>>
    | null = null;
  const warnings: string[] = [];
  if (values.applyCostChangeToVariants && !values.parentId.trim()) {
    costPropagation = await propagateFactoryCostToVariants(productId, values);
    if (costPropagation.errors.length > 0) {
      warnings.push(
        `El coste del producto se guardo, pero no se pudo actualizar ${costPropagation.errors.length} de ${costPropagation.totalVariants} variantes.`,
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
    warnings,
    costPropagation,
  };
}
