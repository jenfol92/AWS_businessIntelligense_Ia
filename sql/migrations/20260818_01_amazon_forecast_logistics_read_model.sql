BEGIN;

-- Evidence registry only. No row approves Pan-EU by default.
CREATE TABLE IF NOT EXISTS public.amazon_inventory_pool_equivalence_evidence (
  evidence_id text PRIMARY KEY,
  representative_marketplace_id text NOT NULL,
  comparison_marketplace_id text NOT NULL,
  seller_sku_set_hash text NOT NULL,
  exact_signature_match boolean NOT NULL DEFAULT false,
  unexpected_pagination boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (representative_marketplace_id <> comparison_marketplace_id),
  CHECK (jsonb_typeof(evidence) = 'object')
);

COMMENT ON TABLE public.amazon_inventory_pool_equivalence_evidence IS
  'ES-vs-DE equivalence evidence. PAN_EU is invalid until an APPROVED row exists.';

-- Latest physical stock from BY_COUNTRY, summed only within the same product/country.
-- raw.sources retains Seller SKU provenance in fba_country_stock_daily.
CREATE OR REPLACE VIEW public.v_amazon_fba_physical_stock_country_read_model AS
WITH latest AS (
  SELECT DISTINCT ON (producto_id, sku_limpio, marketplace_country, source)
    producto_id, sku_limpio, marketplace_country, snapshot_date, stock_fba, raw, source
  FROM public.fba_country_stock_daily
  ORDER BY producto_id, sku_limpio, marketplace_country, source, snapshot_date DESC, created_at DESC
)
SELECT
  producto_id,
  sku_limpio,
  marketplace_country AS country,
  MAX(snapshot_date) AS snapshot_date,
  SUM(stock_fba)::bigint AS stock_fba_country,
  jsonb_agg(jsonb_build_object('sku_limpio', sku_limpio, 'stock_fba', stock_fba, 'raw', raw)) AS seller_sku_contributors,
  MAX(source) AS source
FROM latest
GROUP BY producto_id, sku_limpio, marketplace_country;

-- Combined read model. Operational FBA availability comes only from the
-- marketplace-grained Inventory Summaries view; physical country stock comes
-- only from BY_COUNTRY. No marketplace sum is used for physical stock.
CREATE OR REPLACE VIEW public.v_amazon_forecast_logistics_read_model AS
WITH sales_daily AS (
  SELECT
    vd.producto_id,
    p.sku AS sku_limpio,
    p.asin,
    d.color,
    vd.fecha AS date,
    COALESCE(NULLIF(BTRIM(vd.pais), ''), 'UNKNOWN') AS country,
    COALESCE(NULLIF(BTRIM(vd.canal_venta), ''), 'UNKNOWN') AS sales_channel,
    SUM(COALESCE(vd.unidades_vendidas, 0))::numeric AS sales_units_daily
  FROM public.ventas_diarias vd
  JOIN public.productos p ON p.id = vd.producto_id
  LEFT JOIN public.producto_detalle d ON d.producto_id = p.id
  GROUP BY vd.producto_id, p.sku, p.asin, d.color, vd.fecha,
           COALESCE(NULLIF(BTRIM(vd.pais), ''), 'UNKNOWN'),
           COALESCE(NULLIF(BTRIM(vd.canal_venta), ''), 'UNKNOWN')
), physical AS (
  SELECT producto_id, sku_limpio, country, stock_fba_country, snapshot_date
  FROM public.v_amazon_fba_physical_stock_country_read_model
), inbound AS (
  SELECT
    v.producto_id,
    NULLIF(UPPER(BTRIM(s.destination_country)), '') AS country,
    SUM(v.unidades_pendientes)::numeric AS inbound_country_confirmed
  FROM public.v_forecast_inbound_items v
  JOIN public.amazon_inbound_shipments s ON s.shipment_id = v.identificador_embarque
  WHERE v.confidence = 'confirmed'
    AND v.unidades_pendientes > 0
    AND COALESCE(UPPER(BTRIM(s.estado_amazon)), '') NOT IN ('CANCELLED', 'DELETED')
    AND NULLIF(UPPER(BTRIM(s.destination_country)), '') IS NOT NULL
  GROUP BY v.producto_id, NULLIF(UPPER(BTRIM(s.destination_country)), '')
), operational AS (
  SELECT
    producto_id,
    sku_limpio,
    marketplace_id,
    SUM(fba_available)::numeric AS fba_available_operational,
    SUM(fba_inbound)::numeric AS inbound_operational,
    MAX(observed_at) AS operational_observed_at,
    MAX(confidence) AS operational_confidence
  FROM public.v_latest_amazon_fba_inventory_by_product_marketplace
  GROUP BY producto_id, sku_limpio, marketplace_id
), grain AS (
  SELECT producto_id, sku_limpio, country, date, sales_channel FROM sales_daily
  UNION
  SELECT producto_id, sku_limpio, country, snapshot_date, 'FBA' FROM physical
  UNION
  SELECT producto_id, p.sku, country, CURRENT_DATE, 'FBA'
  FROM inbound i JOIN public.productos p ON p.id = i.producto_id
)
SELECT
  g.producto_id,
  g.sku_limpio,
  p.asin,
  d.color,
  g.country,
  g.date,
  g.sales_channel,
  COALESCE(sd.sales_units_daily, 0)::numeric AS sales_units_daily,
  SUM(COALESCE(sd.sales_units_daily, 0)) OVER w7::numeric AS sales_units_7d,
  SUM(COALESCE(sd.sales_units_daily, 0)) OVER w30::numeric AS sales_units_30d,
  (SUM(COALESCE(sd.sales_units_daily, 0)) OVER w7 / 7)::numeric AS avg_daily_sales_7d,
  (SUM(COALESCE(sd.sales_units_daily, 0)) OVER w30 / 30)::numeric AS avg_daily_sales_30d,
  COALESCE(ph.stock_fba_country, 0)::numeric AS stock_fba_country,
  COALESCE(i.inbound_country_confirmed, 0)::numeric AS inbound_country_confirmed,
  COALESCE(o.fba_available_operational, 0)::numeric AS fba_available_operational,
  COALESCE(o.inbound_operational, 0)::numeric AS inbound_operational,
  COALESCE(psc.lead_time_produccion_dias, 0) + COALESCE(psc.lead_time_transporte_dias, 0) + COALESCE(psc.lead_time_aduana_dias, 0) AS lead_time_days,
  COALESCE(psc.stock_seguridad_dias, 0)::numeric AS safety_stock_days,
  CASE WHEN (SUM(COALESCE(sd.sales_units_daily, 0)) OVER w30 / 30) > 0
    THEN COALESCE(ph.stock_fba_country, 0) / (SUM(COALESCE(sd.sales_units_daily, 0)) OVER w30 / 30)
    ELSE NULL END AS days_of_cover,
  ((SUM(COALESCE(sd.sales_units_daily, 0)) OVER w30 / 30) *
    (COALESCE(psc.lead_time_produccion_dias, 0) + COALESCE(psc.lead_time_transporte_dias, 0) + COALESCE(psc.lead_time_aduana_dias, 0)))::numeric AS projected_demand_during_lead_time,
  ((SUM(COALESCE(sd.sales_units_daily, 0)) OVER w30 / 30) * COALESCE(psc.stock_seguridad_dias, 0))::numeric AS safety_stock,
  GREATEST(0, ((SUM(COALESCE(sd.sales_units_daily, 0)) OVER w30 / 30) *
    (COALESCE(psc.lead_time_produccion_dias, 0) + COALESCE(psc.lead_time_transporte_dias, 0) + COALESCE(psc.lead_time_aduana_dias, 0) + COALESCE(psc.stock_seguridad_dias, 0))) -
    COALESCE(ph.stock_fba_country, 0) - COALESCE(i.inbound_country_confirmed, 0))::numeric AS projected_shortage,
  ph.snapshot_date AS physical_stock_snapshot_date,
  o.operational_observed_at,
  o.operational_confidence,
  'ventas_diarias'::text AS sales_source,
  'GET_AFN_INVENTORY_DATA_BY_COUNTRY'::text AS physical_stock_source,
  'v_latest_amazon_fba_inventory_by_product_marketplace'::text AS operational_stock_source
FROM grain g
JOIN public.productos p ON p.id = g.producto_id
LEFT JOIN public.producto_detalle d ON d.producto_id = p.id
LEFT JOIN sales_daily sd ON sd.producto_id = g.producto_id AND sd.date = g.date AND sd.country = g.country AND sd.sales_channel = g.sales_channel
LEFT JOIN physical ph ON ph.producto_id = g.producto_id AND ph.sku_limpio = g.sku_limpio AND ph.country = g.country
LEFT JOIN inbound i ON i.producto_id = g.producto_id AND i.country = g.country
LEFT JOIN public.amazon_marketplaces am ON UPPER(BTRIM(am.code)) = UPPER(BTRIM(g.country))
LEFT JOIN operational o ON o.producto_id = g.producto_id AND o.sku_limpio = g.sku_limpio AND o.marketplace_id = am.id
LEFT JOIN public.producto_supply_config psc ON psc.producto_id = g.producto_id
WINDOW
  w7 AS (PARTITION BY g.producto_id, g.country, g.sales_channel ORDER BY g.date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW),
  w30 AS (PARTITION BY g.producto_id, g.country, g.sales_channel ORDER BY g.date ROWS BETWEEN 29 PRECEDING AND CURRENT ROW);

COMMENT ON VIEW public.v_amazon_forecast_logistics_read_model IS
  'Read model forecast/logistica; no ejecuta sync, no suma marketplaces, separa Inventory Summaries operativo de BY_COUNTRY fisico.';

COMMIT;
