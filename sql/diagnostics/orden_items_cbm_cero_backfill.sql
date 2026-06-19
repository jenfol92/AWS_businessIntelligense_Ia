-- Corregir líneas de orden con cbm_unitario = 0 cuando el producto ya tiene cubicaje en logística.
-- cbm_total es GENERATED (cantidad * cbm_unitario); ordenes_compra.cbm_total se recalcula por trigger.

-- Todas las órdenes (solo líneas con CBM congelado a 0 y producto con cubicaje > 0)
UPDATE public.orden_items oi
SET cbm_unitario = pl.cubicaje_unitario_m3
FROM public.productos p
JOIN public.producto_logistica pl ON pl.producto_id = p.id
WHERE oi.producto_id = p.id
  AND COALESCE(oi.cbm_unitario, 0) = 0
  AND pl.cubicaje_unitario_m3 IS NOT NULL
  AND pl.cubicaje_unitario_m3 > 0;

-- ORD-2026-001 — solo ZIPPY BEIGE / ZIPPY ROSA (ajustar SKUs si hace falta)
UPDATE public.orden_items oi
SET cbm_unitario = pl.cubicaje_unitario_m3
FROM public.productos p
JOIN public.producto_logistica pl ON pl.producto_id = p.id
JOIN public.ordenes_compra oc ON oc.id = oi.orden_id
WHERE oi.producto_id = p.id
  AND oc.numero_orden = 'ORD-2026-001'
  AND p.sku IN ('8436616610418', '8436616610432')
  AND COALESCE(oi.cbm_unitario, 0) = 0
  AND pl.cubicaje_unitario_m3 IS NOT NULL
  AND pl.cubicaje_unitario_m3 > 0;

-- Verificación ORD-2026-001
SELECT
  oc.numero_orden,
  p.sku,
  p.nombre,
  oi.cantidad,
  oi.cbm_unitario,
  oi.cbm_total,
  pl.cubicaje_unitario_m3 AS cbm_producto_logistica
FROM public.orden_items oi
JOIN public.ordenes_compra oc ON oc.id = oi.orden_id
JOIN public.productos p ON p.id = oi.producto_id
LEFT JOIN public.producto_logistica pl ON pl.producto_id = p.id
WHERE oc.numero_orden = 'ORD-2026-001'
  AND p.sku IN ('8436616610418', '8436616610432')
ORDER BY p.sku;
