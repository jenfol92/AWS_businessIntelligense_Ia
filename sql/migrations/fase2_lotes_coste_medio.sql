-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 2: Lotes de producto y vista de coste medio ponderado
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Campo 'lote_producto_actual' en productos (informativo: último lote conocido)
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS lote_producto_actual text NULL;

COMMENT ON COLUMN public.productos.lote_producto_actual IS 'Último lote comprado (informativo). El histórico de lotes está en orden_items.lote_producto';

-- 2) Campo 'lote_producto' en cada línea de orden
ALTER TABLE public.orden_items
  ADD COLUMN IF NOT EXISTS lote_producto text NULL;

COMMENT ON COLUMN public.orden_items.lote_producto IS 'Código/identificador del lote comprado (se arrastra a producto_costos al facturar)';

-- 3) Campo 'lote_producto' en producto_costos para trazar qué lote generó el coste
ALTER TABLE public.producto_costos
  ADD COLUMN IF NOT EXISTS lote_producto text NULL;

COMMENT ON COLUMN public.producto_costos.lote_producto IS 'Lote asociado a este registro de coste (de orden_items)';

-- 4) Vista: coste medio ponderado por cantidades compradas con coste_unitario_total ya calculado
--    Fuente: producto_costos (solo filas con contenedor_id y costo_unitario_total_eur)
--    La ponderación usa la cantidad del orden_item asociado al lote
CREATE OR REPLACE VIEW public.v_producto_coste_medio AS
WITH lotes AS (
  SELECT
    pc.producto_id,
    pc.lote_producto,
    pc.contenedor_id,
    pc.costo_unitario_total_eur,
    pc.fecha,
    COALESCE(
      (
        SELECT SUM(oi.cantidad)
        FROM public.orden_items oi
        JOIN public.contenedor_ordenes co ON co.orden_id = oi.orden_id
        WHERE co.contenedor_id = pc.contenedor_id
          AND oi.producto_id   = pc.producto_id
          AND (pc.lote_producto IS NULL OR oi.lote_producto = pc.lote_producto)
      ),
      0
    )::numeric AS cantidad_lote
  FROM public.producto_costos pc
  WHERE pc.costo_unitario_total_eur IS NOT NULL
    AND pc.contenedor_id IS NOT NULL
)
SELECT
  producto_id,
  COUNT(*)                                                                                      AS n_lotes,
  SUM(cantidad_lote)::numeric                                                                   AS unidades_compradas_total,
  CASE
    WHEN SUM(cantidad_lote) > 0
      THEN SUM(cantidad_lote * costo_unitario_total_eur) / SUM(cantidad_lote)
    ELSE AVG(costo_unitario_total_eur)
  END                                                                                           AS coste_medio_eur,
  MIN(costo_unitario_total_eur)                                                                  AS coste_minimo_eur,
  MAX(costo_unitario_total_eur)                                                                  AS coste_maximo_eur,
  (ARRAY_AGG(costo_unitario_total_eur ORDER BY fecha DESC NULLS LAST))[1]                       AS coste_ultimo_lote_eur,
  (ARRAY_AGG(lote_producto ORDER BY fecha DESC NULLS LAST))[1]                                   AS ultimo_lote
FROM lotes
GROUP BY producto_id;

COMMENT ON VIEW public.v_producto_coste_medio IS 'Coste medio ponderado por cantidad comprada de cada lote de un producto';
