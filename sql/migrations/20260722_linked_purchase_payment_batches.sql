-- Pagos reales vinculados a una o varias obligaciones de compra.
-- No incluye backfill y debe aplicarse despues de todas las migraciones 20260721.

BEGIN;

DO $status_preflight$
DECLARE
  v_conflicts text;
BEGIN
  SELECT string_agg(c.conname || ': ' || pg_get_constraintdef(c.oid), E'\n')
  INTO v_conflicts
  FROM pg_constraint c
  WHERE c.conrelid = 'public.finance_supplier_payments'::regclass
    AND c.contype = 'c'
    AND c.conname <> 'finance_supplier_payments_status_check'
    AND pg_get_constraintdef(c.oid) ~* '\mstatus\M';
  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT_CONFLICTING_STATUS_CHECK: %', v_conflicts;
  END IF;
END;
$status_preflight$;

ALTER TABLE public.finance_supplier_payments
  DROP CONSTRAINT IF EXISTS finance_supplier_payments_status_check;
ALTER TABLE public.finance_supplier_payments
  ADD CONSTRAINT finance_supplier_payments_status_check
  CHECK (status IN ('pendiente', 'parcial', 'pagado', 'vencido'));

CREATE OR REPLACE FUNCTION public.finance_is_finite_numeric(p_value numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_value IS NOT NULL
    AND p_value::text NOT IN ('NaN', 'Infinity', '-Infinity');
$$;

CREATE TABLE public.finance_purchase_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payee_type text NOT NULL,
  agent_id uuid NULL REFERENCES public.agentes_compra(id) ON DELETE RESTRICT,
  supplier_id uuid NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  paid_at timestamptz NOT NULL,
  original_currency text NOT NULL,
  amount_original numeric(14, 4) NOT NULL,
  actual_fx_rate numeric(18, 8) NOT NULL,
  actual_amount_eur numeric(14, 2) NOT NULL,
  bank_fee_eur numeric(14, 2) NOT NULL DEFAULT 0,
  ff_fee_eur numeric(14, 2) NOT NULL DEFAULT 0,
  funded_total_eur numeric(14, 2) NOT NULL,
  source_type text NOT NULL,
  cash_account_id uuid NULL REFERENCES public.finance_cash_accounts(id) ON DELETE RESTRICT,
  credit_line_id uuid NULL REFERENCES public.finance_credit_lines(id) ON DELETE RESTRICT,
  cash_movement_id uuid NULL REFERENCES public.finance_cash_movements(id) ON DELETE RESTRICT,
  credit_line_movement_id uuid NULL REFERENCES public.finance_credit_line_movements(id) ON DELETE RESTRICT,
  repayment_group_id uuid NULL REFERENCES public.finance_credit_line_repayment_groups(id) ON DELETE RESTRICT,
  bank_reference text NULL,
  notes text NULL,
  entry_mode text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  idempotency_key text NOT NULL UNIQUE,
  payload_fingerprint text NOT NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_purchase_payment_batches_payee_check
    CHECK (payee_type IN ('agent', 'supplier')),
  CONSTRAINT finance_purchase_payment_batches_payee_target_check
    CHECK (
      (payee_type = 'agent' AND agent_id IS NOT NULL AND supplier_id IS NULL)
      OR (payee_type = 'supplier' AND supplier_id IS NOT NULL AND agent_id IS NULL)
    ),
  CONSTRAINT finance_purchase_payment_batches_source_check
    CHECK (source_type IN ('cash_account', 'credit_line')),
  CONSTRAINT finance_purchase_payment_batches_source_target_check
    CHECK (
      (source_type = 'cash_account' AND cash_account_id IS NOT NULL AND credit_line_id IS NULL)
      OR (source_type = 'credit_line' AND credit_line_id IS NOT NULL AND cash_account_id IS NULL)
    ),
  CONSTRAINT finance_purchase_payment_batches_entry_mode_check
    CHECK (entry_mode IN ('free_amount', 'selected_payments')),
  CONSTRAINT finance_purchase_payment_batches_status_check
    CHECK (status IN ('posted', 'reversed')),
  CONSTRAINT finance_purchase_payment_batches_amount_check
    CHECK (public.finance_is_finite_numeric(amount_original) AND amount_original > 0),
  CONSTRAINT finance_purchase_payment_batches_fx_check
    CHECK (public.finance_is_finite_numeric(actual_fx_rate) AND actual_fx_rate > 0),
  CONSTRAINT finance_purchase_payment_batches_eur_check
    CHECK (public.finance_is_finite_numeric(actual_amount_eur) AND actual_amount_eur > 0),
  CONSTRAINT finance_purchase_payment_batches_bank_fee_check
    CHECK (public.finance_is_finite_numeric(bank_fee_eur) AND bank_fee_eur >= 0),
  CONSTRAINT finance_purchase_payment_batches_ff_fee_check
    CHECK (public.finance_is_finite_numeric(ff_fee_eur) AND ff_fee_eur >= 0),
  CONSTRAINT finance_purchase_payment_batches_total_check
    CHECK (
      public.finance_is_finite_numeric(funded_total_eur)
      AND funded_total_eur = actual_amount_eur + bank_fee_eur + ff_fee_eur
    )
);

CREATE TABLE public.finance_purchase_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.finance_purchase_payment_batches(id) ON DELETE RESTRICT,
  supplier_payment_id uuid NOT NULL REFERENCES public.finance_supplier_payments(id) ON DELETE RESTRICT,
  allocated_amount_original numeric(14, 4) NOT NULL
    CHECK (public.finance_is_finite_numeric(allocated_amount_original) AND allocated_amount_original > 0),
  allocated_amount_eur numeric(14, 2) NOT NULL
    CHECK (public.finance_is_finite_numeric(allocated_amount_eur) AND allocated_amount_eur > 0),
  pending_before_original numeric(14, 4) NOT NULL CHECK (pending_before_original >= 0),
  pending_after_original numeric(14, 4) NOT NULL CHECK (pending_after_original >= 0),
  resulting_status text NOT NULL CHECK (resulting_status IN ('parcial', 'pagado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, supplier_payment_id)
);

CREATE INDEX idx_finance_purchase_payment_batches_agent
  ON public.finance_purchase_payment_batches(agent_id);
CREATE INDEX idx_finance_purchase_payment_batches_supplier
  ON public.finance_purchase_payment_batches(supplier_id);
CREATE INDEX idx_finance_purchase_payment_batches_paid_at
  ON public.finance_purchase_payment_batches(paid_at);
CREATE INDEX idx_finance_purchase_payment_batches_currency
  ON public.finance_purchase_payment_batches(original_currency);
CREATE INDEX idx_finance_purchase_payment_allocations_batch
  ON public.finance_purchase_payment_allocations(batch_id);
CREATE INDEX idx_finance_purchase_payment_allocations_obligation
  ON public.finance_purchase_payment_allocations(supplier_payment_id);

ALTER TABLE public.finance_purchase_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_purchase_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_purchase_payment_batches_authenticated_read
  ON public.finance_purchase_payment_batches FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_purchase_payment_allocations_authenticated_read
  ON public.finance_purchase_payment_allocations FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.get_purchase_payment_candidates(p_query text DEFAULT NULL)
RETURNS TABLE (
  supplier_payment_id uuid,
  order_id uuid,
  numero_orden text,
  numero_pedido_agente text,
  agent_id uuid,
  agent_name text,
  supplier_id uuid,
  supplier_name text,
  payment_type text,
  amount_original numeric,
  original_currency text,
  allocated_amount_original numeric,
  pending_amount_original numeric,
  due_date date,
  settlement_status text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  SELECT
    sp.id,
    oc.id,
    oc.numero_orden,
    oc.numero_pedido_agente,
    oc.agente_id,
    ag.contacto,
    suppliers.supplier_id,
    suppliers.supplier_name,
    sp.payment_type,
    sp.amount_original,
    upper(sp.original_currency),
    coalesce(alloc.allocated, 0),
    greatest(sp.amount_original - coalesce(alloc.allocated, 0), 0),
    sp.due_date,
    CASE
      WHEN coalesce(alloc.allocated, 0) > 0 THEN 'parcial'
      WHEN sp.due_date < current_date THEN 'vencido'
      ELSE 'pendiente'
    END
  FROM public.finance_supplier_payments sp
  JOIN public.ordenes_compra oc ON oc.id = sp.orden_id
  JOIN public.agentes_compra ag ON ag.id = oc.agente_id
  LEFT JOIN LATERAL (
    SELECT
      (array_agg(DISTINCT oi.proveedor_id) FILTER (WHERE oi.proveedor_id IS NOT NULL))[1] AS supplier_id,
      string_agg(DISTINCT pr.nombre, ', ' ORDER BY pr.nombre) AS supplier_name
    FROM public.orden_items oi
    LEFT JOIN public.proveedores pr ON pr.id = oi.proveedor_id
    WHERE oi.orden_id = oc.id
  ) suppliers ON true
  LEFT JOIN LATERAL (
    SELECT sum(a.allocated_amount_original) AS allocated
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = sp.id AND b.status <> 'reversed'
  ) alloc ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT b.bank_reference, ' ') AS references
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = sp.id AND b.status <> 'reversed'
  ) batch_refs ON true
  WHERE oc.estado = 'confirmado'
    AND oc.agente_id IS NOT NULL
    AND coalesce(sp.payment_source_type, '') <> 'manual'
    AND sp.status NOT IN ('pagado')
    AND sp.amount_original - coalesce(alloc.allocated, 0) > 0.0001
    AND (
      nullif(trim(p_query), '') IS NULL
      OR concat_ws(' ', oc.numero_orden, oc.numero_pedido_agente, ag.contacto,
        suppliers.supplier_name, sp.payment_type, batch_refs.references)::text
        ILIKE '%' || trim(p_query) || '%'
    )
  ORDER BY sp.due_date NULLS LAST, oc.numero_orden, sp.payment_type;
$$;

CREATE OR REPLACE FUNCTION public.get_purchase_payment_batch_detail(p_batch_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'batch', to_jsonb(b) || jsonb_build_object(
      'agent_name', ag.contacto,
      'source_name', CASE
        WHEN b.source_type = 'cash_account' THEN cash.name
        ELSE concat_ws(' / ', line.bank_name, line.line_name)
      END
    ),
    'allocations', coalesce((
      SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'order_id', oc.id,
        'numero_orden', oc.numero_orden,
        'numero_pedido_agente', oc.numero_pedido_agente,
        'payment_type', sp.payment_type,
        'supplier_names', suppliers.names,
        'resulting_status', a.resulting_status,
        'current_obligation_status', sp.status
      ) ORDER BY oc.numero_orden, sp.payment_type)
      FROM public.finance_purchase_payment_allocations a
      JOIN public.finance_supplier_payments sp ON sp.id = a.supplier_payment_id
      JOIN public.ordenes_compra oc ON oc.id = sp.orden_id
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT pr.nombre, ', ' ORDER BY pr.nombre) AS names
        FROM public.orden_items oi
        LEFT JOIN public.proveedores pr ON pr.id = oi.proveedor_id
        WHERE oi.orden_id = oc.id
      ) suppliers ON true
      WHERE a.batch_id = b.id
    ), '[]'::jsonb),
    'movement', CASE
      WHEN b.cash_movement_id IS NOT NULL THEN jsonb_build_object('type', 'cash', 'id', b.cash_movement_id)
      WHEN b.credit_line_movement_id IS NOT NULL THEN jsonb_build_object(
        'type', 'credit_line', 'id', b.credit_line_movement_id, 'repayment_group_id', b.repayment_group_id)
      ELSE NULL
    END
  )
  FROM public.finance_purchase_payment_batches b
  LEFT JOIN public.agentes_compra ag ON ag.id = b.agent_id
  LEFT JOIN public.finance_cash_accounts cash ON cash.id = b.cash_account_id
  LEFT JOIN public.finance_credit_lines line ON line.id = b.credit_line_id
  WHERE b.id = p_batch_id;
$$;

CREATE OR REPLACE FUNCTION public.create_and_apply_purchase_payment_batch(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.finance_purchase_payment_batches;
  v_existing public.finance_purchase_payment_batches;
  v_cash public.finance_cash_accounts;
  v_line public.finance_credit_lines;
  v_cash_movement public.finance_cash_movements;
  v_drawdown jsonb;
  v_alloc jsonb;
  v_payment public.finance_supplier_payments;
  v_order public.ordenes_compra;
  v_allocations jsonb := '[]'::jsonb;
  v_obligations jsonb := '[]'::jsonb;
  v_agent_id uuid;
  v_currency text;
  v_source_type text;
  v_cash_id uuid;
  v_line_id uuid;
  v_amount numeric;
  v_actual_fx numeric;
  v_actual_eur numeric;
  v_bank_fee numeric;
  v_ff_fee numeric;
  v_funded_total numeric;
  v_alloc_sum numeric := 0;
  v_previous numeric;
  v_pending numeric;
  v_pending_after numeric;
  v_alloc_original numeric;
  v_alloc_eur numeric;
  v_eur_assigned numeric := 0;
  v_index integer := 0;
  v_count integer;
  v_next_status text;
  v_paid_at timestamptz;
  v_key text;
  v_supplier_payment_id uuid;
  v_payload_fingerprint text;
  v_entry_mode text;
  v_bank_reference text;
  v_notes text;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_payload->>'payee_type', '') <> 'agent' THEN
    RAISE EXCEPTION 'INVALID_PAYEE_TYPE: this version only supports agent';
  END IF;
  v_key := nullif(trim(p_payload->>'idempotency_key'), '');
  IF v_key IS NULL THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: idempotency_key is required'; END IF;
  -- Serializa reintentos concurrentes sin conceder INSERT directo a authenticated.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  SELECT * INTO v_existing FROM public.finance_purchase_payment_batches WHERE idempotency_key = v_key;

  IF coalesce(p_payload->>'agent_id', '') !~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_UUID: agent_id must be a UUID';
  END IF;
  IF nullif(p_payload->>'cash_account_id', '') IS NOT NULL
     AND (p_payload->>'cash_account_id') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_UUID: cash_account_id must be a UUID';
  END IF;
  IF nullif(p_payload->>'credit_line_id', '') IS NOT NULL
     AND (p_payload->>'credit_line_id') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_UUID: credit_line_id must be a UUID';
  END IF;
  IF coalesce(p_payload->>'paid_at', '') !~
     '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T.*)?$' THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: paid_at must be a valid date';
  END IF;
  BEGIN
    v_paid_at := (p_payload->>'paid_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: paid_at must be a valid date';
  END;

  v_agent_id := (p_payload->>'agent_id')::uuid;
  v_currency := upper(trim(p_payload->>'original_currency'));
  IF v_currency IS NULL OR v_currency = ''
     OR v_currency NOT IN ('USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'INVALID_PLAN_CURRENCY: unsupported original_currency';
  END IF;
  v_entry_mode := nullif(trim(p_payload->>'entry_mode'), '');
  IF v_entry_mode IS NULL OR v_entry_mode NOT IN ('free_amount', 'selected_payments') THEN
    RAISE EXCEPTION 'INVALID_ENTRY_MODE: unsupported entry_mode';
  END IF;
  v_source_type := p_payload->>'source_type';
  v_cash_id := nullif(p_payload->>'cash_account_id', '')::uuid;
  v_line_id := nullif(p_payload->>'credit_line_id', '')::uuid;
  v_bank_reference := nullif(trim(p_payload->>'bank_reference'), '');
  v_notes := nullif(trim(p_payload->>'notes'), '');
  BEGIN
    v_amount := (p_payload->>'amount_original')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount_original must be numeric';
  END;
  BEGIN
    v_actual_fx := nullif(p_payload->>'actual_fx_rate', '')::numeric;
    v_actual_eur := nullif(p_payload->>'actual_amount_eur', '')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual values must be numeric';
  END;
  BEGIN
    v_bank_fee := coalesce((p_payload->>'bank_fee_eur')::numeric, 0);
    v_ff_fee := coalesce((p_payload->>'ff_fee_eur')::numeric, 0);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_FEE: fees must be numeric';
  END;

  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: agent_id is required'; END IF;
  IF NOT public.finance_is_finite_numeric(v_amount) OR v_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount_original must be finite and positive';
  END IF;
  IF v_actual_fx IS NOT NULL AND NOT public.finance_is_finite_numeric(v_actual_fx) THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual_fx_rate must be finite';
  END IF;
  IF v_actual_eur IS NOT NULL AND NOT public.finance_is_finite_numeric(v_actual_eur) THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual_amount_eur must be finite';
  END IF;
  IF NOT public.finance_is_finite_numeric(v_bank_fee) OR v_bank_fee < 0
     OR NOT public.finance_is_finite_numeric(v_ff_fee) OR v_ff_fee < 0 THEN
    RAISE EXCEPTION 'INVALID_FEE: fees must be finite and nonnegative';
  END IF;
  IF v_currency = 'EUR' THEN
    IF v_actual_fx IS NOT NULL AND abs(v_actual_fx - 1) > 0.00000001 THEN
      RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: EUR requires fx rate 1';
    END IF;
    IF v_actual_eur IS NOT NULL AND abs(round(v_actual_eur, 2) - round(v_amount, 2)) > 0.01 THEN
      RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: EUR principal must equal original amount';
    END IF;
    v_actual_fx := 1; v_actual_eur := round(v_amount, 2);
  ELSIF v_actual_fx IS NULL AND v_actual_eur IS NULL THEN
    RAISE EXCEPTION 'MISSING_ACTUAL_VALUE: actual_fx_rate or actual_amount_eur is required';
  ELSIF v_actual_fx IS NULL THEN
    v_actual_eur := round(v_actual_eur, 2); v_actual_fx := v_actual_eur / v_amount;
  ELSIF v_actual_eur IS NULL THEN
    v_actual_eur := round(v_amount * v_actual_fx, 2);
  ELSIF abs(round(v_amount * v_actual_fx, 2) - round(v_actual_eur, 2)) > 0.01 THEN
    RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: actual values differ beyond EUR 0.01';
  ELSE
    v_actual_eur := round(v_actual_eur, 2);
  END IF;
  IF NOT public.finance_is_finite_numeric(v_actual_fx) OR v_actual_fx <= 0
     OR NOT public.finance_is_finite_numeric(v_actual_eur) OR v_actual_eur <= 0 THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual amounts and fees are invalid';
  END IF;
  v_funded_total := v_actual_eur + v_bank_fee + v_ff_fee;
  IF NOT public.finance_is_finite_numeric(v_funded_total) OR v_funded_total <= 0 THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: funded_total_eur must be finite and positive';
  END IF;

  IF jsonb_typeof(p_payload->'allocations') <> 'array' THEN
    RAISE EXCEPTION 'INVALID_ALLOCATIONS: allocations must be an array';
  END IF;
  IF jsonb_array_length(p_payload->'allocations') = 0 THEN
    RAISE EXCEPTION 'INVALID_ALLOCATIONS: at least one allocation is required';
  END IF;
  v_count := jsonb_array_length(p_payload->'allocations');
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload->'allocations') item
    WHERE coalesce(item->>'supplier_payment_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION 'INVALID_UUID: supplier_payment_id must be a UUID';
  END IF;
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_payload->'allocations')
  LOOP
    BEGIN
      v_alloc_original := (v_alloc->>'allocated_amount_original')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocated_amount_original must be numeric';
    END;
    IF NOT public.finance_is_finite_numeric(v_alloc_original) OR v_alloc_original <= 0 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocation must be finite and positive';
    END IF;
  END LOOP;

  SELECT md5(jsonb_build_object(
    'payee_type', 'agent',
    'agent_id', v_agent_id,
    'entry_mode', v_entry_mode,
    'original_currency', v_currency,
    'amount_original', v_amount,
    'actual_fx_rate', v_actual_fx,
    'actual_amount_eur', v_actual_eur,
    'bank_fee_eur', v_bank_fee,
    'ff_fee_eur', v_ff_fee,
    'funded_total_eur', v_funded_total,
    'source_type', v_source_type,
    'cash_account_id', v_cash_id,
    'credit_line_id', v_line_id,
    'paid_at', v_paid_at,
    'bank_reference', v_bank_reference,
    'notes', v_notes,
    'allocations', (
      SELECT jsonb_agg(jsonb_build_object(
        'supplier_payment_id', item->>'supplier_payment_id',
        'allocated_amount_original', (item->>'allocated_amount_original')::numeric
      ) ORDER BY item->>'supplier_payment_id')
      FROM jsonb_array_elements(p_payload->'allocations') item
    )
  )::text)
  INTO v_payload_fingerprint;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.payload_fingerprint IS DISTINCT FROM v_payload_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key belongs to a different payload';
    END IF;
    RETURN public.get_purchase_payment_batch_detail(v_existing.id)
      || jsonb_build_object('idempotent', true);
  END IF;

  -- Lock in stable UUID order before calculating any balance.
  PERFORM sp.id
  FROM public.finance_supplier_payments sp
  WHERE sp.id IN (
    SELECT (item->>'supplier_payment_id')::uuid
    FROM jsonb_array_elements(p_payload->'allocations') item
  )
  ORDER BY sp.id
  FOR UPDATE;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_payload->'allocations')
  LOOP
    SELECT * INTO v_payment FROM public.finance_supplier_payments
      WHERE id = (v_alloc->>'supplier_payment_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'OBLIGATION_NOT_FOUND: supplier payment not found'; END IF;
    IF v_payment.payment_source_type = 'manual' THEN
      RAISE EXCEPTION 'LEGACY_MANUAL_PAYMENT: legacy manual obligations are read-only';
    END IF;
    SELECT * INTO v_order FROM public.ordenes_compra WHERE id = v_payment.orden_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: obligation order not found'; END IF;
    IF v_order.estado <> 'confirmado' THEN
      RAISE EXCEPTION 'ORDER_NOT_CONFIRMED: obligation order must be confirmed';
    END IF;
    IF v_order.agente_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: obligation order has no agent'; END IF;
    IF v_order.agente_id <> v_agent_id THEN RAISE EXCEPTION 'AGENT_MISMATCH: all obligations must use the same agent'; END IF;
    IF upper(trim(v_payment.original_currency)) <> v_currency THEN
      RAISE EXCEPTION 'CURRENCY_MISMATCH: all obligations must use the same currency';
    END IF;
    SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed';
    v_pending := v_payment.amount_original - v_previous;
    v_alloc_original := (v_alloc->>'allocated_amount_original')::numeric;
    IF NOT public.finance_is_finite_numeric(v_previous)
       OR NOT public.finance_is_finite_numeric(v_pending)
       OR NOT public.finance_is_finite_numeric(v_alloc_original)
       OR v_alloc_original <= 0 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocation values must be finite and positive';
    END IF;
    IF v_pending <= 0.0001 OR v_payment.status = 'pagado' THEN
      RAISE EXCEPTION 'OBLIGATION_ALREADY_PAID: obligation has no pending balance';
    END IF;
    IF v_alloc_original <= 0 OR v_alloc_original - v_pending > 0.0001 THEN
      RAISE EXCEPTION 'OVERALLOCATION: allocation exceeds real pending balance';
    END IF;
    v_alloc_sum := v_alloc_sum + v_alloc_original;
    IF NOT public.finance_is_finite_numeric(v_alloc_sum) THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocation sum must be finite';
    END IF;
  END LOOP;
  IF abs(v_alloc_sum - v_amount) > 0.0001 THEN
    RAISE EXCEPTION 'ALLOCATION_SUM_MISMATCH: allocations must equal batch principal';
  END IF;

  IF v_source_type = 'cash_account' THEN
    IF v_cash_id IS NULL OR v_line_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_SOURCE: select exactly one cash account'; END IF;
    SELECT * INTO v_cash FROM public.finance_cash_accounts WHERE id = v_cash_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CASH_ACCOUNT_NOT_FOUND: cash account not found'; END IF;
    IF upper(trim(v_cash.currency)) <> 'EUR' THEN RAISE EXCEPTION 'INVALID_CASH_ACCOUNT_CURRENCY: cash account must be EUR'; END IF;
    IF v_cash.balance < v_funded_total THEN RAISE EXCEPTION 'INSUFFICIENT_CASH: insufficient cash balance'; END IF;
  ELSIF v_source_type = 'credit_line' THEN
    IF v_line_id IS NULL OR v_cash_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_SOURCE: select exactly one credit line'; END IF;
    SELECT * INTO v_line FROM public.finance_credit_lines WHERE id = v_line_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CREDIT_LINE_NOT_FOUND: credit line not found'; END IF;
    IF lower(trim(v_line.status)) NOT IN ('activa', 'activo', 'active') THEN RAISE EXCEPTION 'CREDIT_LINE_INACTIVE: credit line is inactive'; END IF;
    IF v_line.available_amount < v_funded_total THEN RAISE EXCEPTION 'INSUFFICIENT_CREDIT: insufficient credit'; END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_SOURCE_TYPE: source must be cash_account or credit_line';
  END IF;

  BEGIN
    INSERT INTO public.finance_purchase_payment_batches (
      payee_type, agent_id, paid_at, original_currency, amount_original,
      actual_fx_rate, actual_amount_eur, bank_fee_eur, ff_fee_eur, funded_total_eur,
      source_type, cash_account_id, credit_line_id, bank_reference, notes,
      entry_mode, idempotency_key, payload_fingerprint, created_by
    ) VALUES (
      'agent', v_agent_id, v_paid_at, v_currency, v_amount,
      v_actual_fx, v_actual_eur, v_bank_fee, v_ff_fee, v_funded_total,
      v_source_type, v_cash_id, v_line_id, v_bank_reference,
      v_notes, v_entry_mode, v_key,
      v_payload_fingerprint, auth.uid()
    ) RETURNING * INTO v_batch;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.payload_fingerprint IS DISTINCT FROM v_payload_fingerprint THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key belongs to a different payload';
      END IF;
      RETURN public.get_purchase_payment_batch_detail(v_existing.id)
        || jsonb_build_object('idempotent', true);
    END IF;
    RAISE;
  END;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_payload->'allocations')
  LOOP
    v_supplier_payment_id := (v_alloc->>'supplier_payment_id')::uuid;
    v_index := v_index + 1;
    v_alloc_original := (v_alloc->>'allocated_amount_original')::numeric;
    SELECT * INTO v_payment
    FROM public.finance_supplier_payments
    WHERE id = v_supplier_payment_id;
    SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_supplier_payment_id AND b.status <> 'reversed';
    v_pending := v_payment.amount_original - v_previous;
    v_pending_after := greatest(v_pending - v_alloc_original, 0);
    v_next_status := CASE WHEN v_pending_after <= 0.0001 THEN 'pagado' ELSE 'parcial' END;
    v_alloc_eur := CASE WHEN v_index = v_count
      THEN v_actual_eur - v_eur_assigned
      ELSE round(v_alloc_original * v_actual_fx, 2)
    END;
    IF NOT public.finance_is_finite_numeric(v_pending)
       OR NOT public.finance_is_finite_numeric(v_pending_after)
       OR NOT public.finance_is_finite_numeric(v_alloc_eur)
       OR v_alloc_eur <= 0 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: calculated allocation values must be finite and positive';
    END IF;
    v_eur_assigned := v_eur_assigned + v_alloc_eur;
    IF NOT public.finance_is_finite_numeric(v_eur_assigned) THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: EUR allocation sum must be finite';
    END IF;
    INSERT INTO public.finance_purchase_payment_allocations (
      batch_id, supplier_payment_id, allocated_amount_original, allocated_amount_eur,
      pending_before_original, pending_after_original, resulting_status
    ) VALUES (
      v_batch.id, v_supplier_payment_id, v_alloc_original, v_alloc_eur,
      v_pending, v_pending_after, v_next_status
    ) RETURNING to_jsonb(finance_purchase_payment_allocations.*) INTO v_alloc;
    v_allocations := v_allocations || jsonb_build_array(v_alloc);

    SELECT * INTO v_payment FROM public.finance_supplier_payments
      WHERE id = v_supplier_payment_id;
    SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed';
    UPDATE public.finance_supplier_payments SET
      status = v_next_status,
      paid_at = CASE WHEN v_next_status = 'pagado' THEN v_paid_at ELSE NULL END,
      actual_amount_original = v_previous,
      actual_amount_eur = (
        SELECT sum(a.allocated_amount_eur)
        FROM public.finance_purchase_payment_allocations a
        JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
        WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed'
      ),
      actual_fx_rate = CASE WHEN v_previous > 0 THEN (
        SELECT sum(a.allocated_amount_eur)
        FROM public.finance_purchase_payment_allocations a
        JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
        WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed'
      ) / v_previous ELSE NULL END,
      payment_source_type = v_source_type,
      cash_account_id = CASE WHEN v_source_type = 'cash_account' THEN v_cash_id ELSE NULL END,
      credit_line_id = CASE WHEN v_source_type = 'credit_line' THEN v_line_id ELSE NULL END,
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING to_jsonb(finance_supplier_payments.*) INTO v_alloc;
    v_obligations := v_obligations || jsonb_build_array(v_alloc);
  END LOOP;

  -- El ledger actual solo admite un movimiento supplier_payment; conserva el desglose en el batch.
  IF v_source_type = 'cash_account' THEN
    INSERT INTO public.finance_cash_movements (
      cash_account_id, movement_type, direction, amount, source_type, source_id,
      movement_date, notes, updated_at
    ) VALUES (
      v_cash_id, 'supplier_payment', 'out', v_funded_total,
      'purchase_payment_batch', v_batch.id, (v_paid_at AT TIME ZONE 'UTC')::date,
      concat_ws(' | ', p_payload->>'notes',
        'principal EUR ' || v_actual_eur,
        'comision EUR ' || v_bank_fee,
        'FF EUR ' || v_ff_fee), now()
    ) RETURNING * INTO v_cash_movement;
    UPDATE public.finance_cash_accounts SET balance = balance - v_funded_total, updated_at = now()
      WHERE id = v_cash_id;
    UPDATE public.finance_purchase_payment_batches SET cash_movement_id = v_cash_movement.id
      WHERE id = v_batch.id RETURNING * INTO v_batch;
  ELSE
    v_drawdown := public.finance_create_credit_line_drawdown(
      v_line_id, v_funded_total, (v_paid_at AT TIME ZONE 'UTC')::date,
      'purchase_payment_batch', v_batch.id,
      coalesce(nullif(trim(p_payload->>'notes'), ''), 'Pago vinculado a agente'),
      v_key || ':drawdown'
    );
    UPDATE public.finance_purchase_payment_batches SET
      credit_line_movement_id = (v_drawdown->>'movement_id')::uuid,
      repayment_group_id = (v_drawdown->>'repayment_group_id')::uuid
    WHERE id = v_batch.id RETURNING * INTO v_batch;
  END IF;

  RETURN jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'allocations', v_allocations,
    'movement', CASE WHEN v_source_type = 'cash_account'
      THEN to_jsonb(v_cash_movement) ELSE v_drawdown END,
    'obligations', v_obligations,
    'idempotent', false
  );
END;
$$;

-- El refresco de planificación nunca puede degradar ni reescribir settlement real.
CREATE OR REPLACE FUNCTION public.sync_supplier_payment_plan(
  p_order_id uuid,
  p_payment_type text,
  p_due_date date,
  p_amount_original numeric,
  p_original_currency text,
  p_planned_fx_rate numeric,
  p_amount_eur numeric,
  p_logistics_type text,
  p_container_id uuid,
  p_status text,
  p_notes text DEFAULT NULL,
  p_update_notes boolean DEFAULT false
)
RETURNS public.finance_supplier_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
  v_currency text := upper(trim(coalesce(p_original_currency, '')));
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'INVALID_ORDER_ID: order_id is required'; END IF;
  IF p_payment_type NOT IN ('DEPOSITO_30', 'BALANCE_70') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TYPE: unsupported payment type';
  END IF;
  IF p_status NOT IN ('pendiente', 'vencido') THEN
    RAISE EXCEPTION 'INVALID_PLAN_STATUS: status must be pendiente or vencido';
  END IF;
  IF p_amount_original IS NULL OR p_amount_original <= 0 OR v_currency = '' THEN
    RAISE EXCEPTION 'INVALID_PLAN_AMOUNT: positive amount and currency are required';
  END IF;
  IF NOT public.finance_is_finite_numeric(p_amount_original) OR p_amount_original <= 0 THEN
    RAISE EXCEPTION 'INVALID_PLAN_AMOUNT: amount_original must be finite and positive';
  END IF;
  IF p_planned_fx_rate IS NOT NULL
     AND (NOT public.finance_is_finite_numeric(p_planned_fx_rate) OR p_planned_fx_rate <= 0) THEN
    RAISE EXCEPTION 'INVALID_PLAN_FX: planned_fx_rate must be finite and positive';
  END IF;
  IF NOT public.finance_is_finite_numeric(p_amount_eur) OR p_amount_eur < 0 THEN
    RAISE EXCEPTION 'INVALID_PLAN_EUR_AMOUNT: amount_eur must be finite and nonnegative';
  END IF;
  IF v_currency NOT IN ('USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'INVALID_PLAN_CURRENCY: unsupported original_currency';
  END IF;

  INSERT INTO public.finance_supplier_payments (
    orden_id, payment_type, due_date, amount_original, original_currency,
    planned_fx_rate, amount_eur, logistics_type, contenedor_id, status, notes
  ) VALUES (
    p_order_id, p_payment_type, p_due_date, p_amount_original, v_currency,
    p_planned_fx_rate, p_amount_eur, p_logistics_type, p_container_id, p_status, p_notes
  )
  ON CONFLICT (orden_id, payment_type) DO NOTHING;

  SELECT * INTO v_payment
  FROM public.finance_supplier_payments
  WHERE orden_id = p_order_id AND payment_type = p_payment_type
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: payment row missing'; END IF;

  IF v_payment.status = 'pagado' THEN
    RETURN v_payment;
  END IF;

  IF v_payment.status = 'parcial' THEN
    IF abs(v_payment.amount_original - p_amount_original) > 0.0001
       OR upper(trim(v_payment.original_currency)) <> v_currency THEN
      RAISE EXCEPTION
        'PARTIAL_PAYMENT_PLAN_MISMATCH: planned amount/currency differs from partially settled obligation';
    END IF;
    UPDATE public.finance_supplier_payments
    SET
      due_date = p_due_date,
      logistics_type = p_logistics_type,
      contenedor_id = p_container_id,
      notes = CASE WHEN p_update_notes THEN p_notes ELSE notes END,
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
    RETURN v_payment;
  END IF;

  IF v_payment.status NOT IN ('pendiente', 'vencido') THEN
    RAISE EXCEPTION 'INVALID_EXISTING_PLAN_STATUS: payment status cannot be synchronized';
  END IF;

  UPDATE public.finance_supplier_payments
  SET
    due_date = p_due_date,
    amount_original = p_amount_original,
    original_currency = v_currency,
    planned_fx_rate = p_planned_fx_rate,
    amount_eur = p_amount_eur,
    logistics_type = p_logistics_type,
    contenedor_id = p_container_id,
    status = p_status,
    notes = CASE WHEN p_update_notes THEN p_notes ELSE notes END,
    updated_at = now()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;
  RETURN v_payment;
END;
$$;

-- Compatibilidad: la API individual conserva su firma, pero ejecuta el modelo batch.
CREATE OR REPLACE FUNCTION public.mark_and_finance_supplier_payment(
  p_supplier_payment_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_actual_fx_rate numeric DEFAULT NULL,
  p_actual_amount_eur numeric DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_bank_fee_eur numeric DEFAULT NULL,
  p_ff_fee_eur numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_cash_account_id uuid DEFAULT NULL,
  p_credit_line_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
  v_order public.ordenes_compra;
  v_result jsonb;
  v_updated jsonb;
  v_previous numeric;
  v_pending numeric;
  v_existing_batch public.finance_purchase_payment_batches;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_payment
  FROM public.finance_supplier_payments
  WHERE id = p_supplier_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment not found'; END IF;
  IF v_payment.payment_source_type = 'manual' THEN
    RAISE EXCEPTION 'LEGACY_MANUAL_PAYMENT: legacy manual obligations are read-only';
  END IF;
  IF p_order_id IS NOT NULL AND p_order_id <> v_payment.orden_id THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_MISMATCH: payment does not belong to order';
  END IF;
  SELECT * INTO v_order FROM public.ordenes_compra WHERE id = v_payment.orden_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: order not found'; END IF;
  IF v_order.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'ORDER_NOT_CONFIRMED: order must be confirmed';
  END IF;
  IF v_order.agente_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: order has no purchase agent'; END IF;
  SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
  FROM public.finance_purchase_payment_allocations a
  JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
  WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed';
  v_pending := v_payment.amount_original - v_previous;
  IF v_pending <= 0.0001 THEN
    SELECT * INTO v_existing_batch
    FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = 'individual-supplier-payment:' || p_supplier_payment_id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OBLIGATION_ALREADY_PAID: obligation has no pending balance';
    END IF;
    v_pending := v_existing_batch.amount_original;
  END IF;

  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent',
    'agent_id', v_order.agente_id,
    'entry_mode', 'selected_payments',
    'amount_original', v_pending,
    'original_currency', v_payment.original_currency,
    'actual_fx_rate', p_actual_fx_rate,
    'actual_amount_eur', p_actual_amount_eur,
    'bank_fee_eur', coalesce(p_bank_fee_eur, 0),
    'ff_fee_eur', coalesce(p_ff_fee_eur, 0),
    'paid_at', p_paid_at,
    'bank_reference', p_bank_reference,
    'notes', p_notes,
    'source_type', p_source_type,
    'cash_account_id', p_cash_account_id,
    'credit_line_id', p_credit_line_id,
    'idempotency_key', 'individual-supplier-payment:' || p_supplier_payment_id::text,
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', p_supplier_payment_id,
      'allocated_amount_original', v_pending
    ))
  ));

  SELECT to_jsonb(sp) INTO v_updated
  FROM public.finance_supplier_payments sp
  WHERE sp.id = p_supplier_payment_id;

  RETURN jsonb_build_object(
    'payment', v_updated,
    'source_type', v_result->'batch'->>'source_type',
    'cash_account_id', v_result->'batch'->'cash_account_id',
    'credit_line_id', v_result->'batch'->'credit_line_id',
    'cash_movement_id', v_result->'batch'->'cash_movement_id',
    'credit_line_movement_id', v_result->'batch'->'credit_line_movement_id',
    'repayment_group_id', v_result->'batch'->'repayment_group_id',
    'supplier_amount_eur', v_result->'batch'->'actual_amount_eur',
    'bank_fee_eur', v_result->'batch'->'bank_fee_eur',
    'ff_fee_eur', v_result->'batch'->'ff_fee_eur',
    'funded_total_eur', v_result->'batch'->'funded_total_eur',
    'batch_id', v_result->'batch'->'id',
    'idempotent', coalesce((v_result->>'idempotent')::boolean, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.void_pending_supplier_payment_plan(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.finance_supplier_payments
  WHERE orden_id = p_order_id
    AND status IN ('pendiente', 'vencido')
    AND coalesce(payment_source_type, '') <> 'manual'
    AND NOT EXISTS (
      SELECT 1 FROM public.finance_purchase_payment_allocations a
      WHERE a.supplier_payment_id = finance_supplier_payments.id
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON public.finance_purchase_payment_batches FROM PUBLIC, anon;
REVOKE ALL ON public.finance_purchase_payment_allocations FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.finance_supplier_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_purchase_payment_batches TO authenticated, service_role;
GRANT SELECT ON public.finance_purchase_payment_allocations TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_purchase_payment_candidates(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_purchase_payment_batch_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_supplier_payment_plan(
  uuid, text, date, numeric, text, numeric, numeric, text, uuid, text, text, boolean
) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.void_pending_supplier_payment_plan(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_payment_candidates(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_payment_batch_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_supplier_payment_plan(
  uuid, text, date, numeric, text, numeric, numeric, text, uuid, text, text, boolean
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_pending_supplier_payment_plan(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid
) TO authenticated, service_role;

ALTER FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) OWNER TO postgres;
ALTER FUNCTION public.sync_supplier_payment_plan(
  uuid, text, date, numeric, text, numeric, numeric, text, uuid, text, text, boolean
) OWNER TO postgres;
ALTER FUNCTION public.void_pending_supplier_payment_plan(uuid) OWNER TO postgres;
ALTER FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid
) OWNER TO postgres;

COMMENT ON TABLE public.finance_purchase_payment_batches IS
  'Transferencia real e inmutable a agente o, en una futura version, proveedor.';
COMMENT ON TABLE public.finance_purchase_payment_allocations IS
  'Aplicacion many-to-many de transferencias reales a obligaciones de orden.';

NOTIFY pgrst, 'reload schema';

COMMIT;
