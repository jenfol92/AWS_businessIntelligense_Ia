-- Migration: 20260922_03_product_policy_alerts
-- Purpose: Store Amazon SP-API policy and compliance alerts per marketplace
-- Retention rule: retain while still_in_amazon OR resolved_at is within 3 years;
--   records are tombstone-marked (still_in_amazon=false) before physical deletion.
-- Data origin: SP-API notifications (LISTINGS_ITEM_ISSUES, LISTINGS_DEFECT_NOTIFICATIONS,
--              LISTINGS_QUALITY_NOTIFICATIONS) + periodic Catalog Items sync.
-- PII: none (no customer data; product/listing metadata only).

CREATE TABLE IF NOT EXISTS product_policy_alerts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identifiers
    asin            VARCHAR(20) NOT NULL,
    sku             VARCHAR(50) NOT NULL,
    marketplace_id  VARCHAR(20) NOT NULL,
    country_code    VARCHAR(5)  NOT NULL,

    -- Classification (from SP-API notification)
    category        TEXT        NOT NULL,  -- e.g. "Seguridad de productos y alimentos"
    type            TEXT        NOT NULL,  -- e.g. "Problema de seguridad del producto"
    description     TEXT,                 -- Human-readable detail from the notification

    -- Status lifecycle
    -- still_in_amazon: TRUE = Amazon's Listings API still reports this issue.
    --   Set to FALSE only by the sync cron once Amazon no longer surfaces the alert.
    --   Do NOT set to FALSE based on an internal action alone.
    still_in_amazon BOOLEAN     NOT NULL DEFAULT TRUE,
    last_checked_at TIMESTAMPTZ,          -- Last time syncWithAmazon() ran for this alert

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- Date of the originating SP-API event
    resolved_at     TIMESTAMPTZ,                         -- Set when still_in_amazon becomes FALSE

    -- Product enrichment (populated by fetchCatalogItem, nullable until enriched)
    product_title   TEXT,
    product_image_url TEXT,
    product_brand   TEXT,

    -- Audit / source traceability (guardrail: §9 data origin)
    source_event    JSONB,   -- Raw SP-API notification payload for audit; never used for calcs

    -- Unique key: one alert per (product × marketplace × issue category × issue type)
    CONSTRAINT uq_policy_alert_identity
        UNIQUE (asin, sku, marketplace_id, category, type)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_policy_alerts_asin        ON product_policy_alerts (asin);
CREATE INDEX IF NOT EXISTS idx_policy_alerts_sku         ON product_policy_alerts (sku);
CREATE INDEX IF NOT EXISTS idx_policy_alerts_active      ON product_policy_alerts (still_in_amazon);
CREATE INDEX IF NOT EXISTS idx_policy_alerts_marketplace ON product_policy_alerts (marketplace_id);
CREATE INDEX IF NOT EXISTS idx_policy_alerts_created_at  ON product_policy_alerts (created_at);

-- Row-Level Security: read access for authenticated users; writes only via service role
ALTER TABLE product_policy_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policy_alerts_select_authenticated"
    ON product_policy_alerts
    FOR SELECT
    TO authenticated
    USING (true);

-- Service-role writes are unrestricted (service role bypasses RLS by design in Supabase).

COMMENT ON TABLE product_policy_alerts IS
  'Amazon SP-API compliance and safety alerts per listing × marketplace. '
  'Populated by SP-API notification webhooks. Sync status maintained by cron. '
  'Retention: active records indefinitely; resolved records for 3 years then deletable.';
