-- Transicion compatible: conserva amount_eur como estimacion legacy y añade
-- metadatos reales verificables sin backfill de valores ambiguos.

BEGIN;

ALTER TABLE public.finance_supplier_payments
  ADD COLUMN IF NOT EXISTS actual_fx_rate numeric NULL,
  ADD COLUMN IF NOT EXISTS actual_amount_eur numeric(14, 2) NULL,
  ADD COLUMN IF NOT EXISTS bank_reference text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_supplier_payments_actual_fx_rate_positive'
  ) THEN
    ALTER TABLE public.finance_supplier_payments
      ADD CONSTRAINT finance_supplier_payments_actual_fx_rate_positive
      CHECK (
        actual_fx_rate IS NULL
        OR (
          actual_fx_rate > 0
          AND actual_fx_rate::text NOT IN ('NaN', 'Infinity', '-Infinity')
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_supplier_payments_actual_amount_eur_positive'
  ) THEN
    ALTER TABLE public.finance_supplier_payments
      ADD CONSTRAINT finance_supplier_payments_actual_amount_eur_positive
      CHECK (
        actual_amount_eur IS NULL
        OR (
          actual_amount_eur > 0
          AND actual_amount_eur::text NOT IN ('NaN', 'Infinity', '-Infinity')
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finance_supplier_payments_bank_fee_eur_nonnegative'
  ) THEN
    ALTER TABLE public.finance_supplier_payments
      ADD CONSTRAINT finance_supplier_payments_bank_fee_eur_nonnegative
      CHECK (
        bank_fee_eur IS NULL
        OR (
          bank_fee_eur >= 0
          AND bank_fee_eur::text NOT IN ('NaN', 'Infinity', '-Infinity')
        )
      ) NOT VALID;
  END IF;
END;
$$;

COMMENT ON COLUMN public.finance_supplier_payments.amount_eur IS
  'Importe EUR estimado/legacy no verificado. No representa por sí solo el pago bancario real.';
COMMENT ON COLUMN public.finance_supplier_payments.actual_fx_rate IS
  'Cambio bancario real del pago: una unidad de original_currency equivale a X EUR.';
COMMENT ON COLUMN public.finance_supplier_payments.actual_amount_eur IS
  'Importe EUR real pagado al proveedor, sin comisiones bancarias ni gastos FF.';
COMMENT ON COLUMN public.finance_supplier_payments.bank_reference IS
  'Referencia bancaria opcional del pago proveedor.';
COMMENT ON COLUMN public.finance_supplier_payments.bank_fee_eur IS
  'Comisión bancaria separada; no forma parte de actual_amount_eur.';

COMMIT;
