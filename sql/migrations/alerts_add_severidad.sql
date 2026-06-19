-- Migración segura si ya existe public.alerts sin columna severidad

alter table public.alerts
  add column if not exists severidad text;

update public.alerts
set severidad = coalesce(severidad, 'medium')
where severidad is null;

alter table public.alerts
  alter column severidad set not null;

-- constraint
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'alerts_severidad_check'
  ) then
    alter table public.alerts
      add constraint alerts_severidad_check check (severidad in ('low','medium','high'));
  end if;
end $$;

