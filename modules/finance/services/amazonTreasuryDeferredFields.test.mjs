import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDeferredTreasuryObservation,
  extractDeferredContext,
  extractUsefulRelatedIdentifiers,
  parseAmazonReleaseDate,
} from "./amazonTreasuryDeferredFields.ts";
import { groupObservation } from "./amazonTreasuryGroupObservation.ts";

const NOW = new Date("2026-09-15T10:00:00.000Z");

function deferredTx(overrides = {}) {
  return {
    transactionId: "amzn-tx-shipment-1",
    transactionType: "Shipment",
    transactionStatus: "DEFERRED",
    description: "Order Payment",
    postedDate: "2026-09-15T06:19:34Z",
    totalAmount: { currencyCode: "EUR", currencyAmount: 31.04 },
    marketplaceDetails: { marketplaceId: "A13V1IB3VIYZZH", marketplaceName: "Amazon.fr" },
    relatedIdentifiers: [
      { relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: "402-1234567-8901234" },
      { relatedIdentifierName: "SHIPMENT_ID", relatedIdentifierValue: "shp-1" },
      { relatedIdentifierName: "FINANCIAL_EVENT_GROUP_ID", relatedIdentifierValue: "grp-1" },
      { relatedIdentifierName: "SETTLEMENT_ID", relatedIdentifierValue: "set-1" },
    ],
    contexts: [{ contextType: "DeferredContext", deferralReason: "DD7", maturityDate: "2026-09-24T18:00:00Z" }],
    ...overrides,
  };
}

test("DEFERRED Shipment with DD7 and maturityDate is preserved in columns and evidence", () => {
  const item = buildDeferredTreasuryObservation(deferredTx(), NOW);
  assert.ok(item);
  assert.equal(item.economicState, "DEFERRED");
  assert.equal(item.amazonTransactionType, "Shipment");
  assert.equal(item.amazonPostedAt, "2026-09-15T06:19:34Z");
  assert.equal(item.amazonDeferralReason, "DD7");
  assert.equal(item.amazonReleaseDate, "2026-09-24");
  assert.equal(item.estimationMethod, "observed_deferred_transaction_with_amazon_release_date");
  assert.equal(item.expectedAvailabilityDate, null);
  assert.equal(item.expectedRequestDate, null);
  assert.equal(item.expectedBankDate, null);
  assert.deepEqual(item.evidence.relatedIdentifiers, {
    ORDER_ID: "402-1234567-8901234",
    SHIPMENT_ID: "shp-1",
  });
  assert.doesNotMatch(JSON.stringify(item.evidence), /breakdownType|"description"/);
});

test("DEFERRED Refund negative keeps type, amount and maturityDate", () => {
  const item = buildDeferredTreasuryObservation(
    deferredTx({
      transactionId: "amzn-tx-refund-1",
      transactionType: "Refund",
      description: "Refund",
      postedDate: "2026-09-14T18:50:40Z",
      totalAmount: { currencyCode: "EUR", currencyAmount: -42.39 },
      marketplaceDetails: { marketplaceId: "A1PA6795UKMFR9", marketplaceName: "Amazon.de" },
      relatedIdentifiers: [
        { relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: "305-9999999-1111111" },
        { relatedIdentifierName: "REFUND_ID", relatedIdentifierValue: "rfnd-1" },
      ],
      contexts: [{ contextType: "DeferredContext", deferralReason: "DD7", maturityDate: "2026-09-17T10:56:44Z" }],
    }),
    NOW,
  );
  assert.ok(item);
  assert.equal(item.amazonTransactionType, "Refund");
  assert.equal(item.originalAmount, -42.39);
  assert.equal(item.amazonReleaseDate, "2026-09-17");
  assert.equal(item.evidence.relatedIdentifiers.REFUND_ID, "rfnd-1");
});

test("B2B deferralReason is preserved without enum assumptions", () => {
  const item = buildDeferredTreasuryObservation(
    deferredTx({
      transactionType: "RemovalShipment",
      contexts: [{ contextType: "DeferredContext", deferralReason: "B2B", maturityDate: "2026-11-13T06:40:31Z" }],
    }),
    NOW,
  );
  assert.ok(item);
  assert.equal(item.amazonTransactionType, "RemovalShipment");
  assert.equal(item.amazonDeferralReason, "B2B");
  assert.equal(item.amazonReleaseDate, "2026-11-13");
});

test("missing maturityDate does not invent amazon_release_date", () => {
  const item = buildDeferredTreasuryObservation(
    deferredTx({ contexts: [{ contextType: "DeferredContext", deferralReason: "DD7" }] }),
    NOW,
  );
  assert.ok(item);
  assert.equal(item.amazonReleaseDate, null);
  assert.equal(item.estimationMethod, "observed_deferred_transaction_awaiting_release_evidence");
  assert.equal(parseAmazonReleaseDate(null), null);
});

test("DEFERRED with maturityDate uses amazon release estimation method label", () => {
  const item = buildDeferredTreasuryObservation(deferredTx(), NOW);
  assert.equal(item.estimationMethod, "observed_deferred_transaction_with_amazon_release_date");
});

test("DEFERRED without maturityDate keeps awaiting release evidence label", () => {
  const item = buildDeferredTreasuryObservation(
    deferredTx({ contexts: [{ contextType: "DeferredContext", deferralReason: "DD7" }] }),
    NOW,
  );
  assert.equal(item.estimationMethod, "observed_deferred_transaction_awaiting_release_evidence");
});

test("maturityDate is not mapped to expected_bank_date", () => {
  const item = buildDeferredTreasuryObservation(deferredTx(), NOW);
  assert.ok(item);
  assert.equal(item.amazonReleaseDate, "2026-09-24");
  assert.equal(item.expectedBankDate, null);
});

test("relatedIdentifiers keeps only useful names", () => {
  const ids = extractUsefulRelatedIdentifiers(deferredTx());
  assert.deepEqual(ids, { ORDER_ID: "402-1234567-8901234", SHIPMENT_ID: "shp-1" });
  assert.equal(ids.FINANCIAL_EVENT_GROUP_ID, undefined);
  assert.equal(ids.SETTLEMENT_ID, undefined);
});

test("AVAILABLE observation contract is unchanged", () => {
  const group = {
    FinancialEventGroupId: "grp-open-1",
    ProcessingStatus: "Open",
    OriginalTotal: { CurrencyCode: "EUR", CurrencyAmount: 100 },
    FinancialEventGroupStart: "2026-09-01T00:00:00Z",
    FinancialEventGroupEnd: "2026-09-15T00:00:00Z",
  };
  const item = groupObservation(group, [], NOW, [1, 2, 3, 4, 5]);
  assert.ok(item);
  assert.equal(item.economicState, "AVAILABLE");
  assert.equal(item.expectedAvailabilityDate, "2026-09-15");
  assert.equal(item.amazonTransactionType, undefined);
  assert.equal(item.amazonReleaseDate, undefined);
  assert.equal(item.amazonDeferralReason, undefined);
});

test("PENDING_BANK observation contract is unchanged", () => {
  const group = {
    FinancialEventGroupId: "grp-pending-1",
    ProcessingStatus: "Closed",
    FundTransferStatus: "Processing",
    FundTransferDate: "2026-09-14T12:00:00Z",
    OriginalTotal: { CurrencyCode: "EUR", CurrencyAmount: 250 },
    FinancialEventGroupStart: "2026-09-01T00:00:00Z",
    FinancialEventGroupEnd: "2026-09-15T00:00:00Z",
  };
  const item = groupObservation(group, [], NOW, [1, 2, 3, 4, 5]);
  assert.ok(item);
  assert.equal(item.economicState, "PENDING_BANK");
  assert.equal(item.expectedAvailabilityDate, "2026-09-14");
  assert.equal(item.expectedRequestDate, null);
  assert.ok(item.expectedBankDate);
  assert.equal(item.amazonReleaseDate, undefined);
});

test("extractDeferredContext reads item-level contexts", () => {
  const ctx = extractDeferredContext({
    items: [{ contexts: [{ contextType: "DeferredContext", deferralReason: "DD7", maturityDate: "2026-09-20T00:00:00Z" }] }],
  });
  assert.equal(ctx.deferralReason, "DD7");
  assert.equal(ctx.maturityDate, "2026-09-20T00:00:00Z");
});
