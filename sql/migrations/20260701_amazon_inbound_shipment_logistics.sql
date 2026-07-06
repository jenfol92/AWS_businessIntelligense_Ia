-- Modulo: Amazon AGL.
-- Responsabilidad: ficha logistica de shipment Amazon inbound.
-- No toca stock, inventario_paises, forecast, contenedores ni estados logisticos.

CREATE TABLE IF NOT EXISTS public.amazon_inbound_shipments (
  shipment_id text PRIMARY KEY,
  shipment_name text,
  estado_amazon text,
  destination_center text,
  destination_country text,
  fecha_creacion_resuelta timestamptz,
  date_source text,
  eta_estimada date NULL,
  fecha_salida date NULL,
  fecha_entrega_real date NULL,
  carrier text NULL,
  tracking_number text NULL,
  agl_tracking_number text NULL,
  amazon_container_number text NULL,
  booking_reference text NULL,
  transport_status text NULL,
  notas text NULL,
  raw jsonb NULL,
  synced_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_shipments_estado
  ON public.amazon_inbound_shipments(estado_amazon);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_shipments_fecha
  ON public.amazon_inbound_shipments(fecha_creacion_resuelta);

CREATE TABLE IF NOT EXISTS public.amazon_inbound_shipment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id text NOT NULL REFERENCES public.amazon_inbound_shipments(shipment_id) ON DELETE CASCADE,
  tipo_documento text NOT NULL,
  nombre_archivo text NOT NULL,
  drive_file_id text NULL,
  drive_url text NULL,
  mime_type text NULL,
  size_bytes bigint NULL,
  uploaded_at timestamptz DEFAULT now(),
  uploaded_by uuid NULL,
  notas text NULL
);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_documents_shipment
  ON public.amazon_inbound_shipment_documents(shipment_id);

CREATE TABLE IF NOT EXISTS public.amazon_inbound_shipment_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id text NOT NULL REFERENCES public.amazon_inbound_shipments(shipment_id) ON DELETE CASCADE,
  concepto text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  source text NOT NULL DEFAULT 'manual',
  cost_date date NULL,
  notas text NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_costs_shipment
  ON public.amazon_inbound_shipment_costs(shipment_id);

CREATE TABLE IF NOT EXISTS public.orden_logistics_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id uuid NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  assignment_type text NOT NULL,
  contenedor_id uuid NULL REFERENCES public.contenedores(id),
  shipment_id text NULL REFERENCES public.amazon_inbound_shipments(shipment_id),
  status text DEFAULT 'active',
  notes text NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_orden_logistics_assignments_active
  ON public.orden_logistics_assignments(orden_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_orden_logistics_assignments_shipment
  ON public.orden_logistics_assignments(shipment_id);

CREATE INDEX IF NOT EXISTS idx_orden_logistics_assignments_container
  ON public.orden_logistics_assignments(contenedor_id);
