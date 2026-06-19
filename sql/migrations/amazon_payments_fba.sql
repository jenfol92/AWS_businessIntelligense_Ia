-- Amazon Payments (Date Range Report) → vista agregada + sync opcional a ventas_diarias
-- sync_ventas_diarias_fba: solo se crea si NO existe (no sobrescribe tu versión en Supabase).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tablas (IF NOT EXISTS por si ya las creaste en Supabase)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.amazon_payments_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  rows_count integer NOT NULL DEFAULT 0,
  usuario uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.amazon_payments_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid REFERENCES public.amazon_payments_imports(id) ON DELETE SET NULL,
  producto_id uuid REFERENCES public.productos(id) ON DELETE SET NULL,
  sku_original text NOT NULL DEFAULT '',
  sku_limpio text NOT NULL DEFAULT '',
  fecha_transaccion timestamptz NOT NULL,
  fecha_publicacion timestamptz,
  settlement_id text NOT NULL DEFAULT '',
  tipo text NOT NULL DEFAULT '',
  order_id text NOT NULL DEFAULT '',
  descripcion text NOT NULL DEFAULT '',
  cantidad integer NOT NULL DEFAULT 0,
  marketplace text,
  marketplace_country text,
  canal text NOT NULL DEFAULT 'FBA',
  ingresos_producto numeric,
  impuesto_producto numeric,
  comisiones_venta numeric,
  comisiones_fba numeric,
  otras_comisiones_transaccion numeric,
  otros_importes numeric,
  total numeric,
  status text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amazon_payments_transactions_row_hash_key UNIQUE (row_hash)
);

CREATE INDEX IF NOT EXISTS idx_amz_pay_tx_prod_fecha
  ON public.amazon_payments_transactions (producto_id, fecha_transaccion);

CREATE INDEX IF NOT EXISTS idx_amz_pay_tx_grain
  ON public.amazon_payments_transactions (marketplace_country, fecha_transaccion, canal);

-- ─────────────────────────────────────────────────────────────────────────────
-- Vista agregada (grano diario FBA por producto / país / canal)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_ventas_fba_payments AS
SELECT
  t.producto_id,
  (t.fecha_transaccion AT TIME ZONE 'UTC')::date AS fecha,
  t.marketplace_country AS pais,
  t.canal AS canal_venta,
  SUM(COALESCE(t.cantidad, 0))::bigint AS unidades_vendidas,
  SUM(COALESCE(t.ingresos_producto, 0))::numeric AS ingresos_brutos,
  SUM(COALESCE(t.impuesto_producto, 0))::numeric AS iva_pagado_cuota,
  -- Temporal: el gasto real de Ads debe venir de Amazon Advertising API / informes Ads.
  -- Payments no refleja bien el ACOS por SKU; valor 0 hasta integrar Ads.
  -- Futuro opcional: sumar líneas tipo Werbekosten cuando existan con SKU vinculado.
  0::numeric AS publicidad_gasto_ads,
  SUM(COALESCE(t.comisiones_venta, 0))::numeric AS comisiones_amazon_referral,
  SUM(COALESCE(t.comisiones_fba, 0))::numeric AS comisiones_amazon_fba,
  SUM(COALESCE(t.otras_comisiones_transaccion, 0))::numeric AS otras_comisiones_transaccion,
  SUM(
    CASE
      WHEN lower(trim(coalesce(t.tipo, ''))) IN ('erstattung', 'refund')
        THEN abs(coalesce(t.total, 0))
      ELSE 0
    END
  )::numeric AS coste_devoluciones,
  SUM(COALESCE(t.total, 0))::numeric AS total_payments
FROM public.amazon_payments_transactions t
WHERE t.producto_id IS NOT NULL
  AND t.marketplace_country IS NOT NULL
  AND t.canal = 'FBA'
GROUP BY
  t.producto_id,
  (t.fecha_transaccion AT TIME ZONE 'UTC')::date,
  t.marketplace_country,
  t.canal;

COMMENT ON VIEW public.v_ventas_fba_payments IS
  'Agregado diario FBA desde Payments. publicidad_gasto_ads=0 es provisional (Ads vía Amazon Ads). Devoluciones solo por tipo Erstattung/Refund.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Índice único para upsert de ventas_diarias (crear solo si no existe)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS ventas_diarias_producto_fecha_pais_canal_idx
  ON public.ventas_diarias (producto_id, fecha, pais, canal_venta);

-- ─────────────────────────────────────────────────────────────────────────────
-- sync_ventas_diarias_fba: crear SOLO si la función aún no existe
-- ─────────────────────────────────────────────────────────────────────────────

DO $wrap$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_ventas_diarias_fba'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    RAISE NOTICE 'sync_ventas_diarias_fba ya existe; no se modifica.';
    RETURN;
  END IF;

  EXECUTE $fn$
  CREATE FUNCTION public.sync_ventas_diarias_fba()
  RETURNS void
  SECURITY DEFINER
  SET search_path = public
  LANGUAGE plpgsql
  AS $body$
  BEGIN
    INSERT INTO public.ventas_diarias (
      producto_id,
      fecha,
      pais,
      canal_venta,
      moneda,
      unidades_vendidas,
      ingresos_brutos,
      publicidad_gasto_ads,
      iva_pagado_cuota,
      ingresos_netos_sin_iva,
      comisiones_amazon_referral,
      comisiones_amazon_fba,
      coste_devoluciones
    )
    SELECT
      v.producto_id,
      v.fecha,
      v.pais,
      v.canal_venta,
      'EUR'::text,
      v.unidades_vendidas::integer,
      v.ingresos_brutos,
      COALESCE(v.publicidad_gasto_ads, 0),
      v.iva_pagado_cuota,
      CASE
        WHEN v.ingresos_brutos IS NOT NULL AND v.iva_pagado_cuota IS NOT NULL
          THEN v.ingresos_brutos - v.iva_pagado_cuota
        ELSE NULL
      END,
      COALESCE(v.comisiones_amazon_referral, 0) + COALESCE(v.otras_comisiones_transaccion, 0),
      COALESCE(v.comisiones_amazon_fba, 0),
      COALESCE(v.coste_devoluciones, 0)
    FROM public.v_ventas_fba_payments v
    ON CONFLICT (producto_id, fecha, pais, canal_venta)
    DO UPDATE SET
      unidades_vendidas = EXCLUDED.unidades_vendidas,
      ingresos_brutos = EXCLUDED.ingresos_brutos,
      publicidad_gasto_ads = EXCLUDED.publicidad_gasto_ads,
      iva_pagado_cuota = EXCLUDED.iva_pagado_cuota,
      ingresos_netos_sin_iva = EXCLUDED.ingresos_netos_sin_iva,
      comisiones_amazon_referral = EXCLUDED.comisiones_amazon_referral,
      comisiones_amazon_fba = EXCLUDED.comisiones_amazon_fba,
      coste_devoluciones = EXCLUDED.coste_devoluciones,
      moneda = COALESCE(public.ventas_diarias.moneda, EXCLUDED.moneda);
  END;
  $body$;
  $fn$;

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.sync_ventas_diarias_fba() TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.sync_ventas_diarias_fba() TO service_role';
END;
$wrap$;
