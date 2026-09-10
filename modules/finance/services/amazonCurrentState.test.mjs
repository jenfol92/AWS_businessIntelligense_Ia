// Regression tests: Amazon CURRENT state = last successful sync batch only.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketplaceCashCards } from "./amazonCashForecast.ts";

const CURRENT_SYNC_AT = "2026-09-10T08:36:35.874+00:00";
const HISTORICAL_SYNC_AT = "2026-08-12T11:36:05.502+00:00";

/** Mirrors repository filter: rows already scoped to one snapshot_at batch. */
function dedupeWithinSyncBatch(rows) {
  return Array.from(
    new Map(
      rows
        .slice()
        .sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")))
        .map((row) => [String(row.source_key), row]),
    ).values(),
  );
}

function filterCurrentSyncRows(allRows, observedAt = CURRENT_SYNC_AT) {
  return allRows.filter((row) => row.snapshot_at === observedAt);
}

/** Mirrors readSuccessfulSyncObservationAt in financialPlanningRepository.ts */
function readSuccessfulSyncObservationAt(lastResult) {
  if (!lastResult || typeof lastResult !== "object") return null;
  const observations = lastResult.observations;
  if (!observations || typeof observations !== "object") return null;
  const observedAt = observations.observedAt;
  return typeof observedAt === "string" && observedAt.length > 0 ? observedAt : null;
}

/** Mirrors readLatestSuccessfulAmazonObservationAt after sync-state gap fix */
function readLatestSuccessfulAmazonObservationAtFromRow(data) {
  if (!data) return null;
  return readSuccessfulSyncObservationAt(data.last_result);
}

function currentRowsForSyncState(syncStateRow) {
  const observedAt = readLatestSuccessfulAmazonObservationAtFromRow(syncStateRow);
  if (!observedAt) return [];
  return dedupeWithinSyncBatch(filterCurrentSyncRows(FIXTURE_ROWS, observedAt));
}

function toCashItem(row) {
  const official = row.official_amount_eur == null ? null : Number(row.official_amount_eur);
  const treasury = row.amount_eur ?? row.estimated_amount_eur;
  return {
    identity: row.source_key,
    marketplace: row.marketplace,
    state: row.economic_state,
    originalCurrency: row.original_currency,
    originalAmount: Number(row.original_amount),
    officialAmountEur: official,
    estimatedAmountEur: official == null && treasury != null ? Number(treasury) : null,
    expectedBankDate: null,
    confidence: "medium",
    estimationMethod: "audit",
    snapshotAt: row.snapshot_at,
  };
}

function cardFor(marketplace, rows) {
  return buildMarketplaceCashCards(rows.map(toCashItem)).find((c) => c.marketplace === marketplace);
}

function summaryAmazonAvailable(rows) {
  return rows
    .filter(
      (row) =>
        row.economic_state === "AVAILABLE"
        && row.marketplace !== "UNRESOLVED"
        && (row.official_amount_eur ?? row.amount_eur) != null
        && Number(row.original_amount) > 0,
    )
    .reduce((sum, row) => sum + Number(row.official_amount_eur ?? row.amount_eur), 0);
}

const FIXTURE_ROWS = [
  {
    id: "es-hist-av",
    source_key: "available:_B9iDK5QDUWExpYahc4TTyzj2OUcO6Nmt9mxCMDUHns",
    snapshot_at: HISTORICAL_SYNC_AT,
    economic_state: "AVAILABLE",
    marketplace: "ES",
    original_currency: "EUR",
    original_amount: 14290.64,
    official_amount_eur: 14290.64,
    amount_eur: 14290.64,
  },
  {
    id: "es-cur-av",
    source_key: "available:XvJNSYVO_a93SVWk-9S6Ea6M1tyfU1sQq8cya7yTjsg",
    snapshot_at: CURRENT_SYNC_AT,
    economic_state: "AVAILABLE",
    marketplace: "ES",
    original_currency: "EUR",
    original_amount: 0,
    official_amount_eur: 0,
    amount_eur: 0,
  },
  {
    id: "es-hist-def",
    source_key: "amazon-transaction:hist-es-deferred",
    snapshot_at: HISTORICAL_SYNC_AT,
    economic_state: "DEFERRED",
    marketplace: "ES",
    original_currency: "EUR",
    original_amount: 100,
    official_amount_eur: 100,
    amount_eur: 100,
  },
  {
    id: "es-cur-def",
    source_key: "amazon-transaction:cur-es-deferred",
    snapshot_at: CURRENT_SYNC_AT,
    economic_state: "DEFERRED",
    marketplace: "ES",
    original_currency: "EUR",
    original_amount: 81223.75,
    official_amount_eur: 81223.75,
    amount_eur: 81223.75,
  },
  {
    id: "se-hist-av",
    source_key: "available:ApTA14w8nGDZzVVtV2csLl1pTHGRY1Jh_RhJAL-9JU0",
    snapshot_at: HISTORICAL_SYNC_AT,
    economic_state: "AVAILABLE",
    marketplace: "SE",
    original_currency: "SEK",
    original_amount: 5317.28,
    official_amount_eur: null,
    amount_eur: null,
  },
  {
    id: "se-cur-av",
    source_key: "available:c_UqTMwEEzlV71SwXg8R-LVODNCC7LL216j3Dyat0CM",
    snapshot_at: CURRENT_SYNC_AT,
    economic_state: "AVAILABLE",
    marketplace: "SE",
    original_currency: "SEK",
    original_amount: 89.54,
    official_amount_eur: null,
    amount_eur: 8.03,
  },
  {
    id: "se-hist-def-a",
    source_key: "amazon-transaction:se-hist-def-a",
    snapshot_at: HISTORICAL_SYNC_AT,
    economic_state: "DEFERRED",
    marketplace: "SE",
    original_currency: "SEK",
    original_amount: 541.72,
    official_amount_eur: null,
    amount_eur: null,
  },
  {
    id: "se-hist-def-b",
    source_key: "amazon-transaction:se-hist-def-b",
    snapshot_at: HISTORICAL_SYNC_AT,
    economic_state: "DEFERRED",
    marketplace: "SE",
    original_currency: "SEK",
    original_amount: 481.11,
    official_amount_eur: null,
    amount_eur: null,
  },
  {
    id: "se-cur-def-a",
    source_key: "amazon-transaction:m07CDY9FEVP-IMeQHdnk744FhopcpCPo8nXm4PzqFck",
    snapshot_at: CURRENT_SYNC_AT,
    economic_state: "DEFERRED",
    marketplace: "SE",
    original_currency: "SEK",
    original_amount: 359.79,
    official_amount_eur: null,
    amount_eur: 32.27,
  },
  {
    id: "se-cur-def-b",
    source_key: "amazon-transaction:KzQLmqGEmU7cd4CXh_t46iq6Teb4z4k-D2Auck7KkUo",
    snapshot_at: CURRENT_SYNC_AT,
    economic_state: "DEFERRED",
    marketplace: "SE",
    original_currency: "SEK",
    original_amount: 975.66,
    official_amount_eur: null,
    amount_eur: 87.51,
  },
];

const currentRows = dedupeWithinSyncBatch(filterCurrentSyncRows(FIXTURE_ROWS));

test("historical observation absent from last sync does not enter CURRENT", () => {
  const historicalOnly = FIXTURE_ROWS.filter((row) => row.snapshot_at === HISTORICAL_SYNC_AT);
  const current = filterCurrentSyncRows(FIXTURE_ROWS);
  assert.ok(historicalOnly.some((row) => row.id === "es-hist-av"));
  assert.ok(!current.some((row) => row.id === "es-hist-av"));
});

test("ES AVAILABLE current is 0 EUR, not 14290.64 historical", () => {
  const es = cardFor("ES", currentRows.filter((row) => row.marketplace === "ES"));
  assert.equal(es.availableOriginal, 0);
  assert.equal(es.availableEur, 0);
  assert.equal(es.availablePositiveEur, 0);
});

test("ES DEFERRED current is last-sync total only", () => {
  const es = cardFor("ES", currentRows.filter((row) => row.marketplace === "ES"));
  assert.equal(es.deferredOriginal, 81223.75);
  assert.equal(es.deferredEur, 81223.75);
});

test("SE AVAILABLE current is 89.54 SEK", () => {
  const se = cardFor("SE", currentRows.filter((row) => row.marketplace === "SE"));
  assert.equal(se.availableOriginal, 89.54);
  assert.equal(se.availableEur, 8.03);
  assert.equal(se.availablePositiveEur, 8.03);
});

test("SE DEFERRED current is 1335.45 SEK", () => {
  const se = cardFor("SE", currentRows.filter((row) => row.marketplace === "SE"));
  assert.equal(se.deferredOriginal, 1335.45);
  assert.equal(se.deferredEur, 119.78);
});

test("summary.amazonAvailable ignores historical AVAILABLE rows", () => {
  assert.equal(summaryAmazonAvailable(currentRows.filter((row) => row.marketplace === "ES")), 0);
  const globalDedup = dedupeWithinSyncBatch(FIXTURE_ROWS);
  assert.equal(summaryAmazonAvailable(globalDedup.filter((row) => row.marketplace === "ES")), 14290.64);
});

test("current amazon events exclude historical source keys", () => {
  const eventSourceKeys = new Set(currentRows.map((row) => row.source_key));
  assert.ok(!eventSourceKeys.has("available:_B9iDK5QDUWExpYahc4TTyzj2OUcO6Nmt9mxCMDUHns"));
  assert.ok(eventSourceKeys.has("available:XvJNSYVO_a93SVWk-9S6Ea6M1tyfU1sQq8cya7yTjsg"));
});

test("SE EUR subtotals stay valued when only current sync rows are used", () => {
  const se = cardFor("SE", currentRows.filter((row) => row.marketplace === "SE"));
  assert.notEqual(se.availableEur, null);
  assert.notEqual(se.deferredEur, null);
});

test("sync pointer: succeeded with observedAt uses last batch", () => {
  const observedAt = readLatestSuccessfulAmazonObservationAtFromRow({
    status: "succeeded",
    last_result: { observations: { observedAt: CURRENT_SYNC_AT } },
  });
  assert.equal(observedAt, CURRENT_SYNC_AT);
  assert.equal(currentRowsForSyncState({
    status: "succeeded",
    last_result: { observations: { observedAt: CURRENT_SYNC_AT } },
  }).length, dedupeWithinSyncBatch(filterCurrentSyncRows(FIXTURE_ROWS)).length);
});

test("sync pointer: running keeps last successful observedAt", () => {
  const observedAt = readLatestSuccessfulAmazonObservationAtFromRow({
    status: "running",
    last_result: { observations: { observedAt: CURRENT_SYNC_AT } },
  });
  assert.equal(observedAt, CURRENT_SYNC_AT);
  assert.ok(currentRowsForSyncState({
    status: "running",
    last_result: { observations: { observedAt: CURRENT_SYNC_AT } },
  }).some((row) => row.id === "es-cur-av"));
});

test("sync pointer: failed keeps last successful observedAt", () => {
  const observedAt = readLatestSuccessfulAmazonObservationAtFromRow({
    status: "failed",
    last_result: { observations: { observedAt: CURRENT_SYNC_AT } },
  });
  assert.equal(observedAt, CURRENT_SYNC_AT);
  assert.ok(currentRowsForSyncState({
    status: "failed",
    last_result: { observations: { observedAt: CURRENT_SYNC_AT } },
  }).some((row) => row.id === "se-cur-av"));
});

test("sync pointer: missing observedAt returns null and empty current rows", () => {
  assert.equal(readLatestSuccessfulAmazonObservationAtFromRow(null), null);
  assert.equal(readLatestSuccessfulAmazonObservationAtFromRow({
    status: "succeeded",
    last_result: { successful: true },
  }), null);
  assert.equal(readLatestSuccessfulAmazonObservationAtFromRow({
    status: "failed",
    last_result: null,
  }), null);
  assert.deepEqual(currentRowsForSyncState({
    status: "succeeded",
    last_result: { successful: true },
  }), []);
  assert.ok(!currentRowsForSyncState({
    status: "succeeded",
    last_result: { successful: true },
  }).some((row) => row.snapshot_at === HISTORICAL_SYNC_AT));
});
