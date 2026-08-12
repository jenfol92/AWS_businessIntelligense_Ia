-- Diagnostico transaccional Fase 1B.1. Ejecutar solo tras 20260804_03.
\set ON_ERROR_STOP on
SELECT count(*) AS before_lines FROM public.finance_credit_lines \gset
SELECT count(*) AS before_groups FROM public.finance_credit_line_repayment_groups \gset
SELECT count(*) AS before_movements FROM public.finance_credit_line_movements \gset
SELECT count(*) AS before_cash_movements FROM public.finance_cash_movements \gset
SELECT count(*) AS before_regularizations FROM public.finance_credit_line_legacy_regularizations \gset
SELECT count(*) AS before_items FROM public.finance_credit_line_legacy_regularization_items \gset
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_error(p_sql text,p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%'||p_code||'%' THEN RAISE EXCEPTION 'ASSERTION_FAILED expected %, got %',p_code,SQLERRM; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION_FAILED expected %',p_code;
END $$;

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.finance_create_credit_line_drawdown(uuid,numeric,date,text,uuid,text,text,date)')) INTO v_def;
  IF v_def NOT LIKE '%group_origin_type = ''operational_cycle''%' THEN RAISE EXCEPTION 'ASSERTION_FAILED: drawdown lacks operational filter'; END IF;
  IF v_def ILIKE '%bank_name%' THEN RAISE EXCEPTION 'ASSERTION_FAILED: bank_name drives logic'; END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege('anon','public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text)','EXECUTE')
     OR EXISTS(
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
       LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       WHERE n.nspname='public' AND p.proname='finance_register_legacy_opening_balance_v2'
         AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: RPC grants';
  END IF;
  IF to_regprocedure('public.finance_register_legacy_opening_balance(uuid,numeric,date,date,text,text,text)') IS NOT NULL
     AND (has_function_privilege('anon','public.finance_register_legacy_opening_balance(uuid,numeric,date,date,text,text,text)','EXECUTE')
       OR has_function_privilege('authenticated','public.finance_register_legacy_opening_balance(uuid,numeric,date,date,text,text,text)','EXECUTE')
       OR has_function_privilege('service_role','public.finance_register_legacy_opening_balance(uuid,numeric,date,date,text,text,text)','EXECUTE')) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: legacy V1 executable';
  END IF;
  IF NOT has_table_privilege('authenticated','public.finance_credit_line_legacy_regularizations','SELECT')
     OR has_table_privilege('authenticated','public.finance_credit_line_legacy_regularizations','INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role','public.finance_credit_line_legacy_regularization_items','SELECT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: table grants';
  END IF;
END $$;

INSERT INTO public.finance_credit_lines(id,bank_name,line_name,credit_limit,available_amount,used_amount,cycle_days,repayment_mode,status)
VALUES
 ('51000000-0000-4000-8000-000000000001','TEST','PERIODIC',1000,900,100,90,'periodic_release','active'),
 ('51000000-0000-4000-8000-000000000002','TEST','MANUAL',1000,1000,0,NULL,'manual_due_dates','active'),
 ('51000000-0000-4000-8000-000000000003','TEST','DELETED',1000,900,100,90,'periodic_release','deleted'),
 ('51000000-0000-4000-8000-000000000004','TEST','INACTIVE DEBT',1000,900,100,90,'periodic_release','inactive');
INSERT INTO public.finance_credit_line_repayment_groups(id,credit_line_id,period_start,period_end,due_date,amount,paid_amount,remaining_amount,status,group_origin_type)
VALUES('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',current_date-20,current_date-10,current_date+20,20,0,20,'open','operational_cycle');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"53000000-0000-4000-8000-000000000001","app_metadata":{"role":"logistics"}}',true);
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','logistics')$q$,'ADMIN_OR_ACCOUNTING_REQUIRED');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"53000000-0000-4000-8000-000000000002","app_metadata":{"role":"admin"}}',true);
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":79.99,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','admin-authorized')$q$,'LEGACY_BREAKDOWN_BELOW_GAP');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"53000000-0000-4000-8000-000000000003","app_metadata":{"role":"accounting"}}',true);
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":79.99,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','accounting-authorized')$q$,'LEGACY_BREAKDOWN_BELOW_GAP');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"53000000-0000-4000-8000-000000000004"}',true);
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','no-role')$q$,'ADMIN_OR_ACCOUNTING_REQUIRED');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000003','[{"principalEur":100,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','deleted-line')$q$,'CREDIT_LINE_DELETED');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000004','[{"principalEur":99.99,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','inactive-line')$q$,'LEGACY_BREAKDOWN_BELOW_GAP');

INSERT INTO public.finance_credit_line_repayment_groups(id,credit_line_id,period_start,period_end,due_date,amount,paid_amount,remaining_amount,status,group_origin_type)
VALUES('52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','2026-01-01','2026-01-31','2026-02-01',1,0,1,'open','operational_cycle');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000002','[{"principalEur":1,"dispositionDate":"2026-01-01","contractualDueDate":"2026-02-01"}]','explained-over-used')$q$,'EXPLAINED_PRINCIPAL_EXCEEDS_USED');

SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":79.99,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','below')$q$,'LEGACY_BREAKDOWN_BELOW_GAP');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80.01,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','above')$q$,'LEGACY_BREAKDOWN_EXCEEDS_GAP');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":"NaN","dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','nan')$q$,'INVALID_AMOUNT');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":0,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','zero')$q$,'INVALID_AMOUNT');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":-1,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','negative')$q$,'INVALID_AMOUNT');
SELECT pg_temp.assert_error(format($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001',%L::jsonb,'positive-infinity')$q$,
 jsonb_build_array(jsonb_build_object('principalEur','Infinity'::numeric,'dispositionDate','2026-01-01','contractualDueDate','2026-04-01'))::text),'INVALID_AMOUNT');
SELECT pg_temp.assert_error(format($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001',%L::jsonb,'negative-infinity')$q$,
 jsonb_build_array(jsonb_build_object('principalEur','-Infinity'::numeric,'dispositionDate','2026-01-01','contractualDueDate','2026-04-01'))::text),'INVALID_AMOUNT');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80.001,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','decimals')$q$,'INVALID_AMOUNT');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":1000000000000,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','overflow')$q$,'INVALID_AMOUNT');
SELECT pg_temp.assert_error(format($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"%s","contractualDueDate":"%s"}]','future')$q$,
 current_date+1,current_date+2),'INVALID_DATE');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-02","contractualDueDate":"2026-01-01"}]','reversed')$q$,'INVALID_DATE');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01","reference":true}]','bad-reference')$q$,'INVALID_AMOUNT');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01","notes":{}}]','bad-notes')$q$,'INVALID_AMOUNT');
SELECT pg_temp.assert_error(format($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01","reference":"%s"}]','long-reference')$q$,repeat('x',251)),'INVALID_AMOUNT');
SELECT pg_temp.assert_error(format($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01","notes":"%s"}]','long-notes')$q$,repeat('x',2001)),'INVALID_AMOUNT');
SELECT pg_temp.assert_error(format($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','%s','too-many')$q$,
 (SELECT jsonb_agg(jsonb_build_object('principalEur',1,'dispositionDate','2026-01-01','contractualDueDate','2026-04-01')) FROM generate_series(1,501))::text),'INVALID_AMOUNT');

DO $$
DECLARE v_result jsonb; v_again jsonb; v_id uuid; v_used numeric; v_available numeric;
BEGIN
  v_result:=public.finance_register_legacy_opening_balance_v2(
    '51000000-0000-4000-8000-000000000001',
    '[{"principalEur":30,"dispositionDate":"2026-01-02","contractualDueDate":"2026-04-01","reference":"A"},{"principalEur":20,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01","reference":"B"},{"principalEur":30,"dispositionDate":"2026-02-01","contractualDueDate":"2026-05-01","reference":"C"}]',
    'legacy-complete');
  v_id:=(v_result->>'regularization_id')::uuid;
  IF (v_result->>'derived_gap_eur')::numeric<>80 OR jsonb_array_length(v_result->'groups')<>3 OR jsonb_array_length(v_result->'dispositions')<>3 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: result %',v_result;
  END IF;
  IF (SELECT count(*) FROM public.finance_credit_line_repayment_groups WHERE group_origin_id=v_id)<>3
     OR (SELECT count(*) FROM public.finance_credit_line_legacy_regularization_items WHERE regularization_id=v_id)<>3
     OR (SELECT count(*) FROM public.finance_credit_line_movements WHERE source_type='legacy_opening_balance' AND source_id IN (SELECT id FROM public.finance_credit_line_legacy_regularization_items WHERE regularization_id=v_id))<>3
     OR EXISTS(SELECT 1 FROM public.finance_credit_line_movements WHERE source_type='legacy_opening_balance' AND movement_type<>'adjustment')
     OR EXISTS(SELECT 1 FROM public.finance_cash_movements WHERE source_id=v_id) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: traceability counts';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.finance_credit_line_repayment_groups WHERE group_origin_id=v_id AND due_date='2026-04-01' AND period_start='2026-01-01' AND period_end='2026-01-01' AND amount=20)
     OR NOT EXISTS(SELECT 1 FROM public.finance_credit_line_repayment_groups WHERE group_origin_id=v_id AND due_date='2026-04-01' AND period_start='2026-01-02' AND period_end='2026-01-02' AND amount=30)
     OR NOT EXISTS(SELECT 1 FROM public.finance_credit_line_repayment_groups WHERE group_origin_id=v_id AND due_date='2026-05-01' AND period_start='2026-02-01' AND period_end='2026-02-01' AND amount=30) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: legacy periods/groups';
  END IF;
  SELECT used_amount,available_amount INTO v_used,v_available FROM public.finance_credit_lines WHERE id='51000000-0000-4000-8000-000000000001';
  IF v_used<>100 OR v_available<>900 THEN RAISE EXCEPTION 'ASSERTION_FAILED: line balances changed'; END IF;

  v_again:=public.finance_register_legacy_opening_balance_v2(
    '51000000-0000-4000-8000-000000000001',
    '[{"notes":null,"reference":"C","contractualDueDate":"2026-05-01","dispositionDate":"2026-02-01","principalEur":30},{"reference":"B","contractualDueDate":"2026-04-01","dispositionDate":"2026-01-01","principalEur":20},{"reference":"A","contractualDueDate":"2026-04-01","dispositionDate":"2026-01-02","principalEur":30}]',
    'legacy-complete');
  IF NOT (v_again->>'idempotent')::boolean OR (v_again->>'regularization_id')::uuid<>v_id THEN RAISE EXCEPTION 'ASSERTION_FAILED: reordered idempotency'; END IF;
END $$;

SELECT pg_temp.assert_error($q$UPDATE public.finance_credit_line_legacy_regularizations SET status='posted' WHERE idempotency_key='legacy-complete'$q$,'IMMUTABLE_FINANCIAL_OPERATION');
SELECT pg_temp.assert_error($q$DELETE FROM public.finance_credit_line_legacy_regularizations WHERE idempotency_key='legacy-complete'$q$,'IMMUTABLE_FINANCIAL_OPERATION');
SELECT pg_temp.assert_error($q$UPDATE public.finance_credit_line_legacy_regularization_items SET reference=reference WHERE regularization_id=(SELECT id FROM public.finance_credit_line_legacy_regularizations WHERE idempotency_key='legacy-complete')$q$,'IMMUTABLE_FINANCIAL_OPERATION');
SELECT pg_temp.assert_error($q$DELETE FROM public.finance_credit_line_legacy_regularization_items WHERE regularization_id=(SELECT id FROM public.finance_credit_line_legacy_regularizations WHERE idempotency_key='legacy-complete')$q$,'IMMUTABLE_FINANCIAL_OPERATION');
SELECT pg_temp.assert_error($q$INSERT INTO public.finance_credit_line_repayment_groups(
 id,credit_line_id,period_start,period_end,due_date,amount,paid_amount,remaining_amount,status,group_origin_type,group_origin_id)
 VALUES(gen_random_uuid(),'51000000-0000-4000-8000-000000000001','2026-01-01','2026-01-01','2026-06-01',1,0,1,'open','legacy_regularization',gen_random_uuid())$q$,'foreign key');

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_finance_credit_line_repayment_groups_operational_period'
      AND indexdef LIKE '%group_origin_type = ''operational_cycle''%')
     OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ix_finance_credit_line_repayment_groups_legacy_due'
      AND indexdef LIKE '%group_origin_type = ''legacy_regularization''%') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: origin-scoped unique indexes';
  END IF;
END $$;

SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-01","contractualDueDate":"2026-04-01"}]','another-key')$q$,'NO_LEGACY_GAP');
SELECT pg_temp.assert_error($q$SELECT public.finance_register_legacy_opening_balance_v2(
 '51000000-0000-4000-8000-000000000001','[{"principalEur":80,"dispositionDate":"2026-01-03","contractualDueDate":"2026-04-01"}]','legacy-complete')$q$,'IDEMPOTENCY_PAYLOAD_MISMATCH');

-- Physical last line of defence: a drawdown can never target a legacy group.
SELECT pg_temp.assert_error($q$INSERT INTO public.finance_credit_line_movements(
 credit_line_id,movement_type,description,amount,status,source_type,source_id,movement_date,repayment_group_id)
 SELECT credit_line_id,'drawdown','forbidden',1,'posted','supplier_payment',gen_random_uuid(),current_date,id
 FROM public.finance_credit_line_repayment_groups WHERE group_origin_type='legacy_regularization' LIMIT 1$q$,'DRAWDOWN_LEGACY_GROUP_FORBIDDEN');
RESET ROLE;

ROLLBACK;

SELECT ((SELECT count(*) FROM public.finance_credit_lines)=:before_lines
    AND (SELECT count(*) FROM public.finance_credit_line_repayment_groups)=:before_groups
    AND (SELECT count(*) FROM public.finance_credit_line_movements)=:before_movements
    AND (SELECT count(*) FROM public.finance_cash_movements)=:before_cash_movements
    AND (SELECT count(*) FROM public.finance_credit_line_legacy_regularizations)=:before_regularizations
    AND (SELECT count(*) FROM public.finance_credit_line_legacy_regularization_items)=:before_items) AS counts_unchanged \gset
\if :counts_unchanged
SELECT 'credit_line_legacy_regularization_test: OK' AS result;
\else
\echo 'ASSERTION_FAILED: financial counts changed after rollback'
\quit 1
\endif
