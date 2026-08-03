-- Ejecutar manualmente en una base de prueba despues de 20260803_06.
-- Todas las filas sinteticas y objetos temporales se revierten al finalizar.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_42501(p_sql text, p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION 'ASSERTION_FAILED: expected 42501 for %', p_sql;
EXCEPTION WHEN insufficient_privilege THEN
  IF p_message IS NOT NULL AND SQLERRM NOT LIKE '%' || p_message || '%' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: expected message %, got %', p_message, SQLERRM;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assert_management_gate_open()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_sql text;
BEGIN
  FOREACH v_sql IN ARRAY ARRAY[
    'SELECT public.finance_create_unlinked_obligation(''{}''::jsonb)',
    'SELECT public.finance_update_pending_unlinked_obligation(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_replace_unpaid_installment_plan(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_cancel_unlinked_obligation(gen_random_uuid(),''x'')',
    'SELECT public.finance_create_unlinked_obligation_template(''{}''::jsonb)',
    'SELECT public.finance_update_unlinked_obligation_template(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_generate_unlinked_obligation_occurrences(gen_random_uuid(),current_date)'
  ] LOOP
    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = '42501' OR SQLERRM LIKE '%ADMIN_OR_ACCOUNTING_REQUIRED%' THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: management gate rejected %: %', v_sql, SQLERRM;
      END IF;
      -- A domain/not-found error proves execution crossed the authorization gate.
    END;
  END LOOP;
END;
$$;

INSERT INTO public.finance_unlinked_obligations (
  id, origin_type, concept, category, description, amount_breakdown_mode,
  planned_total_eur, lifecycle_status
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'one_off',
  'ROLE AUTHORIZATION SYNTHETIC', 'other', 'SENSITIVE DESCRIPTION',
  'total_only', 200.00, 'active'
);
INSERT INTO public.finance_unlinked_obligation_installments (
  id, obligation_id, plan_revision, sequence_number, due_date,
  amount_breakdown_mode, planned_total_eur, status
) VALUES
(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 1, 1, current_date - 5,
  'total_only', 80.00, 'active'
),
(
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001', 1, 2, current_date + 5,
  'total_only', 120.00, 'active'
);

-- A. anon: no helpers, tables, views, aggregate, or management RPCs.
SET LOCAL ROLE anon;
DO $$
DECLARE v_sql text;
BEGIN
  PERFORM pg_temp.assert_42501('SELECT public.finance_can_read_treasury()');
  PERFORM pg_temp.assert_42501('SELECT public.finance_can_read_unlinked_details()');
  PERFORM pg_temp.assert_42501('SELECT public.finance_can_manage_unlinked_obligations()');
  PERFORM pg_temp.assert_42501('SELECT count(*) FROM public.finance_unlinked_obligation_templates');
  PERFORM pg_temp.assert_42501('SELECT count(*) FROM public.finance_unlinked_obligations');
  PERFORM pg_temp.assert_42501('SELECT count(*) FROM public.finance_unlinked_obligation_installments');
  PERFORM pg_temp.assert_42501('SELECT count(*) FROM public.finance_unlinked_obligation_payments');
  PERFORM pg_temp.assert_42501('SELECT count(*) FROM public.finance_unlinked_obligation_payment_allocations');
  PERFORM pg_temp.assert_42501('SELECT count(*) FROM public.finance_unlinked_installment_balances');
  PERFORM pg_temp.assert_42501('SELECT count(*) FROM public.finance_unlinked_obligation_balances');
  PERFORM pg_temp.assert_42501('SELECT * FROM public.finance_list_unlinked_treasury_commitments()');
  FOREACH v_sql IN ARRAY ARRAY[
    'SELECT public.finance_create_unlinked_obligation(''{}''::jsonb)',
    'SELECT public.finance_update_pending_unlinked_obligation(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_replace_unpaid_installment_plan(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_cancel_unlinked_obligation(gen_random_uuid(),''x'')',
    'SELECT public.finance_create_unlinked_obligation_template(''{}''::jsonb)',
    'SELECT public.finance_update_unlinked_obligation_template(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_generate_unlinked_obligation_occurrences(gen_random_uuid(),current_date)'
  ] LOOP PERFORM pg_temp.assert_42501(v_sql); END LOOP;
END $$;
RESET ROLE;

-- B. authenticated without role.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000001","app_metadata":{}}', true);
DO $$
BEGIN
  IF public.finance_app_role() IS NOT NULL
     OR public.finance_can_read_treasury()
     OR public.finance_can_read_unlinked_details()
     OR public.finance_can_manage_unlinked_obligations() THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: unclassified authenticated user received capacity';
  END IF;
  IF (SELECT count(*) FROM public.finance_unlinked_obligations) <> 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: unclassified user read detail';
  END IF;
  PERFORM pg_temp.assert_42501(
    'SELECT * FROM public.finance_list_unlinked_treasury_commitments()',
    'TREASURY_READ_REQUIRED'
  );
  PERFORM pg_temp.assert_42501(
    'SELECT public.finance_create_unlinked_obligation(''{}''::jsonb)',
    'ADMIN_OR_ACCOUNTING_REQUIRED'
  );
END $$;
RESET ROLE;

-- C. logistics: aggregate only; five tables and both detailed views yield no rows.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000002","app_metadata":{"role":" logistics "}}', true);
DO $$
DECLARE v_shape jsonb; v_sql text; v_row record;
BEGIN
  IF public.finance_app_role() <> 'logistics'
     OR NOT public.finance_can_read_treasury()
     OR public.finance_can_read_unlinked_details()
     OR public.finance_can_manage_unlinked_obligations() THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: logistics capacity matrix';
  END IF;
  IF (SELECT count(*) FROM public.finance_unlinked_obligation_templates) <> 0
     OR (SELECT count(*) FROM public.finance_unlinked_obligations) <> 0
     OR (SELECT count(*) FROM public.finance_unlinked_obligation_installments) <> 0
     OR (SELECT count(*) FROM public.finance_unlinked_obligation_payments) <> 0
     OR (SELECT count(*) FROM public.finance_unlinked_obligation_payment_allocations) <> 0
     OR (SELECT count(*) FROM public.finance_unlinked_installment_balances) <> 0
     OR (SELECT count(*) FROM public.finance_unlinked_obligation_balances) <> 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: logistics obtained detailed rows';
  END IF;
  IF (SELECT count(*) FROM public.finance_list_unlinked_treasury_commitments()
      WHERE obligation_id = '10000000-0000-4000-8000-000000000001') <> 2
     OR (SELECT count(DISTINCT installment_id) FROM public.finance_list_unlinked_treasury_commitments()
         WHERE obligation_id = '10000000-0000-4000-8000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: aggregate duplicated or omitted installments';
  END IF;
  FOR v_row IN
    SELECT * FROM public.finance_list_unlinked_treasury_commitments()
    WHERE obligation_id = '10000000-0000-4000-8000-000000000001'
  LOOP
    v_shape := to_jsonb(v_row);
    IF (SELECT count(*) FROM jsonb_object_keys(v_shape)) <> 13
       OR NOT (v_shape ?& ARRAY['obligation_id','installment_id','template_id','origin_type','concept','category','due_date','planned_total_eur','allocated_total_eur','outstanding_total_eur','financial_status','temporal_condition','has_overdue_installment'])
       OR v_shape ?| ARRAY['counterparty_name','description','cancellation_reason','notes','bank_reference','cash_account_id','credit_line_id','cash_movement_id','credit_line_movement_id','repayment_group_id','planned_principal_eur','planned_interest_eur','planned_other_fees_eur'] THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: unsafe aggregate shape: %', v_shape;
    END IF;
    IF NOT v_row.has_overdue_installment
       OR (v_row.due_date < current_date AND v_row.temporal_condition <> 'overdue')
       OR (v_row.due_date > current_date AND v_row.temporal_condition = 'overdue') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: aggregate overdue semantics: %', v_shape;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.finance_list_unlinked_treasury_commitments(current_date, NULL)
      WHERE obligation_id = '10000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: due_from filter';
  END IF;
  IF (SELECT count(*) FROM public.finance_list_unlinked_treasury_commitments(NULL, current_date)
      WHERE obligation_id = '10000000-0000-4000-8000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: due_to filter';
  END IF;
  BEGIN
    PERFORM * FROM public.finance_list_unlinked_treasury_commitments(current_date + 1, current_date - 1);
    RAISE EXCEPTION 'ASSERTION_FAILED: inverse range was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM NOT LIKE '%INVALID_DATE_RANGE%' THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: inverse range message: %', SQLERRM;
    END IF;
  END;
  FOREACH v_sql IN ARRAY ARRAY[
    'SELECT public.finance_create_unlinked_obligation(''{}''::jsonb)',
    'SELECT public.finance_update_pending_unlinked_obligation(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_replace_unpaid_installment_plan(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_cancel_unlinked_obligation(gen_random_uuid(),''x'')',
    'SELECT public.finance_create_unlinked_obligation_template(''{}''::jsonb)',
    'SELECT public.finance_update_unlinked_obligation_template(gen_random_uuid(),''{}''::jsonb)',
    'SELECT public.finance_generate_unlinked_obligation_occurrences(gen_random_uuid(),current_date)'
  ] LOOP
    PERFORM pg_temp.assert_42501(v_sql, 'ADMIN_OR_ACCOUNTING_REQUIRED');
  END LOOP;
END $$;
RESET ROLE;

-- D/E. accounting and admin have all application capabilities and cross every RPC gate.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000003","app_metadata":{"role":"accounting"}}', true);
DO $$ BEGIN
  IF public.finance_app_role() <> 'accounting' OR NOT public.finance_can_read_treasury()
     OR NOT public.finance_can_read_unlinked_details() OR NOT public.finance_can_manage_unlinked_obligations()
     OR (SELECT count(*) FROM public.finance_unlinked_obligations) = 0
     OR (SELECT count(*) FROM public.finance_unlinked_installment_balances) = 0
     OR (SELECT count(*) FROM public.finance_list_unlinked_treasury_commitments()) = 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: accounting access';
  END IF;
  PERFORM pg_temp.assert_management_gate_open();
END $$;
SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000004","app_metadata":{"role":"ADMIN"}}', true);
DO $$ BEGIN
  IF public.finance_app_role() <> 'admin' OR NOT public.finance_can_read_treasury()
     OR NOT public.finance_can_read_unlinked_details() OR NOT public.finance_can_manage_unlinked_obligations()
     OR (SELECT count(*) FROM public.finance_list_unlinked_treasury_commitments()) = 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: admin access';
  END IF;
  PERFORM pg_temp.assert_management_gate_open();
END $$;
RESET ROLE;

-- F. service_role remains fully privileged.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$ BEGIN
  IF public.finance_app_role() <> 'service_role' OR NOT public.finance_can_read_treasury()
     OR NOT public.finance_can_read_unlinked_details() OR NOT public.finance_can_manage_unlinked_obligations()
     OR (SELECT count(*) FROM public.finance_unlinked_obligations) = 0
     OR (SELECT count(*) FROM public.finance_list_unlinked_treasury_commitments()) = 0 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: service_role access';
  END IF;
  PERFORM pg_temp.assert_management_gate_open();
END $$;
RESET ROLE;

-- G. aliases and alternate metadata locations never classify the user.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
DECLARE v_claims jsonb;
BEGIN
  FOREACH v_claims IN ARRAY ARRAY[
    '{"role":"authenticated","app_metadata":{"role":"administrator"}}'::jsonb,
    '{"role":"authenticated","app_metadata":{"role":"superadmin"}}'::jsonb,
    '{"role":"authenticated","app_metadata":{"rol":"admin"}}'::jsonb,
    '{"role":"authenticated","app_metadata":{"roles":["admin"]}}'::jsonb,
    '{"role":"authenticated","app_metadata":{"is_admin":true}}'::jsonb,
    '{"role":"authenticated","app_metadata":{"admin":true}}'::jsonb,
    '{"role":"authenticated","user_metadata":{"role":"admin"}}'::jsonb,
    '{"role":"authenticated","email":"admin@example.com"}'::jsonb,
    '{"role":"authenticated","app_metadata":{"role":"   "}}'::jsonb,
    '{"role":"authenticated","app_metadata":{"role":"unknown"}}'::jsonb
  ] LOOP
    PERFORM set_config('request.jwt.claims', v_claims::text, true);
    IF public.finance_app_role() IS NOT NULL OR public.finance_can_read_treasury()
       OR public.finance_can_read_unlinked_details() OR public.finance_can_manage_unlinked_obligations() THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: rejected claims granted capacity: %', v_claims;
    END IF;
  END LOOP;
END $$;
RESET ROLE;

-- H. Formal privileges complement, but do not replace, the effective checks above.
DO $$
BEGIN
  IF has_table_privilege('authenticated','public.finance_unlinked_obligations','INSERT')
     OR has_table_privilege('authenticated','public.finance_unlinked_obligations','UPDATE')
     OR has_table_privilege('authenticated','public.finance_unlinked_obligations','DELETE')
     OR NOT has_function_privilege('authenticated','public.finance_create_unlinked_obligation(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.finance_list_unlinked_treasury_commitments(date,date)','EXECUTE')
     OR has_function_privilege('anon','public.finance_can_manage_unlinked_obligations()','EXECUTE')
     OR NOT has_table_privilege('service_role','public.finance_unlinked_obligations','INSERT,SELECT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: formal privilege matrix';
  END IF;
END $$;

ROLLBACK;
