-- Trazabilidad de origen en ventas_diarias (All Orders, payments, etc.)

ALTER TABLE public.ventas_diarias
  ADD COLUMN IF NOT EXISTS source text NULL;

COMMENT ON COLUMN public.ventas_diarias.source IS
  'Origen del agregado: amazon_all_orders, amazon_payments, manual, etc.';
