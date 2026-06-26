-- FASE FINANCE-PAYMENTS-MARK-PAID-1
-- Guarda el tipo de cambio real y la comision bancaria del pago proveedor.
-- No crea movimientos de caja ni lineas de credito.

alter table public.finance_supplier_payments
  add column if not exists actual_fx_rate numeric null;

alter table public.finance_supplier_payments
  add column if not exists bank_fee_eur numeric null;

comment on column public.finance_supplier_payments.actual_fx_rate is
  'Tipo de cambio real aplicado al marcar el pago. Convencion: 1 unidad de moneda origen = X EUR.';

comment on column public.finance_supplier_payments.bank_fee_eur is
  'Comision bancaria real del pago proveedor en EUR.';
