BEGIN;

-- Obsolete trigger from the pre-partial-settlement flow.
-- It required status = pagado before assigning a funding source,
-- which prevents valid partial settlements.

DROP TRIGGER IF EXISTS
  trg_require_actual_supplier_payment_before_financing
ON public.finance_supplier_payments;

DROP FUNCTION IF EXISTS
  public.require_actual_supplier_payment_before_financing();

-- The current trigger remains responsible for fully paid obligations.
COMMENT ON FUNCTION public.require_real_funding_on_supplier_payment_paid()
IS 'Validates actual EUR values and a real funding source when the supplier payment is fully paid. Partial settlements are allowed.';

NOTIFY pgrst, 'reload schema';

COMMIT;
