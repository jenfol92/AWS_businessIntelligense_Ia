-- Ejecutar manualmente en una base de prueba despues de 20260804_01.
-- No inserta datos y toda configuracion local se revierte al finalizar.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_42501(p_sql text, p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'ASSERTION_FAILED: expected 42501 for %', p_sql;
EXCEPTION WHEN insufficient_privilege THEN
  IF p_message IS NOT NULL AND SQLERRM NOT LIKE '%' || p_message || '%' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: expected %, got %', p_message, SQLERRM;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_gate_open()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_sql text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    'SELECT public.finance_create_credit_line_repayment(gen_random_uuid(),1,current_date,gen_random_uuid(),gen_random_uuid(),''repayment_group'',NULL,NULL,NULL,NULL)',
    'SELECT public.mark_and_finance_supplier_payment(gen_random_uuid())',
    'SELECT public.create_and_apply_purchase_payment_batch(''{}''::jsonb)',
    'SELECT public.finance_finance_supplier_payment(gen_random_uuid(),''cash_account'',current_date)',
    'SELECT public.sync_supplier_payment_plan(gen_random_uuid(),''deposit'',current_date,1,''EUR'',NULL,1,''SIN_DEFINIR'',NULL,''pendiente'',NULL,false)',
    'SELECT public.void_pending_supplier_payment_plan(gen_random_uuid())'
  ] LOOP
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = '42501' OR SQLERRM LIKE '%ADMIN_OR_ACCOUNTING_REQUIRED%' THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: authorized actor did not cross gate: %', SQLERRM;
      END IF;
      -- Any later validation/not-found error proves the role gate was crossed.
    END;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
       SELECT 1
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname IN (
           'finance_create_credit_line_repayment','mark_and_finance_supplier_payment',
           'create_and_apply_purchase_payment_batch','finance_finance_supplier_payment',
           'sync_supplier_payment_plan','void_pending_supplier_payment_plan'
         )
         AND a.grantee = 0
         AND a.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon','public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.mark_and_finance_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date)','EXECUTE')
     OR has_function_privilege('anon','public.create_and_apply_purchase_payment_batch(jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.finance_finance_supplier_payment(uuid,text,date,uuid,uuid,text,text)','EXECUTE')
     OR has_function_privilege('anon','public.sync_supplier_payment_plan(uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean)','EXECUTE')
     OR has_function_privilege('anon','public.void_pending_supplier_payment_plan(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC/anon mutator EXECUTE remains';
  END IF;
END $$;

-- anon has neither mutator EXECUTE nor visible detailed rows.
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.finance_credit_lines) <> 0
     OR (SELECT count(*) FROM public.finance_credit_line_repayment_groups) <> 0
     OR (SELECT count(*) FROM public.finance_cash_accounts) <> 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: anon read detailed finance rows';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000001","app_metadata":{"role":"logistics"}}',true);
DO $$ BEGIN
  IF NOT public.finance_can_read_treasury()
     OR public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: logistics capability matrix';
  END IF;
  PERFORM pg_temp.assert_42501('SELECT public.finance_create_credit_line_repayment(gen_random_uuid(),1,current_date,gen_random_uuid())','ADMIN_OR_ACCOUNTING_REQUIRED');
  PERFORM pg_temp.assert_42501('SELECT public.mark_and_finance_supplier_payment(gen_random_uuid())','ADMIN_OR_ACCOUNTING_REQUIRED');
  PERFORM pg_temp.assert_42501('SELECT public.create_and_apply_purchase_payment_batch(''{}''::jsonb)','ADMIN_OR_ACCOUNTING_REQUIRED');
  PERFORM pg_temp.assert_42501('SELECT public.finance_finance_supplier_payment(gen_random_uuid(),''cash_account'',current_date)','ADMIN_OR_ACCOUNTING_REQUIRED');
  PERFORM pg_temp.assert_42501('SELECT public.sync_supplier_payment_plan(gen_random_uuid(),''deposit'',current_date,1,''EUR'',NULL,1,''SIN_DEFINIR'',NULL,''pendiente'')','ADMIN_OR_ACCOUNTING_REQUIRED');
  PERFORM pg_temp.assert_42501('SELECT public.void_pending_supplier_payment_plan(gen_random_uuid())','ADMIN_OR_ACCOUNTING_REQUIRED');
  PERFORM count(*) FROM public.finance_credit_lines;
  PERFORM count(*) FROM public.finance_credit_line_repayment_groups;
  PERFORM count(*) FROM public.finance_cash_accounts;
END $$;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000002","app_metadata":{}}',true);
DO $$ BEGIN
  IF public.finance_can_read_treasury() OR public.finance_can_read_unlinked_details()
     OR (SELECT count(*) FROM public.finance_credit_lines) <> 0
     OR (SELECT count(*) FROM public.finance_credit_line_repayment_groups) <> 0
     OR (SELECT count(*) FROM public.finance_cash_accounts) <> 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: unclassified user received finance access';
  END IF;
  PERFORM pg_temp.assert_42501('SELECT public.finance_create_credit_line_repayment(gen_random_uuid(),1,current_date,gen_random_uuid())','ADMIN_OR_ACCOUNTING_REQUIRED');
END $$;

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000003","app_metadata":{"role":"accounting"}}',true);
SELECT public.finance_can_read_treasury(), public.finance_can_read_unlinked_details();
SELECT count(*) FROM public.finance_credit_lines;
SELECT count(*) FROM public.finance_credit_line_repayment_groups;
SELECT count(*) FROM public.finance_cash_accounts;
SELECT pg_temp.assert_gate_open();

SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000004","app_metadata":{"role":"ADMIN"}}',true);
SELECT public.finance_can_read_treasury(), public.finance_can_read_unlinked_details();
SELECT count(*) FROM public.finance_credit_lines;
SELECT count(*) FROM public.finance_credit_line_repayment_groups;
SELECT count(*) FROM public.finance_cash_accounts;
SELECT pg_temp.assert_gate_open();
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT count(*) FROM public.finance_credit_lines;
SELECT count(*) FROM public.finance_credit_line_repayment_groups;
SELECT count(*) FROM public.finance_cash_accounts;
SELECT pg_temp.assert_gate_open();
RESET ROLE;

-- Structural proof that all three detail policies use the treasury capability.
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'finance_credit_lines',
      'finance_credit_line_repayment_groups',
      'finance_cash_accounts'
    )
    AND cmd = 'SELECT'
    AND qual LIKE '%finance_can_read_treasury%';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: treasury SELECT policy definitions = %', v_count;
  END IF;
END $$;

ROLLBACK;
