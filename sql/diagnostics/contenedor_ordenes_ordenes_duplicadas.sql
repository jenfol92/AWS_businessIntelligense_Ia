-- Diagnóstico: órdenes vinculadas a más de un contenedor
-- Ejecutar antes de aplicar contenedor_ordenes_unique_orden_id.sql

SELECT
  orden_id,
  count(*) AS veces_vinculada,
  array_agg(contenedor_id) AS contenedores
FROM public.contenedor_ordenes
GROUP BY orden_id
HAVING count(*) > 1;
