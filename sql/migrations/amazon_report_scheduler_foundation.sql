CREATE TABLE IF NOT EXISTS public.amazon_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type text NOT NULL,
  marketplace_country text NULL,
  marketplace_id text NULL,
  frequency_minutes integer NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_requested_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_error_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amazon_report_schedules_frequency_positive
    CHECK (frequency_minutes > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_amazon_report_schedules_scope
  ON public.amazon_report_schedules (
    report_type,
    COALESCE(marketplace_country, ''),
    COALESCE(marketplace_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_amazon_report_schedules_due
  ON public.amazon_report_schedules (enabled, last_requested_at, frequency_minutes);

COMMENT ON TABLE public.amazon_report_schedules IS
  'Configuración de informes Amazon SP-API programables. No ejecuta sincronizaciones por sí sola.';

CREATE TABLE IF NOT EXISTS public.amazon_report_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NULL REFERENCES public.amazon_report_schedules(id) ON DELETE CASCADE,
  report_type text NOT NULL,
  marketplace_country text NULL,
  marketplace_id text NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  locked_at timestamptz NULL,
  lock_expires_at timestamptz NULL,
  amazon_report_job_id uuid NULL REFERENCES public.amazon_spapi_report_jobs(id) ON DELETE SET NULL,
  error text NULL,
  summary jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amazon_report_sync_runs_status_check
    CHECK (status IN ('RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED_LOCKED'))
);

CREATE INDEX IF NOT EXISTS idx_amazon_report_sync_runs_scope_status
  ON public.amazon_report_sync_runs (
    report_type,
    COALESCE(marketplace_country, ''),
    COALESCE(marketplace_id, ''),
    status
  );

CREATE INDEX IF NOT EXISTS idx_amazon_report_sync_runs_schedule
  ON public.amazon_report_sync_runs (schedule_id);

CREATE INDEX IF NOT EXISTS idx_amazon_report_sync_runs_started
  ON public.amazon_report_sync_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_amazon_report_sync_runs_lock_expires
  ON public.amazon_report_sync_runs (lock_expires_at)
  WHERE status = 'RUNNING';

COMMENT ON TABLE public.amazon_report_sync_runs IS
  'Ejecuciones y locks de sincronizaciones programadas de informes Amazon SP-API.';

CREATE OR REPLACE FUNCTION public.start_amazon_report_sync_run(
  p_schedule_id uuid,
  p_report_type text,
  p_marketplace_country text DEFAULT NULL,
  p_marketplace_id text DEFAULT NULL,
  p_lock_minutes integer DEFAULT 30
)
RETURNS TABLE (
  started boolean,
  run_id uuid,
  reason text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_run_id uuid;
  v_lock_key text;
BEGIN
  v_lock_key := CONCAT_WS(
    '||',
    p_report_type,
    COALESCE(p_marketplace_country, ''),
    COALESCE(p_marketplace_id, '')
  );
  PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));

  IF EXISTS (
    SELECT 1
    FROM public.amazon_report_sync_runs r
    WHERE r.report_type = p_report_type
      AND COALESCE(r.marketplace_country, '') = COALESCE(p_marketplace_country, '')
      AND COALESCE(r.marketplace_id, '') = COALESCE(p_marketplace_id, '')
      AND r.status = 'RUNNING'
      AND r.lock_expires_at > now()
  ) THEN
    RETURN QUERY SELECT false, NULL::uuid, 'LOCKED'::text;
    RETURN;
  END IF;

  INSERT INTO public.amazon_report_sync_runs (
    schedule_id,
    report_type,
    marketplace_country,
    marketplace_id,
    status,
    locked_at,
    lock_expires_at
  )
  VALUES (
    p_schedule_id,
    p_report_type,
    p_marketplace_country,
    p_marketplace_id,
    'RUNNING',
    now(),
    now() + make_interval(mins => GREATEST(p_lock_minutes, 1))
  )
  RETURNING id INTO v_run_id;

  RETURN QUERY SELECT true, v_run_id, NULL::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_amazon_report_sync_run(uuid, text, text, text, integer)
  TO service_role;
