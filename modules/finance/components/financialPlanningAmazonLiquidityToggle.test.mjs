import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("Amazon available card toggles marketplace liquidity detail closed by default", async () => {
  const page = await read("modules/finance/components/FinancialPlanningPage.tsx");
  assert.match(page, /const \[showAmazonMarketplaceLiquidity, setShowAmazonMarketplaceLiquidity\] = useState\(false\)/);
  assert.match(page, /aria-expanded=\{showAmazonMarketplaceLiquidity\}/);
  assert.match(page, /aria-controls="amazon-marketplace-liquidity"/);
  assert.match(page, /\{showAmazonMarketplaceLiquidity \? \(/);
  assert.match(page, /id="amazon-marketplace-liquidity"/);
  assert.match(page, /setShowAmazonMarketplaceLiquidity\(\(current\) => !current\)/);
  assert.match(page, /Amazon · Estados de liquidez por marketplace/);
  assert.doesNotMatch(page, /showAmazonMarketplaceLiquidity &&[\s\S]*showAmazonMarketplaceLiquidity &&/);
});

test("Amazon available card is a full-surface button, not a passive div", async () => {
  const page = await read("modules/finance/components/FinancialPlanningPage.tsx");
  assert.match(page, /<button[\s\S]*?Amazon disponible para solicitar \(fuera de caja\)/);
  assert.match(page, /onClick=\{\(\) => setShowAmazonMarketplaceLiquidity\(\(current\) => !current\)\}/);
  assert.match(page, /data\.summary\.amazonAvailableSource/);
});
