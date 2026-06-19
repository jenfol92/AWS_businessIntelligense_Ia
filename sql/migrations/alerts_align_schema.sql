-- Alinear schema de public.alerts con el backend actual (sin perder datos)
-- Ejecuta este script en Supabase SQL Editor.

alter table public.alerts
  add column if not exists tipo text;

alter table public.alerts
  add column if not exists severidad text;

alter table public.alerts
  add column if not exists producto_id uuid;

alter table public.alerts
  add column if not exists pais text;

alter table public.alerts
  add column if not exists mensaje text;

alter table public.alerts
  add column if not exists data jsonb;

alter table public.alerts
  add column if not exists status text;

alter table public.alerts
  add column if not exists first_seen_at timestamptz;

alter table public.alerts
  add column if not exists last_seen_at timestamptz;

alter table public.alerts
  add column if not exists seen_count integer;

alter table public.alerts
  add column if not exists created_at timestamptz;

alter table public.alerts
  add column if not exists updated_at timestamptz;

-- defaults / backfill
update public.alerts set tipo = coalesce(tipo, 'stock') where tipo is null;
update public.alerts set severidad = coalesce(severidad, 'medium') where severidad is null;
update public.alerts set mensaje = coalesce(mensaje, 'Alerta') where mensaje is null;
update public.alerts set data = coalesce(data, '{}'::jsonb) where data is null;
update public.alerts set status = coalesce(status, 'open') where status is null;
update public.alerts set first_seen_at = coalesce(first_seen_at, now()) where first_seen_at is null;
update public.alerts set last_seen_at = coalesce(last_seen_at, now()) where last_seen_at is null;
update public.alerts set seen_count = coalesce(seen_count, 1) where seen_count is null;
update public.alerts set created_at = coalesce(created_at, now()) where created_at is null;
update public.alerts set updated_at = coalesce(updated_at, now()) where updated_at is null;

alter table public.alerts
  alter column tipo set not null,
  alter column severidad set not null,
  alter column mensaje set not null,
  alter column data set not null,
  alter column status set not null,
  alter column first_seen_at set not null,
  alter column last_seen_at set not null,
  alter column seen_count set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

-- constraints
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'alerts_severidad_check') then
    alter table public.alerts add constraint alerts_severidad_check check (severidad in ('low','medium','high'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerts_status_check') then
    alter table public.alerts add constraint alerts_status_check check (status in ('open','closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerts_tipo_producto_pais_unique') then
    alter table public.alerts add constraint alerts_tipo_producto_pais_unique unique (tipo, producto_id, pais);
  end if;
end $$;

