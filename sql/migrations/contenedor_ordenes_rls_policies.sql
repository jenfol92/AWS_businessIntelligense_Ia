-- RLS para public.contenedor_ordenes
-- Permite a usuarios authenticated vincular/desvincular órdenes confirmadas a contenedores.
-- Idempotente: seguro re-ejecutar en Supabase SQL Editor.

BEGIN;

ALTER TABLE public.contenedor_ordenes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contenedor_ordenes_select_authenticated" ON public.contenedor_ordenes;
CREATE POLICY "contenedor_ordenes_select_authenticated"
ON public.contenedor_ordenes
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "contenedor_ordenes_insert_authenticated" ON public.contenedor_ordenes;
CREATE POLICY "contenedor_ordenes_insert_authenticated"
ON public.contenedor_ordenes
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.contenedores c
    WHERE c.id = contenedor_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.ordenes_compra oc
    WHERE oc.id = orden_id
  )
);

DROP POLICY IF EXISTS "contenedor_ordenes_delete_authenticated" ON public.contenedor_ordenes;
CREATE POLICY "contenedor_ordenes_delete_authenticated"
ON public.contenedor_ordenes
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.contenedores c
    WHERE c.id = contenedor_id
  )
);

COMMIT;
