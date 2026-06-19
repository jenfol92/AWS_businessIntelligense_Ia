-- Diagnóstico: contenedores en rango de llegadas y estado visual
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
  c.tipo_contenedor,
  c.puerto_salida,
  c.puerto_llegada,
  count(co.orden_id) AS ordenes_vinculadas,
  CASE
    WHEN coalesce(c.estado_logistico, c.estado) = 'entregado'
      THEN 'ENTREGADO'
    WHEN c.fecha_eta_estimada::date < current_date
      THEN 'PENDIENTE_ATRASADO'
    ELSE 'PENDIENTE'
  END AS estado_llegada_visual
FROM public.contenedores c
LEFT JOIN public.contenedor_ordenes co ON co.contenedor_id = c.id
WHERE c.fecha_eta_estimada IS NOT NULL
GROUP BY
  c.id,
  c.identificador_embarque,
  c.fecha_salida,
  c.fecha_eta_estimada,
  c.estado,
  c.estado_logistico,
  c.tipo_contenedor,
  c.puerto_salida,
  c.puerto_llegada
ORDER BY c.fecha_eta_estimada ASC;
