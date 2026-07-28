-- AUTO-GENERATED from sql/migrations filenames via scripts/generate-finance-migration-inventory.mjs
-- Contrast with applied migrations in the test DB. Do NOT mutate data here.
-- Re-run the generator after adding finance migrations.

WITH expected(name, kind, apply_role, note) AS (
  VALUES
  ('20260721_confirmed_order_operations.sql', 'orders_adjacent', 'optional', 'order/proforma; not required for credit-line maturities'),
  ('20260721_fix_confirmed_order_operations.sql', 'orders_adjacent', 'optional', 'order/proforma; not required for credit-line maturities'),
  ('20260721_harden_confirmed_order_operations.sql', 'orders_adjacent', 'optional', 'order/proforma; not required for credit-line maturities'),
  ('20260721_order_proforma_versions.sql', 'orders_adjacent', 'optional', 'order/proforma; not required for credit-line maturities'),
  ('20260721_remove_confirmed_commercial_edit_rpc.sql', 'orders_adjacent', 'optional', 'order/proforma; not required for credit-line maturities'),
  ('20260721_safe_order_proforma_versioning.sql', 'orders_adjacent', 'optional', 'order/proforma; not required for credit-line maturities'),
  ('20260721_supplier_payment_actual_fields.sql', 'supplier_payment', 'pending', 'required before linked batches'),
  ('20260721_supplier_payment_mark_paid_rpc.sql', 'supplier_payment', 'pending', 'required before linked batches'),
  ('20260721_supplier_payment_sync_plan_rpc.sql', 'supplier_payment', 'pending', 'required before linked batches'),
  ('20260721_supplier_payment_t_atomic_pay_finance.sql', 'supplier_payment', 'pending', 'required before linked batches'),
  ('20260721_z_remove_order_fx_from_operational_flow.sql', 'orders_adjacent', 'optional', 'order/proforma; not required for credit-line maturities'),
  ('20260722_linked_purchase_payment_batches.sql', 'linked_batches', 'pending', 'required for financed drawdowns'),
  ('20260727_credit_line_legacy_opening_balance_rpc.sql', 'legacy_admin', 'optional', 'admin regularization RPC only'),
  ('20260727_credit_line_maturities_phase1.sql', 'maturities', 'pending', 'phase1 visibility + RPC rewrite'),
  ('20260728_harden_credit_line_maturity_execution.sql', 'harden', 'pending', 'idempotency + inactive repay + manual due date'),
  ('20260729_close_credit_line_runtime_invariants.sql', 'runtime_invariants', 'pending', 'debt summary/status/numeric/global key/auth'),
  ('20260730_serialize_credit_line_operation_identities.sql', 'concurrency_locks', 'pending', 'shared credit_line_operation lock + drawdown source unique index'),
  ('20260731_enforce_canonical_drawdown_source_identity.sql', 'drawdown_source_canonical', 'pending', 'normalized unique index + credit_line match + manual_due_date rules'),
  ('finance_credit_lines_grouped_repayments_schema.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_credit_lines_ledger_rpc.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_planning_base.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_planning_read_rls_policies.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payment_finance_rpc.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments_actual_amount_eur.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments_actual_amount_original.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments_actual_fx_rate.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments_ff_fee_eur.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments_normalize_logistics_type.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments_phase1_alignment.sql', 'base_dependency', 'dependency', 'historical base; verify presence'),
  ('finance_supplier_payments_rls.sql', 'base_dependency', 'dependency', 'historical base; verify presence')
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
  AND a.version NOT IN (SELECT name FROM (VALUES ('20260721_confirmed_order_operations.sql'),('20260721_fix_confirmed_order_operations.sql'),('20260721_harden_confirmed_order_operations.sql'),('20260721_order_proforma_versions.sql'),('20260721_remove_confirmed_commercial_edit_rpc.sql'),('20260721_safe_order_proforma_versioning.sql'),('20260721_supplier_payment_actual_fields.sql'),('20260721_supplier_payment_mark_paid_rpc.sql'),('20260721_supplier_payment_sync_plan_rpc.sql'),('20260721_supplier_payment_t_atomic_pay_finance.sql'),('20260721_z_remove_order_fx_from_operational_flow.sql'),('20260722_linked_purchase_payment_batches.sql'),('20260727_credit_line_legacy_opening_balance_rpc.sql'),('20260727_credit_line_maturities_phase1.sql'),('20260728_harden_credit_line_maturity_execution.sql'),('20260729_close_credit_line_runtime_invariants.sql'),('20260730_serialize_credit_line_operation_identities.sql'),('20260731_enforce_canonical_drawdown_source_identity.sql'),('finance_credit_lines_grouped_repayments_schema.sql'),('finance_credit_lines_ledger_rpc.sql'),('finance_planning_base.sql'),('finance_planning_read_rls_policies.sql'),('finance_supplier_payment_finance_rpc.sql'),('finance_supplier_payments.sql'),('finance_supplier_payments_actual_amount_eur.sql'),('finance_supplier_payments_actual_amount_original.sql'),('finance_supplier_payments_actual_fx_rate.sql'),('finance_supplier_payments_ff_fee_eur.sql'),('finance_supplier_payments_normalize_logistics_type.sql'),('finance_supplier_payments_phase1_alignment.sql'),('finance_supplier_payments_rls.sql')) v(name));
