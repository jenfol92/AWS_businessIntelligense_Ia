-- Fase 1A: cierre de autorizacion del circuito existente de lineas de credito.
-- Reutiliza finance_app_role()/finance_can_read_unlinked_details() como contrato canonico.

BEGIN;

ALTER FUNCTION public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text)
  RENAME TO finance_create_credit_line_repayment_phase1a_impl;
ALTER FUNCTION public.mark_and_finance_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date)
  RENAME TO mark_and_finance_supplier_payment_phase1a_impl;
ALTER FUNCTION public.create_and_apply_purchase_payment_batch(jsonb)
  RENAME TO create_and_apply_purchase_payment_batch_phase1a_impl;
ALTER FUNCTION public.finance_finance_supplier_payment(uuid,text,date,uuid,uuid,text,text)
  RENAME TO finance_finance_supplier_payment_phase1a_impl;
ALTER FUNCTION public.sync_supplier_payment_plan(uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean)
  RENAME TO sync_supplier_payment_plan_phase1a_impl;
ALTER FUNCTION public.void_pending_supplier_payment_plan(uuid)
  RENAME TO void_pending_supplier_payment_plan_phase1a_impl;

REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_repayment_phase1a_impl(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment_phase1a_impl(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch_phase1a_impl(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.finance_finance_supplier_payment_phase1a_impl(uuid,text,date,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.sync_supplier_payment_plan_phase1a_impl(uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.void_pending_supplier_payment_plan_phase1a_impl(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finance_create_credit_line_repayment(
  p_credit_line_id uuid, p_amount numeric, p_movement_date date, p_cash_account_id uuid,
  p_repayment_group_id uuid DEFAULT NULL, p_source_type text DEFAULT 'manual_repayment',
  p_source_id uuid DEFAULT NULL, p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL, p_bank_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN public.finance_create_credit_line_repayment_phase1a_impl(
    p_credit_line_id,p_amount,p_movement_date,p_cash_account_id,p_repayment_group_id,
    p_source_type,p_source_id,p_notes,p_idempotency_key,p_bank_reference);
END $$;

CREATE OR REPLACE FUNCTION public.mark_and_finance_supplier_payment(
  p_supplier_payment_id uuid, p_order_id uuid DEFAULT NULL, p_paid_at timestamptz DEFAULT NULL,
  p_actual_fx_rate numeric DEFAULT NULL, p_actual_amount_eur numeric DEFAULT NULL,
  p_bank_reference text DEFAULT NULL, p_bank_fee_eur numeric DEFAULT NULL,
  p_ff_fee_eur numeric DEFAULT NULL, p_notes text DEFAULT NULL, p_source_type text DEFAULT NULL,
  p_cash_account_id uuid DEFAULT NULL, p_credit_line_id uuid DEFAULT NULL,
  p_manual_due_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN public.mark_and_finance_supplier_payment_phase1a_impl(
    p_supplier_payment_id,p_order_id,p_paid_at,p_actual_fx_rate,p_actual_amount_eur,
    p_bank_reference,p_bank_fee_eur,p_ff_fee_eur,p_notes,p_source_type,
    p_cash_account_id,p_credit_line_id,p_manual_due_date);
END $$;

CREATE OR REPLACE FUNCTION public.create_and_apply_purchase_payment_batch(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN public.create_and_apply_purchase_payment_batch_phase1a_impl(p_payload);
END $$;

CREATE OR REPLACE FUNCTION public.finance_finance_supplier_payment(
  p_supplier_payment_id uuid, p_source_type text, p_movement_date date,
  p_cash_account_id uuid DEFAULT NULL, p_credit_line_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL, p_idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN public.finance_finance_supplier_payment_phase1a_impl(
    p_supplier_payment_id,p_source_type,p_movement_date,p_cash_account_id,
    p_credit_line_id,p_notes,p_idempotency_key);
END $$;

CREATE OR REPLACE FUNCTION public.sync_supplier_payment_plan(
  p_order_id uuid, p_payment_type text, p_due_date date, p_amount_original numeric,
  p_original_currency text, p_planned_fx_rate numeric, p_amount_eur numeric,
  p_logistics_type text, p_container_id uuid, p_status text,
  p_notes text DEFAULT NULL, p_update_notes boolean DEFAULT false
) RETURNS public.finance_supplier_payments LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN public.sync_supplier_payment_plan_phase1a_impl(
    p_order_id,p_payment_type,p_due_date,p_amount_original,p_original_currency,
    p_planned_fx_rate,p_amount_eur,p_logistics_type,p_container_id,p_status,
    p_notes,p_update_notes);
END $$;

CREATE OR REPLACE FUNCTION public.void_pending_supplier_payment_plan(p_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  RETURN public.void_pending_supplier_payment_plan_phase1a_impl(p_order_id);
END $$;

ALTER FUNCTION public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text) OWNER TO postgres;
ALTER FUNCTION public.mark_and_finance_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date) OWNER TO postgres;
ALTER FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) OWNER TO postgres;
ALTER FUNCTION public.finance_finance_supplier_payment(uuid,text,date,uuid,uuid,text,text) OWNER TO postgres;
ALTER FUNCTION public.sync_supplier_payment_plan(uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean) OWNER TO postgres;
ALTER FUNCTION public.void_pending_supplier_payment_plan(uuid) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finance_finance_supplier_payment(uuid,text,date,uuid,uuid,text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_supplier_payment_plan(uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.void_pending_supplier_payment_plan(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(uuid,uuid,timestamptz,numeric,numeric,text,numeric,numeric,text,text,uuid,uuid,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finance_finance_supplier_payment(uuid,text,date,uuid,uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_supplier_payment_plan(uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_pending_supplier_payment_plan(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS finance_credit_lines_select_authenticated ON public.finance_credit_lines;
DROP POLICY IF EXISTS finance_credit_line_repayment_groups_select_authenticated ON public.finance_credit_line_repayment_groups;
DROP POLICY IF EXISTS finance_cash_accounts_select_authenticated ON public.finance_cash_accounts;
CREATE POLICY finance_credit_lines_select_authenticated ON public.finance_credit_lines
  FOR SELECT TO authenticated USING (public.finance_can_read_treasury());
CREATE POLICY finance_credit_line_repayment_groups_select_authenticated ON public.finance_credit_line_repayment_groups
  FOR SELECT TO authenticated USING (public.finance_can_read_treasury());
CREATE POLICY finance_cash_accounts_select_authenticated ON public.finance_cash_accounts
  FOR SELECT TO authenticated USING (public.finance_can_read_treasury());

-- finance_supplier_payments conserva sus politicas actuales para no romper flujos logisticos existentes.
-- FORCE ROW LEVEL SECURITY queda expresamente fuera de esta fase.
NOTIFY pgrst, 'reload schema';
COMMIT;
