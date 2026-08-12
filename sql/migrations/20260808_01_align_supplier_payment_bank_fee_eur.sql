begin;

do $$
begin
  if exists (
    select 1
    from public.finance_supplier_payments
    where bank_fee_eur is not null
      and (
        not public.finance_is_finite_numeric(bank_fee_eur)
        or bank_fee_eur <> round(bank_fee_eur, 2)
        or abs(bank_fee_eur) >= 1000000000000
      )
  ) then
    raise exception 'BANK_FEE_EUR_NOT_COMPATIBLE_WITH_NUMERIC_14_2';
  end if;
end $$;

alter table public.finance_supplier_payments
  alter column bank_fee_eur type numeric(14,2)
  using bank_fee_eur::numeric(14,2);

commit;
