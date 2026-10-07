import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const importServiceSource = readFileSync(
  new URL("./fbaForecastSpApiImportsService.ts", import.meta.url),
  "utf8",
);
const syncOnlyRouteSource = readFileSync(
  new URL(
    "../../app/api/cron/amazon-sp-api/reports/fba-sales-to-ventas-diarias/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const coordinatorSource = readFileSync(new URL("./fbaSalesSyncCoordinator.ts", import.meta.url), "utf8");

test("normal import unions requested and observed marketplaces before canonical sync", () => {
  assert.match(
    importServiceSource,
    /buildCanonicalSalesMarketplaceScope\(\s*params\.marketplaceIds,\s*Array\.from\(observedValidMarketplaceIds\)/s,
  );
  assert.match(
    importServiceSource,
    /params\.commit\(dbRows, canonicalSyncMarketplaceIds\)/,
  );
  assert.match(importServiceSource, /if \(canonicalSyncMarketplaceIds\.length === 0\)/);
  assert.match(importServiceSource, /La fila se conserva en RAW y se excluye del scope canonical/);
});

test("syncOnly unions explicit or configured marketplaces with observed range marketplaces", () => {
  assert.match(
    syncOnlyRouteSource,
    /const observedValidMarketplaceIds = await loadMarketplaceIdsFromView/,
  );
  assert.match(
    syncOnlyRouteSource,
    /buildCanonicalSalesMarketplaceScope\(\s*configuredOrExplicitMarketplaceIds,\s*observedValidMarketplaceIds/s,
  );
  assert.match(
    syncOnlyRouteSource,
    /coordinateFbaSalesSync\([\s\S]*?marketplaceIds:\s*canonicalSyncMarketplaceIds/,
  );
  assert.doesNotMatch(
    syncOnlyRouteSource,
    /p_marketplace_ids:[\s\S]{0,120}canonicalSyncMarketplaceIds[\s\S]{0,120}:\s*null/,
  );
});

test("createReport continues to receive only requested marketplaceIds", () => {
  assert.match(
    coordinatorSource,
    /createReport\(\{reportType:FBA_SALES_REPORT_TYPE,marketplaceIds:state.marketplaceIds/,
  );
  assert.doesNotMatch(
    coordinatorSource,
    /createReport\([\s\S]{0,180}canonicalSyncMarketplaceIds/,
  );
});
