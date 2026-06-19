-- Diagnóstico: costes históricos, líneas de orden y cabeceras (reapertura / congelación)

SELECT
  pc.producto_id,
  pc.costo_fabrica_monto,
  pc.costo_fabrica_moneda,
  pc.tipo_cambio_aplicado,
  pc.costo_fabrica_eur,
  pc.fecha,
  pc.contenedor_id
FROM public.producto_costos pc
WHERE pc.producto_id IS NOT NULL
ORDER BY pc.producto_id, pc.fecha DESC NULLS LAST;

SELECT
  oi.id,
  oi.orden_id,
  oi.producto_id,
  oi.cantidad,
  oi.coste_unitario_moneda,
  oi.coste_unitario_eur,
  oi.coste_unitario_usd
FROM public.orden_items oi
ORDER BY oi.orden_id, oi.id;

SELECT
  id,
  numero_orden,
  estado,
  moneda_compra,
  tipo_cambio_moneda_eur,
  etd,
  eta,
  fob_puerto,
  destino,
  fecha_confirmacion
FROM public.ordenes_compra
ORDER BY created_at DESC NULLS LAST;
