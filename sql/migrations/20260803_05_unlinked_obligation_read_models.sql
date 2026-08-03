-- Fase 1: saldos y condiciones derivados. No persiste paid/outstanding/overdue.

BEGIN;

CREATE OR REPLACE VIEW public.finance_unlinked_installment_balances
WITH (security_invoker = true)
AS
WITH posted_allocations AS (
  SELECT
    a.installment_id,
    CASE WHEN bool_and(a.amount_breakdown_mode = 'detailed') THEN sum(a.allocated_principal_eur)::numeric(14,2) END AS allocated_principal_eur,
    CASE WHEN bool_and(a.amount_breakdown_mode = 'detailed') THEN sum(a.allocated_interest_eur)::numeric(14,2) END AS allocated_interest_eur,
    CASE WHEN bool_and(a.amount_breakdown_mode = 'detailed') THEN sum(a.allocated_other_fees_eur)::numeric(14,2) END AS allocated_other_fees_eur,
    coalesce(sum(a.allocated_total_eur), 0)::numeric(14,2) AS allocated_total_eur
  FROM public.finance_unlinked_obligation_payment_allocations a
  JOIN public.finance_unlinked_obligation_payments p ON p.id = a.payment_id
  WHERE p.status = 'posted'
  GROUP BY a.installment_id
)
SELECT
  i.id AS installment_id,
  i.obligation_id,
  i.plan_revision,
  i.sequence_number,
  i.due_date,
  i.status AS installment_status,
  i.amount_breakdown_mode,
  i.planned_principal_eur,
  i.planned_interest_eur,
  i.planned_other_fees_eur,
  i.planned_total_eur,
  a.allocated_principal_eur,
  a.allocated_interest_eur,
  a.allocated_other_fees_eur,
  coalesce(a.allocated_total_eur, 0)::numeric(14,2) AS allocated_total_eur,
  CASE WHEN i.status = 'active'
    THEN greatest(i.planned_total_eur - coalesce(a.allocated_total_eur, 0), 0)::numeric(14,2)
    ELSE 0::numeric(14,2)
  END AS outstanding_total_eur,
  CASE
    WHEN i.status = 'cancelled' THEN 'cancelled'
    WHEN i.status = 'superseded' THEN 'superseded'
    WHEN coalesce(a.allocated_total_eur, 0) >= i.planned_total_eur THEN 'paid'
    WHEN coalesce(a.allocated_total_eur, 0) > 0 THEN 'partial'
    ELSE 'pending'
  END AS financial_status,
  CASE
    WHEN i.status <> 'active' OR coalesce(a.allocated_total_eur, 0) >= i.planned_total_eur THEN 'current'
    WHEN i.due_date < current_date THEN 'overdue'
    WHEN i.due_date <= current_date + 30 THEN 'due_soon'
    ELSE 'current'
  END AS temporal_condition
FROM public.finance_unlinked_obligation_installments i
LEFT JOIN posted_allocations a ON a.installment_id = i.id;

CREATE OR REPLACE VIEW public.finance_unlinked_obligation_balances
WITH (security_invoker = true)
AS
SELECT
  o.id AS obligation_id,
  o.template_id,
  o.occurrence_period,
  o.origin_type,
  o.concept,
  o.category,
  o.counterparty_name,
  o.description,
  o.lifecycle_status,
  o.amount_breakdown_mode,
  coalesce(sum(b.planned_total_eur) FILTER (WHERE b.installment_status = 'active'), 0)::numeric(14,2) AS planned_total_eur,
  coalesce(sum(b.allocated_total_eur) FILTER (WHERE b.installment_status = 'active'), 0)::numeric(14,2) AS paid_total_eur,
  coalesce(sum(b.outstanding_total_eur) FILTER (WHERE b.installment_status = 'active'), 0)::numeric(14,2) AS outstanding_total_eur,
  CASE
    WHEN o.lifecycle_status = 'cancelled' THEN 'cancelled'
    WHEN coalesce(sum(b.outstanding_total_eur) FILTER (WHERE b.installment_status = 'active'), 0) = 0
      AND count(*) FILTER (WHERE b.installment_status = 'active') > 0 THEN 'paid'
    WHEN coalesce(sum(b.allocated_total_eur) FILTER (WHERE b.installment_status = 'active'), 0) > 0 THEN 'partial'
    ELSE 'pending'
  END AS financial_status,
  bool_or(b.temporal_condition = 'overdue' AND b.installment_status = 'active') AS has_overdue_installment,
  min(b.due_date) FILTER (WHERE b.installment_status = 'active' AND b.outstanding_total_eur > 0) AS next_pending_due_date,
  count(*) FILTER (WHERE b.installment_status = 'active')::integer AS installment_count,
  count(*) FILTER (WHERE b.installment_status = 'active' AND b.financial_status = 'paid')::integer AS paid_installment_count,
  count(*) FILTER (WHERE b.installment_status = 'active' AND b.financial_status = 'partial')::integer AS partial_installment_count,
  count(*) FILTER (WHERE b.installment_status = 'active' AND b.financial_status = 'pending')::integer AS pending_installment_count
FROM public.finance_unlinked_obligations o
JOIN public.finance_unlinked_installment_balances b ON b.obligation_id = o.id
GROUP BY o.id;

REVOKE ALL ON public.finance_unlinked_installment_balances FROM PUBLIC, anon;
REVOKE ALL ON public.finance_unlinked_obligation_balances FROM PUBLIC, anon;
GRANT SELECT ON public.finance_unlinked_installment_balances TO authenticated, service_role;
GRANT SELECT ON public.finance_unlinked_obligation_balances TO authenticated, service_role;

COMMENT ON VIEW public.finance_unlinked_installment_balances IS
  'Deriva pagado, pendiente y partial+overdue desde asignaciones de pagos posted; no almacena overdue.';
COMMENT ON VIEW public.finance_unlinked_obligation_balances IS
  'Agrega exclusivamente cuotas activas y saldos derivados; las cuotas son la fuente del total planificado.';

NOTIFY pgrst, 'reload schema';

COMMIT;
