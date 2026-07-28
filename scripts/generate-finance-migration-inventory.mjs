import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join("sql", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const relevant = files.filter(
  (f) =>
    /^(20260721_|20260722_|20260727_|20260728_|20260729_|20260730_|20260731_)/.test(f)
    || /^finance_/.test(f),
);

const rows = relevant.map((name) => {
  let kind = "other";
  let role = "pending";
  let note = "";
  if (name.startsWith("finance_")) {
    kind = "base_dependency";
    role = "dependency";
    note = "historical base; verify presence";
  }
  if (name.startsWith("20260721_supplier_payment")) {
    kind = "supplier_payment";
    role = "pending";
    note = "required before linked batches";
  } else if (name.startsWith("20260721_")) {
    kind = "orders_adjacent";
    role = "optional";
    note = "order/proforma; not required for credit-line maturities";
  }
  if (name.startsWith("20260722_")) {
    kind = "linked_batches";
    role = "pending";
    note = "required for financed drawdowns";
  }
  if (name === "20260727_credit_line_maturities_phase1.sql") {
    kind = "maturities";
    role = "pending";
    note = "phase1 visibility + RPC rewrite";
  }
  if (name === "20260727_credit_line_legacy_opening_balance_rpc.sql") {
    kind = "legacy_admin";
    role = "optional";
    note = "admin regularization RPC only";
  }
  if (name === "20260728_harden_credit_line_maturity_execution.sql") {
    kind = "harden";
    role = "pending";
    note = "idempotency + inactive repay + manual due date";
  }
  if (name === "20260729_close_credit_line_runtime_invariants.sql") {
    kind = "runtime_invariants";
    role = "pending";
    note = "debt summary/status/numeric/global key/auth";
  }
  if (name === "20260730_serialize_credit_line_operation_identities.sql") {
    kind = "concurrency_locks";
    role = "pending";
    note = "shared credit_line_operation lock + drawdown source unique index";
  }
  if (name === "20260731_enforce_canonical_drawdown_source_identity.sql") {
    kind = "drawdown_source_canonical";
    role = "pending";
    note = "normalized unique index + credit_line match + manual_due_date rules";
  }
  return { name, kind, role, note };
});

const values = rows
  .map(
    (r) =>
      `  ('${r.name}', '${r.kind}', '${r.role}', '${r.note.replace(/'/g, "''")}')`,
  )
  .join(",\n");
const nameList = rows.map((r) => `('${r.name}')`).join(",");

const sql = `-- AUTO-GENERATED from sql/migrations filenames via scripts/generate-finance-migration-inventory.mjs
-- Contrast with applied migrations in the test DB. Do NOT mutate data here.
-- Re-run the generator after adding finance migrations.

WITH expected(name, kind, apply_role, note) AS (
  VALUES
${values}
),
applied AS (
  SELECT version AS name
  FROM supabase_migrations.schema_migrations
)
SELECT
  e.name,
  e.kind,
  e.apply_role,
  e.note,
  CASE WHEN a.name IS NULL THEN 'pendiente' ELSE 'aplicado' END AS db_status
FROM expected e
LEFT JOIN applied a ON a.name = e.name
ORDER BY e.name;

-- Applied finance-ish versions missing from this repo inventory (informational)
SELECT a.version AS applied_missing_from_repo_inventory
FROM supabase_migrations.schema_migrations a
WHERE a.version ~ '^(20260721_|20260722_|20260727_|20260728_|20260729_|20260730_|20260731_|finance_)'
  AND a.version NOT IN (SELECT name FROM (VALUES ${nameList}) v(name));
`;

writeFileSync(join("sql", "diagnostics", "credit_line_maturities_migration_order.sql"), sql);
console.log(`generate-finance-migration-inventory: ${rows.length} entries`);
