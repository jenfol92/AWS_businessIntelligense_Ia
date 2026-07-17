-- SELECT-only: duplicados vigentes por producto + moneda.
-- Criterio propuesto: conservar fecha mas reciente; desempatar por created_at si existe
-- y despues por id. No toca filas con contenedor_id o lote_producto.

WITH ranked AS (
  SELECT
    pc.producto_id,
    p.sku,
    p.nombre,
    upper(pc.costo_fabrica_moneda) AS moneda,
    pc.id,
    pc.costo_fabrica_monto AS monto,
    pc.fecha,
    pc.proveedor_id AS proveedor,
    to_jsonb(pc)->>'created_at' AS created_at,
    row_number() OVER (
      PARTITION BY pc.producto_id, upper(pc.costo_fabrica_moneda)
      ORDER BY
        pc.fecha DESC NULLS LAST,
        (to_jsonb(pc)->>'created_at') DESC NULLS LAST,
        pc.id DESC
    ) AS rn,
    count(*) OVER (
      PARTITION BY pc.producto_id, upper(pc.costo_fabrica_moneda)
    ) AS group_count
  FROM public.producto_costos pc
  LEFT JOIN public.productos p ON p.id = pc.producto_id
  WHERE pc.contenedor_id IS NULL
    AND pc.lote_producto IS NULL
)
SELECT
  producto_id,
  sku,
  nombre,
  moneda,
  id,
  monto,
  fecha,
  proveedor,
  created_at,
  CASE WHEN rn = 1 THEN 'vigente' ELSE 'duplicada_antigua' END AS propuesta
FROM ranked
WHERE group_count > 1
ORDER BY producto_id, moneda, rn;
