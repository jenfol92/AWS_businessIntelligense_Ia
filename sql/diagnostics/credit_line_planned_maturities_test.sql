BEGIN;

DO $$
DECLARE v_line public.finance_credit_lines%ROWTYPE; v_groups bigint; v_movements bigint; v_cash bigint; v_row public.finance_credit_line_planned_maturities; v_same public.finance_credit_line_planned_maturities;
BEGIN
  IF (SELECT count(*) FROM public.finance_credit_line_planned_maturities WHERE source_key LIKE 'credit-maturity:%' AND source_type='spreadsheet_schedule')<>33 THEN RAISE EXCEPTION 'SPREADSHEET_ROWS_NOT_HARDENED'; END IF;
  IF position('pg_advisory_xact_lock' in pg_get_functiondef('public.finance_create_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text,text)'::regprocedure))=0 THEN RAISE EXCEPTION 'CONCURRENCY_LOCK_NOT_INSTALLED'; END IF;
  SELECT * INTO v_line FROM public.finance_credit_lines WHERE id='b24d9e3c-698c-4c14-bd1c-5c511b19e4d1';
  SELECT count(*) INTO v_groups FROM public.finance_credit_line_repayment_groups; SELECT count(*) INTO v_movements FROM public.finance_credit_line_movements; SELECT count(*) INTO v_cash FROM public.finance_cash_movements;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"54000000-0000-4000-8000-000000000001","app_metadata":{"role":"admin"}}',true);
  SELECT * INTO v_row FROM public.finance_create_credit_line_planned_maturity(v_line.id,current_date+30,123.45,2.00,1.00,'Fixture previsto','fixture','fixture','diagnostic:planned-maturity:idem');
  SELECT * INTO v_same FROM public.finance_create_credit_line_planned_maturity(v_line.id,current_date+30,123.45,2.00,1.00,'Fixture previsto','fixture','fixture','diagnostic:planned-maturity:idem');
  IF v_same.id<>v_row.id THEN RAISE EXCEPTION 'IDEMPOTENCY_FAILED'; END IF;
  BEGIN PERFORM public.finance_create_credit_line_planned_maturity(v_line.id,current_date+30,124.45,2,1,'Fixture previsto','fixture','fixture','diagnostic:planned-maturity:idem'); RAISE EXCEPTION 'MISMATCH_ACCEPTED'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%IDEMPOTENCY_PAYLOAD_MISMATCH%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"54000000-0000-4000-8000-000000000002","app_metadata":{"role":"logistics"}}',true);
  IF NOT public.finance_can_read_treasury() THEN RAISE EXCEPTION 'LOGISTICS_READ_DENIED'; END IF;
  BEGIN PERFORM public.finance_create_credit_line_planned_maturity(v_line.id,current_date+31,1,0,0,'Denied',null,null,'diagnostic:logistics'); RAISE EXCEPTION 'LOGISTICS_MUTATION_ACCEPTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated","sub":"54000000-0000-4000-8000-000000000003","app_metadata":{"role":"accounting"}}',true);
  PERFORM public.finance_create_credit_line_planned_maturity(v_line.id,current_date+32,1,0,0,'Accounting',null,null,'diagnostic:accounting');
  UPDATE public.finance_credit_line_planned_maturities SET status='paid' WHERE id=v_row.id;
  BEGIN PERFORM public.finance_update_credit_line_planned_maturity(v_row.id,current_date+40,1,0,0,'No',null,null); RAISE EXCEPTION 'PAID_MUTABLE'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%PLANNED_MATURITY_IMMUTABLE%' THEN RAISE; END IF; END;
  UPDATE public.finance_credit_line_planned_maturities SET status='cancelled',cancelled_at=now() WHERE source_key='diagnostic:accounting' RETURNING * INTO v_same;
  BEGIN PERFORM public.finance_cancel_credit_line_planned_maturity(v_same.id); RAISE EXCEPTION 'CANCELLED_MUTABLE'; EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%PLANNED_MATURITY_IMMUTABLE%' THEN RAISE; END IF; END;
  IF (SELECT used_amount FROM public.finance_credit_lines WHERE id=v_line.id)<>v_line.used_amount OR (SELECT available_amount FROM public.finance_credit_lines WHERE id=v_line.id)<>v_line.available_amount THEN RAISE EXCEPTION 'CREDIT_LINE_BALANCE_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.finance_credit_line_repayment_groups)<>v_groups OR (SELECT count(*) FROM public.finance_credit_line_movements)<>v_movements OR (SELECT count(*) FROM public.finance_cash_movements)<>v_cash THEN RAISE EXCEPTION 'LEDGER_SIDE_EFFECT'; END IF;
END $$;

ROLLBACK;
