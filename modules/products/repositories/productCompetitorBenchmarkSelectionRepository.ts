// modules/products/repositories/productCompetitorBenchmarkSelectionRepository.ts
//
// Decisión de negocio: qué competidores usar en forecast por producto/marketplace.
// Histórico de métricas → competitor_benchmark_snapshots.

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  CompetitorSelectionFilterResult,
  ProductCompetitorBenchmarkSelection,
  ProductCompetitorBenchmarkSelectionRawRow,
  UpsertProductCompetitorBenchmarkSelectionInput,
  UpsertProductCompetitorBenchmarkSelectionRaw,
} from "../types/competitor-benchmark-selection.types";

const TABLE = "product_competitor_benchmark_selection";

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSelectionRow(
  row: ProductCompetitorBenchmarkSelectionRawRow,
): ProductCompetitorBenchmarkSelection {
  return {
    id: row.id,
    productoId: row.producto_id,
    marketplaceCountry: row.marketplace_country,
    competitorAsin: row.competitor_asin,
    competitorTitle: row.competitor_title,
    isSelected: row.is_selected === true,
    useForForecast: row.use_for_forecast === true,
    weight: toNullableNumber(row.weight),
    capturePct: toNullableNumber(row.capture_pct),
    snapshotId: row.snapshot_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildExplicitFilter(
  rows: ProductCompetitorBenchmarkSelectionRawRow[],
): CompetitorSelectionFilterResult {
  const competitorAsins = rows
    .filter((row) => row.is_selected && row.use_for_forecast)
    .map((row) => String(row.competitor_asin).trim())
    .filter(Boolean);

  return { kind: "explicit", competitorAsins };
}

/**
 * Filtra filas de snapshot según selección explícita.
 * legacy_fallback → sin cambios; explicit → solo ASINs elegidos (puede quedar vacío).
 */
export function filterRowsByCompetitorSelection<T>(
  rows: T[],
  getAsin: (row: T) => string | null | undefined,
  filter: CompetitorSelectionFilterResult,
): T[] {
  if (filter.kind === "legacy_fallback") return rows;

  const allowed = new Set(
    filter.competitorAsins.map((asin) => asin.trim().toUpperCase()).filter(Boolean),
  );
  if (allowed.size === 0) return [];

  return rows.filter((row) => {
    const asin = getAsin(row)?.trim().toUpperCase();
    return asin != null && asin.length > 0 && allowed.has(asin);
  });
}

export function getSelectionFilterForProduct(
  filtersByProductId: Map<string, CompetitorSelectionFilterResult>,
  productoId: string,
): CompetitorSelectionFilterResult {
  return filtersByProductId.get(productoId) ?? { kind: "legacy_fallback" };
}

/**
 * Competidores activos para forecast (is_selected + use_for_forecast).
 * Si marketplaceCountry es null/ALL, no aplica selección → [] (usar resolveSelectionFilter).
 */
export async function fetchSelectedCompetitorsForProduct(
  productoId: string,
  marketplaceCountry: string | null,
): Promise<ProductCompetitorBenchmarkSelection[]> {
  const filter = await resolveSelectionFilterForProduct(
    productoId,
    marketplaceCountry,
  );
  if (filter.kind !== "explicit") return [];

  const supabase = createSupabaseRouteClient();
  let q = supabase
    .from(TABLE)
    .select("*")
    .eq("producto_id", productoId)
    .eq("is_selected", true)
    .eq("use_for_forecast", true);

  if (marketplaceCountry?.trim()) {
    q = q.eq("marketplace_country", marketplaceCountry.trim());
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return ((data ?? []) as ProductCompetitorBenchmarkSelectionRawRow[]).map(
    mapSelectionRow,
  );
}

/** ASINs seleccionados para forecast; null si no hay selección explícita en BD. */
export async function fetchSelectedCompetitorAsinsForProduct(
  productoId: string,
  marketplaceCountry: string | null,
): Promise<string[] | null> {
  const filter = await resolveSelectionFilterForProduct(
    productoId,
    marketplaceCountry,
  );
  if (filter.kind === "legacy_fallback") return null;
  return filter.competitorAsins;
}

/**
 * Resuelve si hay selección explícita para producto + marketplace.
 * Sin marketplace concreto (ALL/EU) → legacy_fallback (compatibilidad).
 */
export async function resolveSelectionFilterForProduct(
  productoId: string,
  marketplaceCountry: string | null,
): Promise<CompetitorSelectionFilterResult> {
  const country = marketplaceCountry?.trim();
  if (!country) return { kind: "legacy_fallback" };

  try {
    const supabase = createSupabaseRouteClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("competitor_asin, is_selected, use_for_forecast")
      .eq("producto_id", productoId)
      .eq("marketplace_country", country);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Pick<
      ProductCompetitorBenchmarkSelectionRawRow,
      "competitor_asin" | "is_selected" | "use_for_forecast"
    >[];

    if (rows.length === 0) return { kind: "legacy_fallback" };
    return buildExplicitFilter(rows as ProductCompetitorBenchmarkSelectionRawRow[]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[competitor-selection] resolveSelectionFilterForProduct omitido: ${message}`,
    );
    return { kind: "legacy_fallback" };
  }
}

/** Batch para planner: mapa producto_id → filtro (solo marketplace concreto). */
export async function fetchSelectionFiltersByProductIds(
  productIds: string[],
  marketplaceCountry: string | null,
): Promise<Map<string, CompetitorSelectionFilterResult>> {
  const result = new Map<string, CompetitorSelectionFilterResult>();
  const country = marketplaceCountry?.trim();
  if (!country || productIds.length === 0) return result;

  try {
    const supabase = createSupabaseRouteClient();
    const grouped = new Map<string, ProductCompetitorBenchmarkSelectionRawRow[]>();

    for (const chunk of chunkArray(productIds, 150)) {
      const { data, error } = await supabase
        .from(TABLE)
        .select("producto_id, competitor_asin, is_selected, use_for_forecast")
        .in("producto_id", chunk)
        .eq("marketplace_country", country);

      if (error) throw new Error(error.message);

      for (const row of (data ?? []) as ProductCompetitorBenchmarkSelectionRawRow[]) {
        const pid = String(row.producto_id);
        const list = grouped.get(pid) ?? [];
        list.push(row);
        grouped.set(pid, list);
      }
    }

    for (const [productoId, rows] of Array.from(grouped.entries())) {
      result.set(productoId, buildExplicitFilter(rows));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[competitor-selection] fetchSelectionFiltersByProductIds omitido: ${message}`,
    );
  }

  return result;
}

function mapUpsertInputToRaw(
  input: UpsertProductCompetitorBenchmarkSelectionInput,
): UpsertProductCompetitorBenchmarkSelectionRaw {
  return {
    producto_id: input.productoId.trim(),
    marketplace_country: input.marketplaceCountry.trim(),
    competitor_asin: input.competitorAsin.trim(),
    competitor_title: input.competitorTitle ?? null,
    is_selected: input.isSelected ?? true,
    use_for_forecast: input.useForForecast ?? true,
    weight: toNullableNumber(input.weight),
    capture_pct: toNullableNumber(input.capturePct),
    snapshot_id: input.snapshotId ?? null,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Crea o actualiza una fila de selección (unique producto + marketplace + ASIN).
 * Preparado para fases posteriores; no expuesto en API todavía.
 */
export async function upsertProductCompetitorSelection(
  input: UpsertProductCompetitorBenchmarkSelectionInput,
): Promise<ProductCompetitorBenchmarkSelection> {
  const payload = mapUpsertInputToRaw(input);
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from(TABLE)
    .upsert(payload, {
      onConflict: "producto_id,marketplace_country,competitor_asin",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return mapSelectionRow(data as ProductCompetitorBenchmarkSelectionRawRow);
}

/** Todas las filas de selección del producto/marketplace, indexadas por ASIN. */
export async function fetchAllSelectionsForProductMarketplace(
  productoId: string,
  marketplaceCountry: string,
): Promise<Map<string, ProductCompetitorBenchmarkSelection>> {
  const supabase = createSupabaseRouteClient();
  const country = marketplaceCountry.trim();
  const map = new Map<string, ProductCompetitorBenchmarkSelection>();

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("producto_id", productoId)
    .eq("marketplace_country", country);

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as ProductCompetitorBenchmarkSelectionRawRow[]) {
    const asin = String(row.competitor_asin).trim().toUpperCase();
    if (!asin) continue;
    map.set(asin, mapSelectionRow(row));
  }

  return map;
}

export type BatchSelectionItem = {
  competitorAsin: string;
  competitorTitle?: string | null;
  snapshotId?: string | null;
  isSelected?: boolean;
  useForForecast?: boolean;
  weight?: number | null;
  capturePct?: number | null;
  notes?: string | null;
};

/** Upsert múltiple desde API PUT selection. */
export async function upsertProductCompetitorSelectionsBatch(
  productoId: string,
  marketplaceCountry: string,
  items: BatchSelectionItem[],
): Promise<number> {
  if (items.length === 0) return 0;

  let saved = 0;
  for (const item of items) {
    await upsertProductCompetitorSelection({
      productoId,
      marketplaceCountry,
      competitorAsin: item.competitorAsin,
      competitorTitle: item.competitorTitle,
      isSelected: item.isSelected,
      useForForecast: item.useForForecast,
      weight: item.weight,
      capturePct: item.capturePct,
      snapshotId: item.snapshotId,
      notes: item.notes,
    });
    saved += 1;
  }
  return saved;
}
