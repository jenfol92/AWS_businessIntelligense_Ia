-- Backfill medidas en producto_logistica desde ficha técnica legacy.
-- cubicaje_unitario_m3 es GENERATED: la BD lo calcula al escribir largo/ancho/alto.

-- 1) Filas existentes con medidas/peso NULL → copiar desde ficha técnica
UPDATE public.producto_logistica pl
SET
  largo_cm = ft.largo_caja_cm,
  ancho_cm = ft.ancho_caja_cm,
  alto_cm = ft.alto_caja_cm,
  peso_kg_bruto = ft.peso_bruto_kg
FROM public.producto_ficha_tecnica ft
WHERE ft.producto_id = pl.producto_id
  AND ft.largo_caja_cm IS NOT NULL
  AND ft.ancho_caja_cm IS NOT NULL
  AND ft.alto_caja_cm IS NOT NULL
  AND ft.largo_caja_cm > 0
  AND ft.ancho_caja_cm > 0
  AND ft.alto_caja_cm > 0
  AND (
    pl.largo_cm IS NULL
    OR pl.ancho_cm IS NULL
    OR pl.alto_cm IS NULL
    OR pl.peso_kg_bruto IS NULL
  );

-- 2) Productos con ficha técnica pero sin fila logística → insertar medidas
INSERT INTO public.producto_logistica (
  producto_id,
  largo_cm,
  ancho_cm,
  alto_cm,
  peso_kg_bruto
)
SELECT
  ft.producto_id,
  ft.largo_caja_cm,
  ft.ancho_caja_cm,
  ft.alto_caja_cm,
  ft.peso_bruto_kg
FROM public.producto_ficha_tecnica ft
WHERE ft.largo_caja_cm IS NOT NULL
  AND ft.ancho_caja_cm IS NOT NULL
  AND ft.alto_caja_cm IS NOT NULL
  AND ft.largo_caja_cm > 0
  AND ft.ancho_caja_cm > 0
  AND ft.alto_caja_cm > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.producto_logistica pl
    WHERE pl.producto_id = ft.producto_id
  );
