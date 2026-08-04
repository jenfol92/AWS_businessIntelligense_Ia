-- Fase 1B.1: regularizacion atomica y desglosada de saldos legacy.
-- No configura lineas por nombre bancario y no ejecuta backfill financiero.
BEGIN;

ALTER TABLE public.finance_credit_line_repayment_groups
  ADD COLUMN group_origin_type text NOT NULL DEFAULT 'operational_cycle',
  ADD COLUMN group_origin_id uuid NULL;

UPDATE public.finance_credit_line_repayment_groups
SET group_origin_type='operational_cycle',group_origin_id=NULL;

ALTER TABLE public.finance_credit_line_repayment_groups
  ADD CONSTRAINT finance_credit_line_repayment_groups_origin_type_check
    CHECK (group_origin_type IN ('operational_cycle','legacy_regularization')),
  ADD CONSTRAINT finance_credit_line_repayment_groups_origin_identity_check
    CHECK ((group_origin_type='operational_cycle' AND group_origin_id IS NULL)
        OR (group_origin_type='legacy_regularization' AND group_origin_id IS NOT NULL));

DO $$
DECLARE v_operational_dupes integer; v_legacy_dupes integer;
BEGIN
  SELECT count(*) INTO v_operational_dupes FROM (
    SELECT credit_line_id,period_start,period_end FROM public.finance_credit_line_repayment_groups
    WHERE status<>'cancelled' AND group_origin_type='operational_cycle'
    GROUP BY 1,2,3 HAVING count(*)>1
  ) d;
  SELECT count(*) INTO v_legacy_dupes FROM (
    SELECT group_origin_id,due_date FROM public.finance_credit_line_repayment_groups
    WHERE status<>'cancelled' AND group_origin_type='legacy_regularization'
    GROUP BY 1,2 HAVING count(*)>1
  ) d;
  IF v_operational_dupes>0 THEN RAISE EXCEPTION 'OPERATIONAL_GROUP_DUPLICATES: %',v_operational_dupes; END IF;
  IF v_legacy_dupes>0 THEN RAISE EXCEPTION 'LEGACY_GROUP_DUPLICATES: %',v_legacy_dupes; END IF;
END $$;

DROP INDEX IF EXISTS public.ux_finance_credit_line_repayment_groups_active_period;
CREATE UNIQUE INDEX ux_finance_credit_line_repayment_groups_operational_period
  ON public.finance_credit_line_repayment_groups(credit_line_id,period_start,period_end)
  WHERE status<>'cancelled' AND group_origin_type='operational_cycle';
CREATE UNIQUE INDEX ux_finance_credit_line_repayment_groups_legacy_due
  ON public.finance_credit_line_repayment_groups(group_origin_id,due_date)
  WHERE status<>'cancelled' AND group_origin_type='legacy_regularization';

-- Patch guardado del RPC canonico: todo lookup/insert ordinario queda aislado a operational_cycle.
DO $$
DECLARE v_definition text; v_patched text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.finance_create_credit_line_drawdown(uuid,numeric,date,text,uuid,text,text,date)')) INTO v_definition;
  IF v_definition IS NULL THEN RAISE EXCEPTION 'DRAW_DOWN_FUNCTION_NOT_FOUND'; END IF;
  IF (length(v_definition)-length(replace(v_definition,'AND due_date = v_due_date','')))/length('AND due_date = v_due_date')<>1
     OR (length(v_definition)-length(replace(v_definition,'AND p_movement_date BETWEEN period_start AND period_end','')))/length('AND p_movement_date BETWEEN period_start AND period_end')<>1
     OR (length(v_definition)-length(replace(v_definition,
       'credit_line_id, period_start, period_end, due_date,'||chr(10)||'        amount, paid_amount, remaining_amount, status, updated_at','')))
       /length('credit_line_id, period_start, period_end, due_date,'||chr(10)||'        amount, paid_amount, remaining_amount, status, updated_at')<>2
     OR (length(v_definition)-length(replace(v_definition,
       '0, 0, 0, ''open'', now()'||chr(10)||'      ) RETURNING','')))
       /length('0, 0, 0, ''open'', now()'||chr(10)||'      ) RETURNING')<>2 THEN
    RAISE EXCEPTION 'DRAW_DOWN_FUNCTION_SHAPE_MISMATCH';
  END IF;
  v_patched:=replace(v_definition,
    'AND due_date = v_due_date',
    'AND due_date = v_due_date'||chr(10)||'      AND group_origin_type = ''operational_cycle''');
  v_patched:=replace(v_patched,
    'AND p_movement_date BETWEEN period_start AND period_end',
    'AND p_movement_date BETWEEN period_start AND period_end'||chr(10)||'      AND group_origin_type = ''operational_cycle''');
  v_patched:=replace(v_patched,
    'credit_line_id, period_start, period_end, due_date,'||chr(10)||'        amount, paid_amount, remaining_amount, status, updated_at',
    'credit_line_id, period_start, period_end, due_date,'||chr(10)||'        amount, paid_amount, remaining_amount, status, updated_at, group_origin_type');
  v_patched:=replace(v_patched,
    '0, 0, 0, ''open'', now()'||chr(10)||'      ) RETURNING',
    '0, 0, 0, ''open'', now(), ''operational_cycle'''||chr(10)||'      ) RETURNING');
  EXECUTE v_patched;
  SELECT pg_get_functiondef(to_regprocedure('public.finance_create_credit_line_drawdown(uuid,numeric,date,text,uuid,text,text,date)')) INTO v_definition;
  IF (length(v_definition)-length(replace(v_definition,
       'AND due_date = v_due_date'||chr(10)||'      AND group_origin_type = ''operational_cycle''','')))
       /length('AND due_date = v_due_date'||chr(10)||'      AND group_origin_type = ''operational_cycle''')<>1
     OR (length(v_definition)-length(replace(v_definition,
       'AND p_movement_date BETWEEN period_start AND period_end'||chr(10)||'      AND group_origin_type = ''operational_cycle''','')))
       /length('AND p_movement_date BETWEEN period_start AND period_end'||chr(10)||'      AND group_origin_type = ''operational_cycle''')<>1
     OR (length(v_definition)-length(replace(v_definition,'updated_at, group_origin_type','')))
       /length('updated_at, group_origin_type')<>2
     OR (length(v_definition)-length(replace(v_definition,'now(), ''operational_cycle''','')))
       /length('now(), ''operational_cycle''')<>2
     OR v_definition LIKE '%amount, paid_amount, remaining_amount, status, updated_at'||chr(10)||'      ) VALUES%'
     OR v_definition LIKE '%0, 0, 0, ''open'', now()'||chr(10)||'      ) RETURNING%' THEN
    RAISE EXCEPTION 'DRAW_DOWN_OPERATIONAL_ISOLATION_NOT_INSTALLED';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.finance_reject_drawdown_into_legacy_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.movement_type='drawdown' AND EXISTS(
    SELECT 1 FROM public.finance_credit_line_repayment_groups g
    WHERE g.id=NEW.repayment_group_id AND g.group_origin_type<>'operational_cycle'
  ) THEN
    RAISE EXCEPTION 'DRAWDOWN_LEGACY_GROUP_FORBIDDEN' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finance_credit_line_movements_no_legacy_drawdown
BEFORE INSERT OR UPDATE OF repayment_group_id,movement_type ON public.finance_credit_line_movements
FOR EACH ROW EXECUTE FUNCTION public.finance_reject_drawdown_into_legacy_group();

CREATE OR REPLACE FUNCTION public.finance_block_legacy_regularization_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_FINANCIAL_OPERATION: legacy regularizations cannot be updated or deleted directly'
    USING ERRCODE='55000';
END $$;

CREATE TABLE public.finance_credit_line_legacy_regularizations(
  id uuid PRIMARY KEY,
  credit_line_id uuid NOT NULL REFERENCES public.finance_credit_lines(id),
  derived_gap_eur numeric(14,2) NOT NULL,
  declared_total_eur numeric(14,2) NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key)<>'' AND length(btrim(idempotency_key))<=200),
  payload_fingerprint text NOT NULL CHECK (btrim(payload_fingerprint)<>''),
  status text NOT NULL DEFAULT 'posted' CHECK(status='posted'),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_credit_line_legacy_regularizations_amount_check CHECK(
    public.finance_is_finite_numeric(derived_gap_eur) AND derived_gap_eur>0
    AND public.finance_is_finite_numeric(declared_total_eur) AND declared_total_eur>0
    AND derived_gap_eur=declared_total_eur)
);

ALTER TABLE public.finance_credit_line_repayment_groups
  ADD CONSTRAINT finance_credit_line_repayment_groups_legacy_origin_fk
  FOREIGN KEY(group_origin_id) REFERENCES public.finance_credit_line_legacy_regularizations(id) ON DELETE RESTRICT;

CREATE TABLE public.finance_credit_line_legacy_regularization_items(
  id uuid PRIMARY KEY,
  regularization_id uuid NOT NULL REFERENCES public.finance_credit_line_legacy_regularizations(id),
  credit_line_id uuid NOT NULL REFERENCES public.finance_credit_lines(id),
  principal_eur numeric(14,2) NOT NULL CHECK(public.finance_is_finite_numeric(principal_eur) AND principal_eur>0),
  disposition_date date NOT NULL,
  contractual_due_date date NOT NULL,
  reference text NULL CHECK(reference IS NULL OR length(reference)<=250),
  notes text NULL CHECK(notes IS NULL OR length(notes)<=2000),
  repayment_group_id uuid NOT NULL REFERENCES public.finance_credit_line_repayment_groups(id),
  credit_line_movement_id uuid NOT NULL UNIQUE REFERENCES public.finance_credit_line_movements(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_credit_line_legacy_items_date_check CHECK(disposition_date<=contractual_due_date)
);
CREATE INDEX finance_credit_line_legacy_regularizations_line_idx ON public.finance_credit_line_legacy_regularizations(credit_line_id);
CREATE INDEX finance_credit_line_legacy_items_operation_idx ON public.finance_credit_line_legacy_regularization_items(regularization_id);
CREATE INDEX finance_credit_line_legacy_items_group_idx ON public.finance_credit_line_legacy_regularization_items(repayment_group_id);

CREATE TRIGGER finance_credit_line_legacy_regularizations_immutable BEFORE UPDATE OR DELETE
  ON public.finance_credit_line_legacy_regularizations FOR EACH ROW EXECUTE FUNCTION public.finance_block_legacy_regularization_mutation();
CREATE TRIGGER finance_credit_line_legacy_items_immutable BEFORE UPDATE OR DELETE
  ON public.finance_credit_line_legacy_regularization_items FOR EACH ROW EXECUTE FUNCTION public.finance_block_legacy_regularization_mutation();

ALTER TABLE public.finance_credit_line_legacy_regularizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_credit_line_legacy_regularization_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_credit_line_legacy_regularizations_select_treasury ON public.finance_credit_line_legacy_regularizations
  FOR SELECT TO authenticated USING(public.finance_can_read_treasury());
CREATE POLICY finance_credit_line_legacy_items_select_treasury ON public.finance_credit_line_legacy_regularization_items
  FOR SELECT TO authenticated USING(public.finance_can_read_treasury());
REVOKE ALL ON public.finance_credit_line_legacy_regularizations,public.finance_credit_line_legacy_regularization_items FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.finance_credit_line_legacy_regularizations,public.finance_credit_line_legacy_regularization_items TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.finance_register_legacy_opening_balance_v2(
  p_credit_line_id uuid,p_dispositions jsonb,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_line public.finance_credit_lines%ROWTYPE;
  v_existing public.finance_credit_line_legacy_regularizations%ROWTYPE;
  v_regularization_id uuid:=gen_random_uuid();
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_normalized jsonb;
  v_fingerprint text;
  v_explained numeric;
  v_gap numeric;
  v_total numeric:=0;
  v_item jsonb;
  v_principal numeric;
  v_disposition_date date;
  v_due_date date;
  v_reference text;
  v_notes text;
  v_item_id uuid;
  v_movement_id uuid;
  v_group_id uuid;
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_credit_line_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: credit line is required'; END IF;
  IF v_key IS NULL OR length(v_key)>200 THEN RAISE EXCEPTION 'INVALID_AMOUNT: invalid idempotency key'; END IF;
  IF p_dispositions IS NULL OR jsonb_typeof(p_dispositions)<>'array' OR jsonb_array_length(p_dispositions)=0
     OR jsonb_array_length(p_dispositions)>500 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: dispositions must be a non-empty array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_dispositions) LOOP
    IF jsonb_typeof(v_item)<>'object'
       OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_item) k WHERE k NOT IN ('principalEur','dispositionDate','contractualDueDate','reference','notes')) THEN
      RAISE EXCEPTION 'INVALID_AMOUNT: invalid disposition object';
    END IF;
    IF jsonb_typeof(v_item->'principalEur')<>'number'
       OR jsonb_typeof(v_item->'dispositionDate')<>'string'
       OR jsonb_typeof(v_item->'contractualDueDate')<>'string'
       OR (v_item ? 'reference' AND jsonb_typeof(v_item->'reference') NOT IN ('string','null'))
       OR (v_item ? 'notes' AND jsonb_typeof(v_item->'notes') NOT IN ('string','null')) THEN
      RAISE EXCEPTION 'INVALID_AMOUNT: disposition uses invalid JSON types';
    END IF;
    IF (v_item->>'dispositionDate') !~ '^\d{4}-\d{2}-\d{2}$'
       OR (v_item->>'contractualDueDate') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'INVALID_DATE: dates must use YYYY-MM-DD';
    END IF;
    BEGIN
      v_principal:=(v_item->>'principalEur')::numeric;
      v_disposition_date:=(v_item->>'dispositionDate')::date;
      v_due_date:=(v_item->>'contractualDueDate')::date;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_AMOUNT: invalid disposition values'; END;
    IF NOT public.finance_is_finite_numeric(v_principal) OR v_principal<=0 OR v_principal>=1000000000000
       OR v_principal<>round(v_principal,2) THEN RAISE EXCEPTION 'INVALID_AMOUNT: invalid disposition principal'; END IF;
    IF v_disposition_date IS NULL OR v_due_date IS NULL OR v_disposition_date>current_date OR v_disposition_date>v_due_date THEN
      RAISE EXCEPTION 'INVALID_DATE: invalid disposition dates';
    END IF;
    IF length(coalesce(v_item->>'reference',''))>250 OR length(coalesce(v_item->>'notes',''))>2000 THEN
      RAISE EXCEPTION 'INVALID_AMOUNT: disposition text is too long';
    END IF;
    v_total:=v_total+v_principal;
  END LOOP;
  IF NOT public.finance_is_finite_numeric(v_total) OR v_total>=1000000000000 THEN RAISE EXCEPTION 'INVALID_AMOUNT: invalid disposition total'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'principalEur',round((x->>'principalEur')::numeric,2),
    'dispositionDate',(x->>'dispositionDate')::date,
    'contractualDueDate',(x->>'contractualDueDate')::date,
    'reference',nullif(btrim(x->>'reference'),''),'notes',nullif(btrim(x->>'notes'),'')
  ) ORDER BY (x->>'contractualDueDate')::date,(x->>'dispositionDate')::date,
    round((x->>'principalEur')::numeric,2),coalesce(nullif(btrim(x->>'reference'),''),''),coalesce(nullif(btrim(x->>'notes'),''),''))
  INTO v_normalized FROM jsonb_array_elements(p_dispositions) x;
  v_fingerprint:=md5(jsonb_build_object('creditLineId',p_credit_line_id,'dispositions',v_normalized)::text);

  PERFORM pg_advisory_xact_lock(hashtextextended('legacy-regularization:'||v_key,0));
  SELECT * INTO v_existing FROM public.finance_credit_line_legacy_regularizations WHERE idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.payload_fingerprint IS DISTINCT FROM v_fingerprint THEN RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
    RETURN jsonb_build_object('regularization_id',v_existing.id,'credit_line_id',v_existing.credit_line_id,
      'derived_gap_eur',v_existing.derived_gap_eur,'declared_total_eur',v_existing.declared_total_eur,
      'groups',(SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('repayment_group_id',g.id,'contractual_due_date',g.due_date,'principal_eur',g.amount)),'[]'::jsonb) FROM public.finance_credit_line_repayment_groups g WHERE g.group_origin_id=v_existing.id),
      'dispositions',(SELECT coalesce(jsonb_agg(jsonb_build_object('disposition_id',i.id,'repayment_group_id',i.repayment_group_id,'credit_line_movement_id',i.credit_line_movement_id,'principal_eur',i.principal_eur,'disposition_date',i.disposition_date,'contractual_due_date',i.contractual_due_date)),'[]'::jsonb) FROM public.finance_credit_line_legacy_regularization_items i WHERE i.regularization_id=v_existing.id),
      'idempotent',true);
  END IF;

  SELECT * INTO v_line FROM public.finance_credit_lines WHERE id=p_credit_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: credit line'; END IF;
  IF lower(btrim(coalesce(v_line.status,''))) IN ('deleted','eliminada') THEN
    RAISE EXCEPTION 'CREDIT_LINE_DELETED';
  END IF;
  IF NOT public.finance_is_finite_numeric(v_line.used_amount) OR v_line.used_amount<0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: credit line used amount is invalid';
  END IF;
  IF (v_line.repayment_mode='periodic_release' AND coalesce(v_line.cycle_days,0)<=0)
     OR (v_line.repayment_mode='manual_due_dates' AND v_line.cycle_days IS NOT NULL)
     OR v_line.repayment_mode NOT IN ('periodic_release','manual_due_dates') THEN
    RAISE EXCEPTION 'INVALID_CREDIT_LINE_CONFIGURATION';
  END IF;
  SELECT coalesce(sum(remaining_amount),0) INTO v_explained FROM public.finance_credit_line_repayment_groups
    WHERE credit_line_id=p_credit_line_id AND status IN ('open','partially_paid');
  IF NOT public.finance_is_finite_numeric(v_explained) OR v_explained<0 THEN RAISE EXCEPTION 'INVALID_AMOUNT: explained amount is invalid'; END IF;
  v_gap:=round(v_line.used_amount-v_explained,2);
  IF v_gap<0 THEN RAISE EXCEPTION 'EXPLAINED_PRINCIPAL_EXCEEDS_USED'; END IF;
  IF v_gap=0 THEN RAISE EXCEPTION 'NO_LEGACY_GAP'; END IF;
  IF round(v_total,2)<v_gap THEN RAISE EXCEPTION 'LEGACY_BREAKDOWN_BELOW_GAP'; END IF;
  IF round(v_total,2)>v_gap THEN RAISE EXCEPTION 'LEGACY_BREAKDOWN_EXCEEDS_GAP'; END IF;

  INSERT INTO public.finance_credit_line_legacy_regularizations(id,credit_line_id,derived_gap_eur,declared_total_eur,idempotency_key,payload_fingerprint,created_by)
    VALUES(v_regularization_id,p_credit_line_id,v_gap,round(v_total,2),v_key,v_fingerprint,auth.uid());

  FOR v_due_date IN SELECT DISTINCT (x->>'contractualDueDate')::date FROM jsonb_array_elements(v_normalized) x LOOP
    v_group_id:=gen_random_uuid();
    BEGIN
      INSERT INTO public.finance_credit_line_repayment_groups(id,credit_line_id,period_start,period_end,due_date,amount,paid_amount,remaining_amount,status,group_origin_type,group_origin_id)
      SELECT v_group_id,p_credit_line_id,min((x->>'dispositionDate')::date),max((x->>'dispositionDate')::date),v_due_date,
        sum((x->>'principalEur')::numeric),0,sum((x->>'principalEur')::numeric),'open','legacy_regularization',v_regularization_id
      FROM jsonb_array_elements(v_normalized) x WHERE (x->>'contractualDueDate')::date=v_due_date;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'LEGACY_PERIOD_CONFLICT'; END;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_normalized) LOOP
    v_item_id:=gen_random_uuid(); v_movement_id:=gen_random_uuid();
    v_principal:=(v_item->>'principalEur')::numeric; v_disposition_date:=(v_item->>'dispositionDate')::date; v_due_date:=(v_item->>'contractualDueDate')::date;
    v_reference:=nullif(btrim(v_item->>'reference'),''); v_notes:=nullif(btrim(v_item->>'notes'),'');
    SELECT id INTO v_group_id FROM public.finance_credit_line_repayment_groups WHERE group_origin_id=v_regularization_id AND due_date=v_due_date;
    INSERT INTO public.finance_credit_line_movements(id,credit_line_id,movement_type,description,due_date,amount,status,source_type,source_id,movement_date,repayment_group_id,idempotency_key)
      VALUES(v_movement_id,p_credit_line_id,'adjustment',coalesce(nullif(concat_ws(' | ','Saldo inicial legacy',v_reference,v_notes),''),'Saldo inicial legacy'),v_due_date,v_principal,'posted','legacy_opening_balance',v_item_id,v_disposition_date,v_group_id,'legacy-item:'||v_item_id);
    INSERT INTO public.finance_credit_line_legacy_regularization_items(id,regularization_id,credit_line_id,principal_eur,disposition_date,contractual_due_date,reference,notes,repayment_group_id,credit_line_movement_id)
      VALUES(v_item_id,v_regularization_id,p_credit_line_id,v_principal,v_disposition_date,v_due_date,v_reference,v_notes,v_group_id,v_movement_id);
  END LOOP;

  RETURN jsonb_build_object('regularization_id',v_regularization_id,'credit_line_id',p_credit_line_id,'derived_gap_eur',v_gap,'declared_total_eur',round(v_total,2),
    'groups',(SELECT jsonb_agg(jsonb_build_object('repayment_group_id',g.id,'contractual_due_date',g.due_date,'principal_eur',g.amount) ORDER BY g.due_date) FROM public.finance_credit_line_repayment_groups g WHERE g.group_origin_id=v_regularization_id),
    'dispositions',(SELECT jsonb_agg(jsonb_build_object('disposition_id',i.id,'repayment_group_id',i.repayment_group_id,'credit_line_movement_id',i.credit_line_movement_id,'principal_eur',i.principal_eur,'disposition_date',i.disposition_date,'contractual_due_date',i.contractual_due_date) ORDER BY i.contractual_due_date,i.disposition_date,i.id) FROM public.finance_credit_line_legacy_regularization_items i WHERE i.regularization_id=v_regularization_id),
    'idempotent',false);
END $$;

DO $$ BEGIN
  IF to_regprocedure('public.finance_register_legacy_opening_balance(uuid,numeric,date,date,text,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.finance_register_legacy_opening_balance(uuid,numeric,date,date,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text) TO authenticated,service_role;
ALTER FUNCTION public.finance_register_legacy_opening_balance_v2(uuid,jsonb,text) OWNER TO postgres;
NOTIFY pgrst,'reload schema';
COMMIT;
