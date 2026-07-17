/**
 * Persiste coste manual de fabrica en `producto_costos`.
 * No escribe precios, landed costs ni costes logisticos de contenedor.
 */

import type { ProductFormValues } from "../types";
import { mapProductFormToManualCostPayload } from "../mappers/productFormMapper";
import {
  type CurrentFactoryCostRow,
  upsertCurrentFactoryCostByCurrency,
  upsertManualProductCost,
} from "../repositories/productCostsRepository";
import { findActiveProductVariants } from "../repositories/productVariantsRepository";

type ProductCostRow = Record<string, unknown> | null;

export type CostSource = {
  monto: number;
  moneda: ProductFormValues["costoFabricaMoneda"];
};

export type ProductCostPropagationResult = {
  requested: boolean;
  parentProductId: string;
  totalVariants: number;
  updated: string[];
  skipped: Array<{ productId: string; reason: string }>;
  errors: Array<{ productId: string; error: string }>;
};

type VariantRow = {
  id?: unknown;
};

type UpsertFactoryCost = (
  productId: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;

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
  };
}

export function buildFactoryCostOnlyPayload(
  productId: string,
  source: CostSource,
): Record<string, unknown> {
  return {
    producto_id: productId,
    costo_fabrica_monto: source.monto,
    costo_fabrica_moneda: source.moneda,
  };
}

export async function copyCurrentFactoryCostsToProduct(
  productId: string,
  costs: CurrentFactoryCostRow[],
) {
  for (const cost of costs) {
    const source = readCostSourceFromRow(cost);
    if (!source) continue;
    await upsertCurrentFactoryCostByCurrency({
      productId,
      currency: source.moneda,
      amount: source.monto,
      providerId: cost.proveedor_id ?? null,
      arancelPorcentaje: cost.arancel_porcentaje ?? null,
      fecha: cost.fecha,
    });
  }
}

export async function propagateFactoryCostToVariantRows(
  parentProductId: string,
  source: CostSource | null,
  variants: VariantRow[],
  upsertFactoryCost: UpsertFactoryCost,
): Promise<ProductCostPropagationResult> {
  const result: ProductCostPropagationResult = {
    requested: true,
    parentProductId,
    totalVariants: variants.length,
    updated: [],
    skipped: [],
    errors: [],
  };

  if (!source) {
    result.skipped.push({
      productId: parentProductId,
      reason: "El producto padre no tiene coste de fabrica positivo.",
    });
    return result;
  }

  for (const variant of variants) {
    const variantId = String(variant.id ?? "");
    if (!variantId) {
      result.skipped.push({
        productId: "",
        reason: "Variante sin id.",
      });
      continue;
    }

    try {
      await upsertFactoryCost(
        variantId,
        buildFactoryCostOnlyPayload(variantId, source),
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
      buildFactoryCostOnlyPayload(productId, parentSource),
    );
    return;
  }

  await saveProductManualCost(productId, values);
}

export async function saveInitialProductManualCosts(
  productId: string,
  values: ProductFormValues,
  parentCosts: CurrentFactoryCostRow[] | null,
) {
  if (values.parentId.trim() && parentCosts && parentCosts.length > 0) {
    await copyCurrentFactoryCostsToProduct(productId, parentCosts);
    return;
  }

  await saveProductManualCost(productId, values);
}

export async function propagateFactoryCostToVariants(
  parentProductId: string,
  values: ProductFormValues,
): Promise<ProductCostPropagationResult> {
  const source = readCostSourceFromValues(values);
  const variants = await findActiveProductVariants(parentProductId);
  return propagateFactoryCostToVariantRows(
    parentProductId,
    source,
    variants,
    async (productId, payload) =>
      upsertCurrentFactoryCostByCurrency({
        productId,
        currency: String(payload.costo_fabrica_moneda ?? source?.moneda ?? "USD"),
        amount:
          payload.costo_fabrica_monto == null
            ? null
            : Number(payload.costo_fabrica_monto),
      }),
  );
}
