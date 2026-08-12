BEGIN TRANSACTION READ ONLY;

SELECT
  orders.id AS order_id,
  orders.numero_orden,
  orders.numero_pedido_agente,
  orders.fecha_confirmacion AS effective_confirmation_date,
  deposits.id AS supplier_payment_id,
  deposits.due_date AS current_due_date,
  deposits.status,
  deposits.amount_original,
  deposits.original_currency,
  deposits.created_at,
  count(allocations.id) AS allocation_count
FROM public.ordenes_compra orders
JOIN public.finance_supplier_payments deposits
  ON deposits.orden_id = orders.id
 AND deposits.payment_type = 'DEPOSITO_30'
LEFT JOIN public.finance_purchase_payment_allocations allocations
  ON allocations.supplier_payment_id = deposits.id
WHERE orders.estado = 'confirmado'
  AND orders.fecha_confirmacion IS NOT NULL
  AND deposits.due_date IS DISTINCT FROM orders.fecha_confirmacion
GROUP BY
  orders.id, orders.numero_orden, orders.numero_pedido_agente,
  orders.fecha_confirmacion, deposits.id
HAVING deposits.status IN ('pendiente', 'vencido')
   AND deposits.paid_at IS NULL
   AND deposits.actual_amount_original IS NULL
   AND deposits.actual_amount_eur IS NULL
   AND count(allocations.id) = 0
ORDER BY orders.fecha_confirmacion, orders.numero_orden;

ROLLBACK;
