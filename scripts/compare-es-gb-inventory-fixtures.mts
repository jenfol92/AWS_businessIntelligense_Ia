import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const [{ loadConfirmedOperationalAmazonIdentities }, { inventoryIdentityKey, resolveProductMatchesBySku }] = await Promise.all([
  import("../modules/amazon-sp-api/operationalAmazonIdentityRepository.ts"),
  import("../modules/amazon-sp-api/skuProductMatching.ts"),
]);

type RawObservation = Record<string, any> & { marketplaceId: string };
const directory = resolve("modules/amazon-sp-api/fixtures/es-gb-comparison-20260820");

async function loadSide(prefix: "es" | "gb"): Promise<RawObservation[]> {
  const rows: RawObservation[] = [];
  for (let batch = 1; batch <= 3; batch += 1) {
    const fixture = JSON.parse(await readFile(resolve(directory, `${prefix}-batch-${batch}.json`), "utf8"));
    for (const row of fixture.inventorySummaries) rows.push({ ...row, marketplaceId: fixture.marketplaceId });
  }
  return rows;
}

const [esRows, gbRows, operationalIdentities] = await Promise.all([
  loadSide("es"),
  loadSide("gb"),
  loadConfirmedOperationalAmazonIdentities(),
]);
const allRows = [...esRows, ...gbRows];
const matches = await resolveProductMatchesBySku(
  allRows.map((row) => ({ sellerSku: row.sellerSku, asin: row.asin })),
  { operationalIdentities },
);

const quantity = (row: RawObservation) => ({
  fulfillable: Number(row.inventoryDetails?.fulfillableQuantity ?? 0),
  reserved: Number(row.inventoryDetails?.reservedQuantity?.totalReservedQuantity ?? 0),
  inboundWorking: Number(row.inventoryDetails?.inboundWorkingQuantity ?? 0),
  inboundShipped: Number(row.inventoryDetails?.inboundShippedQuantity ?? 0),
  inboundReceiving: Number(row.inventoryDetails?.inboundReceivingQuantity ?? 0),
  unfulfillable: Number(row.inventoryDetails?.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0),
  researching: Number(row.inventoryDetails?.researchingQuantity?.totalResearchingQuantity ?? 0),
  totalQuantity: Number(row.totalQuantity ?? 0),
});
const signature = (row: RawObservation) => JSON.stringify({ ...quantity(row), condition: row.condition ?? null });

type PhysicalRow = ReturnType<typeof quantity> & {
  producto_id: string;
  sku_limpio: string;
  asin: string;
  fnsku: string;
  sellerSkus: string[];
  condition: string | null;
  amazon_last_updated_time: string[];
};

function resolveSide(rows: RawObservation[]) {
  const groups = new Map<string, Array<{ row: RawObservation; producto_id: string; sku_limpio: string }>>();
  const excluded: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const match = matches.get(inventoryIdentityKey(String(row.sellerSku ?? ""), row.asin));
    if (!match?.productoId || match.resolutionStatus === "ASIN_IDENTITY_CONFLICT" || match.resolutionStatus === "IDENTITY_AMBIGUOUS") {
      excluded.push({ sellerSku: row.sellerSku, asin: row.asin, fnsku: row.fnSku, status: match?.resolutionStatus ?? "IDENTITY_INCOMPLETE" });
      continue;
    }
    const key = `${match.productoId}|${String(row.asin).toUpperCase()}|${String(row.fnSku).toUpperCase()}`;
    const group = groups.get(key) ?? [];
    group.push({ row, producto_id: match.productoId, sku_limpio: match.skuLimpio ?? String(row.sellerSku) });
    groups.set(key, group);
  }

  const physical = new Map<string, PhysicalRow>();
  const conflicts: Array<Record<string, unknown>> = [];
  for (const [key, group] of groups) {
    const signatures = new Set(group.map(({ row }) => signature(row)));
    if (signatures.size !== 1) {
      conflicts.push({ key, sellerSkus: group.map(({ row }) => row.sellerSku), signatures: [...signatures] });
      continue;
    }
    const first = group[0];
    physical.set(key, {
      producto_id: first.producto_id,
      sku_limpio: first.sku_limpio,
      asin: String(first.row.asin).toUpperCase(),
      fnsku: String(first.row.fnSku).toUpperCase(),
      sellerSkus: [...new Set(group.map(({ row }) => String(row.sellerSku)))].sort(),
      condition: first.row.condition ?? null,
      amazon_last_updated_time: [...new Set(group.map(({ row }) => String(row.lastUpdatedTime ?? "")).filter(Boolean))].sort(),
      ...quantity(first.row),
    });
  }
  return { physical, conflicts, excluded };
}

const es = resolveSide(esRows);
const gb = resolveSide(gbRows);
const shared: Array<Record<string, unknown>> = [];
const panEuOnly: PhysicalRow[] = [];
const gbOnly: PhysicalRow[] = [];
const quantityFields = ["fulfillable", "reserved", "inboundWorking", "inboundShipped", "inboundReceiving", "unfulfillable", "researching", "totalQuantity"] as const;

for (const [key, esRow] of es.physical) {
  const gbRow = gb.physical.get(key);
  if (!gbRow) {
    panEuOnly.push(esRow);
    continue;
  }
  shared.push({
    sku_limpio: esRow.sku_limpio,
    producto_id: esRow.producto_id,
    asin: esRow.asin,
    fnsku: esRow.fnsku,
    ES_sellerSkus: esRow.sellerSkus,
    GB_sellerSkus: gbRow.sellerSkus,
    ES_quantities: Object.fromEntries(quantityFields.map((field) => [field, esRow[field]])),
    GB_quantities: Object.fromEntries(quantityFields.map((field) => [field, gbRow[field]])),
    ES_lastUpdatedTime: esRow.amazon_last_updated_time,
    GB_lastUpdatedTime: gbRow.amazon_last_updated_time,
    QUANTITIES_IDENTICAL: quantityFields.every((field) => esRow[field] === gbRow[field]),
  });
}
for (const [key, row] of gb.physical) if (!es.physical.has(key)) gbOnly.push(row);

const controlAsin = "B0DJBQGKBT";
const controlEs = [...es.physical.values()].filter((row) => row.asin === controlAsin);
const controlGb = [...gb.physical.values()].filter((row) => row.asin === controlAsin);
const result = {
  identityResolutionMode: "BULK_IN_MEMORY",
  operationalIdentityCount: operationalIdentities.length,
  esRawRows: esRows.length,
  gbRawRows: gbRows.length,
  esExcluded: es.excluded,
  gbExcluded: gb.excluded,
  esConflicts: es.conflicts,
  gbConflicts: gb.conflicts,
  comparisonValid: es.excluded.length === 0 && gb.excluded.length === 0 && es.conflicts.length === 0 && gb.conflicts.length === 0,
  shared,
  panEuOnly,
  gbOnly,
  control: {
    asin: controlAsin,
    sku_limpio: "8436616610104",
    ES_FNSKUS: controlEs.map((row) => row.fnsku).sort(),
    GB_FNSKUS: controlGb.map((row) => row.fnsku).sort(),
    SHARED_FNSKUS: controlEs.filter((row) => controlGb.some((candidate) => candidate.fnsku === row.fnsku && candidate.producto_id === row.producto_id)).map((row) => row.fnsku).sort(),
    PAN_EU_ONLY_FNSKUS: controlEs.filter((row) => !controlGb.some((candidate) => candidate.fnsku === row.fnsku && candidate.producto_id === row.producto_id)).map((row) => row.fnsku).sort(),
    GB_ONLY_FNSKUS: controlGb.filter((row) => !controlEs.some((candidate) => candidate.fnsku === row.fnsku && candidate.producto_id === row.producto_id)).map((row) => row.fnsku).sort(),
    ES_FULFILLABLE: controlEs.reduce((sum, row) => sum + row.fulfillable, 0),
    GB_FULFILLABLE: controlGb.reduce((sum, row) => sum + row.fulfillable, 0),
  },
};

await writeFile(resolve(directory, "comparison-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  comparisonValid: result.comparisonValid,
  operationalIdentityCount: result.operationalIdentityCount,
  esRawRows: result.esRawRows,
  gbRawRows: result.gbRawRows,
  esExcluded: result.esExcluded.length,
  gbExcluded: result.gbExcluded.length,
  esConflicts: result.esConflicts.length,
  gbConflicts: result.gbConflicts.length,
  shared: result.shared.length,
  panEuOnly: result.panEuOnly.length,
  gbOnly: result.gbOnly.length,
  identical: result.shared.filter((row) => row.QUANTITIES_IDENTICAL).length,
  different: result.shared.filter((row) => !row.QUANTITIES_IDENTICAL).length,
  control: result.control,
}, null, 2));
