-- Ejecutar exclusivamente en una base de pruebas despues de aplicar
-- 20260722_linked_purchase_payment_batches.sql. Nunca ejecutar en produccion.
-- Todos los fixtures y movimientos se revierten al final.

BEGIN;

DO $preflight$
DECLARE
  v_invalid_statuses text;
  v_status_checks text;
  v_triggers text;
BEGIN
  SELECT string_agg(DISTINCT status, ', ') INTO v_invalid_statuses
  FROM public.finance_supplier_payments
  WHERE status NOT IN ('pendiente', 'parcial', 'pagado', 'vencido');
  IF v_invalid_statuses IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_INVALID_STATUSES: %', v_invalid_statuses;
  END IF;

  SELECT string_agg(conname || ': ' || pg_get_constraintdef(oid), E'\n')
  INTO v_status_checks
  FROM pg_constraint
  WHERE conrelid = 'public.finance_supplier_payments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  RAISE NOTICE 'Status checks:%', E'\n' || coalesce(v_status_checks, '(none)');

  IF to_regclass('public.finance_purchase_payment_batches') IS NULL
     OR to_regclass('public.finance_purchase_payment_allocations') IS NULL
     OR to_regclass('public.finance_supplier_payments') IS NULL
     OR to_regclass('public.finance_cash_accounts') IS NULL
     OR to_regclass('public.finance_credit_lines') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_MISSING_TABLE: required finance table missing';
  END IF;
  IF to_regprocedure(
    'public.finance_create_credit_line_drawdown(uuid,numeric,date,text,uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_MISSING_DRAWDOWN: canonical drawdown signature missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'public.finance_purchase_payment_allocations'::regclass
      AND contype = 'f'
  ) < 2 THEN
    RAISE EXCEPTION 'PREFLIGHT_MISSING_FK: allocation batch/payment FKs missing';
  END IF;

  SELECT string_agg(tgname || ' -> ' || pg_get_triggerdef(oid), E'\n')
  INTO v_triggers
  FROM pg_trigger
  WHERE tgrelid = 'public.finance_supplier_payments'::regclass
    AND NOT tgisinternal;
  RAISE NOTICE 'Active supplier payment triggers:%', E'\n' || coalesce(v_triggers, '(none)');
END;
$preflight$;

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
  v_order_multi_a uuid := gen_random_uuid();
  v_order_multi_b uuid := gen_random_uuid();
  v_order_intracap uuid := gen_random_uuid();
  v_order_yubei uuid := gen_random_uuid();
  v_payment_a uuid := gen_random_uuid();
  v_payment_b uuid := gen_random_uuid();
  v_payment_other_agent uuid := gen_random_uuid();
  v_payment_other_currency uuid := gen_random_uuid();
  v_payment_draft uuid := gen_random_uuid();
  v_payment_currency_mismatch uuid := gen_random_uuid();
  v_payment_low_cash uuid := gen_random_uuid();
  v_payment_low_credit uuid := gen_random_uuid();
  v_payment_multi_a uuid := gen_random_uuid();
  v_payment_multi_b uuid := gen_random_uuid();
  v_payment_intracap uuid := gen_random_uuid();
  v_payment_yubei uuid := gen_random_uuid();
  v_factory_a uuid := gen_random_uuid();
  v_factory_b uuid := gen_random_uuid();
  v_product_id uuid;
  v_cash_id uuid := gen_random_uuid();
  v_low_cash_id uuid := gen_random_uuid();
  v_credit_id uuid := gen_random_uuid();
  v_result jsonb;
  v_batch_count bigint;
  v_allocation_count bigint;
  v_movement_count bigint;
  v_failed boolean;
  v_cash_before numeric;
BEGIN
  SELECT id INTO v_user_id FROM auth.users ORDER BY created_at LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_REQUIRED: auth.users needs one test user';
  END IF;
  SELECT id INTO v_product_id FROM public.productos ORDER BY created_at LIMIT 1;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIXTURE_REQUIRED: productos needs one test product for factory detail';
  END IF;

  IF has_table_privilege('authenticated', 'public.finance_purchase_payment_batches', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_purchase_payment_allocations', 'INSERT') THEN
    RAISE EXCEPTION 'ASSERT_FAILED: authenticated must not insert directly into batch tables';
  END IF;
  IF has_table_privilege('authenticated', 'public.finance_supplier_payments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.finance_supplier_payments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.finance_supplier_payments', 'DELETE') THEN
    RAISE EXCEPTION 'ASSERT_FAILED: authenticated has direct supplier settlement writes';
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
  VALUES (v_agent_a, 'TEST Intracap'), (v_agent_b, 'TEST Yubei');
  INSERT INTO public.proveedores(id, nombre)
  VALUES (v_factory_a, 'TEST Factory A'), (v_factory_b, 'TEST Factory B');

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
    (v_order_low_credit, 'TEST-BATCH-H', 'confirmado', v_agent_a, 'USD', current_date),
    (v_order_multi_a, 'TEST-BATCH-MULTI-A', 'confirmado', v_agent_a, 'USD', current_date),
    (v_order_multi_b, 'TEST-BATCH-MULTI-B', 'confirmado', v_agent_a, 'USD', current_date),
    (v_order_intracap, 'TEST-INTRACAP', 'confirmado', v_agent_a, 'USD', current_date),
    (v_order_yubei, 'TEST-YUBEI', 'confirmado', v_agent_b, 'USD', current_date);

  INSERT INTO public.orden_items(orden_id, producto_id, proveedor_id, cantidad)
  VALUES
    (v_order_multi_a, v_product_id, v_factory_a, 1),
    (v_order_multi_b, v_product_id, v_factory_b, 1);

  INSERT INTO public.finance_supplier_payments(
    id, orden_id, payment_type, amount_original, original_currency, amount_eur,
    status, payment_source_type
  ) VALUES
    (v_payment_a, v_order_a, 'DEPOSITO_30', 10000, 'USD', 9000, 'pendiente', NULL),
    (v_payment_b, v_order_b, 'DEPOSITO_30', 5000, 'USD', 4500, 'pendiente', NULL),
    (v_payment_other_agent, v_order_other_agent, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente', 'manual'),
    (v_payment_other_currency, v_order_other_currency, 'DEPOSITO_30', 100, 'EUR', 100, 'pendiente', NULL),
    (v_payment_draft, v_order_draft, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente', NULL),
    (v_payment_currency_mismatch, v_order_currency_mismatch, 'DEPOSITO_30', 1000, 'CNY', 120, 'pendiente', NULL),
    (v_payment_low_cash, v_order_low_cash, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente', NULL),
    (v_payment_low_credit, v_order_low_credit, 'DEPOSITO_30', 1000, 'USD', 900, 'pendiente', NULL),
    (v_payment_multi_a, v_order_multi_a, 'DEPOSITO_30', 600, 'USD', 540, 'pendiente', NULL),
    (v_payment_multi_b, v_order_multi_b, 'DEPOSITO_30', 400, 'USD', 360, 'pendiente', NULL),
    (v_payment_intracap, v_order_intracap, 'DEPOSITO_30', 700, 'USD', 630, 'pendiente', NULL),
    (v_payment_yubei, v_order_yubei, 'DEPOSITO_30', 300, 'USD', 270, 'pendiente', NULL);

  UPDATE public.ordenes_compra SET moneda_compra = 'EUR' WHERE id = v_order_other_currency;

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

  -- La revocacion debe bloquear DML directo sin abortar el resto del diagnostico.
  v_failed := false;
  BEGIN
    UPDATE public.finance_supplier_payments SET status = 'pagado' WHERE id = v_payment_a;
  EXCEPTION WHEN insufficient_privilege THEN v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: authenticated updated status directly'; END IF;

  -- sync SECURITY DEFINER clasifica numericos especiales y moneda antes de escribir.
  FOREACH v_result IN ARRAY ARRAY[
    jsonb_build_object('amount_original', 'NaN', 'amount_eur', 900, 'fx', 0.9, 'currency', 'USD', 'error', 'INVALID_PLAN_AMOUNT:%'),
    jsonb_build_object('amount_original', 1000, 'amount_eur', 'NaN', 'fx', 0.9, 'currency', 'USD', 'error', 'INVALID_PLAN_EUR_AMOUNT:%'),
    jsonb_build_object('amount_original', 1000, 'amount_eur', 900, 'fx', 'Infinity', 'currency', 'USD', 'error', 'INVALID_PLAN_FX:%'),
    jsonb_build_object('amount_original', 1000, 'amount_eur', 900, 'fx', 0.9, 'currency', 'JPY', 'error', 'INVALID_PLAN_CURRENCY:%')
  ]
  LOOP
    v_failed := false;
    BEGIN
      PERFORM public.sync_supplier_payment_plan(
        v_order_low_cash, 'DEPOSITO_30', current_date + 10,
        (v_result->>'amount_original')::numeric, v_result->>'currency',
        (v_result->>'fx')::numeric, (v_result->>'amount_eur')::numeric,
        'propio', NULL, 'pendiente', NULL, false
      );
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE (v_result->>'error');
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: invalid sync input was accepted'; END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.finance_supplier_payments
    WHERE id = v_payment_low_cash AND amount_original = 1000 AND amount_eur = 900
  ) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: rejected sync input modified obligation';
  END IF;

  -- La RPC publica debe rechazar numeric especiales antes de cualquier escritura.
  -- Cada subtransaccion comprueba rollback de batch, allocation, movimiento y saldo.
  FOREACH v_result IN ARRAY ARRAY[
    jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 'NaN', 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-nan-amount',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_a, 'allocated_amount_original', 10000))
    ),
    jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 10000, 'original_currency', 'USD', 'actual_fx_rate', 'NaN',
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-nan-fx',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_a, 'allocated_amount_original', 10000))
    ),
    jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 10000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'bank_fee_eur', 'NaN', 'paid_at', now(), 'source_type', 'cash_account',
      'cash_account_id', v_cash_id, 'idempotency_key', 'test-nan-fee',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_a, 'allocated_amount_original', 10000))
    ),
    jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 10000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-nan-allocation',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_a, 'allocated_amount_original', 'NaN'))
    )
  ]
  LOOP
    v_failed := false;
    BEGIN
      PERFORM public.create_and_apply_purchase_payment_batch(v_result);
    EXCEPTION WHEN OTHERS THEN
      v_failed := SQLERRM LIKE 'INVALID_AMOUNT:%'
        OR SQLERRM LIKE 'INVALID_ACTUAL_VALUES:%'
        OR SQLERRM LIKE 'INVALID_FEE:%'
        OR SQLERRM LIKE 'INVALID_ALLOCATION_AMOUNT:%';
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: non-finite numeric was accepted'; END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.finance_purchase_payment_batches
    WHERE idempotency_key LIKE 'test-nan-%'
  ) OR EXISTS (
    SELECT 1 FROM public.finance_purchase_payment_allocations
    WHERE supplier_payment_id = v_payment_a
  ) OR EXISTS (
    SELECT 1 FROM public.finance_cash_movements
    WHERE source_type = 'purchase_payment_batch'
      AND notes LIKE '%test-nan-%'
  ) OR (SELECT balance FROM public.finance_cash_accounts WHERE id = v_cash_id) <> 100000 THEN
    RAISE EXCEPTION 'ASSERT_FAILED: rejected non-finite payload changed settlement state';
  END IF;

  FOREACH v_result IN ARRAY ARRAY[
    jsonb_build_object(
      'payee_type', 'agent', 'agent_id', 'not-a-uuid', 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-invalid-uuid',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_a, 'allocated_amount_original', 1000)),
      'expected', 'INVALID_UUID:%'
    ),
    jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', '2026-02-31', 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-invalid-date',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_a, 'allocated_amount_original', 1000)),
      'expected', 'INVALID_PAID_AT:%'
    )
  ]
  LOOP
    v_failed := false;
    BEGIN
      PERFORM public.create_and_apply_purchase_payment_batch(v_result - 'expected');
    EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE (v_result->>'expected');
    END;
    IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: invalid identifier/date was accepted'; END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM public.finance_purchase_payment_batches
    WHERE idempotency_key IN ('test-invalid-uuid', 'test-invalid-date')
  ) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: invalid identifier/date created a batch';
  END IF;

  -- Legacy manual: visible en planificacion general, nunca candidato ni liquidable.
  IF EXISTS (
    SELECT 1 FROM public.get_purchase_payment_candidates(NULL)
    WHERE supplier_payment_id = v_payment_other_agent
  ) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: legacy manual obligation appears as candidate';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_b, 'entry_mode', 'selected_payments',
      'amount_original', 1000, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-legacy-manual',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_other_agent, 'allocated_amount_original', 1000))
    ));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE 'LEGACY_MANUAL_PAYMENT:%';
  END;
  IF NOT v_failed OR EXISTS (
    SELECT 1 FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = 'test-legacy-manual'
  ) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: legacy manual obligation was settled';
  END IF;
  -- Batch real multiorden/multifabrica: una transferencia, dos aplicaciones.
  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
    'amount_original', 1000, 'original_currency', 'USD', 'actual_amount_eur', 900,
    'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
    'idempotency_key', 'test-real-multi-order',
    'allocations', jsonb_build_array(
      jsonb_build_object('supplier_payment_id', v_payment_multi_a, 'allocated_amount_original', 600),
      jsonb_build_object('supplier_payment_id', v_payment_multi_b, 'allocated_amount_original', 400)
    )
  ));
  IF jsonb_array_length(v_result->'allocations') <> 2
     OR (SELECT count(*) FROM public.finance_cash_movements
         WHERE source_type = 'purchase_payment_batch'
           AND source_id = (v_result->'batch'->>'id')::uuid) <> 1
     OR (SELECT sum(allocated_amount_original) FROM public.finance_purchase_payment_allocations
         WHERE batch_id = (v_result->'batch'->>'id')::uuid) <> 1000
     OR (SELECT sum(allocated_amount_eur) FROM public.finance_purchase_payment_allocations
         WHERE batch_id = (v_result->'batch'->>'id')::uuid) <> 900
     OR (SELECT count(*) FROM public.finance_supplier_payments
         WHERE id IN (v_payment_multi_a, v_payment_multi_b) AND status = 'pagado') <> 2
     OR (v_result->'batch'->>'funded_total_eur')::numeric <> 900 THEN
    RAISE EXCEPTION 'ASSERT_FAILED: real multi-order batch integrity';
  END IF;
  v_result := public.get_purchase_payment_batch_detail((v_result->'batch'->>'id')::uuid);
  IF v_result::text NOT LIKE '%TEST Factory A%'
     OR v_result::text NOT LIKE '%TEST Factory B%' THEN
    RAISE EXCEPTION 'ASSERT_FAILED: both factories missing from batch detail';
  END IF;

  -- El mismo payload no puede mezclar Intracap/Yubei (agentes distintos).
  SELECT balance INTO v_cash_before FROM public.finance_cash_accounts WHERE id = v_cash_id;
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 1400, 'original_currency', 'USD', 'actual_fx_rate', 0.9,
      'paid_at', now(), 'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-multi-agent-rollback',
      'allocations', jsonb_build_array(
        jsonb_build_object('supplier_payment_id', v_payment_intracap, 'allocated_amount_original', 700),
        jsonb_build_object('supplier_payment_id', v_payment_yubei, 'allocated_amount_original', 300)
      )
    ));
  EXCEPTION WHEN OTHERS THEN v_failed := SQLERRM LIKE 'AGENT_MISMATCH:%';
  END;
  IF NOT v_failed OR EXISTS (
    SELECT 1 FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = 'test-multi-agent-rollback'
  ) OR EXISTS (
    SELECT 1 FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE b.idempotency_key = 'test-multi-agent-rollback'
  ) OR EXISTS (
    SELECT 1 FROM public.finance_cash_movements m
    JOIN public.finance_purchase_payment_batches b ON b.id = m.source_id
    WHERE b.idempotency_key = 'test-multi-agent-rollback'
  ) OR EXISTS (
    SELECT 1 FROM public.finance_supplier_payments
    WHERE id IN (v_payment_intracap, v_payment_yubei)
      AND (status <> 'pendiente' OR actual_amount_original IS NOT NULL OR actual_amount_eur IS NOT NULL)
  ) OR (SELECT balance FROM public.finance_cash_accounts WHERE id = v_cash_id) <> v_cash_before THEN
    RAISE EXCEPTION 'ASSERT_FAILED: mixed-agent payload did not roll back';
  END IF;

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

  -- El sync puede mover due_date pero conserva todo el settlement parcial.
  PERFORM public.sync_supplier_payment_plan(
    v_order_a, 'DEPOSITO_30', current_date + 30, 10000, 'USD',
    NULL, 9000, 'propio', NULL, 'pendiente', 'updated plan note', true
  );
  IF NOT EXISTS (
    SELECT 1
    FROM public.finance_supplier_payments
    WHERE id = v_payment_a
      AND status = 'parcial'
      AND actual_amount_original = 4000
      AND actual_amount_eur = 3600
      AND due_date = current_date + 30
      AND payment_source_type = 'cash_account'
      AND cash_account_id = v_cash_id
  ) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: plan sync changed partial settlement';
  END IF;

  -- Pago individual usa el pendiente 6.000, no el original 10.000.
  v_result := public.mark_and_finance_supplier_payment(
    v_payment_a, v_order_a, now(), 0.9, NULL, 'TEST-INDIVIDUAL',
    0, 0, NULL, 'cash_account', v_cash_id, NULL
  );
  IF (v_result->>'batch_id') IS NULL THEN
    RAISE EXCEPTION 'ASSERT_FAILED: individual payment must create canonical batch';
  END IF;
  IF NOT (
    v_result ? 'payment'
    AND v_result ? 'source_type'
    AND v_result ? 'cash_account_id'
    AND v_result ? 'credit_line_id'
    AND v_result ? 'funded_total_eur'
  ) THEN
    RAISE EXCEPTION 'ASSERT_FAILED: individual response contract incomplete';
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
  IF (
    SELECT resulting_status
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_payment_a AND b.idempotency_key = 'test-partial-a'
  ) <> 'parcial' OR (
    SELECT resulting_status
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_payment_a
      AND b.idempotency_key = 'individual-supplier-payment:' || v_payment_a::text
  ) <> 'pagado' THEN
    RAISE EXCEPTION 'ASSERT_FAILED: historical allocation status was not preserved';
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
  PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
    'amount_original', 100, 'original_currency', 'EUR', 'paid_at', '2026-07-24T00:00:00Z',
    'source_type', 'cash_account', 'cash_account_id', v_cash_id,
    'idempotency_key', 'test-eur',
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', v_payment_other_currency, 'allocated_amount_original', 100
    ))
  ));

  -- Reintento idempotente: mismo batch y un solo movimiento.
  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
    'amount_original', 100, 'original_currency', 'EUR', 'paid_at', '2026-07-24T00:00:00Z',
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

  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch(jsonb_build_object(
      'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
      'amount_original', 99, 'original_currency', 'EUR', 'paid_at', '2026-07-24T00:00:00Z',
      'source_type', 'cash_account', 'cash_account_id', v_cash_id,
      'idempotency_key', 'test-eur',
      'allocations', jsonb_build_array(jsonb_build_object(
        'supplier_payment_id', v_payment_other_currency, 'allocated_amount_original', 99
      ))
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := SQLERRM LIKE 'IDEMPOTENCY_PAYLOAD_MISMATCH:%';
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: changed idempotent payload was accepted'; END IF;

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
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SET LOCAL ROLE service_role;
  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent', 'agent_id', v_agent_a, 'entry_mode', 'selected_payments',
    'amount_original', 100, 'original_currency', 'EUR', 'paid_at', '2026-07-24T00:00:00Z',
    'source_type', 'cash_account', 'cash_account_id', v_cash_id,
    'idempotency_key', 'test-eur',
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', v_payment_other_currency, 'allocated_amount_original', 100
    ))
  ));
  IF coalesce((v_result->>'idempotent')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERT_FAILED: service_role could not execute idempotent RPC';
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SET LOCAL ROLE anon;
  v_failed := false;
  BEGIN
    PERFORM public.create_and_apply_purchase_payment_batch('{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ASSERT_FAILED: anon executed mutating RPC'; END IF;
  RESET ROLE;
END;
$test$;

-- Ningun fixture, batch, allocation o movimiento persiste.
ROLLBACK;
