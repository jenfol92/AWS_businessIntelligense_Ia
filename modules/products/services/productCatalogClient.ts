// modules/products/services/productCatalogClient.ts

import type {
  ProductCatalogOptionsResponse,
  ProductCatalogResponse,
} from "../types/catalog.types";

type FetchProductCatalogParams = {
  q?: string;
  limit?: number;
  offset?: number;
  agenteIds?: string[];
  puertos?: string[];
  categorias?: string[];
  estados?: string[];
};

export async function fetchProductCatalog(
  params: FetchProductCatalogParams = {}
): Promise<ProductCatalogResponse> {
  const searchParams = new URLSearchParams();

  if (params.q) searchParams.set("q", params.q);
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  params.agenteIds?.forEach((id) => searchParams.append("agenteId", id));
  params.puertos?.forEach((puerto) => searchParams.append("puerto", puerto));
  params.categorias?.forEach((categoriaId) =>
    searchParams.append("categoriaId", categoriaId)
  );
  params.estados?.forEach((estado) =>
    searchParams.append("estado", estado)
  );

  const response = await fetch(
    `/api/products/catalog?${searchParams.toString()}`,
    { cache: "no-store" }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? "No se pudo cargar el catálogo");
  }

  return data;
}

export async function fetchProductCatalogOptions(): Promise<ProductCatalogOptionsResponse> {
  const response = await fetch("/api/products/catalog/options", {
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? "No se pudieron cargar los filtros");
  }

  return data;
}