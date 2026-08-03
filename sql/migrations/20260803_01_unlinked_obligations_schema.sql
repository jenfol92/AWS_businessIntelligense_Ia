-- Fase 1: esquema estructural para obligaciones no vinculadas.
-- No crea movimientos, no ejecuta pagos y no contiene datos ni backfills.

BEGIN;

CREATE TABLE public.finance_unlinked_obligation_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept text NOT NULL CHECK (btrim(concept) <> ''),
  category text NOT NULL CHECK (category IN (
    'payroll', 'social_security', 'mortgage', 'loan', 'rent',
    'insurance', 'taxes', 'utilities', 'professional_services', 'other'
  )),
  counterparty_name text NULL,
  description text NULL,
  amount_breakdown_mode text NOT NULL DEFAULT 'total_only'
    CHECK (amount_breakdown_mode IN ('total_only', 'detailed')),
  planned_principal_eur numeric(14, 2) NULL,
  planned_interest_eur numeric(14, 2) NULL,
  planned_other_fees_eur numeric(14, 2) NULL,
  planned_total_eur numeric(14, 2) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  anchor_day integer NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
  anchor_month integer NOT NULL CHECK (anchor_month BETWEEN 1 AND 12),
  frequency_unit text NOT NULL DEFAULT 'month' CHECK (frequency_unit = 'month'),
  frequency_interval integer NOT NULL CHECK (frequency_interval IN (1, 3, 12)),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'ended', 'cancelled')),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_unlinked_templates_dates_check CHECK (end_date >= start_date),
  CONSTRAINT finance_unlinked_templates_anchor_check CHECK (
    anchor_day = extract(day FROM start_date)::integer
    AND anchor_month = extract(month FROM start_date)::integer
  ),
  CONSTRAINT finance_unlinked_templates_amounts_check CHECK (
    public.finance_is_finite_numeric(planned_total_eur) AND planned_total_eur > 0
    AND (
      (amount_breakdown_mode = 'total_only'
        AND planned_principal_eur IS NULL AND planned_interest_eur IS NULL AND planned_other_fees_eur IS NULL)
      OR
      (amount_breakdown_mode = 'detailed'
        AND public.finance_is_finite_numeric(planned_principal_eur) AND planned_principal_eur >= 0
        AND public.finance_is_finite_numeric(planned_interest_eur) AND planned_interest_eur >= 0
        AND public.finance_is_finite_numeric(planned_other_fees_eur) AND planned_other_fees_eur >= 0
        AND planned_total_eur = planned_principal_eur + planned_interest_eur + planned_other_fees_eur)
    )
  )
);

CREATE TABLE public.finance_unlinked_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NULL REFERENCES public.finance_unlinked_obligation_templates(id) ON DELETE RESTRICT,
  occurrence_period date NULL,
  origin_type text NOT NULL CHECK (origin_type IN ('one_off', 'recurring_occurrence')),
  concept text NOT NULL CHECK (btrim(concept) <> ''),
  category text NOT NULL CHECK (category IN (
    'payroll', 'social_security', 'mortgage', 'loan', 'rent',
    'insurance', 'taxes', 'utilities', 'professional_services', 'other'
  )),
  counterparty_name text NULL,
  description text NULL,
  amount_breakdown_mode text NOT NULL DEFAULT 'total_only'
    CHECK (amount_breakdown_mode IN ('total_only', 'detailed')),
  planned_principal_eur numeric(14, 2) NULL,
  planned_interest_eur numeric(14, 2) NULL,
  planned_other_fees_eur numeric(14, 2) NULL,
  planned_total_eur numeric(14, 2) NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active', 'cancelled')),
  cancelled_at timestamptz NULL,
  cancelled_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  cancellation_reason text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_unlinked_obligations_origin_check CHECK (
    (origin_type = 'one_off' AND template_id IS NULL AND occurrence_period IS NULL)
    OR
    (origin_type = 'recurring_occurrence' AND template_id IS NOT NULL AND occurrence_period IS NOT NULL)
  ),
  CONSTRAINT finance_unlinked_obligations_amounts_check CHECK (
    public.finance_is_finite_numeric(planned_total_eur) AND planned_total_eur > 0
    AND (
      (amount_breakdown_mode = 'total_only'
        AND planned_principal_eur IS NULL AND planned_interest_eur IS NULL AND planned_other_fees_eur IS NULL)
      OR
      (amount_breakdown_mode = 'detailed'
        AND public.finance_is_finite_numeric(planned_principal_eur) AND planned_principal_eur >= 0
        AND public.finance_is_finite_numeric(planned_interest_eur) AND planned_interest_eur >= 0
        AND public.finance_is_finite_numeric(planned_other_fees_eur) AND planned_other_fees_eur >= 0
        AND planned_total_eur = planned_principal_eur + planned_interest_eur + planned_other_fees_eur)
    )
  ),
  CONSTRAINT finance_unlinked_obligations_cancellation_check CHECK (
    (lifecycle_status = 'cancelled' AND cancelled_at IS NOT NULL AND btrim(coalesce(cancellation_reason, '')) <> '')
    OR
    (lifecycle_status = 'active' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
  )
);

CREATE TABLE public.finance_unlinked_obligation_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.finance_unlinked_obligations(id) ON DELETE RESTRICT,
  plan_revision integer NOT NULL DEFAULT 1 CHECK (plan_revision > 0),
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  due_date date NOT NULL,
  amount_breakdown_mode text NOT NULL DEFAULT 'total_only'
    CHECK (amount_breakdown_mode IN ('total_only', 'detailed')),
  planned_principal_eur numeric(14, 2) NULL,
  planned_interest_eur numeric(14, 2) NULL,
  planned_other_fees_eur numeric(14, 2) NULL,
  planned_total_eur numeric(14, 2) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'superseded')),
  supersedes_installment_id uuid NULL REFERENCES public.finance_unlinked_obligation_installments(id) ON DELETE RESTRICT,
  superseded_at timestamptz NULL,
  superseded_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_unlinked_installments_sequence_key UNIQUE (obligation_id, plan_revision, sequence_number),
  CONSTRAINT finance_unlinked_installments_no_self_supersede CHECK (supersedes_installment_id IS DISTINCT FROM id),
  CONSTRAINT finance_unlinked_installments_amounts_check CHECK (
    public.finance_is_finite_numeric(planned_total_eur) AND planned_total_eur > 0
    AND (
      (amount_breakdown_mode = 'total_only'
        AND planned_principal_eur IS NULL AND planned_interest_eur IS NULL AND planned_other_fees_eur IS NULL)
      OR
      (amount_breakdown_mode = 'detailed'
        AND public.finance_is_finite_numeric(planned_principal_eur) AND planned_principal_eur >= 0
        AND public.finance_is_finite_numeric(planned_interest_eur) AND planned_interest_eur >= 0
        AND public.finance_is_finite_numeric(planned_other_fees_eur) AND planned_other_fees_eur >= 0
        AND planned_total_eur = planned_principal_eur + planned_interest_eur + planned_other_fees_eur)
    )
  ),
  CONSTRAINT finance_unlinked_installments_superseded_check CHECK (
    (status = 'superseded' AND superseded_at IS NOT NULL)
    OR (status <> 'superseded' AND superseded_at IS NULL AND superseded_by IS NULL)
  )
);

CREATE TABLE public.finance_unlinked_obligation_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.finance_unlinked_obligations(id) ON DELETE RESTRICT,
  paid_at timestamptz NOT NULL,
  amount_breakdown_mode text NOT NULL DEFAULT 'total_only'
    CHECK (amount_breakdown_mode IN ('total_only', 'detailed')),
  actual_principal_eur numeric(14, 2) NULL,
  actual_interest_eur numeric(14, 2) NULL,
  actual_other_fees_eur numeric(14, 2) NULL,
  bank_fee_eur numeric(14, 2) NOT NULL DEFAULT 0,
  actual_total_eur numeric(14, 2) NOT NULL,
  funded_total_eur numeric(14, 2) NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('cash_account', 'credit_line')),
  cash_account_id uuid NULL REFERENCES public.finance_cash_accounts(id) ON DELETE RESTRICT,
  credit_line_id uuid NULL REFERENCES public.finance_credit_lines(id) ON DELETE RESTRICT,
  cash_movement_id uuid NULL REFERENCES public.finance_cash_movements(id) ON DELETE RESTRICT,
  credit_line_movement_id uuid NULL REFERENCES public.finance_credit_line_movements(id) ON DELETE RESTRICT,
  repayment_group_id uuid NULL REFERENCES public.finance_credit_line_repayment_groups(id) ON DELETE RESTRICT,
  bank_reference text NULL,
  notes text NULL,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  payload_fingerprint text NOT NULL CHECK (btrim(payload_fingerprint) <> ''),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_unlinked_payments_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT finance_unlinked_payments_cash_movement_key UNIQUE (cash_movement_id),
  CONSTRAINT finance_unlinked_payments_credit_movement_key UNIQUE (credit_line_movement_id),
  CONSTRAINT finance_unlinked_payments_source_target_check CHECK (
    (source_type = 'cash_account' AND cash_account_id IS NOT NULL AND credit_line_id IS NULL)
    OR
    (source_type = 'credit_line' AND credit_line_id IS NOT NULL AND cash_account_id IS NULL)
  ),
  CONSTRAINT finance_unlinked_payments_posted_movement_check CHECK (
    status <> 'posted'
    OR
    (
      (source_type = 'cash_account' AND cash_movement_id IS NOT NULL AND credit_line_movement_id IS NULL AND repayment_group_id IS NULL)
      OR
      (source_type = 'credit_line' AND cash_movement_id IS NULL AND credit_line_movement_id IS NOT NULL AND repayment_group_id IS NOT NULL)
    )
  ),
  CONSTRAINT finance_unlinked_payments_amounts_check CHECK (
    public.finance_is_finite_numeric(bank_fee_eur)
    AND public.finance_is_finite_numeric(actual_total_eur)
    AND public.finance_is_finite_numeric(funded_total_eur)
    AND bank_fee_eur >= 0
    AND actual_total_eur > 0
    AND funded_total_eur = actual_total_eur + bank_fee_eur
    AND (
      (amount_breakdown_mode = 'total_only'
        AND actual_principal_eur IS NULL AND actual_interest_eur IS NULL AND actual_other_fees_eur IS NULL)
      OR
      (amount_breakdown_mode = 'detailed'
        AND public.finance_is_finite_numeric(actual_principal_eur) AND actual_principal_eur >= 0
        AND public.finance_is_finite_numeric(actual_interest_eur) AND actual_interest_eur >= 0
        AND public.finance_is_finite_numeric(actual_other_fees_eur) AND actual_other_fees_eur >= 0
        AND actual_total_eur = actual_principal_eur + actual_interest_eur + actual_other_fees_eur)
    )
  )
);

CREATE TABLE public.finance_unlinked_obligation_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.finance_unlinked_obligation_payments(id) ON DELETE RESTRICT,
  installment_id uuid NOT NULL REFERENCES public.finance_unlinked_obligation_installments(id) ON DELETE RESTRICT,
  amount_breakdown_mode text NOT NULL DEFAULT 'total_only'
    CHECK (amount_breakdown_mode IN ('total_only', 'detailed')),
  allocated_principal_eur numeric(14, 2) NULL,
  allocated_interest_eur numeric(14, 2) NULL,
  allocated_other_fees_eur numeric(14, 2) NULL,
  allocated_total_eur numeric(14, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_unlinked_allocations_payment_installment_key UNIQUE (payment_id, installment_id),
  CONSTRAINT finance_unlinked_allocations_amounts_check CHECK (
    public.finance_is_finite_numeric(allocated_total_eur) AND allocated_total_eur > 0
    AND (
      (amount_breakdown_mode = 'total_only'
        AND allocated_principal_eur IS NULL AND allocated_interest_eur IS NULL AND allocated_other_fees_eur IS NULL)
      OR
      (amount_breakdown_mode = 'detailed'
        AND public.finance_is_finite_numeric(allocated_principal_eur) AND allocated_principal_eur >= 0
        AND public.finance_is_finite_numeric(allocated_interest_eur) AND allocated_interest_eur >= 0
        AND public.finance_is_finite_numeric(allocated_other_fees_eur) AND allocated_other_fees_eur >= 0
        AND allocated_total_eur = allocated_principal_eur + allocated_interest_eur + allocated_other_fees_eur)
    )
  )
);

CREATE UNIQUE INDEX ux_finance_unlinked_obligations_template_period
  ON public.finance_unlinked_obligations(template_id, occurrence_period)
  WHERE template_id IS NOT NULL;
CREATE INDEX idx_finance_unlinked_templates_status_dates
  ON public.finance_unlinked_obligation_templates(status, start_date, end_date);
CREATE INDEX idx_finance_unlinked_obligations_status_created
  ON public.finance_unlinked_obligations(lifecycle_status, created_at DESC);
CREATE INDEX idx_finance_unlinked_obligations_category_created
  ON public.finance_unlinked_obligations(category, created_at DESC);
CREATE INDEX idx_finance_unlinked_installments_due
  ON public.finance_unlinked_obligation_installments(due_date, obligation_id)
  WHERE status = 'active';
CREATE INDEX idx_finance_unlinked_payments_obligation_paid
  ON public.finance_unlinked_obligation_payments(obligation_id, paid_at DESC);
CREATE INDEX idx_finance_unlinked_allocations_installment
  ON public.finance_unlinked_obligation_payment_allocations(installment_id);

CREATE OR REPLACE FUNCTION public.finance_enforce_unlinked_obligation_has_installment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_obligation_id uuid;
  v_obligation public.finance_unlinked_obligations;
  v_count integer;
  v_revision_count integer;
  v_mode_count integer;
  v_principal numeric;
  v_interest numeric;
  v_fees numeric;
  v_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'finance_unlinked_obligations' THEN
    IF TG_OP = 'DELETE' THEN
      v_obligation_id := OLD.id;
    ELSE
      v_obligation_id := NEW.id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      v_obligation_id := OLD.obligation_id;
    ELSE
      IF TG_OP = 'UPDATE'
         AND NEW.obligation_id IS DISTINCT FROM OLD.obligation_id THEN
        RAISE EXCEPTION
          'INSTALLMENT_OBLIGATION_IMMUTABLE: an installment cannot be moved to another obligation';
      END IF;

      v_obligation_id := NEW.obligation_id;
    END IF;
  END IF;

  SELECT * INTO v_obligation FROM public.finance_unlinked_obligations WHERE id = v_obligation_id;
  IF NOT FOUND OR v_obligation.lifecycle_status = 'cancelled' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT count(*), count(DISTINCT plan_revision), count(DISTINCT amount_breakdown_mode),
         sum(planned_principal_eur), sum(planned_interest_eur),
         sum(planned_other_fees_eur), sum(planned_total_eur)
  INTO v_count, v_revision_count, v_mode_count, v_principal, v_interest, v_fees, v_total
  FROM public.finance_unlinked_obligation_installments
  WHERE obligation_id = v_obligation_id AND status = 'active';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'OBLIGATION_REQUIRES_INSTALLMENT: every active obligation must have at least one active installment';
  END IF;
  IF v_revision_count <> 1 OR v_mode_count <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.finance_unlinked_obligation_installments
       WHERE obligation_id = v_obligation_id AND status = 'active'
         AND amount_breakdown_mode = v_obligation.amount_breakdown_mode
     ) THEN
    RAISE EXCEPTION 'INSTALLMENT_PLAN_MODE_MISMATCH: active installments must share the obligation mode and revision';
  END IF;
  IF round(v_total, 2) <> v_obligation.planned_total_eur THEN
    RAISE EXCEPTION 'INSTALLMENT_TOTAL_SUM_MISMATCH: active installment totals do not reconcile with obligation';
  END IF;
  IF v_obligation.amount_breakdown_mode = 'detailed' THEN
    IF round(v_principal, 2) <> v_obligation.planned_principal_eur THEN
      RAISE EXCEPTION 'INSTALLMENT_PRINCIPAL_SUM_MISMATCH: active installment principal does not reconcile';
    END IF;
    IF round(v_interest, 2) <> v_obligation.planned_interest_eur THEN
      RAISE EXCEPTION 'INSTALLMENT_INTEREST_SUM_MISMATCH: active installment interest does not reconcile';
    END IF;
    IF round(v_fees, 2) <> v_obligation.planned_other_fees_eur THEN
      RAISE EXCEPTION 'INSTALLMENT_FEES_SUM_MISMATCH: active installment fees do not reconcile';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER finance_unlinked_obligation_requires_installment
AFTER INSERT OR UPDATE ON public.finance_unlinked_obligations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.finance_enforce_unlinked_obligation_has_installment();

CREATE CONSTRAINT TRIGGER finance_unlinked_installment_delete_guard
AFTER INSERT OR UPDATE OR DELETE ON public.finance_unlinked_obligation_installments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.finance_enforce_unlinked_obligation_has_installment();

CREATE OR REPLACE FUNCTION public.finance_validate_unlinked_payment_allocation(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  v_payment public.finance_unlinked_obligation_payments;
  v_count integer; v_total numeric; v_principal numeric; v_interest numeric; v_fees numeric;
  v_installment record;
BEGIN
  SELECT * INTO v_payment FROM public.finance_unlinked_obligation_payments WHERE id=p_payment_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_payment.status='posted' THEN
    SELECT count(*),coalesce(sum(a.allocated_total_eur),0),coalesce(sum(a.allocated_principal_eur),0),
      coalesce(sum(a.allocated_interest_eur),0),coalesce(sum(a.allocated_other_fees_eur),0)
    INTO v_count,v_total,v_principal,v_interest,v_fees
    FROM public.finance_unlinked_obligation_payment_allocations a WHERE a.payment_id=p_payment_id;
    IF v_count=0 THEN RAISE EXCEPTION 'PAYMENT_REQUIRES_ALLOCATION'; END IF;
    IF EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_payment_allocations a
      WHERE a.payment_id=p_payment_id AND a.amount_breakdown_mode<>v_payment.amount_breakdown_mode)
    THEN RAISE EXCEPTION 'PAYMENT_ALLOCATION_MODE_MISMATCH'; END IF;
    IF EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_payment_allocations a
      JOIN public.finance_unlinked_obligation_installments i ON i.id=a.installment_id
      WHERE a.payment_id=p_payment_id AND i.amount_breakdown_mode<>v_payment.amount_breakdown_mode)
    THEN RAISE EXCEPTION 'INSTALLMENT_ALLOCATION_MODE_MISMATCH'; END IF;
    IF EXISTS (SELECT 1 FROM public.finance_unlinked_obligation_payment_allocations a
      JOIN public.finance_unlinked_obligation_installments i ON i.id=a.installment_id
      WHERE a.payment_id=p_payment_id AND i.obligation_id<>v_payment.obligation_id)
    THEN RAISE EXCEPTION 'ALLOCATION_OBLIGATION_MISMATCH'; END IF;
    IF v_total<>v_payment.actual_total_eur THEN RAISE EXCEPTION 'PAYMENT_ALLOCATION_TOTAL_MISMATCH'; END IF;
    IF v_payment.amount_breakdown_mode='detailed' THEN
      IF v_principal<>v_payment.actual_principal_eur THEN RAISE EXCEPTION 'PAYMENT_ALLOCATION_PRINCIPAL_MISMATCH'; END IF;
      IF v_interest<>v_payment.actual_interest_eur THEN RAISE EXCEPTION 'PAYMENT_ALLOCATION_INTEREST_MISMATCH'; END IF;
      IF v_fees<>v_payment.actual_other_fees_eur THEN RAISE EXCEPTION 'PAYMENT_ALLOCATION_FEES_MISMATCH'; END IF;
    END IF;
  END IF;

  FOR v_installment IN
    SELECT i.* FROM public.finance_unlinked_obligation_installments i
    WHERE i.id IN (SELECT a.installment_id FROM public.finance_unlinked_obligation_payment_allocations a WHERE a.payment_id=p_payment_id)
  LOOP
    SELECT coalesce(sum(a.allocated_total_eur),0),coalesce(sum(a.allocated_principal_eur),0),
      coalesce(sum(a.allocated_interest_eur),0),coalesce(sum(a.allocated_other_fees_eur),0)
    INTO v_total,v_principal,v_interest,v_fees
    FROM public.finance_unlinked_obligation_payment_allocations a
    JOIN public.finance_unlinked_obligation_payments p ON p.id=a.payment_id AND p.status='posted'
    WHERE a.installment_id=v_installment.id;
    IF v_total>v_installment.planned_total_eur THEN RAISE EXCEPTION 'INSTALLMENT_TOTAL_OVERPAYMENT'; END IF;
    IF v_installment.amount_breakdown_mode='detailed' THEN
      IF v_principal>v_installment.planned_principal_eur THEN RAISE EXCEPTION 'INSTALLMENT_PRINCIPAL_OVERPAYMENT'; END IF;
      IF v_interest>v_installment.planned_interest_eur THEN RAISE EXCEPTION 'INSTALLMENT_INTEREST_OVERPAYMENT'; END IF;
      IF v_fees>v_installment.planned_other_fees_eur THEN RAISE EXCEPTION 'INSTALLMENT_FEES_OVERPAYMENT'; END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_enforce_unlinked_payment_allocation_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  PERFORM public.finance_validate_unlinked_payment_allocation(coalesce(NEW.id,OLD.id));
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.finance_enforce_unlinked_allocation_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN PERFORM public.finance_validate_unlinked_payment_allocation(OLD.payment_id); END IF;
  IF TG_OP<>'DELETE' AND (TG_OP='INSERT' OR NEW.payment_id IS DISTINCT FROM OLD.payment_id) THEN
    PERFORM public.finance_validate_unlinked_payment_allocation(NEW.payment_id);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;

CREATE CONSTRAINT TRIGGER finance_unlinked_payment_allocation_integrity
AFTER INSERT OR UPDATE OR DELETE ON public.finance_unlinked_obligation_payments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.finance_enforce_unlinked_payment_allocation_integrity();

CREATE CONSTRAINT TRIGGER finance_unlinked_allocation_integrity
AFTER INSERT OR UPDATE OR DELETE ON public.finance_unlinked_obligation_payment_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION public.finance_enforce_unlinked_allocation_integrity();

COMMENT ON TABLE public.finance_unlinked_obligation_templates IS
  'Plantillas recurrentes: generan obligaciones por periodos civiles; no son deuda ni contienen fuente financiera.';
COMMENT ON TABLE public.finance_unlinked_obligations IS
  'Deudas previstas puntuales u ocurrencias snapshot. Crear una obligaciÃ³n no mueve dinero.';
COMMENT ON TABLE public.finance_unlinked_obligation_installments IS
  'Cuotas planificadas. Fraccionar crea fechas; un pago parcial conserva la fecha de la cuota.';
COMMENT ON TABLE public.finance_unlinked_obligation_payments IS
  'Contrato estructural de ejecuciones futuras inmutables; la inserciÃ³n operativa no se habilita en Fase 1.';
COMMENT ON TABLE public.finance_unlinked_obligation_payment_allocations IS
  'AplicaciÃ³n inmutable de una ejecuciÃ³n a cuotas; no crea fechas ni movimientos adicionales.';

COMMIT;
