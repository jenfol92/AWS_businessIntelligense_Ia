-- Fase 1: plantillas y generación manual idempotente por periodos civiles.

BEGIN;

CREATE OR REPLACE FUNCTION public.finance_create_unlinked_obligation_template(p_payload jsonb)
RETURNS public.finance_unlinked_obligation_templates LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user_id uuid:=public.finance_assert_unlinked_actor(); v_template public.finance_unlinked_obligation_templates;
  v_start date:=(p_payload->>'start_date')::date; v_end date:=(p_payload->>'end_date')::date;
  v_interval integer:=(p_payload->>'frequency_interval')::integer;
  v_mode text:=coalesce(nullif(p_payload->>'amount_breakdown_mode',''),'total_only');
  v_principal numeric:=CASE WHEN p_payload->>'planned_principal_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_principal_eur')::numeric,2) END;
  v_interest numeric:=CASE WHEN p_payload->>'planned_interest_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_interest_eur')::numeric,2) END;
  v_fees numeric:=CASE WHEN p_payload->>'planned_other_fees_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_other_fees_eur')::numeric,2) END;
  v_total numeric:=round((p_payload->>'planned_total_eur')::numeric,2);
BEGIN
  IF btrim(coalesce(p_payload->>'concept',''))='' THEN RAISE EXCEPTION 'INVALID_CONCEPT'; END IF;
  IF coalesce(p_payload->>'frequency_unit','month')<>'month' OR v_interval NOT IN (1,3,12) THEN RAISE EXCEPTION 'INVALID_FREQUENCY'; END IF;
  IF v_start IS NULL OR v_end IS NULL OR v_end<v_start THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  PERFORM public.finance_validate_unlinked_amount(v_mode,v_principal,v_interest,v_fees,v_total,'template');
  INSERT INTO public.finance_unlinked_obligation_templates (
    concept,category,counterparty_name,description,amount_breakdown_mode,
    planned_principal_eur,planned_interest_eur,planned_other_fees_eur,planned_total_eur,
    start_date,end_date,anchor_day,anchor_month,frequency_unit,frequency_interval,status,created_by
  ) VALUES (btrim(p_payload->>'concept'),p_payload->>'category',nullif(btrim(p_payload->>'counterparty_name'),''),
    nullif(btrim(p_payload->>'description'),''),v_mode,v_principal,v_interest,v_fees,v_total,v_start,v_end,
    extract(day FROM v_start)::integer,extract(month FROM v_start)::integer,'month',v_interval,'active',v_user_id)
  RETURNING * INTO v_template;
  RETURN v_template;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_update_unlinked_obligation_template(p_template_id uuid,p_payload jsonb)
RETURNS public.finance_unlinked_obligation_templates LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_template public.finance_unlinked_obligation_templates; v_mode text;
  v_principal numeric; v_interest numeric; v_fees numeric; v_total numeric;
  v_end date; v_interval integer; v_status text; v_latest_occurrence date; v_has_occurrences boolean;
BEGIN
  PERFORM public.finance_assert_unlinked_actor();
  SELECT * INTO v_template FROM public.finance_unlinked_obligation_templates WHERE id=p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: template not found'; END IF;
  IF v_template.status IN ('ended','cancelled') THEN RAISE EXCEPTION 'TEMPLATE_IMMUTABLE'; END IF;
  IF p_payload ?| ARRAY['start_date','anchor_day','anchor_month','frequency_unit'] THEN RAISE EXCEPTION 'IMMUTABLE_TEMPLATE_ANCHOR'; END IF;
  SELECT max(occurrence_period),count(*)>0 INTO v_latest_occurrence,v_has_occurrences
  FROM public.finance_unlinked_obligations WHERE template_id=p_template_id;
  v_interval:=coalesce((p_payload->>'frequency_interval')::integer,v_template.frequency_interval);
  IF v_interval NOT IN (1,3,12) THEN RAISE EXCEPTION 'INVALID_FREQUENCY'; END IF;
  IF v_has_occurrences AND v_interval<>v_template.frequency_interval THEN
    RAISE EXCEPTION 'IMMUTABLE_TEMPLATE_FREQUENCY: create a new template to change frequency';
  END IF;
  v_end:=coalesce((p_payload->>'end_date')::date,v_template.end_date);
  IF v_end<v_template.start_date THEN RAISE EXCEPTION 'INVALID_DATE_RANGE'; END IF;
  IF v_latest_occurrence IS NOT NULL AND v_end<v_latest_occurrence THEN
    RAISE EXCEPTION 'END_DATE_BEFORE_LATEST_OCCURRENCE: generated occurrences cannot be removed';
  END IF;
  v_status:=coalesce(nullif(p_payload->>'status',''),v_template.status);
  IF v_status NOT IN ('active','paused','ended','cancelled') THEN RAISE EXCEPTION 'INVALID_TEMPLATE_STATUS'; END IF;
  v_mode:=coalesce(nullif(p_payload->>'amount_breakdown_mode',''),v_template.amount_breakdown_mode);
  v_principal:=CASE WHEN p_payload?'planned_principal_eur' THEN round((p_payload->>'planned_principal_eur')::numeric,2) ELSE v_template.planned_principal_eur END;
  v_interest:=CASE WHEN p_payload?'planned_interest_eur' THEN round((p_payload->>'planned_interest_eur')::numeric,2) ELSE v_template.planned_interest_eur END;
  v_fees:=CASE WHEN p_payload?'planned_other_fees_eur' THEN round((p_payload->>'planned_other_fees_eur')::numeric,2) ELSE v_template.planned_other_fees_eur END;
  v_total:=CASE WHEN p_payload?'planned_total_eur' THEN round((p_payload->>'planned_total_eur')::numeric,2) ELSE v_template.planned_total_eur END;
  PERFORM public.finance_validate_unlinked_amount(v_mode,v_principal,v_interest,v_fees,v_total,'template');
  UPDATE public.finance_unlinked_obligation_templates SET
    concept=coalesce(nullif(btrim(p_payload->>'concept'),''),concept),category=coalesce(nullif(btrim(p_payload->>'category'),''),category),
    counterparty_name=CASE WHEN p_payload?'counterparty_name' THEN nullif(btrim(p_payload->>'counterparty_name'),'') ELSE counterparty_name END,
    description=CASE WHEN p_payload?'description' THEN nullif(btrim(p_payload->>'description'),'') ELSE description END,
    amount_breakdown_mode=v_mode,planned_principal_eur=v_principal,planned_interest_eur=v_interest,
    planned_other_fees_eur=v_fees,planned_total_eur=v_total,end_date=v_end,frequency_interval=v_interval,status=v_status,updated_at=now()
  WHERE id=p_template_id RETURNING * INTO v_template;
  RETURN v_template;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_generate_unlinked_obligation_occurrences(p_template_id uuid,p_through_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_template public.finance_unlinked_obligation_templates; v_month_index integer:=0; v_month_start date;
  v_last_day integer; v_occurrence_date date; v_cap date; v_obligation_id uuid;
  v_created jsonb:='[]'::jsonb; v_existing jsonb:='[]'::jsonb;
BEGIN
  PERFORM public.finance_assert_unlinked_actor();
  IF p_template_id IS NULL OR p_through_date IS NULL THEN RAISE EXCEPTION 'INVALID_GENERATION_INPUT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('unlinked_template:'||p_template_id::text,0));
  SELECT * INTO v_template FROM public.finance_unlinked_obligation_templates WHERE id=p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: template not found'; END IF;
  IF v_template.status<>'active' THEN RETURN jsonb_build_object('template_id',p_template_id,'created',v_created,'existing',v_existing,'skipped_status',v_template.status); END IF;
  v_cap:=least(p_through_date,v_template.end_date);
  IF v_cap<v_template.start_date THEN RETURN jsonb_build_object('template_id',p_template_id,'created',v_created,'existing',v_existing); END IF;
  LOOP
    v_month_start:=(date_trunc('month',v_template.start_date)::date+make_interval(months=>v_month_index))::date;
    EXIT WHEN v_month_start>v_cap;
    v_last_day:=extract(day FROM (v_month_start+interval '1 month - 1 day'))::integer;
    v_occurrence_date:=make_date(extract(year FROM v_month_start)::integer,extract(month FROM v_month_start)::integer,least(v_template.anchor_day,v_last_day));
    IF v_occurrence_date>=v_template.start_date AND v_occurrence_date<=v_cap THEN
      INSERT INTO public.finance_unlinked_obligations (
        template_id,occurrence_period,origin_type,concept,category,counterparty_name,description,amount_breakdown_mode,
        planned_principal_eur,planned_interest_eur,planned_other_fees_eur,planned_total_eur,lifecycle_status,created_by
      ) VALUES (v_template.id,v_occurrence_date,'recurring_occurrence',v_template.concept,v_template.category,
        v_template.counterparty_name,v_template.description,v_template.amount_breakdown_mode,v_template.planned_principal_eur,
        v_template.planned_interest_eur,v_template.planned_other_fees_eur,v_template.planned_total_eur,'active',auth.uid())
      ON CONFLICT (template_id,occurrence_period) WHERE template_id IS NOT NULL DO NOTHING RETURNING id INTO v_obligation_id;
      IF v_obligation_id IS NOT NULL THEN
        INSERT INTO public.finance_unlinked_obligation_installments (
          obligation_id,plan_revision,sequence_number,due_date,amount_breakdown_mode,
          planned_principal_eur,planned_interest_eur,planned_other_fees_eur,planned_total_eur
        ) VALUES (v_obligation_id,1,1,v_occurrence_date,v_template.amount_breakdown_mode,v_template.planned_principal_eur,
          v_template.planned_interest_eur,v_template.planned_other_fees_eur,v_template.planned_total_eur);
        v_created:=v_created||jsonb_build_array(jsonb_build_object('obligation_id',v_obligation_id,'occurrence_period',v_occurrence_date));
      ELSE
        SELECT id INTO v_obligation_id FROM public.finance_unlinked_obligations WHERE template_id=v_template.id AND occurrence_period=v_occurrence_date;
        v_existing:=v_existing||jsonb_build_array(jsonb_build_object('obligation_id',v_obligation_id,'occurrence_period',v_occurrence_date));
      END IF;
      v_obligation_id:=NULL;
    END IF;
    v_month_index:=v_month_index+v_template.frequency_interval;
  END LOOP;
  RETURN jsonb_build_object('template_id',p_template_id,'created',v_created,'existing',v_existing);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finance_create_unlinked_obligation_template(jsonb) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.finance_update_unlinked_obligation_template(uuid,jsonb) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.finance_generate_unlinked_obligation_occurrences(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_create_unlinked_obligation_template(jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_update_unlinked_obligation_template(uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_generate_unlinked_obligation_occurrences(uuid,date) TO authenticated,service_role;
ALTER FUNCTION public.finance_create_unlinked_obligation_template(jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_update_unlinked_obligation_template(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_generate_unlinked_obligation_occurrences(uuid,date) OWNER TO postgres;

COMMIT;
