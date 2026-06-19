// modules/products/services/getProductCatalog.ts

import {
  findProductCatalogRows,
  findProductCatalogSearchExtras,
} from "../repositories/productCatalogRepository";
import { findProductCatalogFilterOptions } from "../repositories/productCatalogOptionsRepository";
import { mapProductCatalogRow } from "../mappers/productCatalogMapper";
import { matchesProductCatalogSearch } from "../utils/productCatalogSearch";
import type { ProductCatalogQuery, ProductCatalogResponse } from "../types";

/**
 * Caso de uso: cargar catálogo de productos.
 *
 * El service:
 * - llama al repository
 * - aplica búsqueda normalizada en memoria cuando hay `q`
 * - aplica mapper
 * - devuelve respuesta estable para API/UI
 */
export async function getProductCatalog(
  query: ProductCatalogQuery,
): Promise<ProductCatalogResponse> {
  const [rawRows, options] = await Promise.all([
    findProductCatalogRows(query),
    findProductCatalogFilterOptions(),
  ]);

  let rows = rawRows.map(mapProductCatalogRow);
  let hasMore = rows.length === query.limit;

  if (query.q?.trim()) {
    const extrasMap = await findProductCatalogSearchExtras(rows.map((row) => row.id));

    const filtered = rows.filter((row) => {
      const extras = extrasMap.get(row.id);
      return matchesProductCatalogSearch(query.q!, row, {
        ean: extras?.ean ?? null,
        modelo: extras?.modelo ?? null,
      });
    });

    hasMore = filtered.length > query.offset + query.limit;
    rows = filtered.slice(query.offset, query.offset + query.limit);
  }

  return {
    ok: true,
    options,
    rows,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      hasMore,
    },
  };
}
