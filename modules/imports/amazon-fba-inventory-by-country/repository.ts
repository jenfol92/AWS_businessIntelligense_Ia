import { supabaseAdmin } from "@/server/supabase/adminClient";
import { resolveAmazonMarketplaceId } from "@/modules/imports/shared/amazonMarketplaceIds";
import type {
  AggregatedFbaCountryStock,
  ParsedFbaCountryRow,
} from "./types";

const BATCH_SIZE = 200;

export async function loadProductIdsBySku(
  skus: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;

  const uniqueSkus = Array.from(new Set(skus));
  for (let i = 0; i < uniqueSkus.length; i += 500) {
    const chunk = uniqueSkus.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from("productos")
      .select("id, sku")
      .in("sku", chunk);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const sku = String((row as { sku?: string }).sku ?? "").trim();
      const id = String((row as { id?: string }).id ?? "");
      if (sku && id) map.set(sku, id);
    }
  }

  return map;
}

export type InventarioPaisStockFbaReadRow = {
  producto_id: string;
  pais: string;
  stock_fba: number;
  updated_at: string | null;
};

/**
 * SELECT de solo lectura: stock FBA actual en inventario_paises para productos del preview.
 */
export async function loadInventarioPaisesStockFbaByProductIds(
  productoIds: string[],
): Promise<Map<string, InventarioPaisStockFbaReadRow>> {
  const map = new Map<string, InventarioPaisStockFbaReadRow>();
  if (productoIds.length === 0) return map;

  const uniqueIds = Array.from(new Set(productoIds));
  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const chunk = uniqueIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabaseAdmin
      .from("inventario_paises")
      .select("producto_id, pais, stock_fba, updated_at")
      .in("producto_id", chunk);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const r = row as {
        producto_id: string;
        pais: string;
        stock_fba: number | null;
        updated_at: string | null;
      };
      const productoId = String(r.producto_id ?? "").trim();
      const pais = String(r.pais ?? "").trim();
      if (!productoId || !pais) continue;

      map.set(`${productoId}::${pais}`, {
        producto_id: productoId,
        pais,
        stock_fba: Number(r.stock_fba ?? 0),
        updated_at: r.updated_at ?? null,
      });
    }
  }

  return map;
}

async function loadAmazonMarketplaceIdByCode(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("amazon_marketplaces")
    .select("id, code");

  if (error) {
    throw new Error(`Error cargando amazon_marketplaces: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((m) => [
      String((m as { code?: string }).code ?? "")
        .trim()
        .toUpperCase(),
      String((m as { id?: string }).id ?? "").trim(),
    ]),
  );
}

/**
 * Agrega filas por producto+país usando el snapshot más reciente del archivo.
 */
function buildAggregatedRaw(row: ParsedFbaCountryRow): Record<string, unknown> {
  return {
    marketplaceCountry: row.pais,
    cleanSku: row.skuLimpio,
    totalQuantity: row.stockFba,
    sources: [
      {
        rowNumber: row.rowNumber,
        sellerSku: row.skuOriginal,
        country: row.pais,
        quantityForLocalFulfillment: row.stockFba,
        raw: row.raw,
      },
    ],
    skipped: [],
  };
}

function appendAggregatedRawSource(
  item: AggregatedFbaCountryStock,
  row: ParsedFbaCountryRow,
) {
  const current =
    item.raw && typeof item.raw === "object" && !Array.isArray(item.raw)
      ? item.raw
      : {
          marketplaceCountry: item.pais,
          cleanSku: item.sku_limpio,
          totalQuantity: item.stock_fba,
          sources: [],
          skipped: [],
        };
  const sources = Array.isArray(current.sources) ? current.sources : [];

  item.raw = {
    ...current,
    marketplaceCountry: item.pais,
    cleanSku: item.sku_limpio,
    totalQuantity: Number(current.totalQuantity ?? 0) + row.stockFba,
    sources: [
      ...sources,
      {
        rowNumber: row.rowNumber,
        sellerSku: row.skuOriginal,
        country: row.pais,
        quantityForLocalFulfillment: row.stockFba,
        raw: row.raw,
      },
    ],
    skipped: Array.isArray(current.skipped) ? current.skipped : [],
  };
}

function mergeAggregatedRaw(
  target: AggregatedFbaCountryStock,
  source: AggregatedFbaCountryStock,
) {
  const targetRaw =
    target.raw && typeof target.raw === "object" && !Array.isArray(target.raw)
      ? target.raw
      : {
          marketplaceCountry: target.pais,
          cleanSku: target.sku_limpio,
          totalQuantity: target.stock_fba,
          sources: [],
          skipped: [],
        };
  const sourceRaw =
    source.raw && typeof source.raw === "object" && !Array.isArray(source.raw)
      ? source.raw
      : {
          marketplaceCountry: source.pais,
          cleanSku: source.sku_limpio,
          totalQuantity: source.stock_fba,
          sources: [],
          skipped: [],
        };

  target.raw = {
    ...targetRaw,
    marketplaceCountry: target.pais,
    cleanSku: target.sku_limpio,
    totalQuantity:
      Number(targetRaw.totalQuantity ?? 0) +
      Number(sourceRaw.totalQuantity ?? source.stock_fba),
    sources: [
      ...(Array.isArray(targetRaw.sources) ? targetRaw.sources : []),
      ...(Array.isArray(sourceRaw.sources) ? sourceRaw.sources : []),
    ],
    skipped: [
      ...(Array.isArray(targetRaw.skipped) ? targetRaw.skipped : []),
      ...(Array.isArray(sourceRaw.skipped) ? sourceRaw.skipped : []),
    ],
  };
}

export function aggregateCountryStockRows(
  rows: ParsedFbaCountryRow[],
  productoBySku: Map<string, string>,
  marketplaceIdByCode: Map<string, string>,
): AggregatedFbaCountryStock[] {
  const byProductCountryDate = new Map<string, AggregatedFbaCountryStock>();

  for (const row of rows) {
    const productoId = productoBySku.get(row.skuLimpio);
    if (!productoId) continue;

    const key = `${productoId}::${row.pais}::${row.snapshotDate}`;
    const marketplaceId = resolveAmazonMarketplaceId(row.pais, marketplaceIdByCode);

    const prev = byProductCountryDate.get(key);
    if (prev) {
      prev.stock_fba += row.stockFba;
      appendAggregatedRawSource(prev, row);
      continue;
    }

    byProductCountryDate.set(key, {
      producto_id: productoId,
      sku_limpio: row.skuLimpio,
      pais: row.pais,
      marketplace_id: marketplaceId,
      stock_fba: row.stockFba,
      snapshot_date: row.snapshotDate,
      raw: buildAggregatedRaw(row),
    });
  }

  const latestByProductCountry = new Map<string, AggregatedFbaCountryStock>();

  for (const item of Array.from(byProductCountryDate.values())) {
    const key = `${item.producto_id}::${item.pais}`;
    const prev = latestByProductCountry.get(key);
    if (!prev || item.snapshot_date > prev.snapshot_date) {
      latestByProductCountry.set(key, { ...item });
    } else if (item.snapshot_date === prev.snapshot_date) {
      prev.stock_fba += item.stock_fba;
      mergeAggregatedRaw(prev, item);
    }
  }

  return Array.from(latestByProductCountry.values());
}

async function loadExistingStockFbmByKeys(
  rows: AggregatedFbaCountryStock[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (rows.length === 0) return map;

  const productIds = Array.from(new Set(rows.map((r) => r.producto_id)));

  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    const chunk = productIds.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabaseAdmin
      .from("inventario_paises")
      .select("producto_id, pais, stock_fbm")
      .in("producto_id", chunk);

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const r = row as {
        producto_id: string;
        pais: string;
        stock_fbm: number | null;
      };
      map.set(
        `${r.producto_id}::${r.pais}`,
        Number(r.stock_fbm ?? 0),
      );
    }
  }

  return map;
}

/**
 * Actualiza SOLO inventario_paises.stock_fba (y marketplace_id, updated_at).
 * Preserva stock_fbm existente; no toca stock_pais.
 */
export async function upsertInventarioPaisesStockFba(
  rows: AggregatedFbaCountryStock[],
): Promise<number> {
  if (rows.length === 0) return 0;

  const existingFbm = await loadExistingStockFbmByKeys(rows);
  const now = new Date().toISOString();
  let affected = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => {
      const fbmKey = `${row.producto_id}::${row.pais}`;
      return {
        producto_id: row.producto_id,
        pais: row.pais,
        stock_fba: row.stock_fba,
        stock_fbm: existingFbm.get(fbmKey) ?? 0,
        marketplace_id: row.marketplace_id,
        updated_at: now,
      };
    });

    const { error } = await supabaseAdmin
      .from("inventario_paises")
      .upsert(batch, { onConflict: "producto_id,pais" });

    if (error) throw new Error(error.message);
    affected += batch.length;
  }

  return affected;
}

export async function upsertFbaCountryStockDaily(
  rows: AggregatedFbaCountryStock[],
  source: string,
): Promise<number> {
  if (rows.length === 0) return 0;

  let affected = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => ({
      producto_id: row.producto_id,
      sku_limpio: row.sku_limpio,
      marketplace_country: row.pais,
      marketplace_id: row.marketplace_id,
      snapshot_date: row.snapshot_date,
      stock_fba: row.stock_fba,
      source,
      raw: row.raw,
    }));

    const { error } = await supabaseAdmin
      .from("fba_country_stock_daily")
      .upsert(batch, {
        onConflict:
          "producto_id,sku_limpio,marketplace_country,snapshot_date,source",
      });

    if (error) {
      // Tabla histórica opcional si migración aún no aplicada
      if (error.message.includes("fba_country_stock_daily")) {
        return 0;
      }
      throw new Error(error.message);
    }

    affected += batch.length;
  }

  return affected;
}

export async function commitFbaCountryInventory(params: {
  rows: ParsedFbaCountryRow[];
  productoBySku: Map<string, string>;
  source: string;
}): Promise<{
  inventarioPaisesUpserted: number;
  historySnapshotsUpserted: number;
}> {
  const marketplaceIdByCode = await loadAmazonMarketplaceIdByCode();
  const aggregated = aggregateCountryStockRows(
    params.rows,
    params.productoBySku,
    marketplaceIdByCode,
  );

  const inventarioPaisesUpserted =
    await upsertInventarioPaisesStockFba(aggregated);
  const historySnapshotsUpserted = await upsertFbaCountryStockDaily(
    aggregated,
    params.source,
  );

  return { inventarioPaisesUpserted, historySnapshotsUpserted };
}
