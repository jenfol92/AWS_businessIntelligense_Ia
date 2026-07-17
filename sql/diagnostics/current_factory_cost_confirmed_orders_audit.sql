-- SELECT-only: compara ordenes confirmadas contra coste vigente producto+moneda.

WITH latest_current_cost AS (
  SELECT DISTINCT ON (pc.producto_id, upper(pc.costo_fabrica_moneda))
    pc.producto_id,
    upper(pc.costo_fabrica_moneda) AS moneda,
    pc.costo_fabrica_monto,
    pc.id AS producto_costo_id,
    pc.fecha
  FROM public.producto_costos pc
  WHERE pc.contenedor_id IS NULL
    AND pc.lote_producto IS NULL
  ORDER BY
    pc.producto_id,
    upper(pc.costo_fabrica_moneda),
    pc.fecha DESC NULLS LAST,
    (to_jsonb(pc)->>'created_at') DESC NULLS LAST,
    pc.id DESC
)
SELECT
  oc.id AS orden_id,
  oc.fecha_confirmacion,
  upper(oc.moneda_compra) AS moneda_orden,
  oi.id AS orden_item_id,
  oi.producto_id,
  p.sku,
  p.nombre,
  oi.coste_unitario_moneda,
  lcc.producto_costo_id,
  lcc.costo_fabrica_monto AS coste_vigente_actual,
  CASE
    WHEN oi.producto_id IS NULL THEN 'producto_inexistente'
    WHEN oi.coste_unitario_moneda IS NULL OR oi.coste_unitario_moneda <= 0 THEN 'linea_sin_coste'
    WHEN lcc.producto_costo_id IS NULL THEN 'falta_coste_vigente'
    WHEN lcc.costo_fabrica_monto IS NOT DISTINCT FROM oi.coste_unitario_moneda THEN 'coincide'
    ELSE 'importe_diferente'
  END AS clasificacion
FROM public.orden_items oi
JOIN public.ordenes_compra oc ON oc.id = oi.orden_id
LEFT JOIN public.productos p ON p.id = oi.producto_id
LEFT JOIN latest_current_cost lcc
  ON lcc.producto_id = oi.producto_id
 AND lcc.moneda = upper(oc.moneda_compra)
WHERE oc.estado IN ('confirmado', 'recibido')
ORDER BY oc.fecha_confirmacion DESC NULLS LAST, oc.id, oi.id;
