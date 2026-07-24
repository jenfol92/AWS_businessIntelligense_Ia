-- Pagos reales vinculados a una o varias obligaciones de compra.
-- No incluye backfill y debe aplicarse despues de todas las migraciones 20260721.

BEGIN;

ALTER TABLE public.finance_supplier_payments
  DROP CONSTRAINT IF EXISTS finance_supplier_payments_status_check;
ALTER TABLE public.finance_supplier_payments
  ADD CONSTRAINT finance_supplier_payments_status_check
  CHECK (status IN ('pendiente', 'parcial', 'pagado', 'vencido'));

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
  CONSTRAINT finance_purchase_payment_batches_amount_check CHECK (amount_original > 0),
  CONSTRAINT finance_purchase_payment_batches_fx_check CHECK (actual_fx_rate > 0),
  CONSTRAINT finance_purchase_payment_batches_eur_check CHECK (actual_amount_eur > 0),
  CONSTRAINT finance_purchase_payment_batches_bank_fee_check CHECK (bank_fee_eur >= 0),
  CONSTRAINT finance_purchase_payment_batches_ff_fee_check CHECK (ff_fee_eur >= 0),
  CONSTRAINT finance_purchase_payment_batches_total_check
    CHECK (funded_total_eur = actual_amount_eur + bank_fee_eur + ff_fee_eur)
);

CREATE TABLE public.finance_purchase_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.finance_purchase_payment_batches(id) ON DELETE RESTRICT,
  supplier_payment_id uuid NOT NULL REFERENCES public.finance_supplier_payments(id) ON DELETE RESTRICT,
  allocated_amount_original numeric(14, 4) NOT NULL CHECK (allocated_amount_original > 0),
  allocated_amount_eur numeric(14, 2) NOT NULL CHECK (allocated_amount_eur > 0),
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
  WHERE oc.estado = 'confirmado'
    AND oc.agente_id IS NOT NULL
    AND sp.status NOT IN ('pagado')
    AND sp.amount_original - coalesce(alloc.allocated, 0) > 0.0001
    AND (
      nullif(trim(p_query), '') IS NULL
      OR concat_ws(' ', oc.numero_orden, oc.numero_pedido_agente, ag.contacto,
        suppliers.supplier_name, sp.payment_type)::text ILIKE '%' || trim(p_query) || '%'
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
    'batch', to_jsonb(b),
    'allocations', coalesce((
      SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object(
        'order_id', oc.id,
        'numero_orden', oc.numero_orden,
        'numero_pedido_agente', oc.numero_pedido_agente,
        'payment_type', sp.payment_type,
        'supplier_names', suppliers.names,
        'resulting_status', sp.status
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
  WHERE b.id = p_batch_id;
$$;

CREATE OR REPLACE FUNCTION public.create_and_apply_purchase_payment_batch(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
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
  v_alloc_original numeric;
  v_alloc_eur numeric;
  v_eur_assigned numeric := 0;
  v_index integer := 0;
  v_count integer;
  v_next_status text;
  v_paid_at timestamptz;
  v_key text;
  v_supplier_payment_id uuid;
BEGIN
  IF coalesce(p_payload->>'payee_type', '') <> 'agent' THEN
    RAISE EXCEPTION 'INVALID_PAYEE_TYPE: this version only supports agent';
  END IF;
  v_key := nullif(trim(p_payload->>'idempotency_key'), '');
  IF v_key IS NULL THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: idempotency_key is required'; END IF;
  SELECT * INTO v_existing FROM public.finance_purchase_payment_batches WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN public.get_purchase_payment_batch_detail(v_existing.id) || jsonb_build_object('idempotent', true);
  END IF;

  v_agent_id := nullif(p_payload->>'agent_id', '')::uuid;
  v_currency := upper(trim(p_payload->>'original_currency'));
  v_source_type := p_payload->>'source_type';
  v_cash_id := nullif(p_payload->>'cash_account_id', '')::uuid;
  v_line_id := nullif(p_payload->>'credit_line_id', '')::uuid;
  v_amount := (p_payload->>'amount_original')::numeric;
  v_actual_fx := nullif(p_payload->>'actual_fx_rate', '')::numeric;
  v_actual_eur := nullif(p_payload->>'actual_amount_eur', '')::numeric;
  v_bank_fee := coalesce((p_payload->>'bank_fee_eur')::numeric, 0);
  v_ff_fee := coalesce((p_payload->>'ff_fee_eur')::numeric, 0);
  v_paid_at := (p_payload->>'paid_at')::timestamptz;

  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: agent_id is required'; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT: amount_original must be positive'; END IF;
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
  IF v_actual_fx <= 0 OR v_actual_eur <= 0 OR v_bank_fee < 0 OR v_ff_fee < 0 THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual amounts and fees are invalid';
  END IF;
  v_funded_total := v_actual_eur + v_bank_fee + v_ff_fee;

  IF jsonb_typeof(p_payload->'allocations') <> 'array'
     OR jsonb_array_length(p_payload->'allocations') = 0 THEN
    RAISE EXCEPTION 'INVALID_ALLOCATIONS: at least one allocation is required';
  END IF;
  v_count := jsonb_array_length(p_payload->'allocations');

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
    SELECT * INTO v_order FROM public.ordenes_compra WHERE id = v_payment.orden_id;
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
    IF v_pending <= 0.0001 OR v_payment.status = 'pagado' THEN
      RAISE EXCEPTION 'OBLIGATION_ALREADY_PAID: obligation has no pending balance';
    END IF;
    IF v_alloc_original <= 0 OR v_alloc_original - v_pending > 0.0001 THEN
      RAISE EXCEPTION 'OVERALLOCATION: allocation exceeds real pending balance';
    END IF;
    v_alloc_sum := v_alloc_sum + v_alloc_original;
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

  INSERT INTO public.finance_purchase_payment_batches (
    payee_type, agent_id, paid_at, original_currency, amount_original,
    actual_fx_rate, actual_amount_eur, bank_fee_eur, ff_fee_eur, funded_total_eur,
    source_type, cash_account_id, credit_line_id, bank_reference, notes,
    entry_mode, idempotency_key, created_by
  ) VALUES (
    'agent', v_agent_id, v_paid_at, v_currency, v_amount,
    v_actual_fx, v_actual_eur, v_bank_fee, v_ff_fee, v_funded_total,
    v_source_type, v_cash_id, v_line_id, nullif(trim(p_payload->>'bank_reference'), ''),
    nullif(trim(p_payload->>'notes'), ''), p_payload->>'entry_mode', v_key, auth.uid()
  ) RETURNING * INTO v_batch;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_payload->'allocations')
  LOOP
    v_supplier_payment_id := (v_alloc->>'supplier_payment_id')::uuid;
    v_index := v_index + 1;
    v_alloc_original := (v_alloc->>'allocated_amount_original')::numeric;
    v_alloc_eur := CASE WHEN v_index = v_count
      THEN v_actual_eur - v_eur_assigned
      ELSE round(v_alloc_original * v_actual_fx, 2)
    END;
    v_eur_assigned := v_eur_assigned + v_alloc_eur;
    INSERT INTO public.finance_purchase_payment_allocations (
      batch_id, supplier_payment_id, allocated_amount_original, allocated_amount_eur
    ) VALUES (
      v_batch.id, v_supplier_payment_id, v_alloc_original, v_alloc_eur
    ) RETURNING to_jsonb(finance_purchase_payment_allocations.*) INTO v_alloc;
    v_allocations := v_allocations || jsonb_build_array(v_alloc);

    SELECT * INTO v_payment FROM public.finance_supplier_payments
      WHERE id = v_supplier_payment_id;
    SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed';
    v_next_status := CASE
      WHEN v_payment.amount_original - v_previous <= 0.0001 THEN 'pagado'
      ELSE 'parcial'
    END;
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
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
  v_order public.ordenes_compra;
  v_result jsonb;
  v_updated jsonb;
BEGIN
  SELECT * INTO v_payment
  FROM public.finance_supplier_payments
  WHERE id = p_supplier_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment not found'; END IF;
  IF p_order_id IS NOT NULL AND p_order_id <> v_payment.orden_id THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_MISMATCH: payment does not belong to order';
  END IF;
  SELECT * INTO v_order FROM public.ordenes_compra WHERE id = v_payment.orden_id;
  IF v_order.agente_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: order has no purchase agent'; END IF;

  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent',
    'agent_id', v_order.agente_id,
    'entry_mode', 'selected_payments',
    'amount_original', v_payment.amount_original,
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
      'allocated_amount_original', v_payment.amount_original
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

REVOKE ALL ON public.finance_purchase_payment_batches FROM PUBLIC, anon;
REVOKE ALL ON public.finance_purchase_payment_allocations FROM PUBLIC, anon;
GRANT SELECT ON public.finance_purchase_payment_batches TO authenticated, service_role;
GRANT SELECT ON public.finance_purchase_payment_allocations TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_purchase_payment_candidates(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_purchase_payment_batch_detail(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_payment_candidates(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_purchase_payment_batch_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.finance_purchase_payment_batches IS
  'Transferencia real e inmutable a agente o, en una futura version, proveedor.';
COMMENT ON TABLE public.finance_purchase_payment_allocations IS
  'Aplicacion many-to-many de transferencias reales a obligaciones de orden.';

COMMIT;
