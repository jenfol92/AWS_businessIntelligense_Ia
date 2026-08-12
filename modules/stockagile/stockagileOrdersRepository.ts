import { supabaseAdmin } from "@/server/supabase/adminClient";

import type { StockagileRawDbRow, StockagileSyncSummary } from "./stockagileTypes";

const BATCH_SIZE = 200;

export async function resolveProductIdsByTwinlyEan(
  eans: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueEans = Array.from(new Set(eans.map((ean) => ean.trim()).filter(Boolean)));
  if (uniqueEans.length === 0) return map;

  for (let i = 0; i < uniqueEans.length; i += 500) {
    const chunk = uniqueEans.slice(i, i + 500);
    const { data: products, error: productError } = await supabaseAdmin
      .from("productos")
      .select("id, sku")
      .in("sku", chunk);

    if (productError) throw new Error(productError.message);

    for (const row of products ?? []) {
      const id = String((row as { id?: string }).id ?? "");
      const sku = String((row as { sku?: string }).sku ?? "").trim();
      if (id && sku) map.set(sku, id);
    }

    const { data: logistics, error: logisticsError } = await supabaseAdmin
      .from("producto_logistica")
      .select("producto_id, ean_upc")
      .in("ean_upc", chunk);

    if (logisticsError) throw new Error(logisticsError.message);

    for (const row of logistics ?? []) {
      const id = String((row as { producto_id?: string }).producto_id ?? "");
      const ean = String((row as { ean_upc?: string }).ean_upc ?? "").trim();
      if (id && ean && !map.has(ean)) map.set(ean, id);
    }
  }

  return map;
}

export async function upsertStockagileRawRows(rows: StockagileRawDbRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  let affected = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin.from("stockagile_orders_raw").upsert(batch, {
      onConflict: "dedupe_key",
    });

    if (error) throw new Error(error.message);
    affected += batch.length;
  }

  return affected;
}

export async function syncVentasDiariasFromStockagileFbmSales(params: {
  startDate: string;
  endDate: string;
  source: string;
  tipoCliente: string;
}): Promise<StockagileSyncSummary> {
  const { data, error } = await supabaseAdmin.rpc(
    "sync_ventas_diarias_from_stockagile_fbm_sales",
    {
      p_start_date: params.startDate,
      p_end_date: params.endDate,
      p_source: params.source,
      p_tipo_cliente: params.tipoCliente,
    },
  );

  if (error) throw new Error(error.message);

  const result = (data ?? {}) as Partial<StockagileSyncSummary>;
  return {
    deletedPreviousRows: Number(result.deletedPreviousRows ?? 0),
    insertedRows: Number(result.insertedRows ?? 0),
    insertedUnits: Number(result.insertedUnits ?? 0),
    nonTwinlyRows: Number(result.nonTwinlyRows ?? 0),
    nonTwinlyUnits: Number(result.nonTwinlyUnits ?? 0),
    orphanTwinlyRows: Number(result.orphanTwinlyRows ?? 0),
    orphanTwinlyUnits: Number(result.orphanTwinlyUnits ?? 0),
    skippedCancelledRows: Number(result.skippedCancelledRows ?? 0),
    skippedFbaRows: Number(result.skippedFbaRows ?? 0),
  };
}
