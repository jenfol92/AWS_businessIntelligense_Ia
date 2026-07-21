-- Sustituir los UUID por una orden con depósito pagado y balance pendiente.
-- No ejecutar en producción.
BEGIN;

CREATE TEMP TABLE _supplier_payment_plan_sync_context (
  order_id uuid PRIMARY KEY,
  deposit_payment_id uuid NOT NULL,
  balance_payment_id uuid NOT NULL,
  test_cash_account_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _supplier_payment_plan_sync_context (
  order_id,
  deposit_payment_id,
  balance_payment_id,
  test_cash_account_id
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

DO $$
DECLARE
  v_context _supplier_payment_plan_sync_context%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM _supplier_payment_plan_sync_context;

  IF NOT EXISTS (
    SELECT 1
    FROM public.finance_supplier_payments
    WHERE id = v_context.deposit_payment_id
      AND orden_id = v_context.order_id
      AND payment_type = 'DEPOSITO_30'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.finance_supplier_payments
    WHERE id = v_context.balance_payment_id
      AND orden_id = v_context.order_id
      AND payment_type = 'BALANCE_70'
  ) THEN
    RAISE EXCEPTION 'TEST_CONTEXT_INVALID: order must have DEPOSITO_30 and BALANCE_70 rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.finance_cash_accounts
    WHERE id = v_context.test_cash_account_id
      AND upper(trim(currency)) = 'EUR'
  ) THEN
    RAISE EXCEPTION 'TEST_CASH_ACCOUNT_MISSING: sustituye test_cash_account_id por una cuenta EUR real';
  END IF;
END;
$$;

UPDATE public.finance_supplier_payments fsp
SET
  status = 'pagado',
  paid_at = timestamptz '2026-07-21 10:00:00+00',
  actual_amount_original = 100,
  actual_fx_rate = 0.125,
  actual_amount_eur = 12.50,
  bank_reference = 'TEST-SYNC-PAID',
  bank_fee_eur = 1.25,
  ff_fee_eur = 2.50,
  payment_source = 'cash',
  payment_source_type = 'cash_account',
  cash_account_id = c.test_cash_account_id,
  credit_line_id = NULL,
  notes = 'nota bancaria preservada',
  updated_at = timestamptz '2026-07-21 10:00:00+00'
FROM _supplier_payment_plan_sync_context c
WHERE fsp.id = c.deposit_payment_id;

UPDATE public.finance_supplier_payments fsp
SET
  status = 'pendiente',
  paid_at = NULL,
  actual_fx_rate = NULL,
  actual_amount_eur = NULL,
  actual_amount_original = NULL,
  bank_reference = NULL,
  bank_fee_eur = NULL,
  ff_fee_eur = NULL,
  payment_source = NULL,
  payment_source_type = NULL,
  cash_account_id = NULL,
  credit_line_id = NULL,
  notes = 'nota balance anterior',
  updated_at = timestamptz '2026-07-20 10:00:00+00'
FROM _supplier_payment_plan_sync_context c
WHERE fsp.id = c.balance_payment_id;

CREATE TEMP TABLE _supplier_payment_paid_snapshot ON COMMIT DROP AS
SELECT fsp.*
FROM public.finance_supplier_payments fsp
JOIN _supplier_payment_plan_sync_context c ON c.deposit_payment_id = fsp.id;

CREATE TEMP TABLE _supplier_payment_pending_snapshot ON COMMIT DROP AS
SELECT fsp.*
FROM public.finance_supplier_payments fsp
JOIN _supplier_payment_plan_sync_context c ON c.balance_payment_id = fsp.id;

SELECT public.sync_supplier_payment_plan(
  p_order_id := c.order_id,
  p_payment_type := 'DEPOSITO_30',
  p_due_date := date '2026-08-01',
  p_amount_original := 999,
  p_original_currency := 'USD',
  p_planned_fx_rate := 0.91,
  p_amount_eur := 909.09,
  p_logistics_type := 'propio',
  p_container_id := NULL,
  p_status := 'vencido',
  p_notes := 'no debe sustituir la nota bancaria',
  p_update_notes := true
)
FROM _supplier_payment_plan_sync_context c;

SELECT public.sync_supplier_payment_plan(
  p_order_id := c.order_id,
  p_payment_type := 'BALANCE_70',
  p_due_date := date '2026-09-15',
  p_amount_original := 700,
  p_original_currency := 'USD',
  p_planned_fx_rate := NULL,
  p_amount_eur := 0,
  p_logistics_type := 'amazon_agl',
  p_container_id := NULL,
  p_status := 'vencido',
  p_notes := 'nota balance recalculada',
  p_update_notes := true
)
FROM _supplier_payment_plan_sync_context c;

DO $$
DECLARE
  v_paid_before jsonb;
  v_paid_after jsonb;
  v_pending_before jsonb;
  v_pending_after public.finance_supplier_payments%ROWTYPE;
BEGIN
  SELECT to_jsonb(s) INTO v_paid_before FROM _supplier_payment_paid_snapshot s;
  SELECT to_jsonb(fsp) INTO v_paid_after
  FROM public.finance_supplier_payments fsp
  JOIN _supplier_payment_plan_sync_context c ON c.deposit_payment_id = fsp.id;

  IF v_paid_after IS DISTINCT FROM v_paid_before THEN
    RAISE EXCEPTION 'PAID_PAYMENT_CHANGED: %', jsonb_build_object(
      'before', v_paid_before,
      'after', v_paid_after
    );
  END IF;

  SELECT * INTO v_pending_after
  FROM public.finance_supplier_payments fsp
  JOIN _supplier_payment_plan_sync_context c ON c.balance_payment_id = fsp.id;

  SELECT to_jsonb(s) INTO v_pending_before FROM _supplier_payment_pending_snapshot s;

  IF v_pending_after.status <> 'vencido'
     OR v_pending_after.due_date <> date '2026-09-15'
     OR v_pending_after.logistics_type <> 'amazon_agl'
     OR v_pending_after.notes <> 'nota balance recalculada'
     OR v_pending_after.amount_original <> 700 THEN
    RAISE EXCEPTION 'PENDING_PAYMENT_NOT_UPDATED: %', to_jsonb(v_pending_after);
  END IF;

  IF to_jsonb(v_pending_after) IS NOT DISTINCT FROM v_pending_before THEN
    RAISE EXCEPTION 'PENDING_PAYMENT_UNCHANGED: expected plan fields to update';
  END IF;
END;
$$;

SELECT public.sync_supplier_payment_plan(
  p_order_id := c.order_id,
  p_payment_type := 'DEPOSITO_30',
  p_due_date := date '2026-08-02',
  p_amount_original := 888,
  p_original_currency := 'USD',
  p_planned_fx_rate := NULL,
  p_amount_eur := 0,
  p_logistics_type := 'amazon_agl',
  p_container_id := NULL,
  p_status := 'pendiente',
  p_notes := NULL,
  p_update_notes := false
)
FROM _supplier_payment_plan_sync_context c;

SELECT public.sync_supplier_payment_plan(
  p_order_id := c.order_id,
  p_payment_type := 'BALANCE_70',
  p_due_date := date '2026-09-20',
  p_amount_original := 700,
  p_original_currency := 'USD',
  p_planned_fx_rate := NULL,
  p_amount_eur := 0,
  p_logistics_type := 'amazon_agl',
  p_container_id := NULL,
  p_status := 'pendiente',
  p_notes := 'segunda sync',
  p_update_notes := true
)
FROM _supplier_payment_plan_sync_context c;

DO $$
DECLARE
  v_deposit_count integer;
  v_balance_count integer;
  v_paid_before jsonb;
  v_paid_after jsonb;
BEGIN
  SELECT count(*) INTO v_deposit_count
  FROM public.finance_supplier_payments fsp
  JOIN _supplier_payment_plan_sync_context c
    ON c.order_id = fsp.orden_id
   AND fsp.payment_type = 'DEPOSITO_30';

  SELECT count(*) INTO v_balance_count
  FROM public.finance_supplier_payments fsp
  JOIN _supplier_payment_plan_sync_context c
    ON c.order_id = fsp.orden_id
   AND fsp.payment_type = 'BALANCE_70';

  IF v_deposit_count <> 1 OR v_balance_count <> 1 THEN
    RAISE EXCEPTION 'DUPLICATE_PAYMENT_ROWS: deposit=%, balance=%',
      v_deposit_count, v_balance_count;
  END IF;

  SELECT to_jsonb(s) INTO v_paid_before FROM _supplier_payment_paid_snapshot s;
  SELECT to_jsonb(fsp) INTO v_paid_after
  FROM public.finance_supplier_payments fsp
  JOIN _supplier_payment_plan_sync_context c ON c.deposit_payment_id = fsp.id;

  IF v_paid_after IS DISTINCT FROM v_paid_before THEN
    RAISE EXCEPTION 'SECOND_SYNC_CHANGED_PAID_PAYMENT';
  END IF;

  RAISE NOTICE 'supplier_payment_plan_sync_concurrency_validation_ok';
END;
$$;

ROLLBACK;
