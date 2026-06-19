-- Moneda de compra y tipo de cambio a EUR en cabecera de orden.
-- coste_unitario_moneda en líneas: precio unitario en la moneda seleccionada.

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS moneda_compra text DEFAULT 'USD';

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS tipo_cambio_moneda_eur numeric(10,6);

ALTER TABLE public.orden_items
  ADD COLUMN IF NOT EXISTS coste_unitario_moneda numeric(12,4);

ALTER TABLE public.ordenes_compra
  DROP CONSTRAINT IF EXISTS ordenes_compra_moneda_compra_check;

ALTER TABLE public.ordenes_compra
  ADD CONSTRAINT ordenes_compra_moneda_compra_check
  CHECK (moneda_compra IS NULL OR moneda_compra IN ('USD', 'EUR', 'GBP', 'CNY'));

UPDATE public.ordenes_compra
SET moneda_compra = upper(coalesce(moneda_compra, 'USD'));

UPDATE public.ordenes_compra
SET tipo_cambio_moneda_eur = 1
WHERE moneda_compra = 'EUR'
  AND tipo_cambio_moneda_eur IS NULL;

UPDATE public.orden_items oi
SET coste_unitario_moneda = coalesce(oi.coste_unitario_moneda, oi.coste_unitario_usd, oi.coste_unitario_eur)
FROM public.ordenes_compra oc
WHERE oi.orden_id = oc.id
  AND oc.moneda_compra = 'USD'
  AND oi.coste_unitario_moneda IS NULL;

UPDATE public.orden_items oi
SET coste_unitario_moneda = coalesce(oi.coste_unitario_moneda, oi.coste_unitario_eur, oi.coste_unitario_usd)
FROM public.ordenes_compra oc
WHERE oi.orden_id = oc.id
  AND oc.moneda_compra = 'EUR'
  AND oi.coste_unitario_moneda IS NULL;

CREATE OR REPLACE FUNCTION public.recalc_orden_totales()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  oid uuid;
  moneda text;
BEGIN
  oid := coalesce(new.orden_id, old.orden_id);

  SELECT coalesce(moneda_compra, 'USD')
  INTO moneda
  FROM public.ordenes_compra
  WHERE id = oid;

  UPDATE public.ordenes_compra SET
    cbm_total = coalesce((
      SELECT sum(cbm_total)
      FROM public.orden_items
      WHERE orden_id = oid
    ), 0),
    coste_total_eur = coalesce((
      SELECT sum(coste_unitario_eur * cantidad)
      FROM public.orden_items
      WHERE orden_id = oid
    ), 0),
    coste_total_usd = CASE
      WHEN moneda = 'USD' THEN coalesce((
        SELECT sum(coste_unitario_moneda * cantidad)
        FROM public.orden_items
        WHERE orden_id = oid
      ), 0)
      ELSE NULL
    END
  WHERE id = oid;

  RETURN coalesce(new, old);
END;
$$;

COMMENT ON COLUMN public.ordenes_compra.moneda_compra IS
  'Moneda original de compra: USD, EUR, GBP o CNY. Si es NULL se asume USD por compatibilidad.';

COMMENT ON COLUMN public.ordenes_compra.tipo_cambio_moneda_eur IS
  'Valor en EUR de 1 unidad de moneda_compra introducido por el usuario.';

COMMENT ON COLUMN public.orden_items.coste_unitario_moneda IS
  'Precio unitario escrito por el usuario en la moneda de compra de la orden.';
