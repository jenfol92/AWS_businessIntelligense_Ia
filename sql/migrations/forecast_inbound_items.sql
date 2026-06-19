-- Forecast inbound: contenedores → órdenes → items, con unidades pendientes.

ALTER TABLE public.contenedores
  ADD COLUMN IF NOT EXISTS fecha_eta_original date;

COMMENT ON COLUMN public.contenedores.fecha_eta_original IS
  'ETA original del contenedor; retraso = fecha_eta_estimada - fecha_eta_original.';

CREATE OR REPLACE VIEW public.v_forecast_inbound_items AS
WITH applied_by_item AS (
  SELECT
    orden_item_id,
    SUM(cantidad)::integer AS unidades_aplicadas
  FROM public.contenedor_stock_aplicado
  WHERE revertido_at IS NULL
    AND orden_item_id IS NOT NULL
  GROUP BY orden_item_id
),
applied_by_container_product AS (
  SELECT
    contenedor_id,
    producto_id,
    SUM(cantidad)::integer AS unidades_aplicadas
  FROM public.contenedor_stock_aplicado
  WHERE revertido_at IS NULL
    AND orden_item_id IS NULL
  GROUP BY contenedor_id, producto_id
),
confirmed AS (
  SELECT
    c.id AS contenedor_id,
    c.identificador_embarque,
    c.estado AS estado_contenedor,
    c.fecha_eta_original,
    c.fecha_eta_estimada,
    CASE
      WHEN c.fecha_eta_original IS NOT NULL AND c.fecha_eta_estimada IS NOT NULL
        THEN GREATEST(0, c.fecha_eta_estimada - c.fecha_eta_original)
      ELSE 0
    END::integer AS retraso_dias,
    oc.id AS orden_id,
    oc.numero_orden,
    oc.destino AS destino_orden,
    oi.id AS orden_item_id,
    oi.producto_id,
    oi.cantidad::integer AS unidades_orden,
    (
      COALESCE(abi.unidades_aplicadas, 0)
      + CASE
          WHEN COALESCE(abi.unidades_aplicadas, 0) > 0 THEN 0
          ELSE COALESCE(acp.unidades_aplicadas, 0)
        END
    )::integer AS unidades_aplicadas,
    GREATEST(
      0,
      oi.cantidad::integer
        - COALESCE(abi.unidades_aplicadas, 0)
        - CASE
            WHEN COALESCE(abi.unidades_aplicadas, 0) > 0 THEN 0
            ELSE COALESCE(acp.unidades_aplicadas, 0)
          END
    )::integer AS unidades_pendientes,
    COALESCE(oi.coste_unitario_eur, 0)::numeric AS coste_unitario_eur,
    c.tipo_contenedor,
    c.puerto_llegada,
    c.transitario,
    true AS has_contenedor,
    'confirmed'::text AS confidence
  FROM public.contenedor_ordenes co
  JOIN public.contenedores c ON c.id = co.contenedor_id
  JOIN public.ordenes_compra oc ON oc.id = co.orden_id
  JOIN public.orden_items oi ON oi.orden_id = oc.id
  LEFT JOIN applied_by_item abi ON abi.orden_item_id = oi.id
  LEFT JOIN applied_by_container_product acp
    ON acp.contenedor_id = c.id
   AND acp.producto_id = oi.producto_id
  WHERE lower(trim(coalesce(oc.estado, ''))) = 'confirmado'
),
provisional AS (
  SELECT
    NULL::uuid AS contenedor_id,
    NULL::text AS identificador_embarque,
    NULL::text AS estado_contenedor,
    NULL::date AS fecha_eta_original,
    oc.eta AS fecha_eta_estimada,
    0::integer AS retraso_dias,
    oc.id AS orden_id,
    oc.numero_orden,
    oc.destino AS destino_orden,
    oi.id AS orden_item_id,
    oi.producto_id,
    oi.cantidad::integer AS unidades_orden,
    COALESCE(abi.unidades_aplicadas, 0)::integer AS unidades_aplicadas,
    GREATEST(0, oi.cantidad::integer - COALESCE(abi.unidades_aplicadas, 0))::integer AS unidades_pendientes,
    COALESCE(oi.coste_unitario_eur, 0)::numeric AS coste_unitario_eur,
    NULL::text AS tipo_contenedor,
    NULL::text AS puerto_llegada,
    NULL::text AS transitario,
    false AS has_contenedor,
    'provisional'::text AS confidence
  FROM public.ordenes_compra oc
  JOIN public.orden_items oi ON oi.orden_id = oc.id
  LEFT JOIN public.contenedor_ordenes co ON co.orden_id = oc.id
  LEFT JOIN applied_by_item abi ON abi.orden_item_id = oi.id
  WHERE lower(trim(coalesce(oc.estado, ''))) = 'confirmado'
    AND co.orden_id IS NULL
)
SELECT
  contenedor_id,
  identificador_embarque,
  estado_contenedor,
  fecha_eta_original,
  fecha_eta_estimada,
  retraso_dias,
  orden_id,
  numero_orden,
  destino_orden,
  orden_item_id,
  producto_id,
  unidades_orden,
  unidades_aplicadas,
  unidades_pendientes,
  coste_unitario_eur,
  tipo_contenedor,
  puerto_llegada,
  transitario,
  has_contenedor,
  confidence,
  NULL::text AS forecast_country,
  NULL::text AS forecast_channel,
  NULL::text[] AS warnings
FROM confirmed
UNION ALL
SELECT
  contenedor_id,
  identificador_embarque,
  estado_contenedor,
  fecha_eta_original,
  fecha_eta_estimada,
  retraso_dias,
  orden_id,
  numero_orden,
  destino_orden,
  orden_item_id,
  producto_id,
  unidades_orden,
  unidades_aplicadas,
  unidades_pendientes,
  coste_unitario_eur,
  tipo_contenedor,
  puerto_llegada,
  transitario,
  has_contenedor,
  confidence,
  NULL::text AS forecast_country,
  NULL::text AS forecast_channel,
  NULL::text[] AS warnings
FROM provisional;

COMMENT ON VIEW public.v_forecast_inbound_items IS
  'Inbound para forecast: ETA de contenedor si existe; fallback ETA orden sin contenedor (provisional).';

-- Diagnóstico: contenedor vs órdenes vinculadas (requiere contenedor_items si existe).
DO $diag$
BEGIN
  IF to_regclass('public.contenedor_items') IS NOT NULL THEN
    EXECUTE $sql$
      COMMENT ON VIEW public.v_forecast_inbound_items IS
        'Inbound forecast. Validar cargas con: SELECT c.identificador_embarque, ci.producto_id, ci.unidades_total, sum(oi.cantidad) FROM contenedores c JOIN contenedor_items ci ON ci.contenedor_id = c.id LEFT JOIN contenedor_ordenes co ON co.contenedor_id = c.id LEFT JOIN orden_items oi ON oi.orden_id = co.orden_id AND oi.producto_id = ci.producto_id GROUP BY 1,2,3;';
    $sql$;
  END IF;
END;
$diag$;
