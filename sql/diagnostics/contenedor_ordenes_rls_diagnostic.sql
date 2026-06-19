-- Diagnóstico RLS: contenedores, contenedor_ordenes, ordenes_compra
-- Ejecutar en Supabase SQL Editor.

-- 1) Estado RLS de las tablas
SELECT
  schemaname,
  tablename,
  rowsecurity,
  forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('contenedores', 'contenedor_ordenes', 'ordenes_compra');

-- 2) Policies existentes
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('contenedores', 'contenedor_ordenes', 'ordenes_compra')
ORDER BY tablename, policyname;

-- 3) Policies solo contenedor_ordenes (resumen)
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'contenedor_ordenes'
ORDER BY policyname;

-- 4) Vínculos contenedor ↔ orden (últimos contenedores)
SELECT
  c.id AS contenedor_id,
  c.identificador_embarque,
  co.orden_id,
  oc.numero_orden,
  oc.estado AS estado_orden
FROM public.contenedores c
LEFT JOIN public.contenedor_ordenes co ON co.contenedor_id = c.id
LEFT JOIN public.ordenes_compra oc ON oc.id = co.orden_id
ORDER BY c.created_at DESC NULLS LAST, c.identificador_embarque;
