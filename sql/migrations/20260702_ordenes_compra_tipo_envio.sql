ALTER TABLE public.ordenes_compra
ADD COLUMN IF NOT EXISTS tipo_envio text NOT NULL DEFAULT 'propio';

ALTER TABLE public.ordenes_compra
DROP CONSTRAINT IF EXISTS ordenes_compra_tipo_envio_check;

ALTER TABLE public.ordenes_compra
ADD CONSTRAINT ordenes_compra_tipo_envio_check
CHECK (tipo_envio IN ('propio', 'amazon_agl'));
