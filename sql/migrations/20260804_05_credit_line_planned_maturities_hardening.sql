BEGIN;

ALTER TABLE public.finance_credit_line_planned_maturities
  ADD CONSTRAINT finance_credit_line_planned_maturities_source_type_check
  CHECK (source_type IN ('manual_schedule','spreadsheet_schedule')) NOT VALID;

DO $$
BEGIN
  UPDATE public.finance_credit_line_planned_maturities
  SET source_type='spreadsheet_schedule',updated_at=now()
  WHERE source_key LIKE 'credit-maturity:%' AND source_type='manual_schedule';

  IF EXISTS (
    SELECT 1
    FROM public.finance_credit_line_planned_maturities
    WHERE source_key LIKE 'credit-maturity:%'
      AND source_type <> 'spreadsheet_schedule'
  ) THEN
    RAISE EXCEPTION 'PLANNED_MATURITY_SPREADSHEET_SOURCE_MISMATCH';
  END IF;
END $$;

ALTER TABLE public.finance_credit_line_planned_maturities
  VALIDATE CONSTRAINT finance_credit_line_planned_maturities_source_type_check;

CREATE OR REPLACE FUNCTION public.finance_create_credit_line_planned_maturity(
  p_credit_line_id uuid,p_due_date date,p_planned_principal_eur numeric,
  p_expected_interest_eur numeric,p_expected_fees_eur numeric,p_concept text,
  p_reference text,p_notes text,p_source_key text
) RETURNS public.finance_credit_line_planned_maturities
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.finance_credit_line_planned_maturities; v_user uuid:=auth.uid();
BEGIN
  IF public.finance_app_role() NOT IN ('admin','accounting','service_role') THEN RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE='42501'; END IF;
  IF v_user IS NULL AND public.finance_app_role()<>'service_role' THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'INVALID_DATE'; END IF;
  IF p_planned_principal_eur IS NULL OR NOT public.finance_is_finite_numeric(p_planned_principal_eur) OR p_planned_principal_eur<=0 OR p_planned_principal_eur>=1000000000000
    OR (p_expected_interest_eur IS NOT NULL AND (NOT public.finance_is_finite_numeric(p_expected_interest_eur) OR p_expected_interest_eur<0 OR p_expected_interest_eur>=1000000000000))
    OR (p_expected_fees_eur IS NOT NULL AND (NOT public.finance_is_finite_numeric(p_expected_fees_eur) OR p_expected_fees_eur<0 OR p_expected_fees_eur>=1000000000000))
    OR scale(p_planned_principal_eur)>2 OR scale(coalesce(p_expected_interest_eur,0))>2 OR scale(coalesce(p_expected_fees_eur,0))>2 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_concept IS NULL OR char_length(btrim(p_concept)) NOT BETWEEN 1 AND 250 OR char_length(coalesce(p_reference,''))>250 OR char_length(coalesce(p_notes,''))>2000 OR char_length(btrim(coalesce(p_source_key,''))) NOT BETWEEN 1 AND 250 THEN RAISE EXCEPTION 'INVALID_TEXT'; END IF;
  PERFORM 1 FROM public.finance_credit_lines WHERE id=p_credit_line_id AND lower(btrim(status)) NOT IN ('eliminada','eliminado','deleted'); IF NOT FOUND THEN RAISE EXCEPTION 'CREDIT_LINE_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_source_key),0));
  SELECT * INTO v_row FROM public.finance_credit_line_planned_maturities WHERE source_key=btrim(p_source_key);
  IF FOUND THEN
    IF v_row.credit_line_id<>p_credit_line_id OR v_row.due_date<>p_due_date OR v_row.planned_principal_eur<>p_planned_principal_eur OR coalesce(v_row.expected_interest_eur,0)<>coalesce(p_expected_interest_eur,0) OR coalesce(v_row.expected_fees_eur,0)<>coalesce(p_expected_fees_eur,0) OR v_row.concept<>btrim(p_concept) OR coalesce(v_row.reference,'')<>coalesce(nullif(btrim(p_reference),''),'') OR coalesce(v_row.notes,'')<>coalesce(nullif(btrim(p_notes),''),'') THEN RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
    RETURN v_row;
  END IF;
  INSERT INTO public.finance_credit_line_planned_maturities(credit_line_id,due_date,planned_principal_eur,expected_interest_eur,expected_fees_eur,concept,reference,notes,source_type,source_key,created_by)
  VALUES(p_credit_line_id,p_due_date,p_planned_principal_eur,coalesce(p_expected_interest_eur,0),coalesce(p_expected_fees_eur,0),btrim(p_concept),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),'manual_schedule',btrim(p_source_key),v_user) RETURNING * INTO v_row;
  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.finance_create_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text,text) TO authenticated,service_role;

COMMIT;
