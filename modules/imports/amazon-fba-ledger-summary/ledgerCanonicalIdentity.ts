import { createHash } from "node:crypto";
import type { AmazonFbaLedgerDbRow } from "./types";

export const LEDGER_OPERATIONAL_FIELDS = [
  "starting_warehouse_balance",
  "ending_warehouse_balance",
  "in_transit_between_warehouses",
  "receipts",
  "customer_shipments",
  "customer_returns",
  "vendor_returns",
  "warehouse_transfer_in_out",
  "found",
  "lost",
  "damaged",
  "disposed",
  "other_events",
  "unknown_events",
] as const satisfies readonly (keyof AmazonFbaLedgerDbRow)[];

type OperationalField = (typeof LEDGER_OPERATIONAL_FIELDS)[number];

function normalizedConditionType(row: AmazonFbaLedgerDbRow): string {
  return String(row.condition_type ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
}

function normalizedSkuLimpio(row: AmazonFbaLedgerDbRow): string {
  return String(row.sku_limpio ?? "").trim();
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

export function manualLedgerReportDocumentIdFromContent(content: string): string {
  return `manual:${createHash("sha256").update(content).digest("hex")}`;
}

export function ledgerCanonicalKey(row: AmazonFbaLedgerDbRow): string {
  return [
    row.report_document_id,
    row.fnsku,
    row.asin,
    row.snapshot_date,
    row.disposition,
    row.location,
  ].join("||");
}

export function differingLedgerFields(
  rows: AmazonFbaLedgerDbRow[],
): string[] {
  if (rows.length <= 1) return [];

  const differing: string[] = [];
  for (const field of LEDGER_OPERATIONAL_FIELDS) {
    const values = uniqueValues(rows.map((row) => Number(row[field] ?? 0)));
    if (values.length > 1) differing.push(field);
  }

  const productIds = uniqueValues(
    rows.map((row) => row.producto_id ?? "NULL"),
  );
  if (productIds.length > 1) differing.push("producto_id");

  const conditionTypes = uniqueValues(rows.map(normalizedConditionType));
  if (conditionTypes.length > 1) differing.push("condition_type");

  const informedSkus = uniqueValues(rows.map(normalizedSkuLimpio).filter(Boolean));
  if (informedSkus.length > 1) differing.push("sku_limpio");

  return differing;
}

export function dedupeLedgerRowsForUpsert(
  rows: AmazonFbaLedgerDbRow[],
): AmazonFbaLedgerDbRow[] {
  const map = new Map<string, AmazonFbaLedgerDbRow[]>();

  for (const row of rows) {
    const key = ledgerCanonicalKey(row);
    const group = map.get(key) ?? [];
    group.push(row);
    map.set(key, group);
  }

  const deduped: AmazonFbaLedgerDbRow[] = [];
  for (const [key, group] of Array.from(map.entries())) {
    const differing = differingLedgerFields(group);
    if (differing.length > 0) {
      throw new Error(
        `Inventory Ledger duplicate grain has conflicting fields (${differing.join(", ")}): ${key}`,
      );
    }

    const [first, ...duplicates] = group;
    if (!first) continue;
    deduped.push({
      ...first,
      msku_aliases: Array.from(
        new Set(group.flatMap((row) => row.msku_aliases).filter(Boolean)),
      ),
      raw: {
        ...first.raw,
        duplicatePhysicalRows: duplicates.map((row) => row.raw),
      },
    });
  }

  return deduped;
}
