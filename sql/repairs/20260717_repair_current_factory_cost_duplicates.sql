-- REVISAR ANTES DE EJECUTAR.
-- Elimina solo filas vigentes antiguas duplicadas del mismo producto + moneda.
-- No toca filas con contenedor_id o lote_producto.

BEGIN;

WITH ranked AS (
  SELECT
    pc.id,
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
  WHERE pc.contenedor_id IS NULL
    AND pc.lote_producto IS NULL
),
to_delete AS (
  SELECT id
  FROM ranked
  WHERE group_count > 1
    AND rn > 1
)
SELECT count(*) AS filas_que_eliminaria
FROM to_delete;

-- Ejecutar solo tras revisar que el conteo anterior es el esperado.
WITH ranked AS (
  SELECT
    pc.id,
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
  WHERE pc.contenedor_id IS NULL
    AND pc.lote_producto IS NULL
),
to_delete AS (
  SELECT id
  FROM ranked
  WHERE group_count > 1
    AND rn > 1
)
DELETE FROM public.producto_costos pc
USING to_delete d
WHERE pc.id = d.id
  AND pc.contenedor_id IS NULL
  AND pc.lote_producto IS NULL
RETURNING pc.id, pc.producto_id, pc.costo_fabrica_moneda, pc.fecha;

ROLLBACK;
