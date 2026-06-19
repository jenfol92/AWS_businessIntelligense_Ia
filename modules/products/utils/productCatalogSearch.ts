// modules/products/utils/productCatalogSearch.ts
//
// Búsqueda normalizada sobre filas del catálogo de productos.

import { matchesNormalizedSearch } from "@/shared/utils/normalizeSearchText";
import type { ProductCatalogItem } from "../types/catalog.types";

export type ProductCatalogSearchExtras = {
  ean: string | null;
  modelo: string | null;
};

/**
 * Campos indexados para búsqueda libre en el catálogo.
 */
export function productCatalogSearchFields(
  row: ProductCatalogItem,
  extras?: ProductCatalogSearchExtras,
): Array<string | null | undefined> {
  return [
    row.nombre,
    row.sku,
    row.asin,
    extras?.ean,
    extras?.modelo,
    row.marca,
    row.categoria,
    row.proveedorNombre,
  ];
}

export function matchesProductCatalogSearch(
  query: string,
  row: ProductCatalogItem,
  extras?: ProductCatalogSearchExtras,
): boolean {
  return matchesNormalizedSearch(query, productCatalogSearchFields(row, extras));
}
