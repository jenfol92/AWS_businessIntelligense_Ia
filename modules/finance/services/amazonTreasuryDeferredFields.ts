import type { FinancesTransaction } from "../../amazon-sp-api/financesClient";
import type { AmazonTreasuryObservation } from "../repositories/amazonFinancialPlanningSyncRepository";
import { valueAmazonAmountEur as eurAmounts, type EcbFxTable } from "./ecbFxService.ts";
import {
  materialKey,
  resolveObservationMarketplace,
  signals,
  transactionFields,
} from "./amazonTreasuryObservationCore.ts";

export const DEFERRED_RELATED_IDENTIFIER_NAMES = ["ORDER_ID", "REFUND_ID", "SHIPMENT_ID"] as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function relatedIdentifierRows(transaction: FinancesTransaction) {
  const t = record(transaction);
  const rows = [...(Array.isArray(t.relatedIdentifiers) ? t.relatedIdentifiers : [])];
  for (const item of Array.isArray(t.items) ? t.items : []) {
    rows.push(...(Array.isArray(record(item).relatedIdentifiers) ? (record(item).relatedIdentifiers as unknown[]) : []));
  }
  return rows;
}

export function extractDeferredContext(transaction: FinancesTransaction) {
  const scan = (contexts: unknown) => {
    if (!Array.isArray(contexts)) return null;
    for (const raw of contexts) {
      const ctx = record(raw);
      if (ctx.contextType === "DeferredContext" || ctx.deferralReason != null || ctx.maturityDate != null) {
        return {
          deferralReason: typeof ctx.deferralReason === "string" ? ctx.deferralReason : null,
          maturityDate: typeof ctx.maturityDate === "string" ? ctx.maturityDate : null,
        };
      }
    }
    return null;
  };
  const t = record(transaction);
  return (
    scan(t.contexts) ??
    (Array.isArray(t.items) ? t.items.map((item) => scan(record(item).contexts)).find(Boolean) : null) ?? {
      deferralReason: null,
      maturityDate: null,
    }
  );
}

export function extractUsefulRelatedIdentifiers(transaction: FinancesTransaction): Record<string, string> {
  const allowed = new Set<string>(DEFERRED_RELATED_IDENTIFIER_NAMES);
  const out: Record<string, string> = {};
  for (const raw of relatedIdentifierRows(transaction)) {
    const row = record(raw);
    const name =
      typeof row.relatedIdentifierName === "string"
        ? row.relatedIdentifierName
        : typeof row.itemRelatedIdentifierName === "string"
          ? row.itemRelatedIdentifierName
          : null;
    const value =
      typeof row.relatedIdentifierValue === "string"
        ? row.relatedIdentifierValue
        : typeof row.itemRelatedIdentifierValue === "string"
          ? row.itemRelatedIdentifierValue
          : null;
    if (!name || !value || !allowed.has(name)) continue;
    out[name] = value;
  }
  return out;
}

export function parseAmazonPostedAt(transaction: FinancesTransaction) {
  const posted = record(transaction).postedDate;
  return typeof posted === "string" && posted.length > 0 ? posted : null;
}

export function parseAmazonReleaseDate(maturityDate: string | null) {
  if (!maturityDate) return null;
  const day = maturityDate.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function buildDeferredTreasuryObservation(
  transaction: FinancesTransaction,
  now: Date,
  ecb?: EcbFxTable | null,
): AmazonTreasuryObservation | null {
  const value = transactionFields(transaction);
  if (!value.id || !value.currency || !Number.isFinite(value.amount)) return null;
  const marketplace = resolveObservationMarketplace([transaction]);
  const fx = eurAmounts(value.currency, value.amount, undefined, ecb);
  const deferred = extractDeferredContext(transaction);
  const relatedIdentifiers = extractUsefulRelatedIdentifiers(transaction);
  const amazonPostedAt = parseAmazonPostedAt(transaction);
  const amazonReleaseDate = parseAmazonReleaseDate(deferred.maturityDate);
  const amazonTransactionType =
    typeof record(transaction).transactionType === "string" ? String(record(transaction).transactionType) : null;
  const material = {
    amount: value.amount,
    currency: value.currency,
    marketplace,
    transactionStatus: "DEFERRED",
    transactionType: amazonTransactionType,
    deferralReason: deferred.deferralReason,
    releaseDate: amazonReleaseDate,
  };
  return {
    observationKey: materialKey("DEFERRED", value.id, now.toISOString(), material),
    sourceKey: `amazon-transaction:${value.id}`,
    marketplace,
    economicState: "DEFERRED",
    observedAt: now.toISOString(),
    originalCurrency: value.currency,
    originalAmount: value.amount,
    ...fx,
    amazonTransactionId: value.id,
    transactionStatus: "DEFERRED",
    amazonTransactionType,
    amazonPostedAt,
    amazonReleaseDate,
    amazonDeferralReason: deferred.deferralReason,
    expectedAvailabilityDate: null,
    expectedRequestDate: null,
    expectedBankDate: null,
    confidence: "unavailable",
    estimationMethod: amazonReleaseDate
      ? "observed_deferred_transaction_with_amazon_release_date"
      : "observed_deferred_transaction_awaiting_release_evidence",
    source: "amazon_sp_api_finances",
    evidence: {
      amazonTransactionId: value.id,
      transactionStatus: "DEFERRED",
      marketplaceSignals: Array.from(signals(transaction)).sort(),
      relatedIdentifiers,
    },
  };
}
