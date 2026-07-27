-- PROPUESTA (no aplicar datos): regularizacion explicita de saldo inicial legacy.
-- source_type = legacy_opening_balance. No vincular a orden.
-- Esta migracion define la RPC; no ejecuta backfill.

BEGIN;

CREATE OR REPLACE FUNCTION public.finance_register_legacy_opening_balance(
  p_credit_line_id uuid,
  p_amount_eur numeric,
  p_due_date date,
  p_period_start date DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.finance_credit_lines%ROWTYPE;
  v_group public.finance_credit_line_repayment_groups%ROWTYPE;
  v_existing public.finance_credit_line_movements%ROWTYPE;
  v_movement public.finance_credit_line_movements%ROWTYPE;
  v_period_start date;
  v_explained numeric;
  v_unexplained numeric;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_eur IS NULL OR p_amount_eur <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount_eur must be greater than 0';
  END IF;

  IF p_due_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: due_date is required';
  END IF;

  v_period_start := coalesce(p_period_start, p_due_date);
  IF p_due_date < v_period_start THEN
    RAISE EXCEPTION 'INVALID_DATE: due_date must be on or after period_start';
  END IF;

  SELECT * INTO v_line
  FROM public.finance_credit_lines
  WHERE id = p_credit_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: credit line not found';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = p_idempotency_key
      AND movement_type = 'adjustment'
      AND source_type = 'legacy_opening_balance'
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'movement_id', v_existing.id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_line.id,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT coalesce(SUM(remaining_amount), 0)
  INTO v_explained
  FROM public.finance_credit_line_repayment_groups
  WHERE credit_line_id = p_credit_line_id
    AND status IN ('open', 'partially_paid');

  v_unexplained := v_line.used_amount - v_explained;
  IF p_amount_eur > v_unexplained + 0.01 THEN
    RAISE EXCEPTION
      'LEGACY_AMOUNT_EXCEEDS_GAP: amount % exceeds unexplained used_amount %',
      p_amount_eur, v_unexplained;
  END IF;

  -- No altera used_amount/available_amount: la cabecera ya refleja el saldo legacy.
  -- movement_type = adjustment (no drawdown) para no inflar el ledger neto.
  INSERT INTO public.finance_credit_line_repayment_groups (
    credit_line_id,
    period_start,
    period_end,
    due_date,
    amount,
    paid_amount,
    remaining_amount,
    status,
    updated_at
  )
  VALUES (
    p_credit_line_id,
    v_period_start,
    p_due_date,
    p_due_date,
    p_amount_eur,
    0,
    p_amount_eur,
    'open',
    now()
  )
  RETURNING * INTO v_group;

  INSERT INTO public.finance_credit_line_movements (
    credit_line_id,
    movement_type,
    description,
    due_date,
    paid_at,
    amount,
    status,
    source_type,
    source_id,
    movement_date,
    repayment_group_id,
    idempotency_key,
    updated_at
  )
  VALUES (
    p_credit_line_id,
    'adjustment',
    coalesce(
      nullif(trim(concat_ws(' | ', 'Saldo inicial pendiente de regularizar', p_reference, p_notes)), ''),
      'Saldo inicial pendiente de regularizar'
    ),
    p_due_date,
    NULL,
    p_amount_eur,
    'posted',
    'legacy_opening_balance',
    NULL,
    v_period_start,
    v_group.id,
    p_idempotency_key,
    now()
  )
  RETURNING * INTO v_movement;

  RETURN jsonb_build_object(
    'movement_id', v_movement.id,
    'repayment_group_id', v_group.id,
    'credit_line_id', v_line.id,
    'amount_eur', p_amount_eur,
    'due_date', p_due_date,
    'idempotent', false,
    'note', 'Does not change used_amount; only creates payable maturity for existing legacy debt'
  );
END;
$$;

COMMENT ON FUNCTION public.finance_register_legacy_opening_balance(
  uuid, numeric, date, date, text, text, text
) IS
  'RPC admin para regularizar used_amount legacy como repayment group. No backfill automatico.';

REVOKE EXECUTE ON FUNCTION public.finance_register_legacy_opening_balance(
  uuid, numeric, date, date, text, text, text
) FROM PUBLIC, anon;

-- Solo service_role por defecto; grant authenticated se anade cuando exista control admin en app.
GRANT EXECUTE ON FUNCTION public.finance_register_legacy_opening_balance(
  uuid, numeric, date, date, text, text, text
) TO service_role;

ALTER FUNCTION public.finance_register_legacy_opening_balance(
  uuid, numeric, date, date, text, text, text
) OWNER TO postgres;

COMMIT;
