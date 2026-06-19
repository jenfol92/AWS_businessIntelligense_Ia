-- ─────────────────────────────────────────────────────────────────
-- OPTIMIZACIÓN: contenedores NO duplica campos de ordenes_compra.
-- puertos y costes se CALCULAN desde las órdenes asignadas.
-- Un contenedor puede llevar 1 o más pedidos confirmados (m:n).
-- ─────────────────────────────────────────────────────────────────

create table if not exists public.contenedores (
  id                         uuid primary key default uuid_generate_v4(),
  identificador_embarque     text not null,

  tipo_contenedor            text,
  transitario                text,

  -- puertos: si null se heredan del primer pedido asignado
  puerto_salida              text,
  puerto_llegada             text,

  -- fechas de tránsito
  fecha_salida               date,
  fecha_eta_estimada         date,

  estado                     text default 'borrador',

  -- volumen y llenado
  volumen_max_m3             numeric,
  porcentaje_llenado_volumen numeric,

  -- pagos y costes
  pago_30_completado         boolean default false,
  pago_70_completado         boolean default false,
  fecha_pago_reserva         date,
  fecha_pago_final           date,
  costo_flete_total_usd      numeric,
  tasa_cambio_usd_eur        numeric,
  tasa_cambio_pago_30        numeric,
  tasa_cambio_pago_70        numeric,
  comision_bancaria_eur      numeric default 0,
  gastos_llegada_puerto_eur  numeric default 0,

  notas                      text,
  created_at                 timestamptz default now(),
  updated_at                 timestamptz default now(),
  created_by                 uuid references auth.users(id),
  updated_by                 uuid references auth.users(id)
);

create unique index if not exists idx_contenedores_embarque
  on public.contenedores(identificador_embarque);

-- ─────────────────────────────────────────────────────────────────
-- Tabla link n:m  contenedor ↔ ordenes_compra (solo confirmadas)
-- Los datos de coste / CBM / puertos se consultan DESDE las órdenes.
-- ─────────────────────────────────────────────────────────────────
create table if not exists public.contenedor_ordenes (
  contenedor_id  uuid not null references public.contenedores(id)    on delete cascade,
  orden_id       uuid not null references public.ordenes_compra(id)  on delete restrict,
  created_at     timestamptz default now(),
  primary key (contenedor_id, orden_id)
);

create index if not exists idx_co_contenedor on public.contenedor_ordenes(contenedor_id);
create index if not exists idx_co_orden      on public.contenedor_ordenes(orden_id);

-- updated_at automático (reutiliza touch_updated_at de ordenes_compra.sql)
drop trigger if exists trg_contenedores_updated on public.contenedores;
create trigger trg_contenedores_updated
  before update on public.contenedores
  for each row execute function public.touch_updated_at();
