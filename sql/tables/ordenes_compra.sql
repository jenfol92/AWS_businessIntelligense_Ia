-- ─────────────────────────────────────────────
-- Tabla: ordenes_compra  (cabecera del pedido)
-- ─────────────────────────────────────────────
create table if not exists public.ordenes_compra (
  id                     uuid primary key default gen_random_uuid(),
  numero_orden           text unique,            -- ORD-2026-001 (auto al insert)
  estado                 text not null default 'borrador'
                         check (estado in ('borrador','confirmado')),

  -- puertos
  fob_puerto             text,                   -- Puerto salida China
  destino_puerto         text,                   -- Puerto destino España/EU

  -- fechas
  fecha_orden            date not null default current_date,
  fecha_confirmacion     date,
  eta                    date,                   -- estimado llegada (al confirmar)

  -- lead time real (se rellena al confirmar)
  lead_time_produccion   int,
  lead_time_transito     int,

  -- datos agente (al confirmar)
  numero_pedido_agente   text,

  -- cubicaje y coste total calculados
  cbm_total              numeric(10,4) default 0,
  cbm_limite             numeric(10,4) default 63, -- editable (40HQ = 63m³)
  coste_total_usd        numeric(12,2) default 0,
  coste_total_eur        numeric(12,2) default 0,

  -- tipo de cambio guardado al confirmar
  tipo_cambio_usd_eur    numeric(10,6),

  notas                  text,

  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  created_by             uuid references auth.users(id)
);

-- Función para generar número de orden automático: ORD-YYYY-NNN
create or replace function public.gen_numero_orden()
returns trigger language plpgsql as $$
declare
  anio text := to_char(current_date, 'YYYY');
  seq  int;
begin
  select coalesce(max(
    cast(split_part(numero_orden, '-', 3) as int)
  ), 0) + 1
  into seq
  from public.ordenes_compra
  where numero_orden like 'ORD-' || anio || '-%';

  new.numero_orden := 'ORD-' || anio || '-' || lpad(seq::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists trg_gen_numero_orden on public.ordenes_compra;
create trigger trg_gen_numero_orden
  before insert on public.ordenes_compra
  for each row
  when (new.numero_orden is null)
  execute function public.gen_numero_orden();

-- updated_at automático
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_ordenes_compra_updated on public.ordenes_compra;
create trigger trg_ordenes_compra_updated
  before update on public.ordenes_compra
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────
-- Tabla: orden_items  (líneas del pedido)
-- ─────────────────────────────────────────────
create table if not exists public.orden_items (
  id               uuid primary key default gen_random_uuid(),
  orden_id         uuid not null references public.ordenes_compra(id) on delete cascade,
  producto_id      uuid not null references public.productos(id) on delete restrict,
  proveedor_id     uuid references public.proveedores(id),

  cantidad         int not null default 1 check (cantidad > 0),
  cbm_unitario     numeric(10,4) default 0,   -- de producto_logistica.cubicaje_unitario_m3
  cbm_total        numeric(10,4)              -- generated: cantidad * cbm_unitario (o calculado)
    generated always as (cantidad * cbm_unitario) stored,

  coste_unitario_usd numeric(12,4),
  coste_unitario_eur numeric(12,4),

  notas            text,
  created_at       timestamptz default now()
);

create index if not exists idx_orden_items_orden
  on public.orden_items(orden_id);

create index if not exists idx_orden_items_producto
  on public.orden_items(producto_id);

-- Trigger: recalcular cbm_total y coste_total en ordenes_compra al insertar/actualizar/eliminar items
create or replace function public.recalc_orden_totales()
returns trigger language plpgsql as $$
declare
  oid uuid;
begin
  oid := coalesce(new.orden_id, old.orden_id);

  update public.ordenes_compra set
    cbm_total       = coalesce((select sum(cbm_total)   from public.orden_items where orden_id = oid), 0),
    coste_total_usd = coalesce((select sum(coste_unitario_usd * cantidad) from public.orden_items where orden_id = oid), 0),
    coste_total_eur = coalesce((select sum(coste_unitario_eur * cantidad) from public.orden_items where orden_id = oid), 0)
  where id = oid;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recalc_items on public.orden_items;
create trigger trg_recalc_items
  after insert or update or delete on public.orden_items
  for each row execute function public.recalc_orden_totales();
