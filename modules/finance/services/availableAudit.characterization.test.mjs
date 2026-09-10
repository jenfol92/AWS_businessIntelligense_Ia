// Characterization of aggregation edge cases unrelated to sync scoping.
// Offline: no Amazon calls, database connections, writes or credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketplaceCashCards } from "./amazonCashForecast.ts";
import { valueAmazonAmountEur } from "./ecbFxService.ts";

const synthetic = (id, amount) => ({
  identity: id,
  marketplace: "ES",
  state: "AVAILABLE",
  originalCurrency: "EUR",
  originalAmount: amount ?? 50,
  officialAmountEur: amount,
  estimatedAmountEur: amount,
  expectedBankDate: null,
  confidence: "medium",
  estimationMethod: "audit",
});

test("100 + 200 + NULL loses known subtotal in current card", () => {
  const c = buildMarketplaceCashCards([synthetic("a", 100), synthetic("b", 200), synthetic("c", null)])[0];
  assert.equal(c.availableEur, null);
  assert.equal(c.availablePositiveEur, null);
  assert.equal(c.totalEconomicEur, 0);
});

test("Europe prefilter removes NULL and hides incompleteness", () => {
  const rows = [synthetic("a", 100), synthetic("b", 200), synthetic("c", null)];
  const c = buildMarketplaceCashCards(
    rows.flatMap((i) => {
      const amount = i.officialAmountEur ?? i.estimatedAmountEur;
      return amount == null ? [] : [{ ...i, marketplace: "EUROPE", originalAmount: amount }];
    }),
  )[0];
  assert.equal(c.availablePositiveEur, 300);
});

test("negative Germany is filtered from positive payout, not a conversion failure", () => {
  const rows = [{
    identity: "de-neg",
    marketplace: "DE",
    state: "AVAILABLE",
    originalCurrency: "EUR",
    originalAmount: -10415.58,
    officialAmountEur: -10415.58,
    estimatedAmountEur: -10415.58,
    expectedBankDate: null,
    confidence: "medium",
    estimationMethod: "audit",
  }];
  const c = buildMarketplaceCashCards(rows)[0];
  assert.equal(c.availableEur, -10415.58);
  assert.equal(c.availablePositiveEur, 0);
});

test("null ConvertedTotal is wrongly accepted as official realized zero (synthetic trigger)", () => {
  const fx = valueAmazonAmountEur("GBP", 100, { CurrencyCode: "EUR", CurrencyAmount: null }, null);
  assert.equal(fx.amountEur, 0);
  assert.equal(fx.realizedAmountEur, 0);
  assert.equal(fx.fxSource, "AMAZON_CONVERTED_TOTAL");
});
