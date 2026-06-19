-- Migración: Añadir campos de forma de pago a la tabla proveedores
-- Fecha: 2026-04-21
--
-- Se añaden tres campos para gestionar el pago por defecto:
--   * deposito_porcentaje: % de depósito inicial (ej: 30)
--   * balance_dias_antes_eta: Días antes de ETA para pagar el balance (ej: 10)
--   * balance_condiciones_texto: Texto personalizable del balance
--
-- La orden podrá sobrescribir estos defaults al confirmar.

BEGIN;

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS deposito_porcentaje numeric DEFAULT 30
    CHECK (deposito_porcentaje >= 0 AND deposito_porcentaje <= 100);

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS balance_dias_antes_eta integer DEFAULT 10
    CHECK (balance_dias_antes_eta >= 0);

ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS balance_condiciones_texto text
    DEFAULT 'The balance will be paid 10 days before the vessel arrives at the port';

COMMENT ON COLUMN public.proveedores.deposito_porcentaje IS
  'Porcentaje de depósito inicial por defecto (0-100). La orden puede sobreescribirlo.';
COMMENT ON COLUMN public.proveedores.balance_dias_antes_eta IS
  'Días antes de la fecha ETA para pagar el balance. Se usa para calcular la fecha de pago automáticamente.';
COMMENT ON COLUMN public.proveedores.balance_condiciones_texto IS
  'Texto descriptivo de las condiciones del balance. Aparece en la proforma y puede editarse en cada orden.';

COMMIT;
