BEGIN;

CREATE TABLE public.finance_credit_line_planned_maturities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_line_id uuid NOT NULL REFERENCES public.finance_credit_lines(id) ON DELETE RESTRICT,
  due_date date NOT NULL,
  planned_principal_eur numeric(14,2) NOT NULL,
  expected_interest_eur numeric(14,2) NOT NULL DEFAULT 0,
  expected_fees_eur numeric(14,2) NOT NULL DEFAULT 0,
  concept text NOT NULL,
  reference text,
  notes text,
  source_type text NOT NULL DEFAULT 'manual_schedule',
  source_key text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  linked_repayment_group_id uuid REFERENCES public.finance_credit_line_repayment_groups(id) ON DELETE RESTRICT,
  linked_repayment_id uuid REFERENCES public.finance_credit_line_repayments(id) ON DELETE RESTRICT,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT finance_credit_line_planned_maturities_status_check
    CHECK (status IN ('planned','paid','cancelled')),
  CONSTRAINT finance_credit_line_planned_maturities_money_check CHECK (
    public.finance_is_finite_numeric(planned_principal_eur)
    AND planned_principal_eur > 0 AND planned_principal_eur < 1000000000000
    AND public.finance_is_finite_numeric(expected_interest_eur) AND expected_interest_eur >= 0 AND expected_interest_eur < 1000000000000
    AND public.finance_is_finite_numeric(expected_fees_eur) AND expected_fees_eur >= 0 AND expected_fees_eur < 1000000000000
  ),
  CONSTRAINT finance_credit_line_planned_maturities_text_check CHECK (
    char_length(btrim(concept)) BETWEEN 1 AND 250
    AND (reference IS NULL OR char_length(reference) <= 250)
    AND (notes IS NULL OR char_length(notes) <= 2000)
    AND char_length(btrim(source_type)) BETWEEN 1 AND 50
    AND char_length(btrim(source_key)) BETWEEN 1 AND 250
  ),
  CONSTRAINT finance_credit_line_planned_maturities_links_check CHECK (
    linked_repayment_id IS NULL OR linked_repayment_group_id IS NOT NULL
  ),
  CONSTRAINT finance_credit_line_planned_maturities_cancel_check CHECK (
    (status='cancelled' AND cancelled_at IS NOT NULL) OR (status<>'cancelled' AND cancelled_at IS NULL)
  )
);

CREATE UNIQUE INDEX ux_finance_credit_line_planned_maturities_source_key
  ON public.finance_credit_line_planned_maturities(source_key);
CREATE INDEX ix_finance_credit_line_planned_maturities_line_due
  ON public.finance_credit_line_planned_maturities(credit_line_id,due_date);
CREATE INDEX ix_finance_credit_line_planned_maturities_status_due
  ON public.finance_credit_line_planned_maturities(status,due_date);

ALTER TABLE public.finance_credit_line_planned_maturities ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_credit_line_planned_maturities_read
  ON public.finance_credit_line_planned_maturities FOR SELECT
  USING (public.finance_can_read_treasury());

REVOKE ALL ON public.finance_credit_line_planned_maturities FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_credit_line_planned_maturities TO authenticated, service_role;
GRANT ALL ON public.finance_credit_line_planned_maturities TO service_role;

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
  SELECT * INTO v_row FROM public.finance_credit_line_planned_maturities WHERE source_key=btrim(p_source_key);
  IF FOUND THEN
    IF v_row.credit_line_id<>p_credit_line_id OR v_row.due_date<>p_due_date OR v_row.planned_principal_eur<>p_planned_principal_eur OR coalesce(v_row.expected_interest_eur,0)<>coalesce(p_expected_interest_eur,0) OR coalesce(v_row.expected_fees_eur,0)<>coalesce(p_expected_fees_eur,0) OR v_row.concept<>btrim(p_concept) OR coalesce(v_row.reference,'')<>coalesce(nullif(btrim(p_reference),''),'') OR coalesce(v_row.notes,'')<>coalesce(nullif(btrim(p_notes),''),'') THEN RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH'; END IF;
    RETURN v_row;
  END IF;
  INSERT INTO public.finance_credit_line_planned_maturities(credit_line_id,due_date,planned_principal_eur,expected_interest_eur,expected_fees_eur,concept,reference,notes,source_type,source_key,created_by)
  VALUES(p_credit_line_id,p_due_date,p_planned_principal_eur,p_expected_interest_eur,p_expected_fees_eur,btrim(p_concept),nullif(btrim(p_reference),''),nullif(btrim(p_notes),''),'manual_schedule',btrim(p_source_key),v_user) RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.finance_update_credit_line_planned_maturity(
  p_id uuid,p_due_date date,p_planned_principal_eur numeric,p_expected_interest_eur numeric,
  p_expected_fees_eur numeric,p_concept text,p_reference text,p_notes text
) RETURNS public.finance_credit_line_planned_maturities
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.finance_credit_line_planned_maturities;
BEGIN
  IF public.finance_app_role() NOT IN ('admin','accounting','service_role') THEN RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_row FROM public.finance_credit_line_planned_maturities WHERE id=p_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_row.status <> 'planned' OR v_row.linked_repayment_group_id IS NOT NULL THEN RAISE EXCEPTION 'PLANNED_MATURITY_IMMUTABLE'; END IF;
  IF p_due_date IS NULL THEN RAISE EXCEPTION 'INVALID_DATE'; END IF;
  IF p_planned_principal_eur IS NULL OR NOT public.finance_is_finite_numeric(p_planned_principal_eur) OR p_planned_principal_eur<=0 OR p_planned_principal_eur>=1000000000000 OR scale(p_planned_principal_eur)>2
    OR (p_expected_interest_eur IS NOT NULL AND (NOT public.finance_is_finite_numeric(p_expected_interest_eur) OR p_expected_interest_eur<0 OR p_expected_interest_eur>=1000000000000 OR scale(p_expected_interest_eur)>2))
    OR (p_expected_fees_eur IS NOT NULL AND (NOT public.finance_is_finite_numeric(p_expected_fees_eur) OR p_expected_fees_eur<0 OR p_expected_fees_eur>=1000000000000 OR scale(p_expected_fees_eur)>2)) THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;
  IF p_concept IS NULL OR char_length(btrim(p_concept)) NOT BETWEEN 1 AND 250 OR char_length(coalesce(p_reference,''))>250 OR char_length(coalesce(p_notes,''))>2000 THEN RAISE EXCEPTION 'INVALID_TEXT'; END IF;
  UPDATE public.finance_credit_line_planned_maturities SET due_date=p_due_date,planned_principal_eur=p_planned_principal_eur,expected_interest_eur=p_expected_interest_eur,expected_fees_eur=p_expected_fees_eur,concept=btrim(p_concept),reference=nullif(btrim(p_reference),''),notes=nullif(btrim(p_notes),''),updated_at=now() WHERE id=p_id RETURNING * INTO v_row; RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.finance_cancel_credit_line_planned_maturity(p_id uuid)
RETURNS public.finance_credit_line_planned_maturities LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_row public.finance_credit_line_planned_maturities;
BEGIN
 IF public.finance_app_role() NOT IN ('admin','accounting','service_role') THEN RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_row FROM public.finance_credit_line_planned_maturities WHERE id=p_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF v_row.status <> 'planned' OR v_row.linked_repayment_group_id IS NOT NULL THEN RAISE EXCEPTION 'PLANNED_MATURITY_IMMUTABLE'; END IF;
 UPDATE public.finance_credit_line_planned_maturities SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE id=p_id RETURNING * INTO v_row; RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.finance_create_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finance_update_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finance_cancel_credit_line_planned_maturity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_update_credit_line_planned_maturity(uuid,date,numeric,numeric,numeric,text,text,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finance_cancel_credit_line_planned_maturity(uuid) TO authenticated,service_role;

COMMIT;
