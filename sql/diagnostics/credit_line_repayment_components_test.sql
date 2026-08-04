-- Ejecutar manualmente en una base de prueba despues de 20260804_02.
-- Todas las filas sinteticas se revierten.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_error(p_sql text,p_code text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%'||p_code||'%' THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: expected %, got %',p_code,SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION_FAILED: expected % for %',p_code,p_sql;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_gate_open()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.finance_create_credit_line_repayment_v2(
      gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,0,0,current_date,NULL,NULL,'gate-'||gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE='42501' OR SQLERRM LIKE '%ADMIN_OR_ACCOUNTING_REQUIRED%' THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: authorized actor rejected: %',SQLERRM;
    END IF;
    IF SQLERRM NOT LIKE '%NOT_FOUND%' THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: authorized actor did not reach resource validation: %',SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION_FAILED: dummy authorized call unexpectedly succeeded';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_invalid_components(
  p_principal numeric,p_interest numeric,p_fees numeric,p_key text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM public.finance_create_credit_line_repayment_v2(
      '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
      '13000000-0000-4000-8000-000000000001',p_principal,p_interest,p_fees,
      current_date,NULL,NULL,p_key);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%INVALID_AMOUNT%' THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: expected INVALID_AMOUNT, got %',SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'ASSERTION_FAILED: invalid monetary components were accepted';
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_monetary_state_pristine()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.finance_credit_line_repayments
      WHERE credit_line_id='11000000-0000-4000-8000-000000000001')<>0
     OR (SELECT count(*) FROM public.finance_cash_movements
         WHERE cash_account_id='13000000-0000-4000-8000-000000000001')<>0
     OR (SELECT count(*) FROM public.finance_credit_line_movements
         WHERE repayment_group_id='12000000-0000-4000-8000-000000000001')<>1
     OR (SELECT balance FROM public.finance_cash_accounts
         WHERE id='13000000-0000-4000-8000-000000000001')<>1000
     OR (SELECT used_amount FROM public.finance_credit_lines
         WHERE id='11000000-0000-4000-8000-000000000001')<>100
     OR (SELECT available_amount FROM public.finance_credit_lines
         WHERE id='11000000-0000-4000-8000-000000000001')<>900
     OR (SELECT remaining_amount FROM public.finance_credit_line_repayment_groups
         WHERE id='12000000-0000-4000-8000-000000000001')<>100 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: rejected monetary input produced side effects';
  END IF;
END $$;

DO $$
DECLARE
  v_v2 text := 'public.finance_create_credit_line_repayment_v2(uuid,uuid,uuid,numeric,numeric,numeric,date,text,text,text)';
  v_v1 text := 'public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text)';
  v_public_v2 boolean;
  v_public_v1 boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) acl
    WHERE p.oid = to_regprocedure(v_v2)
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) INTO v_public_v2;
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) acl
    WHERE p.oid = to_regprocedure(v_v1)
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) INTO v_public_v1;

  IF v_public_v2 OR has_function_privilege('anon',v_v2,'EXECUTE')
     OR NOT has_function_privilege('authenticated',v_v2,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_v2,'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: V2 EXECUTE grants are incorrect';
  END IF;
  IF v_public_v1 OR has_function_privilege('anon',v_v1,'EXECUTE')
     OR has_function_privilege('authenticated',v_v1,'EXECUTE')
     OR NOT has_function_privilege('service_role',v_v1,'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: legacy V1 EXECUTE grants are incorrect';
  END IF;
END $$;

INSERT INTO public.finance_credit_lines(
  id,bank_name,line_name,credit_limit,available_amount,used_amount,cycle_days,repayment_mode,status
) VALUES
 ('11000000-0000-4000-8000-000000000001','PHASE1B TEST','LINE A',1000,900,100,30,'periodic_release','active'),
 ('11000000-0000-4000-8000-000000000002','PHASE1B TEST','LINE B',1000,1000,0,30,'periodic_release','active');
INSERT INTO public.finance_credit_line_repayment_groups(
  id,credit_line_id,period_start,period_end,due_date,amount,paid_amount,remaining_amount,status
) VALUES (
  '12000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',
  current_date,current_date+30,current_date+30,100,0,100,'open'
);
INSERT INTO public.finance_cash_accounts(id,name,balance,currency,status)
VALUES ('13000000-0000-4000-8000-000000000001','PHASE1B TEST CASH',1000,'EUR','active');
INSERT INTO public.finance_credit_line_movements(
  id,credit_line_id,movement_type,description,due_date,amount,status,
  source_type,movement_date,repayment_group_id,idempotency_key
) VALUES (
  '14000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001',
  'drawdown','PHASE1B TEST DRAWDOWN',current_date+30,100,'posted',
  'manual',current_date-2,'12000000-0000-4000-8000-000000000001','phase1b-drawdown'
);

-- Successful financial scenarios use the technical actor, so created_by remains null.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT pg_temp.assert_gate_open();

DO $$
DECLARE
  v_result jsonb;
  v_first_id uuid;
  v_cash numeric;
  v_used numeric;
  v_available numeric;
  v_remaining numeric;
  v_special numeric;
BEGIN
  PERFORM pg_temp.assert_invalid_components('NaN'::numeric,0,0,'phase1b-nan');
  PERFORM pg_temp.assert_monetary_state_pristine();

  BEGIN
    EXECUTE 'SELECT ''Infinity''::numeric' INTO v_special;
  EXCEPTION WHEN OTHERS THEN
    v_special := NULL;
    RAISE NOTICE 'Infinity numeric is not supported by this PostgreSQL version; case skipped';
  END;
  IF v_special IS NOT NULL THEN
    PERFORM pg_temp.assert_invalid_components(0,v_special,0,'phase1b-positive-infinity');
    PERFORM pg_temp.assert_monetary_state_pristine();
  END IF;

  BEGIN
    EXECUTE 'SELECT ''-Infinity''::numeric' INTO v_special;
  EXCEPTION WHEN OTHERS THEN
    v_special := NULL;
    RAISE NOTICE '-Infinity numeric is not supported by this PostgreSQL version; case skipped';
  END;
  IF v_special IS NOT NULL THEN
    PERFORM pg_temp.assert_invalid_components(0,0,v_special,'phase1b-negative-infinity');
    PERFORM pg_temp.assert_monetary_state_pristine();
  END IF;

  PERFORM pg_temp.assert_invalid_components(1000000000000,0,0,'phase1b-over-canonical-max');
  PERFORM pg_temp.assert_monetary_state_pristine();

  PERFORM pg_temp.assert_error(
    'SELECT public.finance_create_credit_line_repayment_v2(''11000000-0000-4000-8000-000000000001'',''12000000-0000-4000-8000-000000000001'',''13000000-0000-4000-8000-000000000001'',1,0,0,current_date-3,NULL,NULL,''phase1b-before-drawdown'')',
    'REPAYMENT_DATE_OUT_OF_SEQUENCE');

  v_result:=public.finance_create_credit_line_repayment_v2(
    '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',30,5,2,current_date,'PARTIAL','principal partial','phase1b-partial');
  v_first_id:=(v_result->>'repayment_id')::uuid;
  IF (v_result->>'total_cash_out_eur')::numeric<>37
     OR (v_result->>'principal_outstanding_eur')::numeric<>70
     OR (v_result->>'credit_used_eur')::numeric<>70
     OR (v_result->>'credit_available_eur')::numeric<>930
     OR (v_result->>'cash_balance_eur')::numeric<>963 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: partial principal/components result %',v_result;
  END IF;

  PERFORM pg_temp.assert_error(
    'SELECT public.finance_create_credit_line_repayment_v2(''11000000-0000-4000-8000-000000000001'',''12000000-0000-4000-8000-000000000001'',''13000000-0000-4000-8000-000000000001'',1,0,0,current_date-1,NULL,NULL,''phase1b-before-repayment'')',
    'REPAYMENT_DATE_OUT_OF_SEQUENCE');

  v_result:=public.finance_create_credit_line_repayment_v2(
    '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',30,5,2,current_date,'PARTIAL','principal partial','phase1b-partial');
  IF NOT (v_result->>'idempotent')::boolean OR (v_result->>'repayment_id')::uuid<>v_first_id
     OR (SELECT count(*) FROM public.finance_credit_line_repayments WHERE idempotency_key='phase1b-partial')<>1
     OR (SELECT count(*) FROM public.finance_cash_movements WHERE source_id=v_first_id)<>1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: idempotency %',v_result;
  END IF;

  PERFORM pg_temp.assert_error(
    'SELECT public.finance_create_credit_line_repayment_v2(''11000000-0000-4000-8000-000000000001'',''12000000-0000-4000-8000-000000000001'',''13000000-0000-4000-8000-000000000001'',31,5,2,current_date,''PARTIAL'',''principal partial'',''phase1b-partial'')',
    'IDEMPOTENCY_PAYLOAD_MISMATCH');
  PERFORM pg_temp.assert_error(
    'SELECT public.finance_create_credit_line_repayment_v2(''11000000-0000-4000-8000-000000000001'',''12000000-0000-4000-8000-000000000001'',''13000000-0000-4000-8000-000000000001'',71,0,0,current_date,NULL,NULL,''phase1b-too-much'')',
    'INSUFFICIENT_USED_AMOUNT');
  PERFORM pg_temp.assert_error(
    'SELECT public.finance_create_credit_line_repayment_v2(''11000000-0000-4000-8000-000000000001'',''12000000-0000-4000-8000-000000000001'',''13000000-0000-4000-8000-000000000001'',0,2000,0,current_date,NULL,NULL,''phase1b-no-cash'')',
    'INSUFFICIENT_CASH');
  PERFORM pg_temp.assert_error(
    'SELECT public.finance_create_credit_line_repayment_v2(''11000000-0000-4000-8000-000000000002'',''12000000-0000-4000-8000-000000000001'',''13000000-0000-4000-8000-000000000001'',1,0,0,current_date,NULL,NULL,''phase1b-mismatch'')',
    'GROUP_MISMATCH');

  -- Interest-only and fee-only payments reduce cash but never principal or available credit.
  PERFORM public.finance_create_credit_line_repayment_v2(
    '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',0,3,0,current_date,NULL,'interest only','phase1b-interest');
  PERFORM public.finance_create_credit_line_repayment_v2(
    '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',0,0,4,current_date,NULL,'fee only','phase1b-fee');
  SELECT balance INTO v_cash FROM public.finance_cash_accounts WHERE id='13000000-0000-4000-8000-000000000001';
  SELECT used_amount,available_amount INTO v_used,v_available FROM public.finance_credit_lines WHERE id='11000000-0000-4000-8000-000000000001';
  SELECT remaining_amount INTO v_remaining FROM public.finance_credit_line_repayment_groups WHERE id='12000000-0000-4000-8000-000000000001';
  IF v_cash<>956 OR v_used<>70 OR v_available<>930 OR v_remaining<>70 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: interest/fee changed principal %,%,%,%',v_cash,v_used,v_available,v_remaining;
  END IF;

  -- Full remaining principal plus interest and fee: cash -72, credit released only by 70.
  v_result:=public.finance_create_credit_line_repayment_v2(
    '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',70,1,1,current_date,'FULL','full principal','phase1b-full');
  IF (v_result->>'total_cash_out_eur')::numeric<>72
     OR (v_result->>'principal_outstanding_eur')::numeric<>0
     OR (v_result->>'credit_used_eur')::numeric<>0
     OR (v_result->>'credit_available_eur')::numeric<>1000
     OR (v_result->>'cash_balance_eur')::numeric<>884
     OR (SELECT status FROM public.finance_credit_line_repayment_groups WHERE id='12000000-0000-4000-8000-000000000001')<>'paid' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: full principal/components result %',v_result;
  END IF;

  -- A paid group accepts later charges but remains financially closed for principal.
  PERFORM public.finance_create_credit_line_repayment_v2(
    '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',0,2,0,current_date,NULL,'post-paid interest','phase1b-post-paid-interest');
  PERFORM public.finance_create_credit_line_repayment_v2(
    '11000000-0000-4000-8000-000000000001','12000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',0,0,3,current_date,NULL,'post-paid fee','phase1b-post-paid-fee');
  SELECT balance INTO v_cash FROM public.finance_cash_accounts WHERE id='13000000-0000-4000-8000-000000000001';
  SELECT used_amount,available_amount INTO v_used,v_available FROM public.finance_credit_lines WHERE id='11000000-0000-4000-8000-000000000001';
  SELECT remaining_amount INTO v_remaining FROM public.finance_credit_line_repayment_groups WHERE id='12000000-0000-4000-8000-000000000001';
  IF v_cash<>879 OR v_used<>0 OR v_available<>1000 OR v_remaining<>0
     OR (SELECT status FROM public.finance_credit_line_repayment_groups WHERE id='12000000-0000-4000-8000-000000000001')<>'paid' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: post-paid charges changed principal state %,%,%,%',v_cash,v_used,v_available,v_remaining;
  END IF;
  PERFORM pg_temp.assert_error(
    'SELECT public.finance_create_credit_line_repayment_v2(''11000000-0000-4000-8000-000000000001'',''12000000-0000-4000-8000-000000000001'',''13000000-0000-4000-8000-000000000001'',1,0,0,current_date,NULL,NULL,''phase1b-paid-principal'')',
    'GROUP_CLOSED');
END $$;
RESET ROLE;

-- anon has no direct EXECUTE privilege on V2.
SET LOCAL ROLE anon;
SELECT pg_temp.assert_error(
  'SELECT public.finance_create_credit_line_repayment_v2(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,0,0,current_date,NULL,NULL,''anon-gate'')',
  'permission denied');
RESET ROLE;

-- authenticated without an application role and logistics are rejected before resource validation.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000000"}',true);
SELECT pg_temp.assert_error(
  'SELECT public.finance_create_credit_line_repayment_v2(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,0,0,current_date,NULL,NULL,''no-role-gate'')',
  'ADMIN_OR_ACCOUNTING_REQUIRED');
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000001","app_metadata":{"role":"logistics"}}',true);
SELECT pg_temp.assert_error(
  'SELECT public.finance_create_credit_line_repayment_v2(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,0,0,current_date,NULL,NULL,''logistics-gate'')',
  'ADMIN_OR_ACCOUNTING_REQUIRED');

-- accounting and admin cross the role gate and reach later resource validation.
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000002","app_metadata":{"role":"accounting"}}',true);
SELECT pg_temp.assert_gate_open();
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"30000000-0000-4000-8000-000000000003","app_metadata":{"role":"admin"}}',true);
SELECT pg_temp.assert_gate_open();

-- Direct update and deletion are unavailable even to an authorized application actor.
SELECT pg_temp.assert_error(
  'UPDATE public.finance_credit_line_repayments SET notes=''forbidden'' WHERE id=''00000000-0000-0000-0000-000000000000''',
  'permission denied');
SELECT pg_temp.assert_error(
  'DELETE FROM public.finance_credit_line_repayments WHERE id=''00000000-0000-0000-0000-000000000000''',
  'permission denied');
RESET ROLE;

-- Every synthetic row and every local claim/configuration change above is transactional.
ROLLBACK;
