-- Edicion economica/logistica de ordenes confirmadas.
-- - Estados anulados para pagos proveedor pendientes al reabrir a borrador.
-- - Snapshot estable de costes por lote al confirmar una orden.

alter table if exists public.finance_supplier_payments
  drop constraint if exists finance_supplier_payments_status_check;

alter table if exists public.finance_supplier_payments
  add constraint finance_supplier_payments_status_check
  check (status in ('pendiente', 'pagado', 'vencido', 'anulado', 'inactive'));

create table if not exists public.order_confirmed_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_compra(id) on delete cascade,
  orden_item_id uuid not null references public.orden_items(id) on delete cascade,
  producto_id uuid not null references public.productos(id),
  proveedor_id uuid null references public.proveedores(id),
  lote_producto text null,
  moneda_original text not null,
  coste_unitario_original numeric(14, 4) null,
  total_original numeric(14, 4) null,
  tipo_cambio_moneda_eur numeric(12, 6) null,
  coste_unitario_eur numeric(14, 4) null,
  total_eur numeric(14, 4) null,
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_order_confirmed_cost_snapshots_item
  on public.order_confirmed_cost_snapshots(orden_item_id);

create index if not exists idx_order_confirmed_cost_snapshots_lookup
  on public.order_confirmed_cost_snapshots(producto_id, proveedor_id, moneda_original, snapshot_date desc);

comment on table public.order_confirmed_cost_snapshots is
  'Snapshot de coste por linea/lote tomado al confirmar una orden. No sustituye producto_costos ni finance_supplier_payments.';
