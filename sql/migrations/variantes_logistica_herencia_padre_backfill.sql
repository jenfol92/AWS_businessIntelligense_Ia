-- Backfill logística de variantes (hijos) desde producto padre.
-- cubicaje_unitario_m3 es GENERATED: no escribir nunca.
-- Regla: solo rellenar huecos del hijo; no pisar medidas propias del hijo.

-- 1) Hijo con fila logística existente pero medidas/peso incompletos
UPDATE public.producto_logistica pl_h
SET
  largo_cm = COALESCE(pl_h.largo_cm, pl_p.largo_cm),
  ancho_cm = COALESCE(pl_h.ancho_cm, pl_p.ancho_cm),
  alto_cm = COALESCE(pl_h.alto_cm, pl_p.alto_cm),
  peso_kg_bruto = COALESCE(pl_h.peso_kg_bruto, pl_p.peso_kg_bruto),
  unidades_por_caja = COALESCE(pl_h.unidades_por_caja, pl_p.unidades_por_caja),
  pedido_minimo_unidades = COALESCE(pl_h.pedido_minimo_unidades, pl_p.pedido_minimo_unidades),
  ean_upc = COALESCE(NULLIF(TRIM(pl_h.ean_upc), ''), pl_p.ean_upc)
FROM public.productos h
JOIN public.productos p ON p.id = h.parent_id
JOIN public.producto_logistica pl_p ON pl_p.producto_id = p.id
WHERE pl_h.producto_id = h.id
  AND h.parent_id IS NOT NULL
  AND pl_p.largo_cm IS NOT NULL
  AND pl_p.ancho_cm IS NOT NULL
  AND pl_p.alto_cm IS NOT NULL
  AND pl_p.largo_cm > 0
  AND pl_p.ancho_cm > 0
  AND pl_p.alto_cm > 0
  AND (
    pl_h.largo_cm IS NULL
    OR pl_h.ancho_cm IS NULL
    OR pl_h.alto_cm IS NULL
    OR pl_h.peso_kg_bruto IS NULL
    OR COALESCE(pl_h.cubicaje_unitario_m3, 0) = 0
  );

-- 2) Hijo sin fila logística → insertar copiando del padre (EAN del hijo si existe en productos.sku/ean)
INSERT INTO public.producto_logistica (
  producto_id,
  largo_cm,
  ancho_cm,
  alto_cm,
  peso_kg_bruto,
  unidades_por_caja,
  pedido_minimo_unidades,
  ean_upc
)
SELECT
  h.id,
  pl_p.largo_cm,
  pl_p.ancho_cm,
  pl_p.alto_cm,
  pl_p.peso_kg_bruto,
  pl_p.unidades_por_caja,
  pl_p.pedido_minimo_unidades,
  COALESCE(NULLIF(TRIM(h.sku), ''), pl_p.ean_upc)
FROM public.productos h
JOIN public.productos p ON p.id = h.parent_id
JOIN public.producto_logistica pl_p ON pl_p.producto_id = p.id
WHERE h.parent_id IS NOT NULL
  AND pl_p.largo_cm IS NOT NULL
  AND pl_p.ancho_cm IS NOT NULL
  AND pl_p.alto_cm IS NOT NULL
  AND pl_p.largo_cm > 0
  AND pl_p.ancho_cm > 0
  AND pl_p.alto_cm > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.producto_logistica pl_h
    WHERE pl_h.producto_id = h.id
  );
