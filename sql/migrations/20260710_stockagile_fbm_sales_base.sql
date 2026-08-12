-- Base Stockagile FBM sales -> ventas_diarias.
-- Only Twinly rows with a linked ERP product are eligible for sync.

CREATE TABLE IF NOT EXISTS public.stockagile_orders_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'stockagile_fbm_sales',
  dedupe_key text NOT NULL,
  external_order_id text NOT NULL,
  external_order_line_id text NULL,
  order_date date NOT NULL,
  order_datetime timestamptz NULL,
  sales_channel text NULL,
  marketplace text NULL,
  fulfillment_type text NULL,
  country text NOT NULL DEFAULT 'ES',
  currency text NOT NULL DEFAULT 'EUR',
  order_status text NULL,
  sku_original text NULL,
  sku_limpio text NULL,
  ean_twinly text NULL,
  is_twinly boolean NOT NULL DEFAULT false,
  omit_reason text NULL,
  quantity integer NOT NULL DEFAULT 0,
  gross_amount numeric NOT NULL DEFAULT 0,
  unit_price numeric NULL,
  producto_id uuid NULL REFERENCES public.productos(id),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stockagile_orders_raw
  ADD COLUMN IF NOT EXISTS unit_price numeric NULL;

ALTER TABLE public.stockagile_orders_raw
  ADD COLUMN IF NOT EXISTS dedupe_key text;

ALTER TABLE public.stockagile_orders_raw
  ALTER COLUMN dedupe_key SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_import_batch
  ON public.stockagile_orders_raw (import_batch_id);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_order_date
  ON public.stockagile_orders_raw (order_date);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_producto
  ON public.stockagile_orders_raw (producto_id);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_sku_limpio
  ON public.stockagile_orders_raw (sku_limpio);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_ean_twinly
  ON public.stockagile_orders_raw (ean_twinly);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_is_twinly
  ON public.stockagile_orders_raw (is_twinly);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_omit_reason
  ON public.stockagile_orders_raw (omit_reason);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_source
  ON public.stockagile_orders_raw (source);

CREATE INDEX IF NOT EXISTS idx_stockagile_orders_raw_external_order
  ON public.stockagile_orders_raw (external_order_id);

DROP INDEX IF EXISTS public.ux_stockagile_orders_raw_source_order_line_sku_date;

CREATE UNIQUE INDEX IF NOT EXISTS ux_stockagile_orders_raw_dedupe_key
  ON public.stockagile_orders_raw (dedupe_key);

CREATE OR REPLACE FUNCTION public.sync_ventas_diarias_from_stockagile_fbm_sales(
  p_start_date date,
  p_end_date date,
  p_source text DEFAULT 'stockagile_fbm_sales',
  p_tipo_cliente text DEFAULT 'B2C'
)
RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted integer := 0;
  v_inserted integer := 0;
  v_units numeric := 0;
  v_non_twinly_rows integer := 0;
  v_non_twinly_units numeric := 0;
  v_orphan_twinly_rows integer := 0;
  v_orphan_twinly_units numeric := 0;
  v_skipped_cancelled_rows integer := 0;
  v_skipped_fba_rows integer := 0;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date >= p_end_date THEN
    RAISE EXCEPTION 'Invalid date range: % - %', p_start_date, p_end_date;
  END IF;

  IF COALESCE(NULLIF(BTRIM(p_source), ''), 'stockagile_fbm_sales') <> 'stockagile_fbm_sales' THEN
    RAISE EXCEPTION 'Unsupported source for Stockagile FBM sync: %', p_source;
  END IF;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)
  INTO v_non_twinly_rows, v_non_twinly_units
  FROM public.stockagile_orders_raw
  WHERE order_date >= p_start_date
    AND order_date < p_end_date
    AND source = p_source
    AND COALESCE(is_twinly, false) = false;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)
  INTO v_orphan_twinly_rows, v_orphan_twinly_units
  FROM public.stockagile_orders_raw
  WHERE order_date >= p_start_date
    AND order_date < p_end_date
    AND source = p_source
    AND is_twinly = true
    AND ean_twinly IS NOT NULL
    AND producto_id IS NULL;

  SELECT COUNT(*)::integer
  INTO v_skipped_cancelled_rows
  FROM public.stockagile_orders_raw
  WHERE order_date >= p_start_date
    AND order_date < p_end_date
    AND source = p_source
    AND lower(COALESCE(order_status, '')) IN (
      'cancelled',
      'canceled',
      'cancelado',
      'cancelada',
      'anulado',
      'anulada',
      'void'
    );

  SELECT COUNT(*)::integer
  INTO v_skipped_fba_rows
  FROM public.stockagile_orders_raw
  WHERE order_date >= p_start_date
    AND order_date < p_end_date
    AND source = p_source
    AND lower(COALESCE(fulfillment_type, '')) IN (
      'fba',
      'afn',
      'amazon fulfilled',
      'amazon_fulfilled',
      'amazon-fulfilled'
    );

  DELETE FROM public.ventas_diarias vd
  WHERE vd.source = p_source
    AND vd.fecha >= p_start_date
    AND vd.fecha < p_end_date
    AND COALESCE(vd.canal_venta, 'FBM') = 'FBM';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH eligible AS (
    SELECT
      producto_id,
      order_date,
      COALESCE(NULLIF(country, ''), 'ES') AS country,
      COALESCE(NULLIF(currency, ''), 'EUR') AS currency,
      quantity,
      gross_amount
    FROM public.stockagile_orders_raw
    WHERE order_date >= p_start_date
      AND order_date < p_end_date
      AND source = p_source
      AND is_twinly = true
      AND ean_twinly IS NOT NULL
      AND producto_id IS NOT NULL
      AND COALESCE(quantity, 0) <> 0
      AND lower(COALESCE(order_status, '')) NOT IN (
        'cancelled',
        'canceled',
        'cancelado',
        'cancelada',
        'anulado',
        'anulada',
        'void'
      )
      AND lower(COALESCE(fulfillment_type, '')) NOT IN (
        'fba',
        'afn',
        'amazon fulfilled',
        'amazon_fulfilled',
        'amazon-fulfilled'
      )
  ),
  inserted AS (
    INSERT INTO public.ventas_diarias (
      id,
      producto_id,
      fecha,
      unidades_vendidas,
      ingresos_brutos,
      pais,
      canal_venta,
      moneda,
      tipo_cliente,
      marketplace_id,
      source
    )
    SELECT
      gen_random_uuid(),
      producto_id,
      order_date,
      SUM(quantity)::integer,
      SUM(gross_amount)::numeric,
      country,
      'FBM',
      currency,
      COALESCE(NULLIF(BTRIM(p_tipo_cliente), ''), 'B2C'),
      NULL,
      p_source
    FROM eligible
    GROUP BY producto_id, order_date, country, currency
    RETURNING unidades_vendidas
  )
  SELECT COUNT(*)::integer, COALESCE(SUM(unidades_vendidas), 0)
  INTO v_inserted, v_units
  FROM inserted;

  RETURN jsonb_build_object(
    'deletedPreviousRows', v_deleted,
    'insertedRows', v_inserted,
    'insertedUnits', v_units,
    'nonTwinlyRows', v_non_twinly_rows,
    'nonTwinlyUnits', v_non_twinly_units,
    'orphanTwinlyRows', v_orphan_twinly_rows,
    'orphanTwinlyUnits', v_orphan_twinly_units,
    'skippedCancelledRows', v_skipped_cancelled_rows,
    'skippedFbaRows', v_skipped_fba_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_ventas_diarias_from_stockagile_fbm_sales(date, date, text, text) TO service_role;

COMMENT ON TABLE public.stockagile_orders_raw IS
  'Raw Stockagile FBM sales staging. Only Twinly rows with producto_id sync to ventas_diarias.';

COMMENT ON FUNCTION public.sync_ventas_diarias_from_stockagile_fbm_sales(date, date, text, text) IS
  'Syncs Stockagile FBM Twinly sales into ventas_diarias without touching FBA, All Orders or legacy source null rows.';
