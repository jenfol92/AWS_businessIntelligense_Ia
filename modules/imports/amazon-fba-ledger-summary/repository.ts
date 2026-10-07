import { readLedgerPages } from "./ledgerPagination.ts";
import { supabaseAdmin } from "@/server/supabase/adminClient";
// Solo escribe amazon_fba_inventory_ledger_daily.
// La fuente FBA canonica por pais es v_latest_fba_inventory_by_product_country.
// NO actualiza inventario_paises.stock_fba.
import type {
  AmazonFbaLedgerDbRow,
  ParsedAmazonFbaLedgerRow,
} from "./types";
import {
  dedupeLedgerRowsForUpsert,
  prepareLedgerRowsAgainstPersisted,
} from "./ledgerCanonicalIdentity";
import {
  classifyLedgerLocation,
  type LedgerLocationEvidence,
} from "./ledgerLocationContract";

const UPSERT_BATCH_SIZE = 200;

export async function loadLedgerLocationEvidence(signal?: AbortSignal): Promise<LedgerLocationEvidence> {
  const [countries, inbound] = await Promise.all([
    readLedgerPages((from,to)=>supabaseAdmin.from("paises").select("code").eq("activo",true).order("code").range(from,to).abortSignal(signal),signal),
    readLedgerPages((from,to)=>supabaseAdmin.from("amazon_inbound_shipments").select("destination_center,destination_country").not("destination_center","is",null).order("shipment_id").range(from,to).abortSignal(signal),signal),
  ]);

  const knownCountryCodes = new Set(
    (countries ?? []).map((row) => normalizeLedgerIdentity((row as { code?: string }).code)).filter(Boolean),
  );
  const centers = new Set<string>();
  const countriesByCenter = new Map<string, Set<string>>();
  for (const row of inbound ?? []) {
    const center = normalizeLedgerIdentity(
      (row as { destination_center?: string | null }).destination_center,
    );
    if (!center) continue;
    centers.add(center);
    const country = normalizeLedgerIdentity(
      (row as { destination_country?: string | null }).destination_country,
    );
    if (!country) continue;
    const values = countriesByCenter.get(center) ?? new Set<string>();
    values.add(country);
    countriesByCenter.set(center, values);
  }
  const physicalCountryByCenter = new Map<string, string>();
  const evidenceSourceByCenter = new Map<string, string>();
  for (const center of Array.from(centers)) {
    const values = Array.from(countriesByCenter.get(center) ?? []);
    if (values.length === 1 && values[0]) physicalCountryByCenter.set(center, values[0]);
    evidenceSourceByCenter.set(center, "INBOUND_DESTINATION");
  }
  return {
    knownCountryCodes,
    fulfillmentCenters: centers,
    physicalCountryByCenter,
    evidenceSourceByCenter,
  };
}

function normalizeLedgerIdentity(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeLedgerText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeLedgerDisposition(value: string | null | undefined): string {
  return normalizeLedgerIdentity(value) || "UNKNOWN";
}

export async function loadProductIdsBySku(
  skus: string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;

  const uniqueSkus = Array.from(new Set(skus));

  for (let i = 0; i < uniqueSkus.length; i += 500) {
    const chunk = uniqueSkus.slice(i, i + 500);
    const data = await readLedgerPages((from,to)=>supabaseAdmin.from("productos").select("id,sku").in("sku",chunk).order("id").range(from,to).abortSignal(signal),signal);

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
  fnskus?: string[];
  signal?: AbortSignal;
}): Promise<{
  bySku: Map<string, string>;
  byAsin: Map<string, string>;
  byFnsku: Map<string, string>;
  byExistingAlias: Map<string, string>;
  skuByProductId: Map<string, string>;
  ambiguousAsins: Set<string>;
  ambiguousFnskus: Set<string>;
  ambiguousAliases: Set<string>;
}> {
  const bySku = await loadProductIdsBySku(params.skus, params.signal);
  const byAsin = new Map<string, string>();
  const skuByProductId = new Map<string, string>();
  const ambiguousAsins = new Set<string>();
  const byFnsku = new Map<string, string>();
  const byExistingAlias = new Map<string, string>();
  const ambiguousFnskus = new Set<string>();
  const ambiguousAliases = new Set<string>();
  const uniqueAsins = Array.from(
    new Set(params.asins.map((asin) => asin.trim()).filter(Boolean)),
  );

  for (let i = 0; i < uniqueAsins.length; i += 500) {
    const chunk = uniqueAsins.slice(i, i + 500);
    const data = await readLedgerPages((from,to)=>supabaseAdmin.from("productos").select("id,sku,asin").in("asin",chunk).order("id").range(from,to).abortSignal(params.signal),params.signal);

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

  const uniqueFnskus = Array.from(
    new Set((params.fnskus ?? []).map(normalizeLedgerIdentity).filter(Boolean)),
  );
  const historicalRows: Array<{
    producto_id?: string | null;
    fnsku?: string | null;
    sku_original?: string | null;
    sku_limpio?: string | null;
    msku_aliases?: string[] | null;
  }> = [];
  for (let i = 0; i < uniqueFnskus.length; i += 500) {
    const data = await readLedgerPages((from,to)=>supabaseAdmin
      .from("amazon_fba_inventory_ledger_daily").select("producto_id,fnsku,sku_original,sku_limpio,msku_aliases")
      .not("producto_id","is",null).in("fnsku",uniqueFnskus.slice(i,i+500)).order("id").range(from,to).abortSignal(params.signal),params.signal);
    historicalRows.push(...((data ?? []) as typeof historicalRows));
  }
  const collectUnique = (
    target: Map<string, string>,
    ambiguous: Set<string>,
    key: string,
    productId: string,
  ) => {
    if (!key || !productId || ambiguous.has(key)) return;
    const existing = target.get(key);
    if (existing && existing !== productId) {
      target.delete(key);
      ambiguous.add(key);
      return;
    }
    target.set(key, productId);
  };
  for (const row of historicalRows) {
    const productId = normalizeLedgerText(row.producto_id);
    if (!productId) continue;
    collectUnique(byFnsku, ambiguousFnskus, normalizeLedgerIdentity(row.fnsku), productId);
    for (const alias of [row.sku_original, row.sku_limpio, ...(row.msku_aliases ?? [])]) {
      collectUnique(
        byExistingAlias,
        ambiguousAliases,
        normalizeLedgerIdentity(alias),
        productId,
      );
    }
  }

  return {
    bySku,
    byAsin,
    byFnsku,
    byExistingAlias,
    skuByProductId,
    ambiguousAsins,
    ambiguousFnskus,
    ambiguousAliases,
  };
}

type ConditionLookupValue = {
  conditionType: string;
  sourceDate: string;
  conflict?: boolean;
  conflictConditionTypes?: string[];
};

export async function loadLatestFbaCountryConditionByIdentity(
  identities: Array<{ fnsku: string | null; asin: string | null }>,
  signal?: AbortSignal,
): Promise<Map<string, ConditionLookupValue>> {
  const fnskus = Array.from(
    new Set(identities.map((i) => normalizeLedgerIdentity(i.fnsku)).filter(Boolean)),
  );
  const asins = Array.from(
    new Set(identities.map((i) => normalizeLedgerIdentity(i.asin)).filter(Boolean)),
  );
  const result = new Map<string, ConditionLookupValue>();
  if (fnskus.length === 0 && asins.length === 0) return result;

  const data = await readLedgerPages((from,to)=>supabaseAdmin.from("fba_country_stock_daily")
    .select("snapshot_date,raw").order("snapshot_date",{ascending:false}).order("id").range(from,to).abortSignal(signal),signal);

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
  productoByFnsku?: Map<string, string>;
  productoByExistingAlias?: Map<string, string>;
  skuByProductId?: Map<string, string>;
  ambiguousAsins?: Set<string>;
  ambiguousFnskus?: Set<string>;
  ambiguousAliases?: Set<string>;
  conditionByIdentity?: Map<string, ConditionLookupValue>;
  source: string;
  sourceFileName: string | null;
  reportDocumentId: string | null;
  manualDocumentHash: string | null;
  documentIdentityType: "REPORT_DOCUMENT_ID" | "MANUAL_SHA256";
  documentIdentity: string;
  locationEvidence?: LedgerLocationEvidence;
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
    const fnsku = normalizeLedgerIdentity(row.fnsku);
    const fnskuProductId =
      fnsku && !params.ambiguousFnskus?.has(fnsku)
        ? params.productoByFnsku?.get(fnsku)
        : null;
    const aliasProductIds = Array.from(
      new Set(
        row.mskuAliases
          .map((alias) => params.productoBySku.get(alias))
          .filter(Boolean) as string[],
      ),
    );
    const skuProductId = params.productoBySku.get(row.skuLimpio) ?? null;
    const existingAliasProductIds = Array.from(
      new Set(
        row.mskuAliases
          .map((alias) => normalizeLedgerIdentity(alias))
          .filter((alias) => !params.ambiguousAliases?.has(alias))
          .map((alias) => params.productoByExistingAlias?.get(alias))
          .filter(Boolean) as string[],
      ),
    );
    const candidateIds = Array.from(
      new Set([
        asinProductId,
        fnskuProductId,
        skuProductId,
        ...aliasProductIds,
        ...existingAliasProductIds,
      ].filter(Boolean) as string[]),
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
    const storedConditionType = conditionType || "UNKNOWN";
    if (!conditionType || conditionType === "UNKNOWN" || conditionLookup?.conflict) {
      unknownConditionRows++;
    }

    const skuLimpio =
      productoId && params.skuByProductId?.get(productoId)
        ? params.skuByProductId.get(productoId)!
        : row.skuLimpio;
    const location = classifyLedgerLocation(row.location, params.locationEvidence);
    const matchedBy = productoId == null
      ? null
      : asinProductId === productoId && fnskuProductId === productoId
        ? "ASIN_FNSKU"
        : fnskuProductId === productoId
          ? "FNSKU_UNIQUE"
          : asinProductId === productoId
            ? "ASIN_UNIQUE"
            : existingAliasProductIds.includes(productoId)
              ? "EXISTING_ALIAS"
              : aliasProductIds.includes(productoId)
                ? "SELLER_SKU_EXACT"
                : skuProductId === productoId
                  ? "SELLER_SKU_NORMALIZED"
                  : null;

    return [{
      producto_id: productoId,
      sku_original: normalizeLedgerText(row.skuOriginal),
      msku_aliases: Array.from(
        new Set(row.mskuAliases.map(normalizeLedgerText).filter(Boolean)),
      ),
      sku_limpio: skuLimpio,
      fnsku: normalizeLedgerIdentity(row.fnsku),
      asin,
      condition_type: storedConditionType,
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
      // `location` remains populated for temporary compatibility. It contains
      // the same non-destructive Amazon value as `location_raw`.
      location: location.locationRaw,
      location_raw: location.locationRaw,
      location_type: location.locationType,
      physical_country: location.physicalCountry,
      location_evidence_source: location.evidenceSource,
      location_evidence_confidence: location.evidenceConfidence,
      location_country: location.physicalCountry,
      source: params.source,
      source_file_name: params.sourceFileName,
      report_document_id: params.reportDocumentId,
      manual_document_hash: params.manualDocumentHash,
      document_identity_type: params.documentIdentityType,
      document_identity: params.documentIdentity,
      raw: {
        ...row.raw,
        msku_aliases: row.mskuAliases,
        condition_type_resolved: storedConditionType,
        condition_source_date: conditionLookup?.sourceDate ?? null,
        condition_conflict: conditionLookup?.conflict === true,
        condition_conflict_types: conditionLookup?.conflictConditionTypes ?? [],
        location_classification: location,
        match_by_asin: asinProductId != null,
        match_alias_product_ids: aliasProductIds,
        matched_by: matchedBy,
        match_candidates: candidateIds,
        match_ambiguous: candidateIds.length > 1,
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

  const documentIdentities = Array.from(
    new Set(dedupedRows.map((row) => row.document_identity)),
  );
  const persisted = await readLedgerPages((from,to)=>supabaseAdmin.from("amazon_fba_inventory_ledger_daily")
    .select("*").in("document_identity", documentIdentities).order("id").range(from,to));

  const rowsToWrite = prepareLedgerRowsAgainstPersisted(
    dedupedRows,
    (persisted ?? []) as AmazonFbaLedgerDbRow[],
  );
  if (rowsToWrite.length === 0) return 0;

  let affected = 0;

  for (let i = 0; i < rowsToWrite.length; i += UPSERT_BATCH_SIZE) {
    const batch = rowsToWrite.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from("amazon_fba_inventory_ledger_daily")
      .upsert(batch, {
        onConflict:
          "document_identity,snapshot_date,asin,fnsku,location_raw,disposition,condition_type",
      });

    if (error) throw new Error(error.message);
    affected += batch.length;
  }

  return affected;
}

export async function countLedgerRowsByDocumentIdentity(
  documentIdentity: string,
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("amazon_fba_inventory_ledger_daily")
    .select("id", { count: "exact", head: true })
    .eq("document_identity", documentIdentity);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
