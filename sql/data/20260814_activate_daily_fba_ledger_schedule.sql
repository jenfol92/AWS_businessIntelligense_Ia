BEGIN;

DO $$
DECLARE
  v_existing_count integer;
BEGIN
  SELECT count(*)
  INTO v_existing_count
  FROM public.amazon_report_schedules
  WHERE report_type = 'GET_LEDGER_SUMMARY_VIEW_DATA';

  IF v_existing_count > 1 THEN
    RAISE EXCEPTION 'MULTIPLE_FBA_LEDGER_SCHEDULES: %', v_existing_count;
  END IF;

  UPDATE public.amazon_report_schedules
  SET marketplace_country = 'EU',
      marketplace_id = NULL,
      frequency_minutes = 1440,
      enabled = true,
      last_requested_at = COALESCE(
        last_requested_at,
        TIMESTAMPTZ '2026-08-14 10:10:49.575928+00'
      ),
      last_success_at = COALESCE(
        last_success_at,
        TIMESTAMPTZ '2026-08-14 11:03:47.455+00'
      ),
      last_error_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE report_type = 'GET_LEDGER_SUMMARY_VIEW_DATA';

  IF NOT FOUND THEN
    INSERT INTO public.amazon_report_schedules (
      report_type,
      marketplace_country,
      marketplace_id,
      frequency_minutes,
      enabled,
      last_requested_at,
      last_success_at
    ) VALUES (
      'GET_LEDGER_SUMMARY_VIEW_DATA',
      'EU',
      NULL,
      1440,
      true,
      TIMESTAMPTZ '2026-08-14 10:10:49.575928+00',
      TIMESTAMPTZ '2026-08-14 11:03:47.455+00'
    );
  END IF;
END
$$;

COMMIT;
