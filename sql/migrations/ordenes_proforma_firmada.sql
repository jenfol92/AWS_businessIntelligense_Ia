-- Proforma firmada: URL pública (Supabase Storage) y fecha de carga
ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS proforma_firmada_url text NULL,
  ADD COLUMN IF NOT EXISTS proforma_firmada_at timestamptz NULL;

COMMENT ON COLUMN public.ordenes_compra.proforma_firmada_url IS 'URL pública del PDF de proforma firmada (p. ej. bucket order-documents)';
COMMENT ON COLUMN public.ordenes_compra.proforma_firmada_at IS 'Momento en que se guardó la proforma firmada';
