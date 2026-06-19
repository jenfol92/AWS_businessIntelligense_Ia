// modules/products/repositories/productCatalogOptionsRepository.ts

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { ProductCatalogFilterOptions } from "../types/catalog.types";

type AgentOptionRow = {
  id: string;
  empresa: string;
  contacto: string | null;
};

type CatalogOptionRow = {
  puerto_preferido: string | null;
};

type CategoryOptionRow = {
  id: string;
  nombre: string;
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));
}

export async function findProductCatalogFilterOptions(): Promise<ProductCatalogFilterOptions> {
  const supabase = createSupabaseRouteClient();

  const [
    { data: agentesData, error: agentesError },
    { data: catalogData, error: catalogError },
    { data: categoriasData, error: categoriasError },
  ] = await Promise.all([
    supabase
      .from("agentes_compra")
      .select("id, empresa, contacto")
      .order("empresa", { ascending: true }),

    supabase
      .from("v_productos_catalogo")
      .select("puerto_preferido"),

    supabase
      .from("categorias")
      .select("id, nombre")
      .eq("es_activa", true)
      .order("nombre", { ascending: true }),
  ]);

  if (agentesError) throw new Error(agentesError.message);
  if (catalogError) throw new Error(catalogError.message);
  if (categoriasError) throw new Error(categoriasError.message);

  const agentes = (agentesData ?? []) as AgentOptionRow[];
  const catalogRows = (catalogData ?? []) as CatalogOptionRow[];
  const categorias = (categoriasData ?? []) as CategoryOptionRow[];

  return {
    agentes,
    puertos: uniqueStrings(catalogRows.map((row) => row.puerto_preferido)),
    categorias,
    estados: [
      { value: "borrador", label: "Borrador" },
      { value: "activo", label: "Activo" },
      { value: "stock_critico", label: "Stock crítico" },
      { value: "stock_bajo", label: "Stock bajo" },
      { value: "stock_ok", label: "Stock ok" },
      { value: "alto_margen", label: "Alto margen" },
      { value: "bajo_margen", label: "Bajo margen" },
      { value: "orden_en_curso", label: "Orden en curso" },
    ],
  };
}