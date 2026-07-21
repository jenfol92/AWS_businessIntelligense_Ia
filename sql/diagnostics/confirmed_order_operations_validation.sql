-- Validación de humo para update_confirmed_purchase_order_operations y
-- create_order_proforma_version en base de PRUEBAS.
--
-- USO:
--   1. Declarar test_order_id con \set test_order_id '...' (uuid de una orden
--      CONFIRMADA de prueba, sin impacto en producción) antes de ejecutar en
--      psql. La orden debe cumplir los fixtures descritos más abajo; si no
--      los cumple, el script aborta con un mensaje FIXTURE_FALTANTE explícito.
--   2. Ejecutar completo. Cada caso valida con asserts reales (no solo
--      SELECT visuales) y termina siempre en ROLLBACK: no persiste nada.
--   3. NO ejecutar contra producción. NO quitar el ROLLBACK final.
--
-- No se ejecuta en esta sesión; solo se entrega el archivo.

\set test_order_id '00000000-0000-0000-0000-000000000000'

BEGIN;

-- Contexto de prueba: evita depender de la sustitución de :'test_order_id'
-- dentro de bloques DO $$ ... $$; cada bloque lee el id desde esta tabla.
CREATE TEMP TABLE _confirmed_order_test_context (
  order_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _confirmed_order_test_context(order_id)
VALUES (:'test_order_id'::uuid);

-- ── Fixtures ─────────────────────────────────────────────────────────────
-- Aborta con un mensaje explícito de qué fixture falta en vez de dejar que
-- los tests posteriores fallen con errores confusos o, peor, pasen por
-- ausencia de datos que probar.
DO $$
DECLARE
  v_order_id uuid;
  v_order public.ordenes_compra;
  v_has_balance70_open boolean;
  v_has_deposito30 boolean;
  v_has_paid boolean;
  v_has_active_logistics boolean;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  SELECT * INTO v_order FROM public.ordenes_compra WHERE id = v_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FIXTURE_FALTANTE: la orden % no existe. Ajusta \set test_order_id con una orden de prueba real.', v_order_id;
  END IF;

  IF v_order.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'FIXTURE_FALTANTE: la orden % no está confirmada (estado=%). Usa una orden confirmada de prueba.', v_order_id, v_order.estado;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.finance_supplier_payments
    WHERE orden_id = v_order_id AND payment_type = 'BALANCE_70' AND status IN ('pendiente', 'vencido')
  ) INTO v_has_balance70_open;
  IF NOT v_has_balance70_open THEN
    RAISE EXCEPTION 'FIXTURE_FALTANTE: la orden % no tiene BALANCE_70 pendiente o vencido (necesario para los tests 2, 3, 4, 5 y 8).', v_order_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.finance_supplier_payments
    WHERE orden_id = v_order_id AND payment_type = 'DEPOSITO_30'
  ) INTO v_has_deposito30;
  IF NOT v_has_deposito30 THEN
    RAISE EXCEPTION 'FIXTURE_FALTANTE: la orden % no tiene DEPOSITO_30 (necesario para el test 7).', v_order_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.finance_supplier_payments
    WHERE orden_id = v_order_id AND status = 'pagado'
  ) INTO v_has_paid;
  IF NOT v_has_paid THEN
    RAISE EXCEPTION 'FIXTURE_FALTANTE: la orden % no tiene ningún pago pagado (necesario para el test 6, pagos pagados intactos).', v_order_id;
  END IF;

  -- Mismo criterio que usa la RPC para bloquear el cambio de tipo_envio.
  SELECT
    EXISTS (SELECT 1 FROM public.contenedor_ordenes co WHERE co.orden_id = v_order_id)
    OR EXISTS (
      SELECT 1 FROM public.orden_logistics_assignments ola
      WHERE ola.orden_id = v_order_id
        AND ola.status = 'active'
        AND ola.assignment_type IN ('contenedor_propio', 'amazon_inbound')
    )
  INTO v_has_active_logistics;
  IF v_has_active_logistics THEN
    RAISE EXCEPTION 'FIXTURE_FALTANTE: la orden % tiene una asignación logística activa que impediría cambiar entre propio y Amazon AGL en los tests 2 y 3. Usa una orden de prueba sin contenedor ni envío Amazon activos.', v_order_id;
  END IF;

  RAISE NOTICE 'fixtures_ok: orden % confirmada, BALANCE_70 abierto, DEPOSITO_30 presente, con pago pagado y sin asignación logística activa.', v_order_id;
END;
$$;

-- ── Snapshots ────────────────────────────────────────────────────────────
-- Estado previo a cualquier patch, usado por los asserts posteriores.
CREATE TEMP TABLE _snapshot_ordenes_compra ON COMMIT DROP AS
SELECT * FROM public.ordenes_compra
WHERE id = (SELECT order_id FROM _confirmed_order_test_context);

CREATE TEMP TABLE _snapshot_finance_supplier_payments ON COMMIT DROP AS
SELECT * FROM public.finance_supplier_payments
WHERE orden_id = (SELECT order_id FROM _confirmed_order_test_context);

CREATE TEMP TABLE _snapshot_order_proforma_versions ON COMMIT DROP AS
SELECT * FROM public.order_proforma_versions
WHERE orden_id = (SELECT order_id FROM _confirmed_order_test_context);

-- Vista informativa (no forma parte de los asserts).
SELECT 'snapshot_inicial' AS caso, *
FROM _snapshot_ordenes_compra;

SELECT 'snapshot_inicial' AS caso, payment_type, status, due_date, amount_original, amount_eur, logistics_type
FROM _snapshot_finance_supplier_payments
ORDER BY payment_type;

-- 1) Patch solo destino: no debe tocar pagos ni proformas.
DO $$
DECLARE
  v_order_id uuid;
  v_changed_payments integer;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  PERFORM public.update_confirmed_purchase_order_operations(
    v_order_id,
    jsonb_build_object('destino', 'Puerto de prueba 1')
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.ordenes_compra WHERE id = v_order_id AND destino = 'Puerto de prueba 1'
  ) THEN
    RAISE EXCEPTION 'test_1_FALLO: destino no se actualizó a "Puerto de prueba 1"';
  END IF;

  SELECT count(*) INTO v_changed_payments
  FROM public.finance_supplier_payments fsp
  JOIN _snapshot_finance_supplier_payments s ON s.id = fsp.id
  WHERE (fsp.due_date, fsp.status, fsp.amount_original, fsp.amount_eur, fsp.logistics_type, fsp.planned_fx_rate)
        IS DISTINCT FROM (s.due_date, s.status, s.amount_original, s.amount_eur, s.logistics_type, s.planned_fx_rate);

  IF v_changed_payments <> 0 THEN
    RAISE EXCEPTION 'test_1_FALLO: el patch de destino modificó % pago(s), debería ser 0', v_changed_payments;
  END IF;

  IF EXISTS (SELECT 1 FROM public.order_proforma_versions WHERE orden_id = v_order_id) THEN
    RAISE EXCEPTION 'test_1_FALLO: el patch de destino creó una versión de proforma';
  END IF;

  RAISE NOTICE 'test_1_ok';
END;
$$;

-- 2) Patch ETA (logística propia): debe recalcular BALANCE_70 pendiente/vencido.
DO $$
DECLARE
  v_order_id uuid;
  v_new_eta date := CURRENT_DATE + 30;
  v_balance_days integer;
  v_expected_due date;
  v_expected_status text;
  v_actual record;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  PERFORM public.update_confirmed_purchase_order_operations(
    v_order_id,
    jsonb_build_object('tipo_envio', 'propio', 'eta', v_new_eta::text)
  );

  SELECT greatest(0, coalesce(balance_dias_antes_eta, 10)) INTO v_balance_days
  FROM public.ordenes_compra WHERE id = v_order_id;

  v_expected_due := v_new_eta - v_balance_days;
  v_expected_status := CASE WHEN v_expected_due < CURRENT_DATE THEN 'vencido' ELSE 'pendiente' END;

  SELECT due_date, status, logistics_type INTO v_actual
  FROM public.finance_supplier_payments
  WHERE orden_id = v_order_id AND payment_type = 'BALANCE_70';

  IF v_actual.due_date IS DISTINCT FROM v_expected_due
     OR v_actual.status IS DISTINCT FROM v_expected_status
     OR v_actual.logistics_type IS DISTINCT FROM 'propio' THEN
    RAISE EXCEPTION 'test_2_FALLO: BALANCE_70 esperado due_date=%, status=%, logistics_type=propio; obtenido due_date=%, status=%, logistics_type=%',
      v_expected_due, v_expected_status, v_actual.due_date, v_actual.status, v_actual.logistics_type;
  END IF;

  RAISE NOTICE 'test_2_ok';
END;
$$;

-- 3) Patch ETD (Amazon AGL): balance vence en la fecha ETD.
DO $$
DECLARE
  v_order_id uuid;
  v_new_etd date := CURRENT_DATE + 5;
  v_expected_status text;
  v_actual record;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  PERFORM public.update_confirmed_purchase_order_operations(
    v_order_id,
    jsonb_build_object('tipo_envio', 'amazon_agl', 'etd', v_new_etd::text)
  );

  v_expected_status := CASE WHEN v_new_etd < CURRENT_DATE THEN 'vencido' ELSE 'pendiente' END;

  SELECT due_date, status, logistics_type INTO v_actual
  FROM public.finance_supplier_payments
  WHERE orden_id = v_order_id AND payment_type = 'BALANCE_70';

  IF v_actual.due_date IS DISTINCT FROM v_new_etd
     OR v_actual.status IS DISTINCT FROM v_expected_status
     OR v_actual.logistics_type IS DISTINCT FROM 'amazon_agl' THEN
    RAISE EXCEPTION 'test_3_FALLO: BALANCE_70 esperado due_date=%, status=%, logistics_type=amazon_agl; obtenido due_date=%, status=%, logistics_type=%',
      v_new_etd, v_expected_status, v_actual.due_date, v_actual.status, v_actual.logistics_type;
  END IF;

  RAISE NOTICE 'test_3_ok';
END;
$$;

-- 4) Cambio pendiente → vencido: ETA en el pasado (vuelve a logística propia).
DO $$
DECLARE
  v_order_id uuid;
  v_new_eta date := CURRENT_DATE - 5;
  v_balance_days integer;
  v_expected_due date;
  v_actual record;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  PERFORM public.update_confirmed_purchase_order_operations(
    v_order_id,
    jsonb_build_object('tipo_envio', 'propio', 'eta', v_new_eta::text)
  );

  SELECT greatest(0, coalesce(balance_dias_antes_eta, 10)) INTO v_balance_days
  FROM public.ordenes_compra WHERE id = v_order_id;
  v_expected_due := v_new_eta - v_balance_days;

  SELECT due_date, status INTO v_actual
  FROM public.finance_supplier_payments
  WHERE orden_id = v_order_id AND payment_type = 'BALANCE_70';

  IF v_actual.status <> 'vencido' THEN
    RAISE EXCEPTION 'test_4_FALLO: BALANCE_70 debería quedar vencido tras ETA pasada, obtenido status=%', v_actual.status;
  END IF;
  IF v_actual.due_date IS DISTINCT FROM v_expected_due THEN
    RAISE EXCEPTION 'test_4_FALLO: due_date esperado %, obtenido %', v_expected_due, v_actual.due_date;
  END IF;

  RAISE NOTICE 'test_4_ok';
END;
$$;

-- 5) Cambio vencido → pendiente: ETA futura de nuevo.
DO $$
DECLARE
  v_order_id uuid;
  v_actual record;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  PERFORM public.update_confirmed_purchase_order_operations(
    v_order_id,
    jsonb_build_object('eta', (CURRENT_DATE + 20)::text)
  );

  SELECT due_date, status INTO v_actual
  FROM public.finance_supplier_payments
  WHERE orden_id = v_order_id AND payment_type = 'BALANCE_70';

  IF v_actual.status <> 'pendiente' THEN
    RAISE EXCEPTION 'test_5_FALLO: BALANCE_70 debería volver a pendiente, obtenido status=%', v_actual.status;
  END IF;

  RAISE NOTICE 'test_5_ok';
END;
$$;

-- 6) Pago(s) marcados 'pagado' en el snapshot inicial deben permanecer
--    idénticos tras todos los patches anteriores.
DO $$
DECLARE
  v_order_id uuid;
  v_changed_count integer;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  SELECT count(*) INTO v_changed_count
  FROM public.finance_supplier_payments fsp
  JOIN _snapshot_finance_supplier_payments s ON s.id = fsp.id
  WHERE s.status = 'pagado'
    AND (fsp.due_date, fsp.status, fsp.amount_original, fsp.amount_eur, fsp.logistics_type, fsp.planned_fx_rate)
        IS DISTINCT FROM (s.due_date, s.status, s.amount_original, s.amount_eur, s.logistics_type, s.planned_fx_rate);

  IF v_changed_count <> 0 THEN
    RAISE EXCEPTION 'test_6_FALLO: % pago(s) pagado(s) cambiaron tras las ediciones operativas, debería ser 0', v_changed_count;
  END IF;

  RAISE NOTICE 'test_6_ok';
END;
$$;

-- 7) DEPOSITO_30 mantiene due_date y amount_original frente al snapshot
--    inicial (la RPC nunca los toca; solo BALANCE_70 recalcula due_date).
DO $$
DECLARE
  v_order_id uuid;
  v_actual record;
  v_snapshot record;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  SELECT due_date, amount_original INTO v_actual
  FROM public.finance_supplier_payments
  WHERE orden_id = v_order_id AND payment_type = 'DEPOSITO_30';

  SELECT due_date, amount_original INTO v_snapshot
  FROM _snapshot_finance_supplier_payments
  WHERE orden_id = v_order_id AND payment_type = 'DEPOSITO_30';

  IF v_actual.due_date IS DISTINCT FROM v_snapshot.due_date
     OR v_actual.amount_original IS DISTINCT FROM v_snapshot.amount_original THEN
    RAISE EXCEPTION 'test_7_FALLO: DEPOSITO_30 cambió (antes due_date=%, amount_original=%; ahora due_date=%, amount_original=%)',
      v_snapshot.due_date, v_snapshot.amount_original, v_actual.due_date, v_actual.amount_original;
  END IF;

  RAISE NOTICE 'test_7_ok';
END;
$$;

-- 8) Cambio de tipo de cambio: solo debe afectar equivalentes EUR de pagos
--    no realizados (pendiente/vencido), usando el mismo fx efectivo que la
--    RPC (1 si la orden es EUR, el valor del patch en cualquier otro caso).
DO $$
DECLARE
  v_order_id uuid;
  v_new_fx numeric := 1.2345;
  v_effective_fx numeric;
  v_actual record;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  SELECT CASE WHEN upper(coalesce(moneda_compra, '')) = 'EUR' THEN 1 ELSE v_new_fx END
  INTO v_effective_fx
  FROM public.ordenes_compra WHERE id = v_order_id;

  PERFORM public.update_confirmed_purchase_order_operations(
    v_order_id,
    jsonb_build_object('tipo_cambio_moneda_eur', v_new_fx)
  );

  SELECT amount_original, amount_eur, planned_fx_rate, status INTO v_actual
  FROM public.finance_supplier_payments
  WHERE orden_id = v_order_id AND payment_type = 'BALANCE_70';

  IF v_actual.status NOT IN ('pendiente', 'vencido') THEN
    RAISE EXCEPTION 'test_8_FALLO: BALANCE_70 no está pendiente/vencido, no se puede validar el cambio de FX (status=%)', v_actual.status;
  END IF;

  IF v_actual.planned_fx_rate IS DISTINCT FROM v_effective_fx
     OR v_actual.amount_eur IS DISTINCT FROM round(v_actual.amount_original * v_effective_fx, 4) THEN
    RAISE EXCEPTION 'test_8_FALLO: amount_eur/planned_fx_rate no reflejan el fx efectivo % (amount_original=%, amount_eur=%, planned_fx_rate=%)',
      v_effective_fx, v_actual.amount_original, v_actual.amount_eur, v_actual.planned_fx_rate;
  END IF;

  RAISE NOTICE 'test_8_ok';
END;
$$;

-- 9) Lead time negativo rechazado (SQLSTATE 22023). El RAISE de fallo del
--    test vive FUERA del bloque que captura la excepción de la RPC, para no
--    poder declararse "ok" atrapando su propio mensaje de fallo.
DO $$
DECLARE
  v_order_id uuid;
  v_rejected boolean := false;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  BEGIN
    PERFORM public.update_confirmed_purchase_order_operations(
      v_order_id,
      jsonb_build_object('lead_time_produccion', -1)
    );
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'test_9_FALLO: debería haber rechazado lead_time_produccion negativo';
  END IF;

  RAISE NOTICE 'test_9_ok';
END;
$$;

-- 10) Fecha inválida rechazada (SQLSTATE 22007, específico de la RPC para
--     ETD/ETA/ETA real malformados).
DO $$
DECLARE
  v_order_id uuid;
  v_rejected boolean := false;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  BEGIN
    PERFORM public.update_confirmed_purchase_order_operations(
      v_order_id,
      jsonb_build_object('eta', 'no-es-una-fecha')
    );
  EXCEPTION
    WHEN SQLSTATE '22007' THEN
      v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'test_10_FALLO: debería haber rechazado una fecha inválida';
  END IF;

  RAISE NOTICE 'test_10_ok';
END;
$$;

-- 11) Campo no permitido rechazado (intento de tocar coste comercial;
--     SQLSTATE 22023, igual que el resto de validaciones de forma).
DO $$
DECLARE
  v_order_id uuid;
  v_rejected boolean := false;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  BEGIN
    PERFORM public.update_confirmed_purchase_order_operations(
      v_order_id,
      jsonb_build_object('coste_unitario_moneda', 99)
    );
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      v_rejected := true;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'test_11_FALLO: debería haber rechazado un campo comercial no permitido';
  END IF;

  RAISE NOTICE 'test_11_ok';
END;
$$;

-- 12) Dos versiones consecutivas de proforma (secuencial dentro de la misma
--     transacción; la seguridad ante concurrencia real depende del
--     FOR UPDATE + UNIQUE de la RPC, no de este test).
DO $$
DECLARE
  v_order_id uuid;
  v_before_max integer;
  v_version_a integer;
  v_version_b integer;
  v_persisted_count integer;
BEGIN
  SELECT order_id INTO v_order_id FROM _confirmed_order_test_context;

  SELECT coalesce(max(version), 0) INTO v_before_max
  FROM public.order_proforma_versions WHERE orden_id = v_order_id;

  SELECT version INTO v_version_a
  FROM public.create_order_proforma_version(v_order_id, '<html>v-a</html>');

  SELECT version INTO v_version_b
  FROM public.create_order_proforma_version(v_order_id, '<html>v-b</html>');

  IF v_version_a IS DISTINCT FROM v_before_max + 1 OR v_version_b IS DISTINCT FROM v_before_max + 2 THEN
    RAISE EXCEPTION 'test_12_FALLO: versiones esperadas %/%, obtenidas %/%',
      v_before_max + 1, v_before_max + 2, v_version_a, v_version_b;
  END IF;

  SELECT count(*) INTO v_persisted_count
  FROM public.order_proforma_versions
  WHERE orden_id = v_order_id AND version IN (v_version_a, v_version_b);

  IF v_persisted_count <> 2 THEN
    RAISE EXCEPTION 'test_12_FALLO: no se encontraron las 2 versiones nuevas persistidas en order_proforma_versions';
  END IF;

  RAISE NOTICE 'test_12_ok';
END;
$$;

-- 13) La RPC comercial antigua no debe existir (tras aplicar
--     20260721_remove_confirmed_commercial_edit_rpc.sql).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'update_confirmed_purchase_order'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, jsonb, jsonb'
  ) THEN
    RAISE EXCEPTION 'test_13_FALLO: la RPC comercial antigua update_confirmed_purchase_order(uuid, jsonb, jsonb) todavía existe';
  END IF;

  RAISE NOTICE 'test_13_ok';
END;
$$;

-- 14) Las RPC operativas deben tener EXECUTE otorgado a authenticated
--     (solo verifica el permiso, no ejecuta como ese rol).
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(p.proname, ', ')
  INTO v_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'update_confirmed_purchase_order_operations',
      'create_order_proforma_version',
      'reopen_confirmed_purchase_order'
    )
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'test_14_FALLO: authenticated no tiene EXECUTE en: %', v_missing;
  END IF;

  RAISE NOTICE 'test_14_ok';
END;
$$;

-- El ROLLBACK deshace TODO lo anterior (patches, versiones de proforma,
-- incluso las tablas temporales de contexto/snapshot): no se persiste nada.
-- No usar COMMIT en este script.
ROLLBACK;
