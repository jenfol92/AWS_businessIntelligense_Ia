-- Diagnostico SELECT-only antes de borrar duplicados de producto_costos.
-- Objetivo: detectar referencias peligrosas a producto_costos.id.

-- 1) Foreign keys que referencian public.producto_costos(id).
SELECT
  con.conname AS foreign_key_name,
  src_ns.nspname AS source_schema,
  src.relname AS source_table,
  src_col.attname AS source_column,
  ref_ns.nspname AS referenced_schema,
  ref.relname AS referenced_table,
  ref_col.attname AS referenced_column,
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'r' THEN 'RESTRICT'
    WHEN 'c' THEN 'CASCADE'
    WHEN 'n' THEN 'SET NULL'
    WHEN 'd' THEN 'SET DEFAULT'
    ELSE con.confdeltype::text
  END AS on_delete
FROM pg_constraint con
JOIN pg_class src
  ON src.oid = con.conrelid
JOIN pg_namespace src_ns
  ON src_ns.oid = src.relnamespace
JOIN pg_class ref
  ON ref.oid = con.confrelid
JOIN pg_namespace ref_ns
  ON ref_ns.oid = ref.relnamespace
JOIN unnest(con.conkey) WITH ORDINALITY AS src_key(attnum, ord)
  ON true
JOIN unnest(con.confkey) WITH ORDINALITY AS ref_key(attnum, ord)
  ON ref_key.ord = src_key.ord
JOIN pg_attribute src_col
  ON src_col.attrelid = src.oid
 AND src_col.attnum = src_key.attnum
JOIN pg_attribute ref_col
  ON ref_col.attrelid = ref.oid
 AND ref_col.attnum = ref_key.attnum
WHERE con.contype = 'f'
  AND ref_ns.nspname = 'public'
  AND ref.relname = 'producto_costos'
  AND ref_col.attname = 'id'
ORDER BY source_schema, source_table, source_column;

-- 2) Vistas dependientes de public.producto_costos.
SELECT DISTINCT
  view_ns.nspname AS view_schema,
  view_class.relname AS view_name,
  source_ns.nspname AS source_schema,
  source_class.relname AS source_table
FROM pg_rewrite rw
JOIN pg_class view_class
  ON view_class.oid = rw.ev_class
JOIN pg_namespace view_ns
  ON view_ns.oid = view_class.relnamespace
JOIN pg_depend dep
  ON dep.objid = rw.oid
JOIN pg_class source_class
  ON source_class.oid = dep.refobjid
JOIN pg_namespace source_ns
  ON source_ns.oid = source_class.relnamespace
WHERE view_class.relkind IN ('v', 'm')
  AND source_ns.nspname = 'public'
  AND source_class.relname = 'producto_costos'
ORDER BY view_schema, view_name;

-- 3) Funciones que mencionan literalmente producto_costos.id.
SELECT
  n.nspname AS function_schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n
  ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%producto_costos.id%'
   OR pg_get_functiondef(p.oid) ILIKE '%producto_costos%id%'
ORDER BY function_schema, function_name, arguments;
