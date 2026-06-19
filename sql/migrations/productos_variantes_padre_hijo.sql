-- Migración: Estructura Padre-Hijo (variantes) para productos
-- Fecha: 2026-04-20 (actualizada 2026-04-21)
--
-- Cambios clave vs. versión anterior:
--   * YA NO utilizamos `producto_finanzas` (tabla obsoleta en la app).
--   * El precio efectivo y la herencia de precios se gestionan sobre
--     `producto_precios` (tabla actual donde guardamos los precios de venta
--     por país/canal/price_type/vigencia).
--
-- Se mantiene:
--   * Columna `parent_id` (FK self-referencing) en productos.
--   * Columna `heredar_precio` (bool) en productos.
--   * Función pública `get_effective_price(producto_id, pais_code, channel)`.
--
-- Se añaden triggers para propagar automáticamente los precios del padre a
-- los hijos cuyo `heredar_precio = true`:
--   * Al insertar/actualizar/borrar filas en `producto_precios` de un padre,
--     replicamos ese conjunto completo de precios en todos sus hijos que
--     heredan (borrando previamente los precios existentes del hijo).
--   * Al asignar/retirar `parent_id` o cambiar `heredar_precio`, sincronizamos
--     los precios del hijo con los del padre.
--
-- Los hijos con `heredar_precio = false` conservan sus precios propios y no
-- son tocados por ningún trigger.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1) Columnas parent_id y heredar_precio (idempotente)
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS parent_id uuid
    REFERENCES public.productos(id) ON DELETE SET NULL;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS heredar_precio boolean NOT NULL DEFAULT true;

-- Evita que un producto se referencie a sí mismo como padre
ALTER TABLE public.productos
  DROP CONSTRAINT IF EXISTS productos_parent_id_no_self;
ALTER TABLE public.productos
  ADD CONSTRAINT productos_parent_id_no_self
  CHECK (parent_id IS NULL OR parent_id <> id);

CREATE INDEX IF NOT EXISTS idx_productos_parent_id
  ON public.productos (parent_id);

COMMENT ON COLUMN public.productos.parent_id IS
  'Referencia al producto padre cuando este producto es una variante (hijo).';
COMMENT ON COLUMN public.productos.heredar_precio IS
  'Si true y parent_id es NOT NULL, el precio efectivo del producto se toma del padre (producto_precios).';

-- ────────────────────────────────────────────────────────────
-- 2) Limpieza de versiones anteriores basadas en producto_finanzas
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_propagate_parent_price_to_children
  ON public.producto_finanzas;
DROP TRIGGER IF EXISTS trg_sync_child_price_from_parent
  ON public.productos;

DROP FUNCTION IF EXISTS public.propagate_parent_price_to_children();
DROP FUNCTION IF EXISTS public.sync_child_price_from_parent();
DROP FUNCTION IF EXISTS public.get_effective_price(uuid);

-- ────────────────────────────────────────────────────────────
-- 3) Función: get_effective_price(producto_id, pais_code, channel)
-- ────────────────────────────────────────────────────────────
-- Devuelve el precio vigente aplicable a un producto, aplicando herencia:
--   * Si el producto es hijo y heredar_precio = true, usamos los precios del padre.
--   * Si no, usamos los del propio producto.
-- Filtros opcionales por país y canal (si se pasan NULL, se eligen los mejores
-- candidatos según vigencia y prioridad país-específico > GLOBAL).
CREATE OR REPLACE FUNCTION public.get_effective_price(
  p_producto_id uuid,
  p_pais_code   text DEFAULT NULL,
  p_channel     text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_parent_id uuid;
  v_heredar   boolean;
  v_target_id uuid;
  v_precio    numeric;
BEGIN
  SELECT parent_id, heredar_precio
    INTO v_parent_id, v_heredar
    FROM public.productos
    WHERE id = p_producto_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_target_id := CASE
    WHEN v_parent_id IS NOT NULL AND COALESCE(v_heredar, true)
      THEN v_parent_id
    ELSE p_producto_id
  END;

  SELECT pp.precio
    INTO v_precio
    FROM public.producto_precios pp
    WHERE pp.producto_id = v_target_id
      AND (p_channel   IS NULL OR pp.channel   = p_channel)
      AND (p_pais_code IS NULL OR pp.pais_code = p_pais_code OR pp.pais_code IS NULL)
      AND (pp.valid_from IS NULL OR pp.valid_from <= current_date)
      AND (pp.valid_to   IS NULL OR pp.valid_to   >= current_date)
    ORDER BY
      -- Prioriza país específico sobre GLOBAL cuando llega p_pais_code
      (p_pais_code IS NOT NULL AND pp.pais_code = p_pais_code) DESC,
      -- Priorización por tipo: PROMO > GENERAL > resto
      CASE pp.price_type
        WHEN 'PROMO'   THEN 2
        WHEN 'GENERAL' THEN 1
        ELSE 0
      END DESC,
      pp.valid_from DESC NULLS LAST
    LIMIT 1;

  RETURN v_precio;
END;
$$;

COMMENT ON FUNCTION public.get_effective_price(uuid, text, text) IS
  'Devuelve el precio efectivo del producto (del padre si heredar_precio=true, o propio en caso contrario) leyendo de producto_precios.';

-- ────────────────────────────────────────────────────────────
-- 4) Trigger en producto_precios: propagar al conjunto de hijos que heredan
-- ────────────────────────────────────────────────────────────
-- Cuando cambian las filas de precios de un producto que es padre,
-- reemplazamos por completo los precios de los hijos con heredar_precio = true
-- por los del padre (DELETE + INSERT), para mantenerlos siempre sincronizados.
--
-- Implementación dinámica: copiamos TODAS las columnas de la tabla
-- `producto_precios` excepto la PK `id` (se regenera) y `producto_id`
-- (lo sustituimos por el id del hijo). Así el trigger es inmune a que
-- se añadan nuevas columnas NOT NULL en el futuro (scope, moneda_origen,
-- etc.).
CREATE OR REPLACE FUNCTION public.propagate_parent_prices_to_children()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent_producto_id uuid;
  v_tiene_hijos_heredando boolean;
  v_cols text;
BEGIN
  v_parent_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);

  SELECT EXISTS (
    SELECT 1
      FROM public.productos
     WHERE parent_id = v_parent_producto_id
       AND COALESCE(heredar_precio, true) = true
  ) INTO v_tiene_hijos_heredando;

  IF NOT v_tiene_hijos_heredando THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Borramos precios del conjunto de hijos heredando
  DELETE FROM public.producto_precios
   WHERE producto_id IN (
     SELECT id FROM public.productos
      WHERE parent_id = v_parent_producto_id
        AND COALESCE(heredar_precio, true) = true
   );

  -- Lista de columnas de producto_precios sin id ni producto_id.
  -- Así copiamos "scope" y cualquier otra columna NOT NULL presente.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'producto_precios'
     AND column_name NOT IN ('id', 'producto_id');

  EXECUTE format($f$
    INSERT INTO public.producto_precios (producto_id, %s)
    SELECT h.id, %s
      FROM public.producto_precios pp
      JOIN public.productos h
        ON h.parent_id = %L
       AND COALESCE(h.heredar_precio, true) = true
     WHERE pp.producto_id = %L
  $f$,
    v_cols,
    (SELECT string_agg('pp.' || quote_ident(column_name), ', ' ORDER BY ordinal_position)
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'producto_precios'
        AND column_name NOT IN ('id', 'producto_id')),
    v_parent_producto_id,
    v_parent_producto_id
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_parent_prices_to_children
  ON public.producto_precios;

CREATE TRIGGER trg_propagate_parent_prices_to_children
AFTER INSERT OR UPDATE OR DELETE
ON public.producto_precios
FOR EACH ROW
EXECUTE FUNCTION public.propagate_parent_prices_to_children();

-- ────────────────────────────────────────────────────────────
-- 5) Trigger en productos: al cambiar parent_id o heredar_precio del hijo
--    sincronizar sus precios con los del padre.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_child_prices_from_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_cols text;
  v_cols_pp text;
BEGIN
  -- En UPDATE, salimos si ni parent_id ni heredar_precio cambiaron
  IF TG_OP = 'UPDATE'
     AND NEW.parent_id        IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.heredar_precio   IS NOT DISTINCT FROM OLD.heredar_precio
  THEN
    RETURN NEW;
  END IF;

  -- Sin padre o con heredar_precio = false no propagamos nada
  IF NEW.parent_id IS NULL
     OR COALESCE(NEW.heredar_precio, true) = false
  THEN
    RETURN NEW;
  END IF;

  -- Reemplazamos los precios del hijo por los del padre.
  -- Igual que en propagate_parent_prices_to_children, copiamos TODAS las
  -- columnas de producto_precios salvo id y producto_id para ser inmunes
  -- a nuevas columnas NOT NULL (p.ej. "scope").
  DELETE FROM public.producto_precios
   WHERE producto_id = NEW.id;

  SELECT
      string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
      string_agg('pp.' || quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols, v_cols_pp
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'producto_precios'
     AND column_name NOT IN ('id', 'producto_id');

  EXECUTE format($f$
    INSERT INTO public.producto_precios (producto_id, %s)
    SELECT %L, %s
      FROM public.producto_precios pp
     WHERE pp.producto_id = %L
  $f$, v_cols, NEW.id, v_cols_pp, NEW.parent_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_child_prices_from_parent
  ON public.productos;

CREATE TRIGGER trg_sync_child_prices_from_parent
AFTER INSERT OR UPDATE OF parent_id, heredar_precio
ON public.productos
FOR EACH ROW
EXECUTE FUNCTION public.sync_child_prices_from_parent();

COMMIT;
