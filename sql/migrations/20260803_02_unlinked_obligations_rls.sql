-- Fase 1: lectura autenticada; toda escritura queda limitada a RPC SECURITY DEFINER.

BEGIN;

ALTER TABLE public.finance_unlinked_obligation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_unlinked_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_unlinked_obligation_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_unlinked_obligation_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_unlinked_obligation_payment_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_unlinked_templates_authenticated_read
  ON public.finance_unlinked_obligation_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_unlinked_obligations_authenticated_read
  ON public.finance_unlinked_obligations FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_unlinked_installments_authenticated_read
  ON public.finance_unlinked_obligation_installments FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_unlinked_payments_authenticated_read
  ON public.finance_unlinked_obligation_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY finance_unlinked_allocations_authenticated_read
  ON public.finance_unlinked_obligation_payment_allocations FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.finance_unlinked_obligation_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_unlinked_obligations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_unlinked_obligation_installments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_unlinked_obligation_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.finance_unlinked_obligation_payment_allocations FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.finance_unlinked_obligation_templates TO authenticated, service_role;
GRANT SELECT ON public.finance_unlinked_obligations TO authenticated, service_role;
GRANT SELECT ON public.finance_unlinked_obligation_installments TO authenticated, service_role;
GRANT SELECT ON public.finance_unlinked_obligation_payments TO authenticated, service_role;
GRANT SELECT ON public.finance_unlinked_obligation_payment_allocations TO authenticated, service_role;

GRANT ALL ON public.finance_unlinked_obligation_templates TO service_role;
GRANT ALL ON public.finance_unlinked_obligations TO service_role;
GRANT ALL ON public.finance_unlinked_obligation_installments TO service_role;
GRANT ALL ON public.finance_unlinked_obligation_payments TO service_role;
GRANT ALL ON public.finance_unlinked_obligation_payment_allocations TO service_role;

REVOKE EXECUTE ON FUNCTION public.finance_enforce_unlinked_obligation_has_installment()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_validate_unlinked_payment_allocation(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_enforce_unlinked_payment_allocation_integrity()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finance_enforce_unlinked_allocation_integrity()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finance_enforce_unlinked_obligation_has_installment()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_validate_unlinked_payment_allocation(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_enforce_unlinked_payment_allocation_integrity()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_enforce_unlinked_allocation_integrity()
  TO service_role;

ALTER FUNCTION public.finance_enforce_unlinked_obligation_has_installment()
  OWNER TO postgres;
ALTER FUNCTION public.finance_validate_unlinked_payment_allocation(uuid)
  OWNER TO postgres;
ALTER FUNCTION public.finance_enforce_unlinked_payment_allocation_integrity()
  OWNER TO postgres;
ALTER FUNCTION public.finance_enforce_unlinked_allocation_integrity()
  OWNER TO postgres;

COMMIT;
