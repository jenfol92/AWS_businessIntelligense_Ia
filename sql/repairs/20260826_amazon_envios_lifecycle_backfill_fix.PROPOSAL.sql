-- PROPUESTA — corrección del backfill lifecycle de Amazon Envíos.
-- NO APLICADA.
--
-- Precondición obligatoria:
--   Ejecutar y revisar primero:
--   sql/diagnostics/amazon_envios_lifecycle_backfill_raw_readonly.sql
--
-- Garantías:
--   1. Solo completa columnas actualmente NULL.
--   2. No sustituye valores lifecycle existentes.
--   3. No usa imported_at como fecha Amazon.
--   4. No usa quantity_expected como sustituto de QuantityShipped.
--   5. No usa raw.item.quantity: en el flujo v2024 legacy los items de plan
--      podían asociarse a más de un shipment y no prueban atribución individual.
--   6. Es idempotente porque una segunda ejecución no cambia columnas completas.
--   7. Toda la operación es atómica.
--
-- Rollback:
--   - Ensayo: sustituir COMMIT por ROLLBACK.
--   - Antes de una ejecución real, exportar el bloque 07_SIMULATION_DETAIL del
--     diagnóstico como preimagen con id y columnas actuales.
--   - Tras COMMIT no existe un rollback inferible seguro: para restaurar, usar
--     exclusivamente esa preimagen o PITR. No poner columnas a NULL por patrón,
--     porque una sincronización concurrente podría haber escrito datos válidos.

BEGIN;

WITH candidates AS (
  SELECT
    e.id,
    e.amazon_created_at,
    e.amazon_last_updated_at,
    e.quantity_shipped,
    e.quantity_expected,
    e.discrepancy_quantity,
    COALESCE(
      e.amazon_created_at,
      created_candidate.value::timestamptz,
      e.fecha_creacion::timestamptz
    ) AS proposed_amazon_created_at,
    COALESCE(
      e.amazon_last_updated_at,
      updated_candidate.value::timestamptz
    ) AS proposed_amazon_last_updated_at,
    COALESCE(
      e.quantity_shipped,
      shipped_candidate.value::integer
    ) AS proposed_quantity_shipped,
    COALESCE(
      e.quantity_expected,
      expected_candidate.value::integer,
      e.cantidad_esperada
    ) AS proposed_quantity_expected,
    COALESCE(
      e.cantidad_recibida,
      received_candidate.value::integer
    ) AS resolved_quantity_received,
    discrepancy_candidate.value::integer AS raw_discrepancy_candidate
  FROM public.amazon_envios e
  LEFT JOIN LATERAL (
    SELECT value
    FROM (
      VALUES
        (1, e.raw->>'amazon_created_at'),
        (2, e.raw->>'created_at_amazon'),
        (3, e.raw#>>'{shipment,createdAt}'),
        (4, e.raw#>>'{shipment,created_at}'),
        (5, e.raw#>>'{shipment,createdDate}'),
        (6, e.raw#>>'{shipment,CreatedDate}'),
        (7, e.raw#>>'{shipment,creationDate}'),
        (8, e.raw#>>'{shipment,ShipmentCreatedDate}'),
        (9, e.raw#>>'{shipment,shipmentCreatedDate}'),
        (10, e.raw#>>'{raw,createdAt}'),
        (11, e.raw#>>'{v2024_enrichment,shipment,createdAt}')
    ) AS v(priority, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ORDER BY priority
    LIMIT 1
  ) created_candidate ON true
  LEFT JOIN LATERAL (
    SELECT value
    FROM (
      VALUES
        (1, e.raw->>'amazon_last_updated_at'),
        (2, e.raw->>'updated_at_amazon'),
        (3, e.raw#>>'{shipment,updatedAt}'),
        (4, e.raw#>>'{shipment,updated_at}'),
        (5, e.raw#>>'{shipment,lastUpdatedAt}'),
        (6, e.raw#>>'{shipment,lastUpdatedDate}'),
        (7, e.raw#>>'{shipment,LastUpdatedDate}'),
        (8, e.raw#>>'{shipment,updatedDate}'),
        (9, e.raw#>>'{raw,updatedAt}'),
        (10, e.raw#>>'{v2024_enrichment,shipment,updatedAt}')
    ) AS v(priority, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ORDER BY priority
    LIMIT 1
  ) updated_candidate ON true
  LEFT JOIN LATERAL (
    SELECT value
    FROM (
      VALUES
        (1, e.raw->>'quantity_shipped'),
        (2, e.raw#>>'{item,QuantityShipped}'),
        (3, e.raw#>>'{item,quantityShipped}'),
        (4, e.raw#>>'{item,quantity_shipped}'),
        (5, e.raw#>>'{raw,QuantityShipped}')
    ) AS v(priority, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) shipped_candidate ON true
  LEFT JOIN LATERAL (
    SELECT value
    FROM (
      VALUES
        (1, e.raw->>'quantity_expected'),
        (2, e.raw#>>'{item,expectedQuantity}'),
        (3, e.raw#>>'{item,quantityExpected}'),
        (4, e.raw#>>'{item,quantity_expected}')
    ) AS v(priority, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) expected_candidate ON true
  LEFT JOIN LATERAL (
    SELECT value
    FROM (
      VALUES
        (1, e.raw#>>'{item,QuantityReceived}'),
        (2, e.raw#>>'{item,quantityReceived}'),
        (3, e.raw#>>'{item,quantity_received}'),
        (4, e.raw#>>'{item,receivedQuantity}')
    ) AS v(priority, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) received_candidate ON true
  LEFT JOIN LATERAL (
    SELECT value
    FROM (
      VALUES
        (1, e.raw->>'quantity_discrepancy'),
        (2, e.raw->>'discrepancy_quantity'),
        (3, e.raw#>>'{item,quantityDiscrepancy}'),
        (4, e.raw#>>'{item,discrepancyQuantity}')
    ) AS v(priority, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) discrepancy_candidate ON true
),
proposed AS (
  SELECT
    c.*,
    COALESCE(
      c.discrepancy_quantity,
      c.raw_discrepancy_candidate,
      CASE
        WHEN c.proposed_quantity_shipped IS NOT NULL
         AND c.resolved_quantity_received IS NOT NULL
          THEN c.proposed_quantity_shipped - c.resolved_quantity_received
      END
    ) AS proposed_discrepancy_quantity
  FROM candidates c
),
changed AS (
  UPDATE public.amazon_envios AS target
  SET
    amazon_created_at = CASE
      WHEN target.amazon_created_at IS NULL
        THEN p.proposed_amazon_created_at
      ELSE target.amazon_created_at
    END,
    amazon_last_updated_at = CASE
      WHEN target.amazon_last_updated_at IS NULL
        THEN p.proposed_amazon_last_updated_at
      ELSE target.amazon_last_updated_at
    END,
    quantity_shipped = CASE
      WHEN target.quantity_shipped IS NULL
        THEN p.proposed_quantity_shipped
      ELSE target.quantity_shipped
    END,
    quantity_expected = CASE
      WHEN target.quantity_expected IS NULL
        THEN p.proposed_quantity_expected
      ELSE target.quantity_expected
    END,
    discrepancy_quantity = CASE
      WHEN target.discrepancy_quantity IS NULL
        THEN p.proposed_discrepancy_quantity
      ELSE target.discrepancy_quantity
    END
  FROM proposed p
  WHERE target.id = p.id
    AND (
      (
        target.amazon_created_at IS NULL
        AND p.proposed_amazon_created_at IS NOT NULL
      )
      OR (
        target.amazon_last_updated_at IS NULL
        AND p.proposed_amazon_last_updated_at IS NOT NULL
      )
      OR (
        target.quantity_shipped IS NULL
        AND p.proposed_quantity_shipped IS NOT NULL
      )
      OR (
        target.quantity_expected IS NULL
        AND p.proposed_quantity_expected IS NOT NULL
      )
      OR (
        target.discrepancy_quantity IS NULL
        AND p.proposed_discrepancy_quantity IS NOT NULL
      )
    )
  RETURNING
    target.id,
    target.shipment_id,
    target.sku,
    target.amazon_created_at,
    target.amazon_last_updated_at,
    target.quantity_shipped,
    target.quantity_expected,
    target.discrepancy_quantity
)
SELECT
  count(*) AS changed_rows,
  count(*) FILTER (WHERE amazon_created_at IS NOT NULL)
    AS rows_with_created_at_after,
  count(*) FILTER (WHERE amazon_last_updated_at IS NOT NULL)
    AS rows_with_last_updated_at_after,
  count(*) FILTER (WHERE quantity_shipped IS NOT NULL)
    AS rows_with_quantity_shipped_after,
  count(*) FILTER (WHERE quantity_expected IS NOT NULL)
    AS rows_with_quantity_expected_after,
  count(*) FILTER (WHERE discrepancy_quantity IS NOT NULL)
    AS rows_with_discrepancy_after
FROM changed;

-- Validación dentro de la misma transacción.
SELECT
  count(*) FILTER (WHERE amazon_created_at IS NULL)
    AS amazon_created_at_null_rows,
  count(*) FILTER (WHERE amazon_last_updated_at IS NULL)
    AS amazon_last_updated_at_null_rows,
  count(*) FILTER (WHERE quantity_shipped IS NULL)
    AS quantity_shipped_null_rows,
  count(*) FILTER (WHERE quantity_expected IS NULL)
    AS quantity_expected_null_rows,
  count(*) FILTER (WHERE discrepancy_quantity IS NULL)
    AS discrepancy_quantity_null_rows,
  count(*) FILTER (
    WHERE quantity_shipped IS NOT NULL
      AND cantidad_recibida IS NOT NULL
      AND discrepancy_quantity IS NOT NULL
      AND discrepancy_quantity <> quantity_shipped - cantidad_recibida
  ) AS discrepancy_mismatch_rows
FROM public.amazon_envios;

COMMIT;
