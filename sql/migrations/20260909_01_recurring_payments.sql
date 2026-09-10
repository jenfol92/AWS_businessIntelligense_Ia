-- Local migration. Requires the existing unlinked-obligation and cash-ledger migrations.
-- No historical balance changes. All execution uses the existing obligations and cash ledger.
BEGIN;

CREATE TABLE public.finance_payment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('payroll','social_security','taxes','other')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_payment_types_name_unique ON public.finance_payment_types(lower(btrim(name)));
INSERT INTO public.finance_payment_types(name,category) VALUES
  ('Seguridad Social','social_security'),('Salarios','payroll'),('IVA','taxes'),('Otros','other');
ALTER TABLE public.finance_payment_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_types_read ON public.finance_payment_types FOR SELECT TO authenticated
  USING (public.finance_can_read_treasury());
CREATE POLICY payment_types_create ON public.finance_payment_types FOR INSERT TO authenticated
  WITH CHECK (public.finance_can_manage_unlinked_obligations() AND category='other');
-- Override Supabase default grants as well as explicit grants.
REVOKE ALL ON public.finance_payment_types FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.finance_payment_types TO authenticated;
GRANT ALL ON public.finance_payment_types TO service_role;

ALTER TABLE public.finance_unlinked_obligation_templates
  ALTER COLUMN end_date DROP NOT NULL,
  ADD COLUMN payment_type_id uuid REFERENCES public.finance_payment_types(id),
  ADD COLUMN planned_cash_account_id uuid REFERENCES public.finance_cash_accounts(id),
  ADD COLUMN creation_key uuid UNIQUE,
  ADD COLUMN creation_fingerprint text CHECK (creation_fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE public.finance_unlinked_obligations
  ADD COLUMN payment_type_id uuid REFERENCES public.finance_payment_types(id),
  ADD COLUMN planned_cash_account_id uuid REFERENCES public.finance_cash_accounts(id),
  ADD COLUMN creation_key uuid UNIQUE,
  ADD COLUMN creation_fingerprint text CHECK (creation_fingerprint ~ '^[0-9a-f]{64}$');

-- Preserve every existing type restriction, including site-specific accepted types.
-- Mixed-column predicates need explicit review rather than broadening unrelated conditions.
DO $$
DECLARE c record; v_attribute smallint; v_count integer:=0;
BEGIN
  LOCK TABLE public.finance_cash_movements IN ACCESS EXCLUSIVE MODE;
  SELECT attnum INTO v_attribute FROM pg_attribute
    WHERE attrelid='public.finance_cash_movements'::regclass AND attname='movement_type' AND NOT attisdropped;
  FOR c IN SELECT conname,conkey,pg_get_expr(conbin,conrelid) AS expression
    FROM pg_constraint WHERE conrelid='public.finance_cash_movements'::regclass
      AND contype='c' AND v_attribute=ANY(conkey)
  LOOP
    IF cardinality(c.conkey)<>1 THEN RAISE EXCEPTION 'MOVEMENT_TYPE_CHECK_REQUIRES_REVIEW'; END IF;
    EXECUTE format('ALTER TABLE public.finance_cash_movements DROP CONSTRAINT %I',c.conname);
    EXECUTE format('ALTER TABLE public.finance_cash_movements ADD CONSTRAINT %I CHECK ((%s) OR movement_type = %L)',
      c.conname,c.expression,'unlinked_payment');
    v_count:=v_count+1;
  END LOOP;
  IF v_count=0 THEN RAISE EXCEPTION 'MOVEMENT_TYPE_CHECK_NOT_FOUND'; END IF;
END $$;

CREATE FUNCTION public.finance_inherit_recurring_payment_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.template_id IS NOT NULL THEN
    SELECT payment_type_id,planned_cash_account_id INTO NEW.payment_type_id,NEW.planned_cash_account_id
    FROM public.finance_unlinked_obligation_templates WHERE id=NEW.template_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inherit_recurring_payment_metadata BEFORE INSERT ON public.finance_unlinked_obligations
FOR EACH ROW EXECUTE FUNCTION public.finance_inherit_recurring_payment_metadata();
REVOKE ALL ON FUNCTION public.finance_inherit_recurring_payment_metadata() FROM PUBLIC,anon,authenticated;

-- Pay exactly one installment, including a partial amount. A repeat request returns the same payment.
CREATE FUNCTION public.finance_validate_recurring_payload(p_payload jsonb,p_paying boolean)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE
  v_allowed text[]; v_field text;
  v_uuid text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
BEGIN
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023'; END IF;
  v_allowed:=CASE WHEN p_paying THEN ARRAY['idempotency_key','installment_id','template_id','due_date','amount_eur','paid_date','cash_account_id','bank_reference']
    ELSE ARRAY['idempotency_key','payment_type_id','concept','amount_eur','cash_account_id','date','frequency','end_date','action'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_payload) k WHERE NOT k=ANY(v_allowed))
    OR jsonb_typeof(p_payload->'amount_eur') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023';
  END IF;
  IF coalesce(p_payload->>'idempotency_key','') !~ (CASE WHEN p_paying THEN left(v_uuid,length(v_uuid)-1)||'(:first)?$' ELSE v_uuid END)
    OR coalesce(p_payload->>'cash_account_id','') !~ v_uuid THEN RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023'; END IF;
  FOREACH v_field IN ARRAY ARRAY['installment_id','template_id','payment_type_id'] LOOP
    IF p_payload->>v_field IS NOT NULL AND (jsonb_typeof(p_payload->v_field)<>'string' OR p_payload->>v_field !~ v_uuid) THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOREACH v_field IN ARRAY ARRAY['date','paid_date','due_date','end_date'] LOOP
    IF p_payload->>v_field IS NOT NULL AND (jsonb_typeof(p_payload->v_field)<>'string' OR p_payload->>v_field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF p_paying THEN
    IF (p_payload->>'installment_id' IS NULL)=(p_payload->>'template_id' IS NULL)
      OR p_payload->>'paid_date' IS NULL OR (p_payload->>'template_id' IS NOT NULL AND p_payload->>'due_date' IS NULL)
      OR (p_payload->>'bank_reference' IS NOT NULL AND (jsonb_typeof(p_payload->'bank_reference')<>'string' OR length(p_payload->>'bank_reference')>200)) THEN
      RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023';
    END IF;
  ELSE
    IF p_payload->>'payment_type_id' IS NULL OR jsonb_typeof(p_payload->'concept') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_payload->'frequency') IS DISTINCT FROM 'number' OR coalesce(p_payload->>'frequency','') NOT IN ('0','1','3','12')
      OR p_payload->>'date' IS NULL THEN RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023'; END IF;
  END IF;
END $$;

-- jsonb sorts object keys; trim_scale normalizes equivalent numeric representations.
-- No duplicate concept/account/date payload is stored for idempotency.
CREATE FUNCTION public.finance_recurring_fingerprint(p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT encode(sha256(convert_to(jsonb_strip_nulls(
    jsonb_set(p_payload-'idempotency_key','{amount_eur}',to_jsonb(trim_scale((p_payload->>'amount_eur')::numeric)))
  )::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION public.finance_validate_recurring_payload(jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.finance_recurring_fingerprint(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.finance_validate_recurring_payload(jsonb,boolean) OWNER TO postgres;
ALTER FUNCTION public.finance_recurring_fingerprint(jsonb) OWNER TO postgres;

-- Materialize exactly the selected occurrence. Share the legacy generator's template lock.
-- Private helper: callers must keep this transaction open through payment completion.
CREATE FUNCTION public.finance_materialize_recurring_payment(p_template_id uuid,p_due date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_template public.finance_unlinked_obligation_templates;
  v_month_index integer; v_first date; v_expected date; v_obligation_id uuid;
BEGIN
  PERFORM public.finance_assert_unlinked_actor();
  PERFORM pg_advisory_xact_lock(hashtextextended('unlinked_template:'||p_template_id::text,0));
  SELECT * INTO v_template FROM public.finance_unlinked_obligation_templates WHERE id=p_template_id FOR UPDATE;
  IF NOT FOUND OR v_template.status<>'active' THEN RAISE EXCEPTION 'OBLIGATION_NOT_ACTIVE'; END IF;
  IF p_due IS NULL OR p_due<v_template.start_date OR (v_template.end_date IS NOT NULL AND p_due>v_template.end_date) THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE';
  END IF;
  v_month_index:=(extract(year FROM p_due)::int-extract(year FROM v_template.start_date)::int)*12
    +extract(month FROM p_due)::int-extract(month FROM v_template.start_date)::int;
  v_first:=date_trunc('month',p_due)::date;
  v_expected:=v_first+least(v_template.anchor_day,extract(day FROM (v_first+interval '1 month - 1 day'))::int)-1;
  IF v_month_index % v_template.frequency_interval<>0 OR p_due<>v_expected THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  INSERT INTO public.finance_unlinked_obligations (
    template_id,occurrence_period,origin_type,concept,category,counterparty_name,description,amount_breakdown_mode,
    planned_principal_eur,planned_interest_eur,planned_other_fees_eur,planned_total_eur,lifecycle_status,created_by
  ) VALUES (v_template.id,p_due,'recurring_occurrence',v_template.concept,v_template.category,
    v_template.counterparty_name,v_template.description,v_template.amount_breakdown_mode,v_template.planned_principal_eur,
    v_template.planned_interest_eur,v_template.planned_other_fees_eur,v_template.planned_total_eur,'active',auth.uid())
  ON CONFLICT (template_id,occurrence_period) WHERE template_id IS NOT NULL DO NOTHING RETURNING id INTO v_obligation_id;
  IF v_obligation_id IS NOT NULL THEN
    INSERT INTO public.finance_unlinked_obligation_installments (
      obligation_id,plan_revision,sequence_number,due_date,amount_breakdown_mode,
      planned_principal_eur,planned_interest_eur,planned_other_fees_eur,planned_total_eur
    ) VALUES (v_obligation_id,1,1,p_due,v_template.amount_breakdown_mode,v_template.planned_principal_eur,
      v_template.planned_interest_eur,v_template.planned_other_fees_eur,v_template.planned_total_eur);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.finance_materialize_recurring_payment(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.finance_materialize_recurring_payment(uuid,date) OWNER TO postgres;

CREATE FUNCTION public.finance_pay_unlinked_installment(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_actor uuid:=public.finance_assert_unlinked_actor();
  v_key text:=p_payload->>'idempotency_key';
  v_existing public.finance_unlinked_obligation_payments;
  v_installment public.finance_unlinked_obligation_installments;
  v_obligation public.finance_unlinked_obligations;
  v_account public.finance_cash_accounts;
  v_amount numeric;
  v_date date;
  v_remaining numeric; v_payment uuid:=gen_random_uuid(); v_movement uuid:=gen_random_uuid();
  v_template uuid;
  v_due date;
  v_installment_id uuid;
BEGIN
  PERFORM public.finance_validate_recurring_payload(p_payload,true);
  BEGIN
    v_amount:=(p_payload->>'amount_eur')::numeric;
    v_date:=(p_payload->>'paid_date')::date;
    v_template:=(p_payload->>'template_id')::uuid;
    v_due:=(p_payload->>'due_date')::date;
    v_installment_id:=(p_payload->>'installment_id')::uuid;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023';
  END;
  IF coalesce(v_key,'')='' OR length(v_key)>100 THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY'; END IF;
  IF v_amount IS NULL OR NOT public.finance_is_finite_numeric(v_amount) OR v_amount<=0 OR v_amount>999999999999.99 OR round(v_amount,2)<>v_amount
    OR v_date IS NULL OR v_date>(current_timestamp AT TIME ZONE 'Europe/Madrid')::date THEN RAISE EXCEPTION 'INVALID_PAYMENT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('unlinked_payment:'||v_key,0));
  SELECT * INTO v_existing FROM public.finance_unlinked_obligation_payments WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.payload_fingerprint<>public.finance_recurring_fingerprint(p_payload) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('payment_id',v_existing.id,'replayed',true);
  END IF;
  IF v_installment_id IS NULL AND v_template IS NOT NULL THEN
    IF v_due IS NULL OR v_due>(current_timestamp AT TIME ZONE 'Europe/Madrid')::date+interval '18 months' THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
    PERFORM public.finance_materialize_recurring_payment(v_template,v_due);
    SELECT i.id INTO v_installment_id FROM public.finance_unlinked_obligations o
      JOIN public.finance_unlinked_obligation_installments i ON i.obligation_id=o.id
      WHERE o.template_id=v_template AND o.occurrence_period=v_due AND i.status='active';
  END IF;
  -- Match the obligation-before-installment lock order used by the existing planning RPCs.
  SELECT o.* INTO v_obligation FROM public.finance_unlinked_obligations o
    JOIN public.finance_unlinked_obligation_installments i ON i.obligation_id=o.id
    WHERE i.id=v_installment_id FOR UPDATE OF o;
  IF NOT FOUND OR v_obligation.lifecycle_status<>'active' THEN RAISE EXCEPTION 'OBLIGATION_NOT_ACTIVE'; END IF;
  SELECT * INTO v_installment FROM public.finance_unlinked_obligation_installments WHERE id=v_installment_id FOR UPDATE;
  IF v_installment.status<>'active' OR v_installment.amount_breakdown_mode<>'total_only' THEN RAISE EXCEPTION 'INVALID_INSTALLMENT'; END IF;
  SELECT outstanding_total_eur INTO v_remaining FROM public.finance_unlinked_installment_balances WHERE installment_id=v_installment_id;
  IF v_remaining IS NULL OR v_amount>v_remaining THEN RAISE EXCEPTION 'PAYMENT_AMOUNT_CONFLICT'; END IF;
  SELECT * INTO v_account FROM public.finance_cash_accounts WHERE id=(p_payload->>'cash_account_id')::uuid FOR UPDATE;
  IF NOT FOUND OR upper(v_account.currency)<>'EUR' THEN RAISE EXCEPTION 'INVALID_CASH_ACCOUNT'; END IF;
  IF v_account.balance<v_amount THEN RAISE EXCEPTION 'INSUFFICIENT_CASH_CONFLICT'; END IF;
  INSERT INTO public.finance_cash_movements(id,cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date,notes)
    VALUES(v_movement,v_account.id,'unlinked_payment','out',v_amount,'unlinked_obligation_payment',v_payment,v_date,v_obligation.concept);
  UPDATE public.finance_cash_accounts SET balance=balance-v_amount,updated_at=now() WHERE id=v_account.id;
  INSERT INTO public.finance_unlinked_obligation_payments(id,obligation_id,paid_at,actual_total_eur,funded_total_eur,
    source_type,cash_account_id,cash_movement_id,idempotency_key,payload_fingerprint,created_by,bank_reference)
    VALUES(v_payment,v_obligation.id,v_date::timestamp AT TIME ZONE 'Europe/Madrid',v_amount,v_amount,
      'cash_account',v_account.id,v_movement,v_key,public.finance_recurring_fingerprint(p_payload),v_actor,nullif(btrim(p_payload->>'bank_reference'),''));
  INSERT INTO public.finance_unlinked_obligation_payment_allocations(payment_id,installment_id,allocated_total_eur)
    VALUES(v_payment,v_installment_id,v_amount);
  RETURN jsonb_build_object('payment_id',v_payment,'replayed',false);
END $$;

CREATE FUNCTION public.finance_create_recurring_payment(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_actor uuid:=public.finance_assert_unlinked_actor();
  v_key uuid;
  v_type public.finance_payment_types;
  v_account uuid;
  v_date date;
  v_end date;
  v_frequency integer;
  v_amount numeric;
  v_id uuid; v_template uuid; v_installment uuid; v_saved text; v_pay jsonb;
BEGIN
  PERFORM public.finance_validate_recurring_payload(p_payload,false);
  BEGIN
    v_key:=(p_payload->>'idempotency_key')::uuid;
    v_account:=(p_payload->>'cash_account_id')::uuid;
    v_date:=(p_payload->>'date')::date;
    v_end:=(p_payload->>'end_date')::date;
    v_frequency:=(p_payload->>'frequency')::integer;
    v_amount:=(p_payload->>'amount_eur')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_PAYLOAD' USING ERRCODE='22023';
  END;
  IF v_key IS NULL OR v_date IS NULL OR v_date<(current_timestamp AT TIME ZONE 'Europe/Madrid')::date-interval '10 years' OR v_date>(current_timestamp AT TIME ZONE 'Europe/Madrid')::date+interval '18 months'
    OR v_frequency IS NULL OR v_frequency NOT IN (0,1,3,12) OR (v_end IS NOT NULL AND v_end<v_date)
    OR p_payload->>'action' IS NULL OR p_payload->>'action' NOT IN ('pending','paid')
    OR length(btrim(coalesce(p_payload->>'concept',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_PAYMENT'; END IF;
  PERFORM public.finance_validate_unlinked_amount('total_only',NULL,NULL,NULL,v_amount,'payment');
  IF v_amount>999999999999.99 OR round(v_amount,2)<>v_amount THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recurring_create:'||v_key::text,0));
  SELECT id,creation_fingerprint INTO v_template,v_saved FROM public.finance_unlinked_obligation_templates WHERE creation_key=v_key;
  IF NOT FOUND THEN SELECT id,creation_fingerprint INTO v_id,v_saved FROM public.finance_unlinked_obligations WHERE creation_key=v_key; END IF;
  IF v_saved IS NOT NULL THEN
    IF v_saved<>public.finance_recurring_fingerprint(p_payload) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('template_id',v_template,'obligation_id',v_id,'replayed',true);
  END IF;
  SELECT * INTO v_type FROM public.finance_payment_types WHERE id=(p_payload->>'payment_type_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PAYMENT_TYPE'; END IF;
  PERFORM 1 FROM public.finance_cash_accounts WHERE id=v_account AND upper(currency)='EUR';
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_CASH_ACCOUNT'; END IF;
  IF v_frequency=0 THEN
    INSERT INTO public.finance_unlinked_obligations(origin_type,concept,category,planned_total_eur,
      payment_type_id,planned_cash_account_id,creation_key,creation_fingerprint,created_by)
    VALUES('one_off',btrim(p_payload->>'concept'),v_type.category,v_amount,v_type.id,v_account,v_key,public.finance_recurring_fingerprint(p_payload),v_actor) RETURNING id INTO v_id;
    INSERT INTO public.finance_unlinked_obligation_installments(obligation_id,sequence_number,due_date,planned_total_eur)
      VALUES(v_id,1,v_date,v_amount) RETURNING id INTO v_installment;
  ELSE
    INSERT INTO public.finance_unlinked_obligation_templates(concept,category,planned_total_eur,start_date,end_date,
      anchor_day,anchor_month,frequency_interval,payment_type_id,planned_cash_account_id,creation_key,creation_fingerprint,created_by)
    VALUES(btrim(p_payload->>'concept'),v_type.category,v_amount,v_date,v_end,extract(day FROM v_date),extract(month FROM v_date),
      v_frequency,v_type.id,v_account,v_key,public.finance_recurring_fingerprint(p_payload),v_actor) RETURNING id INTO v_template;
    PERFORM public.finance_materialize_recurring_payment(v_template,v_date);
    SELECT o.id,i.id INTO v_id,v_installment FROM public.finance_unlinked_obligations o
      JOIN public.finance_unlinked_obligation_installments i ON i.obligation_id=o.id
      WHERE o.template_id=v_template AND o.occurrence_period=v_date;
  END IF;
  IF p_payload->>'action'='paid' THEN
    v_pay:=public.finance_pay_unlinked_installment(jsonb_build_object('idempotency_key',v_key::text||':first',
      'installment_id',v_installment,'amount_eur',v_amount,'paid_date',v_date,'cash_account_id',v_account));
  END IF;
  RETURN jsonb_build_object('template_id',v_template,'obligation_id',v_id,'payment',v_pay,'replayed',false);
END $$;

-- Read-only calendar: future occurrences are projected, materialized individually on payment.
-- This keeps indefinite recurrences visible without GET writes or an unbounded scheduler.
CREATE FUNCTION public.finance_recurring_payment_calendar_rows(p_from date,p_to date)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT public.finance_can_read_treasury() THEN RAISE EXCEPTION 'TREASURY_READ_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to>p_from+interval '18 months' THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  -- Persisted open arrears intentionally survive the lower bound; only presentation is clamped.
  -- Unmaterialized historical projections are not fabricated as debt by a calendar read.
  RETURN QUERY
  SELECT jsonb_build_object('id',i.installment_id,'installment_id',i.installment_id,'obligation_id',o.id,
    'template_id',o.template_id,'date',i.due_date,'display_date',greatest(i.due_date,p_from),'concept',o.concept,'amount_eur',i.outstanding_total_eur,
    'status',CASE WHEN i.due_date<(current_timestamp AT TIME ZONE 'Europe/Madrid')::date THEN 'vencido' WHEN i.allocated_total_eur>0 THEN 'parcial' ELSE 'pendiente' END,
    'payment_type',pt.name,'cash_account_id',CASE WHEN public.finance_can_read_unlinked_details() THEN o.planned_cash_account_id END,
    'can_pay',public.finance_can_manage_unlinked_obligations() AND o.amount_breakdown_mode='total_only')
  FROM public.finance_unlinked_installment_balances i JOIN public.finance_unlinked_obligations o ON o.id=i.obligation_id
  LEFT JOIN public.finance_payment_types pt ON pt.id=o.payment_type_id
  WHERE i.installment_status='active' AND o.lifecycle_status='active' AND i.outstanding_total_eur>0 AND i.due_date<=p_to;
  RETURN QUERY
  SELECT jsonb_build_object('id',p.id,'obligation_id',o.id,'date',(p.paid_at AT TIME ZONE 'Europe/Madrid')::date,'concept',o.concept,
    'amount_eur',p.actual_total_eur,'status','pagado','payment_type',pt.name,'can_pay',false)
  FROM public.finance_unlinked_obligation_payments p JOIN public.finance_unlinked_obligations o ON o.id=p.obligation_id
  LEFT JOIN public.finance_payment_types pt ON pt.id=o.payment_type_id
  WHERE p.status='posted' AND (p.paid_at AT TIME ZONE 'Europe/Madrid')::date BETWEEN p_from AND p_to;
  RETURN QUERY
  SELECT jsonb_build_object('id',t.id::text||':'||d.due::text,'template_id',t.id,'date',d.due,'display_date',d.due,'concept',t.concept,
    'amount_eur',t.planned_total_eur,'status',CASE WHEN d.due<(current_timestamp AT TIME ZONE 'Europe/Madrid')::date THEN 'vencido' ELSE 'pendiente' END,
    'payment_type',pt.name,'cash_account_id',CASE WHEN public.finance_can_read_unlinked_details() THEN t.planned_cash_account_id END,
    'can_pay',public.finance_can_manage_unlinked_obligations() AND t.amount_breakdown_mode='total_only')
  FROM public.finance_unlinked_obligation_templates t
  LEFT JOIN public.finance_payment_types pt ON pt.id=t.payment_type_id
  -- Align directly to the first recurrence month in the requested window.
  CROSS JOIN LATERAL (SELECT greatest(0,
    (extract(year FROM p_from)::int-extract(year FROM t.start_date)::int)*12
      +extract(month FROM p_from)::int-extract(month FROM t.start_date)::int) AS first_month,
    (extract(year FROM p_to)::int-extract(year FROM t.start_date)::int)*12
      +extract(month FROM p_to)::int-extract(month FROM t.start_date)::int AS last_month) bounds
  CROSS JOIN LATERAL generate_series(
    ((bounds.first_month+t.frequency_interval-1)/t.frequency_interval)*t.frequency_interval,
    bounds.last_month,t.frequency_interval) n
  CROSS JOIN LATERAL (SELECT (date_trunc('month',t.start_date)+make_interval(months=>n))::date AS first) m
  CROSS JOIN LATERAL (SELECT m.first+least(t.anchor_day,extract(day FROM (m.first+interval '1 month - 1 day'))::int)-1 AS due) d
  WHERE t.status='active' AND d.due>=t.start_date AND d.due BETWEEN p_from AND p_to AND (t.end_date IS NULL OR d.due<=t.end_date)
    AND NOT EXISTS (SELECT 1 FROM public.finance_unlinked_obligations o WHERE o.template_id=t.id AND o.occurrence_period=d.due);
END $$;

-- Aggregate into one JSON value: PostgREST row limits must not truncate financial totals.
CREATE FUNCTION public.finance_recurring_payment_calendar(p_from date,p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'date',row->>'id'),'[]'::jsonb)
  FROM public.finance_recurring_payment_calendar_rows(p_from,p_to) AS row
$$;
REVOKE ALL ON FUNCTION public.finance_recurring_payment_calendar_rows(date,date) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.finance_recurring_payment_calendar_rows(date,date) OWNER TO postgres;

-- Shared finance visibility is intentional: admin/accounting can resolve any operation.
-- Browser user scoping isolates retries; it is not an ownership authorization rule.
-- not_found is not proof of non-execution: a request may still be in flight.
CREATE FUNCTION public.finance_recurring_operation_status(p_operation_id uuid,p_paying boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public.finance_assert_unlinked_actor();
  IF p_operation_id IS NULL OR p_paying IS NULL THEN RAISE EXCEPTION 'INVALID_OPERATION'; END IF;
  IF p_paying THEN
    SELECT jsonb_build_object('payment_id',id,'payment_status',status) INTO v_result
      FROM public.finance_unlinked_obligation_payments WHERE idempotency_key=p_operation_id::text;
  ELSE
    SELECT jsonb_build_object('template_id',id) INTO v_result
      FROM public.finance_unlinked_obligation_templates WHERE creation_key=p_operation_id;
    IF v_result IS NULL THEN
      SELECT jsonb_build_object('obligation_id',id) INTO v_result
        FROM public.finance_unlinked_obligations WHERE creation_key=p_operation_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('state',CASE WHEN v_result IS NULL THEN 'not_found' ELSE 'confirmed' END,'result',v_result);
END $$;
REVOKE ALL ON FUNCTION public.finance_recurring_operation_status(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_recurring_operation_status(uuid,boolean) TO authenticated,service_role;
ALTER FUNCTION public.finance_recurring_operation_status(uuid,boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.finance_pay_unlinked_installment(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finance_create_recurring_payment(jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finance_recurring_payment_calendar(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_pay_unlinked_installment(jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_create_recurring_payment(jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_recurring_payment_calendar(date,date) TO authenticated,service_role;
ALTER FUNCTION public.finance_pay_unlinked_installment(jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_create_recurring_payment(jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_recurring_payment_calendar(date,date) OWNER TO postgres;
NOTIFY pgrst,'reload schema';
COMMIT;
