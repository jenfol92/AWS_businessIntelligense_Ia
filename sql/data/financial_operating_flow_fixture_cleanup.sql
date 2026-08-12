\set ON_ERROR_STOP on
begin;
set local app.environment='local_fixture';
do $$ begin if current_setting('app.environment',true)<>'local_fixture' or current_database()<>'postgres' or (inet_server_addr() is not null and not (inet_server_addr()<<inet '10.0.0.0/8' or inet_server_addr()<<inet '172.16.0.0/12' or inet_server_addr()<<inet '192.168.0.0/16' or inet_server_addr()<<inet '127.0.0.0/8')) then raise exception 'REMOTE_GUARD'; end if; end $$;
-- El fixture integral termina con ROLLBACK. Esta limpieza elimina solo semillas sin ledger
-- si una ejecución fue interrumpida antes de entrar en la transacción.
delete from public.contenedor_ordenes where orden_id in('f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000011');
delete from public.contenedores where id='f1000000-0000-4000-8000-000000000020' and notas='FINFLOW_SYNTHETIC';
delete from public.ordenes_compra where id in('f1000000-0000-4000-8000-000000000010','f1000000-0000-4000-8000-000000000011') and notas='FINFLOW_SYNTHETIC';
delete from public.proveedores where id='f1000000-0000-4000-8000-000000000002' and nombre='FINFLOW TEST SUPPLIER';
delete from public.agentes_compra where id='f1000000-0000-4000-8000-000000000001' and empresa='FINFLOW TEST AGENT';
commit;
