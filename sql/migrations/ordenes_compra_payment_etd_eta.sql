-- Migración: Añadir campos de payment y fechas ETD/ETA a ordenes_compra
-- Fecha: 2026-04-21
--
-- Se añaden:
--   * etd (Estimated Time of Departure): fecha salida del puerto origen
--   * eta_old se renombra a eta_calculated (mantenemos compatibilidad)
--   * eta_real: fecha real de llegada al destino (sobrescribe la calculada)
--   * deposito_porcentaje: % de depósito inicial
--   * balance_dias_antes_eta: Días antes de ETA para pagar balance
--   * balance_condiciones_texto: Condiciones del balance (editable)
--   * fecha_pago_balance: Calculada automáticamente (ETA - balance_dias_antes_eta)

BEGIN;

-- Renombrar campo puerto a destino (más genérico: puede ser ciudad o país también)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'ordenes_compra' AND column_name = 'destino_puerto'
  ) THEN
    ALTER TABLE public.ordenes_compra 
      RENAME COLUMN destino_puerto TO destino;
  END IF;
END $$;

-- Añadir nuevos campos
ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS etd date;

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS eta_real date;

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS deposito_porcentaje numeric DEFAULT 30
    CHECK (deposito_porcentaje >= 0 AND deposito_porcentaje <= 100);

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS balance_dias_antes_eta integer DEFAULT 10
    CHECK (balance_dias_antes_eta >= 0);

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS balance_condiciones_texto text
    DEFAULT 'The balance will be paid 10 days before the vessel arrives at the port';

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS fecha_pago_balance date;

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS proforma_firmada_url text;

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS proforma_firmada_at timestamptz;

COMMENT ON COLUMN public.ordenes_compra.etd IS 'Estimated Time of Departure - Fecha salida del puerto origen';
COMMENT ON COLUMN public.ordenes_compra.eta_real IS 'Fecha real de llegada (sobrescribe eta calculada si se proporciona)';
COMMENT ON COLUMN public.ordenes_compra.deposito_porcentaje IS 'Porcentaje de depósito inicial (heredado del proveedor pero editable en la orden)';
COMMENT ON COLUMN public.ordenes_compra.balance_dias_antes_eta IS 'Días antes de ETA para calcular fecha de pago del balance';
COMMENT ON COLUMN public.ordenes_compra.balance_condiciones_texto IS 'Texto descriptivo del pago del balance (aparece en proforma)';
COMMENT ON COLUMN public.ordenes_compra.fecha_pago_balance IS 'Fecha calculada del pago del balance (ETA - balance_dias_antes_eta)';
COMMENT ON COLUMN public.ordenes_compra.proforma_firmada_url IS 'URL de la proforma firmada subida al storage';
COMMENT ON COLUMN public.ordenes_compra.proforma_firmada_at IS 'Timestamp de cuándo se subió la proforma firmada';

-- Trigger para calcular fecha_pago_balance automáticamente
CREATE OR REPLACE FUNCTION public.calcular_fecha_pago_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  -- Usamos eta_real si existe, si no usamos eta (calculada)
  IF NEW.eta_real IS NOT NULL AND NEW.balance_dias_antes_eta IS NOT NULL THEN
    NEW.fecha_pago_balance := NEW.eta_real - (NEW.balance_dias_antes_eta || ' days')::interval;
  ELSIF NEW.eta IS NOT NULL AND NEW.balance_dias_antes_eta IS NOT NULL THEN
    NEW.fecha_pago_balance := NEW.eta - (NEW.balance_dias_antes_eta || ' days')::interval;
  ELSE
    NEW.fecha_pago_balance := NULL;
  END IF;
  
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_calcular_fecha_pago_balance ON public.ordenes_compra;

CREATE TRIGGER trg_calcular_fecha_pago_balance
  BEFORE INSERT OR UPDATE OF eta, eta_real, balance_dias_antes_eta
  ON public.ordenes_compra
  FOR EACH ROW
  EXECUTE FUNCTION public.calcular_fecha_pago_balance();

COMMIT;
