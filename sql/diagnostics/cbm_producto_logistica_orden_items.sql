-- Diagnóstico CBM: medidas y cubicaje GENERATED en producto_logistica
-- Esperado ROCKY (8436616610470): largo=26, ancho=13.5, alto=75, peso=4.6, cbm≈0.026325
SELECT
  p.sku,
  p.nombre,
  pl.largo_cm,
  pl.ancho_cm,
  pl.alto_cm,
  pl.peso_kg_bruto,
  pl.cubicaje_unitario_m3
FROM public.productos p
LEFT JOIN public.producto_logistica pl ON pl.producto_id = p.id
WHERE p.sku = '8436616610470';

-- Diagnóstico CBM: líneas de orden vs logística del producto
SELECT
  oi.id,
  oi.orden_id,
  oi.producto_id,
  p.sku,
  p.nombre,
  oi.cantidad,
  oi.cbm_unitario,
  oi.cbm_total,
  pl.cubicaje_unitario_m3 AS cbm_producto_logistica
FROM public.orden_items oi
JOIN public.productos p ON p.id = oi.producto_id
LEFT JOIN public.producto_logistica pl ON pl.producto_id = p.id
WHERE p.sku = '8436616610470'
ORDER BY oi.created_at DESC
LIMIT 20;
