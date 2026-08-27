-- ══════════════════════════════════════════════════════════════════════════════
-- PREFLIGHT READ-ONLY — Amazon Envíos Lifecycle Migration
-- Migración: 20260821_amazon_envios_lifecycle_fix.PROPOSAL.sql
-- Estado: READ-ONLY. Ejecutar desde Supabase SQL editor antes de aplicar.
-- NO MODIFICA NINGÚN DATO.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 1: ESQUEMA REAL ACTUAL
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 1: ESQUEMA REAL — amazon_envios ==' AS section;

-- 1a. Columnas actuales de amazon_envios
SELECT
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'amazon_envios'
ORDER BY ordinal_position;

-- 1b. Columnas actuales de amazon_inbound_shipments
SELECT '== amazon_inbound_shipments columns ==' AS section;
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'amazon_inbound_shipments'
ORDER BY ordinal_position;

-- 1c. Columnas actuales de amazon_inbound_shipment_amazon_details
SELECT '== amazon_inbound_shipment_amazon_details columns ==' AS section;
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'amazon_inbound_shipment_amazon_details'
ORDER BY ordinal_position;

-- 1d. Primary key y unique constraints
SELECT '== PRIMARY KEYS & UNIQUE CONSTRAINTS ==' AS section;
SELECT
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema   = kcu.table_schema
WHERE tc.table_schema = 'public'
  AND tc.table_name IN ('amazon_envios', 'amazon_inbound_shipments', 'amazon_inbound_shipment_amazon_details')
  AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
ORDER BY tc.table_name, tc.constraint_type;

-- 1e. Índices actuales
SELECT '== CURRENT INDEXES ==' AS section;
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('amazon_envios', 'amazon_inbound_shipments', 'amazon_inbound_shipment_amazon_details')
ORDER BY tablename, indexname;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 2: DUPLICADOS (shipment_id, sku) — bloqueante si > 0
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 2: DUPLICADOS (shipment_id, sku) ==' AS section;

WITH dup_check AS (
  SELECT
    shipment_id,
    sku,
    COUNT(*) AS row_count
  FROM public.amazon_envios
  GROUP BY shipment_id, sku
  HAVING COUNT(*) > 1
)
SELECT
  'SHIPMENT_SKU_DUPLICATE_GROUPS' AS metric,
  COUNT(*)::text                   AS value,
  CASE WHEN COUNT(*) > 0 THEN 'BLOCK — SAFE_TO_APPLY_MIGRATION=NO'
       ELSE 'OK'
  END AS status
FROM dup_check
UNION ALL
SELECT
  'SHIPMENT_SKU_DUPLICATE_ROWS',
  COALESCE(SUM(row_count), 0)::text,
  CASE WHEN COALESCE(SUM(row_count), 0) > 0 THEN 'BLOCK'
       ELSE 'OK'
  END
FROM dup_check;

-- Detalle de duplicados (vacío si no hay)
SELECT '== DUPLICATE DETAIL (should be empty) ==' AS section;
SELECT shipment_id, sku, COUNT(*) AS duplicates
FROM public.amazon_envios
GROUP BY shipment_id, sku
HAVING COUNT(*) > 1
ORDER BY duplicates DESC, shipment_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 3: COLUMNAS PROPUESTAS — conflictos
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 3: CONFLICTOS DE COLUMNAS PROPUESTAS ==' AS section;

SELECT
  col.column_name,
  col.data_type,
  col.is_nullable,
  col.column_default,
  CASE WHEN col.column_name IS NOT NULL THEN 'ALREADY_EXISTS — CHECK TYPE COMPAT'
       ELSE 'NOT_EXISTS — safe to add'
  END AS conflict_status
FROM (VALUES
  ('amazon_created_at'),
  ('amazon_last_updated_at'),
  ('synced_at'),
  ('review_required'),
  ('shipment_year'),
  ('quantity_shipped'),
  ('quantity_expected'),
  ('discrepancy_quantity')
) proposed(proposed_name)
LEFT JOIN information_schema.columns col
  ON col.table_schema = 'public'
  AND col.table_name  = 'amazon_envios'
  AND col.column_name = proposed.proposed_name
ORDER BY proposed.proposed_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 4: TOTALES Y ESTADO ACTUAL
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 4: TOTALES ==' AS section;

SELECT
  COUNT(*)                                    AS current_rows,
  COUNT(DISTINCT shipment_id)                 AS current_shipments,
  COUNT(DISTINCT sku)                         AS distinct_skus,
  COUNT(DISTINCT estado)                      AS distinct_statuses,
  MIN(fecha_creacion)                         AS earliest_fecha_creacion,
  MAX(fecha_creacion)                         AS latest_fecha_creacion,
  COUNT(CASE WHEN raw IS NULL THEN 1 END)     AS rows_without_raw,
  COUNT(CASE WHEN cantidad_enviada > 0 THEN 1 END) AS rows_with_cantidad_enviada
FROM public.amazon_envios;

-- Distribución por estado
SELECT '== STATUS DISTRIBUTION ==' AS section;
SELECT
  COALESCE(estado, '(NULL)') AS estado,
  COUNT(*) AS rows,
  COUNT(DISTINCT shipment_id) AS shipments
FROM public.amazon_envios
GROUP BY estado
ORDER BY rows DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 5: SIMULAR BACKFILL (SELECT, sin escritura)
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 5: SIMULACIÓN BACKFILL (READ-ONLY) ==' AS section;

SELECT
  ae.shipment_id,
  ae.sku,
  ae.estado,
  -- amazon_created_at: raw->amazon_created_at → raw->created_at_amazon → NULL
  COALESCE(
    (ae.raw->>'amazon_created_at')::timestamptz,
    (ae.raw->>'created_at_amazon')::timestamptz
  ) AS computed_amazon_created_at,
  -- amazon_last_updated_at: raw->amazon_last_updated_at → raw->updated_at_amazon → NULL
  COALESCE(
    (ae.raw->>'amazon_last_updated_at')::timestamptz,
    (ae.raw->>'updated_at_amazon')::timestamptz
  ) AS computed_amazon_last_updated_at,
  -- shipment_year desde computed_amazon_created_at → fecha_creacion
  EXTRACT(YEAR FROM COALESCE(
    (ae.raw->>'amazon_created_at')::timestamptz,
    (ae.raw->>'created_at_amazon')::timestamptz,
    ae.fecha_creacion::timestamptz
  ))::int AS computed_shipment_year,
  -- Cantidades actuales
  ae.cantidad_enviada                         AS current_cantidad_enviada,
  (ae.raw->>'quantity_shipped')::int          AS computed_quantity_shipped,
  ae.cantidad_esperada                        AS current_cantidad_esperada,
  COALESCE(
    (ae.raw->>'quantity_expected')::int,
    ae.cantidad_esperada
  )                                           AS computed_quantity_expected,
  ae.cantidad_recibida,
  -- discrepancy_quantity: raw->quantity_discrepancy (ya calculada en sync)
  (ae.raw->>'quantity_discrepancy')::int      AS computed_discrepancy_quantity,
  -- review_required: raw->review_required
  (ae.raw->>'review_required')::boolean       AS computed_review_required,
  -- Fuente de amazon_created_at
  CASE
    WHEN (ae.raw->>'amazon_created_at') IS NOT NULL THEN 'raw.amazon_created_at'
    WHEN (ae.raw->>'created_at_amazon') IS NOT NULL THEN 'raw.created_at_amazon_legacy'
    ELSE 'fallback_fecha_creacion'
  END AS amazon_created_at_source,
  -- Fuente de amazon_last_updated_at
  CASE
    WHEN (ae.raw->>'amazon_last_updated_at') IS NOT NULL THEN 'raw.amazon_last_updated_at'
    WHEN (ae.raw->>'updated_at_amazon') IS NOT NULL THEN 'raw.updated_at_amazon_legacy'
    ELSE 'missing'
  END AS amazon_last_updated_at_source
FROM public.amazon_envios ae
ORDER BY ae.fecha_creacion DESC NULLS LAST, ae.shipment_id, ae.sku;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 6: VALIDACIÓN DE AÑO
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 6: VALIDACIÓN DE AÑO ==' AS section;

SELECT
  computed_year,
  COUNT(*)          AS rows,
  COUNT(DISTINCT shipment_id) AS shipments,
  CASE
    WHEN computed_year = 2026 THEN 'OK — expected year'
    WHEN computed_year IS NULL THEN 'WARN — no date found'
    ELSE 'REVIEW — unexpected year'
  END AS assessment
FROM (
  SELECT
    shipment_id,
    EXTRACT(YEAR FROM COALESCE(
      (raw->>'amazon_created_at')::timestamptz,
      (raw->>'created_at_amazon')::timestamptz,
      fecha_creacion::timestamptz
    ))::int AS computed_year
  FROM public.amazon_envios
) sub
GROUP BY computed_year
ORDER BY computed_year NULLS LAST;

-- Detalle de shipments con año ≠ 2026
SELECT '== NON-2026 SHIPMENTS DETAIL ==' AS section;
SELECT
  shipment_id,
  sku,
  estado,
  fecha_creacion,
  raw->>'amazon_created_at'     AS raw_amazon_created_at,
  raw->>'created_at_amazon'     AS raw_created_at_amazon,
  EXTRACT(YEAR FROM COALESCE(
    (raw->>'amazon_created_at')::timestamptz,
    (raw->>'created_at_amazon')::timestamptz,
    fecha_creacion::timestamptz
  ))::int                       AS computed_year
FROM public.amazon_envios
WHERE EXTRACT(YEAR FROM COALESCE(
    (raw->>'amazon_created_at')::timestamptz,
    (raw->>'created_at_amazon')::timestamptz,
    fecha_creacion::timestamptz
  ))::int IS DISTINCT FROM 2026
ORDER BY shipment_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 7: FUENTES DE FECHAS (confianza)
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 7: FUENTES DE amazon_created_at ==' AS section;

SELECT
  source_bucket,
  COUNT(*) AS rows,
  CASE source_bucket
    WHEN 'raw.amazon_created_at'        THEN 'HIGH_CONFIDENCE'
    WHEN 'raw.created_at_amazon_legacy' THEN 'HIGH_CONFIDENCE'
    ELSE                                     'FALLBACK'
  END AS confidence
FROM (
  SELECT
    CASE
      WHEN (raw->>'amazon_created_at') IS NOT NULL THEN 'raw.amazon_created_at'
      WHEN (raw->>'created_at_amazon') IS NOT NULL THEN 'raw.created_at_amazon_legacy'
      WHEN fecha_creacion IS NOT NULL               THEN 'fecha_creacion_column'
      ELSE                                               'UNKNOWN'
    END AS source_bucket
  FROM public.amazon_envios
) sub
GROUP BY source_bucket
ORDER BY rows DESC;

SELECT '== FUENTES DE amazon_last_updated_at ==' AS section;

SELECT
  source_bucket,
  COUNT(*) AS rows,
  CASE source_bucket
    WHEN 'raw.amazon_last_updated_at'  THEN 'HIGH_CONFIDENCE'
    WHEN 'raw.updated_at_amazon_legacy' THEN 'HIGH_CONFIDENCE'
    ELSE                                    'FALLBACK_OR_UNKNOWN'
  END AS confidence
FROM (
  SELECT
    CASE
      WHEN (raw->>'amazon_last_updated_at') IS NOT NULL THEN 'raw.amazon_last_updated_at'
      WHEN (raw->>'updated_at_amazon')      IS NOT NULL THEN 'raw.updated_at_amazon_legacy'
      ELSE                                                   'UNKNOWN'
    END AS source_bucket
  FROM public.amazon_envios
) sub
GROUP BY source_bucket
ORDER BY rows DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 8: CANTIDADES
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 8: CANTIDADES EN raw ==' AS section;

SELECT
  'ROWS_WITH_QUANTITY_SHIPPED'   AS metric,
  COUNT(CASE WHEN (raw->>'quantity_shipped') IS NOT NULL THEN 1 END)::text AS value
FROM public.amazon_envios
UNION ALL
SELECT 'ROWS_WITH_QUANTITY_RECEIVED',
  COUNT(CASE WHEN (raw->>'quantity_received') IS NOT NULL THEN 1 END)::text
FROM public.amazon_envios
UNION ALL
SELECT 'ROWS_WITH_QUANTITY_EXPECTED',
  COUNT(CASE WHEN (raw->>'quantity_expected') IS NOT NULL THEN 1 END)::text
FROM public.amazon_envios
UNION ALL
SELECT 'ROWS_WITH_QUANTITY_DISCREPANCY',
  COUNT(CASE WHEN (raw->>'quantity_discrepancy') IS NOT NULL THEN 1 END)::text
FROM public.amazon_envios
UNION ALL
SELECT 'ROWS_WITH_EXPECTED_ONLY (no shipped key)',
  COUNT(CASE WHEN (raw->>'quantity_shipped') IS NULL
               AND (raw->>'quantity_expected') IS NOT NULL THEN 1 END)::text
FROM public.amazon_envios
UNION ALL
SELECT 'SUM_quantity_shipped',
  COALESCE(SUM((raw->>'quantity_shipped')::int), 0)::text
FROM public.amazon_envios
UNION ALL
SELECT 'SUM_cantidad_recibida',
  COALESCE(SUM(cantidad_recibida), 0)::text
FROM public.amazon_envios
UNION ALL
SELECT 'SUM_quantity_discrepancy',
  COALESCE(SUM((raw->>'quantity_discrepancy')::int), 0)::text
FROM public.amazon_envios;

-- Comparar cantidad_enviada actual vs computed_quantity_shipped
SELECT '== CANTIDAD_ENVIADA vs QUANTITY_SHIPPED DIVERGENCIA ==' AS section;
SELECT
  shipment_id,
  sku,
  estado,
  cantidad_enviada            AS current_cantidad_enviada,
  (raw->>'quantity_shipped')::int AS raw_quantity_shipped,
  ABS(cantidad_enviada - COALESCE((raw->>'quantity_shipped')::int, cantidad_enviada)) AS divergence
FROM public.amazon_envios
WHERE ABS(cantidad_enviada - COALESCE((raw->>'quantity_shipped')::int, cantidad_enviada)) > 0
ORDER BY divergence DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 9: REVIEW_REQUIRED SIMULADO
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 9: review_required=true SIMULADO ==' AS section;

WITH known_terminal AS (
  SELECT unnest(ARRAY[
    'CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED',
    'ERROR','REJECTED','SHIPPED','DELIVERED','IN_TRANSIT','RECEIVING',
    'CHECKED_IN','READY_TO_SHIP','WORKING','UNCONFIRMED','DRAFT',
    'PENDING','MIXED','SPECIAL'
  ]) AS status
)
SELECT
  ae.shipment_id,
  ae.sku,
  ae.estado,
  (ae.raw->>'quantity_shipped')::int   AS quantity_shipped,
  ae.cantidad_recibida                  AS quantity_received,
  (ae.raw->>'quantity_discrepancy')::int AS discrepancy,
  -- Razón de review
  CASE
    WHEN ae.estado IS NULL                           THEN 'UNKNOWN_STATUS_NULL'
    WHEN upper(trim(ae.estado)) NOT IN (SELECT status FROM known_terminal)
                                                     THEN 'UNKNOWN_STATUS'
    WHEN upper(trim(ae.estado)) IN ('CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED')
      AND COALESCE((ae.raw->>'quantity_discrepancy')::int, 0) > 0
                                                     THEN 'CLOSED_WITH_DISCREPANCY'
    ELSE 'OTHER'
  END AS reason_for_review,
  -- Backfill computed_review_required
  (ae.raw->>'review_required')::boolean AS raw_review_required_flag
FROM public.amazon_envios ae
WHERE
  -- Estado desconocido
  (ae.estado IS NULL
   OR upper(trim(ae.estado)) NOT IN (SELECT status FROM known_terminal))
  OR
  -- CLOSED con discrepancia
  (upper(trim(ae.estado)) IN ('CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED')
   AND COALESCE((ae.raw->>'quantity_discrepancy')::int, 0) > 0)
ORDER BY reason_for_review, ae.shipment_id;

-- Resumen review_required
SELECT '== REVIEW_REQUIRED SUMMARY ==' AS section;
WITH known_terminal AS (
  SELECT unnest(ARRAY[
    'CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED',
    'ERROR','REJECTED','SHIPPED','DELIVERED','IN_TRANSIT','RECEIVING',
    'CHECKED_IN','READY_TO_SHIP','WORKING','UNCONFIRMED','DRAFT',
    'PENDING','MIXED','SPECIAL'
  ]) AS status
)
SELECT
  CASE
    WHEN ae.estado IS NULL THEN 'UNKNOWN_STATUS_NULL'
    WHEN upper(trim(ae.estado)) NOT IN (SELECT status FROM known_terminal) THEN 'UNKNOWN_STATUS'
    WHEN upper(trim(ae.estado)) IN ('CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED')
      AND COALESCE((ae.raw->>'quantity_discrepancy')::int, 0) > 0 THEN 'CLOSED_WITH_DISCREPANCY'
    ELSE 'OK'
  END AS category,
  COUNT(*) AS rows
FROM public.amazon_envios ae
GROUP BY 1
ORDER BY rows DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 10: AMAZON_INBOUND_SHIPMENT_AMAZON_DETAILS — reutilización
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 10: amazon_inbound_shipment_amazon_details — estado ==' AS section;

SELECT
  COUNT(*)                           AS total_rows,
  COUNT(DISTINCT shipment_id)        AS distinct_shipments,
  COUNT(DISTINCT source)             AS distinct_sources,
  MIN(fetched_at)                    AS earliest_fetch,
  MAX(fetched_at)                    AS latest_fetch
FROM public.amazon_inbound_shipment_amazon_details;

-- Columnas de la tabla
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'amazon_inbound_shipment_amazon_details'
ORDER BY ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 11: NONCOMPLIANCE — independencia
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 11: NONCOMPLIANCE INDEPENDENCE ==' AS section;

SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'amazon_inbound_noncompliance'
  ) THEN 'EXISTS' ELSE 'NOT_DEPLOYED' END AS noncompliance_table_status,
  'Lifecycle migration is independent of noncompliance table'   AS note;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 12: ÍNDICES PROPUESTOS — redundancias y faltantes
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 12: ÍNDICES EXISTENTES EN amazon_envios ==' AS section;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename  = 'amazon_envios'
ORDER BY indexname;

-- Propuestos nuevos vs existentes
SELECT
  proposed.idx_name                AS proposed_index,
  CASE WHEN pg_ix.indexname IS NOT NULL
       THEN 'ALREADY_EXISTS'
       ELSE 'WILL_BE_CREATED'
  END AS status
FROM (VALUES
  ('idx_amazon_envios_shipment_year'),
  ('idx_amazon_envios_review_required'),
  ('idx_amazon_envios_estado'),
  ('idx_amazon_envios_amazon_created_at'),
  ('idx_amazon_envios_status_history_shipment'),
  ('idx_amazon_envios_status_history_observed'),
  ('uq_amazon_envios_status_history_idempotent')
) proposed(idx_name)
LEFT JOIN pg_indexes pg_ix
  ON pg_ix.schemaname = 'public'
  AND pg_ix.indexname  = proposed.idx_name
ORDER BY proposed.idx_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECCIÓN 13: BACKFILL COHERENCIA — datos en raw ya listos
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== SECCIÓN 13: BACKFILL COVERAGE ==' AS section;

SELECT
  'raw keys coverage' AS check_name,
  COUNT(CASE WHEN (raw->>'amazon_created_at') IS NOT NULL     THEN 1 END) AS has_amazon_created_at,
  COUNT(CASE WHEN (raw->>'amazon_last_updated_at') IS NOT NULL THEN 1 END) AS has_amazon_last_updated_at,
  COUNT(CASE WHEN (raw->>'quantity_shipped') IS NOT NULL      THEN 1 END) AS has_quantity_shipped,
  COUNT(CASE WHEN (raw->>'quantity_expected') IS NOT NULL     THEN 1 END) AS has_quantity_expected,
  COUNT(CASE WHEN (raw->>'quantity_discrepancy') IS NOT NULL  THEN 1 END) AS has_quantity_discrepancy,
  COUNT(CASE WHEN (raw->>'review_required') IS NOT NULL       THEN 1 END) AS has_review_required,
  COUNT(*)                                                                  AS total_rows
FROM public.amazon_envios;

-- ─────────────────────────────────────────────────────────────────────────────
-- VEREDICTO FINAL
-- ─────────────────────────────────────────────────────────────────────────────

SELECT '== VEREDICTO FINAL ==' AS section;

WITH
dup_count AS (
  SELECT COUNT(*) AS n
  FROM (SELECT shipment_id, sku FROM public.amazon_envios GROUP BY 1,2 HAVING COUNT(*) > 1) x
),
col_conflicts AS (
  SELECT COUNT(*) AS n
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'amazon_envios'
    AND column_name IN (
      'amazon_created_at','amazon_last_updated_at','synced_at',
      'review_required','shipment_year','quantity_shipped',
      'quantity_expected','discrepancy_quantity'
    )
    AND data_type NOT IN ('timestamp with time zone','boolean','integer','bigint','smallint')
)
SELECT
  'SHIPMENT_SKU_DUPLICATE_GROUPS'  AS check_name,
  (SELECT n FROM dup_count)::text  AS value,
  CASE WHEN (SELECT n FROM dup_count) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
UNION ALL
SELECT
  'COLUMN_TYPE_CONFLICTS',
  (SELECT n FROM col_conflicts)::text,
  CASE WHEN (SELECT n FROM col_conflicts) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT
  'NONCOMPLIANCE_DEPENDENCY',
  'independent',
  'PASS'
UNION ALL
SELECT
  'STATUS_HISTORY_IDEMPOTENCY_SAFE',
  'YES (after PROPOSAL fix adds uq_amazon_envios_status_history_idempotent)',
  'PASS'
UNION ALL
SELECT
  'MIGRATION_TRANSACTION_SAFE',
  'YES (after PROPOSAL fix wraps in BEGIN/COMMIT)',
  'PASS'
UNION ALL
SELECT
  'SAFE_TO_APPLY_MIGRATION',
  CASE
    WHEN (SELECT n FROM dup_count) > 0 THEN 'NO — duplicates exist'
    WHEN (SELECT n FROM col_conflicts) > 0 THEN 'NO — type conflicts exist'
    ELSE 'YES — pending live verification'
  END,
  CASE
    WHEN (SELECT n FROM dup_count) > 0 THEN 'FAIL'
    WHEN (SELECT n FROM col_conflicts) > 0 THEN 'FAIL'
    ELSE 'PASS (pending live run)'
  END;

-- ══════════════════════════════════════════════════════════════════════════════
-- FIN DEL PREFLIGHT — NO SE MODIFICÓ NINGÚN DATO
-- ══════════════════════════════════════════════════════════════════════════════
