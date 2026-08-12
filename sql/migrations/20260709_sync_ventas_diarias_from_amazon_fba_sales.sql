-- Sync FBA SP-API daily sales into ventas_diarias.
-- Atomic DELETE + INSERT scoped to source = spapi_fba_customer_shipment_sales.

CREATE OR REPLACE FUNCTION public.sync_ventas_diarias_from_amazon_fba_sales(
  p_start_date date,
  p_end_date date,
  p_marketplace_ids text[] DEFAULT NULL,
  p_tipo_cliente text DEFAULT 'B2C',
  p_source text DEFAULT 'spapi_fba_customer_shipment_sales'
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
  v_orphan_rows integer := 0;
  v_orphan_units numeric := 0;
  v_skipped_source_conflicts integer := 0;
  v_marketplaces text[] := ARRAY[]::text[];
  v_orphan_marketplaces text[] := ARRAY[]::text[];
  v_orphan_countries text[] := ARRAY[]::text[];
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date >= p_end_date THEN
    RAISE EXCEPTION 'Invalid date range: % - %', p_start_date, p_end_date;
  END IF;

  IF COALESCE(NULLIF(BTRIM(p_source), ''), 'spapi_fba_customer_shipment_sales') <> 'spapi_fba_customer_shipment_sales' THEN
    RAISE EXCEPTION 'Unsupported source for this sync: %', p_source;
  END IF;

  WITH scoped_marketplaces AS (
    SELECT DISTINCT v.marketplace_id
    FROM public.v_amazon_fba_sales_daily v
    WHERE v.fecha >= p_start_date
      AND v.fecha < p_end_date
      AND (
        p_marketplace_ids IS NULL
        OR cardinality(p_marketplace_ids) = 0
        OR v.marketplace_id = ANY(p_marketplace_ids)
      )
      AND v.marketplace_id IS NOT NULL
      AND BTRIM(v.marketplace_id) <> ''
  )
  SELECT COALESCE(array_agg(marketplace_id ORDER BY marketplace_id), ARRAY[]::text[])
  INTO v_marketplaces
  FROM scoped_marketplaces;

  DELETE FROM public.ventas_diarias vd
  WHERE vd.source = p_source
    AND vd.fecha >= p_start_date
    AND vd.fecha < p_end_date
    AND COALESCE(vd.canal_venta, 'FBA') = 'FBA'
    AND (
      p_marketplace_ids IS NULL
      OR cardinality(p_marketplace_ids) = 0
      OR vd.marketplace_id = ANY(p_marketplace_ids)
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH inserted AS (
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
      v.producto_id,
      v.fecha,
      COALESCE(v.unidades_vendidas, 0)::integer,
      COALESCE(v.ingresos_brutos, 0)::numeric,
      v.pais,
      COALESCE(v.canal_venta, 'FBA'),
      v.moneda,
      COALESCE(NULLIF(BTRIM(p_tipo_cliente), ''), 'B2C'),
      v.marketplace_id,
      p_source
    FROM public.v_amazon_fba_sales_daily v
    WHERE v.fecha >= p_start_date
      AND v.fecha < p_end_date
      AND v.producto_id IS NOT NULL
      AND COALESCE(v.unidades_vendidas, 0) <> 0
      AND (
        p_marketplace_ids IS NULL
        OR cardinality(p_marketplace_ids) = 0
        OR v.marketplace_id = ANY(p_marketplace_ids)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.ventas_diarias existing
        WHERE existing.producto_id = v.producto_id
          AND existing.fecha = v.fecha
          AND existing.pais = v.pais
          AND existing.canal_venta = COALESCE(v.canal_venta, 'FBA')
          AND existing.moneda = v.moneda
          AND existing.tipo_cliente = COALESCE(NULLIF(BTRIM(p_tipo_cliente), ''), 'B2C')
          AND existing.marketplace_id = v.marketplace_id
          AND existing.source IS DISTINCT FROM p_source
      )
    RETURNING unidades_vendidas
  )
  SELECT COUNT(*)::integer, COALESCE(SUM(unidades_vendidas), 0)
  INTO v_inserted, v_units
  FROM inserted;

  SELECT COUNT(*)::integer
  INTO v_skipped_source_conflicts
  FROM public.v_amazon_fba_sales_daily v
  WHERE v.fecha >= p_start_date
    AND v.fecha < p_end_date
    AND v.producto_id IS NOT NULL
    AND COALESCE(v.unidades_vendidas, 0) <> 0
    AND (
      p_marketplace_ids IS NULL
      OR cardinality(p_marketplace_ids) = 0
      OR v.marketplace_id = ANY(p_marketplace_ids)
    )
    AND EXISTS (
      SELECT 1
      FROM public.ventas_diarias existing
      WHERE existing.producto_id = v.producto_id
        AND existing.fecha = v.fecha
        AND existing.pais = v.pais
        AND existing.canal_venta = COALESCE(v.canal_venta, 'FBA')
        AND existing.moneda = v.moneda
        AND existing.tipo_cliente = COALESCE(NULLIF(BTRIM(p_tipo_cliente), ''), 'B2C')
        AND existing.marketplace_id = v.marketplace_id
        AND existing.source IS DISTINCT FROM p_source
    );

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(COALESCE(r.quantity, 0)), 0),
    COALESCE(
      array_agg(DISTINCT r.marketplace_id ORDER BY r.marketplace_id)
        FILTER (WHERE r.marketplace_id IS NOT NULL AND BTRIM(r.marketplace_id) <> ''),
      ARRAY[]::text[]
    ),
    COALESCE(
      array_agg(DISTINCT COALESCE(NULLIF(r.ship_to_country, ''), 'UNKNOWN') ORDER BY COALESCE(NULLIF(r.ship_to_country, ''), 'UNKNOWN')),
      ARRAY[]::text[]
    )
  INTO v_orphan_rows, v_orphan_units, v_orphan_marketplaces, v_orphan_countries
  FROM public.amazon_fba_sales_daily_raw r
  WHERE r.sale_date >= p_start_date
    AND r.sale_date < p_end_date
    AND r.producto_id IS NULL
    AND COALESCE(r.quantity, 0) <> 0
    AND (
      p_marketplace_ids IS NULL
      OR cardinality(p_marketplace_ids) = 0
      OR r.marketplace_id = ANY(p_marketplace_ids)
    );

  RETURN jsonb_build_object(
    'deleted', v_deleted,
    'inserted', v_inserted,
    'units', v_units,
    'orphanRows', v_orphan_rows,
    'orphanUnits', v_orphan_units,
    'skippedSourceConflicts', v_skipped_source_conflicts,
    'marketplaces', v_marketplaces,
    'orphanMarketplaces', v_orphan_marketplaces,
    'orphanCountries', v_orphan_countries
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_ventas_diarias_from_amazon_fba_sales(date, date, text[], text, text) TO service_role;
