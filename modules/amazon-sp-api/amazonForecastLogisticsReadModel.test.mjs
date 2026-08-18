import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("read model keeps sales, physical stock and operational stock sources separate", async () => {
  const migration = await readFile("sql/migrations/20260818_01_amazon_forecast_logistics_read_model.sql", "utf8");
  assert.match(migration, /v_amazon_forecast_logistics_read_model/);
  assert.match(migration, /GET_AFN_INVENTORY_DATA_BY_COUNTRY/);
  assert.match(migration, /v_latest_amazon_fba_inventory_by_product_marketplace/);
  assert.match(migration, /ventas_diarias/);
  assert.match(migration, /stock_fba_country/);
  assert.match(migration, /inbound_country_confirmed/);
  assert.match(migration, /projected_shortage/);
  assert.doesNotMatch(migration, /SUM\(.*fba_available.*marketplace_id/i);
});

test("sales pipeline is the canonical fulfilled-shipments path", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  const salesMigration = await readFile("sql/migrations/20260710_update_v_amazon_fba_sales_daily_to_amazon_fulfilled_shipments.sql", "utf8");
  assert.match(source, /GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL/);
  assert.match(source, /amazon_fba_sales_daily_raw/);
  assert.match(source, /sync_ventas_diarias_from_amazon_fba_sales/);
  assert.match(salesMigration, /GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL/);
});
