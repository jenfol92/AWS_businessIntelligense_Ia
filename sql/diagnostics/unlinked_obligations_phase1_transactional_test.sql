-- Ejecutar solo en PostgreSQL de pruebas DESPUES de aplicar las cinco migraciones.
-- No se ejecuta en esta fase. Toda fila sintÃ©tica queda revertida.

BEGIN;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $tests$
DECLARE
  v_result jsonb; v_obligation uuid; v_replanned uuid; v_template uuid; v_quarterly uuid; v_yearly uuid;
  v_partial uuid; v_installment uuid; v_payment uuid:=gen_random_uuid(); v_account uuid; v_cash_movement uuid;
  v_detailed_installment uuid; v_count integer; v_before text; v_after text;
  v_p numeric; v_i numeric; v_f numeric; v_t numeric;
BEGIN
  -- Puntual total_only: componentes desconocidos permanecen NULL.
  v_result:=public.finance_create_unlinked_obligation(jsonb_build_object(
    'concept','Hipoteca total only','category','mortgage','amount_breakdown_mode','total_only','planned_total_eur',2350,
    'installments',jsonb_build_array(jsonb_build_object('sequence_number',1,'due_date','2027-01-31','planned_total_eur',2350))));
  v_obligation:=(v_result->>'obligation_id')::uuid;
  IF EXISTS (SELECT 1 FROM public.finance_unlinked_obligations WHERE id=v_obligation AND
    (planned_principal_eur IS NOT NULL OR planned_interest_eur IS NOT NULL OR planned_other_fees_eur IS NOT NULL))
  THEN RAISE EXCEPTION 'ASSERT_FAILED: total_only invented components'; END IF;

  -- Fraccionamiento manual detailed y reconciliaciÃ³n por componente.
  v_result:=public.finance_create_unlinked_obligation(jsonb_build_object(
    'concept','PrÃ©stamo detallado','category','loan','amount_breakdown_mode','detailed',
    'planned_principal_eur',3000,'planned_interest_eur',800,'planned_other_fees_eur',200,'planned_total_eur',4000,
    'installments',jsonb_build_array(
      jsonb_build_object('sequence_number',1,'due_date','2027-02-01','planned_principal_eur',1500,'planned_interest_eur',400,'planned_other_fees_eur',100,'planned_total_eur',2000),
      jsonb_build_object('sequence_number',2,'due_date','2027-03-01','planned_principal_eur',1500,'planned_interest_eur',400,'planned_other_fees_eur',100,'planned_total_eur',2000))));
  v_replanned:=(v_result->>'obligation_id')::uuid;

  -- DivisiÃ³n automÃ¡tica detailed: residuos independientes de cada componente.
  v_result:=public.finance_create_unlinked_obligation(jsonb_build_object(
    'concept','Detailed residual','category','loan','amount_breakdown_mode','detailed',
    'planned_principal_eur',100.01,'planned_interest_eur',20.02,'planned_other_fees_eur',3.03,'planned_total_eur',123.06,
    'installment_dates',jsonb_build_array('2027-04-01','2027-05-01')));
  IF NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_installments WHERE obligation_id=(v_result->>'obligation_id')::uuid
    GROUP BY obligation_id HAVING sum(planned_principal_eur)=100.01 AND sum(planned_interest_eur)=20.02
      AND sum(planned_other_fees_eur)=3.03 AND sum(planned_total_eur)=123.06)
  THEN RAISE EXCEPTION 'ASSERT_FAILED: automatic component reconciliation'; END IF;

  -- DivisiÃ³n automÃ¡tica total_only solo reparte total y conserva NULL.
  v_result:=public.finance_create_unlinked_obligation(jsonb_build_object(
    'concept','Seguro total only','category','insurance','planned_total_eur',100,
    'installment_dates',jsonb_build_array('2027-06-01','2027-07-01','2027-08-01')));
  IF NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_installments WHERE obligation_id=(v_result->>'obligation_id')::uuid
    GROUP BY obligation_id HAVING sum(planned_total_eur)=100 AND max(planned_total_eur)=33.34
      AND count(planned_principal_eur)=0 AND count(planned_interest_eur)=0 AND count(planned_other_fees_eur)=0)
  THEN RAISE EXCEPTION 'ASSERT_FAILED: total_only split'; END IF;

  -- Errores diferenciados de las cuatro sumas.
  BEGIN
    PERFORM public.finance_create_unlinked_obligation(jsonb_build_object('concept','Bad principal','category','loan','amount_breakdown_mode','detailed',
      'planned_principal_eur',10,'planned_interest_eur',2,'planned_other_fees_eur',1,'planned_total_eur',13,
      'installments',jsonb_build_array(jsonb_build_object('due_date','2027-01-01','planned_principal_eur',9,'planned_interest_eur',2,'planned_other_fees_eur',1,'planned_total_eur',12))));
    RAISE EXCEPTION 'ASSERT_FAILED: principal mismatch accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'INSTALLMENT_PRINCIPAL_SUM_MISMATCH%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.finance_create_unlinked_obligation(jsonb_build_object('concept','Bad interest','category','loan','amount_breakdown_mode','detailed',
      'planned_principal_eur',10,'planned_interest_eur',2,'planned_other_fees_eur',1,'planned_total_eur',13,
      'installments',jsonb_build_array(jsonb_build_object('due_date','2027-01-01','planned_principal_eur',10,'planned_interest_eur',1,'planned_other_fees_eur',1,'planned_total_eur',12))));
    RAISE EXCEPTION 'ASSERT_FAILED: interest mismatch accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'INSTALLMENT_INTEREST_SUM_MISMATCH%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.finance_create_unlinked_obligation(jsonb_build_object('concept','Bad fees','category','loan','amount_breakdown_mode','detailed',
      'planned_principal_eur',10,'planned_interest_eur',2,'planned_other_fees_eur',1,'planned_total_eur',13,
      'installments',jsonb_build_array(jsonb_build_object('due_date','2027-01-01','planned_principal_eur',10,'planned_interest_eur',2,'planned_other_fees_eur',0,'planned_total_eur',12))));
    RAISE EXCEPTION 'ASSERT_FAILED: fees mismatch accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'INSTALLMENT_FEES_SUM_MISMATCH%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.finance_create_unlinked_obligation(jsonb_build_object('concept','Bad total','category','other','planned_total_eur',10,
      'installments',jsonb_build_array(jsonb_build_object('due_date','2027-01-01','planned_total_eur',9))));
    RAISE EXCEPTION 'ASSERT_FAILED: total mismatch accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'INSTALLMENT_TOTAL_SUM_MISMATCH%' THEN RAISE; END IF; END;

  -- total_only rechaza componentes incluso si valen cero: NULL es desconocido; cero es conocido.
  BEGIN
    PERFORM public.finance_create_unlinked_obligation(jsonb_build_object('concept','Bad total only','category','other','planned_total_eur',10,
      'planned_principal_eur',0,'installments',jsonb_build_array(jsonb_build_object('due_date','2027-01-01','planned_total_eur',10))));
    RAISE EXCEPTION 'ASSERT_FAILED: total_only component accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF; END;

  -- ReplanificaciÃ³n conserva revision 1 como superseded y crea revision 2 activa.
  BEGIN
    PERFORM public.finance_replace_unpaid_installment_plan(v_replanned,jsonb_build_object(
      'planned_total_eur',4000,'installment_dates',jsonb_build_array('2027-09-01')));
    RAISE EXCEPTION 'ASSERT_FAILED: replan without mode accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'REPLAN_MODE_REQUIRED%' THEN RAISE; END IF; END;
  v_result:=public.finance_replace_unpaid_installment_plan(v_replanned,jsonb_build_object(
    'amount_breakdown_mode','detailed','planned_principal_eur',3000,'planned_interest_eur',800,'planned_other_fees_eur',200,'planned_total_eur',4000,
    'installment_dates',jsonb_build_array('2027-09-01','2027-10-01','2027-11-01')));
  IF (v_result->>'plan_revision')::integer<>2 THEN RAISE EXCEPTION 'ASSERT_FAILED: revision not incremented'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_installments WHERE obligation_id=v_replanned AND plan_revision=1 AND status='superseded' AND superseded_at IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_installments WHERE obligation_id=v_replanned AND plan_revision=2 AND status='active')
  THEN RAISE EXCEPTION 'ASSERT_FAILED: replan history'; END IF;

  -- Mensual dÃ­a 31, febrero bisiesto, fecha final inclusiva e idempotencia.
  SELECT id INTO v_template FROM public.finance_create_unlinked_obligation_template(jsonb_build_object(
    'concept','Hipoteca recurrente total only','category','mortgage','planned_total_eur',2350,
    'start_date','2028-01-31','end_date','2028-04-30','frequency_interval',1));
  PERFORM public.finance_generate_unlinked_obligation_occurrences(v_template,'2028-12-31');
  PERFORM public.finance_generate_unlinked_obligation_occurrences(v_template,'2028-12-31');
  IF (SELECT count(*) FROM public.finance_unlinked_obligations WHERE template_id=v_template)<>4
     OR NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligations WHERE template_id=v_template AND occurrence_period='2028-02-29')
  THEN RAISE EXCEPTION 'ASSERT_FAILED: monthly leap inclusive or idempotency'; END IF;

  -- Frecuencia inmutable tras generar y end_date no reducible; ampliaciÃ³n vÃ¡lida.
  BEGIN PERFORM public.finance_update_unlinked_obligation_template(v_template,jsonb_build_object('frequency_interval',3));
    RAISE EXCEPTION 'ASSERT_FAILED: monthly changed to quarterly';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.finance_update_unlinked_obligation_template(v_template,jsonb_build_object('end_date','2028-03-31'));
    RAISE EXCEPTION 'ASSERT_FAILED: end_date reduced before latest';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF; END;
  PERFORM public.finance_update_unlinked_obligation_template(v_template,jsonb_build_object('end_date','2028-12-31'));

  -- Trimestral dÃ­a 30 y anual dÃ­a 29; intento inverso de cambio de frecuencia.
  SELECT id INTO v_quarterly FROM public.finance_create_unlinked_obligation_template(jsonb_build_object(
    'concept','Trimestral','category','taxes','planned_total_eur',300,'start_date','2027-01-30','end_date','2027-10-30','frequency_interval',3));
  PERFORM public.finance_generate_unlinked_obligation_occurrences(v_quarterly,'2027-12-31');
  IF (SELECT count(*) FROM public.finance_unlinked_obligations WHERE template_id=v_quarterly)<>4 THEN RAISE EXCEPTION 'ASSERT_FAILED: quarterly'; END IF;
  BEGIN PERFORM public.finance_update_unlinked_obligation_template(v_quarterly,jsonb_build_object('frequency_interval',1));
    RAISE EXCEPTION 'ASSERT_FAILED: quarterly changed to monthly';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF; END;
  SELECT id INTO v_yearly FROM public.finance_create_unlinked_obligation_template(jsonb_build_object(
    'concept','Anual','category','insurance','planned_total_eur',1200,'start_date','2028-02-29','end_date','2032-02-29','frequency_interval',12));
  PERFORM public.finance_generate_unlinked_obligation_occurrences(v_yearly,'2032-02-29');
  IF (SELECT count(*) FROM public.finance_unlinked_obligations WHERE template_id=v_yearly)<>5 THEN RAISE EXCEPTION 'ASSERT_FAILED: yearly inclusive'; END IF;

  -- Pausa y cancelaciÃ³n lÃ³gica.
  PERFORM public.finance_update_unlinked_obligation_template(v_quarterly,jsonb_build_object('status','paused'));
  v_result:=public.finance_generate_unlinked_obligation_occurrences(v_quarterly,'2028-12-31');
  IF v_result->>'skipped_status'<>'paused' THEN RAISE EXCEPTION 'ASSERT_FAILED: pause'; END IF;
  PERFORM public.finance_cancel_unlinked_obligation(v_obligation,'CancelaciÃ³n de test');
  IF NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligations WHERE id=v_obligation AND lifecycle_status='cancelled') THEN RAISE EXCEPTION 'ASSERT_FAILED: cancel'; END IF;

  -- Partial + overdue total_only mediante datos sintÃ©ticos compatibles; cargo real puede diferir del previsto.
  v_result:=public.finance_create_unlinked_obligation(jsonb_build_object('concept','Partial overdue','category','utilities','planned_total_eur',100,
    'installments',jsonb_build_array(jsonb_build_object('due_date',(current_date-1)::text,'planned_total_eur',100))));
  v_partial:=(v_result->>'obligation_id')::uuid;
  SELECT id INTO v_installment FROM public.finance_unlinked_obligation_installments WHERE obligation_id=v_partial AND status='active';
  INSERT INTO public.finance_cash_accounts(name,balance,currency) VALUES ('Phase1 synthetic '||gen_random_uuid()::text,1000,'EUR') RETURNING id INTO v_account;
  INSERT INTO public.finance_cash_movements(cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date,notes)
  VALUES (v_account,'adjustment','out',40,'unlinked_phase1_test',v_payment,current_date,'Synthetic rollback-only') RETURNING id INTO v_cash_movement;
  INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,amount_breakdown_mode,actual_total_eur,bank_fee_eur,funded_total_eur,
    source_type,cash_account_id,cash_movement_id,status,idempotency_key,payload_fingerprint)
  VALUES (v_payment,v_partial,now(),'total_only',40,0,40,'cash_account',v_account,v_cash_movement,'posted','phase1-'||v_payment,'fingerprint');
  INSERT INTO public.finance_unlinked_obligation_payment_allocations(payment_id,installment_id,amount_breakdown_mode,allocated_total_eur)
  VALUES (v_payment,v_installment,'total_only',40);
  SELECT financial_status||':'||temporal_condition INTO v_after FROM public.finance_unlinked_installment_balances WHERE installment_id=v_installment;
  IF v_after<>'partial:overdue' THEN RAISE EXCEPTION 'ASSERT_FAILED: expected partial:overdue, got %',v_after; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_balances WHERE obligation_id=v_partial AND financial_status='partial' AND outstanding_total_eur=60)
  THEN RAISE EXCEPTION 'ASSERT_FAILED: obligation read model'; END IF;

  BEGIN
    v_payment:=gen_random_uuid();
    INSERT INTO public.finance_cash_movements(cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date)
      VALUES(v_account,'adjustment','out',100,'unlinked_phase1_test',v_payment,current_date) RETURNING id INTO v_cash_movement;
    INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,actual_total_eur,funded_total_eur,
      source_type,cash_account_id,cash_movement_id,status,idempotency_key,payload_fingerprint)
      VALUES(v_payment,v_partial,now(),100,100,'cash_account',v_account,v_cash_movement,'posted','unallocated-'||v_payment,'test');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'ASSERT_FAILED: posted without allocations accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'PAYMENT_REQUIRES_ALLOCATION%' THEN RAISE; END IF; END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    v_payment:=gen_random_uuid();
    INSERT INTO public.finance_cash_movements(cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date)
      VALUES(v_account,'adjustment','out',100,'unlinked_phase1_test',v_payment,current_date) RETURNING id INTO v_cash_movement;
    INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,actual_total_eur,funded_total_eur,
      source_type,cash_account_id,cash_movement_id,status,idempotency_key,payload_fingerprint)
      VALUES(v_payment,v_partial,now(),100,100,'cash_account',v_account,v_cash_movement,'posted','partial-allocation-'||v_payment,'test');
    INSERT INTO public.finance_unlinked_obligation_payment_allocations(payment_id,installment_id,allocated_total_eur)
      VALUES(v_payment,v_installment,60);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'ASSERT_FAILED: partial payment allocation accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'PAYMENT_ALLOCATION_TOTAL_MISMATCH%' THEN RAISE; END IF; END;
  SET CONSTRAINTS ALL DEFERRED;

  v_result:=public.finance_create_unlinked_obligation(jsonb_build_object('concept','Exact fee','category','other','planned_total_eur',100,
    'installment_dates',jsonb_build_array('2029-01-01')));
  v_obligation:=(v_result->>'obligation_id')::uuid;
  SELECT id INTO v_installment FROM public.finance_unlinked_obligation_installments WHERE obligation_id=v_obligation AND status='active';
  v_payment:=gen_random_uuid();
  INSERT INTO public.finance_cash_movements(cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date)
    VALUES(v_account,'adjustment','out',105,'unlinked_phase1_test',v_payment,current_date) RETURNING id INTO v_cash_movement;
  INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,actual_total_eur,bank_fee_eur,funded_total_eur,
    source_type,cash_account_id,cash_movement_id,status,idempotency_key,payload_fingerprint)
    VALUES(v_payment,v_obligation,now(),100,5,105,'cash_account',v_account,v_cash_movement,'posted','exact-fee-'||v_payment,'test');
  INSERT INTO public.finance_unlinked_obligation_payment_allocations(payment_id,installment_id,allocated_total_eur)
    VALUES(v_payment,v_installment,100);
  SET CONSTRAINTS ALL IMMEDIATE;
  IF NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_payments p WHERE p.id=v_payment AND p.funded_total_eur=105)
     OR (SELECT sum(allocated_total_eur) FROM public.finance_unlinked_obligation_payment_allocations WHERE payment_id=v_payment)<>100
  THEN RAISE EXCEPTION 'ASSERT_FAILED: fee/allocation boundary'; END IF;
  SET CONSTRAINTS ALL DEFERRED;

  SELECT id,planned_principal_eur,planned_interest_eur,planned_other_fees_eur,planned_total_eur
    INTO v_detailed_installment,v_p,v_i,v_f,v_t
  FROM public.finance_unlinked_obligation_installments
  WHERE obligation_id=v_replanned AND status='active' ORDER BY sequence_number LIMIT 1;

  -- Ambos sentidos de payment/allocation mode mismatch y cuota de modo distinto.
  BEGIN
    UPDATE public.finance_unlinked_obligation_payment_allocations SET amount_breakdown_mode='detailed',
      allocated_principal_eur=100,allocated_interest_eur=0,allocated_other_fees_eur=0 WHERE payment_id=v_payment;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'ASSERT_FAILED: total_only payment with detailed allocation accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'PAYMENT_ALLOCATION_MODE_MISMATCH%' THEN RAISE; END IF; END;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    UPDATE public.finance_unlinked_obligation_payment_allocations SET installment_id=v_detailed_installment WHERE payment_id=v_payment;
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'ASSERT_FAILED: allocation against different installment mode accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'INSTALLMENT_ALLOCATION_MODE_MISMATCH%' THEN RAISE; END IF; END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    v_payment:=gen_random_uuid();
    INSERT INTO public.finance_cash_movements(cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date)
      VALUES(v_account,'adjustment','out',v_t,'unlinked_phase1_test',v_payment,current_date) RETURNING id INTO v_cash_movement;
    INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,amount_breakdown_mode,actual_principal_eur,actual_interest_eur,
      actual_other_fees_eur,actual_total_eur,funded_total_eur,source_type,cash_account_id,cash_movement_id,status,idempotency_key,payload_fingerprint)
    VALUES(v_payment,v_replanned,now(),'detailed',v_p,v_i,v_f,v_t,v_t,'cash_account',v_account,v_cash_movement,'posted','detailed-mode-'||v_payment,'test');
    INSERT INTO public.finance_unlinked_obligation_payment_allocations(payment_id,installment_id,amount_breakdown_mode,allocated_total_eur)
      VALUES(v_payment,v_detailed_installment,'total_only',v_t);
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'ASSERT_FAILED: detailed payment with total_only allocation accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'PAYMENT_ALLOCATION_MODE_MISMATCH%' THEN RAISE; END IF; END;
  SET CONSTRAINTS ALL DEFERRED;

  -- Excesos por componente sin exceder el total de la cuota.
  FOR v_before IN SELECT unnest(ARRAY['principal','interest','fees']) LOOP
    BEGIN
      v_payment:=gen_random_uuid();
      INSERT INTO public.finance_cash_movements(cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date)
        VALUES(v_account,'adjustment','out',v_t,'unlinked_phase1_test',v_payment,current_date) RETURNING id INTO v_cash_movement;
      INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,amount_breakdown_mode,actual_principal_eur,actual_interest_eur,
        actual_other_fees_eur,actual_total_eur,funded_total_eur,source_type,cash_account_id,cash_movement_id,status,idempotency_key,payload_fingerprint)
      VALUES(v_payment,v_replanned,now(),'detailed',
        v_p+CASE WHEN v_before='principal' THEN 1 ELSE -1 END,
        v_i+CASE WHEN v_before='interest' THEN 1 WHEN v_before='principal' THEN -1 ELSE 0 END,
        v_f+CASE WHEN v_before='fees' THEN 1 ELSE 0 END,v_t,v_t,
        'cash_account',v_account,v_cash_movement,'posted','component-'||v_before||v_payment,'test');
      INSERT INTO public.finance_unlinked_obligation_payment_allocations(payment_id,installment_id,amount_breakdown_mode,
        allocated_principal_eur,allocated_interest_eur,allocated_other_fees_eur,allocated_total_eur)
      SELECT v_payment,v_detailed_installment,'detailed',actual_principal_eur,actual_interest_eur,actual_other_fees_eur,actual_total_eur
      FROM public.finance_unlinked_obligation_payments WHERE id=v_payment;
      SET CONSTRAINTS ALL IMMEDIATE;
      RAISE EXCEPTION 'ASSERT_FAILED: component overpayment accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'ASSERT_FAILED:%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE (
        CASE v_before
          WHEN 'principal' THEN 'INSTALLMENT_PRINCIPAL_OVERPAYMENT%'
          WHEN 'interest' THEN 'INSTALLMENT_INTEREST_OVERPAYMENT%'
          ELSE 'INSTALLMENT_FEES_OVERPAYMENT%'
        END
      ) THEN
        RAISE;
      END IF;
    END;
    SET CONSTRAINTS ALL DEFERRED;
  END LOOP;

  -- AsignaciÃƒÂ³n detailed exacta aceptada por total y por los tres componentes.
  v_payment:=gen_random_uuid();
  INSERT INTO public.finance_cash_movements(cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date)
    VALUES(v_account,'adjustment','out',v_t,'unlinked_phase1_test',v_payment,current_date) RETURNING id INTO v_cash_movement;
  INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,amount_breakdown_mode,actual_principal_eur,actual_interest_eur,
    actual_other_fees_eur,actual_total_eur,funded_total_eur,source_type,cash_account_id,cash_movement_id,status,idempotency_key,payload_fingerprint)
    VALUES(v_payment,v_replanned,now(),'detailed',v_p,v_i,v_f,v_t,v_t,'cash_account',v_account,v_cash_movement,'posted','detailed-exact-'||v_payment,'test');
  INSERT INTO public.finance_unlinked_obligation_payment_allocations(payment_id,installment_id,amount_breakdown_mode,
    allocated_principal_eur,allocated_interest_eur,allocated_other_fees_eur,allocated_total_eur)
    VALUES(v_payment,v_detailed_installment,'detailed',v_p,v_i,v_f,v_t);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;

  v_result:=public.finance_create_unlinked_obligation(jsonb_build_object('concept','Replan total','category','other','planned_total_eur',90,
    'installment_dates',jsonb_build_array('2029-02-01')));
  PERFORM public.finance_replace_unpaid_installment_plan((v_result->>'obligation_id')::uuid,jsonb_build_object(
    'amount_breakdown_mode','total_only','planned_total_eur',90,'installment_dates',jsonb_build_array('2029-03-01','2029-04-01')));
END;
$tests$;

-- Fuerza ahora las comprobaciones diferidas; ROLLBACK no llega a disparar eventos de COMMIT.
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

DO $privileges$
DECLARE v_table text; v_privilege text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['finance_unlinked_obligation_templates','finance_unlinked_obligations','finance_unlinked_obligation_installments','finance_unlinked_obligation_payments','finance_unlinked_obligation_payment_allocations'] LOOP
    IF NOT has_table_privilege('authenticated','public.'||v_table,'SELECT') THEN RAISE EXCEPTION 'ASSERT_FAILED: missing SELECT %',v_table; END IF;
    FOREACH v_privilege IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      IF has_table_privilege('authenticated','public.'||v_table,v_privilege) THEN RAISE EXCEPTION 'ASSERT_FAILED: direct DML % %',v_privilege,v_table; END IF;
    END LOOP;
  END LOOP;
END;
$privileges$;

-- La carrera real se valida desde dos sesiones: advisory lock + Ã­ndice Ãºnico parcial + ON CONFLICT.
ROLLBACK;
