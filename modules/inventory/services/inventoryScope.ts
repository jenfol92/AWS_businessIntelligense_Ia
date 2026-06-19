// modules/inventory/services/inventoryScope.ts
//
// Normalización de país y canal para inventario y forecast anual.
// ventas_diarias.canal_venta usa FBA / FBM (no AMAZON_FBA).

/** Países UE presentes en inventario/ventas (excluye GB/UK). */
export const EU_COUNTRY_CODES = [
  "ES",
  "FR",
  "IT",
  "DE",
  "PT",
  "NL",
  "BE",
  "AT",
  "LU",
  "PL",
  "SE",
  "DK",
] as const;

export type InventoryChannelFilter = "ALL" | "AMAZON_FBA" | "AMAZON_FBM";

export type InventoryCountryFilter = "ALL" | "EU" | string;

export type ResolvedCountryScope = {
  filter: InventoryCountryFilter;
  /** Códigos ISO usados en inventario_paises.pais / ventas_diarias.pais */
  countries: string[] | null;
};

export type ResolvedChannelScope = {
  filter: InventoryChannelFilter;
  /** Valor en ventas_diarias.canal_venta; null = todos los canales */
  ventasCanal: string | null;
};

/**
 * Convierte filtro global de canal a forma interna y a canal_venta en BD.
 * Acepta ALL | FBA | FBM | AMAZON_FBA | AMAZON_FBM.
 */
export function resolveChannelScope(raw?: string | null): ResolvedChannelScope {
  const c = (raw ?? "ALL").trim().toUpperCase();
  if (c === "FBM" || c === "AMAZON_FBM") {
    return { filter: "AMAZON_FBM", ventasCanal: "FBM" };
  }
  if (c === "FBA" || c === "AMAZON_FBA") {
    return { filter: "AMAZON_FBA", ventasCanal: "FBA" };
  }
  return { filter: "ALL", ventasCanal: null };
}

/**
 * Convierte filtro global de país a lista de códigos o null (todos).
 * EU agrega mercados UE conocidos en la BD.
 */
export function resolveCountryScope(raw?: string | null): ResolvedCountryScope {
  const p = (raw ?? "ALL").trim().toUpperCase();
  if (!p || p === "ALL") {
    return { filter: "ALL", countries: null };
  }
  if (p === "EU") {
    return { filter: "EU", countries: [...EU_COUNTRY_CODES] };
  }
  return { filter: p, countries: [p] };
}

/** Stock de una fila inventario_paises según canal. */
export function stockForChannelRow(
  row: { stock_fba: number | null; stock_fbm: number | null; stock_pais: number | null },
  channel: ResolvedChannelScope,
): number {
  const fba = Number(row.stock_fba ?? 0);
  const fbm = Number(row.stock_fbm ?? 0);
  if (channel.filter === "AMAZON_FBA") return fba;
  if (channel.filter === "AMAZON_FBM") return fbm;
  const sp = row.stock_pais;
  if (sp != null && sp > 0) return sp;
  return fba + fbm;
}

/** Etiqueta legible del canal para respuestas API. */
export function channelScopeLabel(scope: ResolvedChannelScope): InventoryChannelFilter {
  return scope.filter;
}

/** Etiqueta legible del país para respuestas API. */
export function countryScopeLabel(scope: ResolvedCountryScope): InventoryCountryFilter {
  return scope.filter as InventoryCountryFilter;
}

/** marketplace_country en competitor_benchmark_snapshots (mismo código país). */
export function benchmarkMarketplaceCountry(
  countryScope: ResolvedCountryScope,
): string | null {
  if (countryScope.filter === "ALL" || countryScope.filter === "EU") return null;
  return countryScope.filter;
}
