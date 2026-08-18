import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function filesUnder(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path.replaceAll("\\", "/")];
  });
}

test("Importar page, navigation and orphan components are absent", () => {
  assert.equal(existsSync("app/[locale]/(dashboard)/importar/page.tsx"), false);
  const sidebar = readFileSync("shared/layout/Sidebar.tsx", "utf8");
  const middleware = readFileSync("middleware.ts", "utf8");
  assert.doesNotMatch(sidebar, /path:\s*["']\/importar["']/);
  assert.doesNotMatch(middleware, /startsWith\(["']\/importar["']\)/);
  assert.equal(
    existsSync("modules/imports/components")
      ? filesUnder("modules/imports/components").length
      : 0,
    0,
  );
});

test("modules/imports contains only owners with demonstrated consumers", () => {
  const remaining = filesUnder("modules/imports");
  assert.ok(remaining.length > 0);
  for (const file of remaining) {
    assert.match(
      file,
      /^modules\/imports\/(amazon-fba-inventory-by-country|amazon-fba-ledger-summary|shared)\//,
      file,
    );
  }
  assert.equal(remaining.some((file) => file.endsWith("/shared/twinlySku.ts")), true);
  assert.equal(remaining.some((file) => file.endsWith("/shared/amazonMarketplaceIds.ts")), true);
});

test("fragmented 410 cron routes were physically deleted", () => {
  for (const path of [
    "app/api/cron/amazon-sp-api/reports/route.ts",
    "app/api/cron/amazon/reports/request-due/route.ts",
    "app/api/cron/amazon/reports/poll/route.ts",
    "app/api/cron/amazon/reports/preview/route.ts",
    "app/api/cron/amazon/reports/commit/route.ts",
  ]) assert.equal(existsSync(path), false, path);
});
