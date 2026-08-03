-- Fase 1: RPC de obligaciones puntuales y planes versionados. Sin pagos ni movimientos.

BEGIN;

CREATE OR REPLACE FUNCTION public.finance_assert_unlinked_actor()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required' USING ERRCODE = '42501';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_validate_unlinked_amount(
  p_mode text, p_principal numeric, p_interest numeric, p_other_fees numeric, p_total numeric, p_label text
)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_mode NOT IN ('total_only', 'detailed')
     OR NOT public.finance_is_finite_numeric(p_total) OR p_total <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: % mode or total is invalid', p_label;
  END IF;
  IF p_mode = 'total_only' THEN
    IF p_principal IS NOT NULL OR p_interest IS NOT NULL OR p_other_fees IS NOT NULL THEN
      RAISE EXCEPTION 'TOTAL_ONLY_COMPONENTS_FORBIDDEN: % components must remain NULL', p_label;
    END IF;
  ELSE
    IF NOT public.finance_is_finite_numeric(p_principal) OR p_principal < 0
       OR NOT public.finance_is_finite_numeric(p_interest) OR p_interest < 0
       OR NOT public.finance_is_finite_numeric(p_other_fees) OR p_other_fees < 0
       OR round(p_principal + p_interest + p_other_fees, 2) <> round(p_total, 2) THEN
      RAISE EXCEPTION 'INVALID_COMPONENTS: % detailed components are required and must add to total', p_label;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_insert_unlinked_installment_plan(
  p_obligation_id uuid, p_payload jsonb, p_mode text,
  p_expected_principal numeric, p_expected_interest numeric, p_expected_fees numeric,
  p_expected_total numeric, p_plan_revision integer
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row jsonb; v_dates jsonb; v_count integer; v_index integer := 0;
  v_sequence integer; v_due_date date; v_principal numeric; v_interest numeric; v_fees numeric; v_total numeric;
  v_sum_principal numeric := 0; v_sum_interest numeric := 0; v_sum_fees numeric := 0; v_sum_total numeric := 0;
  v_principal_cents bigint; v_interest_cents bigint; v_fees_cents bigint; v_total_cents bigint;
  v_base_principal bigint; v_base_interest bigint; v_base_fees bigint; v_base_total bigint;
  v_current_principal bigint; v_current_interest bigint; v_current_fees bigint; v_current_total bigint;
BEGIN
  IF p_payload ? 'installments' AND jsonb_typeof(p_payload->'installments') = 'array' THEN
    v_count := jsonb_array_length(p_payload->'installments');
    IF v_count < 1 THEN RAISE EXCEPTION 'INVALID_INSTALLMENTS: at least one installment is required'; END IF;
    FOR v_row IN SELECT value FROM jsonb_array_elements(p_payload->'installments') LOOP
      v_index := v_index + 1;
      v_sequence := coalesce((v_row->>'sequence_number')::integer, v_index);
      v_due_date := nullif(v_row->>'due_date', '')::date;
      v_total := round((v_row->>'planned_total_eur')::numeric, 2);
      IF p_mode = 'detailed' THEN
        v_principal := round((v_row->>'planned_principal_eur')::numeric, 2);
        v_interest := round((v_row->>'planned_interest_eur')::numeric, 2);
        v_fees := round((v_row->>'planned_other_fees_eur')::numeric, 2);
      ELSE
        v_principal := NULL; v_interest := NULL; v_fees := NULL;
        IF v_row ?| ARRAY['planned_principal_eur','planned_interest_eur','planned_other_fees_eur'] THEN
          RAISE EXCEPTION 'TOTAL_ONLY_COMPONENTS_FORBIDDEN: installment components must remain NULL';
        END IF;
      END IF;
      IF v_sequence IS NULL OR v_sequence <= 0 OR v_due_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_INSTALLMENT: positive sequence_number and due_date are required';
      END IF;
      PERFORM public.finance_validate_unlinked_amount(p_mode, v_principal, v_interest, v_fees, v_total, 'installment');
      INSERT INTO public.finance_unlinked_obligation_installments (
        obligation_id, plan_revision, sequence_number, due_date, amount_breakdown_mode,
        planned_principal_eur, planned_interest_eur, planned_other_fees_eur, planned_total_eur
      ) VALUES (p_obligation_id, p_plan_revision, v_sequence, v_due_date, p_mode,
                v_principal, v_interest, v_fees, v_total);
      v_sum_principal := v_sum_principal + coalesce(v_principal, 0);
      v_sum_interest := v_sum_interest + coalesce(v_interest, 0);
      v_sum_fees := v_sum_fees + coalesce(v_fees, 0);
      v_sum_total := v_sum_total + v_total;
    END LOOP;
  ELSIF p_payload ? 'installment_dates' AND jsonb_typeof(p_payload->'installment_dates') = 'array' THEN
    v_dates := p_payload->'installment_dates'; v_count := jsonb_array_length(v_dates);
    IF v_count < 1 THEN RAISE EXCEPTION 'INVALID_INSTALLMENTS: installment_dates cannot be empty'; END IF;
    v_total_cents := round(p_expected_total * 100)::bigint; v_base_total := v_total_cents / v_count;
    IF v_base_total <= 0 THEN RAISE EXCEPTION 'INVALID_INSTALLMENTS: automatic split would create a zero installment'; END IF;
    IF p_mode = 'detailed' THEN
      v_principal_cents := round(p_expected_principal * 100)::bigint;
      v_interest_cents := round(p_expected_interest * 100)::bigint;
      v_fees_cents := round(p_expected_fees * 100)::bigint;
      v_base_principal := v_principal_cents / v_count;
      v_base_interest := v_interest_cents / v_count;
      v_base_fees := v_fees_cents / v_count;
    END IF;
    FOR v_index IN 0..v_count - 1 LOOP
      v_due_date := nullif(v_dates->>v_index, '')::date;
      IF v_due_date IS NULL THEN RAISE EXCEPTION 'INVALID_INSTALLMENT: due_date is required'; END IF;
      IF p_mode = 'detailed' THEN
        v_current_principal := CASE WHEN v_index=v_count-1 THEN v_principal_cents-v_base_principal*(v_count-1) ELSE v_base_principal END;
        v_current_interest := CASE WHEN v_index=v_count-1 THEN v_interest_cents-v_base_interest*(v_count-1) ELSE v_base_interest END;
        v_current_fees := CASE WHEN v_index=v_count-1 THEN v_fees_cents-v_base_fees*(v_count-1) ELSE v_base_fees END;
        v_principal := v_current_principal::numeric/100;
        v_interest := v_current_interest::numeric/100;
        v_fees := v_current_fees::numeric/100;
        v_total := v_principal + v_interest + v_fees;
      ELSE
        v_current_total := CASE WHEN v_index=v_count-1 THEN v_total_cents-v_base_total*(v_count-1) ELSE v_base_total END;
        v_principal := NULL; v_interest := NULL; v_fees := NULL; v_total := v_current_total::numeric/100;
      END IF;
      INSERT INTO public.finance_unlinked_obligation_installments (
        obligation_id, plan_revision, sequence_number, due_date, amount_breakdown_mode,
        planned_principal_eur, planned_interest_eur, planned_other_fees_eur, planned_total_eur
      ) VALUES (p_obligation_id, p_plan_revision, v_index+1, v_due_date, p_mode,
                v_principal, v_interest, v_fees, v_total);
      v_sum_principal := v_sum_principal + coalesce(v_principal,0);
      v_sum_interest := v_sum_interest + coalesce(v_interest,0);
      v_sum_fees := v_sum_fees + coalesce(v_fees,0);
      v_sum_total := v_sum_total + v_total;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'INVALID_INSTALLMENTS: installments or installment_dates array is required';
  END IF;
  IF p_mode='detailed' AND round(v_sum_principal,2) <> p_expected_principal THEN RAISE EXCEPTION 'INSTALLMENT_PRINCIPAL_SUM_MISMATCH'; END IF;
  IF p_mode='detailed' AND round(v_sum_interest,2) <> p_expected_interest THEN RAISE EXCEPTION 'INSTALLMENT_INTEREST_SUM_MISMATCH'; END IF;
  IF p_mode='detailed' AND round(v_sum_fees,2) <> p_expected_fees THEN RAISE EXCEPTION 'INSTALLMENT_FEES_SUM_MISMATCH'; END IF;
  IF round(v_sum_total,2) <> p_expected_total THEN RAISE EXCEPTION 'INSTALLMENT_TOTAL_SUM_MISMATCH'; END IF;
  RETURN v_count;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'DUPLICATE_INSTALLMENT_SEQUENCE: sequence_number must be unique inside a plan revision';
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_create_unlinked_obligation(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid := public.finance_assert_unlinked_actor(); v_obligation public.finance_unlinked_obligations;
  v_mode text := coalesce(nullif(p_payload->>'amount_breakdown_mode',''),'total_only');
  v_principal numeric := CASE WHEN p_payload->>'planned_principal_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_principal_eur')::numeric,2) END;
  v_interest numeric := CASE WHEN p_payload->>'planned_interest_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_interest_eur')::numeric,2) END;
  v_fees numeric := CASE WHEN p_payload->>'planned_other_fees_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_other_fees_eur')::numeric,2) END;
  v_total numeric := round((p_payload->>'planned_total_eur')::numeric,2); v_count integer;
BEGIN
  IF btrim(coalesce(p_payload->>'concept',''))='' THEN RAISE EXCEPTION 'INVALID_CONCEPT: concept is required'; END IF;
  PERFORM public.finance_validate_unlinked_amount(v_mode,v_principal,v_interest,v_fees,v_total,'obligation');
  INSERT INTO public.finance_unlinked_obligations (
    origin_type,concept,category,counterparty_name,description,amount_breakdown_mode,
    planned_principal_eur,planned_interest_eur,planned_other_fees_eur,planned_total_eur,lifecycle_status,created_by
  ) VALUES ('one_off',btrim(p_payload->>'concept'),p_payload->>'category',
    nullif(btrim(p_payload->>'counterparty_name'),''),nullif(btrim(p_payload->>'description'),''),v_mode,
    v_principal,v_interest,v_fees,v_total,'active',v_user_id) RETURNING * INTO v_obligation;
  v_count := public.finance_insert_unlinked_installment_plan(v_obligation.id,p_payload,v_mode,v_principal,v_interest,v_fees,v_total,1);
  RETURN jsonb_build_object('obligation_id',v_obligation.id,'installment_count',v_count,'plan_revision',1);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_update_pending_unlinked_obligation(p_obligation_id uuid,p_payload jsonb)
RETURNS public.finance_unlinked_obligations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_obligation public.finance_unlinked_obligations;
BEGIN
  PERFORM public.finance_assert_unlinked_actor();
  SELECT * INTO v_obligation FROM public.finance_unlinked_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: obligation not found'; END IF;
  IF v_obligation.lifecycle_status<>'active' THEN RAISE EXCEPTION 'OBLIGATION_NOT_ACTIVE'; END IF;
  IF EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_payment_allocations a JOIN public.finance_unlinked_obligation_installments i ON i.id=a.installment_id WHERE i.obligation_id=p_obligation_id) THEN RAISE EXCEPTION 'OBLIGATION_HAS_ALLOCATIONS'; END IF;
  IF p_payload ?| ARRAY['amount_breakdown_mode','planned_principal_eur','planned_interest_eur','planned_other_fees_eur','planned_total_eur','installments','installment_dates'] THEN RAISE EXCEPTION 'PLAN_REPLACEMENT_REQUIRED'; END IF;
  UPDATE public.finance_unlinked_obligations SET
    concept=coalesce(nullif(btrim(p_payload->>'concept'),''),concept),
    category=coalesce(nullif(btrim(p_payload->>'category'),''),category),
    counterparty_name=CASE WHEN p_payload?'counterparty_name' THEN nullif(btrim(p_payload->>'counterparty_name'),'') ELSE counterparty_name END,
    description=CASE WHEN p_payload?'description' THEN nullif(btrim(p_payload->>'description'),'') ELSE description END,
    updated_at=now() WHERE id=p_obligation_id RETURNING * INTO v_obligation;
  RETURN v_obligation;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_replace_unpaid_installment_plan(p_obligation_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user_id uuid := public.finance_assert_unlinked_actor(); v_obligation public.finance_unlinked_obligations;
  v_mode text;
  v_principal numeric := CASE WHEN p_payload->>'planned_principal_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_principal_eur')::numeric,2) END;
  v_interest numeric := CASE WHEN p_payload->>'planned_interest_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_interest_eur')::numeric,2) END;
  v_fees numeric := CASE WHEN p_payload->>'planned_other_fees_eur' IS NULL THEN NULL ELSE round((p_payload->>'planned_other_fees_eur')::numeric,2) END;
  v_total numeric := round((p_payload->>'planned_total_eur')::numeric,2); v_revision integer; v_count integer;
BEGIN
  IF NOT (p_payload?'amount_breakdown_mode') OR nullif(p_payload->>'amount_breakdown_mode','') IS NULL THEN
    RAISE EXCEPTION 'REPLAN_MODE_REQUIRED';
  END IF;
  v_mode:=p_payload->>'amount_breakdown_mode';
  IF NOT (p_payload?'planned_total_eur') OR p_payload->>'planned_total_eur' IS NULL THEN
    RAISE EXCEPTION 'REPLAN_TOTAL_REQUIRED';
  END IF;
  IF NOT (p_payload?'installments') AND NOT (p_payload?'installment_dates') THEN
    RAISE EXCEPTION 'REPLAN_INSTALLMENTS_REQUIRED';
  END IF;
  IF v_mode='detailed' AND (
    NOT (p_payload?'planned_principal_eur') OR p_payload->>'planned_principal_eur' IS NULL OR
    NOT (p_payload?'planned_interest_eur') OR p_payload->>'planned_interest_eur' IS NULL OR
    NOT (p_payload?'planned_other_fees_eur') OR p_payload->>'planned_other_fees_eur' IS NULL
  ) THEN RAISE EXCEPTION 'REPLAN_COMPONENTS_REQUIRED'; END IF;
  SELECT * INTO v_obligation FROM public.finance_unlinked_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: obligation not found'; END IF;
  IF v_obligation.lifecycle_status<>'active' THEN RAISE EXCEPTION 'OBLIGATION_NOT_ACTIVE'; END IF;
  PERFORM 1 FROM public.finance_unlinked_obligation_installments WHERE obligation_id=p_obligation_id AND status='active' FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_payment_allocations a JOIN public.finance_unlinked_obligation_installments i ON i.id=a.installment_id WHERE i.obligation_id=p_obligation_id) THEN RAISE EXCEPTION 'OBLIGATION_HAS_ALLOCATIONS'; END IF;
  PERFORM public.finance_validate_unlinked_amount(v_mode,v_principal,v_interest,v_fees,v_total,'obligation');
  SELECT coalesce(max(plan_revision),0)+1 INTO v_revision FROM public.finance_unlinked_obligation_installments WHERE obligation_id=p_obligation_id;
  UPDATE public.finance_unlinked_obligation_installments SET status='superseded',superseded_at=now(),superseded_by=v_user_id,updated_at=now()
  WHERE obligation_id=p_obligation_id AND status='active';
  UPDATE public.finance_unlinked_obligations SET amount_breakdown_mode=v_mode,planned_principal_eur=v_principal,
    planned_interest_eur=v_interest,planned_other_fees_eur=v_fees,planned_total_eur=v_total,updated_at=now()
  WHERE id=p_obligation_id;
  v_count := public.finance_insert_unlinked_installment_plan(p_obligation_id,p_payload,v_mode,v_principal,v_interest,v_fees,v_total,v_revision);
  RETURN jsonb_build_object('obligation_id',p_obligation_id,'installment_count',v_count,'plan_revision',v_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_cancel_unlinked_obligation(p_obligation_id uuid,p_reason text)
RETURNS public.finance_unlinked_obligations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_user_id uuid:=public.finance_assert_unlinked_actor(); v_obligation public.finance_unlinked_obligations;
BEGIN
  IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED'; END IF;
  SELECT * INTO v_obligation FROM public.finance_unlinked_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: obligation not found'; END IF;
  IF v_obligation.lifecycle_status<>'active' THEN RAISE EXCEPTION 'OBLIGATION_NOT_ACTIVE'; END IF;
  PERFORM 1 FROM public.finance_unlinked_obligation_installments WHERE obligation_id=p_obligation_id AND status='active' FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_payment_allocations a JOIN public.finance_unlinked_obligation_installments i ON i.id=a.installment_id WHERE i.obligation_id=p_obligation_id) THEN RAISE EXCEPTION 'OBLIGATION_HAS_ALLOCATIONS'; END IF;
  UPDATE public.finance_unlinked_obligation_installments SET status='cancelled',updated_at=now() WHERE obligation_id=p_obligation_id AND status='active';
  UPDATE public.finance_unlinked_obligations SET lifecycle_status='cancelled',cancelled_at=now(),cancelled_by=v_user_id,cancellation_reason=btrim(p_reason),updated_at=now()
  WHERE id=p_obligation_id RETURNING * INTO v_obligation;
  RETURN v_obligation;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finance_assert_unlinked_actor() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_validate_unlinked_amount(text,numeric,numeric,numeric,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_insert_unlinked_installment_plan(uuid,jsonb,text,numeric,numeric,numeric,numeric,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_assert_unlinked_actor() TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_validate_unlinked_amount(text,numeric,numeric,numeric,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_insert_unlinked_installment_plan(uuid,jsonb,text,numeric,numeric,numeric,numeric,integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.finance_create_unlinked_obligation(jsonb) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.finance_update_pending_unlinked_obligation(uuid,jsonb) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.finance_replace_unpaid_installment_plan(uuid,jsonb) FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.finance_cancel_unlinked_obligation(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_create_unlinked_obligation(jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_update_pending_unlinked_obligation(uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_replace_unpaid_installment_plan(uuid,jsonb) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_cancel_unlinked_obligation(uuid,text) TO authenticated,service_role;
ALTER FUNCTION public.finance_assert_unlinked_actor() OWNER TO postgres;
ALTER FUNCTION public.finance_validate_unlinked_amount(text,numeric,numeric,numeric,numeric,text) OWNER TO postgres;
ALTER FUNCTION public.finance_insert_unlinked_installment_plan(uuid,jsonb,text,numeric,numeric,numeric,numeric,integer) OWNER TO postgres;
ALTER FUNCTION public.finance_create_unlinked_obligation(jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_update_pending_unlinked_obligation(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_replace_unpaid_installment_plan(uuid,jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_cancel_unlinked_obligation(uuid,text) OWNER TO postgres;

COMMIT;
