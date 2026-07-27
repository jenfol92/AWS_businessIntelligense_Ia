-- READ-ONLY preflight before applying credit-line maturity hardening.
-- Do not mutate data. Run in test DB before migrations.

-- 1) Duplicate idempotency keys (must be 0 before unique index)
SELECT
  idempotency_key,
  count(*) AS rows,
  array_agg(id) AS movement_ids
FROM public.finance_credit_line_movements
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING count(*) > 1;

-- 2) Existing unique index
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'finance_credit_line_movements'
  AND indexname = 'ux_finance_credit_line_movements_idempotency_key';

-- 3) Direct write privileges of authenticated (expect false after hardening migration)
SELECT
  table_name,
  privilege_type,
  has_table_privilege('authenticated', format('public.%I', table_name), privilege_type) AS allowed
FROM (
  VALUES
    ('finance_credit_line_movements'),
    ('finance_credit_line_repayment_groups'),
    ('finance_cash_movements'),
    ('finance_credit_lines'),
    ('finance_cash_accounts')
) AS t(table_name)
CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS p(privilege_type)
ORDER BY 1, 2;

-- 4) Function signatures present
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'finance_create_credit_line_drawdown',
    'finance_create_credit_line_repayment',
    'create_and_apply_purchase_payment_batch',
    'mark_and_finance_supplier_payment'
  )
ORDER BY 1, 2;
