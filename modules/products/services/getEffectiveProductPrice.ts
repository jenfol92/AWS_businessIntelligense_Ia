// modules/products/services/getEffectiveProductPrice.ts
//
// Orquesta RPC get_effective_price (firma completa y, si falla, solo producto_id) y filas de producto_precios.
// Reutilizable desde ficha, catálogo, variantes, simulaciones, etc.

import type { ProductEffectivePrice } from "../types/product-detail.types";
import {
  effectivePriceFallbackTargetProductId,
  effectivePriceRpcPaisCode,
  resolveCatalogChannelForEffectivePrice,
  resolveEffectivePrice,
  type EffectivePriceRpcAttempt,
} from "../calculations/effectivePrice";
import {
  findEffectivePriceRpc,
  findEffectivePriceRpcProductIdOnly,
  findProductPrices,
} from "../repositories/productPricesRepository";

export type GetEffectiveProductPriceParams = {
  productId: string;
  pais: string;
  canal: string;
  /** YYYY-MM-DD; por defecto hoy UTC (fecha local del servidor). */
  asOfDate?: string;
  parentId: string | null;
  heredarPrecio: boolean | null | undefined;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function rpcAttemptFrom(data: unknown, failed: boolean): EffectivePriceRpcAttempt {
  if (failed) {
    return { value: null, failed: true };
  }
  const n = Number(data);
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, failed: false };
  }
  return { value: n, failed: false };
}

/**
 * Resuelve precio efectivo para un producto (herencia, canal, vigencia, fallbacks).
 */
export async function getEffectiveProductPrice(
  params: GetEffectiveProductPriceParams,
): Promise<ProductEffectivePrice> {
  const asOfDate = params.asOfDate ?? todayIsoDate();
  const channel = resolveCatalogChannelForEffectivePrice(
    params.canal,
    params.pais,
  );
  const paisRpc = effectivePriceRpcPaisCode(params.pais);

  const rpcThreeRes = await findEffectivePriceRpc({
    productoId: params.productId,
    paisCode: paisRpc,
    channel,
  });

  const rpcThree = rpcAttemptFrom(rpcThreeRes.data, rpcThreeRes.error != null);

  let rpcProductIdOnly: EffectivePriceRpcAttempt = {
    value: null,
    failed: true,
  };

  if (rpcThreeRes.error != null) {
    const singleArgRes = await findEffectivePriceRpcProductIdOnly({
      productoId: params.productId,
    });
    rpcProductIdOnly = rpcAttemptFrom(
      singleArgRes.data,
      singleArgRes.error != null,
    );
  } else {
    rpcProductIdOnly = { value: null, failed: true };
  }

  const targetId = effectivePriceFallbackTargetProductId({
    productId: params.productId,
    parentId: params.parentId,
    heredarPrecio: params.heredarPrecio,
  });

  const priceRows = await findProductPrices(targetId);

  return resolveEffectivePrice({
    asOfDate,
    paisQuery: params.pais,
    canalQuery: params.canal,
    productId: params.productId,
    parentId: params.parentId,
    heredarPrecio: params.heredarPrecio,
    rpcThree,
    rpcProductIdOnly,
    priceRows,
    defaultCurrency: "EUR",
  });
}
