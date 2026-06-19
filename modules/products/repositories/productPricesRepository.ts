// modules/products/repositories/productPricesRepository.ts
//
// Solo acceso a `producto_precios` y RPC `get_effective_price`. Sin reglas de negocio.

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

import type { ProductPriceRow } from "../calculations/effectivePrice";

export type EffectivePriceRpcInvokeResult = {
  data: unknown;
  error: { message: string } | null;
};

function adaptPriceRows(raw: unknown): ProductPriceRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      pais_code:
        r.pais_code == null || r.pais_code === ""
          ? null
          : String(r.pais_code),
      channel:
        r.channel == null || r.channel === ""
          ? null
          : String(r.channel),
      precio: r.precio,
      price_type:
        r.price_type == null ? null : String(r.price_type),
      valid_from:
        r.valid_from == null ? null : String(r.valid_from).slice(0, 10),
      valid_to:
        r.valid_to == null ? null : String(r.valid_to).slice(0, 10),
    };
  });
}

/**
 * RPC `get_effective_price` con firma completa (producto + país + canal).
 */
export async function findEffectivePriceRpc(params: {
  productoId: string;
  paisCode: string | null;
  channel: string;
}): Promise<EffectivePriceRpcInvokeResult> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase.rpc("get_effective_price", {
    p_producto_id: params.productoId,
    p_pais_code: params.paisCode,
    p_channel: params.channel,
  });

  if (error) {
    return { data: null, error: { message: error.message } };
  }

  return { data, error: null };
}

/**
 * RPC `get_effective_price` con un solo argumento (`p_producto_id`), p. ej. despliegues sin país/canal en firma.
 */
export async function findEffectivePriceRpcProductIdOnly(params: {
  productoId: string;
}): Promise<EffectivePriceRpcInvokeResult> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase.rpc("get_effective_price", {
    p_producto_id: params.productoId,
  });

  if (error) {
    return { data: null, error: { message: error.message } };
  }

  return { data, error: null };
}

const PRODUCTO_PRECIOS_SELECT =
  "pais_code, channel, precio, price_type, valid_from, valid_to";

/** Precios registrados para un producto (hijo o padre). */
export async function findProductPrices(
  productoId: string,
): Promise<ProductPriceRow[]> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_precios")
    .select(PRODUCTO_PRECIOS_SELECT)
    .eq("producto_id", productoId);

  if (error) throw new Error(error.message);

  return adaptPriceRows(data);
}

/** Misma consulta que `findProductPrices`, explícita para lecturas del padre. */
export async function findParentProductPrices(
  parentProductoId: string,
): Promise<ProductPriceRow[]> {
  return findProductPrices(parentProductoId);
}
