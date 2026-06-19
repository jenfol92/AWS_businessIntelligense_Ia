// modules/products/schemas/productCatalogQuerySchema.ts

import { PRODUCT_CATALOG_DEFAULT_LIMIT } from "../constants";
import type { ProductCatalogQuery } from "../types";

function getMultiValues(url: URL, ...keys: string[]): string[] {
  const values: string[] = [];

  for (const key of keys) {
    const repeated = url.searchParams.getAll(key);
    values.push(
      ...repeated.flatMap((value) =>
        value.split(",").map((item) => item.trim()),
      ),
    );
  }

  return Array.from(new Set(values.filter(Boolean)));
}

export function parseProductCatalogQuery(req: Request): ProductCatalogQuery {
  const url = new URL(req.url);

  const q = url.searchParams.get("q")?.trim() || undefined;

  const rawLimit = Number(
    url.searchParams.get("limit") ?? PRODUCT_CATALOG_DEFAULT_LIMIT,
  );

  const rawOffset = Number(url.searchParams.get("offset") ?? 0);

  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, 200)
      : PRODUCT_CATALOG_DEFAULT_LIMIT;

  const offset =
    Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  return {
    q,
    limit,
    offset,
    agenteIds: getMultiValues(url, "agenteId"),
    puertos: getMultiValues(url, "puerto"),
    categorias: getMultiValues(url, "categoriaId", "categoria"),
    estados: getMultiValues(url, "estado"),
    useNormalizedSearch: Boolean(q),
  };
}
