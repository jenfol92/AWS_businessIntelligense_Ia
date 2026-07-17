import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { ProductBaseCost } from "../utils/resolveEffectiveBaseCost";
import type { ProductCostCurrency } from "../types";
import { assertProductCostCurrency } from "../utils/productCostCurrency";

export type { ProductBaseCost } from "../utils/resolveEffectiveBaseCost";

export type CurrentFactoryCostRow = {
  id?: string;
  producto_id: string;
  proveedor_id: string | null;
  costo_fabrica_monto: number | null;
  costo_fabrica_moneda: string | null;
  costo_fabrica_eur: number | null;
  tipo_cambio_aplicado: number | null;
  arancel_porcentaje: number | null;
  transito_eur_unit: number | null;
  gastos_llegada_puerto_eur_unit: number | null;
  costo_flete_unit_eur: number | null;
  costo_unitario_total_eur: number | null;
  pais_destino: string | null;
  contenedor_id: string | null;
  lote_producto: string | null;
  fecha: string | null;
};

export type UpsertCurrentFactoryCostInput = {
  productId: string;
  currency: ProductCostCurrency | string;
  amount: number | null;
  providerId?: string | null;
  arancelPorcentaje?: number | null;
  fecha?: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function selectCurrentFactoryCostColumns(): string {
  return `
    id,
    producto_id,
    proveedor_id,
    costo_fabrica_monto,
    costo_fabrica_moneda,
    costo_fabrica_eur,
    tipo_cambio_aplicado,
    arancel_porcentaje,
    transito_eur_unit,
    gastos_llegada_puerto_eur_unit,
    costo_flete_unit_eur,
    costo_unitario_total_eur,
    pais_destino,
    contenedor_id,
    lote_producto,
    fecha
  `;
}

// Tabla: producto_costos.
// Aqui van costes historicos/lotes/fabrica/flete/arancel/transito.
export async function findProductCostsByProductId(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_costos")
    .select(`
      id,
      producto_id,
      proveedor_id,
      costo_fabrica_monto,
      costo_fabrica_moneda,
      costo_fabrica_eur,
      tipo_cambio_aplicado,
      arancel_porcentaje,
      transito_eur_unit,
      gastos_llegada_puerto_eur_unit,
      costo_flete_unit_eur,
      costo_unitario_total_eur,
      pais_destino,
      contenedor_id,
      lote_producto,
      fecha
    `)
    .eq("producto_id", productId)
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);

  return data ?? [];
}

// Ultimo coste conocido de un producto.
export async function findLatestProductCost(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_costos")
    .select(selectCurrentFactoryCostColumns())
    .eq("producto_id", productId)
    .is("contenedor_id", null)
    .is("lote_producto", null)
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as unknown as CurrentFactoryCostRow | null;
}

// Vista: v_costo_actual_producto.
export async function findCurrentProductCost(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("v_costo_actual_producto")
    .select("*")
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

// Vista: v_producto_coste_medio.
export async function findProductAverageCost(productId: string) {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("v_producto_coste_medio")
    .select("*")
    .eq("producto_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data;
}

type OwnBaseCostRow = {
  monto: number | null;
  moneda: string | null;
};

async function loadLatestOwnBaseCosts(
  productIds: string[],
): Promise<Map<string, OwnBaseCostRow>> {
  const map = new Map<string, OwnBaseCostRow>();
  if (productIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("producto_costos")
    .select("producto_id, costo_fabrica_monto, costo_fabrica_moneda, fecha")
    .in("producto_id", productIds)
    .is("contenedor_id", null)
    .is("lote_producto", null)
    .order("fecha", { ascending: false });

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const pid = row.producto_id as string;
    if (map.has(pid)) continue;
    const monto = row.costo_fabrica_monto;
    map.set(pid, {
      monto: monto != null && Number(monto) > 0 ? Number(monto) : null,
      moneda: row.costo_fabrica_moneda
        ? assertProductCostCurrency(row.costo_fabrica_moneda)
        : null,
    });
  }

  return map;
}

/**
 * Coste base efectivo por producto_id.
 * Regla canonica: la variante usa su fila propia de producto_costos.
 * No hay fallback vivo al coste del padre.
 */
export async function getProductBaseCostByProductIds(
  productIds: string[],
): Promise<Map<string, ProductBaseCost>> {
  const result = new Map<string, ProductBaseCost>();
  if (productIds.length === 0) return result;

  const uniqueIds = Array.from(new Set(productIds));
  const ownCosts = await loadLatestOwnBaseCosts(uniqueIds);

  for (const pid of uniqueIds) {
    const own = ownCosts.get(pid);
    if (own?.monto != null && own.monto > 0) {
      result.set(pid, {
        monto: own.monto,
        moneda: own.moneda,
        source: "own",
        parentProductId: null,
      });
      continue;
    }

    result.set(pid, {
      monto: null,
      moneda: null,
      source: "none",
      parentProductId: null,
    });
  }

  return result;
}

export async function findCurrentFactoryCostByCurrency(
  productId: string,
  currency: ProductCostCurrency | string,
): Promise<CurrentFactoryCostRow | null> {
  const supabase = createSupabaseRouteClient();
  const normalizedCurrency = assertProductCostCurrency(currency);

  const { data, error } = await supabase
    .from("producto_costos")
    .select(selectCurrentFactoryCostColumns())
    .eq("producto_id", productId)
    .eq("costo_fabrica_moneda", normalizedCurrency)
    .is("contenedor_id", null)
    .is("lote_producto", null)
    .order("fecha", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as unknown as CurrentFactoryCostRow | null) ?? null;
}

export async function findCurrentFactoryCostsByProduct(
  productId: string,
): Promise<CurrentFactoryCostRow[]> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("producto_costos")
    .select(selectCurrentFactoryCostColumns())
    .eq("producto_id", productId)
    .is("contenedor_id", null)
    .is("lote_producto", null)
    .order("costo_fabrica_moneda", { ascending: true })
    .order("fecha", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw new Error(error.message);

  const byCurrency = new Map<string, CurrentFactoryCostRow>();
  for (const row of (data ?? []) as unknown as CurrentFactoryCostRow[]) {
    const key = assertProductCostCurrency(row.costo_fabrica_moneda);
    if (!byCurrency.has(key)) {
      byCurrency.set(key, row);
    }
  }

  return Array.from(byCurrency.values());
}

export async function upsertCurrentFactoryCostByCurrency(
  input: UpsertCurrentFactoryCostInput,
): Promise<CurrentFactoryCostRow> {
  const supabase = createSupabaseRouteClient();
  const currency = assertProductCostCurrency(input.currency);
  const amount =
    input.amount != null && Number.isFinite(Number(input.amount))
      ? Number(input.amount)
      : null;
  const fecha = input.fecha?.slice(0, 10) || todayIsoDate();
  const existing = await findCurrentFactoryCostByCurrency(input.productId, currency);
  const payload: Record<string, unknown> = {
    producto_id: input.productId,
    costo_fabrica_monto: amount != null && amount > 0 ? amount : null,
    costo_fabrica_moneda: currency,
    contenedor_id: null,
    lote_producto: null,
    fecha,
  };

  if (input.providerId !== undefined) {
    payload.proveedor_id = input.providerId || null;
  }
  if (input.arancelPorcentaje !== undefined) {
    payload.arancel_porcentaje =
      input.arancelPorcentaje != null && Number.isFinite(Number(input.arancelPorcentaje))
        ? Number(input.arancelPorcentaje)
        : null;
  }

  const query = existing?.id
    ? supabase
        .from("producto_costos")
        .update(payload)
        .eq("id", existing.id)
        .is("contenedor_id", null)
        .is("lote_producto", null)
    : supabase.from("producto_costos").insert(payload);

  const { data, error } = await query.select(selectCurrentFactoryCostColumns()).single();

  if (error) throw new Error(error.message);
  return data as unknown as CurrentFactoryCostRow;
}

/** Compatibilidad: guarda solo la moneda vigente indicada, sin borrar otras monedas. */
export async function upsertManualProductCost(
  productId: string,
  payload: Record<string, unknown>,
) {
  return upsertCurrentFactoryCostByCurrency({
    productId,
    currency: assertProductCostCurrency(payload.costo_fabrica_moneda),
    amount:
      payload.costo_fabrica_monto == null
        ? null
        : Number(payload.costo_fabrica_monto),
    providerId:
      payload.proveedor_id == null ? null : String(payload.proveedor_id),
    arancelPorcentaje:
      payload.arancel_porcentaje == null
        ? null
        : Number(payload.arancel_porcentaje),
  });
}
