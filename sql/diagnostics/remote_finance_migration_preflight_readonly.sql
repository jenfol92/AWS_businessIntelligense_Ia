\set ON_ERROR_STOP on
begin transaction read only;
set local role postgres;

select current_database() as database_name,
       current_user as database_user,
       inet_server_addr() as server_address,
       version() as postgres_version,
       current_setting('transaction_read_only') as transaction_read_only;

select to_regclass('supabase_migrations.schema_migrations') as migration_history_table;

select table_name
from information_schema.tables
where table_schema='public' and table_name like 'finance\_%' escape '\'
order by table_name;

select table_name,column_name,data_type,udt_name,numeric_precision,numeric_scale,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name like 'finance\_%' escape '\'
order by table_name,ordinal_position;

select c.relname as table_name,con.conname,pg_get_constraintdef(con.oid,true) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'finance\_%' escape '\'
order by c.relname,con.conname;

select tablename,indexname,indexdef
from pg_indexes
where schemaname='public' and tablename like 'finance\_%' escape '\'
order by tablename,indexname;

select p.oid::regprocedure::text as signature,
       p.prosecdef as security_definer,
       p.proconfig,
       pg_get_userbyid(p.proowner) as owner,
       p.proacl,
       md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'finance\_%' escape '\'
order by signature;

select c.relname as table_name,t.tgname,pg_get_triggerdef(t.oid,true) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname='public'
  and (c.relname like 'finance\_%' escape '\' or t.tgname like 'finance\_%' escape '\')
order by c.relname,t.tgname;

select c.relname as table_name,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'finance\_%' escape '\'
order by c.relname;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies
where schemaname='public' and tablename like 'finance\_%' escape '\'
order by tablename,policyname;

select grantee,table_name,privilege_type,is_grantable
from information_schema.role_table_grants
where table_schema='public' and table_name like 'finance\_%' escape '\'
order by table_name,grantee,privilege_type;

select grantee,routine_name,specific_name,privilege_type,is_grantable
from information_schema.role_routine_grants
where specific_schema='public' and routine_name like 'finance\_%' escape '\'
order by routine_name,specific_name,grantee,privilege_type;

select format('select %L as table_name,count(*)::bigint as exact_rows from public.%I;',tablename,tablename)
from pg_tables where schemaname='public' and tablename like 'finance\_%' escape '\' order by tablename
\gexec

select id,bank_name,line_name,credit_limit,used_amount,available_amount,status
from public.finance_credit_lines
order by bank_name,line_name,id;

select
  count(*) filter(where bank_fee_eur is not null) as bank_fee_non_null,
  count(*) filter(where bank_fee_eur is not null and (
    not public.finance_is_finite_numeric(bank_fee_eur)
    or bank_fee_eur<>round(bank_fee_eur,2)
    or abs(bank_fee_eur)>=1000000000000
  )) as bank_fee_incompatible_numeric_14_2,
  min(bank_fee_eur) as bank_fee_min,
  max(bank_fee_eur) as bank_fee_max
from public.finance_supplier_payments;

select key,value
from public.finance_settings
where key in ('minimum_operating_cash_reserve_eur','amazon_expected_net_ratio')
order by key;

rollback;
