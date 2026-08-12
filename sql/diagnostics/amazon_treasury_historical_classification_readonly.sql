begin transaction read only;

select
  coalesce(fund_transfer_status,'NONE') as fund_transfer_status,
  to_char(coalesce(cycle_end,cycle_start,forecast_date),'YYYY-MM') as cycle_month,
  marketplace,
  count(*) as rows,
  round(sum(coalesce(confirmed_amount_eur,amount_eur)),2) as amount_eur
from public.finance_amazon_income_forecasts
where lower(status)='confirmed'
group by 1,2,3
order by 2,3,1;

select count(*) as automatic_cash_movements
from public.finance_cash_movements
where source_type='amazon_income_forecast';

rollback;
