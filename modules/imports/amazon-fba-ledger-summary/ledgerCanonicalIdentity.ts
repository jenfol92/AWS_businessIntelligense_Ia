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

export function manualLedgerDocumentHashFromContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function resolveLedgerDocumentIdentity(params: {
  reportDocumentId?: string | null;
  text: string;
}) {
  const explicit = params.reportDocumentId?.trim();
  if (explicit) {
    return {
      reportDocumentId: explicit,
      manualDocumentHash: null,
      documentIdentityType: "REPORT_DOCUMENT_ID" as const,
      documentIdentity: `report:${explicit}`,
    };
  }
  const manualDocumentHash = manualLedgerDocumentHashFromContent(params.text);
  return {
    reportDocumentId: null,
    manualDocumentHash,
    documentIdentityType: "MANUAL_SHA256" as const,
    documentIdentity: manualLedgerReportDocumentIdFromContent(params.text),
  };
}

export function ledgerCanonicalKey(row: AmazonFbaLedgerDbRow): string {
  if (!row.document_identity.trim()) {
    throw new Error("LEDGER_DOCUMENT_CONFLICT: document_identity is required");
  }
  const missing = [
    ["asin", row.asin],
    ["fnsku", row.fnsku],
    ["location_raw", row.location_raw],
  ].filter(([, value]) => !String(value ?? "").trim());
  if (missing.length > 0) {
    throw new Error(
      `LEDGER_IDENTITY_CONFLICT: missing ${missing.map(([field]) => field).join(", ")}`,
    );
  }
  return [
    row.document_identity,
    row.snapshot_date,
    row.asin,
    row.fnsku,
    row.location_raw,
    row.disposition,
    normalizedConditionType(row),
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
      throw new Error(`LEDGER_IDENTITY_CONFLICT (${differing.join(", ")}): ${key}`);
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

const LEDGER_DOCUMENT_FIELDS = [
  "document_identity_type",
  "report_document_id",
  "manual_document_hash",
] as const satisfies readonly (keyof AmazonFbaLedgerDbRow)[];

function differingDocumentFields(
  incoming: AmazonFbaLedgerDbRow,
  persisted: AmazonFbaLedgerDbRow,
): string[] {
  return LEDGER_DOCUMENT_FIELDS.filter(
    (field) => String(incoming[field] ?? "") !== String(persisted[field] ?? ""),
  );
}

/**
 * Reconciles one import with rows already stored for the same document.
 * Exact replays are omitted, new aliases are merged, and any quantitative or
 * document-identity disagreement fails closed before PostgREST can upsert it.
 */
export function prepareLedgerRowsAgainstPersisted(
  incomingRows: AmazonFbaLedgerDbRow[],
  persistedRows: AmazonFbaLedgerDbRow[],
): AmazonFbaLedgerDbRow[] {
  const incoming = dedupeLedgerRowsForUpsert(incomingRows);
  const persistedByKey = new Map(
    persistedRows.map((row) => [ledgerCanonicalKey(row), row]),
  );

  return incoming.flatMap((row) => {
    const key = ledgerCanonicalKey(row);
    const persisted = persistedByKey.get(key);
    if (!persisted) return [row];

    const documentDifferences = differingDocumentFields(row, persisted);
    if (documentDifferences.length > 0) {
      throw new Error(
        `LEDGER_DOCUMENT_CONFLICT (${documentDifferences.join(", ")}): ${key}`,
      );
    }

    const quantitativeDifferences = differingLedgerFields([persisted, row]);
    if (quantitativeDifferences.length > 0) {
      throw new Error(
        `LEDGER_IDENTITY_CONFLICT (${quantitativeDifferences.join(", ")}): ${key}`,
      );
    }

    const aliases = Array.from(
      new Set([...persisted.msku_aliases, ...row.msku_aliases].filter(Boolean)),
    );
    const aliasesChanged =
      aliases.length !== persisted.msku_aliases.length ||
      aliases.some((alias) => !persisted.msku_aliases.includes(alias));

    if (!aliasesChanged) return [];
    return [{
      ...persisted,
      msku_aliases: aliases,
      raw: {
        ...persisted.raw,
        additionalAliasProvenance: row.raw,
      },
      updated_at: row.updated_at,
    }];
  });
}
