-- Cierre de autorizacion por rol/capacidad para obligaciones no vinculadas.

BEGIN;

CREATE OR REPLACE FUNCTION public.finance_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') = 'service_role'
      THEN 'service_role'
    WHEN lower(btrim(auth.jwt() -> 'app_metadata' ->> 'role')) IN ('admin', 'accounting', 'logistics')
      THEN lower(btrim(auth.jwt() -> 'app_metadata' ->> 'role'))
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.finance_can_read_treasury()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$ SELECT coalesce(public.finance_app_role() IN ('admin', 'accounting', 'logistics', 'service_role'), false) $$;

CREATE OR REPLACE FUNCTION public.finance_can_read_unlinked_details()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$ SELECT coalesce(public.finance_app_role() IN ('admin', 'accounting', 'service_role'), false) $$;

CREATE OR REPLACE FUNCTION public.finance_can_manage_unlinked_obligations()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$ SELECT coalesce(public.finance_app_role() IN ('admin', 'accounting', 'service_role'), false) $$;

ALTER FUNCTION public.finance_app_role() OWNER TO postgres;
ALTER FUNCTION public.finance_can_read_treasury() OWNER TO postgres;
ALTER FUNCTION public.finance_can_read_unlinked_details() OWNER TO postgres;
ALTER FUNCTION public.finance_can_manage_unlinked_obligations() OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.finance_app_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finance_can_read_treasury() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finance_can_read_unlinked_details() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finance_can_manage_unlinked_obligations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_app_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finance_can_read_treasury() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finance_can_read_unlinked_details() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finance_can_manage_unlinked_obligations() TO authenticated, service_role;

DROP POLICY finance_unlinked_templates_authenticated_read ON public.finance_unlinked_obligation_templates;
DROP POLICY finance_unlinked_obligations_authenticated_read ON public.finance_unlinked_obligations;
DROP POLICY finance_unlinked_installments_authenticated_read ON public.finance_unlinked_obligation_installments;
DROP POLICY finance_unlinked_payments_authenticated_read ON public.finance_unlinked_obligation_payments;
DROP POLICY finance_unlinked_allocations_authenticated_read ON public.finance_unlinked_obligation_payment_allocations;

CREATE POLICY finance_unlinked_templates_authenticated_read
  ON public.finance_unlinked_obligation_templates FOR SELECT TO authenticated
  USING (public.finance_can_read_unlinked_details());
CREATE POLICY finance_unlinked_obligations_authenticated_read
  ON public.finance_unlinked_obligations FOR SELECT TO authenticated
  USING (public.finance_can_read_unlinked_details());
CREATE POLICY finance_unlinked_installments_authenticated_read
  ON public.finance_unlinked_obligation_installments FOR SELECT TO authenticated
  USING (public.finance_can_read_unlinked_details());
CREATE POLICY finance_unlinked_payments_authenticated_read
  ON public.finance_unlinked_obligation_payments FOR SELECT TO authenticated
  USING (public.finance_can_read_unlinked_details());
CREATE POLICY finance_unlinked_allocations_authenticated_read
  ON public.finance_unlinked_obligation_payment_allocations FOR SELECT TO authenticated
  USING (public.finance_can_read_unlinked_details());

CREATE OR REPLACE FUNCTION public.finance_assert_unlinked_actor()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.finance_can_manage_unlinked_obligations() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN v_user_id;
END;
$$;

ALTER FUNCTION public.finance_assert_unlinked_actor() OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.finance_assert_unlinked_actor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_assert_unlinked_actor() TO service_role;

CREATE OR REPLACE FUNCTION public.finance_list_unlinked_treasury_commitments(
  p_due_from date DEFAULT NULL,
  p_due_to date DEFAULT NULL
)
RETURNS TABLE (
  obligation_id uuid,
  installment_id uuid,
  template_id uuid,
  origin_type text,
  concept text,
  category text,
  due_date date,
  planned_total_eur numeric,
  allocated_total_eur numeric,
  outstanding_total_eur numeric,
  financial_status text,
  temporal_condition text,
  has_overdue_installment boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.finance_can_read_treasury() THEN
    RAISE EXCEPTION 'TREASURY_READ_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_due_from IS NOT NULL AND p_due_to IS NOT NULL AND p_due_from > p_due_to THEN
    RAISE EXCEPTION 'INVALID_DATE_RANGE' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    b.installment_id,
    o.template_id,
    o.origin_type,
    o.concept,
    o.category,
    b.due_date,
    b.planned_total_eur,
    b.allocated_total_eur,
    b.outstanding_total_eur,
    b.financial_status,
    b.temporal_condition,
    ob.has_overdue_installment
  FROM public.finance_unlinked_installment_balances b
  JOIN public.finance_unlinked_obligations o ON o.id = b.obligation_id
  JOIN public.finance_unlinked_obligation_balances ob ON ob.obligation_id = o.id
  WHERE b.installment_status = 'active'
    AND (p_due_from IS NULL OR b.due_date >= p_due_from)
    AND (p_due_to IS NULL OR b.due_date <= p_due_to)
  ORDER BY b.due_date, b.installment_id;
END;
$$;

ALTER FUNCTION public.finance_list_unlinked_treasury_commitments(date, date) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.finance_list_unlinked_treasury_commitments(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_list_unlinked_treasury_commitments(date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
