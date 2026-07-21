-- Sustituir los UUID por una orden, sus pagos y una cuenta de caja EUR real.
-- No ejecutar en producción.
BEGIN;

CREATE TEMP TABLE _payment_fx_context (
  order_id uuid PRIMARY KEY,
  deposit_payment_id uuid NOT NULL,
  balance_payment_id uuid NOT NULL,
  test_cash_account_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _payment_fx_context VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
  v_account public.finance_cash_accounts%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM _payment_fx_context;

  IF NOT EXISTS (
    SELECT 1 FROM public.finance_supplier_payments
    WHERE id = v_context.deposit_payment_id
      AND orden_id = v_context.order_id
      AND payment_type = 'DEPOSITO_30'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.finance_supplier_payments
    WHERE id = v_context.balance_payment_id
      AND orden_id = v_context.order_id
      AND payment_type = 'BALANCE_70'
  ) THEN
    RAISE EXCEPTION 'La orden de prueba debe tener depósito y balance explícitos.';
  END IF;

  SELECT * INTO v_account
  FROM public.finance_cash_accounts
  WHERE id = v_context.test_cash_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_CASH_ACCOUNT_MISSING: sustituye test_cash_account_id por una cuenta real.';
  END IF;

  IF upper(trim(coalesce(v_account.currency, ''))) <> 'EUR' THEN
    RAISE EXCEPTION 'TEST_CASH_ACCOUNT_CURRENCY: la cuenta de prueba debe ser EUR.';
  END IF;
END;
$$;

CREATE TEMP TABLE _snapshot_supplier_payments ON COMMIT DROP AS
SELECT * FROM public.finance_supplier_payments
WHERE id IN (
  SELECT deposit_payment_id FROM _payment_fx_context
  UNION ALL
  SELECT balance_payment_id FROM _payment_fx_context
);

CREATE TEMP TABLE _snapshot_order_items ON COMMIT DROP AS
SELECT * FROM public.orden_items
WHERE orden_id = (SELECT order_id FROM _payment_fx_context);

CREATE TEMP TABLE _snapshot_proformas ON COMMIT DROP AS
SELECT * FROM public.order_proforma_versions
WHERE orden_id = (SELECT order_id FROM _payment_fx_context);

SAVEPOINT before_distinct_fx;

SELECT public.mark_and_finance_supplier_payment(
  deposit_payment_id, order_id, now(), 0.126, NULL,
  'TEST-DEPOSIT', 3.50, NULL, 'diagnóstico',
  'cash_account', test_cash_account_id, NULL
)
FROM _payment_fx_context;

SELECT public.mark_and_finance_supplier_payment(
  balance_payment_id, order_id, now(), 0.122, NULL,
  'TEST-BALANCE', 4.25, NULL, 'diagnóstico',
  'cash_account', test_cash_account_id, NULL
)
FROM _payment_fx_context;

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
  v_deposit public.finance_supplier_payments%ROWTYPE;
  v_balance public.finance_supplier_payments%ROWTYPE;
  v_before_deposit public.finance_supplier_payments%ROWTYPE;
  v_before_balance public.finance_supplier_payments%ROWTYPE;
  v_rejected boolean := false;
  v_changed integer;
  v_cash_movements integer;
BEGIN
  SELECT * INTO v_context FROM _payment_fx_context;
  SELECT * INTO v_deposit FROM public.finance_supplier_payments
    WHERE id = v_context.deposit_payment_id;
  SELECT * INTO v_balance FROM public.finance_supplier_payments
    WHERE id = v_context.balance_payment_id;
  SELECT * INTO v_before_deposit FROM _snapshot_supplier_payments
    WHERE id = v_context.deposit_payment_id;
  SELECT * INTO v_before_balance FROM _snapshot_supplier_payments
    WHERE id = v_context.balance_payment_id;

  IF v_deposit.actual_fx_rate <> 0.126 OR v_balance.actual_fx_rate <> 0.122 THEN
    RAISE EXCEPTION 'Los FX reales por pago no se guardaron correctamente.';
  END IF;
  IF v_deposit.payment_source_type <> 'cash_account'
     OR v_deposit.cash_account_id <> v_context.test_cash_account_id
     OR v_deposit.credit_line_id IS NOT NULL THEN
    RAISE EXCEPTION 'La fuente financiera del depósito no es válida.';
  END IF;
  IF v_deposit.actual_amount_eur <> round(v_deposit.amount_original * 0.126, 2)
     OR v_balance.actual_amount_eur <> round(v_balance.amount_original * 0.122, 2) THEN
    RAISE EXCEPTION 'Los importes EUR reales no respetan el redondeo monetario.';
  END IF;
  IF (v_deposit.amount_original, v_deposit.original_currency)
       IS DISTINCT FROM (v_before_deposit.amount_original, v_before_deposit.original_currency)
     OR (v_balance.amount_original, v_balance.original_currency)
       IS DISTINCT FROM (v_before_balance.amount_original, v_before_balance.original_currency) THEN
    RAISE EXCEPTION 'La ejecución alteró importes o monedas originales.';
  END IF;

  SELECT count(*) INTO v_cash_movements
  FROM public.finance_cash_movements
  WHERE source_type = 'supplier_payment'
    AND source_id IN (v_context.deposit_payment_id, v_context.balance_payment_id);
  IF v_cash_movements <> 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 movimientos de caja, encontrados %.', v_cash_movements;
  END IF;

  SELECT count(*) INTO v_changed
  FROM public.orden_items current_row
  JOIN _snapshot_order_items snapshot_row USING (id)
  WHERE to_jsonb(current_row) IS DISTINCT FROM to_jsonb(snapshot_row);
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'Pagar proveedor modificó líneas de orden.';
  END IF;

  BEGIN
    PERFORM public.mark_and_finance_supplier_payment(
      v_context.deposit_payment_id, v_context.order_id, now(), 0.5, NULL,
      'OVERWRITE', NULL, NULL, NULL,
      'cash_account', v_context.test_cash_account_id, NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION
      'La repetición sobre un pago pagado no fue rechazada (conflicto de sobrescritura).';
  END IF;
END;
$$;

ROLLBACK TO SAVEPOINT before_distinct_fx;
SAVEPOINT before_negative_tests;

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
  v_rejected boolean := false;
  v_rejected_manual boolean := false;
  v_rejected_missing_source boolean := false;
BEGIN
  SELECT * INTO v_context FROM _payment_fx_context;

  BEGIN
    PERFORM public.mark_and_finance_supplier_payment(
      v_context.deposit_payment_id, v_context.order_id, now(), 0, NULL,
      NULL, NULL, NULL, NULL,
      'cash_account', v_context.test_cash_account_id, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FX cero no fue rechazado.';
  END IF;

  BEGIN
    PERFORM public.mark_and_finance_supplier_payment(
      v_context.deposit_payment_id, v_context.order_id, now(), 0.12, NULL,
      NULL, NULL, NULL, NULL,
      'manual', NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected_manual := true;
  END;
  IF NOT v_rejected_manual THEN
    RAISE EXCEPTION 'La fuente manual no fue rechazada.';
  END IF;

  BEGIN
    PERFORM public.mark_supplier_payment_paid(
      v_context.deposit_payment_id, v_context.order_id, now(), 0.12, NULL,
      NULL, 'cash', NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected_missing_source := true;
  END;
  IF NOT v_rejected_missing_source THEN
    RAISE EXCEPTION 'mark_supplier_payment_paid sin fuente real no fue rechazado.';
  END IF;
END;
$$;

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
  v_rejected_unpaid boolean := false;
  v_rejected_unverified boolean := false;
BEGIN
  SELECT * INTO v_context FROM _payment_fx_context;

  BEGIN
    UPDATE public.finance_supplier_payments
    SET payment_source_type = 'cash_account',
        cash_account_id = v_context.test_cash_account_id
    WHERE id = v_context.deposit_payment_id;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected_unpaid := true;
  END;

  IF NOT v_rejected_unpaid THEN
    -- También rechazar transición a pagado sin EUR real
    BEGIN
      UPDATE public.finance_supplier_payments
      SET
        status = 'pagado',
        paid_at = now(),
        payment_source_type = 'cash_account',
        cash_account_id = v_context.test_cash_account_id,
        credit_line_id = NULL
      WHERE id = v_context.deposit_payment_id;
    EXCEPTION WHEN SQLSTATE '22023' THEN
      v_rejected_unverified := true;
    END;
  ELSE
    v_rejected_unverified := true;
  END IF;

  IF NOT v_rejected_unverified THEN
    RAISE EXCEPTION 'El trigger permitió financiar sin importe EUR real.';
  END IF;
END;
$$;

UPDATE public.finance_supplier_payments
SET original_currency = 'EUR', amount_original = 100
WHERE id = (SELECT deposit_payment_id FROM _payment_fx_context);

SELECT public.mark_and_finance_supplier_payment(
  deposit_payment_id, order_id, now(), NULL, NULL,
  'TEST-EUR', NULL, NULL, 'diagnóstico EUR',
  'cash_account', test_cash_account_id, NULL
)
FROM _payment_fx_context;

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
  v_payment public.finance_supplier_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM _payment_fx_context;
  SELECT * INTO v_payment FROM public.finance_supplier_payments
    WHERE id = v_context.deposit_payment_id;
  IF v_payment.actual_fx_rate <> 1
     OR v_payment.actual_amount_eur <> 100
     OR v_payment.amount_original <> 100
     OR v_payment.original_currency <> 'EUR'
     OR v_payment.payment_source_type <> 'cash_account' THEN
    RAISE EXCEPTION 'La regla automática de pago EUR falló.';
  END IF;
  RAISE NOTICE 'supplier_payment_actual_fx_validation_ok';
END;
$$;

ROLLBACK TO SAVEPOINT before_negative_tests;
ROLLBACK;
