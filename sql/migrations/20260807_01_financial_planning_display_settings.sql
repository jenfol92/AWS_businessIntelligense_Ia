begin;

insert into public.finance_settings (key, value)
values
  ('amazon_expected_net_ratio', '0.75'),
  ('minimum_operating_cash_reserve_eur', '20000')
on conflict (key) do nothing;

commit;
