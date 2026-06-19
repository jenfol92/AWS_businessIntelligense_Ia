-- Diagnóstico: contenedores que deberían aparecer en Llegadas previstas
-- Ejecutar en Supabase SQL Editor.

SELECT
  c.id,
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
  count(co.orden_id) AS ordenes_vinculadas,
  CASE
    WHEN c.fecha_eta_estimada IS NULL THEN 'NO_APARECE_SIN_ETA'
    WHEN c.fecha_eta_estimada::date < current_date THEN 'NO_APARECE_ETA_PASADA'
    WHEN coalesce(c.estado_logistico, c.estado) = 'entregado' THEN 'NO_APARECE_ENTREGADO'
    ELSE 'DEBERIA_APARECER_EN_LLEGADAS'
  END AS diagnostico_llegadas
FROM public.contenedores c
LEFT JOIN public.contenedor_ordenes co ON co.contenedor_id = c.id
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
  c.puerto_llegada
ORDER BY c.fecha_eta_estimada NULLS LAST, c.identificador_embarque;
