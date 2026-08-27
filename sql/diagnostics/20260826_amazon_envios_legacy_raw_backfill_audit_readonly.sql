-- AUDITORÍA READ-ONLY — raw legacy de Amazon Envíos
-- No crea objetos, no abre transacciones y no modifica datos.
-- Ejecutar todas las sentencias en Supabase SQL Editor y conservar los resultados.

-- 0. Baseline
SELECT
  COUNT(*) AS rows_audited,
  COUNT(DISTINCT shipment_id) AS shipments_audited
FROM public.amazon_envios;

-- 1. Keys de primer nivel.
SELECT
  e.key AS raw_top_level_key,
  jsonb_typeof(e.value) AS value_type,
  COUNT(*) AS rows_present,
  (ARRAY_AGG(DISTINCT left(e.value #>> '{}', 120))
    FILTER (WHERE jsonb_typeof(e.value) NOT IN ('object', 'array')))[1:5] AS sample_values
FROM public.amazon_envios ae
CROSS JOIN LATERAL jsonb_each(COALESCE(ae.raw, '{}'::jsonb)) e
GROUP BY e.key, jsonb_typeof(e.value)
ORDER BY rows_present DESC, raw_top_level_key;

-- 2. Todos los paths nested. Incluye objetos y arrays detectados, no sólo nombres asumidos.
WITH RECURSIVE raw_walk AS (
  SELECT
    ae.id,
    ARRAY[]::text[] AS path_parts,
    NULL::text AS key_name,
    COALESCE(ae.raw, '{}'::jsonb) AS value,
    0 AS depth
  FROM public.amazon_envios ae

  UNION ALL

  SELECT
    w.id,
    w.path_parts || child.key_name,
    child.key_name,
    child.value,
    w.depth + 1
  FROM raw_walk w
  CROSS JOIN LATERAL (
    SELECT obj.key AS key_name, obj.value
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value ELSE '{}'::jsonb END
    ) obj

    UNION ALL

    SELECT (arr.ordinality - 1)::text, arr.value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value ELSE '[]'::jsonb END
    ) WITH ORDINALITY arr(value, ordinality)
  ) child
  WHERE w.depth < 12
)
SELECT
  array_to_string(path_parts, '.') AS raw_nested_path,
  jsonb_typeof(value) AS value_type,
  COUNT(DISTINCT id) AS rows_present,
  (ARRAY_AGG(DISTINCT left(value #>> '{}', 120))
    FILTER (WHERE jsonb_typeof(value) NOT IN ('object', 'array')))[1:5] AS sample_values
FROM raw_walk
WHERE depth > 0
GROUP BY path_parts, jsonb_typeof(value)
ORDER BY path_parts;

-- 3. Inventario exhaustivo de keys de fecha realmente presentes.
-- key_normalized elimina diferencias de mayúsculas, guiones y underscores.
WITH RECURSIVE raw_walk AS (
  SELECT ae.id, ARRAY[]::text[] AS path_parts, NULL::text AS key_name,
         COALESCE(ae.raw, '{}'::jsonb) AS value, 0 AS depth
  FROM public.amazon_envios ae
  UNION ALL
  SELECT w.id, w.path_parts || child.key_name, child.key_name, child.value, w.depth + 1
  FROM raw_walk w
  CROSS JOIN LATERAL (
    SELECT obj.key AS key_name, obj.value
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value ELSE '{}'::jsonb END
    ) obj
    UNION ALL
    SELECT (arr.ordinality - 1)::text, arr.value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value ELSE '[]'::jsonb END
    ) WITH ORDINALITY arr(value, ordinality)
  ) child
  WHERE w.depth < 12
), date_keys AS (
  SELECT *,
    lower(regexp_replace(COALESCE(key_name, ''), '[^a-zA-Z0-9]', '', 'g')) AS key_normalized
  FROM raw_walk
)
SELECT
  key_name AS key,
  array_to_string(path_parts, '.') AS raw_path,
  key_normalized,
  CASE
    WHEN key_normalized IN (
      'createdat', 'createddate', 'shipmentcreateddate',
      'creationdate', 'createdatamazon'
    ) THEN 'CREATED_CANDIDATE'
    WHEN key_normalized IN (
      'updatedat', 'lastupdatedat', 'lastupdateddate',
      'updateddate', 'updatedatamazon'
    ) THEN 'UPDATED_CANDIDATE'
    ELSE 'OTHER_DATE_LIKE'
  END AS candidate_type,
  COUNT(DISTINCT id) AS rows_present,
  (ARRAY_AGG(DISTINCT left(value #>> '{}', 120))
    FILTER (WHERE jsonb_typeof(value) NOT IN ('object', 'array')))[1:8] AS sample_values
FROM date_keys
WHERE key_normalized ~ '(created|creation|updated|date)'
GROUP BY key_name, path_parts, key_normalized
ORDER BY candidate_type, rows_present DESC, raw_path;

-- 4. Inventario exhaustivo de keys de cantidad realmente presentes.
WITH RECURSIVE raw_walk AS (
  SELECT ae.id, ARRAY[]::text[] AS path_parts, NULL::text AS key_name,
         COALESCE(ae.raw, '{}'::jsonb) AS value, 0 AS depth
  FROM public.amazon_envios ae
  UNION ALL
  SELECT w.id, w.path_parts || child.key_name, child.key_name, child.value, w.depth + 1
  FROM raw_walk w
  CROSS JOIN LATERAL (
    SELECT obj.key AS key_name, obj.value
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value ELSE '{}'::jsonb END
    ) obj
    UNION ALL
    SELECT (arr.ordinality - 1)::text, arr.value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value ELSE '[]'::jsonb END
    ) WITH ORDINALITY arr(value, ordinality)
  ) child
  WHERE w.depth < 12
), quantity_keys AS (
  SELECT *,
    lower(regexp_replace(COALESCE(key_name, ''), '[^a-zA-Z0-9]', '', 'g')) AS key_normalized
  FROM raw_walk
)
SELECT
  key_name AS key,
  array_to_string(path_parts, '.') AS raw_path,
  key_normalized,
  CASE
    WHEN key_normalized IN ('quantityshipped', 'shippedquantity') THEN 'SHIPPED_CANDIDATE'
    WHEN key_normalized IN ('quantityreceived', 'receivedquantity') THEN 'RECEIVED_CANDIDATE'
    WHEN key_normalized IN (
      'expected', 'expectedquantity', 'quantityexpected',
      'quantity', 'quantityincase'
    ) THEN 'EXPECTED_CANDIDATE'
    ELSE 'OTHER_QUANTITY_LIKE'
  END AS candidate_type,
  COUNT(DISTINCT id) AS rows_present,
  (ARRAY_AGG(DISTINCT left(value #>> '{}', 120))
    FILTER (WHERE jsonb_typeof(value) NOT IN ('object', 'array')))[1:8] AS sample_values
FROM quantity_keys
WHERE key_normalized ~ '(quantity|expected|shipped|received)'
GROUP BY key_name, path_parts, key_normalized
ORDER BY candidate_type, rows_present DESC, raw_path;

-- 5. Clasificación indicativa del payload por marcadores observados.
-- ShipmentId por sí solo no clasifica, porque puede aparecer en ambas APIs.
WITH RECURSIVE raw_walk AS (
  SELECT ae.id, ae.shipment_id, ARRAY[]::text[] AS path_parts,
         NULL::text AS key_name, COALESCE(ae.raw, '{}'::jsonb) AS value, 0 AS depth
  FROM public.amazon_envios ae
  UNION ALL
  SELECT w.id, w.shipment_id, w.path_parts || child.key_name,
         child.key_name, child.value, w.depth + 1
  FROM raw_walk w
  CROSS JOIN LATERAL (
    SELECT obj.key AS key_name, obj.value
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value ELSE '{}'::jsonb END
    ) obj
    UNION ALL
    SELECT (arr.ordinality - 1)::text, arr.value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value ELSE '[]'::jsonb END
    ) WITH ORDINALITY arr(value, ordinality)
  ) child
  WHERE w.depth < 12
), markers AS (
  SELECT
    id,
    bool_or(lower(regexp_replace(COALESCE(key_name, ''), '[^a-zA-Z0-9]', '', 'g'))
      IN ('quantityshipped','quantityreceived','shipmentstatus','sellercentral')) AS has_v0,
    bool_or(lower(regexp_replace(COALESCE(key_name, ''), '[^a-zA-Z0-9]', '', 'g'))
      IN ('inboundplanid','placementoptionid','transportationoptionid',
          'destination','msku','prepowner','labelowner')) AS has_v2024
  FROM raw_walk
  GROUP BY id
), classified AS (
  SELECT
    CASE
      WHEN has_v0 AND has_v2024 THEN 'MIXED'
      WHEN has_v0 THEN 'V0'
      WHEN has_v2024 THEN 'V2024'
      ELSE 'UNKNOWN'
    END AS raw_source_type
  FROM markers
)
SELECT raw_source_type, COUNT(*) AS rows
FROM classified
GROUP BY raw_source_type
ORDER BY raw_source_type;

-- 6. Muestra: una fila por estado solicitado y una por cada estado adicional.
-- No selecciona credenciales ni columnas ajenas a amazon_envios.raw.
WITH ranked AS (
  SELECT
    ae.*,
    row_number() OVER (
      PARTITION BY COALESCE(upper(trim(estado)), '(NULL)')
      ORDER BY shipment_id, sku
    ) AS rn
  FROM public.amazon_envios ae
)
SELECT
  shipment_id,
  sku,
  estado,
  ARRAY(SELECT jsonb_object_keys(COALESCE(raw, '{}'::jsonb))) AS raw_top_level_keys,
  jsonb_path_query_array(
    COALESCE(raw, '{}'::jsonb),
    'strict $.**.* ? (@.type() == "string" && @ like_regex ".*[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}.*")'
  ) AS possible_dates,
  jsonb_path_query_array(
    COALESCE(raw, '{}'::jsonb),
    'strict $.**.* ? (@.type() == "number")'
  ) AS possible_numeric_values
FROM ranked
WHERE rn = 1
ORDER BY
  CASE upper(trim(estado)) WHEN 'WORKING' THEN 0 WHEN 'RECEIVING' THEN 1 ELSE 2 END,
  estado;

-- 7. Simulación exacta, sin UPDATE.
-- Prioridad:
--   created: fecha real encontrada en raw; sólo después fecha_creacion.
--   updated: fecha real encontrada en raw; sin imported_at ni otro fallback.
--   shipped: sólo una key semánticamente shipped; nunca expected.
--   expected: key expected/quantity o cantidad_esperada.
--   discrepancy: shipped - received sólo si ambas magnitudes existen.
WITH RECURSIVE raw_walk AS (
  SELECT
    ae.id, ae.shipment_id, ae.sku, ae.estado, ae.fecha_creacion,
    ae.cantidad_recibida, ae.cantidad_esperada,
    ae.amazon_created_at, ae.amazon_last_updated_at,
    ae.quantity_shipped, ae.quantity_expected, ae.discrepancy_quantity,
    ARRAY[]::text[] AS path_parts,
    NULL::text AS key_name,
    COALESCE(ae.raw, '{}'::jsonb) AS value,
    0 AS depth
  FROM public.amazon_envios ae
  UNION ALL
  SELECT
    w.id, w.shipment_id, w.sku, w.estado, w.fecha_creacion,
    w.cantidad_recibida, w.cantidad_esperada,
    w.amazon_created_at, w.amazon_last_updated_at,
    w.quantity_shipped, w.quantity_expected, w.discrepancy_quantity,
    w.path_parts || child.key_name, child.key_name, child.value, w.depth + 1
  FROM raw_walk w
  CROSS JOIN LATERAL (
    SELECT obj.key AS key_name, obj.value
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value ELSE '{}'::jsonb END
    ) obj
    UNION ALL
    SELECT (arr.ordinality - 1)::text, arr.value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value ELSE '[]'::jsonb END
    ) WITH ORDINALITY arr(value, ordinality)
  ) child
  WHERE w.depth < 12
), scalar_candidates AS (
  SELECT
    *,
    value #>> '{}' AS scalar_value,
    lower(regexp_replace(COALESCE(key_name, ''), '[^a-zA-Z0-9]', '', 'g')) AS key_normalized
  FROM raw_walk
  WHERE jsonb_typeof(value) IN ('string', 'number')
), typed_candidates AS (
  SELECT
    *,
    CASE
      WHEN key_normalized IN (
        'createdatamazon','shipmentcreateddate','createddate','creationdate','createdat'
      ) AND pg_input_is_valid(NULLIF(scalar_value, ''), 'timestamp with time zone')
        THEN 'created'
      WHEN key_normalized IN (
        'updatedatamazon','lastupdateddate','lastupdatedat','updateddate','updatedat'
      ) AND pg_input_is_valid(NULLIF(scalar_value, ''), 'timestamp with time zone')
        THEN 'updated'
      WHEN key_normalized IN ('quantityshipped','shippedquantity')
        AND scalar_value ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN 'shipped'
      WHEN key_normalized IN ('quantityreceived','receivedquantity')
        AND scalar_value ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN 'received'
      WHEN key_normalized IN (
        'expectedquantity','quantityexpected','expected','quantity','quantityincase'
      ) AND scalar_value ~ '^-?[0-9]+([.][0-9]+)?$'
        THEN 'expected'
      ELSE NULL
    END AS candidate_type
  FROM scalar_candidates
), ranked_candidates AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY id, candidate_type
      ORDER BY
        CASE key_normalized
          WHEN 'createdatamazon' THEN 10
          WHEN 'shipmentcreateddate' THEN 20
          WHEN 'createddate' THEN 30
          WHEN 'creationdate' THEN 40
          WHEN 'createdat' THEN 50
          WHEN 'updatedatamazon' THEN 10
          WHEN 'lastupdateddate' THEN 20
          WHEN 'lastupdatedat' THEN 30
          WHEN 'updateddate' THEN 40
          WHEN 'updatedat' THEN 50
          WHEN 'quantityshipped' THEN 10
          WHEN 'shippedquantity' THEN 20
          WHEN 'quantityreceived' THEN 10
          WHEN 'receivedquantity' THEN 20
          WHEN 'expectedquantity' THEN 10
          WHEN 'quantityexpected' THEN 20
          WHEN 'expected' THEN 30
          WHEN 'quantity' THEN 40
          WHEN 'quantityincase' THEN 50
          ELSE 999
        END,
        depth,
        array_to_string(path_parts, '.')
    ) AS candidate_rank
  FROM typed_candidates
  WHERE candidate_type IS NOT NULL
), picked AS (
  SELECT
    id,
    max(scalar_value) FILTER (WHERE candidate_type = 'created'  AND candidate_rank = 1) AS created_value,
    max(array_to_string(path_parts, '.')) FILTER (
      WHERE candidate_type = 'created' AND candidate_rank = 1
    ) AS created_path,
    max(scalar_value) FILTER (WHERE candidate_type = 'updated'  AND candidate_rank = 1) AS updated_value,
    max(array_to_string(path_parts, '.')) FILTER (
      WHERE candidate_type = 'updated' AND candidate_rank = 1
    ) AS updated_path,
    max(scalar_value) FILTER (WHERE candidate_type = 'shipped'  AND candidate_rank = 1) AS shipped_value,
    max(array_to_string(path_parts, '.')) FILTER (
      WHERE candidate_type = 'shipped' AND candidate_rank = 1
    ) AS shipped_path,
    max(scalar_value) FILTER (WHERE candidate_type = 'received' AND candidate_rank = 1) AS received_value,
    max(array_to_string(path_parts, '.')) FILTER (
      WHERE candidate_type = 'received' AND candidate_rank = 1
    ) AS received_path,
    max(scalar_value) FILTER (WHERE candidate_type = 'expected' AND candidate_rank = 1) AS expected_value,
    max(array_to_string(path_parts, '.')) FILTER (
      WHERE candidate_type = 'expected' AND candidate_rank = 1
    ) AS expected_path
  FROM ranked_candidates
  GROUP BY id
), base AS (
  SELECT DISTINCT ON (id)
    id, shipment_id, sku, estado, fecha_creacion,
    cantidad_recibida, cantidad_esperada,
    amazon_created_at, amazon_last_updated_at,
    quantity_shipped, quantity_expected, discrepancy_quantity
  FROM raw_walk
  ORDER BY id, depth
), simulated AS (
  SELECT
    b.*,
    COALESCE(
      p.created_value::timestamptz,
      b.fecha_creacion::timestamptz
    ) AS simulated_amazon_created_at,
    p.created_path,
    p.updated_value::timestamptz AS simulated_amazon_last_updated_at,
    p.updated_path,
    p.shipped_value::numeric AS simulated_quantity_shipped,
    p.shipped_path,
    COALESCE(p.expected_value::numeric, b.cantidad_esperada::numeric) AS simulated_quantity_expected,
    p.expected_path,
    COALESCE(p.received_value::numeric, b.cantidad_recibida::numeric) AS simulated_quantity_received,
    p.received_path
  FROM base b
  LEFT JOIN picked p USING (id)
), final AS (
  SELECT
    *,
    CASE
      WHEN simulated_quantity_shipped IS NOT NULL
       AND simulated_quantity_received IS NOT NULL
      THEN simulated_quantity_shipped - simulated_quantity_received
      ELSE NULL
    END AS simulated_discrepancy_quantity
  FROM simulated
)
SELECT
  shipment_id,
  sku,
  estado,
  simulated_amazon_created_at,
  COALESCE(created_path, 'FALLBACK:fecha_creacion') AS created_source,
  simulated_amazon_last_updated_at,
  updated_path AS updated_source,
  simulated_quantity_shipped,
  shipped_path AS shipped_source,
  simulated_quantity_expected,
  COALESCE(expected_path, 'FALLBACK:cantidad_esperada') AS expected_source,
  simulated_quantity_received,
  COALESCE(received_path, 'FALLBACK:cantidad_recibida') AS received_source,
  simulated_discrepancy_quantity,
  CASE
    WHEN amazon_created_at IS DISTINCT FROM simulated_amazon_created_at THEN 'CREATED_DIFF;'
    ELSE ''
  END ||
  CASE
    WHEN amazon_last_updated_at IS DISTINCT FROM simulated_amazon_last_updated_at THEN 'UPDATED_DIFF;'
    ELSE ''
  END ||
  CASE
    WHEN quantity_shipped::numeric IS DISTINCT FROM simulated_quantity_shipped THEN 'SHIPPED_DIFF;'
    ELSE ''
  END ||
  CASE
    WHEN quantity_expected::numeric IS DISTINCT FROM simulated_quantity_expected THEN 'EXPECTED_DIFF;'
    ELSE ''
  END ||
  CASE
    WHEN discrepancy_quantity::numeric IS DISTINCT FROM simulated_discrepancy_quantity THEN 'DISCREPANCY_DIFF;'
    ELSE ''
  END AS mismatches
FROM final
ORDER BY shipment_id, sku;

-- 8. Resumen de calidad simulada. Repite la misma política conservadora
-- usando jsonpath sólo para el resumen: shipped nunca cae a expected.
WITH simulated AS (
  SELECT
    ae.*,
    COALESCE(
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.created_at_amazon') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.created_at_amazon') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.created_at') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.created_at') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.ShipmentCreatedDate') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.ShipmentCreatedDate') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.shipmentCreatedDate') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.shipmentCreatedDate') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.CreatedDate') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.CreatedDate') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.creationDate') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.creationDate') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.createdAt') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.createdAt') #>> '{}')::timestamptz
      END,
      fecha_creacion::timestamptz
    ) AS simulated_created,
    COALESCE(
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.updated_at_amazon') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.updated_at_amazon') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.updated_at') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.updated_at') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.LastUpdatedDate') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.LastUpdatedDate') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.lastUpdatedDate') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.lastUpdatedDate') #>> '{}')::timestamptz
      END,
      CASE
        WHEN pg_input_is_valid(
          NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
            'lax $.**.updatedAt') #>> '{}', ''),
          'timestamp with time zone'
        )
        THEN (jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
          'lax $.**.updatedAt') #>> '{}')::timestamptz
      END
    ) AS simulated_updated,
    COALESCE(
      NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
        'lax $.**.QuantityShipped') #>> '{}', '')::numeric,
      NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
        'lax $.**.quantityShipped') #>> '{}', '')::numeric,
      NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
        'lax $.**.quantity_shipped') #>> '{}', '')::numeric
    ) AS simulated_shipped,
    COALESCE(
      NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
        'lax $.**.QuantityReceived') #>> '{}', '')::numeric,
      NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
        'lax $.**.quantityReceived') #>> '{}', '')::numeric,
      NULLIF(jsonb_path_query_first(COALESCE(raw, '{}'::jsonb),
        'lax $.**.quantity_received') #>> '{}', '')::numeric,
      cantidad_recibida::numeric
    ) AS simulated_received
  FROM public.amazon_envios ae
)
SELECT
  COUNT(*) FILTER (WHERE simulated_created IS NULL) AS simulated_created_at_null_rows,
  COUNT(*) FILTER (WHERE simulated_updated IS NULL) AS simulated_last_updated_at_null_rows,
  COUNT(*) FILTER (WHERE simulated_shipped IS NULL) AS simulated_quantity_shipped_null_rows,
  COUNT(*) FILTER (
    WHERE simulated_shipped IS NULL OR simulated_received IS NULL
  ) AS simulated_discrepancy_null_rows
FROM simulated;

-- 9. Genera expresiones candidatas basadas en los paths que existen realmente.
-- Son texto para revisión; esta sentencia no las ejecuta.
WITH RECURSIVE raw_walk AS (
  SELECT ae.id, ARRAY[]::text[] AS path_parts, NULL::text AS key_name,
         COALESCE(ae.raw, '{}'::jsonb) AS value, 0 AS depth
  FROM public.amazon_envios ae
  UNION ALL
  SELECT w.id, w.path_parts || child.key_name, child.key_name, child.value, w.depth + 1
  FROM raw_walk w
  CROSS JOIN LATERAL (
    SELECT obj.key AS key_name, obj.value
    FROM jsonb_each(
      CASE WHEN jsonb_typeof(w.value) = 'object' THEN w.value ELSE '{}'::jsonb END
    ) obj
    UNION ALL
    SELECT (arr.ordinality - 1)::text, arr.value
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(w.value) = 'array' THEN w.value ELSE '[]'::jsonb END
    ) WITH ORDINALITY arr(value, ordinality)
  ) child
  WHERE w.depth < 12
), paths AS (
  SELECT DISTINCT
    path_parts,
    lower(regexp_replace(COALESCE(key_name, ''), '[^a-zA-Z0-9]', '', 'g')) AS key_normalized
  FROM raw_walk
  WHERE jsonb_typeof(value) IN ('string', 'number')
), expressions AS (
  SELECT
    'CREATED' AS expression_type,
    'COALESCE(' ||
      string_agg(
        format(
          'CASE WHEN pg_input_is_valid(NULLIF(raw #>> %L, ''''), ''timestamp with time zone'') THEN (raw #>> %L)::timestamptz END',
          path_parts::text, path_parts::text
        ),
        ', ' ORDER BY array_length(path_parts, 1), path_parts::text
      ) ||
      ', fecha_creacion::timestamptz)' AS proposed_expression
  FROM paths
  WHERE key_normalized IN (
    'createdatamazon','shipmentcreateddate','createddate','creationdate','createdat'
  )

  UNION ALL

  SELECT
    'LAST_UPDATED',
    'COALESCE(' ||
      string_agg(
        format(
          'CASE WHEN pg_input_is_valid(NULLIF(raw #>> %L, ''''), ''timestamp with time zone'') THEN (raw #>> %L)::timestamptz END',
          path_parts::text, path_parts::text
        ),
        ', ' ORDER BY array_length(path_parts, 1), path_parts::text
      ) ||
      ')' AS proposed_expression
  FROM paths
  WHERE key_normalized IN (
    'updatedatamazon','lastupdateddate','lastupdatedat','updateddate','updatedat'
  )

  UNION ALL

  SELECT
    'QUANTITY_SHIPPED',
    'COALESCE(' ||
      string_agg(
        format('NULLIF(raw #>> %L, '''')::numeric', path_parts::text),
        ', ' ORDER BY array_length(path_parts, 1), path_parts::text
      ) ||
      ')' AS proposed_expression
  FROM paths
  WHERE key_normalized IN ('quantityshipped','shippedquantity')

  UNION ALL

  SELECT
    'QUANTITY_EXPECTED',
    'COALESCE(' ||
      string_agg(
        format('NULLIF(raw #>> %L, '''')::numeric', path_parts::text),
        ', ' ORDER BY array_length(path_parts, 1), path_parts::text
      ) ||
      ', cantidad_esperada::numeric)' AS proposed_expression
  FROM paths
  WHERE key_normalized IN (
    'expectedquantity','quantityexpected','expected','quantity','quantityincase'
  )
)
SELECT
  expression_type,
  COALESCE(
    proposed_expression,
    CASE expression_type
      WHEN 'CREATED' THEN 'fecha_creacion::timestamptz'
      ELSE 'NULL /* no compatible raw key found */'
    END
  ) AS proposed_expression
FROM expressions
ORDER BY expression_type;

-- El resultado de esta auditoría debe revisarse antes de crear
-- sql/repairs/20260826_amazon_envios_lifecycle_backfill_fix.PROPOSAL.sql.
