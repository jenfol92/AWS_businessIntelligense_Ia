-- REVISAR ANTES DE EJECUTAR.
-- Backfill idempotente desde la orden confirmada mas reciente por producto+moneda.
-- No modifica orden_items, no crea lotes, no toca otras monedas.

BEGIN;

WITH latest_confirmed AS (
  SELECT DISTINCT ON (oi.producto_id, upper(oc.moneda_compra))
    oi.producto_id,
    upper(oc.moneda_compra) AS moneda,
    oi.proveedor_id,
    oi.coste_unitario_moneda,
    coalesce(oc.fecha_confirmacion, oc.created_at::date, CURRENT_DATE) AS fecha
  FROM public.orden_items oi
  JOIN public.ordenes_compra oc ON oc.id = oi.orden_id
  WHERE oc.estado IN ('confirmado', 'recibido')
    AND oi.producto_id IS NOT NULL
    AND oi.coste_unitario_moneda IS NOT NULL
    AND oi.coste_unitario_moneda > 0
    AND upper(oc.moneda_compra) IN ('USD', 'EUR', 'GBP', 'CNY')
  ORDER BY
    oi.producto_id,
    upper(oc.moneda_compra),
    oc.fecha_confirmacion DESC NULLS LAST,
    oc.created_at DESC NULLS LAST,
    oc.id DESC
)
SELECT count(*) AS filas_producto_moneda_que_actualizaria
FROM latest_confirmed;

WITH latest_confirmed AS (
  SELECT DISTINCT ON (oi.producto_id, upper(oc.moneda_compra))
    oi.producto_id,
    upper(oc.moneda_compra) AS moneda,
    oi.proveedor_id,
    oi.coste_unitario_moneda,
    coalesce(oc.fecha_confirmacion, oc.created_at::date, CURRENT_DATE) AS fecha
  FROM public.orden_items oi
  JOIN public.ordenes_compra oc ON oc.id = oi.orden_id
  WHERE oc.estado IN ('confirmado', 'recibido')
    AND oi.producto_id IS NOT NULL
    AND oi.coste_unitario_moneda IS NOT NULL
    AND oi.coste_unitario_moneda > 0
    AND upper(oc.moneda_compra) IN ('USD', 'EUR', 'GBP', 'CNY')
  ORDER BY
    oi.producto_id,
    upper(oc.moneda_compra),
    oc.fecha_confirmacion DESC NULLS LAST,
    oc.created_at DESC NULLS LAST,
    oc.id DESC
)
SELECT public.upsert_current_factory_cost_by_currency(
  producto_id,
  moneda,
  coste_unitario_moneda,
  proveedor_id,
  NULL,
  fecha
)
FROM latest_confirmed;

ROLLBACK;
