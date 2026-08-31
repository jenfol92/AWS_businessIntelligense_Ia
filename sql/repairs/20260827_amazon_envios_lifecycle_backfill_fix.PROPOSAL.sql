-- PROPUESTA — Repair del backfill lifecycle de Amazon Envíos
-- NO EJECUTAR sin aprobación explícita.
--
-- Semántica validada:
--   * raw.item.QuantityShipped = cantidad declarada en la línea v0 del envío;
--     no equivale a QuantityReceived ni acredita por sí sola recepción física.
--   * raw.item.QuantityInCase = unidades por caja en envíos case-packed.
--     NO es la cantidad total esperada y no se usa en este repair.
--   * cantidad_esperada conserva la cantidad planificada de la línea.
--   * fecha_creacion es sólo un fallback de calidad DATE_QUALITY=FALLBACK;
--     no se presenta como el timestamp original de Amazon.
--   * amazon_last_updated_at permanece NULL cuando raw no aporta evidencia.
--   * discrepancy_quantity es informativa: shipped - received.
--
-- Propiedades:
--   * transaccional;
--   * limitado a columnas actualmente NULL;
--   * no sobrescribe valores válidos;
--   * idempotente;
--   * no usa imported_at ni synced_at como fecha histórica;
--   * no convierte cantidades desconocidas a cero.

-- SIMULACIÓN READ-ONLY PREVIA
-- Ejecutar esta consulta por separado antes de autorizar el bloque BEGIN/COMMIT.
WITH simulated AS (
  SELECT
    ae.id,
    ae.shipment_id,
    ae.sku,
    ae.estado,
    ae.amazon_created_at,
    ae.amazon_last_updated_at,
    ae.quantity_shipped,
    ae.quantity_expected,
    ae.discrepancy_quantity,
    ae.fecha_creacion,
    ae.cantidad_esperada,
    ae.cantidad_recibida,
    CASE
      WHEN NULLIF(ae.raw #>> '{item,QuantityShipped}', '') ~ '^[0-9]+$'
      THEN NULLIF(ae.raw #>> '{item,QuantityShipped}', '')::integer
      ELSE NULL
    END AS raw_quantity_shipped,
    COALESCE(
      ae.amazon_created_at,
      ae.fecha_creacion::timestamptz
    ) AS simulated_amazon_created_at,
    COALESCE(
      ae.quantity_shipped,
      CASE
        WHEN NULLIF(ae.raw #>> '{item,QuantityShipped}', '') ~ '^[0-9]+$'
        THEN NULLIF(ae.raw #>> '{item,QuantityShipped}', '')::integer
        ELSE NULL
      END
    ) AS simulated_quantity_shipped,
    COALESCE(
      ae.quantity_expected,
      ae.cantidad_esperada
    ) AS simulated_quantity_expected
  FROM public.amazon_envios ae
), final AS (
  SELECT
    *,
    COALESCE(
      discrepancy_quantity,
      CASE
        WHEN simulated_quantity_shipped IS NOT NULL
         AND cantidad_recibida IS NOT NULL
        THEN simulated_quantity_shipped - cantidad_recibida
        ELSE NULL
      END
    ) AS simulated_discrepancy_quantity
  FROM simulated
)
SELECT
  COUNT(*) AS rows_simulated,
  COUNT(*) FILTER (
    WHERE amazon_created_at IS NULL
      AND simulated_amazon_created_at IS NOT NULL
  ) AS rows_recoverable_created_at,
  COUNT(*) FILTER (
    WHERE quantity_shipped IS NULL
      AND simulated_quantity_shipped IS NOT NULL
  ) AS rows_recoverable_quantity_shipped,
  COUNT(*) FILTER (
    WHERE discrepancy_quantity IS NULL
      AND simulated_discrepancy_quantity IS NOT NULL
  ) AS rows_recoverable_discrepancy,
  COUNT(*) FILTER (
    WHERE simulated_amazon_created_at IS NULL
  ) AS expected_created_at_null_rows,
  COUNT(*) FILTER (
    WHERE amazon_last_updated_at IS NULL
  ) AS expected_last_updated_at_null_rows,
  COUNT(*) FILTER (
    WHERE simulated_quantity_shipped IS NULL
  ) AS expected_quantity_shipped_null_rows,
  COUNT(*) FILTER (
    WHERE simulated_quantity_expected IS NULL
  ) AS expected_quantity_expected_null_rows,
  COUNT(*) FILTER (
    WHERE simulated_discrepancy_quantity IS NULL
  ) AS expected_discrepancy_null_rows
FROM final;

-- VALIDACIÓN SEMÁNTICA DE QuantityInCase
-- QuantityInCase no participa en ninguna expresión del repair.
SELECT
  shipment_id,
  sku,
  raw #>> '{item,QuantityInCase}' AS quantity_in_case,
  cantidad_esperada,
  raw #>> '{item,QuantityShipped}' AS quantity_shipped,
  COALESCE(
    raw #>> '{item,QuantityReceived}',
    cantidad_recibida::text
  ) AS quantity_received,
  CASE
    WHEN NULLIF(raw #>> '{item,QuantityInCase}', '') IS NULL
      THEN 'NOT_PRESENT'
    ELSE 'UNITS_PER_CASE_NOT_EXPECTED_TOTAL'
  END AS quantity_in_case_semantics
FROM public.amazon_envios
WHERE NULLIF(raw #>> '{item,QuantityInCase}', '') IS NOT NULL
ORDER BY shipment_id, sku;

-- REPAIR PROPUESTO — NO EJECUTAR TODAVÍA
BEGIN;

-- DATE_QUALITY=FALLBACK: precisión de día, no timestamp Amazon original.
UPDATE public.amazon_envios
SET amazon_created_at = fecha_creacion::timestamptz
WHERE amazon_created_at IS NULL
  AND fecha_creacion IS NOT NULL;

-- QuantityShipped es la cantidad declarada para la línea en el payload v0.
-- El filtro evita casts de valores vacíos, decimales, negativos o no numéricos.
UPDATE public.amazon_envios
SET quantity_shipped =
  NULLIF(raw #>> '{item,QuantityShipped}', '')::integer
WHERE quantity_shipped IS NULL
  AND NULLIF(raw #>> '{item,QuantityShipped}', '') ~ '^[0-9]+$';

-- Fuente validada: cantidad planificada persistida en cantidad_esperada.
-- QuantityInCase queda excluida deliberadamente.
UPDATE public.amazon_envios
SET quantity_expected = cantidad_esperada
WHERE quantity_expected IS NULL
  AND cantidad_esperada IS NOT NULL;

-- No usa COALESCE(..., 0): si shipped o received son desconocidas, queda NULL.
UPDATE public.amazon_envios
SET discrepancy_quantity = quantity_shipped - cantidad_recibida
WHERE discrepancy_quantity IS NULL
  AND quantity_shipped IS NOT NULL
  AND cantidad_recibida IS NOT NULL;

-- amazon_last_updated_at no se modifica: no existe fuente histórica fiable.

COMMIT;

-- VERIFICACIÓN READ-ONLY POSTERIOR
SELECT
  COUNT(*) FILTER (WHERE amazon_created_at IS NULL)
    AS expected_created_at_null_rows,
  COUNT(*) FILTER (WHERE amazon_last_updated_at IS NULL)
    AS expected_last_updated_at_null_rows,
  COUNT(*) FILTER (WHERE quantity_shipped IS NULL)
    AS expected_quantity_shipped_null_rows,
  COUNT(*) FILTER (WHERE quantity_expected IS NULL)
    AS expected_quantity_expected_null_rows,
  COUNT(*) FILTER (WHERE discrepancy_quantity IS NULL)
    AS expected_discrepancy_null_rows
FROM public.amazon_envios;

-- ROLLBACK DOCUMENTADO
-- Antes del COMMIT: ejecutar ROLLBACK en lugar de COMMIT.
-- Después del COMMIT no existe un rollback genérico seguro, porque no se añade
-- una marca de procedencia a las filas. Para revertir después de confirmar:
--   1. restaurar por id las cuatro columnas desde un snapshot pre-repair;
--   2. hacerlo antes de cualquier sync posterior;
--   3. no usar igualdad de valores como criterio, porque podría borrar datos
--      válidos que coincidan accidentalmente con el fallback.
