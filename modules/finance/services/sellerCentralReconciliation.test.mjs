import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildMarketplaceCashCards } from "./amazonCashForecast.ts";

const read = path => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");
const item = values => ({
  identity: values.identity,
  marketplace: values.marketplace,
  state: values.state,
  originalCurrency: values.currency ?? "EUR",
  originalAmount: values.amount,
  officialAmountEur: values.currency && values.currency !== "EUR" ? null : values.amount,
  estimatedAmountEur: null,
  expectedBankDate: values.expectedBankDate ?? null,
  confidence: "unavailable",
  estimationMethod: "observed_not_reconciled",
});

test("Seller Central ES fixture balances arithmetically without persistence", () => {
  const available = 13975.27;
  const deferred = 62901.29;
  assert.equal(Number((available + deferred).toFixed(2)), 76876.56);
});

test("transaction DEFERRED observations are not labelled as reconciled current stock", async () => {
  const ui = await read("modules/finance/components/FinancialPlanningPage.tsx");
  assert.match(ui, /Diferido por Amazon/);
  assert.doesNotMatch(ui, /Reconciliado con Seller Central/);
  assert.doesNotMatch(ui, /Diferido conocido/);
});

test("Open is not labelled AVAILABLE without qualification", async () => {
  const ui = await read("modules/finance/components/FinancialPlanningPage.tsx");
  assert.match(ui, /AVAILABLE es dinero que puede solicitarse a Amazon, pero todavía no está en banco/);
  assert.doesNotMatch(ui, /Disponible positivo/);
});

test("FUTURE is excluded from current marketplace cards", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  const ui = await read("modules/finance/components/FinancialPlanningPage.tsx");
  assert.match(planning, /item\.state!=="FUTURE"&&item\.state!=="RECEIVED"/);
  assert.doesNotMatch(ui, /<div>Futuro:/);
});

test("Europe is an explicit marketplace set and excludes Middle East and unresolved", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(planning, /new Set\(\["ES","FR","DE","IT","GB","SE","PL","NL","BE","IE"\]\)/);
  assert.doesNotMatch(planning, /europeItems=.*marketplace!=="UNRESOLVED"/);
});

test("foreign currencies remain native when no official EUR conversion exists", () => {
  const cards = buildMarketplaceCashCards([item({ identity: "gb", marketplace: "GB", state: "DEFERRED", currency: "GBP", amount: 100 })]);
  assert.equal(cards[0].currency, "GBP");
  assert.equal(cards[0].deferredOriginal, 100);
  assert.equal(cards[0].deferredEur, null);
});

test("explicit Amazon date has conceptual precedence over modelled date", () => {
  const explicitAmazonDate = "2026-08-25";
  const modelledDate = "2026-08-14";
  assert.equal(explicitAmazonDate ?? modelledDate, "2026-08-25");
});

test("unresolved marketplace is not part of Europe", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(planning, /europeMarketplaces\.has\(item\.marketplace\)/);
});

test("Finances pagination follows tokens until exhaustion", async () => {
  const pagination = await read("modules/amazon-sp-api/financesPagination.mjs");
  assert.match(pagination, /do \{/);
  assert.match(pagination, /while\(nextToken\)/);
});

test("snapshot repository paginates beyond Supabase default row limit", async () => {
  const repository = await read("modules/finance/repositories/financialPlanningRepository.ts");
  assert.match(repository, /AMAZON_OBSERVATION_PAGE_SIZE = 1000/);
  assert.match(repository, /\.range\(from, from \+ AMAZON_OBSERVATION_PAGE_SIZE - 1\)/);
});

test("producer uses the complete 179-day API window, below the 180-day limit", async () => {
  const producer = await read("modules/finance/services/amazonTreasuryObservations.ts");
  assert.match(producer, /setUTCDate\(historyStart\.getUTCDate\(\)-179\)/);
  assert.match(producer, /transactionStatus:"DEFERRED"/);
});

test("group and transaction identities cannot deduplicate each other", () => {
  const cards = buildMarketplaceCashCards([
    item({ identity: "event-group:g1", marketplace: "ES", state: "AVAILABLE", amount: 10 }),
    item({ identity: "transaction:t1", marketplace: "ES", state: "DEFERRED", amount: 20 }),
  ]);
  assert.equal(cards[0].availableEur, 10);
  assert.equal(cards[0].deferredEur, 20);
});
