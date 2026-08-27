-- ══════════════════════════════════════════════════════════════════════════════
-- POST-SYNC VERIFICATION — Amazon Envíos Lifecycle
-- Ejecutar en Supabase SQL Editor DESPUÉS del sync LIVE controlado.
-- READ-ONLY. No modifica ningún dato.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO A: Snapshot post-sync (comparar contra pre-sync manual)
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  COUNT(*)                       AS post_sync_rows,
  COUNT(DISTINCT shipment_id)    AS post_sync_shipments,
  COUNT(DISTINCT estado)         AS distinct_statuses,
  MAX(imported_at)               AS latest_imported_at
FROM public.amazon_envios;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO B: Estado de todos los shipments tras el sync
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  COALESCE(estado, '(NULL)') AS estado,
  COUNT(*)                   AS rows,
  COUNT(DISTINCT shipment_id) AS shipments
FROM public.amazon_envios
GROUP BY estado
ORDER BY rows DESC;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO C: Conteos por estado conocido (para el veredicto)
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'IN_TRANSIT')     AS in_transit_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'DELIVERED')      AS delivered_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'CHECKED_IN')     AS checked_in_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'RECEIVING')      AS receiving_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'CLOSED')         AS closed_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'WORKING')        AS working_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'READY_TO_SHIP')  AS ready_to_ship_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) = 'SHIPPED')        AS shipped_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) IN (
    'CANCELLED','CANCELED','ABANDONED','DELETED','ERROR','REJECTED'
  ))                                                              AS cancelled_variant_count,
  COUNT(*) FILTER (WHERE upper(trim(estado)) NOT IN (
    'WORKING','UNCONFIRMED','DRAFT','PENDING','READY_TO_SHIP',
    'SHIPPED','IN_TRANSIT','DELIVERED','CHECKED_IN','RECEIVING',
    'CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED',
    'ERROR','REJECTED','MIXED','SPECIAL'
  ) OR estado IS NULL)                                            AS unknown_status_count
FROM public.amazon_envios;

-- Detalle de estados desconocidos (review_required debe ser true)
SELECT
  shipment_id,
  sku,
  estado          AS raw_status,
  review_required
FROM public.amazon_envios
WHERE upper(trim(estado)) NOT IN (
  'WORKING','UNCONFIRMED','DRAFT','PENDING','READY_TO_SHIP',
  'SHIPPED','IN_TRANSIT','DELIVERED','CHECKED_IN','RECEIVING',
  'CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED',
  'ERROR','REJECTED','MIXED','SPECIAL'
) OR estado IS NULL
ORDER BY shipment_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO D: Detección de shipments que existían antes y no están ahora
-- (rellenar PRE_SYNC_SHIPMENT_IDS con los IDs del snapshot manual previo)
-- ─────────────────────────────────────────────────────────────────────────────

-- Ajustar esta lista con los shipment_ids del snapshot pre-sync.
-- Si el resultado de esta query está vacío → PRE_EXISTING_SHIPMENTS_MISSING=0.
WITH pre_sync_ids (shipment_id) AS (
  VALUES
    -- Sustituir con los IDs reales del snapshot pre-sync, por ejemplo:
    -- ('FBA12345ABCD'),
    -- ('FBA67890EFGH'),
    (NULL::text)   -- placeholder: eliminar cuando se rellene con IDs reales
)
SELECT
  p.shipment_id,
  'MISSING_AFTER_SYNC' AS status
FROM pre_sync_ids p
WHERE p.shipment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.amazon_envios ae
    WHERE ae.shipment_id = p.shipment_id
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO E: Cambios de estado entre pre-sync y post-sync
-- (requiere conocer el estado previo; usar raw->>'previous_estado' si se grabó)
-- ─────────────────────────────────────────────────────────────────────────────

-- Estado actual de cada shipment (todas las líneas SKU agrupadas por shipment)
SELECT
  shipment_id,
  string_agg(DISTINCT COALESCE(estado, '(NULL)'), ', '
    ORDER BY COALESCE(estado, '(NULL)')) AS estados_actuales,
  MAX(imported_at)                        AS last_sync
FROM public.amazon_envios
GROUP BY shipment_id
ORDER BY shipment_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO F: Status history tras el sync
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  COUNT(*)                       AS post_sync_history_rows,
  COUNT(DISTINCT shipment_id)    AS shipments_with_history
FROM public.amazon_envios_status_history;

-- Todos los eventos registrados
SELECT
  shipment_id,
  previous_status,
  new_status,
  amazon_observed_at,
  synced_at,
  source
FROM public.amazon_envios_status_history
ORDER BY synced_at DESC, shipment_id;

-- Duplicados idempotentes (debe ser 0)
SELECT
  shipment_id,
  new_status,
  COALESCE(amazon_observed_at, '1970-01-01 00:00:00+00'::timestamptz) AS obs_coalesced,
  COUNT(*) AS duplicates
FROM public.amazon_envios_status_history
GROUP BY shipment_id, new_status,
  COALESCE(amazon_observed_at, '1970-01-01 00:00:00+00'::timestamptz)
HAVING COUNT(*) > 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO G: Invariante de cantidades
-- discrepancy_quantity debe ser quantity_shipped - cantidad_recibida
-- cuando ambas son conocidas. Tolerancia: 0.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  shipment_id,
  sku,
  estado,
  quantity_shipped,
  cantidad_recibida,
  quantity_expected,
  discrepancy_quantity,
  (quantity_shipped - cantidad_recibida) AS expected_discrepancy,
  ABS(discrepancy_quantity - (quantity_shipped - cantidad_recibida)) AS delta
FROM public.amazon_envios
WHERE quantity_shipped IS NOT NULL
  AND cantidad_recibida IS NOT NULL
  AND discrepancy_quantity IS NOT NULL
  AND discrepancy_quantity <> (quantity_shipped - cantidad_recibida)
ORDER BY delta DESC;

-- Resumen semántico de cantidades
SELECT
  COUNT(*) FILTER (
    WHERE quantity_shipped IS NOT NULL
      AND cantidad_recibida IS NOT NULL
      AND discrepancy_quantity IS NOT NULL
      AND discrepancy_quantity <> (quantity_shipped - cantidad_recibida)
  ) AS quantity_semantic_mismatch_rows,
  COUNT(*) FILTER (
    WHERE upper(trim(estado)) = 'RECEIVING' AND discrepancy_quantity > 0
  ) AS receiving_with_discrepancy,
  COUNT(*) FILTER (
    WHERE upper(trim(estado)) IN ('CLOSED','CANCELLED','CANCELED','ABANDONED')
      AND discrepancy_quantity > 0
  ) AS closed_with_discrepancy
FROM public.amazon_envios;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO H: Validación de fechas post-sync
-- ─────────────────────────────────────────────────────────────────────────────

-- Mismatches: shipment_year no corresponde a amazon_created_at
SELECT
  shipment_id,
  sku,
  shipment_year,
  EXTRACT(YEAR FROM amazon_created_at)::int AS year_from_created_at,
  amazon_created_at,
  amazon_last_updated_at,
  estado
FROM public.amazon_envios
WHERE amazon_created_at IS NOT NULL
  AND shipment_year IS DISTINCT FROM EXTRACT(YEAR FROM amazon_created_at)::int
ORDER BY shipment_id;

SELECT
  COUNT(*) FILTER (
    WHERE amazon_created_at IS NOT NULL
      AND shipment_year IS DISTINCT FROM EXTRACT(YEAR FROM amazon_created_at)::int
  ) AS shipment_year_mismatch_rows,
  COUNT(*) FILTER (WHERE amazon_last_updated_at IS NULL)
    AS last_updated_at_null_rows,
  COUNT(*) FILTER (WHERE amazon_created_at IS NULL)
    AS created_at_null_rows
FROM public.amazon_envios;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO I: Scope operativo simulado
-- Reglas: año actual → todos. Año anterior → no-terminal o review_required.
-- Más antiguo → sólo review_required.
-- ─────────────────────────────────────────────────────────────────────────────

WITH current_year AS (SELECT EXTRACT(YEAR FROM now())::int AS yr),
terminal_statuses AS (
  SELECT unnest(ARRAY[
    'CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED','ERROR','REJECTED'
  ]) AS s
)
SELECT
  shipment_id,
  STRING_AGG(DISTINCT sku, ', ') AS skus,
  STRING_AGG(DISTINCT estado, ', ') AS estados,
  MAX(shipment_year) AS shipment_year,
  bool_or(review_required) AS any_review_required
FROM public.amazon_envios ae
CROSS JOIN current_year cy
WHERE
  -- Año actual: todos
  ae.shipment_year = cy.yr
  OR
  -- Año anterior: no-terminal o review_required
  (
    ae.shipment_year = cy.yr - 1
    AND (
      upper(trim(ae.estado)) NOT IN (SELECT s FROM terminal_statuses)
      OR ae.review_required = true
    )
  )
  OR
  -- Más antiguo: sólo review_required
  (
    ae.shipment_year < cy.yr - 1
    AND ae.review_required = true
  )
GROUP BY shipment_id
ORDER BY MAX(shipment_year) DESC NULLS LAST, shipment_id;

SELECT
  COUNT(DISTINCT shipment_id) AS operative_shipments,
  COUNT(*) AS operative_rows
FROM (
  WITH current_year AS (SELECT EXTRACT(YEAR FROM now())::int AS yr),
  terminal_statuses AS (
    SELECT unnest(ARRAY[
      'CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED','ERROR','REJECTED'
    ]) AS s
  )
  SELECT ae.shipment_id
  FROM public.amazon_envios ae
  CROSS JOIN current_year cy
  WHERE
    ae.shipment_year = cy.yr
    OR (ae.shipment_year = cy.yr - 1
        AND (upper(trim(ae.estado)) NOT IN (SELECT s FROM terminal_statuses)
             OR ae.review_required = true))
    OR (ae.shipment_year < cy.yr - 1 AND ae.review_required = true)
) sub;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO J: Scope histórico año 2026
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  COUNT(DISTINCT shipment_id) AS history_2026_shipments,
  COUNT(*) AS history_2026_rows
FROM public.amazon_envios
WHERE shipment_year = 2026;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO K: ¿IN_TRANSIT devuelto por Amazon?
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  CASE
    WHEN COUNT(*) > 0 THEN 'YES'
    ELSE 'NO — Amazon no devolvió shipments IN_TRANSIT en esta sincronización'
  END AS in_transit_currently_returned_by_amazon,
  COUNT(DISTINCT shipment_id) AS in_transit_shipments
FROM public.amazon_envios
WHERE upper(trim(estado)) = 'IN_TRANSIT';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO L: Detalle completo post-sync por shipment/SKU
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  shipment_id,
  shipment_name,
  sku,
  estado,
  shipment_year,
  amazon_created_at,
  amazon_last_updated_at,
  quantity_shipped,
  cantidad_recibida,
  quantity_expected,
  discrepancy_quantity,
  review_required,
  imported_at AS last_synced_at
FROM public.amazon_envios
ORDER BY shipment_year DESC NULLS LAST, shipment_id, sku;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO M: Veredicto final
-- ─────────────────────────────────────────────────────────────────────────────

WITH
rows_total AS (
  SELECT COUNT(*) AS n, COUNT(DISTINCT shipment_id) AS s FROM public.amazon_envios
),
semantic_errors AS (
  SELECT COUNT(*) AS n
  FROM public.amazon_envios
  WHERE quantity_shipped IS NOT NULL
    AND cantidad_recibida IS NOT NULL
    AND discrepancy_quantity IS NOT NULL
    AND discrepancy_quantity <> (quantity_shipped - cantidad_recibida)
),
year_mismatches AS (
  SELECT COUNT(*) AS n
  FROM public.amazon_envios
  WHERE amazon_created_at IS NOT NULL
    AND shipment_year IS DISTINCT FROM EXTRACT(YEAR FROM amazon_created_at)::int
),
dup_history AS (
  SELECT COUNT(*) AS n
  FROM (
    SELECT shipment_id, new_status,
      COALESCE(amazon_observed_at, '1970-01-01 00:00:00+00'::timestamptz)
    FROM public.amazon_envios_status_history
    GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
  ) x
),
unknown_statuses AS (
  SELECT COUNT(*) AS n
  FROM public.amazon_envios
  WHERE upper(trim(estado)) NOT IN (
    'WORKING','UNCONFIRMED','DRAFT','PENDING','READY_TO_SHIP',
    'SHIPPED','IN_TRANSIT','DELIVERED','CHECKED_IN','RECEIVING',
    'CLOSED','CANCELLED','CANCELED','ABANDONED','DELETED',
    'ERROR','REJECTED','MIXED','SPECIAL'
  ) OR estado IS NULL
)
SELECT
  'POST_SYNC_ROWS'                  AS metric, (SELECT n FROM rows_total)::text AS value,
  'OK' AS status
UNION ALL
SELECT
  'POST_SYNC_SHIPMENTS',
  (SELECT s FROM rows_total)::text,
  'OK'
UNION ALL
SELECT
  'QUANTITY_SEMANTIC_MISMATCH_ROWS',
  (SELECT n FROM semantic_errors)::text,
  CASE WHEN (SELECT n FROM semantic_errors) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT
  'SHIPMENT_YEAR_MISMATCH_ROWS',
  (SELECT n FROM year_mismatches)::text,
  CASE WHEN (SELECT n FROM year_mismatches) = 0 THEN 'PASS' ELSE 'REVIEW' END
UNION ALL
SELECT
  'DUPLICATE_STATUS_HISTORY_EVENTS',
  (SELECT n FROM dup_history)::text,
  CASE WHEN (SELECT n FROM dup_history) = 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT
  'UNKNOWN_STATUS_COUNT',
  (SELECT n FROM unknown_statuses)::text,
  CASE WHEN (SELECT n FROM unknown_statuses) = 0 THEN 'OK'
       ELSE 'REVIEW — review_required should be true for each'
  END
ORDER BY metric;

-- ══════════════════════════════════════════════════════════════════════════════
-- FIN DEL SCRIPT — READ-ONLY COMPLETADO
-- ══════════════════════════════════════════════════════════════════════════════
