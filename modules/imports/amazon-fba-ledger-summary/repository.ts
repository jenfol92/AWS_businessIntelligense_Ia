import { supabaseAdmin } from "@/server/supabase/adminClient";
// Solo escribe amazon_fba_inventory_ledger_daily → v_product_fba_stock_daily.
// NO actualiza inventario_paises.stock_fba (usar amazon-fba-inventory-by-country).
import type {
  AmazonFbaLedgerDbRow,
  ParsedAmazonFbaLedgerRow,
} from "./types";

const UPSERT_BATCH_SIZE = 200;

function dedupeLedgerRowsForUpsert(
  rows: AmazonFbaLedgerDbRow[],
): AmazonFbaLedgerDbRow[] {
  const map = new Map<string, AmazonFbaLedgerDbRow>();

  for (const row of rows) {
    const key = [
      row.sku_original,
      row.fnsku,
      row.asin,
      row.snapshot_date,
      row.disposition,
      row.location,
      row.source,
    ].join("||");

    map.set(key, row);
  }

  return Array.from(map.values());
}

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

export function mapLedgerRowsToDbPayload(params: {
  rows: ParsedAmazonFbaLedgerRow[];
  productoBySku: Map<string, string>;
  source: string;
  sourceFileName: string | null;
}): { dbRows: AmazonFbaLedgerDbRow[]; unlinkedProductRows: number } {
  const now = new Date().toISOString();
  let unlinkedProductRows = 0;

  const dbRows = params.rows.map((row) => {
    const productoId = params.productoBySku.get(row.skuLimpio) ?? null;
    if (!productoId) unlinkedProductRows++;

    return {
      producto_id: productoId,
      sku_original: row.skuOriginal || "",
      sku_limpio: row.skuLimpio,
      fnsku: row.fnsku || "",
      asin: row.asin || "",
      title: row.title,
      snapshot_date: row.snapshotDate,
      disposition: row.disposition || "",
      starting_warehouse_balance: row.startingWarehouseBalance,
      in_transit_between_warehouses: row.inTransitBetweenWarehouses,
      receipts: row.receipts,
      customer_shipments: row.customerShipments,
      customer_returns: row.customerReturns,
      vendor_returns: row.vendorReturns,
      warehouse_transfer_in_out: row.warehouseTransferInOut,
      found: row.found,
      lost: row.lost,
      damaged: row.damaged,
      disposed: row.disposed,
      other_events: row.otherEvents,
      ending_warehouse_balance: row.endingWarehouseBalance,
      unknown_events: row.unknownEvents,
      location: row.location || "",
      location_country: null,
      source: params.source,
      source_file_name: params.sourceFileName,
      raw: row.raw,
      updated_at: now,
    };
  });

  return { dbRows, unlinkedProductRows };
}

export async function upsertAmazonFbaLedgerDailyRows(
  rows: AmazonFbaLedgerDbRow[],
): Promise<number> {
  const dedupedRows = dedupeLedgerRowsForUpsert(rows);
  if (dedupedRows.length === 0) return 0;

  let affected = 0;

  for (let i = 0; i < dedupedRows.length; i += UPSERT_BATCH_SIZE) {
    const batch = dedupedRows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from("amazon_fba_inventory_ledger_daily")
      .upsert(batch, {
        onConflict:
          "sku_original,fnsku,asin,snapshot_date,disposition,location,source",
      });

    if (error) throw new Error(error.message);
    affected += batch.length;
  }

  return affected;
}
