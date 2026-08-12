-- Candidato de reparación. Deliberadamente termina en ROLLBACK.
-- No convertir a COMMIT hasta revisar el precheck y autorizar expresamente la reparación.
BEGIN;

CREATE TEMP TABLE candidate_deposit_due_date_repairs ON COMMIT DROP AS
SELECT
  deposits.id AS supplier_payment_id,
  orders.id AS order_id,
  orders.fecha_confirmacion AS target_due_date
FROM public.ordenes_compra orders
JOIN public.finance_supplier_payments deposits
  ON deposits.orden_id = orders.id
 AND deposits.payment_type = 'DEPOSITO_30'
WHERE orders.estado = 'confirmado'
  AND orders.fecha_confirmacion IS NOT NULL
  AND deposits.due_date IS DISTINCT FROM orders.fecha_confirmacion
  AND deposits.status IN ('pendiente', 'vencido')
  AND deposits.paid_at IS NULL
  AND deposits.actual_amount_original IS NULL
  AND deposits.actual_amount_eur IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.finance_purchase_payment_allocations allocation
    WHERE allocation.supplier_payment_id = deposits.id
  );

SELECT
  candidate.order_id,
  orders.numero_orden,
  orders.numero_pedido_agente,
  deposits.due_date AS previous_due_date,
  candidate.target_due_date,
  deposits.status
FROM candidate_deposit_due_date_repairs candidate
JOIN public.ordenes_compra orders ON orders.id = candidate.order_id
JOIN public.finance_supplier_payments deposits ON deposits.id = candidate.supplier_payment_id
ORDER BY candidate.target_due_date, orders.numero_orden;

UPDATE public.finance_supplier_payments deposits
SET
  due_date = candidate.target_due_date,
  status = CASE
    WHEN candidate.target_due_date < CURRENT_DATE THEN 'vencido'
    ELSE 'pendiente'
  END,
  updated_at = now()
FROM candidate_deposit_due_date_repairs candidate
WHERE deposits.id = candidate.supplier_payment_id
  AND deposits.due_date IS DISTINCT FROM candidate.target_due_date
  AND deposits.status IN ('pendiente', 'vencido')
  AND deposits.paid_at IS NULL
  AND deposits.actual_amount_original IS NULL
  AND deposits.actual_amount_eur IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.finance_purchase_payment_allocations allocation
    WHERE allocation.supplier_payment_id = deposits.id
  );

SELECT count(*) AS remaining_safe_mismatches
FROM candidate_deposit_due_date_repairs candidate
JOIN public.finance_supplier_payments deposits ON deposits.id = candidate.supplier_payment_id
WHERE deposits.due_date IS DISTINCT FROM candidate.target_due_date;

ROLLBACK;
