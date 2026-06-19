// modules/products/repositories/productCatalogRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { ProductCatalogQuery, ProductCatalogRawRow } from "../types";

/** Límite ampliado cuando hay búsqueda libre (filtro normalizado en memoria). */
export const PRODUCT_CATALOG_SEARCH_FETCH_LIMIT = 500;

export type ProductCatalogSearchExtraRow = {
  producto_id: string;
  ean: string | null;
  modelo: string | null;
};

function dedupeCatalogRows(rows: ProductCatalogRawRow[]): ProductCatalogRawRow[] {
  const seen = new Set<string>();
  const out: ProductCatalogRawRow[] = [];

  for (const row of rows) {
    if (seen.has(row.producto_id)) continue;
    seen.add(row.producto_id);
    out.push(row);
  }

  return out;
}

function isMissingViewColumnError(error: { message?: string; code?: string }, column: string): boolean {
  const message = (error.message ?? "").toLowerCase();
  const columnLower = column.toLowerCase();

  if (message.includes(columnLower) && message.includes("does not exist")) {
    return true;
  }

  if (error.code === "42703") return true;
  if (error.code === "PGRST204" && message.includes(columnLower)) return true;

  return false;
}

/**
 * Fallback: resuelve producto_id[] vía producto_detalle.categoria_id
 * cuando la vista aún no expone categoria_id.
 */
async function findProductIdsByCategoryIds(
  categoriaIds: string[],
): Promise<string[]> {
  if (categoriaIds.length === 0) return [];

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("producto_detalle")
    .select("producto_id")
    .in("categoria_id", categoriaIds);

  if (error) throw new Error(error.message);

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => String((row as { producto_id: string }).producto_id))
        .filter(Boolean),
    ),
  );
}

/**
 * EAN (logística) y modelo (ficha técnica) para búsqueda normalizada.
 */
export async function findProductCatalogSearchExtras(
  productIds: string[],
): Promise<Map<string, ProductCatalogSearchExtraRow>> {
  const map = new Map<string, ProductCatalogSearchExtraRow>();
  if (productIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();

  const [{ data: logistics, error: logisticsError }, { data: sheets, error: sheetsError }] =
    await Promise.all([
      supabase
        .from("producto_logistica")
        .select("producto_id, ean_upc")
        .in("producto_id", productIds),
      supabase
        .from("producto_ficha_tecnica")
        .select("producto_id, modelo")
        .in("producto_id", productIds),
    ]);

  if (logisticsError) throw new Error(logisticsError.message);
  if (sheetsError) throw new Error(sheetsError.message);

  for (const id of productIds) {
    map.set(id, { producto_id: id, ean: null, modelo: null });
  }

  for (const row of logistics ?? []) {
    const r = row as { producto_id: string; ean_upc: string | null };
    const current = map.get(r.producto_id) ?? {
      producto_id: r.producto_id,
      ean: null,
      modelo: null,
    };
    current.ean = r.ean_upc;
    map.set(r.producto_id, current);
  }

  for (const row of sheets ?? []) {
    const r = row as { producto_id: string; modelo: string | null };
    const current = map.get(r.producto_id) ?? {
      producto_id: r.producto_id,
      ean: null,
      modelo: null,
    };
    current.modelo = r.modelo;
    map.set(r.producto_id, current);
  }

  return map;
}

type CategoryFilter =
  | { mode: "none" }
  | { mode: "categoria_id"; categoriaIds: string[] }
  | { mode: "producto_id"; productoIds: string[] };

function buildProductCatalogQuery(
  query: ProductCatalogQuery,
  categoryFilter: CategoryFilter,
) {
  const supabase = createSupabaseRouteClient();

  const fetchLimit = query.q
    ? PRODUCT_CATALOG_SEARCH_FETCH_LIMIT
    : query.limit;
  const fetchOffset = query.q ? 0 : query.offset;

  let dbQuery = supabase
    .from("v_productos_catalogo")
    .select("*")
    .order("updated_at", { ascending: false })
    .range(fetchOffset, fetchOffset + fetchLimit - 1);

  if (query.q && !query.useNormalizedSearch) {
    const escaped = query.q.replace(/[%_,]/g, " ").trim();
    if (escaped) {
      dbQuery = dbQuery.or(
        `sku.ilike.%${escaped}%,nombre.ilike.%${escaped}%,asin.ilike.%${escaped}%`,
      );
    }
  }

  if (query.agenteIds.length > 0) {
    dbQuery = dbQuery.in("agente_id", query.agenteIds);
  }

  if (query.puertos.length > 0) {
    dbQuery = dbQuery.in("puerto_preferido", query.puertos);
  }

  if (categoryFilter.mode === "categoria_id") {
    dbQuery = dbQuery.in("categoria_id", categoryFilter.categoriaIds);
  } else if (categoryFilter.mode === "producto_id") {
    dbQuery = dbQuery.in("producto_id", categoryFilter.productoIds);
  }

  const estadosProducto = query.estados.filter((estado) =>
    ["borrador", "activo"].includes(estado),
  );

  if (estadosProducto.length > 0) {
    dbQuery = dbQuery.in("estado", estadosProducto);
  }

  const riesgosStock: string[] = [];

  if (query.estados.includes("stock_critico")) {
    dbQuery = dbQuery.eq("riesgo", "critico");
  }

  if (query.estados.includes("stock_bajo")) {
    riesgosStock.push("alto");
  }
  if (query.estados.includes("stock_ok")) {
    riesgosStock.push("medio", "bajo");
  }
  if (riesgosStock.length > 0) {
    dbQuery = dbQuery.in("riesgo", riesgosStock);
  }

  if (query.estados.includes("alto_margen")) {
    dbQuery = dbQuery.gte("margen_estimado", 0.35);
  }

  if (query.estados.includes("bajo_margen")) {
    dbQuery = dbQuery.lt("margen_estimado", 0.15);
  }

  return dbQuery;
}

/**
 * Repository del catálogo.
 *
 * Responsabilidad:
 * - Leer la vista v_productos_catalogo.
 * - Aplicar filtros SQL.
 *
 * NO debe:
 * - Calcular margen.
 * - Calcular ACOS.
 * - Convertir snake_case a camelCase.
 * - Preparar datos visuales.
 */
export async function findProductCatalogRows(
  query: ProductCatalogQuery,
): Promise<ProductCatalogRawRow[]> {
  const categoryFilter: CategoryFilter =
    query.categorias.length > 0
      ? { mode: "categoria_id", categoriaIds: query.categorias }
      : { mode: "none" };

  let { data, error } = await buildProductCatalogQuery(query, categoryFilter);

  if (
    error &&
    categoryFilter.mode === "categoria_id" &&
    isMissingViewColumnError(error, "categoria_id")
  ) {
    const productIds = await findProductIdsByCategoryIds(query.categorias);
    if (productIds.length === 0) return [];

    ({ data, error } = await buildProductCatalogQuery(query, {
      mode: "producto_id",
      productoIds: productIds,
    }));
  }

  if (error) {
    throw new Error(error.message);
  }

  return dedupeCatalogRows((data ?? []) as ProductCatalogRawRow[]);
}
