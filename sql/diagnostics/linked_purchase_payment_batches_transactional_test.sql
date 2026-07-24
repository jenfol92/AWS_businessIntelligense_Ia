-- Ejecutar exclusivamente en una base de pruebas despues de aplicar
-- 20260722_linked_purchase_payment_batches.sql. Nunca ejecutar en produccion.
-- Todos los fixtures y movimientos se revierten al final.

BEGIN;

DO $test$
DECLARE
  v_user_id uuid;
  v_agent_a uuid := gen_random_uuid();
  v_agent_b uuid := gen_random_uuid();
  v_order_a uuid := gen_random_uuid();
  v_order_b uuid := gen_random_uuid();
  v_order_other_agent uuid := gen_random_uuid();
  v_order_other_currency uuid := gen_random_uuid();
  v_order_draft uuid := gen_random_uuid();
  v_order_currency_mismatch uuid := gen_random_uuid();
  v_order_low_cash uuid := gen_random_uuid();
  v_order_low_credit uuid := gen_random_uuid();
  v_payment_a uuid := gen_random_uuid();
  v_payment_b uuid := gen_random_uuid();
  v_payment_other_agent uuid := gen_random_uuid();
  v_payment_other_currency uuid := gen_random_uuid();
  v_payment_draft uuid := gen_random_uuid();
  v_payment_currency_mismatch uuid := gen_random_uuid();
  v_payment_low_cash uuid := gen_random_uuid();
  v_payment_low_credit uuid := gen_random_uuid();
  v_cash_id uuid := gen_random_uuid();
  v_low_cash_id uuid := gen_random_uuid();
  v_credit_id uuid := gen_random_uuid();
  v_result jsonb;
  v_batch_count bigint;
  v_allocation_count bigint;
  v_movement_count bigint;
  v_failed boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_REQUIRED: auth.users needs one test user';
  END IF;

  IF has_table_privilege('authenticated', 'public.finance_purchase_payment_batches', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_purchase_payment_allocations', 'INSERT') THEN
    RAISE EXCEPTION 'ASSERT_FAILED: authenticated must not insert directly into batch tables';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.create_and_apply_purchase_payment_batch(jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: authenticated needs RPC execute';
  END IF;
  IF has_function_privilege('anon', 'public.create_and_apply_purchase_payment_batch(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERT_FAILED: anon must not execute mutating RPC';
  END IF;

  INSERT INTO public.agentes_compra(id, contacto)
  VALUES (v_agent_a, 'TEST Batch Agent A'), (v_agent_b, 'TEST Batch Agent B');

  INSERT INTO public.ordenes_compra(
    id, numero_orden, estado, agente_id, moneda_compra, fecha_orden
  ) VALUES
    (v_order_a, 'TEST-BATCH-A', 'confirmado', v_agent_a, 'USD', current_date),
    (v_order_b, 'TEST-BATCH-B', 'confirmado', v_agent_a, 'USD', current_date),
    (v_order_other_agent, 'TEST-BATCH-C', 'confirmado', v_agent_b, 'USD', current_date),
    (v_order_other_currency, 'TEST-BATCH-D', 'confirmado', v_agent_a, 'CNY', current_date),
    (v_order_draft, 'TEST-BATCH-E', 'borrador', v_agent_a, 'USD', current_date),
    (v_order_currency_mismatch, 'TEST-BATCH-F', 'confirmado', v_agent_a, 'CNY', current_date),
    (v_order_low_cash, 'TEST-BATCH-G', 'confirmado', v_agent_a, 'USD', current_date),
    (v_order_low_credit, 'TEST-BATCH-H', 'confirmado', v_agent_a, 'USD', current_date);

  INSERT INTO public.finance_supplier_payments(
    id, orden_id, payment_type, amount_original, original_currency, amount_eur, status
  ) VALUES
    (v_payment_a, v_order_a, 'DEPOSITO_30', 10000, 'USD', 9000, 'pendiente'),
    (v_payment_b, v_order_b, 'DEPOSITO_30', 5000, 'USD', 4500, 'pendiente'),
    (v_payment_other_agent, v_order_other_agent, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente'),
    (v_payment_other_currency, v_order_other_currency, 'DEPOSITO_30', 1000, 'CNY', 120, 'pendiente'),
    (v_payment_draft, v_order_draft, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente'),
    (v_payment_currency_mismatch, v_order_currency_mismatch, 'DEPOSITO_30', 1000, 'CNY', 120, 'pendiente'),
    (v_payment_low_cash, v_order_low_cash, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente'),
    (v_payment_low_credit, v_order_low_credit, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente');

  INSERT INTO public.finance_cash_accounts(id, name, balance, currency)
  VALUES
    (v_cash_id, 'TEST Batch Cash ' || v_cash_id, 100000, 'EUR'),
    (v_low_cash_id, 'TEST Batch Low Cash ' || v_low_cash_id, 1, 'EUR');

  INSERT INTO public.finance_credit_lines(
    id, bank_name, line_name, credit_limit, available_amount, used_amount,
    repayment_mode, status
  ) VALUES (
    v_credit_id, 'TEST Bank', 'TEST Insufficient', 10, 10, 0, 'periodic_release', 'activa'
  );

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  SET LOCAL ROLE authenticated;

  -- Parcial: 4.000 de 10.000; comisiones no reducen principal.
  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'free_amount',
    'amount_original', 4000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
    'bank_fee_eur', 25, 'ff_fee_eur', 10, 'paid_at', now(),
    'source_type', 'cash_account', 'cash_account_id', v_cash_id,
    'idempotency_key', 'test-partial-a',
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', v_payment_a, 'allocated_amount_original', 4000
    ))
  ));
  IF v_result->'batch'->>'funded_total_eur' <> '3635.00' THEN
    RAISE EXCEPTION 'ASSERT_FAILED: funded total or separated fees';
  END IF;
  IF (SELECT status FROM public.finance_supplier_payments WHERE id = v_payment_a) <> 'parcial' THEN
    RAISE EXCEPTION 'ASSERT_FAILED: first allocation must leave partial status';
  END IF;

  -- Pago individual usa el pendiente 6.000, no el original 10.000.
  v_result := public.mark_and_finance_supplier_payment(
    v_payment_a, v_order_a, now(), 0.9, NULL, 'TEST-INDIVIDUAL',
    0, 0, NULL, 'cash_account', v_cash_id, NULL
  );
  IF (v_result->>'batch_id') IS NULL THEN
    RAISE EXCEPTION 'ASSERT_FAILED: individual payment must create canonical batch';
  END IF;
  IF (
    SELECT allocated_amount_original
    FROM public.finance_purchase_payment_allocations
    WHERE batch_id = (v_result->>'batch_id')::uuid
  ) <> 6000 THEN
    RAISE EXCEPTION 'ASSERT_FAILED: individual payment must allocate only pending 6000';
  END IF;
  IF (SELECT status FROM public.finance_supplier_payments WHERE id = v_payment_a) <> 'pagado' THEN
    RAISE EXCEPTION 'ASSERT_FAILED: second payment must complete obligation';
  END IF;

  -- Mismo agente y obligaciones de ordenes distintas es valido.
  PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
    'amount_original', 5000, 'original_currency', 'USD', 'actual_amount_eur', 4500,
    'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
    'idempotency_key', 'test-same-agent',
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', v_payment_b, 'allocated_amount_original', 5000
    ))
  ));

  -- EUR no requiere FX ni EUR explicitos.
  UPDATE public.finance_supplier_payments
  SET original_currency = 'EUR', amount_original = 100
  WHERE id = v_payment_other_currency;
  UPDATE public.ordenes_compra SET moneda_compra = 'EUR' WHERE id = v_order_other_currency;
  PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
    'amount_original', 100, 'original_currency', 'EUR', 'paid_at', now(),
    'source_type', 'cash_account', 'cash_account_id', v_cash_id,
    'idempotency_key', 'test-eur',
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', v_payment_other_currency, 'allocated_amount_original', 100
    ))
  ));

  -- Reintento idempotente: mismo batch y un solo movimiento.
  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
    'amount_original', 100, 'original_currency', 'EUR', 'paid_at', now(),
    'source_type', 'cash_account', 'cash_account_id', v_cash_id,
    'idempotency_key', 'test-eur',
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', v_payment_other_currency, 'allocated_amount_original', 100
    ))
  ));
  SELECT count(*) INTO v_batch_count FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = 'test-eur';
  SELECT count(*) INTO v_movement_count FROM public.finance_cash_movements
    WHERE source_type = 'purchase_payment_batch'
      AND source_id = (v_result->'batch'->>'id')::uuid;
  IF v_batch_count <> 1 OR v_movement_count <> 1 OR (v_result->>'idempotent')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERT_FAILED: idempotent retry duplicated batch or movement';
  END IF;

  -- Dos sesiones concurrentes deben usar la misma key. La implementacion se
  -- serializa mediante pg_advisory_xact_lock(hashtextextended(key, 0)); ejecutar
  -- este bloque simultaneamente desde dos conexiones para validar la espera real.
  IF position('pg_advisory_xact_lock' in pg_get_functiondef(
    'public.create_and_apply_purchase_payment_batch(jsonb)'::regprocedure
  )) = 0 THEN
    RAISE EXCEPTION 'ASSERT_FAILED: concurrent idempotency lock missing';
  END IF;

  -- Orden no confirmada.
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-draft',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_draft, 'allocated_amount_original', 1000
      ))
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE 'ORDER_NOT_CONFIRMED:%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: draft order was accepted'; END IF;

  -- Agente distinto.
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-agent-mismatch',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_other_agent, 'allocated_amount_original', 1000
      ))
    ));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE 'AGENT_MISMATCH:%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: mixed agent was accepted'; END IF;

  -- Moneda distinta.
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-currency-mismatch',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_currency_mismatch, 'allocated_amount_original', 1000
      ))
    ));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE 'CURRENCY_MISMATCH:%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: mixed currency was accepted'; END IF;

  -- Caja insuficiente revierte cabecera y allocations.
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_low_cash_id,
      'idempotency_key', 'test-low-cash',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_low_cash, 'allocated_amount_original', 1000
      ))
    ));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE 'INSUFFICIENT_CASH:%';
  END;
  SELECT count(*) INTO v_batch_count FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = 'test-low-cash';
  SELECT count(*) INTO v_allocation_count FROM public.finance_purchase_payment_allocations
    WHERE supplier_payment_id = v_payment_low_cash;
  IF NOT v_failed OR v_batch_count <> 0 OR v_allocation_count <> 0 THEN
    RAISE EXCEPTION 'ASSERT_FAILED: insufficient cash did not roll back';
  END IF;

  -- Credito insuficiente revierte todo.
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'credit_line', 'credit_line_id', v_credit_id,
      'idempotency_key', 'test-low-credit',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_low_credit, 'allocated_amount_original', 1000
      ))
    ));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE 'INSUFFICIENT_CREDIT:%';
  END;
  SELECT count(*) INTO v_batch_count FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = 'test-low-credit';
  IF NOT v_failed OR v_batch_count <> 0 THEN
    RAISE EXCEPTION 'ASSERT_FAILED: insufficient credit did not roll back';
  END IF;

  RESET ROLE;
END;
$test$;

-- Ningun fixture, batch, allocation o movimiento persiste.
ROLLBACK;
