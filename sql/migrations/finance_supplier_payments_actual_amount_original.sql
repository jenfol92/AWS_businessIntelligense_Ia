alter table public.finance_supplier_payments
  add column if not exists actual_amount_original numeric(14, 4) null;

comment on column public.finance_supplier_payments.actual_amount_original is
  'Importe real pagado al proveedor en moneda origen.';
