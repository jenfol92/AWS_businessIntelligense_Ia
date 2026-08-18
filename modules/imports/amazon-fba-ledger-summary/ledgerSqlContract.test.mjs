import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../../sql/migrations/20260814_02_fba_ledger_contract_consolidated.sql", import.meta.url),
  "utf8",
);
const precheck = readFileSync(
  new URL("../../../sql/diagnostics/fba_ledger_contract_remote_precheck_readonly.sql", import.meta.url),
  "utf8",
);
const repository = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
const legacySpApiWriter = readFileSync(
  new URL("../../amazon-sp-api/fbaForecastSpApiImportsService.ts", import.meta.url),
  "utf8",
);

assert.match(migration, /CREATE OR REPLACE VIEW public\.v_latest_fba_inventory_by_product_location/);
assert.doesNotMatch(migration, /CREATE OR REPLACE VIEW public\.v_latest_fba_inventory_by_product_country/);
assert.match(migration, /location_raw/);
assert.match(migration, /FROM public\.paises/);
assert.match(migration, /l\.found/);
assert.match(migration, /CREATE TEMP TABLE ledger_duplicate_groups/);
assert.match(migration, /IF EXISTS \(SELECT 1 FROM ledger_duplicate_groups\)/);
assert.doesNotMatch(migration, /idx_amz_fba_ledger_document_identity/);
assert.match(migration, /document_identity.*snapshot_date.*asin.*fnsku.*location_raw.*disposition.*condition_type/s);
assert.match(migration, /WHERE upper\(c\.disposition\) = 'SELLABLE'/);
assert.match(migration, /unknown_condition_sellable/);
assert.match(migration, /Never use as EU\/UK operational availability/);
assert.match(precheck, /SAFE_TO_MIGRATE/);
assert.doesNotMatch(precheck, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
assert.match(repository, /prepareLedgerRowsAgainstPersisted/);
assert.match(repository, /\.in\("document_identity", documentIdentities\)/);
assert.match(repository, /document_identity,snapshot_date,asin,fnsku,location_raw,disposition,condition_type/);
assert.doesNotMatch(
  legacySpApiWriter,
  /"amazon_fba_inventory_ledger_daily",\s*dbRows,\s*"sku_original,fnsku,asin,snapshot_date,disposition,location,source"/s,
);
assert.match(legacySpApiWriter, /LEDGER_LEGACY_PATH_DISABLED_USE_CANONICAL_OWNER/);
assert.doesNotMatch(legacySpApiWriter, /export async function importFbaLedgerDailyFromSpApi/);
