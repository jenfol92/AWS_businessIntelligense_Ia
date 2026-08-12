\set ON_ERROR_STOP on
begin;
set local app.environment='local_fixture';
set local request.jwt.claim.role='service_role';

do $$ begin
  if current_setting('app.environment',true)<>'local_fixture' then raise exception 'REMOTE_GUARD: local_fixture flag required'; end if;
  if current_database()<>'postgres' then raise exception 'REMOTE_GUARD: unexpected database'; end if;
  if inet_server_addr() is not null and not (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16' or inet_server_addr()<<inet '127.0.0.0/8') then raise exception 'REMOTE_GUARD: server address is not local/private'; end if;
end $$;

insert into public.agentes_compra(id,empresa,contacto,pais,notas) values('f1000000-0000-4000-8000-000000000001','FINFLOW TEST AGENT',null,'CN','FINFLOW_SYNTHETIC') on conflict(id) do update set empresa=excluded.empresa,notas=excluded.notas;
insert into public.proveedores(id,nombre,pais,agente_id) values('f1000000-0000-4000-8000-000000000002','FINFLOW TEST SUPPLIER','China','f1000000-0000-4000-8000-000000000001') on conflict(id) do update set nombre=excluded.nombre;
insert into public.ordenes_compra(id,numero_orden,estado,fecha_orden,fecha_confirmacion,etd,eta,coste_total_usd,deposito_porcentaje,balance_dias_antes_eta,agente_id,moneda_compra,tipo_envio,notas)
values
('f1000000-0000-4000-8000-000000000010','FINFLOW-AGL-001','confirmado','2026-08-01','2026-08-02','2026-09-01','2026-10-10',10000,30,10,'f1000000-0000-4000-8000-000000000001','USD','amazon_agl','FINFLOW_SYNTHETIC'),
('f1000000-0000-4000-8000-000000000011','FINFLOW-OWN-001','confirmado','2026-08-01','2026-08-03','2026-09-05','2026-10-20',20000,25,5,'f1000000-0000-4000-8000-000000000001','USD','propio','FINFLOW_SYNTHETIC')
on conflict(id) do update set estado=excluded.estado,fecha_confirmacion=excluded.fecha_confirmacion,etd=excluded.etd,eta=excluded.eta;
insert into public.contenedores(id,identificador_embarque,tipo_contenedor,fecha_salida,fecha_eta_estimada,notas)
values('f1000000-0000-4000-8000-000000000020','FINFLOW-CONT-001','propio','2026-09-05','2026-10-20','FINFLOW_SYNTHETIC') on conflict(id) do update set fecha_eta_estimada=excluded.fecha_eta_estimada;
insert into public.contenedor_ordenes(contenedor_id,orden_id) values('f1000000-0000-4000-8000-000000000020','f1000000-0000-4000-8000-000000000011') on conflict do nothing;

select public.sync_supplier_payment_plan('f1000000-0000-4000-8000-000000000010','DEPOSITO_30','2026-08-02',3000,'USD',0.9,2700,'amazon_agl',null,'pendiente','FINFLOW_SYNTHETIC',true);
select public.sync_supplier_payment_plan('f1000000-0000-4000-8000-000000000010','BALANCE_70','2026-09-01',7000,'USD',0.9,6300,'amazon_agl',null,'pendiente','FINFLOW_SYNTHETIC',true);
select public.sync_supplier_payment_plan('f1000000-0000-4000-8000-000000000011','DEPOSITO_30','2026-08-03',5000,'USD',0.9,4500,'propio','f1000000-0000-4000-8000-000000000020','pendiente','FINFLOW_SYNTHETIC',true);
select public.sync_supplier_payment_plan('f1000000-0000-4000-8000-000000000011','BALANCE_70','2026-10-15',15000,'USD',0.9,13500,'propio','f1000000-0000-4000-8000-000000000020','pendiente','FINFLOW_SYNTHETIC',true);

insert into public.finance_cash_accounts(id,name,balance,currency,status,is_operating_treasury) values('f1000000-0000-4000-8000-000000000030','FINFLOW OPERATING EUR',0,'EUR','active',true) on conflict(id) do update set is_operating_treasury=true;
insert into public.finance_credit_lines(id,bank_name,line_name,credit_limit,available_amount,used_amount,cycle_days,repayment_mode,priority,status,notes) values
('f1000000-0000-4000-8000-000000000041','Caja Rural','FINFLOW 120',50000,50000,0,120,'periodic_release',1,'activa','FINFLOW_SYNTHETIC'),
('f1000000-0000-4000-8000-000000000042','CaixaBank','FINFLOW 90',50000,50000,0,90,'periodic_release',2,'activa','FINFLOW_SYNTHETIC'),
('f1000000-0000-4000-8000-000000000043','BBVA','FINFLOW MANUAL',50000,50000,0,null,'manual_due_dates',3,'activa','FINFLOW_SYNTHETIC')
on conflict(id) do update set cycle_days=excluded.cycle_days,status='activa';
insert into public.finance_settings(key,value) values('minimum_operating_cash_reserve_eur','20000') on conflict(key) do update set value=excluded.value,updated_at=now();

select public.finance_record_operating_treasury_operation('f1000000-0000-4000-8000-000000000030','contribution','in',120000,'2026-08-01','FINFLOW OPENING','FINFLOW_SYNTHETIC','FINFLOW-TREASURY-001');

select public.finance_upsert_amazon_income('FINFLOW-AMZ-P1','2026-08-15','FINFLOW projected 1',12000,'projected','ES','2026-08-01','2026-08-14',15000,0.8,null,'FINFLOW_SYNTHETIC');
select public.finance_upsert_amazon_income('FINFLOW-AMZ-P2','2026-08-30','FINFLOW projected 2',14000,'accumulated','ES','2026-08-15','2026-08-29',17500,0.8,null,'FINFLOW_SYNTHETIC');
select public.finance_upsert_amazon_income('FINFLOW-AMZ-C1','2026-09-15','FINFLOW confirmed',12000,'confirmed','ES','2026-09-01','2026-09-14',15000,0.8,13000,'FINFLOW_SYNTHETIC');
select public.finance_upsert_amazon_income('FINFLOW-AMZ-R1','2026-08-05','FINFLOW received',9000,'confirmed','ES','2026-07-15','2026-07-31',11250,0.8,9000,'FINFLOW_SYNTHETIC');
select public.finance_receive_amazon_income((select id from public.finance_amazon_income_forecasts where source_key='FINFLOW-AMZ-R1'),'f1000000-0000-4000-8000-000000000030',9000,'2026-08-05T10:00:00Z','FINFLOW-AMZ-RECEIPT','FINFLOW-AMZ-RECEIVE-001');
select public.finance_receive_amazon_income((select id from public.finance_amazon_income_forecasts where source_key='FINFLOW-AMZ-R1'),'f1000000-0000-4000-8000-000000000030',9000,'2026-08-05T10:00:00Z','FINFLOW-AMZ-RECEIPT','FINFLOW-AMZ-RECEIVE-001');

select public.finance_execute_supplier_payment(
  (select id from public.finance_supplier_payments where orden_id='f1000000-0000-4000-8000-000000000010' and payment_type='DEPOSITO_30'),
  'f1000000-0000-4000-8000-000000000010','2026-08-06T10:00:00Z',0.9,2700,'FINFLOW-CASH-PAY',25,10,'FINFLOW_SYNTHETIC','cash_account','f1000000-0000-4000-8000-000000000030',null,null,'FINFLOW-PAY-CASH-001');
select public.finance_execute_supplier_payment(
  (select id from public.finance_supplier_payments where orden_id='f1000000-0000-4000-8000-000000000011' and payment_type='DEPOSITO_30'),
  'f1000000-0000-4000-8000-000000000011','2026-08-07T10:00:00Z',0.9,4500,'FINFLOW-LINE-PAY',30,20,'FINFLOW_SYNTHETIC','credit_line',null,'f1000000-0000-4000-8000-000000000042',null,'FINFLOW-PAY-LINE-001');
select public.finance_execute_supplier_payment(
  (select id from public.finance_supplier_payments where orden_id='f1000000-0000-4000-8000-000000000011' and payment_type='DEPOSITO_30'),
  'f1000000-0000-4000-8000-000000000011','2026-08-07T10:00:00Z',0.9,4500,'FINFLOW-LINE-PAY',30,20,'FINFLOW_SYNTHETIC','credit_line',null,'f1000000-0000-4000-8000-000000000042',null,'FINFLOW-PAY-LINE-001');

select public.finance_create_credit_line_drawdown(
  'f1000000-0000-4000-8000-000000000041',1000,'2026-08-07','supplier_payment',
  (select id from public.finance_supplier_payments where orden_id='f1000000-0000-4000-8000-000000000010' and payment_type='BALANCE_70'),
  'FINFLOW 120-day drawdown','FINFLOW-DRAWDOWN-120',null);
do $$ begin
  begin
    perform public.finance_create_credit_line_drawdown('f1000000-0000-4000-8000-000000000043',1000,'2026-08-07','supplier_payment',(select id from public.finance_supplier_payments where orden_id='f1000000-0000-4000-8000-000000000011' and payment_type='BALANCE_70'),'FINFLOW manual rejection','FINFLOW-BBVA-NO-DATE',null);
    raise exception 'ASSERT: BBVA missing manual date was accepted';
  exception when others then if sqlerrm not like '%MANUAL_DUE_DATE_REQUIRED%' then raise; end if; end;
end $$;

select public.finance_create_credit_line_repayment_v2(
  'f1000000-0000-4000-8000-000000000042',
  (select repayment_group_id from public.finance_credit_line_movements where credit_line_id='f1000000-0000-4000-8000-000000000042' and movement_type='drawdown' order by created_at desc limit 1),
  'f1000000-0000-4000-8000-000000000030',1000,100,50,'2026-08-08','FINFLOW-REPAY','FINFLOW_SYNTHETIC','FINFLOW-REPAY-001');

select public.finance_refinance_credit_line(
  (select repayment_group_id from public.finance_credit_line_movements where credit_line_id='f1000000-0000-4000-8000-000000000042' and movement_type='drawdown' limit 1),
  'f1000000-0000-4000-8000-000000000043','2026-08-09',2000,100,25,'2026-11-30','FINFLOW-REFI','FINFLOW_SYNTHETIC','FINFLOW-REFI-001');
select public.finance_refinance_credit_line(
  (select repayment_group_id from public.finance_credit_line_movements where credit_line_id='f1000000-0000-4000-8000-000000000042' and movement_type='drawdown' limit 1),
  'f1000000-0000-4000-8000-000000000043','2026-08-09',2000,100,25,'2026-11-30','FINFLOW-REFI','FINFLOW_SYNTHETIC','FINFLOW-REFI-001');

do $$ declare v numeric; begin
  if (select count(*) from public.finance_supplier_payments where orden_id in('f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000011'))<>4 then raise exception 'ASSERT: exactly four obligations'; end if;
  if (select due_date from public.finance_supplier_payments where orden_id='f1000000-0000-4000-8000-000000000010' and payment_type='BALANCE_70')<>'2026-09-01' then raise exception 'ASSERT: AGL ETD'; end if;
  if (select due_date from public.finance_supplier_payments where orden_id='f1000000-0000-4000-8000-000000000011' and payment_type='BALANCE_70')<>'2026-10-15' then raise exception 'ASSERT: own ETA offset'; end if;
  if (select due_date from public.finance_credit_line_repayment_groups where credit_line_id='f1000000-0000-4000-8000-000000000042' order by created_at limit 1)<>'2026-11-05' then raise exception 'ASSERT: 90 day maturity'; end if;
  if (select due_date from public.finance_credit_line_repayment_groups where credit_line_id='f1000000-0000-4000-8000-000000000041' order by created_at limit 1)<>'2026-12-05' then raise exception 'ASSERT: 120 day maturity'; end if;
  if not exists(select 1 from public.finance_credit_line_refinancings where idempotency_key='FINFLOW-REFI-001' and refinanced_amount_eur=2000 and funded_total_eur=2125 and funding_due_date='2026-11-30') then raise exception 'ASSERT: refinancing'; end if;
  if (select status from public.finance_amazon_income_forecasts where source_key='FINFLOW-AMZ-R1')<>'received' then raise exception 'ASSERT: received'; end if;
  if (select confirmed_amount_eur from public.finance_amazon_income_forecasts where source_key='FINFLOW-AMZ-C1')<>13000 then raise exception 'ASSERT: confirmed amount'; end if;
  if (select count(*) from public.finance_cash_movements where source_type='amazon_income_forecast' and source_id=(select id from public.finance_amazon_income_forecasts where source_key='FINFLOW-AMZ-R1'))<>1 then raise exception 'ASSERT: Amazon receipt duplicated'; end if;
  if exists(select 1 from public.finance_cash_movements where source_type='amazon_income_forecast' and source_id in(select id from public.finance_amazon_income_forecasts where source_key in('FINFLOW-AMZ-P1','FINFLOW-AMZ-P2','FINFLOW-AMZ-C1'))) then raise exception 'ASSERT: forecast changed cash'; end if;
  if (select count(*) from public.finance_credit_line_refinancings where idempotency_key='FINFLOW-REFI-001')<>1 then raise exception 'ASSERT: refinancing duplicated'; end if;
  if (select count(*) from public.finance_supplier_payment_executions where idempotency_key='FINFLOW-PAY-LINE-001')<>1 then raise exception 'ASSERT: supplier payment duplicated'; end if;
  if (select value from public.finance_settings where key='minimum_operating_cash_reserve_eur')<>'20000' then raise exception 'ASSERT: reserve'; end if;
end $$;

select 'FINFLOW_FIXTURE_PASS' as result,
  (select balance from public.finance_cash_accounts where id='f1000000-0000-4000-8000-000000000030') as operating_cash,
  (select used_amount from public.finance_credit_lines where id='f1000000-0000-4000-8000-000000000042') as caixabank_used,
  (select used_amount from public.finance_credit_lines where id='f1000000-0000-4000-8000-000000000043') as bbva_used;
rollback;
