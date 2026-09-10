-- Diagnóstico post-migración Amazon Envíos Lifecycle.
-- Solo lectura: consultas de datos y catálogos PostgreSQL.
-- Ejecutar el archivo completo en Supabase SQL Editor.

-- ============================================================================
-- 01. ESQUEMA: detalle de las columnas esperadas
-- ============================================================================
WITH expected_columns (
  column_name,
  expected_type,
  expected_nullable,
  expected_default
) AS (
  VALUES
    ('amazon_created_at',        'timestamp with time zone', true,  NULL::text),
    ('amazon_last_updated_at',   'timestamp with time zone', true,  NULL::text),
    ('synced_at',                'timestamp with time zone', true,  NULL::text),
    ('review_required',          'boolean',                  false, 'false'),
    ('shipment_year',            'integer',                  true,  NULL::text),
    ('quantity_shipped',         'integer',                  true,  NULL::text),
    ('quantity_expected',        'integer',                  true,  NULL::text),
    ('discrepancy_quantity',     'integer',                  true,  NULL::text)
),
actual_columns AS (
  SELECT
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS actual_type,
    NOT a.attnotnull AS actual_nullable,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS actual_default
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c
    ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid
   AND ad.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'amazon_envios'
    AND a.attnum > 0
    AND NOT a.attisdropped
),
column_checks AS (
  SELECT
    e.column_name,
    e.expected_type,
    a.actual_type,
    e.expected_nullable,
    a.actual_nullable,
    e.expected_default,
    a.actual_default,
    (
      a.column_name IS NOT NULL
      AND a.actual_type = e.expected_type
      AND a.actual_nullable = e.expected_nullable
      AND (
        (e.expected_default IS NULL AND a.actual_default IS NULL)
        OR (
          e.expected_default = 'false'
          AND lower(regexp_replace(COALESCE(a.actual_default, ''), '\s+', '', 'g'))
              IN ('false', 'false::boolean')
        )
      )
    ) AS column_ok
  FROM expected_columns e
  LEFT JOIN actual_columns a USING (column_name)
)
SELECT
  '01_SCHEMA_COLUMN_DETAIL' AS block,
  column_name,
  expected_type,
  actual_type,
  expected_nullable,
  actual_nullable,
  expected_default,
  actual_default,
  CASE WHEN column_ok THEN 'YES' ELSE 'NO' END AS column_ok
FROM column_checks
ORDER BY column_name;

WITH expected_columns (
  column_name,
  expected_type,
  expected_nullable,
  expected_default
) AS (
  VALUES
    ('amazon_created_at',        'timestamp with time zone', true,  NULL::text),
    ('amazon_last_updated_at',   'timestamp with time zone', true,  NULL::text),
    ('synced_at',                'timestamp with time zone', true,  NULL::text),
    ('review_required',          'boolean',                  false, 'false'),
    ('shipment_year',            'integer',                  true,  NULL::text),
    ('quantity_shipped',         'integer',                  true,  NULL::text),
    ('quantity_expected',        'integer',                  true,  NULL::text),
    ('discrepancy_quantity',     'integer',                  true,  NULL::text)
),
actual_columns AS (
  SELECT
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS actual_type,
    NOT a.attnotnull AS actual_nullable,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS actual_default
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c
    ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid
   AND ad.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'amazon_envios'
    AND a.attnum > 0
    AND NOT a.attisdropped
),
checks AS (
  SELECT
    (
      a.column_name IS NOT NULL
      AND a.actual_type = e.expected_type
      AND a.actual_nullable = e.expected_nullable
      AND (
        (e.expected_default IS NULL AND a.actual_default IS NULL)
        OR (
          e.expected_default = 'false'
          AND lower(regexp_replace(COALESCE(a.actual_default, ''), '\s+', '', 'g'))
              IN ('false', 'false::boolean')
        )
      )
    ) AS column_ok
  FROM expected_columns e
  LEFT JOIN actual_columns a USING (column_name)
)
SELECT
  '01_SCHEMA_SUMMARY' AS block,
  'AMAZON_ENVIOS_COLUMNS_OK' AS metric,
  CASE WHEN bool_and(column_ok) AND count(*) = 8 THEN 'YES' ELSE 'NO' END AS value
FROM checks;

-- ============================================================================
-- 02. FILAS Y SHIPMENTS
-- ============================================================================
SELECT
  '02_ROWS_AND_SHIPMENTS' AS block,
  count(*) AS "ROWS_AFTER",
  count(DISTINCT shipment_id) AS "SHIPMENTS_AFTER"
FROM public.amazon_envios;

SELECT
  '02_COUNTS_BY_SHIPMENT_YEAR' AS block,
  shipment_year,
  count(*) AS rows,
  count(DISTINCT shipment_id) AS shipments
FROM public.amazon_envios
GROUP BY shipment_year
ORDER BY shipment_year NULLS LAST;

SELECT
  '02_COUNTS_BY_STATUS' AS block,
  COALESCE(NULLIF(upper(trim(estado)), ''), '<NULL_OR_EMPTY>') AS estado,
  count(*) AS rows,
  count(DISTINCT shipment_id) AS shipments
FROM public.amazon_envios
GROUP BY COALESCE(NULLIF(upper(trim(estado)), ''), '<NULL_OR_EMPTY>')
ORDER BY rows DESC, estado;

-- ============================================================================
-- 03. BACKFILL
-- ============================================================================
SELECT
  '03_BACKFILL_SUMMARY' AS block,
  count(*) FILTER (
    WHERE amazon_created_at IS NULL
  ) AS "AMAZON_CREATED_AT_NULL_ROWS",
  count(*) FILTER (
    WHERE amazon_last_updated_at IS NULL
  ) AS "AMAZON_LAST_UPDATED_AT_NULL_ROWS",
  count(*) FILTER (
    WHERE quantity_shipped IS NULL
  ) AS "QUANTITY_SHIPPED_NULL_ROWS",
  count(*) FILTER (
    WHERE quantity_expected IS NULL
  ) AS "QUANTITY_EXPECTED_NULL_ROWS",
  count(*) FILTER (
    WHERE review_required IS TRUE
  ) AS "REVIEW_REQUIRED_ROWS"
FROM public.amazon_envios;

SELECT
  '03_BACKFILL_PROBLEM_DETAIL' AS block,
  id,
  shipment_id,
  sku,
  estado,
  amazon_created_at,
  amazon_last_updated_at,
  shipment_year,
  quantity_shipped,
  cantidad_recibida,
  quantity_expected,
  discrepancy_quantity,
  review_required,
  array_to_string(
    array_remove(
      ARRAY[
        CASE WHEN amazon_created_at IS NULL THEN 'AMAZON_CREATED_AT_NULL' END,
        CASE WHEN amazon_last_updated_at IS NULL THEN 'AMAZON_LAST_UPDATED_AT_NULL' END,
        CASE WHEN quantity_shipped IS NULL THEN 'QUANTITY_SHIPPED_NULL' END,
        CASE WHEN quantity_expected IS NULL THEN 'QUANTITY_EXPECTED_NULL' END,
        CASE WHEN review_required IS TRUE THEN 'REVIEW_REQUIRED' END
      ],
      NULL
    ),
    ','
  ) AS diagnostic_flags
FROM public.amazon_envios
WHERE amazon_created_at IS NULL
   OR amazon_last_updated_at IS NULL
   OR quantity_shipped IS NULL
   OR quantity_expected IS NULL
   OR review_required IS TRUE
ORDER BY shipment_id, sku;

-- ============================================================================
-- 04. FECHAS: fuente derivable y confianza por cada fila
-- ============================================================================
WITH classified AS (
  SELECT
    e.*,
    CASE
      WHEN e.amazon_created_at IS NULL THEN 'UNKNOWN'
      WHEN NULLIF(e.raw->>'amazon_created_at', '') IS NOT NULL
        THEN 'RAW_AMAZON_CREATED_AT'
      WHEN NULLIF(e.raw->>'created_at_amazon', '') IS NOT NULL
        THEN 'RAW_CREATED_AT_AMAZON_LEGACY'
      ELSE 'DIRECT_COLUMN_OR_UNPROVEN_SOURCE'
    END AS amazon_created_at_source,
    CASE
      WHEN e.amazon_created_at IS NULL THEN 'UNKNOWN'
      WHEN NULLIF(e.raw->>'amazon_created_at', '') IS NOT NULL
        THEN 'HIGH_CONFIDENCE'
      WHEN NULLIF(e.raw->>'created_at_amazon', '') IS NOT NULL
        THEN 'FALLBACK'
      ELSE 'UNKNOWN'
    END AS amazon_created_at_confidence,
    CASE
      WHEN e.amazon_last_updated_at IS NULL THEN 'UNKNOWN'
      WHEN NULLIF(e.raw->>'amazon_last_updated_at', '') IS NOT NULL
        THEN 'RAW_AMAZON_LAST_UPDATED_AT'
      WHEN NULLIF(e.raw->>'updated_at_amazon', '') IS NOT NULL
        THEN 'RAW_UPDATED_AT_AMAZON_LEGACY'
      ELSE 'DIRECT_COLUMN_OR_UNPROVEN_SOURCE'
    END AS amazon_last_updated_at_source,
    CASE
      WHEN e.amazon_last_updated_at IS NULL THEN 'UNKNOWN'
      WHEN NULLIF(e.raw->>'amazon_last_updated_at', '') IS NOT NULL
        THEN 'HIGH_CONFIDENCE'
      WHEN NULLIF(e.raw->>'updated_at_amazon', '') IS NOT NULL
        THEN 'FALLBACK'
      ELSE 'UNKNOWN'
    END AS amazon_last_updated_at_confidence
  FROM public.amazon_envios e
)
SELECT
  '04_DATE_SOURCE_PER_ROW' AS block,
  id,
  shipment_id,
  sku,
  amazon_created_at,
  amazon_created_at_source,
  amazon_created_at_confidence,
  amazon_last_updated_at,
  amazon_last_updated_at_source,
  amazon_last_updated_at_confidence
FROM classified
ORDER BY shipment_id, sku;

WITH classified AS (
  SELECT
    CASE
      WHEN amazon_created_at IS NULL THEN 'UNKNOWN'
      WHEN NULLIF(raw->>'amazon_created_at', '') IS NOT NULL THEN 'HIGH_CONFIDENCE'
      WHEN NULLIF(raw->>'created_at_amazon', '') IS NOT NULL THEN 'FALLBACK'
      ELSE 'UNKNOWN'
    END AS confidence
  FROM public.amazon_envios
)
SELECT
  '04_AMAZON_CREATED_AT_SOURCE_COUNTS' AS block,
  confidence,
  count(*) AS rows
FROM classified
GROUP BY confidence
ORDER BY confidence;

WITH classified AS (
  SELECT
    CASE
      WHEN amazon_last_updated_at IS NULL THEN 'UNKNOWN'
      WHEN NULLIF(raw->>'amazon_last_updated_at', '') IS NOT NULL THEN 'HIGH_CONFIDENCE'
      WHEN NULLIF(raw->>'updated_at_amazon', '') IS NOT NULL THEN 'FALLBACK'
      ELSE 'UNKNOWN'
    END AS confidence
  FROM public.amazon_envios
)
SELECT
  '04_AMAZON_LAST_UPDATED_AT_SOURCE_COUNTS' AS block,
  confidence,
  count(*) AS rows
FROM classified
GROUP BY confidence
ORDER BY confidence;

-- ============================================================================
-- 05. SHIPMENT_YEAR
-- ============================================================================
SELECT
  '05_SHIPMENT_YEAR_COUNTS' AS block,
  shipment_year,
  count(*) AS rows,
  count(DISTINCT shipment_id) AS shipments
FROM public.amazon_envios
GROUP BY shipment_year
ORDER BY shipment_year NULLS LAST;

SELECT DISTINCT
  '05_NON_2026_SHIPMENT_DETAIL' AS block,
  shipment_id,
  estado,
  amazon_created_at,
  amazon_last_updated_at,
  shipment_year
FROM public.amazon_envios
WHERE shipment_year IS DISTINCT FROM 2026
ORDER BY shipment_year NULLS LAST, shipment_id, estado;

SELECT
  '05_SHIPMENT_YEAR_QUALITY' AS block,
  count(*) FILTER (WHERE shipment_year IS NULL) AS shipment_year_null_rows,
  count(*) FILTER (
    WHERE amazon_created_at IS NOT NULL
      AND shipment_year IS DISTINCT FROM
          extract(year FROM amazon_created_at)::integer
  ) AS shipment_year_mismatch_rows,
  count(*) FILTER (WHERE shipment_year IS DISTINCT FROM 2026) AS non_2026_rows
FROM public.amazon_envios;

-- ============================================================================
-- 06. CANTIDADES
-- ============================================================================
SELECT
  '06_QUANTITY_TOTALS' AS block,
  COALESCE(sum(quantity_shipped), 0) AS "SUM_QUANTITY_SHIPPED",
  COALESCE(sum(cantidad_recibida), 0) AS "SUM_QUANTITY_RECEIVED",
  COALESCE(sum(quantity_expected), 0) AS "SUM_QUANTITY_EXPECTED",
  COALESCE(sum(discrepancy_quantity), 0) AS "SUM_DISCREPANCY"
FROM public.amazon_envios;

SELECT
  '06_QUANTITY_BY_SHIPMENT' AS block,
  shipment_id,
  COALESCE(sum(quantity_shipped), 0) AS quantity_shipped,
  COALESCE(sum(cantidad_recibida), 0) AS cantidad_recibida,
  COALESCE(sum(quantity_expected), 0) AS quantity_expected,
  COALESCE(sum(discrepancy_quantity), 0) AS discrepancy_quantity,
  COALESCE(
    string_agg(
      DISTINCT COALESCE(NULLIF(upper(trim(estado)), ''), '<NULL_OR_EMPTY>'),
      ', '
      ORDER BY COALESCE(NULLIF(upper(trim(estado)), ''), '<NULL_OR_EMPTY>')
    ),
    '<NO_STATUS>'
  ) AS estado,
  bool_or(review_required) AS review_required,
  count(*) AS rows
FROM public.amazon_envios
GROUP BY shipment_id
ORDER BY shipment_id;

SELECT
  '06_QUANTITY_QUALITY' AS block,
  count(*) FILTER (WHERE quantity_shipped IS NULL) AS shipped_null_rows,
  count(*) FILTER (WHERE quantity_expected IS NULL) AS expected_null_rows,
  count(*) FILTER (WHERE cantidad_recibida IS NULL) AS received_null_rows,
  count(*) FILTER (WHERE discrepancy_quantity IS NULL) AS discrepancy_null_rows,
  count(*) FILTER (
    WHERE quantity_shipped < 0
       OR quantity_expected < 0
       OR cantidad_recibida < 0
  ) AS negative_quantity_rows,
  count(*) FILTER (
    WHERE quantity_shipped IS NOT NULL
      AND cantidad_recibida IS NOT NULL
      AND discrepancy_quantity IS NOT NULL
      AND discrepancy_quantity <> quantity_shipped - cantidad_recibida
  ) AS discrepancy_mismatch_rows
FROM public.amazon_envios;

-- ============================================================================
-- 07. REVIEW REQUIRED
-- UNKNOWN_STATUS y CLOSED_WITH_DISCREPANCY son clasificaciones derivadas.
-- OTHER no confirma una incidencia.
-- ============================================================================
SELECT
  '07_REVIEW_REQUIRED_DETAIL' AS block,
  id,
  shipment_id,
  sku,
  estado,
  quantity_shipped,
  cantidad_recibida,
  quantity_expected,
  discrepancy_quantity,
  amazon_created_at,
  amazon_last_updated_at,
  CASE
    WHEN COALESCE(NULLIF(upper(trim(estado)), ''), '<UNKNOWN>') NOT IN (
      'WORKING',
      'READY_TO_SHIP',
      'SHIPPED',
      'IN_TRANSIT',
      'DELIVERED',
      'CHECKED_IN',
      'RECEIVING',
      'CLOSED',
      'CANCELLED',
      'DELETED',
      'ERROR'
    ) THEN 'UNKNOWN_STATUS'
    WHEN upper(trim(estado)) = 'CLOSED'
      AND COALESCE(
        discrepancy_quantity,
        quantity_shipped - cantidad_recibida,
        0
      ) <> 0
      THEN 'CLOSED_WITH_DISCREPANCY'
    ELSE 'OTHER'
  END AS derived_review_reason,
  'REVIEW_SIGNAL_ONLY_NOT_CONFIRMED_ISSUE' AS interpretation
FROM public.amazon_envios
WHERE review_required IS TRUE
ORDER BY shipment_id, sku;

SELECT
  '07_REVIEW_REASON_COUNTS' AS block,
  derived_review_reason,
  count(*) AS rows,
  count(DISTINCT shipment_id) AS shipments
FROM (
  SELECT
    shipment_id,
    CASE
      WHEN COALESCE(NULLIF(upper(trim(estado)), ''), '<UNKNOWN>') NOT IN (
        'WORKING',
        'READY_TO_SHIP',
        'SHIPPED',
        'IN_TRANSIT',
        'DELIVERED',
        'CHECKED_IN',
        'RECEIVING',
        'CLOSED',
        'CANCELLED',
        'DELETED',
        'ERROR'
      ) THEN 'UNKNOWN_STATUS'
      WHEN upper(trim(estado)) = 'CLOSED'
        AND COALESCE(
          discrepancy_quantity,
          quantity_shipped - cantidad_recibida,
          0
        ) <> 0
        THEN 'CLOSED_WITH_DISCREPANCY'
      ELSE 'OTHER'
    END AS derived_review_reason
  FROM public.amazon_envios
  WHERE review_required IS TRUE
) classified
GROUP BY derived_review_reason
ORDER BY derived_review_reason;

-- ============================================================================
-- 08. STATUS HISTORY: objetos y definición idempotente
-- ============================================================================
SELECT
  '08_STATUS_HISTORY_OBJECTS' AS block,
  CASE
    WHEN to_regclass('public.amazon_envios_status_history') IS NOT NULL
      THEN 'YES'
    ELSE 'NO'
  END AS "STATUS_HISTORY_TABLE_PRESENT",
  CASE
    WHEN to_regclass(
      'public.uq_amazon_envios_status_history_idempotent'
    ) IS NOT NULL
      THEN 'YES'
    ELSE 'NO'
  END AS "STATUS_HISTORY_IDEMPOTENT_INDEX_PRESENT";

SELECT
  '08_STATUS_HISTORY_IDEMPOTENT_INDEX_DEFINITION' AS block,
  n.nspname AS schema_name,
  c.relname AS index_name,
  pg_catalog.pg_get_indexdef(c.oid) AS exact_definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n
  ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'uq_amazon_envios_status_history_idempotent'
  AND c.relkind = 'i';

-- ============================================================================
-- 09. ÍNDICES: inventario real y cobertura de los esperados
-- ============================================================================
SELECT
  '09_REAL_INDEXES' AS block,
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'amazon_envios',
    'amazon_envios_status_history'
  )
ORDER BY tablename, indexname;

WITH expected_indexes (table_name, index_name) AS (
  VALUES
    ('amazon_envios', 'idx_amazon_envios_shipment_year'),
    ('amazon_envios', 'idx_amazon_envios_review_required'),
    ('amazon_envios', 'idx_amazon_envios_estado'),
    ('amazon_envios', 'idx_amazon_envios_amazon_created_at'),
    (
      'amazon_envios_status_history',
      'idx_amazon_envios_status_history_shipment'
    ),
    (
      'amazon_envios_status_history',
      'idx_amazon_envios_status_history_observed'
    ),
    (
      'amazon_envios_status_history',
      'uq_amazon_envios_status_history_idempotent'
    )
)
SELECT
  '09_EXPECTED_INDEXES' AS block,
  e.table_name,
  e.index_name,
  CASE WHEN p.indexname IS NOT NULL THEN 'YES' ELSE 'NO' END AS present,
  p.indexdef AS exact_definition
FROM expected_indexes e
LEFT JOIN pg_catalog.pg_indexes p
  ON p.schemaname = 'public'
 AND p.tablename = e.table_name
 AND p.indexname = e.index_name
ORDER BY e.table_name, e.index_name;

-- ============================================================================
-- 10. DUPLICADOS
-- SHIPMENT_SKU_DUPLICATE_ROWS mide filas excedentes sobre una fila por clave.
-- ============================================================================
WITH duplicate_groups AS (
  SELECT
    shipment_id,
    sku,
    count(*) AS rows_in_group
  FROM public.amazon_envios
  GROUP BY shipment_id, sku
  HAVING count(*) > 1
)
SELECT
  '10_SHIPMENT_SKU_DUPLICATE_SUMMARY' AS block,
  count(*) AS "SHIPMENT_SKU_DUPLICATE_GROUPS",
  COALESCE(sum(rows_in_group - 1), 0) AS "SHIPMENT_SKU_DUPLICATE_ROWS",
  COALESCE(sum(rows_in_group), 0) AS total_rows_in_duplicate_groups
FROM duplicate_groups;

SELECT
  '10_SHIPMENT_SKU_DUPLICATE_DETAIL' AS block,
  shipment_id,
  sku,
  count(*) AS rows_in_group,
  array_agg(id ORDER BY id) AS row_ids
FROM public.amazon_envios
GROUP BY shipment_id, sku
HAVING count(*) > 1
ORDER BY shipment_id, sku;

WITH duplicate_groups AS (
  SELECT
    shipment_id,
    new_status,
    COALESCE(
      amazon_observed_at,
      '1970-01-01 00:00:00+00'::timestamptz
    ) AS idempotent_observed_at,
    count(*) AS rows_in_group
  FROM public.amazon_envios_status_history
  GROUP BY
    shipment_id,
    new_status,
    COALESCE(
      amazon_observed_at,
      '1970-01-01 00:00:00+00'::timestamptz
    )
  HAVING count(*) > 1
)
SELECT
  '10_STATUS_HISTORY_DUPLICATE_SUMMARY' AS block,
  count(*) AS history_duplicate_groups,
  COALESCE(sum(rows_in_group - 1), 0) AS history_duplicate_rows,
  COALESCE(sum(rows_in_group), 0) AS total_rows_in_duplicate_groups
FROM duplicate_groups;

SELECT
  '10_STATUS_HISTORY_DUPLICATE_DETAIL' AS block,
  shipment_id,
  new_status,
  COALESCE(
    amazon_observed_at,
    '1970-01-01 00:00:00+00'::timestamptz
  ) AS idempotent_observed_at,
  count(*) AS rows_in_group,
  array_agg(id ORDER BY id) AS row_ids
FROM public.amazon_envios_status_history
GROUP BY
  shipment_id,
  new_status,
  COALESCE(
    amazon_observed_at,
    '1970-01-01 00:00:00+00'::timestamptz
  )
HAVING count(*) > 1
ORDER BY shipment_id, new_status, idempotent_observed_at;

-- ============================================================================
-- 11. SOPORTE DEL READ MODEL
-- OPERATIVE: año actual, más carryover anterior no terminal o en revisión.
-- HISTORY: año explícito 2026.
-- ============================================================================
WITH params AS (
  SELECT extract(year FROM current_date)::integer AS current_year
),
operative_scope AS (
  SELECT e.*
  FROM public.amazon_envios e
  CROSS JOIN params p
  WHERE e.shipment_year = p.current_year
     OR (
       (e.shipment_year IS NULL OR e.shipment_year < p.current_year)
       AND (
         e.review_required IS TRUE
         OR COALESCE(NULLIF(upper(trim(e.estado)), ''), '<UNKNOWN>') NOT IN (
           'CLOSED',
           'CANCELLED',
           'DELETED',
           'ERROR'
         )
       )
     )
)
SELECT
  '11_OPERATIVE_SCOPE' AS block,
  count(*) AS "OPERATIVE_SCOPE_ROWS",
  count(DISTINCT shipment_id) AS "OPERATIVE_SCOPE_SHIPMENTS"
FROM operative_scope;

WITH operative_scope AS (
  SELECT e.*
  FROM public.amazon_envios e
  WHERE e.shipment_year = extract(year FROM current_date)::integer
     OR (
       (
         e.shipment_year IS NULL
         OR e.shipment_year < extract(year FROM current_date)::integer
       )
       AND (
         e.review_required IS TRUE
         OR COALESCE(NULLIF(upper(trim(e.estado)), ''), '<UNKNOWN>') NOT IN (
           'CLOSED',
           'CANCELLED',
           'DELETED',
           'ERROR'
         )
       )
     )
)
SELECT
  '11_OPERATIVE_SCOPE_DETAIL' AS block,
  shipment_id,
  sku,
  estado,
  shipment_year,
  amazon_created_at,
  amazon_last_updated_at,
  review_required
FROM operative_scope
ORDER BY shipment_year NULLS FIRST, shipment_id, sku;

WITH history_2026 AS (
  SELECT *
  FROM public.amazon_envios
  WHERE shipment_year = 2026
)
SELECT
  '11_HISTORY_2026_SCOPE' AS block,
  count(*) AS "HISTORY_2026_ROWS",
  count(DISTINCT shipment_id) AS "HISTORY_2026_SHIPMENTS"
FROM history_2026;

-- ============================================================================
-- 12. PRESERVACIÓN
-- Sin snapshot anterior no se puede inferir pérdida histórica.
-- ============================================================================
SELECT
  '12_PRESERVATION' AS block,
  'SHIPMENTS_LOST_AFTER_MIGRATION' AS metric,
  'UNKNOWN' AS value,
  'NO_PRE_MIGRATION_SNAPSHOT_AVAILABLE' AS reason;

-- ============================================================================
-- 13. VEREDICTO FINAL
-- SAFE queda en YES únicamente cuando todos los requisitos bloqueantes pasan.
-- ============================================================================
WITH
expected_columns (
  column_name,
  expected_type,
  expected_nullable,
  expected_default
) AS (
  VALUES
    ('amazon_created_at',        'timestamp with time zone', true,  NULL::text),
    ('amazon_last_updated_at',   'timestamp with time zone', true,  NULL::text),
    ('synced_at',                'timestamp with time zone', true,  NULL::text),
    ('review_required',          'boolean',                  false, 'false'),
    ('shipment_year',            'integer',                  true,  NULL::text),
    ('quantity_shipped',         'integer',                  true,  NULL::text),
    ('quantity_expected',        'integer',                  true,  NULL::text),
    ('discrepancy_quantity',     'integer',                  true,  NULL::text)
),
actual_columns AS (
  SELECT
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS actual_type,
    NOT a.attnotnull AS actual_nullable,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS actual_default
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c
    ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n
    ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef ad
    ON ad.adrelid = a.attrelid
   AND ad.adnum = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname = 'amazon_envios'
    AND a.attnum > 0
    AND NOT a.attisdropped
),
schema_stats AS (
  SELECT
    count(*) = 8
    AND bool_and(
      a.column_name IS NOT NULL
      AND a.actual_type = e.expected_type
      AND a.actual_nullable = e.expected_nullable
      AND (
        (e.expected_default IS NULL AND a.actual_default IS NULL)
        OR (
          e.expected_default = 'false'
          AND lower(regexp_replace(COALESCE(a.actual_default, ''), '\s+', '', 'g'))
              IN ('false', 'false::boolean')
        )
      )
    ) AS columns_ok
  FROM expected_columns e
  LEFT JOIN actual_columns a USING (column_name)
),
date_stats AS (
  SELECT
    count(*) FILTER (WHERE amazon_created_at IS NULL) AS created_null_rows,
    count(*) FILTER (
      WHERE amazon_last_updated_at IS NULL
    ) AS updated_null_rows,
    count(*) FILTER (
      WHERE amazon_created_at IS NOT NULL
        AND NULLIF(raw->>'amazon_created_at', '') IS NULL
        AND NULLIF(raw->>'created_at_amazon', '') IS NOT NULL
    ) AS created_fallback_rows,
    count(*) FILTER (
      WHERE amazon_created_at IS NOT NULL
        AND NULLIF(raw->>'amazon_created_at', '') IS NULL
        AND NULLIF(raw->>'created_at_amazon', '') IS NULL
    ) AS created_unknown_source_rows,
    count(*) FILTER (
      WHERE amazon_last_updated_at IS NOT NULL
        AND NULLIF(raw->>'amazon_last_updated_at', '') IS NULL
        AND NULLIF(raw->>'updated_at_amazon', '') IS NOT NULL
    ) AS updated_fallback_rows,
    count(*) FILTER (
      WHERE amazon_last_updated_at IS NOT NULL
        AND NULLIF(raw->>'amazon_last_updated_at', '') IS NULL
        AND NULLIF(raw->>'updated_at_amazon', '') IS NULL
    ) AS updated_unknown_source_rows
  FROM public.amazon_envios
),
quantity_stats AS (
  SELECT
    count(*) FILTER (WHERE quantity_shipped IS NULL) AS shipped_null_rows,
    count(*) FILTER (WHERE quantity_expected IS NULL) AS expected_null_rows,
    count(*) FILTER (WHERE cantidad_recibida IS NULL) AS received_null_rows,
    count(*) FILTER (
      WHERE discrepancy_quantity IS NULL
    ) AS discrepancy_null_rows,
    count(*) FILTER (
      WHERE quantity_shipped < 0
         OR quantity_expected < 0
         OR cantidad_recibida < 0
    ) AS negative_quantity_rows,
    count(*) FILTER (
      WHERE quantity_shipped IS NOT NULL
        AND cantidad_recibida IS NOT NULL
        AND discrepancy_quantity IS NOT NULL
        AND discrepancy_quantity <> quantity_shipped - cantidad_recibida
    ) AS discrepancy_mismatch_rows
  FROM public.amazon_envios
),
year_stats AS (
  SELECT
    count(*) FILTER (WHERE shipment_year IS NULL) AS null_year_rows,
    count(*) FILTER (
      WHERE amazon_created_at IS NOT NULL
        AND shipment_year IS DISTINCT FROM
            extract(year FROM amazon_created_at)::integer
    ) AS mismatch_year_rows,
    count(*) FILTER (
      WHERE shipment_year IS DISTINCT FROM 2026
    ) AS non_2026_rows
  FROM public.amazon_envios
),
shipment_duplicate_stats AS (
  SELECT
    count(*) AS shipment_duplicate_groups,
    COALESCE(sum(rows_in_group - 1), 0) AS shipment_duplicate_rows
  FROM (
    SELECT count(*) AS rows_in_group
    FROM public.amazon_envios
    GROUP BY shipment_id, sku
    HAVING count(*) > 1
  ) duplicate_keys
),
history_duplicate_stats AS (
  SELECT count(*) AS history_duplicate_groups
  FROM (
    SELECT
      shipment_id,
      new_status,
      COALESCE(
        amazon_observed_at,
        '1970-01-01 00:00:00+00'::timestamptz
      )
    FROM public.amazon_envios_status_history
    GROUP BY
      shipment_id,
      new_status,
      COALESCE(
        amazon_observed_at,
        '1970-01-01 00:00:00+00'::timestamptz
      )
    HAVING count(*) > 1
  ) duplicate_keys
),
object_stats AS (
  SELECT
    to_regclass(
      'public.amazon_envios_status_history'
    ) IS NOT NULL AS history_table_present,
    to_regclass(
      'public.uq_amazon_envios_status_history_idempotent'
    ) IS NOT NULL AS history_index_present,
    (
      SELECT count(*) = 7
      FROM (
        VALUES
          ('amazon_envios', 'idx_amazon_envios_shipment_year'),
          ('amazon_envios', 'idx_amazon_envios_review_required'),
          ('amazon_envios', 'idx_amazon_envios_estado'),
          ('amazon_envios', 'idx_amazon_envios_amazon_created_at'),
          (
            'amazon_envios_status_history',
            'idx_amazon_envios_status_history_shipment'
          ),
          (
            'amazon_envios_status_history',
            'idx_amazon_envios_status_history_observed'
          ),
          (
            'amazon_envios_status_history',
            'uq_amazon_envios_status_history_idempotent'
          )
      ) expected(table_name, index_name)
      JOIN pg_catalog.pg_indexes p
        ON p.schemaname = 'public'
       AND p.tablename = expected.table_name
       AND p.indexname = expected.index_name
    ) AS all_expected_indexes_present
),
scope_stats AS (
  SELECT
    count(*) FILTER (
      WHERE shipment_year = extract(year FROM current_date)::integer
         OR (
           (
             shipment_year IS NULL
             OR shipment_year < extract(year FROM current_date)::integer
           )
           AND (
             review_required IS TRUE
             OR COALESCE(NULLIF(upper(trim(estado)), ''), '<UNKNOWN>') NOT IN (
               'CLOSED',
               'CANCELLED',
               'DELETED',
               'ERROR'
             )
           )
         )
    ) AS operative_rows,
    count(DISTINCT shipment_id) FILTER (
      WHERE shipment_year = extract(year FROM current_date)::integer
         OR (
           (
             shipment_year IS NULL
             OR shipment_year < extract(year FROM current_date)::integer
           )
           AND (
             review_required IS TRUE
             OR COALESCE(NULLIF(upper(trim(estado)), ''), '<UNKNOWN>') NOT IN (
               'CLOSED',
               'CANCELLED',
               'DELETED',
               'ERROR'
             )
           )
         )
    ) AS operative_shipments,
    count(*) FILTER (WHERE shipment_year = 2026) AS history_2026_rows,
    count(DISTINCT shipment_id) FILTER (
      WHERE shipment_year = 2026
    ) AS history_2026_shipments
  FROM public.amazon_envios
),
all_stats AS (
  SELECT *
  FROM schema_stats
  CROSS JOIN date_stats
  CROSS JOIN quantity_stats
  CROSS JOIN year_stats
  CROSS JOIN shipment_duplicate_stats
  CROSS JOIN history_duplicate_stats
  CROSS JOIN object_stats
  CROSS JOIN scope_stats
),
checks AS (
  SELECT
    1 AS sort_order,
    'AMAZON_ENVIOS_COLUMNS_OK'::text AS check_name,
    CASE WHEN columns_ok THEN 'YES' ELSE 'NO' END AS value,
    CASE WHEN columns_ok THEN 'PASS' ELSE 'FAIL' END AS result
  FROM all_stats

  UNION ALL

  SELECT
    2,
    'SHIPMENT_SKU_DUPLICATE_GROUPS',
    shipment_duplicate_groups::text,
    CASE
      WHEN shipment_duplicate_groups = 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM all_stats

  UNION ALL

  SELECT
    3,
    'STATUS_HISTORY_TABLE_PRESENT',
    CASE WHEN history_table_present THEN 'YES' ELSE 'NO' END,
    CASE WHEN history_table_present THEN 'PASS' ELSE 'FAIL' END
  FROM all_stats

  UNION ALL

  SELECT
    4,
    'STATUS_HISTORY_IDEMPOTENT_INDEX_PRESENT',
    CASE WHEN history_index_present THEN 'YES' ELSE 'NO' END,
    CASE WHEN history_index_present THEN 'PASS' ELSE 'FAIL' END
  FROM all_stats

  UNION ALL

  SELECT
    5,
    'BACKFILL_DATE_QUALITY',
    format(
      'created_null=%s; updated_null=%s; created_fallback=%s; '
      'created_unknown=%s; updated_fallback=%s; updated_unknown=%s',
      created_null_rows,
      updated_null_rows,
      created_fallback_rows,
      created_unknown_source_rows,
      updated_fallback_rows,
      updated_unknown_source_rows
    ),
    CASE
      WHEN created_null_rows > 0 OR updated_null_rows > 0 THEN 'FAIL'
      WHEN created_fallback_rows > 0
        OR updated_fallback_rows > 0
        OR created_unknown_source_rows > 0
        OR updated_unknown_source_rows > 0
        THEN 'WARN'
      ELSE 'PASS'
    END
  FROM all_stats

  UNION ALL

  SELECT
    6,
    'BACKFILL_QUANTITY_QUALITY',
    format(
      'shipped_null=%s; expected_null=%s; received_null=%s; '
      'discrepancy_null=%s; negative=%s; discrepancy_mismatch=%s',
      shipped_null_rows,
      expected_null_rows,
      received_null_rows,
      discrepancy_null_rows,
      negative_quantity_rows,
      discrepancy_mismatch_rows
    ),
    CASE
      WHEN shipped_null_rows > 0
        OR expected_null_rows > 0
        OR received_null_rows > 0
        OR negative_quantity_rows > 0
        OR discrepancy_mismatch_rows > 0
        THEN 'FAIL'
      WHEN discrepancy_null_rows > 0 THEN 'WARN'
      ELSE 'PASS'
    END
  FROM all_stats

  UNION ALL

  SELECT
    7,
    'SHIPMENT_YEAR_QUALITY',
    format(
      'null=%s; mismatch_vs_created=%s; non_2026=%s',
      null_year_rows,
      mismatch_year_rows,
      non_2026_rows
    ),
    CASE
      WHEN null_year_rows = 0 AND mismatch_year_rows = 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM all_stats

  UNION ALL

  SELECT
    8,
    'OPERATIVE_SCOPE_DATA_AVAILABLE',
    format(
      'rows=%s; shipments=%s',
      operative_rows,
      operative_shipments
    ),
    CASE
      WHEN operative_rows > 0 AND operative_shipments > 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM all_stats

  UNION ALL

  SELECT
    9,
    'HISTORY_SCOPE_DATA_AVAILABLE',
    format(
      'rows=%s; shipments=%s',
      history_2026_rows,
      history_2026_shipments
    ),
    CASE
      WHEN history_2026_rows > 0 AND history_2026_shipments > 0 THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM all_stats

  UNION ALL

  SELECT
    10,
    'SHIPMENTS_LOST_AFTER_MIGRATION',
    'UNKNOWN',
    'INFO'
  FROM all_stats

  UNION ALL

  SELECT
    11,
    'SAFE_FOR_CONTROLLED_LIVE_RECONCILIATION',
    CASE
      WHEN columns_ok
        AND shipment_duplicate_groups = 0
        AND history_table_present
        AND history_index_present
        AND history_duplicate_groups = 0
        AND all_expected_indexes_present
        AND created_null_rows = 0
        AND updated_null_rows = 0
        AND shipped_null_rows = 0
        AND expected_null_rows = 0
        AND received_null_rows = 0
        AND negative_quantity_rows = 0
        AND discrepancy_mismatch_rows = 0
        AND null_year_rows = 0
        AND mismatch_year_rows = 0
        AND operative_rows > 0
        AND operative_shipments > 0
        AND history_2026_rows > 0
        AND history_2026_shipments > 0
        THEN 'YES'
      ELSE 'NO'
    END,
    CASE
      WHEN columns_ok
        AND shipment_duplicate_groups = 0
        AND history_table_present
        AND history_index_present
        AND history_duplicate_groups = 0
        AND all_expected_indexes_present
        AND created_null_rows = 0
        AND updated_null_rows = 0
        AND shipped_null_rows = 0
        AND expected_null_rows = 0
        AND received_null_rows = 0
        AND negative_quantity_rows = 0
        AND discrepancy_mismatch_rows = 0
        AND null_year_rows = 0
        AND mismatch_year_rows = 0
        AND operative_rows > 0
        AND operative_shipments > 0
        AND history_2026_rows > 0
        AND history_2026_shipments > 0
        THEN 'PASS'
      ELSE 'FAIL'
    END
  FROM all_stats
)
SELECT
  '13_FINAL_VERDICT' AS block,
  check_name,
  value,
  result
FROM checks
ORDER BY sort_order;
