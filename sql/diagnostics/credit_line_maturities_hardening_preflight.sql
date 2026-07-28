-- READ-ONLY preflight before applying credit-line maturity hardening / runtime invariants.
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

-- 4) Function signatures + EXECUTE grants
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'finance_create_credit_line_drawdown',
    'finance_create_credit_line_repayment',
    'create_and_apply_purchase_payment_batch',
    'mark_and_finance_supplier_payment',
    'finance_register_legacy_opening_balance'
  )
ORDER BY 1, 2;

-- 5) Numeric precision/scale for money columns (unbounded numeric => null precision)
-- Compatible ceiling used by finance_assert_finite_money: 9999999999.9999 (round 4),
-- aligned with create_and_apply_purchase_payment_batch abs >= 1e10 reject.
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.numeric_precision,
  c.numeric_scale,
  CASE
    WHEN c.numeric_precision IS NULL THEN 'unbounded_numeric'
    ELSE format('numeric(%s,%s)', c.numeric_precision, coalesce(c.numeric_scale, 0))
  END AS storage_shape,
  CASE
    WHEN c.numeric_precision IS NULL THEN 9999999999.9999
    ELSE power(10::numeric, c.numeric_precision - coalesce(c.numeric_scale, 0))
         - power(10::numeric, -coalesce(c.numeric_scale, 0))
  END AS derived_max_inclusive
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (
    (c.table_name = 'finance_credit_line_movements' AND c.column_name = 'amount')
    OR (c.table_name = 'finance_credit_line_repayment_groups'
        AND c.column_name IN ('amount', 'paid_amount', 'remaining_amount'))
    OR (c.table_name = 'finance_credit_lines'
        AND c.column_name IN ('credit_limit', 'used_amount', 'available_amount'))
    OR (c.table_name = 'finance_cash_accounts' AND c.column_name = 'balance')
    OR (c.table_name = 'finance_cash_movements' AND c.column_name = 'amount')
  )
ORDER BY c.table_name, c.column_name;

-- 6) Most restrictive derived max among columns above
SELECT min(derived_max_inclusive) AS most_restrictive_max
FROM (
  SELECT
    CASE
      WHEN c.numeric_precision IS NULL THEN 9999999999.9999
      ELSE power(10::numeric, c.numeric_precision - coalesce(c.numeric_scale, 0))
           - power(10::numeric, -coalesce(c.numeric_scale, 0))
    END AS derived_max_inclusive
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND (
      (c.table_name = 'finance_credit_line_movements' AND c.column_name = 'amount')
      OR (c.table_name = 'finance_credit_line_repayment_groups'
          AND c.column_name IN ('amount', 'paid_amount', 'remaining_amount'))
      OR (c.table_name = 'finance_credit_lines'
          AND c.column_name IN ('credit_limit', 'used_amount', 'available_amount'))
      OR (c.table_name = 'finance_cash_accounts' AND c.column_name = 'balance')
      OR (c.table_name = 'finance_cash_movements' AND c.column_name = 'amount')
    )
) s;

-- 7) Must admit FINANCE_MONEY_MAX_AFTER_ROUND (9999999999.9999); migration aborts if smaller
SELECT
  min(derived_max_inclusive) AS most_restrictive_max,
  9999999999.9999 AS finance_money_max_after_round,
  min(derived_max_inclusive) >= 9999999999.9999 AS admits_app_ceiling
FROM (
  SELECT
    CASE
      WHEN c.numeric_precision IS NULL THEN 9999999999.9999::numeric
      ELSE power(10::numeric, c.numeric_precision - coalesce(c.numeric_scale, 0))
           - power(10::numeric, -coalesce(c.numeric_scale, 0))
    END AS derived_max_inclusive
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND (
      (c.table_name = 'finance_credit_line_movements' AND c.column_name = 'amount')
      OR (c.table_name = 'finance_credit_line_repayment_groups'
          AND c.column_name IN ('amount', 'paid_amount', 'remaining_amount'))
      OR (c.table_name = 'finance_credit_lines'
          AND c.column_name IN ('credit_limit', 'used_amount', 'available_amount'))
      OR (c.table_name = 'finance_cash_accounts' AND c.column_name = 'balance')
      OR (c.table_name = 'finance_cash_movements' AND c.column_name = 'amount')
    )
) s;

-- 8) Duplicate drawdown source identities (must be 0 before unique index; do not auto-merge)
SELECT
  lower(trim(source_type)) AS source_type_normalized,
  source_id,
  count(*) AS rows,
  array_agg(id) AS movement_ids
FROM public.finance_credit_line_movements
WHERE movement_type = 'drawdown'
  AND source_id IS NOT NULL
  AND lower(trim(source_type)) IN ('supplier_payment', 'purchase_payment_batch')
GROUP BY 1, 2
HAVING count(*) > 1;

-- 9) Drawdown source unique index presence + exact canonical shape
SELECT
  indexname,
  indexdef,
  (
    indexdef ~* 'lower\s*\(\s*trim'
    AND indexdef ILIKE '%movement_type%'
    AND indexdef ILIKE '%source_id%'
    AND indexdef ILIKE '%supplier_payment%'
    AND indexdef ILIKE '%purchase_payment_batch%'
  ) AS is_canonical_normalized,
  (
    indexdef ILIKE '%(movement_type, source_type, source_id)%'
    AND indexdef !~* 'lower\s*\(\s*trim'
  ) AS is_legacy_unnormalized
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'finance_credit_line_movements'
  AND indexname = 'ux_finance_credit_line_movements_drawdown_source';

-- 10) Case/whitespace uniqueness probe (informational): same normalized identity
SELECT
  lower(trim(source_type)) AS source_type_normalized,
  source_id,
  count(DISTINCT source_type) AS distinct_raw_source_types,
  array_agg(DISTINCT source_type) AS raw_source_types
FROM public.finance_credit_line_movements
WHERE movement_type = 'drawdown'
  AND source_id IS NOT NULL
  AND lower(trim(source_type)) IN ('supplier_payment', 'purchase_payment_batch')
GROUP BY 1, 2
HAVING count(DISTINCT source_type) > 1;
