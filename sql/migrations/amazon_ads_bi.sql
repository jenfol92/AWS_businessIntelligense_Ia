-- Amazon Ads BI: tabla amazon_ads_reports (ALTER idempotente), v_ads_fba, v_profit_real_fba
-- Arquitectura: Payments → v_ventas_fba_payments | Ads → v_ads_fba | JOIN → v_profit_real_fba

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla base (solo si aún no existe en el proyecto)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.amazon_ads_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha date NOT NULL,
  asin text,
  sku text,
  producto_id uuid REFERENCES public.productos(id) ON DELETE SET NULL,
  campaign_name text,
  ad_group_name text,
  impressions bigint,
  clicks bigint,
  cost numeric,
  attributed_sales numeric,
  attributed_units numeric,
  marketplace_country text,
  canal text DEFAULT 'FBA',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Columnas nuevas / compatibilidad (no borra datos)
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS sku_original text;
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS sku_limpio text;
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS targeting text;
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS match_type text;
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS currency text DEFAULT 'EUR';
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS row_hash text;
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS imported_at timestamptz DEFAULT now();
ALTER TABLE public.amazon_ads_reports ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_amazon_ads_reports_prod_fecha
  ON public.amazon_ads_reports (producto_id, fecha);

CREATE UNIQUE INDEX IF NOT EXISTS amazon_ads_reports_row_hash_uidx
  ON public.amazon_ads_reports (row_hash)
  WHERE row_hash IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- v_ads_fba: agregado diario por producto / país / canal
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_ads_fba AS
SELECT
  r.producto_id,
  r.fecha::date AS fecha,
  r.marketplace_country AS pais,
  COALESCE(NULLIF(btrim(r.canal), ''), 'FBA') AS canal_venta,
  SUM(COALESCE(r.cost, 0))::numeric AS publicidad_gasto_ads,
  SUM(COALESCE(r.attributed_sales, 0))::numeric AS ventas_atribuidas_ads,
  SUM(COALESCE(r.attributed_units, 0))::numeric AS unidades_atribuidas_ads,
  SUM(COALESCE(r.clicks, 0))::bigint AS clicks,
  SUM(COALESCE(r.impressions, 0))::bigint AS impresiones,
  CASE
    WHEN SUM(COALESCE(r.attributed_sales, 0)) > 0
      THEN SUM(COALESCE(r.cost, 0)) / SUM(COALESCE(r.attributed_sales, 0))
    ELSE NULL
  END AS acos_ads,
  CASE
    WHEN SUM(COALESCE(r.cost, 0)) > 0
      THEN SUM(COALESCE(r.attributed_sales, 0)) / SUM(COALESCE(r.cost, 0))
    ELSE NULL
  END AS roas_ads
FROM public.amazon_ads_reports r
WHERE r.producto_id IS NOT NULL
  AND r.marketplace_country IS NOT NULL
GROUP BY
  r.producto_id,
  r.fecha::date,
  r.marketplace_country,
  COALESCE(NULLIF(btrim(r.canal), ''), 'FBA');

COMMENT ON VIEW public.v_ads_fba IS
  'Agregado diario de gasto y métricas Ads por producto; grain alineado con v_ventas_fba_payments.';

-- ─────────────────────────────────────────────────────────────────────────────
-- v_profit_real_fba: Payments + Ads (publicidad real desde Ads)
-- ─────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.v_profit_real_fba CASCADE;

CREATE VIEW public.v_profit_real_fba AS
SELECT
  p.producto_id,
  p.fecha,
  p.pais,
  p.canal_venta,
  p.unidades_vendidas,
  p.ingresos_brutos,
  p.iva_pagado_cuota,
  COALESCE(a.publicidad_gasto_ads, 0)::numeric AS publicidad_gasto_ads,
  p.comisiones_amazon_referral,
  p.comisiones_amazon_fba,
  p.otras_comisiones_transaccion,
  p.coste_devoluciones,
  p.total_payments,
  COALESCE(a.ventas_atribuidas_ads, 0)::numeric AS ventas_atribuidas_ads,
  COALESCE(a.unidades_atribuidas_ads, 0)::numeric AS unidades_atribuidas_ads,
  COALESCE(a.clicks, 0)::bigint AS clicks,
  COALESCE(a.impresiones, 0)::bigint AS impresiones,
  a.acos_ads,
  a.roas_ads
FROM public.v_ventas_fba_payments p
LEFT JOIN public.v_ads_fba a
  ON a.producto_id = p.producto_id
  AND a.fecha = p.fecha
  AND a.pais = p.pais
  AND a.canal_venta = p.canal_venta;

COMMENT ON VIEW public.v_profit_real_fba IS
  'Vista BI FBA: métricas Payments + publicidad y atribución desde Amazon Ads (LEFT JOIN).';
