begin;
create or replace function public.finance_upsert_amazon_income(
  p_source_key text,p_forecast_date date,p_description text,p_amount_eur numeric,p_status text,
  p_marketplace text,p_cycle_start date,p_cycle_end date,p_estimated_gross_eur numeric,
  p_historical_net_ratio numeric,p_confirmed_amount_eur numeric,p_notes text
) returns public.finance_amazon_income_forecasts
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.finance_amazon_income_forecasts%rowtype;v_key text:=nullif(btrim(p_source_key),'');v_status text:=lower(btrim(coalesce(p_status,'')));v_amount numeric(14,2);
begin
  if not public.finance_can_read_unlinked_details() then raise exception 'ADMIN_OR_ACCOUNTING_REQUIRED' using errcode='42501'; end if;
  if v_key is null or p_forecast_date is null or nullif(btrim(p_description),'') is null then raise exception 'REQUIRED_FIELDS'; end if;
  if v_status not in('projected','accumulated','confirmed') then raise exception 'INVALID_INCOME_STATUS'; end if;
  v_amount:=round(public.finance_assert_finite_money(p_amount_eur,'amount_eur'),2);
  if p_historical_net_ratio is not null and (not public.finance_is_finite_numeric(p_historical_net_ratio) or p_historical_net_ratio<0 or p_historical_net_ratio>1) then raise exception 'INVALID_NET_RATIO'; end if;
  if v_status='confirmed' and (p_confirmed_amount_eur is null or not public.finance_is_finite_numeric(p_confirmed_amount_eur) or p_confirmed_amount_eur<=0) then raise exception 'CONFIRMED_AMOUNT_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('amazon-income-source:'||v_key,0));
  select * into v_row from public.finance_amazon_income_forecasts where source_key=v_key for update;
  if found and v_row.status='received' then raise exception 'INCOME_ALREADY_RECEIVED'; end if;
  if found then
    update public.finance_amazon_income_forecasts set forecast_date=p_forecast_date,description=btrim(p_description),amount_eur=v_amount,status=v_status,marketplace=nullif(btrim(p_marketplace),''),cycle_start=p_cycle_start,cycle_end=p_cycle_end,estimated_gross_eur=p_estimated_gross_eur,historical_net_ratio=p_historical_net_ratio,confirmed_amount_eur=case when v_status='confirmed' then round(p_confirmed_amount_eur,2) else null end,notes=nullif(btrim(p_notes),''),updated_at=now() where id=v_row.id returning * into v_row;
  else
    insert into public.finance_amazon_income_forecasts(source_key,forecast_date,description,amount_eur,status,marketplace,cycle_start,cycle_end,estimated_gross_eur,historical_net_ratio,confirmed_amount_eur,notes,updated_at)
    values(v_key,p_forecast_date,btrim(p_description),v_amount,v_status,nullif(btrim(p_marketplace),''),p_cycle_start,p_cycle_end,p_estimated_gross_eur,p_historical_net_ratio,case when v_status='confirmed' then round(p_confirmed_amount_eur,2) else null end,nullif(btrim(p_notes),''),now()) returning * into v_row;
  end if;
  return v_row;
end $$;
revoke all on function public.finance_upsert_amazon_income(text,date,text,numeric,text,text,date,date,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.finance_upsert_amazon_income(text,date,text,numeric,text,text,date,date,numeric,numeric,numeric,text) to authenticated,service_role;
commit;
