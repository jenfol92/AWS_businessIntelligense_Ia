-- Diagnostico de ventas FBA SP-API sin producto_id.
-- No escribe datos. Ajustar params si se quiere acotar por fechas o marketplace.
--
-- Regla funcional:
--   OMITIDO_NO_VINCULADO: venta FBA sin producto ERP gestionado; se omite de Inventario/Forecast.
--   REVISAR_TWINLY: venta huerfana con patron Twinly 843661661dddd.
--   REVISAR_CANDIDATO_EXISTENTE: venta huerfana con candidato por productos.sku o producto_logistica.ean_upc.

WITH params AS (
  SELECT
    NULL::date AS start_date,
    NULL::date AS end_date,
    NULL::text[] AS marketplace_ids,
    50::integer AS top_limit
),
raw_scoped AS (
  SELECT
    r.*,
    COALESCE(NULLIF(r.ship_to_country, ''), 'UNKNOWN') AS pais,
    upper(regexp_replace(COALESCE(r.sku_original, ''), '[^A-Za-z0-9]', '', 'g')) AS sku_original_normalizado,
    upper(regexp_replace(COALESCE(r.sku_limpio, ''), '[^A-Za-z0-9]', '', 'g')) AS sku_limpio_normalizado,
    substring(COALESCE(r.sku_original, '') from '(843661661[0-9]{4})') AS ean_twinly_en_original,
    substring(COALESCE(r.sku_limpio, '') from '(843661661[0-9]{4})') AS ean_twinly_en_limpio
  FROM public.amazon_fba_sales_daily_raw r
  CROSS JOIN params p
  WHERE (p.start_date IS NULL OR r.sale_date >= p.start_date)
    AND (p.end_date IS NULL OR r.sale_date < p.end_date)
    AND (
      p.marketplace_ids IS NULL
      OR cardinality(p.marketplace_ids) = 0
      OR r.marketplace_id = ANY(p.marketplace_ids)
    )
),
orphans AS (
  SELECT *
  FROM raw_scoped
  WHERE producto_id IS NULL
),
orphan_groups AS (
  SELECT
    o.sku_original,
    o.sku_limpio,
    o.sku_original_normalizado,
    o.sku_limpio_normalizado,
    COALESCE(o.ean_twinly_en_limpio, o.ean_twinly_en_original) AS ean_twinly,
    COUNT(*) AS filas_huerfanas,
    COALESCE(SUM(COALESCE(o.quantity, 0)), 0)::integer AS unidades_huerfanas,
    MIN(o.sale_date) AS primera_fecha,
    MAX(o.sale_date) AS ultima_fecha,
    array_agg(DISTINCT o.marketplace_id ORDER BY o.marketplace_id)
      FILTER (WHERE COALESCE(o.marketplace_id, '') <> '') AS marketplace_ids,
    array_agg(DISTINCT o.pais ORDER BY o.pais) AS paises
  FROM orphans o
  GROUP BY
    o.sku_original,
    o.sku_limpio,
    o.sku_original_normalizado,
    o.sku_limpio_normalizado,
    COALESCE(o.ean_twinly_en_limpio, o.ean_twinly_en_original)
),
candidate_keys AS (
  SELECT
    g.*,
    ARRAY(
      SELECT DISTINCT key
      FROM unnest(ARRAY[
        NULLIF(g.sku_original, ''),
        NULLIF(g.sku_limpio, ''),
        NULLIF(g.sku_original_normalizado, ''),
        NULLIF(g.sku_limpio_normalizado, ''),
        NULLIF(g.ean_twinly, ''),
        NULLIF(regexp_replace(COALESCE(g.sku_original, ''), '\D', '', 'g'), ''),
        NULLIF(regexp_replace(COALESCE(g.sku_limpio, ''), '\D', '', 'g'), '')
      ]) AS key
      WHERE key IS NOT NULL
    ) AS match_keys
  FROM orphan_groups g
),
classified AS (
  SELECT
    ck.sku_original,
    ck.sku_limpio,
    ck.unidades_huerfanas,
    ck.filas_huerfanas,
    ck.primera_fecha,
    ck.ultima_fecha,
    ck.marketplace_ids,
    ck.paises,
    ck.ean_twinly,
    ck.match_keys,
    COALESCE(candidates.posible_producto_candidato, '[]'::jsonb) AS posible_producto_candidato,
    COALESCE(candidates.candidatos_encontrados, 0)::integer AS candidatos_encontrados,
    CASE
      WHEN COALESCE(candidates.candidatos_encontrados, 0) > 0
        THEN 'REVISAR_CANDIDATO_EXISTENTE'
      WHEN ck.ean_twinly IS NOT NULL
        THEN 'REVISAR_TWINLY'
      ELSE 'OMITIDO_NO_VINCULADO'
    END AS clasificacion,
    CASE
      WHEN COALESCE(candidates.candidatos_encontrados, 0) > 0
        THEN 'Existe candidato por productos.sku o producto_logistica.ean_upc; revisar mapeo antes de omitir.'
      WHEN ck.ean_twinly IS NOT NULL
        THEN 'SKU huerfano contiene patron Twinly 843661661dddd; revisar producto gestionado.'
      ELSE 'SKU sin patron Twinly ni candidato ERP; omitido conscientemente de Inventario/Forecast.'
    END AS motivo
  FROM candidate_keys ck
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS candidatos_encontrados,
      jsonb_agg(DISTINCT candidate) AS posible_producto_candidato
    FROM (
      SELECT jsonb_build_object(
        'producto_id', p.id,
        'sku', p.sku,
        'matched_by', 'productos.sku'
      ) AS candidate
      FROM public.productos p
      WHERE p.sku = ANY(ck.match_keys)

      UNION ALL

      SELECT jsonb_build_object(
        'producto_id', pn.id,
        'sku', pn.sku,
        'matched_by', 'productos.sku_normalizado'
      ) AS candidate
      FROM public.productos pn
      WHERE upper(regexp_replace(COALESCE(pn.sku, ''), '[^A-Za-z0-9]', '', 'g')) = ANY(ck.match_keys)

      UNION ALL

      SELECT jsonb_build_object(
        'producto_id', pl.producto_id,
        'ean_upc', pl.ean_upc,
        'matched_by', 'producto_logistica.ean_upc'
      ) AS candidate
      FROM public.producto_logistica pl
      WHERE pl.ean_upc = ANY(ck.match_keys)

      UNION ALL

      SELECT jsonb_build_object(
        'producto_id', pln.producto_id,
        'ean_upc', pln.ean_upc,
        'matched_by', 'producto_logistica.ean_upc_normalizado'
      ) AS candidate
      FROM public.producto_logistica pln
      WHERE upper(regexp_replace(COALESCE(pln.ean_upc, ''), '[^A-Za-z0-9]', '', 'g')) = ANY(ck.match_keys)
    ) found
  ) candidates ON true
)
SELECT
  '00_resumen_omitidos' AS seccion,
  jsonb_build_object(
    'total_filas_raw_fba', COUNT(*),
    'total_unidades_raw_fba', COALESCE(SUM(COALESCE(quantity, 0)), 0),
    'total_huerfanos', COUNT(*) FILTER (WHERE producto_id IS NULL),
    'unidades_huerfanas', COALESCE(SUM(COALESCE(quantity, 0)) FILTER (WHERE producto_id IS NULL), 0),
    'huerfanos_con_patron_twinly_843661661dddd', COUNT(*) FILTER (
      WHERE producto_id IS NULL
        AND (
          ean_twinly_en_original IS NOT NULL
          OR ean_twinly_en_limpio IS NOT NULL
        )
    ),
    'huerfanos_sin_patron_twinly', COUNT(*) FILTER (
      WHERE producto_id IS NULL
        AND ean_twinly_en_original IS NULL
        AND ean_twinly_en_limpio IS NULL
    )
  ) AS resultado
FROM raw_scoped

UNION ALL

SELECT
  '01_resumen_clasificacion' AS seccion,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'clasificacion', clasificacion,
        'skus', skus,
        'filas_huerfanas', filas_huerfanas,
        'unidades_huerfanas', unidades_huerfanas,
        'candidatos_encontrados', candidatos_encontrados
      )
      ORDER BY clasificacion
    ),
    '[]'::jsonb
  ) AS resultado
FROM (
  SELECT
    clasificacion,
    COUNT(*) AS skus,
    SUM(filas_huerfanas)::integer AS filas_huerfanas,
    SUM(unidades_huerfanas)::integer AS unidades_huerfanas,
    SUM(candidatos_encontrados)::integer AS candidatos_encontrados
  FROM classified
  GROUP BY clasificacion
) x

UNION ALL

SELECT
  '02_marketplace_pais_afectados' AS seccion,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'marketplace_id', marketplace_id,
        'pais', pais,
        'filas_huerfanas', filas_huerfanas,
        'unidades_huerfanas', unidades_huerfanas
      )
      ORDER BY unidades_huerfanas DESC, marketplace_id, pais
    ),
    '[]'::jsonb
  ) AS resultado
FROM (
  SELECT
    marketplace_id,
    pais,
    COUNT(*) AS filas_huerfanas,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS unidades_huerfanas
  FROM orphans
  GROUP BY marketplace_id, pais
) x

UNION ALL

SELECT
  '03_top_sku_original_huerfanos' AS seccion,
  COALESCE(
    jsonb_agg(to_jsonb(x) ORDER BY unidades_huerfanas DESC, filas_huerfanas DESC),
    '[]'::jsonb
  ) AS resultado
FROM (
  SELECT
    sku_original,
    clasificacion,
    COUNT(*) AS grupos_sku,
    SUM(filas_huerfanas)::integer AS filas_huerfanas,
    SUM(unidades_huerfanas)::integer AS unidades_huerfanas,
    MIN(primera_fecha) AS primera_fecha,
    MAX(ultima_fecha) AS ultima_fecha
  FROM classified
  GROUP BY sku_original, clasificacion
  ORDER BY unidades_huerfanas DESC, filas_huerfanas DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '04_top_sku_limpio_huerfanos' AS seccion,
  COALESCE(
    jsonb_agg(to_jsonb(x) ORDER BY unidades_huerfanas DESC, filas_huerfanas DESC),
    '[]'::jsonb
  ) AS resultado
FROM (
  SELECT
    sku_limpio,
    clasificacion,
    COUNT(*) AS grupos_sku,
    SUM(filas_huerfanas)::integer AS filas_huerfanas,
    SUM(unidades_huerfanas)::integer AS unidades_huerfanas,
    MIN(primera_fecha) AS primera_fecha,
    MAX(ultima_fecha) AS ultima_fecha
  FROM classified
  GROUP BY sku_limpio, clasificacion
  ORDER BY unidades_huerfanas DESC, filas_huerfanas DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '05_detalle_revisables' AS seccion,
  COALESCE(
    jsonb_agg(to_jsonb(x) ORDER BY unidades_huerfanas DESC, filas_huerfanas DESC),
    '[]'::jsonb
  ) AS resultado
FROM (
  SELECT
    sku_original,
    sku_limpio,
    clasificacion,
    unidades_huerfanas,
    filas_huerfanas,
    primera_fecha,
    ultima_fecha,
    marketplace_ids,
    paises,
    ean_twinly,
    posible_producto_candidato,
    motivo
  FROM classified
  WHERE clasificacion IN ('REVISAR_TWINLY', 'REVISAR_CANDIDATO_EXISTENTE')
  ORDER BY unidades_huerfanas DESC, filas_huerfanas DESC
  LIMIT (SELECT top_limit FROM params)
) x;

-- SQL resumido para ver omitidos conscientemente.
WITH params AS (
  SELECT
    NULL::date AS start_date,
    NULL::date AS end_date,
    NULL::text[] AS marketplace_ids
),
raw_scoped AS (
  SELECT
    r.*,
    substring(COALESCE(r.sku_original, '') from '(843661661[0-9]{4})') AS ean_twinly_en_original,
    substring(COALESCE(r.sku_limpio, '') from '(843661661[0-9]{4})') AS ean_twinly_en_limpio
  FROM public.amazon_fba_sales_daily_raw r
  CROSS JOIN params p
  WHERE (p.start_date IS NULL OR r.sale_date >= p.start_date)
    AND (p.end_date IS NULL OR r.sale_date < p.end_date)
    AND (
      p.marketplace_ids IS NULL
      OR cardinality(p.marketplace_ids) = 0
      OR r.marketplace_id = ANY(p.marketplace_ids)
    )
)
SELECT
  'OMITIDO_NO_VINCULADO' AS clasificacion,
  COUNT(*) AS filas,
  COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS unidades
FROM raw_scoped
WHERE producto_id IS NULL
  AND ean_twinly_en_original IS NULL
  AND ean_twinly_en_limpio IS NULL;

-- Vista tabular principal para investigacion manual.
WITH params AS (
  SELECT
    NULL::date AS start_date,
    NULL::date AS end_date,
    NULL::text[] AS marketplace_ids
),
raw_scoped AS (
  SELECT
    r.*,
    COALESCE(NULLIF(r.ship_to_country, ''), 'UNKNOWN') AS pais,
    upper(regexp_replace(COALESCE(r.sku_original, ''), '[^A-Za-z0-9]', '', 'g')) AS sku_original_normalizado,
    upper(regexp_replace(COALESCE(r.sku_limpio, ''), '[^A-Za-z0-9]', '', 'g')) AS sku_limpio_normalizado,
    substring(COALESCE(r.sku_original, '') from '(843661661[0-9]{4})') AS ean_twinly_en_original,
    substring(COALESCE(r.sku_limpio, '') from '(843661661[0-9]{4})') AS ean_twinly_en_limpio
  FROM public.amazon_fba_sales_daily_raw r
  CROSS JOIN params p
  WHERE (p.start_date IS NULL OR r.sale_date >= p.start_date)
    AND (p.end_date IS NULL OR r.sale_date < p.end_date)
    AND (
      p.marketplace_ids IS NULL
      OR cardinality(p.marketplace_ids) = 0
      OR r.marketplace_id = ANY(p.marketplace_ids)
    )
    AND r.producto_id IS NULL
),
grouped AS (
  SELECT
    sku_original,
    sku_limpio,
    sku_original_normalizado,
    sku_limpio_normalizado,
    COALESCE(ean_twinly_en_limpio, ean_twinly_en_original) AS ean_twinly,
    COUNT(*) AS filas_huerfanas,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS unidades_huerfanas,
    MIN(sale_date) AS primera_fecha,
    MAX(sale_date) AS ultima_fecha,
    array_agg(DISTINCT marketplace_id ORDER BY marketplace_id)
      FILTER (WHERE COALESCE(marketplace_id, '') <> '') AS marketplace_id,
    array_agg(DISTINCT pais ORDER BY pais) AS pais
  FROM raw_scoped
  GROUP BY
    sku_original,
    sku_limpio,
    sku_original_normalizado,
    sku_limpio_normalizado,
    COALESCE(ean_twinly_en_limpio, ean_twinly_en_original)
),
keys AS (
  SELECT
    g.*,
    ARRAY(
      SELECT DISTINCT key
      FROM unnest(ARRAY[
        NULLIF(g.sku_original, ''),
        NULLIF(g.sku_limpio, ''),
        NULLIF(g.sku_original_normalizado, ''),
        NULLIF(g.sku_limpio_normalizado, ''),
        NULLIF(g.ean_twinly, ''),
        NULLIF(regexp_replace(COALESCE(g.sku_original, ''), '\D', '', 'g'), ''),
        NULLIF(regexp_replace(COALESCE(g.sku_limpio, ''), '\D', '', 'g'), '')
      ]) AS key
      WHERE key IS NOT NULL
    ) AS match_keys
  FROM grouped g
),
classified AS (
  SELECT
    k.*,
    COALESCE(candidates.posible_producto_candidato, '[]'::jsonb) AS posible_producto_candidato,
    COALESCE(candidates.candidatos_encontrados, 0)::integer AS candidatos_encontrados,
    CASE
      WHEN COALESCE(candidates.candidatos_encontrados, 0) > 0
        THEN 'REVISAR_CANDIDATO_EXISTENTE'
      WHEN k.ean_twinly IS NOT NULL
        THEN 'REVISAR_TWINLY'
      ELSE 'OMITIDO_NO_VINCULADO'
    END AS clasificacion
  FROM keys k
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS candidatos_encontrados,
      jsonb_agg(DISTINCT candidate) AS posible_producto_candidato
    FROM (
      SELECT jsonb_build_object('producto_id', p.id, 'sku', p.sku, 'matched_by', 'productos.sku') AS candidate
      FROM public.productos p
      WHERE p.sku = ANY(k.match_keys)
      UNION ALL
      SELECT jsonb_build_object('producto_id', pn.id, 'sku', pn.sku, 'matched_by', 'productos.sku_normalizado') AS candidate
      FROM public.productos pn
      WHERE upper(regexp_replace(COALESCE(pn.sku, ''), '[^A-Za-z0-9]', '', 'g')) = ANY(k.match_keys)
      UNION ALL
      SELECT jsonb_build_object('producto_id', pl.producto_id, 'ean_upc', pl.ean_upc, 'matched_by', 'producto_logistica.ean_upc') AS candidate
      FROM public.producto_logistica pl
      WHERE pl.ean_upc = ANY(k.match_keys)
      UNION ALL
      SELECT jsonb_build_object('producto_id', pln.producto_id, 'ean_upc', pln.ean_upc, 'matched_by', 'producto_logistica.ean_upc_normalizado') AS candidate
      FROM public.producto_logistica pln
      WHERE upper(regexp_replace(COALESCE(pln.ean_upc, ''), '[^A-Za-z0-9]', '', 'g')) = ANY(k.match_keys)
    ) found
  ) candidates ON true
)
SELECT
  sku_original,
  sku_limpio,
  unidades_huerfanas,
  filas_huerfanas,
  primera_fecha,
  ultima_fecha,
  marketplace_id,
  pais,
  clasificacion,
  posible_producto_candidato,
  CASE
    WHEN clasificacion = 'REVISAR_CANDIDATO_EXISTENTE'
      THEN 'Existe candidato por productos.sku o producto_logistica.ean_upc.'
    WHEN clasificacion = 'REVISAR_TWINLY'
      THEN 'SKU huerfano contiene patron Twinly 843661661dddd.'
    ELSE 'SKU sin patron Twinly ni candidato ERP; omitido conscientemente.'
  END AS motivo
FROM classified
ORDER BY
  CASE clasificacion
    WHEN 'REVISAR_CANDIDATO_EXISTENTE' THEN 1
    WHEN 'REVISAR_TWINLY' THEN 2
    ELSE 3
  END,
  unidades_huerfanas DESC,
  filas_huerfanas DESC,
  sku_original;
