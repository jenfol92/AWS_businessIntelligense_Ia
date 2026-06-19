-- Trabajos de informes Amazon SP-API (Reports API)

CREATE TABLE IF NOT EXISTS public.amazon_spapi_report_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  report_type text NOT NULL,
  report_id text NULL,
  report_document_id text NULL,

  status text NOT NULL DEFAULT 'CREATED',
  processing_status text NULL,

  marketplace_ids text[] NULL,

  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,

  downloaded_at timestamptz NULL,

  source text NOT NULL DEFAULT 'amazon_spapi',

  error_message text NULL,
  raw jsonb NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_amazon_spapi_report_jobs_status
  ON public.amazon_spapi_report_jobs (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_spapi_report_jobs_report_id
  ON public.amazon_spapi_report_jobs (report_id)
  WHERE report_id IS NOT NULL;

COMMENT ON TABLE public.amazon_spapi_report_jobs IS
  'Cola manual de informes SP-API. GET_AFN_INVENTORY_DATA_BY_COUNTRY → preview → import stock por país.';
