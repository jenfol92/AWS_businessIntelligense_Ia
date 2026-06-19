-- Diagnóstico: vínculos contenedor↔orden y criterio de aparición en Llegadas previstas
-- Ejecutar en Supabase SQL Editor o psql contra la BD del proyecto.

SELECT
  c.id AS contenedor_id,
  c.identificador_embarque,
  c.fecha_salida,
  c.fecha_eta_estimada,
  c.fecha_eta_estimada::date AS eta_date,
  current_date AS today,
  c.estado,
  c.estado_logistico,
  c.estado_stock,
  c.estado_costes,
  c.tipo_contenedor,
  c.transitario,
  c.puerto_salida,
  c.puerto_llegada,
  co.orden_id,
  oc.numero_orden,
  count(oi.id) AS total_lineas,
  CASE
    WHEN c.fecha_eta_estimada IS NULL THEN 'NO_APARECE_SIN_ETA'
    WHEN c.fecha_eta_estimada::date < current_date THEN 'NO_APARECE_ETA_PASADA'
    WHEN coalesce(c.estado_logistico, c.estado) = 'entregado' THEN 'NO_APARECE_ENTREGADO'
    ELSE 'DEBERIA_APARECER_EN_LLEGADAS'
  END AS diagnostico_llegadas,
  CASE
    WHEN co.orden_id IS NULL THEN 'SIN_ORDEN_VINCULADA'
    WHEN count(oi.id) = 0 THEN 'ORDEN_SIN_LINEAS'
    ELSE 'ORDEN_VINCULADA_OK'
  END AS diagnostico_orden
FROM public.contenedores c
LEFT JOIN public.contenedor_ordenes co ON co.contenedor_id = c.id
LEFT JOIN public.ordenes_compra oc ON oc.id = co.orden_id
LEFT JOIN public.orden_items oi ON oi.orden_id = oc.id
GROUP BY
  c.id,
  c.identificador_embarque,
  c.fecha_salida,
  c.fecha_eta_estimada,
  c.estado,
  c.estado_logistico,
  c.estado_stock,
  c.estado_costes,
  c.tipo_contenedor,
  c.transitario,
  c.puerto_salida,
  c.puerto_llegada,
  co.orden_id,
  oc.numero_orden
ORDER BY c.fecha_eta_estimada NULLS LAST, c.identificador_embarque;
