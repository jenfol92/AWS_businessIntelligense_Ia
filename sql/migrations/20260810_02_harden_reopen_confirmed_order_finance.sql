BEGIN;

CREATE OR REPLACE FUNCTION public.reopen_confirmed_purchase_order(
  p_order_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.ordenes_compra;
  v_obligation public.finance_supplier_payments;
  v_reopened public.ordenes_compra;
BEGIN
  IF NOT public.finance_can_manage_unlinked_obligations() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_order
  FROM public.ordenes_compra
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_order.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'ORDER_NOT_CONFIRMED: solo se pueden reabrir ordenes confirmadas'
      USING ERRCODE = '22023';
  END IF;

  -- Serializa la inspeccion y la retirada con cualquier settlement concurrente.
  PERFORM 1
  FROM public.finance_supplier_payments payment
  WHERE payment.orden_id = p_order_id
    AND payment.payment_type IN ('DEPOSITO_30', 'BALANCE_70')
  ORDER BY payment.id
  FOR UPDATE;

  FOR v_obligation IN
    SELECT payment.*
    FROM public.finance_supplier_payments payment
    WHERE payment.orden_id = p_order_id
      AND payment.payment_type IN ('DEPOSITO_30', 'BALANCE_70')
    ORDER BY payment.payment_type, payment.id
  LOOP
    IF v_obligation.status NOT IN ('pendiente', 'vencido')
       OR v_obligation.paid_at IS NOT NULL
       OR v_obligation.actual_amount_original IS NOT NULL
       OR v_obligation.actual_amount_eur IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.finance_purchase_payment_allocations allocation
         WHERE allocation.supplier_payment_id = v_obligation.id
       )
       OR EXISTS (
         SELECT 1
         FROM public.finance_supplier_payment_executions execution
         WHERE execution.supplier_payment_id = v_obligation.id
       ) THEN
      RAISE EXCEPTION
        'ORDER_REOPEN_BLOCKED_BY_SUPPLIER_PAYMENT: obligation_id=% payment_type=% status=%',
        v_obligation.id,
        v_obligation.payment_type,
        v_obligation.status
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  DELETE FROM public.finance_supplier_payments payment
  WHERE payment.orden_id = p_order_id
    AND payment.payment_type IN ('DEPOSITO_30', 'BALANCE_70')
    AND payment.status IN ('pendiente', 'vencido')
    AND payment.paid_at IS NULL
    AND payment.actual_amount_original IS NULL
    AND payment.actual_amount_eur IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.finance_purchase_payment_allocations allocation
      WHERE allocation.supplier_payment_id = payment.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.finance_supplier_payment_executions execution
      WHERE execution.supplier_payment_id = payment.id
    );

  IF EXISTS (
    SELECT 1
    FROM public.finance_supplier_payments payment
    WHERE payment.orden_id = p_order_id
      AND payment.payment_type IN ('DEPOSITO_30', 'BALANCE_70')
  ) THEN
    RAISE EXCEPTION 'ORDER_REOPEN_FINANCE_CLEANUP_INCOMPLETE: obligaciones de proveedor no retiradas'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ordenes_compra
  SET
    estado = 'borrador',
    fecha_confirmacion = NULL,
    notas = concat_ws(
      E'\n',
      nullif(notas, ''),
      concat(
        '[',
        to_char(now(), 'YYYY-MM-DD HH24:MI'),
        '] REAPERTURA: ',
        coalesce(nullif(trim(p_motivo), ''), 'Sin motivo indicado.')
      )
    ),
    updated_at = now()
  WHERE id = p_order_id
    AND estado = 'confirmado'
  RETURNING * INTO v_reopened;

  IF v_reopened.id IS NULL THEN
    RAISE EXCEPTION 'ORDER_REOPEN_FAILED: no se pudo devolver la orden a borrador'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_reopened;
END;
$$;

ALTER FUNCTION public.reopen_confirmed_purchase_order(uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reopen_confirmed_purchase_order(uuid, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_confirmed_purchase_order(uuid, text)
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
