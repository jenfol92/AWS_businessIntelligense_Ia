-- Fase 1B: devoluciones de lineas separando principal, intereses y comisiones.
-- La reversion inmutable se implementara en la Fase 1C.

BEGIN;

ALTER TABLE public.finance_cash_accounts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_cash_accounts_status_check') THEN
    ALTER TABLE public.finance_cash_accounts ADD CONSTRAINT finance_cash_accounts_status_check
      CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

CREATE TABLE public.finance_credit_line_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_line_id uuid NOT NULL REFERENCES public.finance_credit_lines(id),
  repayment_group_id uuid NOT NULL REFERENCES public.finance_credit_line_repayment_groups(id),
  cash_account_id uuid NOT NULL REFERENCES public.finance_cash_accounts(id),
  principal_paid_eur numeric(14,2) NOT NULL,
  interest_paid_eur numeric(14,2) NOT NULL,
  fees_paid_eur numeric(14,2) NOT NULL,
  total_cash_out_eur numeric(14,2) NOT NULL,
  effective_date date NOT NULL,
  bank_reference text NULL,
  notes text NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  payload_fingerprint text NOT NULL CHECK (btrim(payload_fingerprint) <> ''),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reversed_by_operation_id uuid NULL,
  credit_line_movement_id uuid NULL UNIQUE REFERENCES public.finance_credit_line_movements(id),
  cash_movement_id uuid NOT NULL UNIQUE REFERENCES public.finance_cash_movements(id),
  principal_outstanding_eur numeric(14,2) NOT NULL,
  credit_used_eur numeric(14,2) NOT NULL,
  credit_available_eur numeric(14,2) NOT NULL,
  cash_balance_eur numeric(14,2) NOT NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_credit_line_repayments_components_nonnegative CHECK (
    public.finance_is_finite_numeric(principal_paid_eur) AND principal_paid_eur >= 0
    AND public.finance_is_finite_numeric(interest_paid_eur) AND interest_paid_eur >= 0
    AND public.finance_is_finite_numeric(fees_paid_eur) AND fees_paid_eur >= 0
  ),
  CONSTRAINT finance_credit_line_repayments_total_positive CHECK (
    public.finance_is_finite_numeric(total_cash_out_eur) AND total_cash_out_eur > 0
  ),
  CONSTRAINT finance_credit_line_repayments_total_components CHECK (
    total_cash_out_eur = principal_paid_eur + interest_paid_eur + fees_paid_eur
  ),
  CONSTRAINT finance_credit_line_repayments_snapshots_nonnegative CHECK (
    public.finance_is_finite_numeric(principal_outstanding_eur) AND principal_outstanding_eur >= 0
    AND public.finance_is_finite_numeric(credit_used_eur) AND credit_used_eur >= 0
    AND public.finance_is_finite_numeric(credit_available_eur) AND credit_available_eur >= 0
    AND public.finance_is_finite_numeric(cash_balance_eur) AND cash_balance_eur >= 0
  ),
  CONSTRAINT finance_credit_line_repayments_not_self_reversed CHECK (
    reversed_by_operation_id IS NULL OR reversed_by_operation_id <> id
  )
);

CREATE INDEX finance_credit_line_repayments_group_idx
  ON public.finance_credit_line_repayments(repayment_group_id, effective_date);
CREATE INDEX finance_credit_line_repayments_line_idx
  ON public.finance_credit_line_repayments(credit_line_id, effective_date);

CREATE OR REPLACE FUNCTION public.finance_block_credit_line_repayment_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_FINANCIAL_OPERATION: credit line repayments cannot be updated or deleted directly'
    USING ERRCODE = '55000';
END $$;

CREATE TRIGGER finance_credit_line_repayments_immutable
BEFORE UPDATE OR DELETE ON public.finance_credit_line_repayments
FOR EACH ROW EXECUTE FUNCTION public.finance_block_credit_line_repayment_mutation();

ALTER TABLE public.finance_credit_line_repayments ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_credit_line_repayments_select_treasury
  ON public.finance_credit_line_repayments FOR SELECT TO authenticated
  USING (public.finance_can_read_treasury());

REVOKE ALL ON TABLE public.finance_credit_line_repayments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.finance_credit_line_repayments TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finance_create_credit_line_repayment_v2(
  p_credit_line_id uuid,
  p_repayment_group_id uuid,
  p_cash_account_id uuid,
  p_principal_paid_eur numeric,
  p_interest_paid_eur numeric,
  p_fees_paid_eur numeric,
  p_effective_date date,
  p_bank_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line public.finance_credit_lines%ROWTYPE;
  v_group public.finance_credit_line_repayment_groups%ROWTYPE;
  v_cash public.finance_cash_accounts%ROWTYPE;
  v_existing public.finance_credit_line_repayments%ROWTYPE;
  v_operation public.finance_credit_line_repayments%ROWTYPE;
  v_line_movement_id uuid := gen_random_uuid();
  v_cash_movement_id uuid := gen_random_uuid();
  v_operation_id uuid := gen_random_uuid();
  v_principal numeric(14,2);
  v_interest numeric(14,2);
  v_fees numeric(14,2);
  v_total numeric;
  v_key text;
  v_reference text;
  v_notes text;
  v_fingerprint text;
  v_next_remaining numeric(14,2);
  v_next_paid numeric(14,2);
  v_next_group_status text;
  v_latest_drawdown_date date;
  v_latest_repayment_date date;
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_credit_line_id IS NULL OR p_repayment_group_id IS NULL OR p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: credit line, repayment group and cash account are required';
  END IF;
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: effective date is required';
  END IF;
  IF NOT public.finance_is_finite_numeric(p_principal_paid_eur)
     OR NOT public.finance_is_finite_numeric(p_interest_paid_eur)
     OR NOT public.finance_is_finite_numeric(p_fees_paid_eur)
     OR p_principal_paid_eur < 0 OR p_interest_paid_eur < 0 OR p_fees_paid_eur < 0
     OR p_principal_paid_eur >= 1000000000000
     OR p_interest_paid_eur >= 1000000000000
     OR p_fees_paid_eur >= 1000000000000
     OR p_principal_paid_eur <> round(p_principal_paid_eur,2)
     OR p_interest_paid_eur <> round(p_interest_paid_eur,2)
     OR p_fees_paid_eur <> round(p_fees_paid_eur,2) THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: components must be nonnegative with at most two decimals';
  END IF;
  v_principal := p_principal_paid_eur;
  v_interest := p_interest_paid_eur;
  v_fees := p_fees_paid_eur;
  v_total := v_principal + v_interest + v_fees;
  IF NOT public.finance_is_finite_numeric(v_total) OR v_total <= 0 OR v_total >= 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: total must be positive and within the canonical monetary range';
  END IF;
  v_key := nullif(btrim(p_idempotency_key), '');
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: idempotency key is required';
  END IF;
  v_reference := nullif(btrim(p_bank_reference), '');
  v_notes := nullif(btrim(p_notes), '');
  v_fingerprint := md5(jsonb_build_object(
    'credit_line_id',p_credit_line_id,'repayment_group_id',p_repayment_group_id,
    'cash_account_id',p_cash_account_id,'principal_paid_eur',v_principal,
    'interest_paid_eur',v_interest,'fees_paid_eur',v_fees,
    'effective_date',p_effective_date,'bank_reference',v_reference,'notes',v_notes
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended('credit-line-repayment-v2:' || v_key, 0));
  SELECT * INTO v_existing FROM public.finance_credit_line_repayments
  WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.payload_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: key belongs to a different payload';
    END IF;
    RETURN jsonb_build_object(
      'repayment_id',v_existing.id,'credit_line_id',v_existing.credit_line_id,
      'repayment_group_id',v_existing.repayment_group_id,
      'principal_paid_eur',v_existing.principal_paid_eur,
      'interest_paid_eur',v_existing.interest_paid_eur,'fees_paid_eur',v_existing.fees_paid_eur,
      'total_cash_out_eur',v_existing.total_cash_out_eur,
      'principal_outstanding_eur',v_existing.principal_outstanding_eur,
      'credit_used_eur',v_existing.credit_used_eur,
      'credit_available_eur',v_existing.credit_available_eur,
      'cash_balance_eur',v_existing.cash_balance_eur,'status',v_existing.status,'idempotent',true);
  END IF;

  SELECT * INTO v_line FROM public.finance_credit_lines WHERE id=p_credit_line_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: credit line'; END IF;
  SELECT * INTO v_group FROM public.finance_credit_line_repayment_groups
    WHERE id=p_repayment_group_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: repayment group'; END IF;
  SELECT * INTO v_cash FROM public.finance_cash_accounts WHERE id=p_cash_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: cash account'; END IF;

  IF v_group.credit_line_id <> v_line.id THEN
    RAISE EXCEPTION 'GROUP_MISMATCH: repayment group does not belong to credit line';
  END IF;
  IF v_group.status = 'cancelled'
     OR (v_group.status = 'paid' AND v_principal > 0)
     OR v_group.status NOT IN ('open','partially_paid','paid') THEN
    RAISE EXCEPTION 'GROUP_CLOSED: repayment group is not payable';
  END IF;
  IF upper(btrim(v_cash.currency)) <> 'EUR' THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: cash account must be EUR';
  END IF;
  IF lower(btrim(v_cash.status)) <> 'active' THEN
    RAISE EXCEPTION 'CASH_ACCOUNT_INACTIVE: cash account is not active';
  END IF;

  SELECT max(movement_date)
  INTO v_latest_drawdown_date
  FROM public.finance_credit_line_movements
  WHERE repayment_group_id = v_group.id
    AND movement_type = 'drawdown'
    AND status <> 'cancelled';

  SELECT max(effective_date)
  INTO v_latest_repayment_date
  FROM public.finance_credit_line_repayments
  WHERE repayment_group_id = v_group.id
    AND status = 'posted';

  IF p_effective_date < coalesce(v_latest_drawdown_date, v_group.period_start)
     OR (v_latest_repayment_date IS NOT NULL AND p_effective_date < v_latest_repayment_date) THEN
    RAISE EXCEPTION 'REPAYMENT_DATE_OUT_OF_SEQUENCE: effective date precedes the financial sequence';
  END IF;
  IF v_principal > round(v_group.remaining_amount,2) OR v_principal > round(v_line.used_amount,2) THEN
    RAISE EXCEPTION 'INSUFFICIENT_USED_AMOUNT: principal exceeds outstanding amount';
  END IF;
  IF v_total > round(v_cash.balance,2) THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH: cash balance is lower than total cash out';
  END IF;

  v_next_remaining := round(v_group.remaining_amount - v_principal,2);
  v_next_paid := round(v_group.paid_amount + v_principal,2);
  v_next_group_status := CASE WHEN v_next_remaining=0 THEN 'paid' ELSE 'partially_paid' END;

  IF v_principal > 0 THEN
    INSERT INTO public.finance_credit_line_movements(
      id,credit_line_id,movement_type,description,due_date,paid_at,amount,status,
      source_type,source_id,movement_date,repayment_group_id,idempotency_key,bank_reference
    ) VALUES (
      v_line_movement_id,v_line.id,'repayment','Devolucion bancaria de principal',v_group.due_date,
      p_effective_date::timestamptz,v_principal,'posted','credit_line_repayment_v2',v_operation_id,
      p_effective_date,v_group.id,'repayment-v2-principal:'||v_operation_id,v_reference
    );
    UPDATE public.finance_credit_lines SET
      used_amount=round(used_amount-v_principal,2),
      available_amount=round(available_amount+v_principal,2),updated_at=now()
    WHERE id=v_line.id RETURNING * INTO v_line;
    UPDATE public.finance_credit_line_repayment_groups SET
      paid_amount=v_next_paid,remaining_amount=v_next_remaining,status=v_next_group_status,
      paid_at=CASE WHEN v_next_remaining=0 THEN p_effective_date::timestamptz ELSE NULL END,
      updated_at=now()
    WHERE id=v_group.id RETURNING * INTO v_group;
  ELSE
    v_line_movement_id := NULL;
  END IF;

  INSERT INTO public.finance_cash_movements(
    id,cash_account_id,movement_type,direction,amount,source_type,source_id,movement_date,notes,updated_at
  ) VALUES (
    v_cash_movement_id,v_cash.id,'credit_repayment','out',v_total,
    'credit_line_repayment_v2',v_operation_id,p_effective_date,
    nullif(concat_ws(' | ',v_notes,v_reference),''),now()
  );
  UPDATE public.finance_cash_accounts SET balance=round(balance-v_total,2),updated_at=now()
  WHERE id=v_cash.id RETURNING * INTO v_cash;

  INSERT INTO public.finance_credit_line_repayments(
    id,credit_line_id,repayment_group_id,cash_account_id,
    principal_paid_eur,interest_paid_eur,fees_paid_eur,total_cash_out_eur,
    effective_date,bank_reference,notes,idempotency_key,payload_fingerprint,status,
    credit_line_movement_id,cash_movement_id,principal_outstanding_eur,
    credit_used_eur,credit_available_eur,cash_balance_eur,created_by
  ) VALUES (
    v_operation_id,v_line.id,v_group.id,v_cash.id,v_principal,v_interest,v_fees,v_total,
    p_effective_date,v_reference,v_notes,v_key,v_fingerprint,'posted',
    v_line_movement_id,v_cash_movement_id,v_group.remaining_amount,
    v_line.used_amount,v_line.available_amount,v_cash.balance,auth.uid()
  ) RETURNING * INTO v_operation;

  RETURN jsonb_build_object(
    'repayment_id',v_operation.id,'credit_line_id',v_operation.credit_line_id,
    'repayment_group_id',v_operation.repayment_group_id,
    'principal_paid_eur',v_operation.principal_paid_eur,
    'interest_paid_eur',v_operation.interest_paid_eur,'fees_paid_eur',v_operation.fees_paid_eur,
    'total_cash_out_eur',v_operation.total_cash_out_eur,
    'principal_outstanding_eur',v_operation.principal_outstanding_eur,
    'credit_used_eur',v_operation.credit_used_eur,
    'credit_available_eur',v_operation.credit_available_eur,
    'cash_balance_eur',v_operation.cash_balance_eur,'status',v_operation.status,'idempotent',false);
END $$;

ALTER FUNCTION public.finance_create_credit_line_repayment_v2(uuid,uuid,uuid,numeric,numeric,numeric,date,text,text,text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_repayment_v2(uuid,uuid,uuid,numeric,numeric,numeric,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_repayment_v2(uuid,uuid,uuid,numeric,numeric,numeric,date,text,text,text) TO authenticated, service_role;

-- V1 remains available only to the technical role for migration compatibility.
-- No user-facing route may invoke it after Phase 1B; reversal/FK semantics arrive in Phase 1C.
REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(uuid,numeric,date,uuid,uuid,text,uuid,text,text,text)
  TO service_role;

COMMENT ON TABLE public.finance_credit_line_repayments IS
  'Immutable posted credit-line repayment operations. Reversal is reserved for Phase 1C.';
COMMENT ON COLUMN public.finance_credit_line_repayments.reversed_by_operation_id IS
  'Reserved UUID for reversal linkage; the real foreign key is added in Phase 1C when the reversal entity exists.';
NOTIFY pgrst, 'reload schema';
COMMIT;
