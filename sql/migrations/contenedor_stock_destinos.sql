-- Destinos de stock por línea de contenedor (antes de aplicar stock propio).

CREATE TABLE IF NOT EXISTS public.contenedor_stock_destinos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  contenedor_id uuid NOT NULL REFERENCES public.contenedores(id) ON DELETE CASCADE,
  orden_item_id uuid NOT NULL REFERENCES public.orden_items(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,

  pais text NOT NULL,
  canal text NOT NULL CHECK (canal IN ('FBA', 'FBM')),
  marketplace_id text NULL,

  cantidad integer NOT NULL CHECK (cantidad > 0),

  notas text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_contenedor_stock_destinos_linea_pais_canal
  ON public.contenedor_stock_destinos (contenedor_id, orden_item_id, pais, canal);

CREATE INDEX IF NOT EXISTS idx_contenedor_stock_destinos_contenedor
  ON public.contenedor_stock_destinos (contenedor_id);

CREATE INDEX IF NOT EXISTS idx_contenedor_stock_destinos_orden_item
  ON public.contenedor_stock_destinos (orden_item_id);

COMMENT ON TABLE public.contenedor_stock_destinos IS
  'Destino FBA/FBM por línea antes de aplicar stock en contenedores propios. Validación de suma en aplicación.';

DROP TRIGGER IF EXISTS trg_contenedor_stock_destinos_updated ON public.contenedor_stock_destinos;
CREATE TRIGGER trg_contenedor_stock_destinos_updated
  BEFORE UPDATE ON public.contenedor_stock_destinos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
