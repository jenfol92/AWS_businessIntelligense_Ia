/**
 * Persiste coste manual de fabrica en `producto_costos`.
 * No escribe precios, landed costs ni costes logisticos de contenedor.
 */

import type { ProductFormValues } from "../types";
import { mapProductFormToManualCostPayload } from "../mappers/productFormMapper";
import { upsertManualProductCost } from "../repositories/productCostsRepository";
import { findActiveProductVariants } from "../repositories/productVariantsRepository";

type ProductCostRow = Record<string, unknown> | null;

type CostSource = {
  monto: number;
  moneda: ProductFormValues["costoFabricaMoneda"];
  proveedorId: string | null;
  arancelPorcentaje: number;
};

export type ProductCostPropagationResult = {
  parentProductId: string;
  updated: string[];
  omitted: Array<{ productId: string; reason: string }>;
  errors: Array<{ productId: string; error: string }>;
};

function str(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function currency(
  value: unknown,
  fallback: ProductFormValues["costoFabricaMoneda"] = "USD",
): ProductFormValues["costoFabricaMoneda"] {
  const upper = str(value).toUpperCase();
  if (upper === "USD" || upper === "EUR" || upper === "GBP" || upper === "CNY") {
    return upper;
  }
  return fallback;
}

export function readCostSourceFromRow(row: ProductCostRow): CostSource | null {
  const monto = num(row?.costo_fabrica_monto);
  if (monto <= 0) return null;
  return {
    monto,
    moneda: currency(row?.costo_fabrica_moneda),
    proveedorId: str(row?.proveedor_id) || null,
    arancelPorcentaje: num(row?.arancel_porcentaje),
  };
}

export function readCostSourceFromValues(
  values: ProductFormValues,
): CostSource | null {
  if (!Number.isFinite(values.costoFabricaMonto) || values.costoFabricaMonto <= 0) {
    return null;
  }
  return {
    monto: values.costoFabricaMonto,
    moneda: values.costoFabricaMoneda,
    proveedorId: values.proveedorId.trim() || null,
    arancelPorcentaje: values.arancelPorcentaje,
  };
}

export function buildFactoryCostPayload(
  productId: string,
  source: CostSource,
): Record<string, unknown> {
  return {
    producto_id: productId,
    proveedor_id: source.proveedorId,
    costo_fabrica_monto: source.monto,
    costo_fabrica_moneda: source.moneda,
    costo_fabrica_eur: null,
    tipo_cambio_aplicado: null,
    arancel_porcentaje: source.arancelPorcentaje,
  };
}

function variantHasExplicitDifferentCost(
  values: ProductFormValues,
  parentSource: CostSource | null,
): boolean {
  if (!parentSource) return values.costoFabricaMonto > 0;
  if (!Number.isFinite(values.costoFabricaMonto) || values.costoFabricaMonto <= 0) {
    return false;
  }
  return (
    values.costoFabricaMonto !== parentSource.monto ||
    values.costoFabricaMoneda !== parentSource.moneda
  );
}

export async function saveProductManualCost(
  productId: string,
  values: ProductFormValues,
) {
  if (values.parentId.trim() && values.heredarCosteUnitarioTotal) return;

  const payload = mapProductFormToManualCostPayload(values, productId);
  if (!payload) return;

  await upsertManualProductCost(productId, payload);
}

export async function saveInitialProductManualCost(
  productId: string,
  values: ProductFormValues,
  parentCost: ProductCostRow,
) {
  const parentSource = readCostSourceFromRow(parentCost);
  if (
    values.parentId.trim() &&
    parentSource &&
    !variantHasExplicitDifferentCost(values, parentSource)
  ) {
    await upsertManualProductCost(
      productId,
      buildFactoryCostPayload(productId, parentSource),
    );
    return;
  }

  await saveProductManualCost(productId, values);
}

export async function propagateFactoryCostToVariants(
  parentProductId: string,
  values: ProductFormValues,
): Promise<ProductCostPropagationResult> {
  const source = readCostSourceFromValues(values);
  const result: ProductCostPropagationResult = {
    parentProductId,
    updated: [],
    omitted: [],
    errors: [],
  };

  if (!source) {
    result.omitted.push({
      productId: parentProductId,
      reason: "El producto padre no tiene coste de fabrica positivo.",
    });
    return result;
  }

  const variants = await findActiveProductVariants(parentProductId);
  for (const variant of variants) {
    const variantId = String(variant.id ?? "");
    if (!variantId) continue;

    try {
      await upsertManualProductCost(
        variantId,
        buildFactoryCostPayload(variantId, source),
      );
      result.updated.push(variantId);
    } catch (error) {
      result.errors.push({
        productId: variantId,
        error:
          error instanceof Error
            ? error.message
            : "No se pudo actualizar el coste de la variante.",
      });
    }
  }

  return result;
}
