-- Auditoría read-only del raw legacy de Amazon Envíos.
-- Ejecutar completo en Supabase SQL Editor.
-- No contiene escrituras ni llamadas externas.

-- ============================================================================
-- 01. INVENTARIO DE RAW KEYS
-- ============================================================================
SELECT
  '01_RAW_TOP_LEVEL_KEYS' AS block,
  key AS "KEY",
  count(*) AS "ROWS_PRESENT",
  count(*) FILTER (WHERE jsonb_typeof(raw->key) = 'object') AS object_rows,
  count(*) FILTER (WHERE jsonb_typeof(raw->key) = 'array') AS array_rows,
  string_agg(DISTINCT jsonb_typeof(raw->key), ', ' ORDER BY jsonb_typeof(raw->key))
    AS value_types
FROM public.amazon_envios
CROSS JOIN LATERAL jsonb_object_keys(
  CASE WHEN jsonb_typeof(raw) = 'object' THEN raw ELSE '{}'::jsonb END
) AS keys(key)
GROUP BY key
ORDER BY "ROWS_PRESENT" DESC, key;

WITH RECURSIVE object_nodes AS (
  SELECT
    id,
    ARRAY[]::text[] AS object_path,
    raw AS object_value
  FROM public.amazon_envios
  WHERE jsonb_typeof(raw) = 'object'

  UNION ALL

  SELECT
    n.id,
    n.object_path || child.key,
    child.value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE jsonb_typeof(child.value) = 'object'
),
nested_keys AS (
  SELECT
    n.id,
    n.object_path,
    child.key,
    child.value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE cardinality(n.object_path) > 0
)
SELECT
  '01_RAW_NESTED_OBJECT_KEYS' AS block,
  array_to_string(object_path, '.') AS object_path,
  key AS nested_key,
  count(DISTINCT id) AS "ROWS_PRESENT",
  string_agg(DISTINCT jsonb_typeof(value), ', ' ORDER BY jsonb_typeof(value))
    AS value_types
FROM nested_keys
GROUP BY object_path, key
ORDER BY object_path, "ROWS_PRESENT" DESC, key;

-- Resumen compacto solicitado.
WITH RECURSIVE object_nodes AS (
  SELECT
    id,
    ARRAY[]::text[] AS object_path,
    raw AS object_value
  FROM public.amazon_envios
  WHERE jsonb_typeof(raw) = 'object'

  UNION ALL

  SELECT
    n.id,
    n.object_path || child.key,
    child.value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE jsonb_typeof(child.value) = 'object'
),
top_keys AS (
  SELECT DISTINCT key
  FROM public.amazon_envios
  CROSS JOIN LATERAL jsonb_object_keys(
    CASE WHEN jsonb_typeof(raw) = 'object' THEN raw ELSE '{}'::jsonb END
  ) AS keys(key)
),
nested_paths AS (
  SELECT DISTINCT array_to_string(object_path, '.') AS object_path
  FROM object_nodes
  WHERE cardinality(object_path) > 0
)
SELECT
  '01_RAW_KEYS_SUMMARY' AS block,
  (SELECT string_agg(key, ', ' ORDER BY key) FROM top_keys)
    AS "RAW_TOP_LEVEL_KEYS",
  (SELECT string_agg(object_path, ', ' ORDER BY object_path) FROM nested_paths)
    AS "RAW_NESTED_OBJECT_KEYS";

-- ============================================================================
-- 02. FECHAS: claves realmente presentes, sin asumir casing ni profundidad
-- ============================================================================
WITH RECURSIVE object_nodes AS (
  SELECT
    id,
    shipment_id,
    ARRAY[]::text[] AS object_path,
    raw AS object_value
  FROM public.amazon_envios
  WHERE jsonb_typeof(raw) = 'object'

  UNION ALL

  SELECT
    n.id,
    n.shipment_id,
    n.object_path || child.key,
    child.value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE jsonb_typeof(child.value) = 'object'
),
fields AS (
  SELECT
    n.id,
    n.shipment_id,
    n.object_path || child.key AS field_path,
    child.key,
    child.value,
    trim(both '"' FROM child.value::text) AS scalar_value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE jsonb_typeof(child.value) IN ('string', 'number')
),
date_fields AS (
  SELECT *
  FROM fields
  WHERE regexp_replace(lower(key), '[_ -]', '', 'g') IN (
    'createdat',
    'createddate',
    'creationdate',
    'shipmentcreateddate',
    'createdatamazon',
    'amazoncreatedat',
    'updatedat',
    'updateddate',
    'lastupdatedat',
    'lastupdateddate',
    'updatedatamazon',
    'amazonlastupdatedat'
  )
     OR lower(key) ~ '(created|creation|updated).*(at|date)'
     OR lower(key) ~ '(at|date).*(created|updated)'
),
value_frequency AS (
  SELECT
    field_path,
    scalar_value,
    count(*) AS value_rows
  FROM date_fields
  GROUP BY field_path, scalar_value
),
ranked_samples AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY field_path
      ORDER BY value_rows DESC, scalar_value
    ) AS sample_rank
  FROM value_frequency
),
path_counts AS (
  SELECT
    field_path,
    count(DISTINCT id) AS rows_present
  FROM date_fields
  GROUP BY field_path
)
SELECT
  '02_DATE_KEYS' AS block,
  array_to_string(c.field_path, '.') AS "KEY",
  c.rows_present AS "ROWS_PRESENT",
  array_agg(s.scalar_value ORDER BY s.sample_rank)
    FILTER (WHERE s.sample_rank <= 5) AS "SAMPLE_VALUES"
FROM path_counts c
JOIN ranked_samples s USING (field_path)
GROUP BY c.field_path, c.rows_present
ORDER BY c.rows_present DESC, "KEY";

-- ============================================================================
-- 03. CANTIDADES: claves realmente presentes
-- ============================================================================
WITH RECURSIVE object_nodes AS (
  SELECT
    id,
    ARRAY[]::text[] AS object_path,
    raw AS object_value
  FROM public.amazon_envios
  WHERE jsonb_typeof(raw) = 'object'

  UNION ALL

  SELECT
    n.id,
    n.object_path || child.key,
    child.value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE jsonb_typeof(child.value) = 'object'
),
fields AS (
  SELECT
    n.id,
    n.object_path || child.key AS field_path,
    child.key,
    child.value,
    trim(both '"' FROM child.value::text) AS scalar_value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE jsonb_typeof(child.value) IN ('string', 'number')
),
quantity_fields AS (
  SELECT *
  FROM fields
  WHERE regexp_replace(lower(key), '[_ -]', '', 'g') IN (
    'quantityshipped',
    'quantityreceived',
    'receivedquantity',
    'quantityexpected',
    'expectedquantity',
    'expected',
    'quantity',
    'quantityincase',
    'quantitydiscrepancy',
    'discrepancyquantity'
  )
     OR lower(key) ~ '(quantity|expected|received|shipped|discrepancy)'
),
value_frequency AS (
  SELECT
    field_path,
    scalar_value,
    count(*) AS value_rows
  FROM quantity_fields
  GROUP BY field_path, scalar_value
),
ranked_samples AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY field_path
      ORDER BY value_rows DESC, scalar_value
    ) AS sample_rank
  FROM value_frequency
),
path_counts AS (
  SELECT
    field_path,
    count(DISTINCT id) AS rows_present
  FROM quantity_fields
  GROUP BY field_path
)
SELECT
  '03_QUANTITY_KEYS' AS block,
  array_to_string(c.field_path, '.') AS "KEY",
  c.rows_present AS "ROWS_PRESENT",
  array_agg(s.scalar_value ORDER BY s.sample_rank)
    FILTER (WHERE s.sample_rank <= 5) AS "SAMPLE_VALUES"
FROM path_counts c
JOIN ranked_samples s USING (field_path)
GROUP BY c.field_path, c.rows_present
ORDER BY c.rows_present DESC, "KEY";

-- ============================================================================
-- 04. ORIGEN DEL RAW
-- V0 usa marcadores PascalCase; V2024 usa marcadores camelCase específicos.
-- ============================================================================
WITH RECURSIVE object_nodes AS (
  SELECT
    id,
    ARRAY[]::text[] AS object_path,
    raw AS object_value
  FROM public.amazon_envios
  WHERE jsonb_typeof(raw) = 'object'

  UNION ALL

  SELECT
    n.id,
    n.object_path || child.key,
    child.value
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  WHERE jsonb_typeof(child.value) = 'object'
),
keys_by_row AS (
  SELECT
    n.id,
    bool_or(child.key IN (
      'ShipmentId',
      'ShipmentStatus',
      'SellerSKU',
      'QuantityShipped',
      'QuantityReceived',
      'DestinationFulfillmentCenterId'
    )) AS has_v0_marker,
    bool_or(child.key IN (
      'inboundPlanId',
      'shipmentConfirmationId',
      'placementOptionId',
      'shipmentId',
      'expectedQuantity',
      'quantityExpected'
    )
      OR child.key = 'v2024_enrichment'
      OR array_to_string(n.object_path || child.key, '.') LIKE 'v2024_enrichment.%'
      OR array_to_string(n.object_path || child.key, '.') LIKE '%.v2024_enrichment.%')
      AS has_v2024_marker
  FROM object_nodes n
  CROSS JOIN LATERAL jsonb_each(n.object_value) AS child(key, value)
  GROUP BY n.id
),
classified AS (
  SELECT
    e.id,
    CASE
      WHEN COALESCE(k.has_v0_marker, false)
       AND COALESCE(k.has_v2024_marker, false) THEN 'MIXED'
      WHEN COALESCE(k.has_v0_marker, false) THEN 'V0'
      WHEN COALESCE(k.has_v2024_marker, false) THEN 'V2024'
      ELSE 'UNKNOWN'
    END AS raw_source_type
  FROM public.amazon_envios e
  LEFT JOIN keys_by_row k USING (id)
)
SELECT
  '04_RAW_SOURCE_TYPE_COUNTS' AS block,
  raw_source_type,
  count(*) AS rows
FROM classified
GROUP BY raw_source_type
ORDER BY raw_source_type;

-- ============================================================================
-- 05. EJEMPLOS REPRESENTATIVOS
-- Solo muestra keys y valores candidatos; nunca devuelve el payload completo.
-- ============================================================================
WITH candidates AS (
  SELECT
    e.*,
    ARRAY(
      SELECT key
      FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(e.raw) = 'object' THEN e.raw ELSE '{}'::jsonb END
      ) AS keys(key)
      ORDER BY key
    ) AS raw_keys,
    ARRAY(
      SELECT key
      FROM jsonb_object_keys(
        CASE
          WHEN jsonb_typeof(e.raw->'shipment') = 'object'
            THEN e.raw->'shipment'
          ELSE '{}'::jsonb
        END
      ) AS keys(key)
      ORDER BY key
    ) AS shipment_keys,
    ARRAY(
      SELECT key
      FROM jsonb_object_keys(
        CASE
          WHEN jsonb_typeof(e.raw->'item') = 'object'
            THEN e.raw->'item'
          ELSE '{}'::jsonb
        END
      ) AS keys(key)
      ORDER BY key
    ) AS item_keys,
    COALESCE(
      e.raw->>'amazon_created_at',
      e.raw->>'created_at_amazon',
      e.raw#>>'{shipment,createdAt}',
      e.raw#>>'{shipment,createdDate}',
      e.raw#>>'{shipment,CreatedDate}',
      e.raw#>>'{shipment,creationDate}',
      e.raw#>>'{shipment,ShipmentCreatedDate}',
      e.raw#>>'{shipment,shipmentCreatedDate}'
    ) AS possible_created_at,
    COALESCE(
      e.raw->>'amazon_last_updated_at',
      e.raw->>'updated_at_amazon',
      e.raw#>>'{shipment,updatedAt}',
      e.raw#>>'{shipment,lastUpdatedAt}',
      e.raw#>>'{shipment,lastUpdatedDate}',
      e.raw#>>'{shipment,LastUpdatedDate}',
      e.raw#>>'{shipment,updatedDate}'
    ) AS possible_last_updated_at,
    COALESCE(
      e.raw->>'quantity_shipped',
      e.raw#>>'{item,QuantityShipped}',
      e.raw#>>'{item,quantityShipped}',
      e.raw#>>'{item,quantity_shipped}'
    ) AS possible_quantity_shipped,
    COALESCE(
      e.raw->>'quantity_expected',
      e.raw#>>'{item,expected}',
      e.raw#>>'{item,expectedQuantity}',
      e.raw#>>'{item,quantityExpected}',
      e.raw#>>'{item,quantity_expected}',
      e.raw#>>'{item,quantity}',
      e.raw#>>'{item,QuantityInCase}'
    ) AS possible_quantity_expected,
    COALESCE(
      e.raw#>>'{item,QuantityReceived}',
      e.raw#>>'{item,quantityReceived}',
      e.raw#>>'{item,quantity_received}',
      e.raw#>>'{item,receivedQuantity}'
    ) AS possible_quantity_received,
    row_number() OVER (
      PARTITION BY COALESCE(NULLIF(upper(trim(e.estado)), ''), '<UNKNOWN>')
      ORDER BY e.shipment_id, e.sku, e.id
    ) AS status_sample_rank
  FROM public.amazon_envios e
)
SELECT
  '05_REPRESENTATIVE_EXAMPLES' AS block,
  shipment_id,
  sku,
  estado,
  raw_keys,
  shipment_keys,
  item_keys,
  possible_created_at,
  possible_last_updated_at,
  possible_quantity_shipped,
  possible_quantity_received,
  possible_quantity_expected
FROM candidates
WHERE status_sample_rank = 1
ORDER BY
  CASE upper(trim(estado))
    WHEN 'WORKING' THEN 1
    WHEN 'RECEIVING' THEN 2
    ELSE 3
  END,
  estado,
  shipment_id;

-- ============================================================================
-- 06. EXPRESIONES PROPUESTAS
-- Cada candidate lateral elige el primer valor válido según prioridad.
-- fecha_creacion es solo el último fallback de creación.
-- imported_at queda expresamente excluido.
-- ============================================================================
SELECT
  '06_PROPOSED_EXPRESSIONS' AS block,
  'COALESCE(amazon_created_at, created_candidate.value::timestamptz, fecha_creacion::timestamptz)'
    AS "PROPOSED_CREATED_AT_EXPRESSION",
  'COALESCE(amazon_last_updated_at, updated_candidate.value::timestamptz)'
    AS "PROPOSED_LAST_UPDATED_AT_EXPRESSION",
  'COALESCE(quantity_shipped, shipped_candidate.value::integer)'
    AS "PROPOSED_QUANTITY_SHIPPED_EXPRESSION",
  'COALESCE(quantity_expected, expected_candidate.value::integer, cantidad_esperada)'
    AS "PROPOSED_QUANTITY_EXPECTED_EXPRESSION",
  'COALESCE(discrepancy_quantity, discrepancy_candidate.value::integer, simulated_quantity_shipped - simulated_quantity_received)'
    AS "PROPOSED_DISCREPANCY_EXPRESSION",
  'See blocks 07 and 07B. raw.item.quantity is shown for v2024 diagnosis but is excluded from the repair proposal because legacy plan items may not prove shipment-level attribution.'
    AS implementation_note;

-- ============================================================================
-- 07. SIMULACIÓN READ-ONLY
-- ============================================================================
WITH simulated AS (
  SELECT
    e.*,
    COALESCE(
      e.amazon_created_at,
      created_candidate.value::timestamptz,
      e.fecha_creacion::timestamptz
    ) AS simulated_amazon_created_at,
    COALESCE(
      e.amazon_last_updated_at,
      updated_candidate.value::timestamptz
    ) AS simulated_amazon_last_updated_at,
    COALESCE(
      e.quantity_shipped,
      shipped_candidate.value::integer
    ) AS simulated_quantity_shipped,
    COALESCE(
      e.quantity_expected,
      expected_candidate.value::integer,
      e.cantidad_esperada
    ) AS simulated_quantity_expected,
    COALESCE(
      e.cantidad_recibida,
      received_candidate.value::integer
    ) AS simulated_quantity_received,
    discrepancy_candidate.value::integer AS raw_discrepancy_candidate,
    created_candidate.source AS created_source,
    updated_candidate.source AS updated_source,
    shipped_candidate.source AS shipped_source,
    expected_candidate.source AS expected_source,
    received_candidate.source AS received_source
  FROM public.amazon_envios e
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.amazon_created_at', e.raw->>'amazon_created_at'),
        (2, 'raw.created_at_amazon', e.raw->>'created_at_amazon'),
        (3, 'raw.shipment.createdAt', e.raw#>>'{shipment,createdAt}'),
        (4, 'raw.shipment.created_at', e.raw#>>'{shipment,created_at}'),
        (5, 'raw.shipment.createdDate', e.raw#>>'{shipment,createdDate}'),
        (6, 'raw.shipment.CreatedDate', e.raw#>>'{shipment,CreatedDate}'),
        (7, 'raw.shipment.creationDate', e.raw#>>'{shipment,creationDate}'),
        (8, 'raw.shipment.ShipmentCreatedDate', e.raw#>>'{shipment,ShipmentCreatedDate}'),
        (9, 'raw.shipment.shipmentCreatedDate', e.raw#>>'{shipment,shipmentCreatedDate}'),
        (10, 'raw.raw.createdAt', e.raw#>>'{raw,createdAt}'),
        (11, 'raw.v2024_enrichment.shipment.createdAt',
          e.raw#>>'{v2024_enrichment,shipment,createdAt}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ORDER BY priority
    LIMIT 1
  ) created_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.amazon_last_updated_at', e.raw->>'amazon_last_updated_at'),
        (2, 'raw.updated_at_amazon', e.raw->>'updated_at_amazon'),
        (3, 'raw.shipment.updatedAt', e.raw#>>'{shipment,updatedAt}'),
        (4, 'raw.shipment.updated_at', e.raw#>>'{shipment,updated_at}'),
        (5, 'raw.shipment.lastUpdatedAt', e.raw#>>'{shipment,lastUpdatedAt}'),
        (6, 'raw.shipment.lastUpdatedDate', e.raw#>>'{shipment,lastUpdatedDate}'),
        (7, 'raw.shipment.LastUpdatedDate', e.raw#>>'{shipment,LastUpdatedDate}'),
        (8, 'raw.shipment.updatedDate', e.raw#>>'{shipment,updatedDate}'),
        (9, 'raw.raw.updatedAt', e.raw#>>'{raw,updatedAt}'),
        (10, 'raw.v2024_enrichment.shipment.updatedAt',
          e.raw#>>'{v2024_enrichment,shipment,updatedAt}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ORDER BY priority
    LIMIT 1
  ) updated_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.quantity_shipped', e.raw->>'quantity_shipped'),
        (2, 'raw.item.QuantityShipped', e.raw#>>'{item,QuantityShipped}'),
        (3, 'raw.item.quantityShipped', e.raw#>>'{item,quantityShipped}'),
        (4, 'raw.item.quantity_shipped', e.raw#>>'{item,quantity_shipped}'),
        (5, 'raw.raw.QuantityShipped', e.raw#>>'{raw,QuantityShipped}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) shipped_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.quantity_expected', e.raw->>'quantity_expected'),
        (2, 'raw.item.expectedQuantity', e.raw#>>'{item,expectedQuantity}'),
        (3, 'raw.item.quantityExpected', e.raw#>>'{item,quantityExpected}'),
        (4, 'raw.item.quantity_expected', e.raw#>>'{item,quantity_expected}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) expected_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.item.QuantityReceived', e.raw#>>'{item,QuantityReceived}'),
        (2, 'raw.item.quantityReceived', e.raw#>>'{item,quantityReceived}'),
        (3, 'raw.item.quantity_received', e.raw#>>'{item,quantity_received}'),
        (4, 'raw.item.receivedQuantity', e.raw#>>'{item,receivedQuantity}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) received_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.quantity_discrepancy', e.raw->>'quantity_discrepancy'),
        (2, 'raw.discrepancy_quantity', e.raw->>'discrepancy_quantity'),
        (3, 'raw.item.quantityDiscrepancy',
          e.raw#>>'{item,quantityDiscrepancy}'),
        (4, 'raw.item.discrepancyQuantity',
          e.raw#>>'{item,discrepancyQuantity}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) discrepancy_candidate ON true
),
completed AS (
  SELECT
    s.*,
    COALESCE(
      s.discrepancy_quantity,
      s.raw_discrepancy_candidate,
      CASE
        WHEN s.simulated_quantity_shipped IS NOT NULL
         AND s.simulated_quantity_received IS NOT NULL
          THEN s.simulated_quantity_shipped - s.simulated_quantity_received
      END
    ) AS simulated_discrepancy_quantity
  FROM simulated s
)
SELECT
  '07_SIMULATION_SUMMARY' AS block,
  count(*) FILTER (
    WHERE simulated_amazon_created_at IS NULL
  ) AS "SIMULATED_CREATED_AT_NULL_ROWS",
  count(*) FILTER (
    WHERE simulated_amazon_last_updated_at IS NULL
  ) AS "SIMULATED_LAST_UPDATED_AT_NULL_ROWS",
  count(*) FILTER (
    WHERE simulated_quantity_shipped IS NULL
  ) AS "SIMULATED_QUANTITY_SHIPPED_NULL_ROWS",
  count(*) FILTER (
    WHERE simulated_discrepancy_quantity IS NULL
  ) AS "SIMULATED_DISCREPANCY_NULL_ROWS",
  count(*) FILTER (
    WHERE simulated_quantity_expected IS NULL
  ) AS simulated_quantity_expected_null_rows
FROM completed;

-- 07B. Detalle de nulos restantes, fuentes elegidas y posibles mismatches.
WITH simulated AS (
  SELECT
    e.*,
    COALESCE(
      e.amazon_created_at,
      created_candidate.value::timestamptz,
      e.fecha_creacion::timestamptz
    ) AS simulated_amazon_created_at,
    COALESCE(
      e.amazon_last_updated_at,
      updated_candidate.value::timestamptz
    ) AS simulated_amazon_last_updated_at,
    COALESCE(e.quantity_shipped, shipped_candidate.value::integer)
      AS simulated_quantity_shipped,
    COALESCE(
      e.quantity_expected,
      expected_candidate.value::integer,
      e.cantidad_esperada
    ) AS simulated_quantity_expected,
    COALESCE(e.cantidad_recibida, received_candidate.value::integer)
      AS simulated_quantity_received,
    discrepancy_candidate.value::integer AS raw_discrepancy_candidate,
    created_candidate.source AS created_source,
    updated_candidate.source AS updated_source,
    shipped_candidate.source AS shipped_source,
    expected_candidate.source AS expected_source,
    received_candidate.source AS received_source
  FROM public.amazon_envios e
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.amazon_created_at', e.raw->>'amazon_created_at'),
        (2, 'raw.created_at_amazon', e.raw->>'created_at_amazon'),
        (3, 'raw.shipment.createdAt', e.raw#>>'{shipment,createdAt}'),
        (4, 'raw.shipment.created_at', e.raw#>>'{shipment,created_at}'),
        (5, 'raw.shipment.createdDate', e.raw#>>'{shipment,createdDate}'),
        (6, 'raw.shipment.CreatedDate', e.raw#>>'{shipment,CreatedDate}'),
        (7, 'raw.shipment.creationDate', e.raw#>>'{shipment,creationDate}'),
        (8, 'raw.shipment.ShipmentCreatedDate', e.raw#>>'{shipment,ShipmentCreatedDate}'),
        (9, 'raw.shipment.shipmentCreatedDate', e.raw#>>'{shipment,shipmentCreatedDate}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ORDER BY priority
    LIMIT 1
  ) created_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.amazon_last_updated_at', e.raw->>'amazon_last_updated_at'),
        (2, 'raw.updated_at_amazon', e.raw->>'updated_at_amazon'),
        (3, 'raw.shipment.updatedAt', e.raw#>>'{shipment,updatedAt}'),
        (4, 'raw.shipment.updated_at', e.raw#>>'{shipment,updated_at}'),
        (5, 'raw.shipment.lastUpdatedAt', e.raw#>>'{shipment,lastUpdatedAt}'),
        (6, 'raw.shipment.lastUpdatedDate', e.raw#>>'{shipment,lastUpdatedDate}'),
        (7, 'raw.shipment.LastUpdatedDate', e.raw#>>'{shipment,LastUpdatedDate}'),
        (8, 'raw.shipment.updatedDate', e.raw#>>'{shipment,updatedDate}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ORDER BY priority
    LIMIT 1
  ) updated_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.quantity_shipped', e.raw->>'quantity_shipped'),
        (2, 'raw.item.QuantityShipped', e.raw#>>'{item,QuantityShipped}'),
        (3, 'raw.item.quantityShipped', e.raw#>>'{item,quantityShipped}'),
        (4, 'raw.item.quantity_shipped', e.raw#>>'{item,quantity_shipped}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) shipped_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.quantity_expected', e.raw->>'quantity_expected'),
        (2, 'raw.item.expectedQuantity', e.raw#>>'{item,expectedQuantity}'),
        (3, 'raw.item.quantityExpected', e.raw#>>'{item,quantityExpected}'),
        (4, 'raw.item.quantity_expected', e.raw#>>'{item,quantity_expected}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) expected_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.item.QuantityReceived', e.raw#>>'{item,QuantityReceived}'),
        (2, 'raw.item.quantityReceived', e.raw#>>'{item,quantityReceived}'),
        (3, 'raw.item.quantity_received', e.raw#>>'{item,quantity_received}'),
        (4, 'raw.item.receivedQuantity', e.raw#>>'{item,receivedQuantity}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) received_candidate ON true
  LEFT JOIN LATERAL (
    SELECT source, value
    FROM (
      VALUES
        (1, 'raw.quantity_discrepancy', e.raw->>'quantity_discrepancy'),
        (2, 'raw.discrepancy_quantity', e.raw->>'discrepancy_quantity'),
        (3, 'raw.item.quantityDiscrepancy',
          e.raw#>>'{item,quantityDiscrepancy}'),
        (4, 'raw.item.discrepancyQuantity',
          e.raw#>>'{item,discrepancyQuantity}')
    ) AS v(priority, source, value)
    WHERE NULLIF(trim(value), '') IS NOT NULL
      AND trim(value) ~ '^-?[0-9]+$'
    ORDER BY priority
    LIMIT 1
  ) discrepancy_candidate ON true
),
completed AS (
  SELECT
    s.*,
    COALESCE(
      s.discrepancy_quantity,
      s.raw_discrepancy_candidate,
      CASE
        WHEN s.simulated_quantity_shipped IS NOT NULL
         AND s.simulated_quantity_received IS NOT NULL
          THEN s.simulated_quantity_shipped - s.simulated_quantity_received
      END
    ) AS simulated_discrepancy_quantity
  FROM simulated s
)
SELECT
  '07_SIMULATION_DETAIL' AS block,
  shipment_id,
  sku,
  estado,
  amazon_created_at AS current_amazon_created_at,
  simulated_amazon_created_at,
  COALESCE(created_source, 'fecha_creacion_fallback') AS created_source,
  amazon_last_updated_at AS current_amazon_last_updated_at,
  simulated_amazon_last_updated_at,
  updated_source,
  quantity_shipped AS current_quantity_shipped,
  simulated_quantity_shipped,
  shipped_source,
  quantity_expected AS current_quantity_expected,
  simulated_quantity_expected,
  expected_source,
  cantidad_recibida,
  simulated_quantity_received,
  received_source,
  discrepancy_quantity AS current_discrepancy_quantity,
  simulated_discrepancy_quantity,
  array_to_string(
    array_remove(
      ARRAY[
        CASE WHEN simulated_amazon_created_at IS NULL THEN 'CREATED_STILL_NULL' END,
        CASE WHEN simulated_amazon_last_updated_at IS NULL THEN 'UPDATED_STILL_NULL' END,
        CASE WHEN simulated_quantity_shipped IS NULL THEN 'SHIPPED_STILL_NULL' END,
        CASE WHEN simulated_quantity_expected IS NULL THEN 'EXPECTED_STILL_NULL' END,
        CASE WHEN simulated_discrepancy_quantity IS NULL THEN 'DISCREPANCY_STILL_NULL' END,
        CASE
          WHEN cantidad_enviada IS NOT NULL
           AND simulated_quantity_shipped IS NOT NULL
           AND cantidad_enviada <> simulated_quantity_shipped
            THEN 'SHIPPED_DIFFERS_FROM_LEGACY_CANTIDAD_ENVIADA'
        END,
        CASE
          WHEN cantidad_esperada IS NOT NULL
           AND simulated_quantity_expected IS NOT NULL
           AND cantidad_esperada <> simulated_quantity_expected
            THEN 'EXPECTED_DIFFERS_FROM_LEGACY_CANTIDAD_ESPERADA'
        END
      ],
      NULL
    ),
    ','
  ) AS diagnostic_flags
FROM completed
WHERE amazon_created_at IS NULL
   OR amazon_last_updated_at IS NULL
   OR quantity_shipped IS NULL
   OR quantity_expected IS NULL
   OR discrepancy_quantity IS NULL
ORDER BY shipment_id, sku;

-- ============================================================================
-- 08-10. VEREDICTO DINÁMICO
-- La propuesta correctiva solo debe aplicarse después de revisar estos bloques.
-- ============================================================================
WITH base AS (
  SELECT
    e.*,
    COALESCE(
      e.amazon_created_at,
      created_candidate.value::timestamptz,
      e.fecha_creacion::timestamptz
    ) AS simulated_created,
    COALESCE(
      e.amazon_last_updated_at,
      updated_candidate.value::timestamptz
    ) AS simulated_updated,
    COALESCE(e.quantity_shipped, shipped_candidate.value::integer)
      AS simulated_shipped,
    COALESCE(
      e.quantity_expected,
      expected_candidate.value::integer,
      e.cantidad_esperada
    ) AS simulated_expected,
    COALESCE(e.cantidad_recibida, received_candidate.value::integer)
      AS simulated_received,
    discrepancy_candidate.value::integer AS raw_discrepancy
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
        (9, e.raw#>>'{shipment,shipmentCreatedDate}')
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
        (8, e.raw#>>'{shipment,updatedDate}')
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
        (4, e.raw#>>'{item,quantity_shipped}')
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
simulated AS (
  SELECT
    b.*,
    COALESCE(
      b.discrepancy_quantity,
      b.raw_discrepancy,
      CASE
        WHEN b.simulated_shipped IS NOT NULL
         AND b.simulated_received IS NOT NULL
          THEN b.simulated_shipped - b.simulated_received
      END
    ) AS simulated_discrepancy
  FROM base b
),
stats AS (
  SELECT
    count(*) FILTER (WHERE amazon_created_at IS NULL) AS original_created_null,
    count(*) FILTER (WHERE amazon_last_updated_at IS NULL) AS original_updated_null,
    count(*) FILTER (WHERE quantity_shipped IS NULL) AS original_shipped_null,
    count(*) FILTER (WHERE discrepancy_quantity IS NULL) AS original_discrepancy_null,
    count(*) FILTER (WHERE simulated_created IS NULL) AS simulated_created_null,
    count(*) FILTER (WHERE simulated_updated IS NULL) AS simulated_updated_null,
    count(*) FILTER (WHERE simulated_shipped IS NULL) AS simulated_shipped_null,
    count(*) FILTER (WHERE simulated_expected IS NULL) AS simulated_expected_null,
    count(*) FILTER (WHERE simulated_discrepancy IS NULL) AS simulated_discrepancy_null,
    count(*) FILTER (
      WHERE jsonb_typeof(raw->'shipment') = 'object'
         OR jsonb_typeof(raw->'item') = 'object'
    ) AS wrapped_payload_rows
  FROM simulated
),
format_counts AS (
  SELECT string_agg(raw_source_type, ', ' ORDER BY raw_source_type) AS formats
  FROM (
    SELECT DISTINCT
      CASE
        WHEN (
          COALESCE(raw->'shipment', '{}'::jsonb) ?| ARRAY[
            'ShipmentId',
            'ShipmentStatus',
            'DestinationFulfillmentCenterId'
          ]
          OR COALESCE(raw->'item', '{}'::jsonb) ?| ARRAY[
            'SellerSKU',
            'QuantityShipped',
            'QuantityReceived'
          ]
        )
        AND (
          COALESCE(raw->'shipment', '{}'::jsonb) ?| ARRAY[
            'inboundPlanId',
            'shipmentConfirmationId',
            'placementOptionId',
            'shipmentId'
          ]
          OR COALESCE(raw->'item', '{}'::jsonb) ?| ARRAY[
            'expectedQuantity',
            'quantityExpected'
          ]
          OR raw ? 'v2024_enrichment'
        ) THEN 'MIXED'
        WHEN (
          COALESCE(raw->'shipment', '{}'::jsonb) ?| ARRAY[
            'ShipmentId',
            'ShipmentStatus',
            'DestinationFulfillmentCenterId'
          ]
          OR COALESCE(raw->'item', '{}'::jsonb) ?| ARRAY[
            'SellerSKU',
            'QuantityShipped',
            'QuantityReceived'
          ]
        ) THEN 'V0'
        WHEN (
          COALESCE(raw->'shipment', '{}'::jsonb) ?| ARRAY[
            'inboundPlanId',
            'shipmentConfirmationId',
            'placementOptionId',
            'shipmentId'
          ]
          OR COALESCE(raw->'item', '{}'::jsonb) ?| ARRAY[
            'expectedQuantity',
            'quantityExpected'
          ]
          OR raw ? 'v2024_enrichment'
        ) THEN 'V2024'
        ELSE 'UNKNOWN'
      END AS raw_source_type
    FROM public.amazon_envios
  ) distinct_formats
)
SELECT
  '10_FINAL_VERDICT' AS block,
  metric,
  value
FROM stats
CROSS JOIN format_counts
CROSS JOIN LATERAL (
  VALUES
    ('RAW_FORMATS_FOUND', COALESCE(formats, 'UNKNOWN')),
    (
      'ROOT_CAUSE_BACKFILL_FAILURE',
      CASE
        WHEN wrapped_payload_rows > 0
          THEN format(
            'Lifecycle migration searched mainly top-level raw keys; %s rows use nested raw.shipment/raw.item payloads. Verify exact key frequencies in blocks 01-05.',
            wrapped_payload_rows
          )
        ELSE
          'The expected top-level keys are absent or unusable. Verify the actual paths and values in blocks 01-05 before preparing a corrective execution.'
      END
    ),
    (
      'BACKFILL_CAN_BE_RECOVERED_FROM_EXISTING_RAW',
      CASE
        WHEN simulated_created_null = 0
         AND simulated_updated_null = 0
         AND simulated_shipped_null = 0
         AND simulated_discrepancy_null = 0
          THEN 'YES'
        WHEN simulated_created_null < original_created_null
          OR simulated_updated_null < original_updated_null
          OR simulated_shipped_null < original_shipped_null
          OR simulated_discrepancy_null < original_discrepancy_null
          THEN 'PARTIAL'
        ELSE 'NO'
      END
    ),
    (
      'SIMULATED_DATE_BACKFILL_QUALITY',
      format(
        'created_null=%s; last_updated_null=%s',
        simulated_created_null,
        simulated_updated_null
      )
    ),
    (
      'SIMULATED_QUANTITY_BACKFILL_QUALITY',
      format(
        'shipped_null=%s; expected_null=%s; discrepancy_null=%s',
        simulated_shipped_null,
        simulated_expected_null,
        simulated_discrepancy_null
      )
    ),
    (
      'CORRECTIVE_BACKFILL_REQUIRED',
      CASE
        WHEN original_created_null > 0
          OR original_updated_null > 0
          OR original_shipped_null > 0
          OR original_discrepancy_null > 0
          THEN 'YES'
        ELSE 'NO'
      END
    ),
    ('SUPABASE_WRITES', '0'),
    ('AMAZON_LIVE_CALLS', '0')
) verdict(metric, value);
