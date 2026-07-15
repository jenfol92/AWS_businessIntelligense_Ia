-- FASE FINANCE-SUPPLIER-PAYMENTS-ACTUAL-AMOUNT-1
-- Separa el importe previsto (amount_eur) del importe real pagado.
-- No modifica datos historicos: la compatibilidad se aplica en codigo con fallback a amount_eur.

alter table public.finance_supplier_payments
  add column if not exists actual_amount_eur numeric(14, 2) null;

comment on column public.finance_supplier_payments.actual_amount_eur is
  'Importe real pagado por el usuario al marcar el pago proveedor. amount_eur conserva el importe previsto.';
