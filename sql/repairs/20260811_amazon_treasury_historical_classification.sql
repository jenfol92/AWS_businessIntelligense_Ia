-- NOT AUTHORIZED FOR EXECUTION.
-- Idempotent repair template; always run the companion READ ONLY diagnostic first.
-- It intentionally never changes received rows or finance_cash_movements.
begin;

update public.finance_amazon_income_forecasts
set economic_state=case
      when lower(status)='received' then 'RECEIVED'
      when fund_transfer_status='Processing' then 'PENDING_BANK'
      else economic_state
    end,
    expected_bank_date=case
      when fund_transfer_status='Processing' and fund_transfer_at is not null
        then fund_transfer_at::date
      else expected_bank_date
    end,
    date_is_estimated=case
      when fund_transfer_status='Processing' then fund_transfer_at is null
      else date_is_estimated
    end,
    estimation_method=case
      when fund_transfer_status='Processing' then 'amazon_fund_transfer_date'
      else estimation_method
    end
where lower(status) in ('confirmed','received')
  and (lower(status)='received' or fund_transfer_status='Processing')
  and economic_state is distinct from case
      when lower(status)='received' then 'RECEIVED'
      when fund_transfer_status='Processing' then 'PENDING_BANK'
      else economic_state
    end;

-- Closed/Succeeded is deliberately left unclassified until bank reconciliation.
rollback;
