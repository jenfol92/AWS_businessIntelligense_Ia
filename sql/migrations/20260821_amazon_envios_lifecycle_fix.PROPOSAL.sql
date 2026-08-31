-- ══════════════════════════════════════════════════════════════════════════════
-- PROPUESTA DE MIGRACIÓN — Amazon Envíos Lifecycle Fix
-- Fecha: 2026-08-21
-- Estado: PROPOSAL — NO APLICAR hasta aprobación explícita
-- ══════════════════════════════════════════════════════════════════════════════
--
-- MIGRATION_REQUIRED: YES
--
-- TABLAS_AFECTADAS:
--   amazon_envios                            (columnas añadidas)
--   amazon_envios_status_history             (tabla nueva)
--   amazon_inbound_shipment_amazon_details   (actualmente vacía — reutilizar o reemplazar)
--
-- COLUMNAS_AÑADIDAS en amazon_envios:
--   amazon_created_at        timestamptz  — fecha real de creación en Amazon
--   amazon_last_updated_at   timestamptz  — fecha de última actualización en Amazon
--   synced_at                timestamptz  — última vez que este registro fue sincronizado
--   review_required          boolean      — indica que requiere revisión manual
--   shipment_year            int          — año del shipment (de amazon_created_at)
--   quantity_shipped         int          — QuantityShipped v0 (separado de expected)
--   quantity_expected        int          — planned/expected (ex cantidad_esperada)
--   discrepancy_quantity     int          — quantity_shipped - quantity_received (informativo)
--
-- TABLA_NUEVA: amazon_envios_status_history
--   append-only — conserva historial de cambios de estado
--
-- BACKFILL_REQUIRED: YES
--   - amazon_created_at / amazon_last_updated_at desde raw->amazon_created_at / raw->amazon_last_updated_at
--   - shipment_year desde fecha_creacion o amazon_created_at
--   - review_required desde raw->review_required
--   - quantity_shipped desde raw->quantity_shipped
--   - discrepancy_quantity desde raw->quantity_discrepancy
--
-- ROLLBACK_PLAN:
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS amazon_created_at;
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS amazon_last_updated_at;
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS synced_at;
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS review_required;
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS shipment_year;
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS quantity_shipped;
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS quantity_expected;
--   ALTER TABLE amazon_envios DROP COLUMN IF EXISTS discrepancy_quantity;
--   DROP TABLE IF EXISTS public.amazon_envios_status_history;
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════════
-- INICIO DE TRANSACCIÓN — si cualquier paso falla, rollback completo
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas nuevas en amazon_envios
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.amazon_envios
  ADD COLUMN IF NOT EXISTS amazon_created_at      timestamptz  NULL,
  ADD COLUMN IF NOT EXISTS amazon_last_updated_at timestamptz  NULL,
  ADD COLUMN IF NOT EXISTS synced_at              timestamptz  NULL,
  ADD COLUMN IF NOT EXISTS review_required        boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipment_year          int          NULL,
  ADD COLUMN IF NOT EXISTS quantity_shipped       int          NULL,
  ADD COLUMN IF NOT EXISTS quantity_expected      int          NULL,
  ADD COLUMN IF NOT EXISTS discrepancy_quantity   int          NULL;

COMMENT ON COLUMN public.amazon_envios.amazon_created_at      IS 'Timestamp de creación en Amazon — separado de fecha de actualización';
COMMENT ON COLUMN public.amazon_envios.amazon_last_updated_at IS 'Timestamp de última actualización en Amazon';
COMMENT ON COLUMN public.amazon_envios.synced_at              IS 'Última sincronización ERP←Amazon para este registro';
COMMENT ON COLUMN public.amazon_envios.review_required        IS 'true si estado desconocido, MIXED, o CLOSED con discrepancia';
COMMENT ON COLUMN public.amazon_envios.shipment_year          IS 'Año del shipment calculado desde amazon_created_at (no desde actualización)';
COMMENT ON COLUMN public.amazon_envios.quantity_shipped       IS 'QuantityShipped v0 — unidades realmente enviadas al FC Amazon';
COMMENT ON COLUMN public.amazon_envios.quantity_expected      IS 'Cantidad planificada/esperada (v2024 expected)';
COMMENT ON COLUMN public.amazon_envios.discrepancy_quantity   IS 'quantity_shipped - cantidad_recibida (informativo, no es incidencia definitiva)';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Índices para columnas nuevas
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_amazon_envios_shipment_year
  ON public.amazon_envios (shipment_year);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_review_required
  ON public.amazon_envios (review_required)
  WHERE review_required = true;

CREATE INDEX IF NOT EXISTS idx_amazon_envios_estado
  ON public.amazon_envios (estado);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_amazon_created_at
  ON public.amazon_envios (amazon_created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tabla de historial de estados (append-only)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.amazon_envios_status_history (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id          text         NOT NULL,
  previous_status      text         NULL,
  new_status           text         NOT NULL,
  amazon_observed_at   timestamptz  NULL,   -- fecha en que Amazon reportó este estado
  synced_at            timestamptz  NOT NULL DEFAULT now(),
  source               text         NOT NULL DEFAULT 'sp_api_inbound',
  payload              jsonb        NULL    -- snapshot del raw en el momento del cambio
);

COMMENT ON TABLE public.amazon_envios_status_history IS
  'Historial append-only de cambios de estado en shipments Amazon. Conserva IN_TRANSIT→RECEIVING→CLOSED.';

CREATE INDEX IF NOT EXISTS idx_amazon_envios_status_history_shipment
  ON public.amazon_envios_status_history (shipment_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_status_history_observed
  ON public.amazon_envios_status_history (amazon_observed_at);

-- Idempotencia: mismo (shipment_id, new_status, observed_at) nunca se duplica.
-- COALESCE('1970-01-01') permite manejar amazon_observed_at NULL sin romper la restricción.
-- El código de sync debe usar INSERT ... ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_envios_status_history_idempotent
  ON public.amazon_envios_status_history (
    shipment_id,
    new_status,
    COALESCE(amazon_observed_at, '1970-01-01 00:00:00+00'::timestamptz)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill desde columnas existentes y campo raw
-- ─────────────────────────────────────────────────────────────────────────────

-- Poblar amazon_created_at desde raw (guardado por el nuevo sync)
UPDATE public.amazon_envios
SET amazon_created_at = (raw->>'amazon_created_at')::timestamptz
WHERE amazon_created_at IS NULL
  AND raw->>'amazon_created_at' IS NOT NULL;

-- Fallback a created_at_amazon legacy si amazon_created_at sigue NULL
UPDATE public.amazon_envios
SET amazon_created_at = (raw->>'created_at_amazon')::timestamptz
WHERE amazon_created_at IS NULL
  AND raw->>'created_at_amazon' IS NOT NULL;

-- Poblar amazon_last_updated_at
UPDATE public.amazon_envios
SET amazon_last_updated_at = (raw->>'amazon_last_updated_at')::timestamptz
WHERE amazon_last_updated_at IS NULL
  AND raw->>'amazon_last_updated_at' IS NOT NULL;

-- Fallback a updated_at_amazon legacy
UPDATE public.amazon_envios
SET amazon_last_updated_at = (raw->>'updated_at_amazon')::timestamptz
WHERE amazon_last_updated_at IS NULL
  AND raw->>'updated_at_amazon' IS NOT NULL;

-- Poblar shipment_year desde amazon_created_at o fecha_creacion
UPDATE public.amazon_envios
SET shipment_year = EXTRACT(YEAR FROM COALESCE(amazon_created_at, fecha_creacion::timestamptz))::int
WHERE shipment_year IS NULL
  AND (amazon_created_at IS NOT NULL OR fecha_creacion IS NOT NULL);

-- Poblar review_required desde raw
UPDATE public.amazon_envios
SET review_required = (raw->>'review_required')::boolean
WHERE review_required = false
  AND raw->>'review_required' = 'true';

-- Poblar quantity_shipped desde raw
UPDATE public.amazon_envios
SET quantity_shipped = (raw->>'quantity_shipped')::int
WHERE quantity_shipped IS NULL
  AND raw->>'quantity_shipped' IS NOT NULL;

-- Poblar quantity_expected desde raw o cantidad_esperada
UPDATE public.amazon_envios
SET quantity_expected = COALESCE((raw->>'quantity_expected')::int, cantidad_esperada)
WHERE quantity_expected IS NULL;

-- Poblar discrepancy_quantity desde raw
UPDATE public.amazon_envios
SET discrepancy_quantity = (raw->>'quantity_discrepancy')::int
WHERE discrepancy_quantity IS NULL
  AND raw->>'quantity_discrepancy' IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Nota sobre amazon_inbound_shipment_amazon_details
-- ─────────────────────────────────────────────────────────────────────────────
-- La tabla amazon_inbound_shipment_amazon_details (actualmente vacía) NO tiene
-- el esquema adecuado para historial de estados (le faltan previous_status,
-- new_status, amazon_observed_at). Se crea amazon_envios_status_history por
-- separado con el esquema correcto.
-- La tabla original puede mantenerse para snapshots de payload/fetch.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Tabla futura: incidencias noncompliance
-- ─────────────────────────────────────────────────────────────────────────────
-- GET_FBA_FULFILLMENT_INBOUND_NONCOMPLIANCE_DATA requiere tabla separada.
-- No incluida en esta migración — propuesta posterior.
--
-- CREATE TABLE IF NOT EXISTS public.amazon_inbound_noncompliance (
--   id                   uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
--   fba_shipment_id      text  NOT NULL,
--   fba_carton_id        text  NULL,
--   sku                  text  NULL,
--   fnsku                text  NULL,
--   asin                 text  NULL,
--   issue_reported_date  date  NULL,
--   problem_type         text  NULL,
--   problem_quantity     int   NULL,
--   expected_quantity    int   NULL,
--   received_quantity    int   NULL,
--   problem_level        text  NULL,
--   alert_status         text  NULL,
--   raw                  jsonb NULL,
--   fetched_at           timestamptz NOT NULL DEFAULT now()
-- );
COMMIT;
-- ══════════════════════════════════════════════════════════════════════════════
-- FIN DE PROPUESTA — NO EJECUTAR sin aprobación explícita
-- ══════════════════════════════════════════════════════════════════════════════
