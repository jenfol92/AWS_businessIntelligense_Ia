-- FASE FINANCE-SUPPLIER-PAYMENTS-FF-FEE-1
-- Gastos FF separados de la comision bancaria y del importe real pagado al proveedor.

alter table public.finance_supplier_payments
  add column if not exists ff_fee_eur numeric(14, 2) null;

comment on column public.finance_supplier_payments.ff_fee_eur is
  'Gastos FF asociados al pago proveedor, expresados en EUR. Independiente de bank_fee_eur.';
