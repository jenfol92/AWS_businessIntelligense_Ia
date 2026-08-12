import { supabaseAdmin } from "@/server/supabase/adminClient";
// Solo escribe amazon_fba_inventory_ledger_daily.
// La fuente FBA canonica por pais es v_latest_fba_inventory_by_product_country.
// NO actualiza inventario_paises.stock_fba.
import type {
  AmazonFbaLedgerDbRow,
  ParsedAmazonFbaLedgerRow,
} from "./types";
import { dedupeLedgerRowsForUpsert } from "./ledgerCanonicalIdentity";

const UPSERT_BATCH_SIZE = 200;

function normalizeLedgerIdentity(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeLedgerText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeLedgerDisposition(value: string | null | undefined): string {
  return normalizeLedgerIdentity(value) || "UNKNOWN";
}

function normalizeLedgerCountry(value: string | null | undefined): string {
  const normalized = normalizeLedgerIdentity(value) || "UNKNOWN";
  return normalized === "UK" ? "GB" : normalized;
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

export async function loadProductIdsBySkuAndAsin(params: {
  skus: string[];
  asins: string[];
}): Promise<{
  bySku: Map<string, string>;
  byAsin: Map<string, string>;
  skuByProductId: Map<string, string>;
  ambiguousAsins: Set<string>;
}> {
  const bySku = await loadProductIdsBySku(params.skus);
  const byAsin = new Map<string, string>();
  const skuByProductId = new Map<string, string>();
  const ambiguousAsins = new Set<string>();
  const uniqueAsins = Array.from(
    new Set(params.asins.map((asin) => asin.trim()).filter(Boolean)),
  );

  for (let i = 0; i < uniqueAsins.length; i += 500) {
    const chunk = uniqueAsins.slice(i, i + 500);
    const { data, error } = await supabaseAdmin
      .from("productos")
      .select("id, sku, asin")
      .in("asin", chunk);

    if (error) throw new Error(error.message);

    const grouped = new Map<string, string[]>();
    for (const row of data ?? []) {
      const asin = String((row as { asin?: string }).asin ?? "").trim();
      const sku = String((row as { sku?: string }).sku ?? "").trim();
      const id = String((row as { id?: string }).id ?? "").trim();
      if (!asin || !id) continue;
      if (sku) skuByProductId.set(id, sku);
      const list = grouped.get(asin) ?? [];
      list.push(id);
      grouped.set(asin, list);
    }

    for (const [asin, ids] of Array.from(grouped.entries())) {
      const uniqueIds = Array.from(new Set(ids));
      if (uniqueIds.length === 1 && uniqueIds[0]) byAsin.set(asin, uniqueIds[0]);
      else ambiguousAsins.add(asin);
    }
  }

  return { bySku, byAsin, skuByProductId, ambiguousAsins };
}

type ConditionLookupValue = {
  conditionType: string;
  sourceDate: string;
  conflict?: boolean;
  conflictConditionTypes?: string[];
};

export async function loadLatestFbaCountryConditionByIdentity(
  identities: Array<{ fnsku: string | null; asin: string | null }>,
): Promise<Map<string, ConditionLookupValue>> {
  const fnskus = Array.from(
    new Set(identities.map((i) => normalizeLedgerIdentity(i.fnsku)).filter(Boolean)),
  );
  const asins = Array.from(
    new Set(identities.map((i) => normalizeLedgerIdentity(i.asin)).filter(Boolean)),
  );
  const result = new Map<string, ConditionLookupValue>();
  if (fnskus.length === 0 && asins.length === 0) return result;

  const { data, error } = await supabaseAdmin
    .from("fba_country_stock_daily")
    .select("snapshot_date, raw")
    .order("snapshot_date", { ascending: false })
    .limit(5000);

  if (error) {
    if (error.message.includes("fba_country_stock_daily")) return result;
    throw new Error(error.message);
  }

  const wantedFnskus = new Set(fnskus);
  const wantedAsins = new Set(asins);
  const exactCandidates = new Map<string, ConditionLookupValue>();
  const asinConditions = new Map<string, Map<string, ConditionLookupValue>>();

  for (const row of data ?? []) {
    const snapshotDate = String(
      (row as { snapshot_date?: string | null }).snapshot_date ?? "",
    ).slice(0, 10);
    const raw = (row as { raw?: unknown }).raw;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const sources = (raw as { sources?: unknown }).sources;
    if (!Array.isArray(sources)) continue;

    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      const sourceRaw = (source as { raw?: unknown }).raw;
      if (!sourceRaw || typeof sourceRaw !== "object" || Array.isArray(sourceRaw)) {
        continue;
      }
      const record = sourceRaw as Record<string, unknown>;
      const fnsku = normalizeLedgerIdentity(
        String(record["fulfillment-channel-sku"] ?? record.fnsku ?? record.FNSKU ?? ""),
      );
      const asin = normalizeLedgerIdentity(String(record.asin ?? record.ASIN ?? ""));
      const conditionType = String(
        record["condition-type"] ?? record.conditionType ?? record.condition ?? "",
      ).trim().toUpperCase();

      if (!conditionType) continue;
      if (fnsku && wantedFnskus.has(fnsku)) {
        const key = `${fnsku}::${asin}`;
        if (!exactCandidates.has(key)) {
          exactCandidates.set(key, { conditionType, sourceDate: snapshotDate });
        }
      }
      if (asin && wantedAsins.has(asin)) {
        const conditions = asinConditions.get(asin) ?? new Map<string, ConditionLookupValue>();
        if (!conditions.has(conditionType)) {
          conditions.set(conditionType, { conditionType, sourceDate: snapshotDate });
        }
        asinConditions.set(asin, conditions);
      }
    }
  }

  for (const [key, value] of Array.from(exactCandidates.entries())) {
    result.set(key, value);
  }

  for (const [asin, conditions] of Array.from(asinConditions.entries())) {
    const values = Array.from(conditions.values());
    const key = `::${asin}`;
    if (values.length === 1) {
      result.set(key, values[0]);
      continue;
    }

    result.set(key, {
      conditionType: "UNKNOWN",
      sourceDate: values[0]?.sourceDate ?? "",
      conflict: true,
      conflictConditionTypes: values.map((value) => value.conditionType).sort(),
    });
    console.warn("[fba-ledger] ambiguous condition-type by ASIN", {
      asin,
      conditionTypes: values.map((value) => value.conditionType).sort(),
    });
  }

  return result;
}

export function mapLedgerRowsToDbPayload(params: {
  rows: ParsedAmazonFbaLedgerRow[];
  productoBySku: Map<string, string>;
  productoByAsin?: Map<string, string>;
  skuByProductId?: Map<string, string>;
  ambiguousAsins?: Set<string>;
  conditionByIdentity?: Map<string, ConditionLookupValue>;
  source: string;
  sourceFileName: string | null;
  reportDocumentId?: string | null;
}): {
  dbRows: AmazonFbaLedgerDbRow[];
  unlinkedProductRows: number;
  conflictRows: number;
  unknownConditionRows: number;
} {
  const now = new Date().toISOString();
  let unlinkedProductRows = 0;
  let conflictRows = 0;
  let unknownConditionRows = 0;

  const dbRows = params.rows.flatMap((row) => {
    const asin = normalizeLedgerIdentity(row.asin);
    const asinProductId =
      asin && !params.ambiguousAsins?.has(asin)
        ? params.productoByAsin?.get(asin)
        : null;
    const aliasProductIds = Array.from(
      new Set(
        row.mskuAliases
          .map((alias) => params.productoBySku.get(alias) ?? params.productoBySku.get(row.skuLimpio))
          .filter(Boolean) as string[],
      ),
    );
    const skuProductId = params.productoBySku.get(row.skuLimpio) ?? null;
    const candidateIds = Array.from(
      new Set([asinProductId, skuProductId, ...aliasProductIds].filter(Boolean) as string[]),
    );
    if (candidateIds.length > 1) {
      conflictRows++;
      return [];
    }
    const productoId = candidateIds[0] ?? null;
    if (!productoId) unlinkedProductRows++;

    const fnskuKey = normalizeLedgerIdentity(row.fnsku);
    const asinKey = normalizeLedgerIdentity(row.asin);
    const exactCondition = params.conditionByIdentity?.get(`${fnskuKey}::${asinKey}`);
    const fallbackCondition = exactCondition ? null : params.conditionByIdentity?.get(`::${asinKey}`);
    const conditionLookup = exactCondition ?? fallbackCondition;
    const conditionType =
      normalizeLedgerIdentity(row.conditionType) ||
      conditionLookup?.conditionType ||
      null;
    if (!conditionType || conditionType === "UNKNOWN" || conditionLookup?.conflict) {
      unknownConditionRows++;
    }

    const skuLimpio =
      productoId && params.skuByProductId?.get(productoId)
        ? params.skuByProductId.get(productoId)!
        : row.skuLimpio;

    return [{
      producto_id: productoId,
      sku_original: normalizeLedgerText(row.skuOriginal),
      msku_aliases: Array.from(
        new Set(row.mskuAliases.map(normalizeLedgerText).filter(Boolean)),
      ),
      sku_limpio: skuLimpio,
      fnsku: normalizeLedgerIdentity(row.fnsku),
      asin,
      condition_type: conditionType,
      title: row.title,
      snapshot_date: row.snapshotDate,
      disposition: normalizeLedgerDisposition(row.disposition),
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
      location: normalizeLedgerCountry(row.location),
      location_country: null,
      source: params.source,
      source_file_name: params.sourceFileName,
      report_document_id: params.reportDocumentId ?? params.sourceFileName ?? "",
      raw: {
        ...row.raw,
        msku_aliases: row.mskuAliases,
        condition_type_resolved: conditionType,
        condition_source_date: conditionLookup?.sourceDate ?? null,
        condition_conflict: conditionLookup?.conflict === true,
        condition_conflict_types: conditionLookup?.conflictConditionTypes ?? [],
        match_by_asin: asinProductId != null,
        match_alias_product_ids: aliasProductIds,
      },
      updated_at: now,
    }];
  });

  return { dbRows, unlinkedProductRows, conflictRows, unknownConditionRows };
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
          "report_document_id,fnsku,asin,snapshot_date,disposition,location",
      });

    if (error) throw new Error(error.message);
    affected += batch.length;
  }

  return affected;
}
