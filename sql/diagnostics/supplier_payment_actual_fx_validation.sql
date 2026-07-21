-- Sustituir estos tres UUID por una orden de prueba y sus pagos depósito/balance.
-- No ejecutar en producción.
BEGIN;

CREATE TEMP TABLE _payment_fx_context (
  order_id uuid PRIMARY KEY,
  deposit_payment_id uuid NOT NULL,
  balance_payment_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _payment_fx_context VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003'
);

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
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

SELECT public.mark_supplier_payment_paid(
  deposit_payment_id, order_id, now(), 0.126, NULL,
  'TEST-DEPOSIT', 'cash', 3.50, NULL, 'diagnóstico'
)
FROM _payment_fx_context;

SELECT public.mark_supplier_payment_paid(
  balance_payment_id, order_id, now(), 0.122, NULL,
  'TEST-BALANCE', 'cash', 4.25, NULL, 'diagnóstico'
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
    RAISE EXCEPTION 'Depósito y balance no conservaron FX distintos.';
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
  IF v_deposit.bank_fee_eur <> 3.50
     OR v_deposit.actual_amount_eur = round(v_deposit.amount_original * 0.126, 2) + 3.50 THEN
    RAISE EXCEPTION 'La comisión no quedó separada del importe proveedor.';
  END IF;

  SELECT count(*) INTO v_changed
  FROM public.orden_items current_row
  JOIN _snapshot_order_items snapshot_row USING (id)
  WHERE to_jsonb(current_row) IS DISTINCT FROM to_jsonb(snapshot_row);
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'Pagar proveedor modificó líneas de orden.';
  END IF;

  SELECT count(*) INTO v_changed
  FROM public.order_proforma_versions current_row
  JOIN _snapshot_proformas snapshot_row USING (id)
  WHERE to_jsonb(current_row) IS DISTINCT FROM to_jsonb(snapshot_row);
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'Pagar proveedor modificó proformas.';
  END IF;

  BEGIN
    PERFORM public.mark_supplier_payment_paid(
      v_context.deposit_payment_id, v_context.order_id, now(), 0.5, NULL,
      'OVERWRITE', 'cash', NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'La repetición sobre un pago pagado no fue rechazada.';
  END IF;
END;
$$;

ROLLBACK TO SAVEPOINT before_distinct_fx;
SAVEPOINT before_negative_tests;

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
  v_rejected boolean := false;
  v_non_target public.finance_supplier_payments%ROWTYPE;
  v_non_target_before public.finance_supplier_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_context FROM _payment_fx_context;
  BEGIN
    PERFORM public.mark_supplier_payment_paid(
      v_context.deposit_payment_id, v_context.order_id, now(), 0, NULL,
      NULL, 'cash', NULL, NULL, NULL
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'FX cero no fue rechazado.';
  END IF;

  SELECT * INTO v_non_target FROM public.finance_supplier_payments
    WHERE id = v_context.balance_payment_id;
  SELECT * INTO v_non_target_before FROM _snapshot_supplier_payments
    WHERE id = v_context.balance_payment_id;
  IF to_jsonb(v_non_target) IS DISTINCT FROM to_jsonb(v_non_target_before) THEN
    RAISE EXCEPTION 'El rechazo de FX modificó el pago no objetivo.';
  END IF;
END;
$$;

-- Prueba EUR aislada sobre el pago depósito; el savepoint restaura el fixture.
UPDATE public.finance_supplier_payments
SET original_currency = 'EUR', amount_original = 100
WHERE id = (SELECT deposit_payment_id FROM _payment_fx_context);

SELECT public.mark_supplier_payment_paid(
  deposit_payment_id, order_id, now(), NULL, NULL,
  'TEST-EUR', 'cash', NULL, NULL, 'diagnóstico EUR'
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
     OR v_payment.original_currency <> 'EUR' THEN
    RAISE EXCEPTION 'La regla automática de pago EUR falló.';
  END IF;
END;
$$;

ROLLBACK TO SAVEPOINT before_negative_tests;

DO $$
DECLARE
  v_context _payment_fx_context%ROWTYPE;
  v_changed integer;
BEGIN
  SELECT * INTO v_context FROM _payment_fx_context;

  SELECT count(*) INTO v_changed
  FROM public.finance_supplier_payments current_row
  JOIN _snapshot_supplier_payments snapshot_row USING (id)
  WHERE to_jsonb(current_row) IS DISTINCT FROM to_jsonb(snapshot_row);
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'Los pagos no volvieron al snapshot inicial: % filas.', v_changed;
  END IF;

  SELECT count(*) INTO v_changed
  FROM public.orden_items current_row
  JOIN _snapshot_order_items snapshot_row USING (id)
  WHERE to_jsonb(current_row) IS DISTINCT FROM to_jsonb(snapshot_row);
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'Las líneas de orden fueron modificadas.';
  END IF;

  SELECT count(*) INTO v_changed
  FROM public.order_proforma_versions current_row
  JOIN _snapshot_proformas snapshot_row USING (id)
  WHERE to_jsonb(current_row) IS DISTINCT FROM to_jsonb(snapshot_row);
  IF v_changed <> 0 THEN
    RAISE EXCEPTION 'Las proformas fueron modificadas.';
  END IF;
END;
$$;

ROLLBACK;
