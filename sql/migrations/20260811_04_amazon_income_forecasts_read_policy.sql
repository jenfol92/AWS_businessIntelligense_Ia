begin;

alter table public.finance_amazon_income_forecasts enable row level security;

revoke insert, update, delete, truncate, references, trigger
on table public.finance_amazon_income_forecasts
from authenticated;

grant select
on table public.finance_amazon_income_forecasts
to authenticated;

drop policy if exists finance_amazon_income_forecasts_select_treasury
on public.finance_amazon_income_forecasts;

create policy finance_amazon_income_forecasts_select_treasury
on public.finance_amazon_income_forecasts
for select
to authenticated
using (public.finance_can_read_treasury());

commit;
