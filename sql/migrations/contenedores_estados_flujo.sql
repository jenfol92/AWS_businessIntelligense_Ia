-- Flujo definitivo de estados de contenedores (snake_case, sin tildes).
-- Normaliza valores legacy antes de aplicar el nuevo CHECK.

BEGIN;

UPDATE public.contenedores
SET estado = 'borrador'
WHERE estado = 'Borrador';

UPDATE public.contenedores
SET estado = 'en_puerto_destino'
WHERE estado = 'llegado';

UPDATE public.contenedores
SET estado = 'en_puerto_salida'
WHERE estado = 'puerto_salida';

UPDATE public.contenedores
SET estado = 'en_puerto_destino'
WHERE estado = 'puerto_destino';

ALTER TABLE public.contenedores
  ALTER COLUMN estado SET DEFAULT 'borrador';

ALTER TABLE public.contenedores
  DROP CONSTRAINT IF EXISTS contenedores_estado_chk;

ALTER TABLE public.contenedores
  ADD CONSTRAINT contenedores_estado_chk
  CHECK (
    estado IN (
      'borrador',
      'preparando',
      'en_puerto_salida',
      'en_transito',
      'en_puerto_destino',
      'entregado',
      'disponible_stock',
      'facturado'
    )
  );

COMMENT ON COLUMN public.contenedores.estado IS
  'borrador → preparando → en_puerto_salida → en_transito → en_puerto_destino → entregado → disponible_stock → facturado';

COMMIT;
